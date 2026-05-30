/**
 * CodeSync v2.0 - Dashboard Logic
 */
import { auth, database, firestore, isDev } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, set, get, onValue, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const appDash = {
    currentUser: null,
    roomsRef: null,
    activeRoomToDelete: null,

    init: function() {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                this.currentUser = user;
                this.roomsRef = ref(database, 'rooms');
                this.loadProfile();
                this.listenToRooms();
            } else {
                if(!isDev) window.location.href = 'auth.html';
                else this.mockInit();
            }
        });

        // Setup observer for stat animations
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if(entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        });
        document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
    },

    mockInit: function() {
        this.currentUser = { uid: 'mock123', displayName: 'Simulated User', email: 'dev@local' };
        document.getElementById('user-name').innerText = 'Simulated User';
        document.getElementById('user-name').classList.remove('skeleton-loader');
        document.getElementById('user-email').innerText = 'dev@local';
        document.getElementById('user-email').classList.remove('skeleton-loader');
        document.getElementById('user-avatar').innerText = 'SU';
        
        document.getElementById('stat-created').innerText = '3';
        document.getElementById('stat-joined').innerText = '5';
        
        this.renderRooms([{ id: 'MOCK01', name: 'Local Test', language: 'javascript', isPublic: true }], 'my-rooms-grid');
    },

    nav: function(viewId, btnEl) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        btnEl.classList.add('active');
        
        if(window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.remove('active');
        }
    },

    loadProfile: async function() {
        if(isDev) return;
        try {
            const docRef = doc(firestore, "users", this.currentUser.uid);
            const snap = await getDoc(docRef);
            
            if(snap.exists()) {
                const data = snap.data();
                document.getElementById('user-name').innerText = data.name;
                document.getElementById('header-name').innerText = data.name.split(' ')[0];
                document.getElementById('user-email').innerText = data.email;
                document.getElementById('user-avatar').innerText = data.initials;
                
                document.getElementById('user-name').classList.remove('skeleton-loader');
                document.getElementById('user-email').classList.remove('skeleton-loader');

                this.animateValue('stat-created', 0, data.stats.roomsCreated, 1000);
                this.animateValue('stat-joined', 0, data.stats.roomsJoined, 1000);
                this.animateValue('stat-sessions', 0, data.stats.totalSessions, 1000);
                this.animateValue('stat-lines', 0, data.stats.linesWritten, 1000);
            }
        } catch(e) {
            console.error("Error loading profile", e);
        }
    },

    animateValue: function(id, start, end, duration) {
        if (start === end) return;
        let range = end - start;
        let current = start;
        let increment = end > start ? Math.ceil(range / 20) : -1;
        let stepTime = Math.abs(Math.floor(duration / 20));
        let obj = document.getElementById(id);
        let timer = setInterval(function() {
            current += increment;
            if(current >= end) { current = end; clearInterval(timer); }
            obj.innerHTML = current;
        }, stepTime);
    },

    // --- Room Logic ---
    generateCode: function() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for(let i=0; i<6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        document.getElementById('generated-code').innerText = code;
        return code;
    },

    openCreateModal: function() {
        this.generateCode();
        document.getElementById('create-modal').classList.add('active');
    },

    createRoom: async function() {
        if(isDev) {
            this.showToast("Room created (Simulation)", "success");
            document.getElementById('create-modal').classList.remove('active');
            return;
        }

        const name = document.getElementById('new-room-name').value;
        const lang = document.getElementById('new-room-lang').value;
        const isPublic = document.getElementById('new-room-public').checked;
        const code = document.getElementById('generated-code').innerText;

        if(!name) return this.showToast("Room name required", "error");

        const btn = document.getElementById('btn-create-room');
        btn.innerHTML = '<div class="spinner"></div>';
        btn.disabled = true;

        try {
            // Write to RTDB
            await set(ref(database, `rooms/${code}/info`), {
                name: name,
                language: lang,
                isPublic: isPublic,
                createdBy: this.currentUser.uid,
                createdAt: serverTimestamp()
            });

            // Init code node
            await set(ref(database, `rooms/${code}/code`), {
                content: '// Welcome to CodeSync\n// Start typing...',
                timestamp: serverTimestamp()
            });

            // Update stats
            const docRef = doc(firestore, "users", this.currentUser.uid);
            await updateDoc(docRef, { "stats.roomsCreated": increment(1) });

            this.showToast("Room Created!", "success");
            this.addActivity(`Created room: ${name}`);
            document.getElementById('create-modal').classList.remove('active');
            
            // Redirect to editor
            setTimeout(() => window.location.href = `editor.html?room=${code}`, 1000);
        } catch(e) {
            console.error(e);
            this.showToast("Error creating room", "error");
        } finally {
            btn.innerHTML = 'Create Room';
            btn.disabled = false;
        }
    },

    joinRoom: async function() {
        const code = document.getElementById('join-input').value.toUpperCase();
        if(code.length !== 6) {
            this.shake('join-input');
            return;
        }
        if(isDev) {
            window.location.href = `editor.html?room=${code}`;
            return;
        }

        try {
            const roomSnap = await get(ref(database, `rooms/${code}/info`));
            if(roomSnap.exists()) {
                // Update stats
                const docRef = doc(firestore, "users", this.currentUser.uid);
                await updateDoc(docRef, { "stats.roomsJoined": increment(1) });
                this.addActivity(`Joined room: ${code}`);
                window.location.href = `editor.html?room=${code}`;
            } else {
                this.showToast("Room not found", "error");
                this.shake('join-input');
            }
        } catch(e) {
            console.error(e);
        }
    },

    listenToRooms: function() {
        if(isDev) return;
        onValue(ref(database, 'rooms'), (snap) => {
            const rooms = [];
            snap.forEach(child => {
                const info = child.val().info;
                if(info) {
                    rooms.push({ id: child.key, ...info });
                }
            });
            
            const myRooms = rooms.filter(r => r.createdBy === this.currentUser.uid);
            // In a real app, joined rooms would be queried from user profile. For now, public + created.
            
            this.renderRooms(myRooms, 'my-rooms-grid', true);
            this.renderRooms(myRooms.slice(0,4), 'recent-rooms-grid', true); // Preview
        });
    },

    renderRooms: function(rooms, containerId, isOwner = false) {
        const container = document.getElementById(containerId);
        if(!container) return;

        if(rooms.length === 0) {
            container.innerHTML = `
                <div class="empty-state glass-card" style="grid-column: 1/-1; padding:3rem; text-align:center;">
                    <i class="fa-solid fa-ghost" style="font-size:3rem; color:var(--text-muted); margin-bottom:1rem;"></i>
                    <p>No rooms found here.</p>
                </div>`;
            return;
        }

        let html = '';
        const badges = { 'javascript': 'yellow', 'python': 'blue', 'html': 'orange', 'typescript': 'info' };

        rooms.forEach(r => {
            const b = badges[r.language] || 'orange';
            html += `
            <div class="room-card glass-card">
                <div class="room-header">
                    <span class="room-title">${r.name}</span>
                    <span class="badge badge-${b}">${r.language}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="room-code" onclick="appDash.copyCode('${r.id}', event)" title="Copy">${r.id} <i class="fa-regular fa-copy" style="font-size:0.8rem; cursor:pointer;"></i></span>
                    <div style="display:flex; align-items:center; gap:5px; font-size:0.8rem; color:var(--success);">
                        <span class="dot" style="width:8px; height:8px; background:var(--success); border-radius:50%; box-shadow:0 0 5px var(--success);"></span> Live
                    </div>
                </div>
                <div class="room-meta">
                    <span>${new Date(r.createdAt || Date.now()).toLocaleDateString()}</span>
                    <span>${r.isPublic ? '<i class="fa-solid fa-earth-americas"></i> Public' : '<i class="fa-solid fa-lock"></i> Private'}</span>
                </div>
                <div class="room-actions">
                    <a href="editor.html?room=${r.id}" class="btn btn-primary" style="flex:1; padding:0.5rem;"><i class="fa-solid fa-play"></i> Enter</a>
                    ${isOwner ? `<button class="btn btn-secondary" style="padding:0.5rem;" onclick="appDash.promptDelete('${r.id}')"><i class="fa-solid fa-trash" style="color:var(--error);"></i></button>` : ''}
                </div>
            </div>`;
        });
        container.innerHTML = html;
    },

    copyCode: function(code, e) {
        if(e) e.stopPropagation();
        navigator.clipboard.writeText(code);
        this.showToast(`Code ${code} copied!`, "success");
    },

    promptDelete: function(roomId) {
        this.activeRoomToDelete = roomId;
        document.getElementById('delete-modal').classList.add('active');
    },

    confirmDelete: async function() {
        if(!this.activeRoomToDelete) return;
        if(isDev) { this.showToast("Deleted", "success"); document.getElementById('delete-modal').classList.remove('active'); return; }

        try {
            await remove(ref(database, `rooms/${this.activeRoomToDelete}`));
            this.showToast("Room deleted", "success");
            document.getElementById('delete-modal').classList.remove('active');
        } catch(e) {
            this.showToast("Error deleting room", "error");
        }
    },

    addActivity: function(text) {
        const feed = document.getElementById('activity-feed');
        // Remove empty state if present
        if(feed.querySelector('p')) feed.innerHTML = '';
        
        const el = document.createElement('div');
        el.className = 'activity-item';
        el.innerHTML = `
            <div style="display:flex; gap:10px; align-items:center;">
                <i class="fa-solid fa-circle-dot" style="color:var(--accent-primary); font-size:0.5rem;"></i>
                <span>${text}</span>
            </div>
            <div class="activity-time">Just now</div>
        `;
        feed.prepend(el);
    },

    logout: function() {
        if(isDev) { window.location.href = 'index.html'; return; }
        signOut(auth).then(() => {
            window.location.href = 'index.html';
        });
    },

    showToast: function(msg, type="info") {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(), 300); }, 3000);
    },

    shake: function(id) {
        const box = document.getElementById(id);
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 400);
    }
};

window.appDash = appDash;
document.addEventListener('DOMContentLoaded', () => appDash.init());
