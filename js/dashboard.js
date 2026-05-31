import { 
    auth, db, rtdb, collection, doc, getDoc, getDocs, setDoc, updateDoc, 
    onSnapshot, query, where, orderBy, limit, startAfter, addDoc, serverTimestamp, 
    ref, set, onValue, onAuthStateChanged, signOut, increment
} from './firebase-config.js';

// --- GLOBAL STATE ---
let currentUser = null;
let userData = null;
let activeView = 'overview';
let exploreLastDoc = null;
let isExploreLoading = false;

// --- DOM ELEMENTS ---
const sidebar = document.getElementById('sidebar');
const btnCollapse = document.getElementById('btn-collapse');
const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
const views = document.querySelectorAll('.view');
const welcomeMsg = document.getElementById('welcome-msg');
const headerAvatar = document.getElementById('header-avatar');
const sidebarAvatar = document.getElementById('sidebar-avatar');
const sidebarName = document.getElementById('sidebar-name');
const btnLogout = document.getElementById('btn-logout');

// Toast Helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠️';
    toast.innerHTML = `<span style="font-weight:bold;font-size:1.2rem">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// --- INIT AUTH & DATA ---
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'auth.html';
        return;
    }
    currentUser = user;
    
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (!userDoc.exists() || !userDoc.data().onboardingComplete) {
            window.location.href = 'profile-setup.html';
            return;
        }
        userData = userDoc.data();
        
        // Populate UI
        const name = userData.displayName;
        const photo = userData.photoURL || 'assets/default-avatar.png';
        
        sidebarName.innerText = name;
        sidebarAvatar.style.backgroundImage = `url('${photo}')`;
        headerAvatar.style.backgroundImage = `url('${photo}')`;
        
        const hour = new Date().getHours();
        const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        welcomeMsg.innerText = `${greeting}, ${name.split(' ')[0]}`;
        
        // Load Initial View Data
        loadOverviewData();
        setupNotifications();
        
    } catch (error) {
        console.error("Error loading user data:", error);
        showToast("Error loading profile data", "error");
    }
});

// --- NAVIGATION LOGIC ---
btnCollapse.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
});

navItems.forEach(item => {
    item.addEventListener('click', () => {
        if (!item.dataset.view) return; // Skip settings link
        
        // Update nav UI
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        
        // Update view UI
        activeView = item.dataset.view;
        views.forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${activeView}`).classList.add('active');
        
        // Load data based on view
        if (activeView === 'explore') loadExploreRooms(true);
        if (activeView === 'snapshots') loadSnapshots();
        if (activeView === 'overview') loadOverviewData();
    });
});

btnLogout.addEventListener('click', async () => {
    try {
        await signOut(auth);
        window.location.href = 'auth.html';
    } catch (error) {
        showToast(error.message, 'error');
    }
});

