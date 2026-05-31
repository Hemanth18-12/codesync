import { 
    auth, 
    db, 
    onAuthStateChanged, 
    signOut,
    doc,
    getDoc,
    collection,
    query,
    where,
    onSnapshot,
    setDoc,
    serverTimestamp,
    orderBy,
    updateDoc,
    deleteDoc,
    addDoc
} from './firebase-config.js';

let currentUser = null;
let userData = null;
let myRoomsUnsubscribe = null;
let joinedRoomsUnsubscribe = null;
let publicRoomsUnsubscribe = null;

// DOM Elements
const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item[data-view]');
const sidebar = document.getElementById('sidebar');
const collapseBtn = document.getElementById('collapse-btn');
const notifPanel = document.getElementById('notification-panel');

document.addEventListener('DOMContentLoaded', () => {
    
    // 1. Auth Guard
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'auth.html';
            return;
        }
        currentUser = user;
        await loadUserProfile(user.uid);
        setupRealtimeListeners();
    });

    // 2. Navigation Logic
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const viewId = item.getAttribute('data-view');
            switchView(viewId);
            
            // Update active state
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        });
    });

    function switchView(viewId) {
        views.forEach(view => view.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
    }

    // 3. Sidebar Collapse
    collapseBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // 4. Notifications Toggle
    document.getElementById('btn-notifications').addEventListener('click', () => {
        notifPanel.classList.toggle('open');
    });
    document.getElementById('close-notifs').addEventListener('click', () => {
        notifPanel.classList.remove('open');
    });

    // 5. Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
        try {
            await signOut(auth);
            // Will trigger onAuthStateChanged and redirect
        } catch (error) {
            console.error("Logout error", error);
            showToast("Failed to logout", "error");
        }
    });

    // 6. Create Room Modal Logic
    const modal = document.getElementById('create-room-modal');
    const btnNewRoom = document.getElementById('btn-new-room');
    const closeModals = document.querySelectorAll('.close-modal, .close-modal-btn');
    const codeDisplay = document.getElementById('cr-code');
    const btnRefreshCode = document.getElementById('btn-refresh-code');
    const slider = document.getElementById('cr-max');
    const sliderVal = document.getElementById('cr-max-val');
    const form = document.getElementById('create-room-form');

    btnNewRoom.addEventListener('click', () => {
        modal.classList.add('active');
        generateRoomCode();
    });

    closeModals.forEach(btn => {
        btn.addEventListener('click', () => {
            modal.classList.remove('active');
            form.reset();
            sliderVal.textContent = "5";
        });
    });

    slider.addEventListener('input', (e) => {
        sliderVal.textContent = e.target.value;
    });

    btnRefreshCode.addEventListener('click', generateRoomCode);

    document.getElementById('cr-name').addEventListener('input', (e) => {
        document.getElementById('cr-name-count').textContent = e.target.value.length;
    });

    function generateRoomCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Animate typewriter effect for code
        codeDisplay.textContent = '';
        let i = 0;
        const typeTimer = setInterval(() => {
            codeDisplay.textContent += code.charAt(i);
            i++;
            if(i>=6) clearInterval(typeTimer);
        }, 50);
        codeDisplay.dataset.code = code;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-submit-room');
        btn.classList.add('loading');
        
        const roomData = {
            name: document.getElementById('cr-name').value,
            language: document.getElementById('cr-language').value,
            isPublic: document.getElementById('cr-public').checked,
            maxParticipants: parseInt(document.getElementById('cr-max').value),
            ownerId: currentUser.uid,
            collaborators: [currentUser.uid], // Owner is first collaborator
            createdAt: serverTimestamp(),
            lastActive: serverTimestamp()
        };

        const roomId = codeDisplay.dataset.code;

        try {
            // Check if room code exists (rare but possible)
            const roomRef = doc(db, 'rooms', roomId);
            const roomSnap = await getDoc(roomRef);
            if(roomSnap.exists()) {
                generateRoomCode(); // Generate new and throw error to retry
                throw new Error("Room code collision. Please try again.");
            }

            // Create room
            await setDoc(roomRef, roomData);

            // Update user stats
            const userRef = doc(db, 'users', currentUser.uid);
            await updateDoc(userRef, {
                'stats.roomsCreated': userData.stats.roomsCreated + 1,
                rooms: [...(userData.rooms || []), roomId]
            });

            showToast("Room created successfully!");
            modal.classList.remove('active');
            form.reset();
            
            // Redirect to editor
            window.location.href = `editor.html?room=${roomId}`;

        } catch (error) {
            console.error(error);
            showToast(error.message || "Failed to create room", "error");
        } finally {
            btn.classList.remove('loading');
        }
    });

    // 7. Quick Join Logic
    const codeBoxes = document.querySelectorAll('.code-box');
    codeBoxes.forEach((box, index) => {
        box.addEventListener('input', (e) => {
            if(e.target.value.length === 1 && index < 5) {
                codeBoxes[index + 1].focus();
            }
        });
        box.addEventListener('keydown', (e) => {
            if(e.key === 'Backspace' && e.target.value === '' && index > 0) {
                codeBoxes[index - 1].focus();
            }
            if(e.key === 'Enter') {
                document.getElementById('btn-quick-join').click();
            }
        });
    });

    document.getElementById('btn-quick-join').addEventListener('click', async () => {
        let code = Array.from(codeBoxes).map(b => b.value).join('').toUpperCase();
        if(code.length !== 6) {
            codeBoxes.forEach(b => b.classList.add('error'));
            setTimeout(() => codeBoxes.forEach(b => b.classList.remove('error')), 400);
            return;
        }

        const btn = document.getElementById('btn-quick-join');
        btn.innerHTML = '<div class="spinner"></div>';
        
        try {
            const roomRef = doc(db, 'rooms', code);
            const roomSnap = await getDoc(roomRef);
            
            if (roomSnap.exists()) {
                // Add to collaborators if not public or not already there
                const rData = roomSnap.data();
                if (!rData.collaborators.includes(currentUser.uid)) {
                    await updateDoc(roomRef, {
                        collaborators: [...rData.collaborators, currentUser.uid]
                    });
                }
                window.location.href = `editor.html?room=${code}`;
            } else {
                showToast("Room not found", "error");
                codeBoxes.forEach(b => { b.value = ''; b.classList.add('error'); });
                setTimeout(() => codeBoxes.forEach(b => b.classList.remove('error')), 400);
                codeBoxes[0].focus();
            }
        } catch(error) {
            showToast("Error joining room", "error");
        } finally {
            btn.innerHTML = 'Join Room';
        }
    });
});

