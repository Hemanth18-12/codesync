/**
 * CodeSync v2.0 - Room Presence & Utilities
 */
import { auth, database, isDev } from './firebase-config.js';
import { ref, onValue, set, remove, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const appRooms = {
    roomId: null,
    usersRef: null,
    userRef: null,

    initPresence: function() {
        const urlParams = new URLSearchParams(window.location.search);
        this.roomId = urlParams.get('room');
        if(!this.roomId || isDev) return;

        this.usersRef = ref(database, `rooms/${this.roomId}/users`);
        this.userRef = ref(database, `rooms/${this.roomId}/users/${auth.currentUser.uid}`);

        // Set online status
        set(this.userRef, {
            name: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
            joinedAt: serverTimestamp()
        });

        // Remove on disconnect
        onDisconnect(this.userRef).remove();
        onDisconnect(ref(database, `rooms/${this.roomId}/typing/${auth.currentUser.uid}`)).remove();

        // Listen for active users
        onValue(this.usersRef, (snap) => {
            const container = document.getElementById('active-users');
            container.innerHTML = '';
            let count = 0;

            if(snap.exists()) {
                const colors = ['#ff6b00', '#00ff88', '#4488ff', '#ff4444', '#ffcc00'];
                
                snap.forEach(child => {
                    count++;
                    if(count <= 4) {
                        const user = child.val();
                        const initial = user.name.charAt(0).toUpperCase();
                        const color = colors[(count-1) % colors.length];
                        
                        const el = document.createElement('div');
                        el.className = 'avatar';
                        el.style.width = '32px';
                        el.style.height = '32px';
                        el.style.fontSize = '0.8rem';
                        el.style.borderColor = color;
                        el.title = user.name;
                        el.innerText = initial;
                        
                        container.appendChild(el);
                    }
                });

                if(count > 4) {
                    const el = document.createElement('div');
                    el.className = 'avatar';
                    el.style.width = '32px';
                    el.style.height = '32px';
                    el.style.fontSize = '0.7rem';
                    el.style.background = '#444';
                    el.style.borderColor = '#555';
                    el.innerText = `+${count - 4}`;
                    container.appendChild(el);
                }
            }
            
            document.getElementById('chat-count').innerText = count;
        });

        // Add unload listener to clean up
        window.addEventListener('beforeunload', () => {
            remove(this.userRef);
        });
    },

    leaveRoom: function() {
        if(!isDev && this.userRef) {
            remove(this.userRef).then(() => {
                window.location.href = 'dashboard.html';
            });
        } else {
            window.location.href = 'dashboard.html';
        }
    },

    copyRoomLink: function() {
        const url = window.location.href.split('?')[0] + '?room=' + this.roomId;
        navigator.clipboard.writeText(url).then(() => {
            window.appEditor.showToast("Invite link copied!", "success");
        });
    }
};

window.appRooms = appRooms;