// --- EVENT LISTENERS ---
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('open-room-btn')) {
        const roomId = e.target.dataset.roomId;
        if (roomId) {
            window.location.href = \`editor.html?room=\${roomId}\`;
        }
    }
});

// --- OVERVIEW DATA LOAD ---
function loadOverviewData() {
    if (!currentUser || !userData) return;

    // 1. Stats Cards
    const stats = userData.stats || {};
    
    // Animate basic stats
    animateCounter(document.getElementById('stat-minutes'), stats.totalCodingMinutes || 0);
    document.getElementById('stat-streak').innerText = `${stats.streakDays || 0} days`;

    // Query for rooms count
    const qOwner = query(collection(db, 'rooms'), where('ownerId', '==', currentUser.uid));
    const qCollab = query(collection(db, 'rooms'), where('collaborators', 'array-contains', currentUser.uid));
    
    // We use onSnapshot for live counts and recent rooms list
    onSnapshot(qOwner, (snapshot) => {
        animateCounter(document.getElementById('stat-rooms'), snapshot.size);
        renderRecentRooms(snapshot, 'owner');
    });
    
    onSnapshot(qCollab, (snapshot) => {
        // Approximate sessions joined based on collab presence (exclude owned)
        const joined = snapshot.docs.filter(d => d.data().ownerId !== currentUser.uid);
        animateCounter(document.getElementById('stat-sessions'), joined.length);
        renderRecentRooms(snapshot, 'collab');
    });

    // Activity Log
    loadActivityTimeline();
}

function animateCounter(el, target) {
    if (!el) return;
    el.setAttribute('data-target', target);
    const duration = 1500;
    const stepTime = 20;
    const steps = duration / stepTime;
    let current = parseInt(el.innerText) || 0;
    const inc = (target - current) / steps;

    if (current === target) { el.innerText = target; return; }

    const timer = setInterval(() => {
        current += inc;
        if ((inc > 0 && current >= target) || (inc < 0 && current <= target)) {
            el.innerText = target;
            clearInterval(timer);
        } else {
            el.innerText = Math.floor(current);
        }
    }, stepTime);
}

// Recent Rooms Merge Logic
let recentOwnerDocs = [];
let recentCollabDocs = [];

function renderRecentRooms(snapshot, source) {
    if (source === 'owner') recentOwnerDocs = snapshot.docs;
    if (source === 'collab') recentCollabDocs = snapshot.docs.filter(d => d.data().ownerId !== currentUser.uid);
    
    const allRooms = [...recentOwnerDocs, ...recentCollabDocs];
    // Sort by lastActive desc
    allRooms.sort((a, b) => {
        const tA = a.data().lastActive?.toMillis() || 0;
        const tB = b.data().lastActive?.toMillis() || 0;
        return tB - tA;
    });
    
    const top5 = allRooms.slice(0, 5);
    const grid = document.getElementById('recent-rooms-grid');
    const emptyState = document.getElementById('empty-recent');
    
    // Clear existing cards
    Array.from(grid.children).forEach(child => {
        if (child.id !== 'empty-recent') child.remove();
    });
    
    if (top5.length === 0) {
        emptyState.classList.remove('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    
    top5.forEach(docSnap => {
        const data = docSnap.data();
        const roomId = docSnap.id;
        const card = document.createElement('div');
        card.className = 'room-card glass-card';
        card.innerHTML = `
            <div class="room-card-header">
                <div class="room-title-wrapper">
                    <div class="room-title">${data.name}</div>
                    <div class="room-lang"><span class="lang-dot" style="background: var(--primary-color)"></span> ${data.language || 'Mixed'}</div>
                </div>
            </div>
            <div class="room-stats">
                <span>👥 ${data.collaborators?.length || 1} members</span>
                <span class="active-users"><div class="dot"></div> <span id="active-count-${roomId}">1</span> live</span>
            </div>
            <div class="room-card-footer">
                <span style="font-size: 0.75rem; color: var(--text-muted)">ID: ${roomId}</span>
                <button class="open-room-btn" data-room-id="${roomId}">Open</button>
            </div>
        `;
        grid.appendChild(card);
        
        // Bind RTDB live count
        onValue(ref(rtdb, `rooms/${roomId}/activeUsers`), (snap) => {
            const el = document.getElementById(`active-count-${roomId}`);
            if (el) el.innerText = snap.exists() ? Object.keys(snap.val()).length : 0;
        });
    });
}

function loadActivityTimeline() {
    // We'll read from notifications where type is an activity type
    const q = query(
        collection(db, `notifications/${currentUser.uid}/items`),
        orderBy('timestamp', 'desc'),
        limit(5)
    );
    
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('activity-timeline');
        // keep empty state
        const emptyState = list.querySelector('.empty-state');
        
        // Remove existing items
        Array.from(list.children).forEach(c => {
            if (!c.classList.contains('empty-state')) c.remove();
        });
        
        if (snapshot.empty) {
            emptyState.style.display = 'flex';
            return;
        }
        
        emptyState.style.display = 'none';
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const time = data.timestamp ? new Date(data.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now';
            
            let icon = '📝'; let colorClass = 'blue';
            if(data.type === 'room_join') { icon = '👋'; colorClass = 'green'; }
            if(data.type === 'snapshot') { icon = '📸'; colorClass = 'purple'; }
            
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <div class="act-icon ${colorClass}">${icon}</div>
                <div class="act-content">
                    <p>${data.message}</p>
                    <span>${time}</span>
                </div>
            `;
            list.appendChild(item);
        });
    });
}