// --- User Profile & Stats ---
async function loadUserProfile(uid) {
    const userRef = doc(db, 'users', uid);
    
    // Use onSnapshot for real-time stats updates
    onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
            userData = docSnap.data();
            updateUIWithUserData();
        }
    });
}

function updateUIWithUserData() {
    if (!userData) return;

    // Sidebar & Header
    const nameStr = userData.fullName || 'User';
    document.getElementById('user-name').textContent = nameStr;
    document.getElementById('user-name').classList.remove('skeleton-text');
    
    document.getElementById('user-email').textContent = userData.email;
    document.getElementById('user-email').classList.remove('skeleton-text');
    
    document.getElementById('greeting-text').textContent = `${getGreeting()}, ${nameStr.split(' ')[0]}`;

    // Avatars
    const avs = document.querySelectorAll('.avatar');
    avs.forEach(av => {
        av.textContent = userData.avatar.initials;
        av.style.backgroundColor = userData.avatar.color;
    });

    // Stats (animate count up if first load, else direct update)
    updateStatCounter('stat-created', userData.stats.roomsCreated);
    updateStatCounter('stat-joined', userData.stats.roomsJoined);
    updateStatCounter('stat-sessions', userData.stats.totalSessions);
    updateStatCounter('stat-lines', userData.stats.linesWritten);

    // Apply theme preference
    document.documentElement.setAttribute('data-theme', userData.preferences?.theme || 'dark');
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
}

function updateStatCounter(elementId, targetValue) {
    const el = document.getElementById(elementId);
    const current = parseInt(el.textContent.replace(/,/g, '')) || 0;
    
    if (current === targetValue) return;

    // Simple animation
    const duration = 1000;
    const steps = 20;
    const stepValue = (targetValue - current) / steps;
    let stepCount = 0;

    const timer = setInterval(() => {
        stepCount++;
        const val = Math.round(current + (stepValue * stepCount));
        el.textContent = val.toLocaleString();
        
        if (stepCount >= steps) {
            el.textContent = targetValue.toLocaleString();
            clearInterval(timer);
        }
    }, duration / steps);
}

