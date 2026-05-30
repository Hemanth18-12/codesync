/**
 * CodeSync v2.0 - Chat Logic
 */
import { auth, database, isDev } from './firebase-config.js';
import { ref, push, onChildAdded, set, remove, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const appChat = {
    roomId: null,
    chatRef: null,
    typingRef: null,
    typingTimeout: null,
    isTyping: false,

    init: function() {
        if(isDev) {
            this.setupMock();
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        this.roomId = urlParams.get('room');
        this.chatRef = ref(database, `rooms/${this.roomId}/chat`);
        this.typingRef = ref(database, `rooms/${this.roomId}/typing`);

        // Setup UI Listeners
        const input = document.getElementById('chat-input');
        input.addEventListener('keydown', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            } else {
                this.handleTyping();
            }
        });

        // Listen for new messages
        onChildAdded(this.chatRef, (snap) => {
            const msg = snap.val();
            this.renderMessage(msg);
        });

        // Listen for typing events
        onValue(this.typingRef, (snap) => {
            const indicator = document.getElementById('typing-indicator');
            if(!snap.exists()) {
                indicator.classList.remove('active');
                return;
            }

            const typists = [];
            snap.forEach(child => {
                if(child.key !== auth.currentUser.uid) {
                    typists.push(child.val().name);
                }
            });

            if(typists.length > 0) {
                const text = typists.length > 2 ? 'Multiple people are typing' : `${typists.join(' and ')} ${typists.length > 1 ? 'are' : 'is'} typing`;
                indicator.innerHTML = `${text}<span>.</span><span>.</span><span>.</span>`;
                indicator.classList.add('active');
            } else {
                indicator.classList.remove('active');
            }
        });
    },

    setupMock: function() {
        document.getElementById('chat-messages').innerHTML = '';
        this.renderMessage({ text: 'Welcome to the local mock chat!', sender: 'System', uid: 'sys' });
        
        const input = document.getElementById('chat-input');
        input.addEventListener('keydown', (e) => {
            if(e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const text = input.value.trim();
                if(text) {
                    this.renderMessage({ text: text, sender: 'You', uid: 'mock123', timestamp: Date.now() });
                    input.value = '';
                    
                    // Mock reply
                    setTimeout(() => {
                        this.renderMessage({ text: 'Echo: ' + text, sender: 'Bot', uid: 'bot1', timestamp: Date.now() });
                    }, 1000);
                }
            }
        });
    },

    handleTyping: function() {
        if(!this.isTyping) {
            this.isTyping = true;
            set(ref(database, `rooms/${this.roomId}/typing/${auth.currentUser.uid}`), { name: auth.currentUser.displayName || 'User' });
        }
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isTyping = false;
            remove(ref(database, `rooms/${this.roomId}/typing/${auth.currentUser.uid}`));
        }, 2000);
    },

    sendMessage: function() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if(!text) return;

        input.value = '';
        if(isDev) return;

        push(this.chatRef, {
            text: text,
            sender: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
            uid: auth.currentUser.uid,
            timestamp: serverTimestamp()
        });

        // Clear typing
        clearTimeout(this.typingTimeout);
        this.isTyping = false;
        remove(ref(database, `rooms/${this.roomId}/typing/${auth.currentUser.uid}`));
    },

    renderMessage: function(msg) {
        const container = document.getElementById('chat-messages');
        const isSelf = msg.uid === (auth.currentUser ? auth.currentUser.uid : 'mock123');
        
        // Remove system msg
        const sys = container.querySelector('.system-msg');
        if(sys) sys.remove();

        const el = document.createElement('div');
        
        if(msg.uid === 'sys') {
            el.className = 'system-msg';
            el.innerText = msg.text;
        } else {
            el.className = `chat-msg ${isSelf ? 'self' : ''}`;
            
            // Code block detection
            let formattedText = msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            if(formattedText.startsWith("```")) {
                const codeContent = formattedText.replace(/```(.*?)\n?/g, "").trim();
                formattedText = `<pre style="background:rgba(0,0,0,0.4); padding:10px; border-radius:4px; font-family:var(--font-mono); margin-top:5px; overflow-x:auto;"><code>${codeContent}</code></pre>`;
            } else {
                formattedText = formattedText.replace(/\n/g, '<br>');
            }

            const initial = msg.sender.charAt(0).toUpperCase();
            const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Now';

            el.innerHTML = `
                <div class="msg-avatar" style="background:${isSelf ? 'var(--accent-primary)' : '#444'}">${initial}</div>
                <div class="msg-content">
                    <div class="msg-header">
                        <span class="msg-name">${msg.sender}</span>
                        <span class="msg-time">${time}</span>
                    </div>
                    <div class="msg-bubble">${formattedText}</div>
                </div>
            `;
        }

        container.appendChild(el);
        
        // Auto scroll if user is near bottom
        if (container.scrollHeight - container.scrollTop < container.clientHeight + 100 || isSelf) {
            container.scrollTop = container.scrollHeight;
        }
        
        // Update unread count if panel is closed
        const panel = document.getElementById('panel-chat');
        if(panel.classList.contains('hidden') && !isSelf) {
            const btn = document.getElementById('btn-toggle-chat');
            btn.style.color = 'var(--accent-primary)';
            btn.classList.add('shake');
            setTimeout(() => btn.classList.remove('shake'), 400);
        }
    }
};

window.appChat = appChat;
