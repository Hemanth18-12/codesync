import { rtdb, ref, push, onChildAdded, onValue, set, remove, serverTimestamp } from './firebase-config.js';
import { currentRoomId, currentUser } from './editor.js';

const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');

let typingTimeout;

// --- INIT CHAT ---
window.addEventListener('monaco-ready', () => {
    if (!currentRoomId || !currentUser) return;
    
    const chatRef = ref(rtdb, `rooms/${currentRoomId}/chat`);
    const typingRef = ref(rtdb, `rooms/${currentRoomId}/typing`);
    
    // Listen for new messages
    onChildAdded(chatRef, (snapshot) => {
        const data = snapshot.val();
        appendMessage(data);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
    
    // Listen for typing indicators
    onValue(typingRef, (snapshot) => {
        if (!snapshot.exists()) {
            typingIndicator.innerText = '';
            return;
        }
        
        const typers = [];
        snapshot.forEach(child => {
            if (child.key !== currentUser.uid && child.val().isTyping) {
                typers.push(child.val().name);
            }
        });
        
        if (typers.length === 0) typingIndicator.innerText = '';
        else if (typers.length === 1) typingIndicator.innerText = `${typers[0]} is typing...`;
        else typingIndicator.innerText = `${typers.length} people are typing...`;
    });
});

// --- SEND MESSAGE ---
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    
    chatInput.value = '';
    
    // Clear typing status immediately
    clearTimeout(typingTimeout);
    set(ref(rtdb, `rooms/${currentRoomId}/typing/${currentUser.uid}`), null);
    
    // Get user info from global var (hacky but works since auth.js sets it in localStorage or we fetch it)
    // We'll rely on the avatar URL stored in the DOM header for speed
    const bgImage = document.querySelector('.header-avatar')?.style.backgroundImage;
    const photoURL = bgImage ? bgImage.slice(5, -2) : 'assets/default-avatar.png';
    const name = document.getElementById('welcome-msg')?.innerText.split(', ')[1] || 'User';
    
    try {
        await push(ref(rtdb, `rooms/${currentRoomId}/chat`), {
            uid: currentUser.uid,
            name: name,
            photoURL: photoURL,
            text: text,
            timestamp: Date.now()
        });
    } catch (e) {
        console.error("Failed to send message", e);
    }
});

// --- TYPING STATUS ---
chatInput.addEventListener('input', () => {
    const name = document.getElementById('welcome-msg')?.innerText.split(', ')[1] || 'User';
    
    set(ref(rtdb, `rooms/${currentRoomId}/typing/${currentUser.uid}`), {
        name: name,
        isTyping: true
    });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        set(ref(rtdb, `rooms/${currentRoomId}/typing/${currentUser.uid}`), null);
    }, 2000);
});

// --- RENDER MESSAGE ---
function appendMessage(data) {
    const time = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    
    // Basic Markdown formatting (Code blocks)
    let formattedText = data.text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') // sanitize
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>') // code blocks
        .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 4px;border-radius:3px;">$1</code>'); // inline code
    
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `
        <img src="${data.photoURL}" class="chat-avatar" onerror="this.src='assets/default-avatar.png'">
        <div class="chat-content">
            <div class="chat-meta">
                <span class="chat-author">${data.name}</span>
                <span class="chat-time">${time}</span>
            </div>
            <div class="chat-text">${formattedText}</div>
        </div>
    `;
    
    chatMessages.appendChild(div);
}

// System Announcements
export function appendSystemMessage(text) {
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.style.alignItems = 'center';
    div.innerHTML = `
        <div class="chat-content" style="background: rgba(249, 115, 22, 0.1); padding: 0.5rem; border-radius: 4px; text-align: center; border: 1px solid rgba(249, 115, 22, 0.2);">
            <span style="font-size: 0.75rem; color: var(--primary-color);">⚙️ SYSTEM • ${time}</span>
            <div class="chat-text" style="color: var(--primary-color); font-weight: 500;">${text}</div>
        </div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
