import { 
    auth, db, rtdb, collection, doc, getDoc, getDocs, setDoc, updateDoc, 
    onSnapshot, query, where, orderBy, limit, startAfter, addDoc, serverTimestamp, 
    ref, set, onValue, onAuthStateChanged, signOut, increment, arrayUnion
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
            window.location.href = `editor.html?room=${roomId}`;
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
const loadExploreRooms = async () => {
  const exploreGrid = document.getElementById(
    'explore-grid');
  if (!exploreGrid) return;

  // Show skeleton loading cards
  exploreGrid.innerHTML = `
    ${Array(6).fill(`
      <div class="room-card skeleton">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
      </div>
    `).join('')}
  `;

  try {
    const user = auth.currentUser;

    // Query all public rooms from Firestore
    const publicRoomsQuery = query(
      collection(db, 'rooms'),
      where('isPublic', '==', true),
      orderBy('lastActive', 'desc'),
      limit(20)
    );

    const snapshot = await getDocs(
      publicRoomsQuery);

    // Clear skeleton
    exploreGrid.innerHTML = '';

    // Show empty state if no rooms
    if (snapshot.empty) {
      exploreGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🌍</div>
          <h3>No public rooms yet</h3>
          <p>Be the first to create a 
            public room!</p>
          <button onclick="openCreateModal()" 
            class="btn-primary">
            Create Public Room
          </button>
        </div>
      `;
      return;
    }

    // Render each public room card
    snapshot.forEach((docSnap) => {
      const room = docSnap.data();
      const roomId = docSnap.id;

      // Skip rooms owned by current user
      // (they appear in My Rooms already)
      const isOwner = room.owner === user?.uid;
      const isCollaborator = room.collaborators
        ?.some(c => c.userId === user?.uid);

      const card = document.createElement('div');
      card.className = 'room-card explore-card';
      card.style.animation = 
        'cardSlideIn 0.4s ease forwards';
      
      card.innerHTML = `
        <div class="room-card-header">
          <div class="room-info">
            <h3 class="room-name">
              ${room.name}
            </h3>
            <span class="language-badge 
              lang-${room.language}">
              ${room.language}
            </span>
          </div>
          <div class="room-status">
            <span class="live-dot"></span>
            <span class="live-count">
              ${room.activeUsers || 0} live
            </span>
          </div>
        </div>

        <div class="room-owner">
          <div class="owner-avatar">
            ${(room.ownerName || 'U')
              .charAt(0).toUpperCase()}
          </div>
          <span class="owner-name">
            by ${room.ownerName || 'Unknown'}
          </span>
        </div>

        <div class="room-meta">
          <span>
            👥 ${(room.collaborators?.length 
              || 0) + 1} members
          </span>
          <span>
            🕐 ${getRelativeTime(
              room.lastActive?.toDate())}
          </span>
        </div>

        <div class="room-card-footer">
          <span class="room-code">
            ID: ${room.roomCode}
          </span>
          ${isOwner || isCollaborator ? `
            <button 
              class="btn-primary open-room-btn"
              data-room-id="${roomId}">
              Open
            </button>
          ` : `
            <button 
              class="btn-primary join-explore-btn"
              data-room-id="${roomId}"
              data-room-code="${room.roomCode}">
              Join Room
            </button>
          `}
        </div>
      `;

      exploreGrid.appendChild(card);
    });

    // Handle Join buttons in explore
    document.querySelectorAll('.join-explore-btn')
      .forEach(btn => {
        btn.addEventListener('click', async () => {
          const rid = btn.dataset.roomId;
          btn.disabled = true;
          btn.textContent = 'Joining...';
          try {
            const user = auth.currentUser;
            await updateDoc(
              doc(db, 'rooms', rid), {
              collaborators: arrayUnion({
                userId: user.uid,
                userName: user.displayName 
                  || user.email,
                role: 'editor',
                joinedAt: new Date().toISOString()
              })
            });
            await updateDoc(
              doc(db, 'users', user.uid), {
              'stats.roomsJoined': increment(1)
            });
            showToast('Joined! Opening room...', 
              'success');
            setTimeout(() => {
              window.location.href = 
                `editor.html?room=${rid}`;
            }, 600);
          } catch (err) {
            showToast('Failed to join room', 
              'error');
            btn.disabled = false;
            btn.textContent = 'Join Room';
          }
        });
      });

  } catch (error) {
    console.error('Explore error:', error);
    exploreGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Failed to load rooms</h3>
        <p>${error.message}</p>
        <button onclick="loadExploreRooms()" 
          class="btn-primary">
          Try Again
        </button>
      </div>
    `;
  }
};

// Call when explore tab is clicked
const exploreNavItem = document.getElementById(
  'nav-explore');
if (exploreNavItem) {
  exploreNavItem.addEventListener('click', () => {
    loadExploreRooms();
  });
}

// Also call on load if explore section visible
if (document.getElementById('explore-section')
  ?.classList.contains('active')) {
  loadExploreRooms();
}

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
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        if (emptyState) emptyState.classList.add('hidden');

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
                    <button class="btn-secondary btn-sm" onclick="viewSnapshot('${docSnap.id}', '${encodeURIComponent(data.code || '')}')">View</button>
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

// Expose joinRoom globally so inline onclick and btn-join-submit can call it
window.joinRoom = async (roomCode) => {
  const joinSubmitBtn = document.getElementById('btn-join-submit');
  try {
    // Validate input
    if (!roomCode || roomCode.length !== 6) {
      showToast('Please enter a valid 6-character room code', 'error');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showToast('You must be logged in', 'error');
      return;
    }

    // Show loading on the modal submit button
    if (joinSubmitBtn) {
      joinSubmitBtn.disabled = true;
      joinSubmitBtn.querySelector('.btn-text').textContent = 'Joining...';
    }

    // Find room by roomCode in Firestore
    const roomsQuery = query(
      collection(db, 'rooms'),
      where('roomCode', '==', roomCode.toUpperCase())
    );
    const roomSnap = await getDocs(roomsQuery);

    // Check if room exists
    if (roomSnap.empty) {
      showToast('Room not found. Check the code.', 'error');
      // Shake the code boxes
      document.querySelectorAll('.code-box').forEach(box => {
        box.classList.add('error');
        setTimeout(() => box.classList.remove('error'), 500);
      });
      return;
    }

    const roomDoc = roomSnap.docs[0];
    const roomData = roomDoc.data();
    const roomId = roomDoc.id;

    // Check if user is already owner
    if (roomData.owner === user.uid || roomData.ownerId === user.uid) {
      window.location.href = `editor.html?room=${roomId}`;
      return;
    }

    // Check if already a collaborator
    const alreadyJoined = roomData.collaborators?.some(c => c.userId === user.uid);
    
    if (!alreadyJoined) {
      await updateDoc(doc(db, 'rooms', roomId), {
        collaborators: arrayUnion({
          userId: user.uid,
          userName: user.displayName || user.email,
          role: 'editor',
          joinedAt: new Date().toISOString()
        })
      });
      await updateDoc(doc(db, 'users', user.uid), {
        'stats.roomsJoined': increment(1)
      });
    }

    showToast('Joining room...', 'success');
    setTimeout(() => {
      window.location.href = `editor.html?room=${roomId}`;
    }, 500);

  } catch (error) {
    console.error('Join room error:', error);
    showToast('Failed to join: ' + error.message, 'error');
  } finally {
    if (joinSubmitBtn) {
      joinSubmitBtn.disabled = false;
      joinSubmitBtn.querySelector('.btn-text').textContent = 'Join Room';
    }
  }
};

// --- MODALS & FORMS ---
// Create Room
document.getElementById('btn-quick-create').addEventListener('click', () => {
    document.getElementById('create-modal').classList.add('active');
});

// Generate 6 char room code
const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const createRoom = async (roomName, language, isPublic) => {
  const createBtn = document.getElementById('btn-create-submit');
  try {
    if (createBtn) {
      createBtn.disabled = true;
      createBtn.querySelector('.btn-text').textContent = 'Creating...';
    }

    const user = auth.currentUser;
    if (!user) {
      showToast('You must be logged in', 'error');
      return;
    }

    // Generate unique 6-char room code
    const roomCode = generateRoomCode();
    const existing = await getDocs(
      query(collection(db, 'rooms'), where('roomCode', '==', roomCode))
    );
    const finalCode = existing.empty ? roomCode : generateRoomCode();

    // Create room document in Firestore
    const roomRef = await addDoc(collection(db, 'rooms'), {
      name: roomName,
      roomCode: finalCode,
      language: language || 'javascript',
      isPublic: isPublic,
      owner: user.uid,
      ownerId: user.uid,
      ownerName: userData?.displayName || user.displayName || user.email,
      collaborators: [],
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      activeUsers: 0,
      description: '',
      tags: []
    });

    // Update user stats in Firestore
    await updateDoc(doc(db, 'users', user.uid), {
      'stats.roomsCreated': increment(1)
    });

    // Close modal
    document.getElementById('create-modal').classList.remove('active');

    showToast('Room created! Redirecting...', 'success');
    setTimeout(() => {
      window.location.href = `editor.html?room=${roomRef.id}`;
    }, 600);

  } catch (error) {
    console.error('Create room error:', error);
    showToast('Failed to create room: ' + error.message, 'error');
  } finally {
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.querySelector('.btn-text').textContent = 'Create Room';
    }
  }
};

// Create room form submit handler — uses the correct element IDs from dashboard.html
const createRoomForm = document.getElementById('create-room-form');
if (createRoomForm) {
  createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const roomName = document.getElementById('new-room-name')?.value.trim();
    const language = document.getElementById('new-room-template')?.value || 'javascript';
    const isPublic = document.getElementById('new-room-public')?.checked ?? true;

    if (!roomName) {
      showToast('Please enter a room name', 'error');
      return;
    }
    if (roomName.length < 3) {
      showToast('Room name must be at least 3 characters', 'error');
      return;
    }

    await createRoom(roomName, language, isPublic);
  });
}

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
        codeBoxes.forEach(b => { if(!b.value) { b.classList.add('error'); setTimeout(()=>b.classList.remove('error'),400); } });
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