// --- Realtime Data Fetching ---
function setupRealtimeListeners() {
    
    // 1. My Rooms (Owner)
    const roomsRef = collection(db, 'rooms');
    const myRoomsQuery = query(roomsRef, where('ownerId', '==', currentUser.uid));
    
    myRoomsUnsubscribe = onSnapshot(myRoomsQuery, (snapshot) => {
        const grid = document.getElementById('my-rooms-grid');
        const empty = document.getElementById('my-rooms-empty');
        document.getElementById('my-rooms-count').textContent = snapshot.size;

        if (snapshot.empty) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
            grid.innerHTML = '';
            snapshot.forEach(doc => {
                grid.appendChild(createRoomCard(doc.id, doc.data(), true));
            });
        }
    });

    // 2. Joined Rooms (Collaborator, not owner — filtered client-side since Firestore
    //    doesn't support array-contains combined with != in a simple composite query)
    const joinedRoomsQuery = query(roomsRef, 
        where('collaborators', 'array-contains', currentUser.uid)
    );

    joinedRoomsUnsubscribe = onSnapshot(joinedRoomsQuery, (snapshot) => {
        const grid = document.getElementById('joined-rooms-grid');
        const empty = document.getElementById('joined-rooms-empty');
        
        let count = 0;
        grid.innerHTML = '';

        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.ownerId !== currentUser.uid) {
                count++;
                grid.appendChild(createRoomCard(doc.id, data, false));
            }
        });

        if (count === 0) {
            empty.classList.remove('hidden');
        } else {
            empty.classList.add('hidden');
        }
    });

    // 3. Explore (Public rooms)
    const publicQuery = query(roomsRef, where('isPublic', '==', true), orderBy('createdAt', 'desc'));
    publicRoomsUnsubscribe = onSnapshot(publicQuery, (snapshot) => {
        const grid = document.getElementById('explore-grid');
        grid.innerHTML = '';
        snapshot.forEach(doc => {
            grid.appendChild(createRoomCard(doc.id, doc.data(), false));
        });
    });
}

function createRoomCard(id, data, isOwner) {
    const card = document.createElement('div');
    card.className = 'room-card glass-card animate-on-scroll visible';
    
    const langColors = {
        javascript: '#f7df1e', python: '#3776ab', html: '#e34f26',
        css: '#1572b6', typescript: '#3178c6', java: '#f89820'
    };
    const dotColor = langColors[data.language] || 'var(--primary-color)';

    const timeAgo = formatRelativeTime(data.lastActive?.toDate() || new Date());

    card.innerHTML = `
        <div class="room-card-header">
            <div>
                <h3 class="room-title" title="${data.name}">${data.name}</h3>
                <div class="room-lang">
                    <span class="lang-dot" style="background:${dotColor}"></span>
                    ${data.language.charAt(0).toUpperCase() + data.language.slice(1)}
                </div>
            </div>
            <div class="room-code-badge" onclick="copyCode('${id}')" title="Copy Code">
                ${id} 📋
            </div>
        </div>
        
        <div class="room-stats">
            <div class="active-users">
                <span class="dot"></span> Active recently
            </div>
            <div>•</div>
            <div>Updated ${timeAgo}</div>
        </div>

        <div class="room-card-footer">
            <div class="collab-stack">
                <div class="avatar" style="background:var(--primary-color)">U1</div>
                <div class="avatar" style="background:var(--secondary-color)">U2</div>
            </div>
            <div class="card-actions">
                ${isOwner ? `<button class="icon-btn delete-btn" title="Delete Room" data-id="${id}">🗑️</button>` : ''}
                <a href="editor.html?room=${id}" class="btn-primary" style="padding: 0.4rem 1rem; font-size:0.9rem;">
                    Open
                </a>
            </div>
        </div>
    `;

    // Delete handler
    if(isOwner) {
        card.querySelector('.delete-btn').addEventListener('click', () => {
            // Setup delete modal logic in a real app, here direct for brevity based on instructions
            if(confirm("Are you sure you want to delete this room?")) {
                deleteDoc(doc(db, 'rooms', id)).then(() => {
                    showToast("Room deleted");
                });
            }
        });
    }

    return card;
}

// Utility Functions
window.copyCode = function(code) {
    navigator.clipboard.writeText(code).then(() => {
        showToast("Room code copied to clipboard!");
    });
}

function formatRelativeTime(date) {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const daysDifference = Math.round((date - new Date()) / (1000 * 60 * 60 * 24));
    
    if (daysDifference === 0) {
        const hours = Math.round((date - new Date()) / (1000 * 60 * 60));
        if(hours === 0) {
            const mins = Math.round((date - new Date()) / (1000 * 60));
            return rtf.format(mins, 'minute');
        }
        return rtf.format(hours, 'hour');
    }
    return rtf.format(daysDifference, 'day');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '';
    if(type==='success') icon = '✅';
    if(type==='error') icon = '❌';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        if(container.contains(toast)) toast.remove();
    }, 4000);
}
