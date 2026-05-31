import { rtdb, ref, push, onChildAdded, set, remove } from './firebase-config.js';

let chatRef, typingRef;
let currentUserId, currentUserData;
let currentRoomId;
let typingTimeout = null;
let isFirstLoad = true;

const COLORS = ['#7aa2f7','#bb9af7','#9ece6a','#e0af68','#f7768e','#73daca','#ff9e64','#2ac3de'];

export function initChat(roomId, user, userData) {
    currentRoomId = roomId;
    currentUserId = user.uid;
    currentUserData = userData;

    chatRef = ref(rtdb, `rooms/${roomId}/chat`);
    typingRef = ref(rtdb, `rooms/${roomId}/typing`);

    setupChatListeners();
    setupInputListeners();
}

function setupChatListeners() {
    const messagesContainer = document.getElementById('chat-messages');

    onChildAdded(chatRef, (snap) => {
        const msg = snap.val();
        if (!msg) return;

        // Skip initial batch render flicker
        if (isFirstLoad) {
            renderMessage(msg);
        } else {
            renderMessage(msg);
            scrollToBottom();
        }
    });

    // Mark first load done after brief delay
    setTimeout(() => {
        isFirstLoad = false;
        scrollToBottom();
    }, 1500);

    // Typing indicator listener
    import('./firebase-config.js').then(({ onValue }) => {
        const typingEl = document.getElementById('typing-indicator');
        const typingText = document.getElementById('typing-text');

        onValue(typingRef, (snap) => {
            const typingUsers = snap.val() || {};
            const names = Object.entries(typingUsers)
                .filter(([uid, data]) => uid !== currentUserId && data.isTyping && Date.now() - data.timestamp < 4000)
                .map(([, data]) => data.username);

            if (names.length > 0) {
                typingEl.classList.remove('hidden');
                if (names.length === 1) typingText.textContent = `${names[0]} is typing`;
                else if (names.length === 2) typingText.textContent = `${names[0]} and ${names[1]} are typing`;
                else typingText.textContent = `Multiple people are typing`;
            } else {
                typingEl.classList.add('hidden');
            }
        });
    });
}

function setupInputListeners() {
    const chatInput = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send-chat');

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
        broadcastTyping(true);
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    btnSend.addEventListener('click', sendMessage);

    // Members list toggle
    const toggleBtn = document.getElementById('btn-toggle-members');
    const membersList = document.getElementById('members-list');
    if (toggleBtn && membersList) {
        toggleBtn.addEventListener('click', () => {
            membersList.classList.toggle('collapsed');
            const arrow = toggleBtn.querySelector('span:last-child');
            if (arrow) arrow.textContent = membersList.classList.contains('collapsed') ? '▼' : '▲';
        });
    }

    // Close chat panel
    const btnCloseChat = document.getElementById('btn-close-chat');
    const panelRight = document.getElementById('panel-right');
    if (btnCloseChat && panelRight) {
        btnCloseChat.addEventListener('click', () => {
            panelRight.classList.toggle('collapsed');
        });
    }
}

async function sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    if (text.length > 500) {
        const input = document.getElementById('chat-input');
        input.style.border = '1px solid var(--error-color)';
        setTimeout(() => input.style.border = '', 2000);
        return;
    }

    const message = {
        text: text,
        userId: currentUserId,
        username: currentUserData.fullName.split(' ')[0],
        fullName: currentUserData.fullName,
        color: currentUserData.avatar.color,
        initials: currentUserData.avatar.initials,
        timestamp: Date.now(),
        type: 'message'
    };

    try {
        await push(chatRef, message);
        input.value = '';
        input.style.height = 'auto';
        clearTyping();
    } catch (err) {
        console.error("Failed to send message:", err);
    }
}

function broadcastTyping(isTyping) {
    if (!currentUserId) return;

    set(ref(rtdb, `rooms/${currentRoomId}/typing/${currentUserId}`), {
        isTyping: isTyping,
        username: currentUserData.fullName.split(' ')[0],
        timestamp: Date.now()
    });

    // Auto-clear typing after 2.5s
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(clearTyping, 2500);
}

function clearTyping() {
    if (!currentUserId) return;
    remove(ref(rtdb, `rooms/${currentRoomId}/typing/${currentUserId}`));
}

// --- Message Rendering ---
let lastMessageUserId = null;
let lastMessageTime = null;
let lastMsgGroupEl = null;

function renderMessage(msg) {
    const container = document.getElementById('chat-messages');
    const isOwn = msg.userId === currentUserId;
    const msgTime = new Date(msg.timestamp);

    // Check if this should be grouped with previous
    const sameUser = msg.userId === lastMessageUserId;
    const within2Min = lastMessageTime && (msgTime - lastMessageTime) < 120000;
    const shouldGroup = sameUser && within2Min && lastMsgGroupEl;

    if (msg.type === 'system') {
        const sys = document.createElement('div');
        sys.className = 'sys-msg';
        sys.textContent = msg.text;
        container.appendChild(sys);
        return;
    }

    if (!shouldGroup) {
        // Create new message group
        const group = document.createElement('div');
        group.className = `msg-group ${isOwn ? 'own' : 'others'}`;

        // Header
        const header = document.createElement('div');
        header.className = 'msg-header';
        header.innerHTML = `
            <div class="avatar" style="background:${msg.color}; width:20px; height:20px; font-size:0.55rem;">${msg.initials}</div>
            <span class="name" style="color:${msg.color}">${msg.fullName || msg.username}</span>
            <span class="time">${formatTime(msgTime)}</span>
        `;
        group.appendChild(header);

        lastMsgGroupEl = group;
        container.appendChild(group);
    }

    // Add bubble to current group
    const bubble = createBubble(msg.text, isOwn);
    lastMsgGroupEl.appendChild(bubble);

    lastMessageUserId = msg.userId;
    lastMessageTime = msgTime;

    scrollToBottom();
}

function createBubble(text, isOwn) {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    // Detect code blocks
    if (text.includes('```')) {
        bubble.innerHTML = parseCodeBlocks(text);
        // Highlight code blocks
        bubble.querySelectorAll('pre code').forEach(block => {
            if (window.Prism) {
                window.Prism.highlightElement(block);
            }
        });
    } else {
        // Linkify URLs and escape HTML
        bubble.innerHTML = linkify(escapeHtml(text));
    }

    return bubble;
}

function parseCodeBlocks(text) {
    // Escape then parse code blocks
    const parts = text.split('```');
    let html = '';
    parts.forEach((part, i) => {
        if (i % 2 === 0) {
            html += `<span>${escapeHtml(part)}</span>`;
        } else {
            const firstNewline = part.indexOf('\n');
            const lang = firstNewline > 0 ? part.substring(0, firstNewline).trim() : 'javascript';
            const code = firstNewline > 0 ? part.substring(firstNewline + 1) : part;
            html += `<pre><button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent)">📋</button><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
        }
    });
    return html;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function linkify(text) {
    const urlPattern = /https?:\/\/[^\s]+/g;
    return text.replace(urlPattern, url => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--primary-color)">${url}</a>`);
}

function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function formatTime(date) {
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString();
}

// Send System Message (called from editor or rooms module)
export async function sendSystemMessage(text) {
    if (!chatRef) return;
    await push(chatRef, {
        text: text,
        type: 'system',
        timestamp: Date.now()
    });
}