// --- EXPLORE DATA LOAD ---
async function loadExploreRooms(reset = false) {
    if (isExploreLoading) return;
    isExploreLoading = true;
    
    const grid = document.getElementById('explore-grid');
    if (reset) {
        exploreLastDoc = null;
        grid.innerHTML = `
            <div class="skeleton-loader" style="height: 200px;"></div>
            <div class="skeleton-loader" style="height: 200px;"></div>
            <div class="skeleton-loader" style="height: 200px;"></div>
        `;
    }

    try {
        let q;
        if (exploreLastDoc) {
            q = query(collection(db, 'rooms'), where('isPublic', '==', true), orderBy('lastActive', 'desc'), startAfter(exploreLastDoc), limit(12));
        } else {
            q = query(collection(db, 'rooms'), where('isPublic', '==', true), orderBy('lastActive', 'desc'), limit(12));
        }

        const snapshot = await getDocs(q);
        
        if (reset) grid.innerHTML = '';
        
        if (snapshot.empty && reset) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1">
                    <div class="empty-icon">🌍</div>
                    <h3>No public rooms yet</h3>
                    <p>Be the first to create a public room and share your code with the world!</p>
                </div>
            `;
            document.getElementById('btn-load-more').style.display = 'none';
            isExploreLoading = false;
            return;
        }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const roomId = docSnap.id;
            
            const card = document.createElement('div');
            card.className = 'room-card glass-card';
            
            // Build Tags
            let tagsHtml = '';
            if (data.tags && Array.isArray(data.tags)) {
                tagsHtml = `<div class="room-tags">` + data.tags.slice(0,3).map(t => `<span class="badge">${t}</span>`).join('') + `</div>`;
            }

            card.innerHTML = `
                <div class="room-card-header">
                    <div class="room-title-wrapper">
                        <div class="room-title">${data.name}</div>
                        <div class="room-owner">
                            <img src="${data.ownerPhoto || 'assets/default-avatar.png'}">
                            ${data.ownerName || 'Unknown'}
                        </div>
                    </div>
                    <div class="room-lang"><span class="lang-dot" style="background: var(--primary-color)"></span> ${data.language || 'Mixed'}</div>
                </div>
                <div class="room-desc">${data.description || 'No description provided.'}</div>
                ${tagsHtml}
                <div class="room-stats">
                    <span>👥 ${data.collaborators?.length || 1} members</span>
                    <span class="active-users"><div class="dot"></div> <span id="explore-active-${roomId}">1</span> live</span>
                </div>
                <div class="room-card-footer">
                    <button class="btn-secondary btn-sm" onclick="joinRoom('${roomId}')">Join Room</button>
                </div>
            `;
            grid.appendChild(card);

            // Bind live users
            onValue(ref(rtdb, `rooms/${roomId}/activeUsers`), (snap) => {
                const el = document.getElementById(`explore-active-${roomId}`);
                if (el) el.innerText = snap.exists() ? Object.keys(snap.val()).length : 0;
            });
        });

        exploreLastDoc = snapshot.docs[snapshot.docs.length - 1];
        
        if (snapshot.size < 12) {
            document.getElementById('btn-load-more').style.display = 'none';
        } else {
            document.getElementById('btn-load-more').style.display = 'inline-flex';
        }

    } catch (error) {
        console.error("Explore error:", error);
        if (reset) grid.innerHTML = `<p style="color:var(--error-color)">Failed to load rooms.</p>`;
    } finally {
        isExploreLoading = false;
    }
}

document.getElementById('btn-load-more').addEventListener('click', () => loadExploreRooms(false));

// --- SNAPSHOTS DATA LOAD ---
async function loadSnapshots() {
    const list = document.getElementById('snapshot-list');
    const emptyState = document.getElementById('empty-snapshots');
    
    // Remove existing items
    Array.from(list.children).forEach(c => {
        if (c.id !== 'empty-snapshots') c.remove();
    });

    try {
        // Query user's snapshots subcollection
        const q = query(collection(db, `users/${currentUser.uid}/snapshots`), orderBy('timestamp', 'desc'), limit(20));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            emptyState.classList.remove('hidden');
            return;
        }
        
        emptyState.classList.add('hidden');

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const time = data.timestamp ? new Date(data.timestamp.toMillis()).toLocaleString() : 'Unknown';
            
            const item = document.createElement('div');
            item.className = 'snapshot-item';
            item.innerHTML = `
                <div class="snap-info">
                    <h4>${data.label || 'Unnamed Snapshot'}</h4>
                    <div class="snap-meta">
                        <span>Room: ${data.roomName || data.roomId}</span>
                        <span>${time}</span>
                        <span>${data.lineCount || 0} lines</span>
                    </div>
                </div>
                <div class="snap-actions">
                    <button class="btn-secondary btn-sm" onclick="viewSnapshot('${docSnap.id}', \`${encodeURIComponent(data.code)}\`)">View</button>
                    <button class="btn-primary btn-sm" onclick="window.location.href='editor.html?room=${data.roomId}&restore=${docSnap.id}'">Restore</button>
                </div>
            `;
            list.appendChild(item);
        });

    } catch (error) {
        console.error("Snapshot error:", error);
        showToast("Failed to load snapshots", "error");
    }
}

// Global functions for inline onclicks
window.viewSnapshot = (id, encodedCode) => {
    const code = decodeURIComponent(encodedCode);
    document.getElementById('snap-modal-code').innerText = code;
    document.getElementById('snap-modal').classList.add('active');
};

window.joinRoom = async (roomId) => {
    if (!roomId) return;
    // Add user to collaborators if not already
    try {
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await getDoc(roomRef);
        if (roomSnap.exists()) {
            const data = roomSnap.data();
            if (!data.collaborators.includes(currentUser.uid)) {
                const newCollabs = [...data.collaborators, currentUser.uid];
                await updateDoc(roomRef, { collaborators: newCollabs });
                
                // Add notification to owner
                if (data.ownerId !== currentUser.uid) {
                    await addDoc(collection(db, `notifications/${data.ownerId}/items`), {
                        type: 'room_join',
                        message: `${userData.displayName} joined your room ${data.name}`,
                        timestamp: serverTimestamp(),
                        read: false
                    });
                }
            }
            window.location.href = `editor.html?room=${roomId}`;
        } else {
            showToast("Room not found.", "error");
        }
    } catch (error) {
        console.error(error);
        showToast("Error joining room.", "error");
    }
};

// --- MODALS & FORMS ---
// Create Room
document.getElementById('btn-quick-create').addEventListener('click', () => {
    document.getElementById('create-modal').classList.add('active');
});

document.getElementById('create-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-create-submit');
    btn.classList.add('loading');
    
    const name = document.getElementById('new-room-name').value;
    const isPublic = document.getElementById('new-room-public').checked;
    const template = document.getElementById('new-room-template').value;
    const tagsInput = document.getElementById('new-room-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    
    try {
        const newRoomRef = doc(collection(db, 'rooms'));
        const roomId = newRoomRef.id.substring(0,6).toUpperCase(); // Short ID for easy sharing
        
        await setDoc(doc(db, 'rooms', roomId), {
            name: name,
            ownerId: currentUser.uid,
            ownerName: userData.displayName,
            ownerPhoto: userData.photoURL,
            isPublic: isPublic,
            template: template,
            tags: tags,
            collaborators: [currentUser.uid],
            createdAt: serverTimestamp(),
            lastActive: serverTimestamp(),
            permissions: {
                [currentUser.uid]: 'owner'
            }
        });
        
        // Setup initial RTDB workspace based on template
        let initialCode = '';
        if (template === 'js-node') initialCode = 'console.log("Hello Node.js");';
        if (template === 'html-css') initialCode = '<!DOCTYPE html>\n<html>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>';
        if (template === 'python') initialCode = 'print("Hello Python")';
        
        await set(ref(rtdb, `rooms/${roomId}/workspace/main`), {
            content: initialCode,
            language: template === 'python' ? 'python' : template === 'html-css' ? 'html' : 'javascript'
        });

        // Add to user stats
        await updateDoc(doc(db, 'users', currentUser.uid), {
            "stats.roomsCreated": increment(1)
        });
        
        window.location.href = `editor.html?room=${roomId}`;
    } catch (error) {
        console.error(error);
        showToast("Failed to create room", "error");
        btn.classList.remove('loading');
    }
});

// Join Room Modal
document.getElementById('btn-quick-join').addEventListener('click', () => {
    document.getElementById('join-modal').classList.add('active');
});

// Code Input Logic
const codeBoxes = document.querySelectorAll('.code-box');
codeBoxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
        if(e.target.value && i < codeBoxes.length - 1) codeBoxes[i+1].focus();
    });
    box.addEventListener('keydown', (e) => {
        if(e.key === 'Backspace' && !e.target.value && i > 0) codeBoxes[i-1].focus();
    });
});

document.getElementById('btn-join-submit').addEventListener('click', () => {
    const code = Array.from(codeBoxes).map(b => b.value).join('').toUpperCase();
    if (code.length === 6) {
        window.joinRoom(code);
    } else {
        codeBoxes.forEach(b => { if(!b.value) b.classList.add('error'); setTimeout(()=>b.classList.remove('error'),400); });
        showToast("Please enter a 6-character code.", "error");
    }
});


// --- NOTIFICATIONS SYSTEM ---
const notifPanel = document.getElementById('notif-panel');
const btnNotif = document.getElementById('btn-notifications');
const closeNotif = document.getElementById('close-notif');
const notifBadge = document.getElementById('notif-badge');

btnNotif.addEventListener('click', () => notifPanel.classList.add('open'));
closeNotif.addEventListener('click', () => notifPanel.classList.remove('open'));

function setupNotifications() {
    const q = query(collection(db, `notifications/${currentUser.uid}/items`), orderBy('timestamp', 'desc'), limit(50));
    
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('notif-list');
        const emptyState = list.querySelector('.empty-state');
        
        // Remove old nodes
        Array.from(list.children).forEach(c => {
            if (!c.classList.contains('empty-state')) c.remove();
        });
        
        if (snapshot.empty) {
            emptyState.style.display = 'flex';
            notifBadge.classList.add('hidden');
            return;
        }
        
        emptyState.style.display = 'none';
        
        let unreadCount = 0;
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.read) unreadCount++;
            
            const time = data.timestamp ? new Date(data.timestamp.toMillis()).toLocaleString() : 'Just now';
            
            const item = document.createElement('div');
            item.className = `notif-item ${data.read ? '' : 'unread'}`;
            item.innerHTML = `
                <div class="notif-header">
                    <span class="notif-title">${data.type.replace('_', ' ').toUpperCase()}</span>
                    <span class="notif-time">${time}</span>
                </div>
                <div class="notif-body">${data.message}</div>
            `;
            
            item.addEventListener('click', async () => {
                if (!data.read) {
                    await updateDoc(doc(db, `notifications/${currentUser.uid}/items/${docSnap.id}`), { read: true });
                }
                notifPanel.classList.remove('open');
            });
            
            list.appendChild(item);
        });
        
        if (unreadCount > 0) {
            notifBadge.innerText = unreadCount > 9 ? '9+' : unreadCount;
            notifBadge.classList.remove('hidden');
        } else {
            notifBadge.classList.add('hidden');
        }
    });
}
