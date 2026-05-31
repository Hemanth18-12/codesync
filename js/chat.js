import { rtdb, ref, push, onChildAdded, onValue, set, remove, serverTimestamp } from './firebase-config.js';
import { currentRoomId as roomId, currentUser } from './editor.js';

const chatInput = document.getElementById('chat-input');
const sendBtn = document.querySelector('#chat-form button[type="submit"]') || document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');
let typingTimeout;

// Use a basic generated color for the user if not available
const userColor = '#' + Math.floor(Math.random()*16777215).toString(16);

// --- SEND MESSAGE ---
const sendMessage = async (text) => {
    if (!text.trim()) return;
    const chatRef = ref(rtdb, `rooms/${roomId}/chat`);
    await push(chatRef, {
        text: text.trim(),
        userId: currentUser.uid,
        username: currentUser.displayName || currentUser.email,
        color: userColor,
        timestamp: Date.now(),
        type: 'message'
    });
};

// --- SEND BUTTON HANDLERS ---
if (sendBtn) {
    sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage(chatInput.value);
        chatInput.value = '';
    });
}

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(chatInput.value);
        chatInput.value = '';
    }
});

// --- RENDER MESSAGE ---
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const renderMessage = (msg) => {
    if (msg.type !== 'message') return;
    
    const isOwn = msg.userId === currentUser.uid;
    const messagesDiv = document.getElementById('chat-messages'); // using the ID from editor.html
    
    const bubble = document.createElement('div');
    bubble.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
    
    // Add slide in animation from CSS
    bubble.style.animation = "messageSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)";
    bubble.style.marginBottom = "1rem";
    bubble.style.display = "flex";
    bubble.style.gap = "0.5rem";
    if (isOwn) bubble.style.flexDirection = "row-reverse";
    
    bubble.innerHTML = `
        <div class="message-avatar" style="background:${msg.color}; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; flex-shrink: 0;">
            ${msg.username ? msg.username.charAt(0).toUpperCase() : '?'}
        </div>
        <div class="message-content" style="max-width: 75%;">
            <div class="message-name" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 2px; text-align: ${isOwn ? 'right' : 'left'}">
                ${isOwn ? 'You' : msg.username}
            </div>
            <div class="message-bubble" style="background: ${isOwn ? 'var(--primary-color)' : 'var(--bg-secondary)'}; padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.9rem;">
                ${msg.text}
            </div>
            <div class="message-time" style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; text-align: ${isOwn ? 'right' : 'left'}">
                ${formatTime(msg.timestamp)}
            </div>
        </div>
    `;
    messagesDiv.appendChild(bubble);
};

const scrollToBottom = () => {
    const messagesDiv = document.getElementById('chat-messages');
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
};

// --- INIT CHAT (RECEIVE MESSAGES) ---
window.addEventListener('monaco-ready', () => {
    if (!roomId || !currentUser) return;
    
    const chatRef = ref(rtdb, `rooms/${roomId}/chat`);
    onChildAdded(chatRef, (snapshot) => {
        const message = snapshot.val();
        renderMessage(message);
        scrollToBottom();
    });
});

// --- TYPING INDICATOR ---
chatInput.addEventListener('input', () => {
    if (!currentUser) return;
    
    const typingRef = ref(rtdb, `rooms/${roomId}/typing/${currentUser.uid}`);
    set(typingRef, {
        username: currentUser.displayName || currentUser.email || 'Someone',
        timestamp: Date.now()
    });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        remove(typingRef);
    }, 2500);
});

window.addEventListener('monaco-ready', () => {
    if (!roomId || !currentUser) return;
    
    const typingUsersRef = ref(rtdb, `rooms/${roomId}/typing`);
    onValue(typingUsersRef, (snapshot) => {
        const typingUsers = snapshot.val() || {};
        const others = Object.values(typingUsers).filter(u => u.username !== (currentUser.displayName || currentUser.email));
        
        if (others.length > 0) {
            typingIndicator.textContent = others.length === 1
                ? `${others[0].username} is typing...`
                : `${others.length} people are typing...`;
            typingIndicator.style.display = 'block';
        } else {
            typingIndicator.style.display = 'none';
        }
    });
});

export function appendSystemMessage(text) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const messagesDiv = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    div.style.margin = '0.5rem 0';
    div.innerHTML = `
        <span style="font-size: 0.75rem; color: var(--primary-color); background: rgba(249, 115, 22, 0.1); padding: 4px 8px; border-radius: 4px;">
            ⚙️ ${text} • ${time}
        </span>
    `;
    messagesDiv.appendChild(div);
    scrollToBottom();
}
