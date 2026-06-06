import { 
    auth, db, rtdb, collection, doc, getDoc, getDocs, setDoc, updateDoc, 
    onSnapshot, query, where, orderBy, limit, startAfter, addDoc, serverTimestamp, 
    ref, set, onValue, onAuthStateChanged, signOut, increment, arrayUnion, deleteDoc
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
        if (activeView === 'my-rooms') loadMyRooms();
        if (activeView === 'joined-rooms') loadJoinedRooms();
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
  const btn = e.target.closest(
    '.open-room-btn, .btn-open, [data-action="open"]'
  );
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    const roomId = btn.getAttribute('data-room-id')
      || btn.dataset.roomId
      || btn.closest('[data-room-id]')
          ?.getAttribute('data-room-id');
    
    console.log('Opening room:', roomId);
    
    if (!roomId || roomId === 'undefined' 
        || roomId === 'null' || roomId === '') {
      showToast('Room ID not found', 'error');
      return;
    }
    window.location.href = 
      `editor.html?room=${roomId}`;
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
    const qOwner = query(
      collection(db, 'rooms'), 
      where('owner', '==', currentUser.uid)
    );
    // Note: collaborators is array of objects
    // so we query differently
    const qCollab = query(
      collection(db, 'rooms'),
      where('owner', '!=', currentUser.uid),
      limit(50)
    );
    
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
    if (source === 'collab') {
      recentCollabDocs = snapshot.docs.filter(d => {
        const data = d.data();
        // Skip own rooms
        if (data.owner === currentUser.uid) 
          return false;
        // Check if user is in collaborators
        return data.collaborators?.some(
          c => c.userId === currentUser.uid
        );
      });
    }
    
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
const loadSnapshots = async () => {
  const snapshotsList = 
    document.getElementById('snapshots-list')
    || document.getElementById('snapshot-list')
    || document.getElementById('snapshots-container')
    || document.querySelector('.snapshots-list');
  
  if (!snapshotsList) return;

  // Show loading skeleton
  snapshotsList.innerHTML = `
    <div class="loading-state">
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
    </div>
  `;

  try {
    const user = auth.currentUser;
    if (!user) return;

    // Get all rooms owned by user
    const roomsQuery = query(
      collection(db, 'rooms'),
      where('owner', '==', user.uid)
    );
    const roomsSnap = await getDocs(roomsQuery);

    let allSnapshots = [];

    // Get snapshots from each room
    for (const roomDoc of roomsSnap.docs) {
      const snapshotsRef = collection(
        db, 'rooms', roomDoc.id, 'snapshots'
      );
      const snapshotsSnap = await getDocs(
        snapshotsRef
      );
      
      snapshotsSnap.forEach((snap) => {
        allSnapshots.push({
          id: snap.id,
          roomId: roomDoc.id,
          roomName: roomDoc.data().name,
          language: roomDoc.data().language,
          ...snap.data()
        });
      });
    }

    // Sort by timestamp newest first
    allSnapshots.sort((a, b) => {
      const timeA = a.timestamp?.toMillis?.() 
        || a.timestamp || 0;
      const timeB = b.timestamp?.toMillis?.() 
        || b.timestamp || 0;
      return timeB - timeA;
    });

    // Show empty state
    if (allSnapshots.length === 0) {
      snapshotsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📸</div>
          <h3>No Snapshots Yet</h3>
          <p>Open a room and save a snapshot 
            to see it here</p>
          <button 
            class="btn-primary"
            onclick="showSection('my-rooms')">
            Go to My Rooms
          </button>
        </div>
      `;
      return;
    }

    // Render snapshots
    snapshotsList.innerHTML = '';
    allSnapshots.forEach((snap, index) => {
      const item = document.createElement('div');
      item.className = 'snapshot-item';
      item.style.animationDelay = 
        `${index * 50}ms`;
      item.classList.add('animate-in');

      const date = snap.timestamp
        ? new Date(
            snap.timestamp?.toMillis?.() 
            || snap.timestamp
          ).toLocaleDateString()
        : 'Unknown date';

      const preview = snap.code
        ? snap.code.substring(0, 80) + '...'
        : 'No preview available';

      item.innerHTML = `
        <div class="snapshot-header">
          <div class="snapshot-info">
            <h4 class="snapshot-label">
              ${snap.label || 'Snapshot'}
            </h4>
            <span class="snapshot-room">
              📁 ${snap.roomName || 'Unknown Room'}
            </span>
          </div>
          <span class="language-badge 
            lang-${snap.language}">
            ${snap.language || 'code'}
          </span>
        </div>
        <div class="snapshot-meta">
          <span>🕐 ${date}</span>
          <span>📝 ${snap.lineCount || 0} lines</span>
        </div>
        <div class="snapshot-preview">
          <code>${escapeHtml(preview)}</code>
        </div>
        <div class="snapshot-actions">
          <button 
            class="btn-secondary snapshot-view-btn"
            data-snapshot-id="${snap.id}"
            data-room-id="${snap.roomId}">
            👁 View
          </button>
          <button 
            class="btn-primary snapshot-restore-btn"
            data-snapshot-id="${snap.id}"
            data-room-id="${snap.roomId}"
            data-code="${encodeURIComponent(
              snap.code || '')}">
            ♻️ Restore
          </button>
          <button 
            class="btn-danger snapshot-delete-btn"
            data-snapshot-id="${snap.id}"
            data-room-id="${snap.roomId}">
            🗑️ Delete
          </button>
        </div>
      `;
      snapshotsList.appendChild(item);
    });

    // View snapshot handler
    document.querySelectorAll('.snapshot-view-btn')
      .forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.dataset.roomId;
        const snapId = btn.dataset.snapshotId;
        const snap = allSnapshots.find(
          s => s.id === snapId
        );
        if (snap) showSnapshotModal(snap);
      });
    });

    // Restore snapshot handler
    document.querySelectorAll(
      '.snapshot-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const roomId = btn.dataset.roomId;
        if (confirm(
          'Restore this snapshot? Current code will be replaced.')) {
          window.location.href = 
            `editor.html?room=${roomId}&restore=${btn.dataset.snapshotId}`;
        }
      });
    });

    // Delete snapshot handler
    document.querySelectorAll(
      '.snapshot-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this snapshot?')) 
          return;
        try {
          await deleteDoc(doc(
            db, 'rooms', btn.dataset.roomId,
            'snapshots', btn.dataset.snapshotId
          ));
          showToast('Snapshot deleted', 'success');
          loadSnapshots(); // Reload list
        } catch (err) {
          showToast('Failed to delete', 'error');
        }
      });
    });

  } catch (error) {
    console.error('Snapshots error:', error);
    snapshotsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Failed to load snapshots</h3>
        <p>${error.message}</p>
        <button 
          class="btn-primary"
          onclick="loadSnapshots()">
          Try Again
        </button>
      </div>
    `;
  }
};

// Show snapshot in modal
const showSnapshotModal = (snap) => {
  const modal = document.getElementById(
    'snapshot-modal')
    || createSnapshotModal();
  
  const codeEl = modal.querySelector(
    '#snapshot-modal-code');
  const titleEl = modal.querySelector(
    '#snapshot-modal-title');
  
  if (titleEl) titleEl.textContent = 
    snap.label || 'Snapshot';
  if (codeEl) codeEl.textContent = 
    snap.code || '';
  
  modal.classList.add('active');
};

const createSnapshotModal = () => {
  const modal = document.createElement('div');
  modal.id = 'snapshot-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" 
      style="max-width:800px;width:90%;">
      <div class="modal-header">
        <h2 id="snapshot-modal-title">
          Snapshot
        </h2>
        <button class="icon-btn" 
          onclick="document.getElementById(
          'snapshot-modal').classList
          .remove('active')">✕</button>
      </div>
      <div style="background:#0d0d0d;
        border-radius:8px;padding:1rem;
        overflow:auto;max-height:500px;">
        <pre><code id="snapshot-modal-code"
          style="color:#c0caf5;
          font-family:JetBrains Mono,monospace;
          font-size:13px;">
        </code></pre>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary"
          onclick="document.getElementById(
          'snapshot-modal').classList
          .remove('active')">
          Close
        </button>
        <button class="btn-primary"
          onclick="navigator.clipboard.writeText(
          document.getElementById(
          'snapshot-modal-code').textContent);
          showToast('Code copied!','success')">
          📋 Copy Code
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
};

// Call loadSnapshots when snapshots 
// section is clicked in sidebar
const snapshotsNavItem = 
  document.getElementById('nav-snapshots')
  || document.querySelector(
    '[data-section="snapshots"]');

if (snapshotsNavItem) {
  snapshotsNavItem.addEventListener(
    'click', loadSnapshots);
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
  return Math.floor(100000 + Math.random() * 900000).toString();
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

    // Show Success Modal
    const successModal = document.getElementById('room-success-modal');
    if (successModal) {
      document.getElementById('success-room-name').textContent = roomName;
      
      const codeDisplay = document.getElementById('success-room-code-display');
      codeDisplay.innerHTML = '';
      finalCode.split('').forEach(digit => {
        const box = document.createElement('div');
        box.className = 'code-box filled';
        box.textContent = digit;
        codeDisplay.appendChild(box);
      });
      
      successModal.classList.add('active');
      startConfetti();
      
      const shareUrl = `${window.location.origin}/editor.html?room=${roomRef.id}`;
      
      document.getElementById('btn-success-copy').onclick = () => {
        navigator.clipboard.writeText(finalCode);
        showToast('Room Code Copied!', 'success');
      };
      
      document.getElementById('btn-success-share').onclick = () => {
        successModal.classList.remove('active');
        openShareModal(roomName, finalCode, shareUrl);
      };
      
      document.getElementById('btn-success-open').onclick = () => {
        window.location.href = `editor.html?room=${roomRef.id}`;
      };
    } else {
      showToast('Room created! Redirecting...', 'success');
      setTimeout(() => {
        window.location.href = `editor.html?room=${roomRef.id}`;
      }, 600);
    }

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
        // Only allow digits
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
        if(e.target.value && i < codeBoxes.length - 1) codeBoxes[i+1].focus();
        
        // Auto submit if all 6 filled and this is the last one
        if(i === 5 && Array.from(codeBoxes).every(b => b.value)) {
            document.getElementById('btn-join-submit').click();
        }
    });
    box.addEventListener('keydown', (e) => {
        if(e.key === 'Backspace' && !e.target.value && i > 0) codeBoxes[i-1].focus();
    });
    box.addEventListener('paste', (e) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 6);
        if (pastedData) {
            const digits = pastedData.split('');
            for (let j = 0; j < digits.length; j++) {
                if (codeBoxes[j]) codeBoxes[j].value = digits[j];
            }
            if (digits.length === 6) {
                document.getElementById('btn-join-submit').click();
            } else if (codeBoxes[digits.length]) {
                codeBoxes[digits.length].focus();
            }
        }
    });
});

document.getElementById('btn-join-submit').addEventListener('click', () => {
    const code = Array.from(codeBoxes).map(b => b.value).join('');
    if (code.length === 6 && /^\d{6}$/.test(code)) {
        window.joinRoom(code);
    } else {
        codeBoxes.forEach(b => { if(!b.value) { b.classList.add('error'); setTimeout(()=>b.classList.remove('error'),400); } });
        showToast("Please enter a valid 6-digit code.", "error");
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

// --- MISSING BUTTON HANDLERS ---

// "Load More" button in Explore view
const btnLoadMore = document.getElementById('btn-load-more');
if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
        loadExploreRooms();
    });
}

// "Restore in Editor" button inside snapshot preview modal
// Reads the roomId stored on the last-clicked Restore button in the snapshot list
let _snapRestoreRoomId = null;
let _snapRestoreId = null;

// Override viewSnapshot to also capture roomId and snapId for Restore btn
window.viewSnapshot = (id, encodedCode, roomId) => {
    const code = decodeURIComponent(encodedCode);
    document.getElementById('snap-modal-code').innerText = code;
    document.getElementById('snap-modal').classList.add('active');
    _snapRestoreRoomId = roomId || null;
    _snapRestoreId = id || null;
};

const btnSnapRestore = document.getElementById('btn-snap-restore');
if (btnSnapRestore) {
    btnSnapRestore.addEventListener('click', () => {
        if (_snapRestoreRoomId && _snapRestoreId) {
            document.getElementById('snap-modal').classList.remove('active');
            window.location.href = `editor.html?room=${_snapRestoreRoomId}&restore=${_snapRestoreId}`;
        } else {
            showToast('Could not determine room for this snapshot.', 'error');
        }
    });
}

// --- MY ROOMS AND JOINED ROOMS DATA LOAD ---

async function loadMyRooms() {
  const user = auth.currentUser;
  if (!user) return;

  const grid = 
    document.getElementById('my-rooms-grid')
    || document.getElementById('rooms-grid')
    || document.getElementById('recent-rooms')
    || document.querySelector('.rooms-grid')
    || document.querySelector(
      '[id*="rooms"]');

  if (!grid) {
    console.error('Rooms grid not found');
    return;
  }

  // Show loading skeleton
  grid.innerHTML = `
    ${Array(3).fill(`
      <div style="
        background:#1a1b26;
        border-radius:12px;
        padding:16px;
        animation:shimmer 1.5s infinite;
      ">
        <div style="height:16px;
          background:#2d2f45;
          border-radius:4px;
          margin-bottom:8px;width:60%">
        </div>
        <div style="height:12px;
          background:#2d2f45;
          border-radius:4px;
          width:40%">
        </div>
      </div>
    `).join('')}
  `;

  try {
    // Query rooms where owner = current user
    const q = query(
      collection(db, 'rooms'),
      where('owner', '==', user.uid),
      limit(20)
    );

    // Use onSnapshot for REAL-TIME updates
    // so new rooms appear instantly
    onSnapshot(q, (snapshot) => {
      grid.innerHTML = '';

      if (snapshot.empty) {
        grid.innerHTML = `
          <div style="
            grid-column: 1/-1;
            text-align: center;
            padding: 40px 20px;
            color: #565f89;
          ">
            <div style="font-size:40px;
              margin-bottom:12px">
              🚪
            </div>
            <h3 style="color:#c0caf5;
              margin:0 0 8px">
              No rooms yet
            </h3>
            <p style="margin:0 0 16px;
              font-size:14px">
              Create your first room to start
            </p>
            <button 
              onclick="openCreateRoomModal()"
              style="
                background:#7aa2f7;
                color:#1a1b26;
                border:none;
                padding:8px 20px;
                border-radius:8px;
                cursor:pointer;
                font-weight:600;
              ">
              + Create Room
            </button>
          </div>
        `;
        return;
      }

      snapshot.forEach((docSnap) => {
        const room = docSnap.data();
        const roomId = docSnap.id; 
        // ← MUST use docSnap.id
        // NOT room.id or room.roomCode

        const card = document.createElement(
          'div');
        card.className = 'room-card';
        card.style.cssText = `
          background: #1a1b26;
          border: 1px solid #2d2f45;
          border-radius: 12px;
          padding: 16px;
          transition: all 0.2s;
          cursor: pointer;
          animation: cardIn 0.3s ease;
        `;

        const langColors = {
          javascript: '#F7DF1E',
          typescript: '#3178C6',
          python:     '#3776AB',
          java:       '#ED8B00',
          cpp:        '#00599C',
          html:       '#E34F26',
          css:        '#1572B6',
          go:         '#00ADD8',
          rust:       '#CE422B'
        };

        const langColor = 
          langColors[room.language] 
          || '#7aa2f7';

        card.innerHTML = `
          <div style="display:flex;
            justify-content:space-between;
            align-items:flex-start;
            margin-bottom:12px;">
            <h3 style="margin:0;
              color:#c0caf5;
              font-size:15px;
              font-weight:600;
              overflow:hidden;
              text-overflow:ellipsis;
              white-space:nowrap;
              max-width:70%;">
              ${room.name || 'Untitled'}
            </h3>
            <span style="
              background:${langColor}20;
              color:${langColor};
              border:1px solid ${langColor}40;
              padding:2px 8px;
              border-radius:12px;
              font-size:11px;
              font-weight:600;
              white-space:nowrap;
            ">
              ${room.language || 'code'}
            </span>
          </div>

          <div style="display:flex;
            gap:16px;
            margin-bottom:12px;
            font-size:12px;
            color:#565f89;">
            <span>
              👥 ${(room.collaborators
                ?.length || 0) + 1} members
            </span>
            <span style="
              display:flex;
              align-items:center;
              gap:4px;">
              <span style="
                width:6px;height:6px;
                border-radius:50%;
                background:#9ece6a;
                display:inline-block;
                animation:pulse 2s infinite;">
              </span>
              ${room.activeUsers || 0} live
            </span>
          </div>

          <div style="display:flex;
            justify-content:space-between;
            align-items:center;">
            <span style="
              font-size:11px;
              color:#565f89;
              font-family:'JetBrains Mono';
            ">
              ID: ${room.roomCode || roomId
                .substring(0,6).toUpperCase()}
            </span>
            <button 
              class="open-room-btn"
              data-room-id="${roomId}"
              style="
                background:#7aa2f7;
                color:#1a1b26;
                border:none;
                padding:6px 16px;
                border-radius:8px;
                cursor:pointer;
                font-weight:600;
                font-size:13px;
                transition:all 0.2s;
              "
              onmouseover="this.style.transform=
                'translateY(-2px)';
                this.style.boxShadow=
                '0 4px 12px rgba(122,162,247,0.4)'"
              onmouseout="this.style.transform='';
                this.style.boxShadow=''">
              Open →
            </button>
          </div>
        `;

        // Open room on button click
        const openBtn = card.querySelector(
          '.open-room-btn');
        openBtn.addEventListener('click', 
          (e) => {
          e.stopPropagation();
          const rid = openBtn.getAttribute(
            'data-room-id');
          if (rid) {
            window.location.href = 
              `editor.html?room=${rid}`;
          }
        });

        // Also click card = open room
        card.addEventListener('click', () => {
          window.location.href = 
            `editor.html?room=${roomId}`;
        });

        card.addEventListener('mouseenter', 
          () => {
          card.style.borderColor = '#7aa2f7';
          card.style.transform = 
            'translateY(-3px)';
          card.style.boxShadow = 
            '0 8px 24px rgba(122,162,247,0.15)';
        });
        card.addEventListener('mouseleave', 
          () => {
          card.style.borderColor = '#2d2f45';
          card.style.transform = '';
          card.style.boxShadow = '';
        });

        grid.appendChild(card);
      });
    });

  } catch (error) {
    console.error('Load rooms error:', error);
    grid.innerHTML = `
      <div style="
        grid-column:1/-1;
        text-align:center;
        padding:40px;
        color:#565f89;
      ">
        <p>⚠ Failed to load rooms</p>
        <p style="font-size:12px">
          ${error.message}
        </p>
        <button 
          onclick="loadMyRooms()"
          style="background:#7aa2f7;
          color:#1a1b26;border:none;
          padding:8px 20px;border-radius:8px;
          cursor:pointer;margin-top:12px;">
          Try Again
        </button>
      </div>
    `;
  }
}

window.deleteRoom = async (roomId) => {
    if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, 'rooms', roomId));
        showToast('Room deleted successfully.', 'success');
        loadMyRooms();
        loadOverviewData(); // Update stats
    } catch (error) {
        console.error("Error deleting room:", error);
        showToast('Failed to delete room.', 'error');
    }
};

async function loadJoinedRooms() {
    const grid = document.getElementById('joined-rooms-grid');
    const emptyState = document.getElementById('empty-joined-rooms');
    if (!grid) return;

    // Remove existing cards
    Array.from(grid.children).forEach(c => {
        if (c.id !== 'empty-joined-rooms') c.remove();
    });

    try {
        const q = query(collection(db, 'rooms'), orderBy('lastActive', 'desc'));
        const snapshot = await getDocs(q);

        let joinedCount = 0;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const roomId = docSnap.id;
            
            // Check if user is in collaborators array and NOT the owner
            const isCollaborator = data.collaborators?.some(c => c.userId === currentUser.uid);
            if (!isCollaborator || data.owner === currentUser.uid) return;

            joinedCount++;
            
            const card = document.createElement('div');
            card.className = 'room-card glass-card';
            card.innerHTML = `
                <div class="room-card-header" style="justify-content: space-between;">
                    <div class="room-title-wrapper">
                        <div class="room-title">${data.name}</div>
                        <div class="room-lang"><span class="lang-dot" style="background: var(--primary-color)"></span> ${data.language || 'Mixed'}</div>
                    </div>
                </div>
                <div class="room-owner" style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--text-muted);">
                    By ${data.ownerName || 'Unknown'}
                </div>
                <div class="room-stats" style="margin-bottom: 1rem;">
                    <span>👥 ${data.collaborators?.length || 1} members</span>
                    <span class="active-users"><div class="dot"></div> <span id="joined-active-${roomId}">0</span> live</span>
                </div>
                <div class="room-card-footer" style="flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end;">
                    <button class="btn-danger btn-sm" onclick="leaveRoom('${roomId}')">Leave</button>
                    <button class="btn-primary btn-sm open-room-btn" data-room-id="${roomId}">Open</button>
                </div>
            `;
            grid.appendChild(card);

            // Bind active users
            onValue(ref(rtdb, `rooms/${roomId}/activeUsers`), (snap) => {
                const el = document.getElementById(`joined-active-${roomId}`);
                if (el) el.innerText = snap.exists() ? Object.keys(snap.val()).length : 0;
            });
        });

        if (joinedCount === 0) {
            if (emptyState) emptyState.style.display = 'flex';
        } else {
            if (emptyState) emptyState.style.display = 'none';
        }

    } catch (error) {
        console.error("Error loading joined rooms:", error);
    }
}

window.leaveRoom = async (roomId) => {
    if (!confirm('Are you sure you want to leave this room?')) return;
    try {
        const roomDoc = await getDoc(doc(db, 'rooms', roomId));
        if (roomDoc.exists()) {
            const data = roomDoc.data();
            const newCollaborators = (data.collaborators || []).filter(c => c.userId !== currentUser.uid);
            await updateDoc(doc(db, 'rooms', roomId), { collaborators: newCollaborators });
            
            // Update user stat
            await updateDoc(doc(db, 'users', currentUser.uid), {
                'stats.roomsJoined': increment(-1)
            });

            showToast('You left the room.', 'success');
            loadJoinedRooms();
            loadOverviewData(); // Update stats
        }
    } catch (error) {
        console.error("Error leaving room:", error);
        showToast('Failed to leave room.', 'error');
    }
};

// --- SHARE MODAL AND CONFETTI ---
window.openShareModal = (roomName, code, url) => {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    
    document.getElementById('share-room-name').textContent = roomName;
    document.getElementById('share-room-code').textContent = code;
    document.getElementById('share-room-url').value = url;
    
    document.getElementById('btn-share-copy-code').onclick = () => {
        navigator.clipboard.writeText(code);
        showToast('Room code copied!', 'success');
    };
    
    document.getElementById('btn-share-copy-url').onclick = () => {
        navigator.clipboard.writeText(url);
        showToast('URL copied to clipboard!', 'success');
    };
    
    document.getElementById('share-wa').onclick = () => {
        const text = encodeURIComponent(`🚀 Join me on CodeSync!\n\nRoom: ${roomName}\nCode: ${code}\n\nJoin here: ${url}\n\nCodeSync — Real-time collaborative code editor`);
        window.open(`https://wa.me/?text=${text}`, '_blank');
    };
    
    document.getElementById('share-tg').onclick = () => {
        const text = encodeURIComponent(`🚀 Join my CodeSync room!\nRoom: ${roomName} | Code: ${code}`);
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`, '_blank');
    };
    
    document.getElementById('share-tw').onclick = () => {
        const text = encodeURIComponent(`Coding together on CodeSync! 🚀\nRoom: ${roomName} | Code: ${code}\nJoin me: ${url}\n#CodeSync #Coding #Collaboration`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
    };
    
    document.getElementById('share-li').onclick = () => {
        window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank');
    };
    
    document.getElementById('share-em').onclick = () => {
        const subject = encodeURIComponent(`Join my CodeSync Room: ${roomName}`);
        const body = encodeURIComponent(`Hi!\n\nI'd like to invite you to collaborate on CodeSync.\n\nRoom Name: ${roomName}\nRoom Code: ${code}\nDirect Link: ${url}\n\nSteps to join:\n1. Go to ${window.location.origin}\n2. Sign in or create account\n3. Enter room code: ${code}\n\nSee you there! 🚀`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
    };
    
    document.getElementById('share-ig').onclick = () => {
        navigator.clipboard.writeText(`🚀 Join my CodeSync room!\nRoom Code: ${code}\nDownload and join at: ${window.location.origin}`);
        showToast('📋 Copied for Instagram! Paste in your story or DM', 'success');
    };
    
    const qrContainer = document.getElementById('qr-container');
    const qrCodeEl = document.getElementById('qrcode');
    qrContainer.style.display = 'none';
    
    document.getElementById('share-qr').onclick = () => {
        if (qrContainer.style.display === 'none') {
            qrContainer.style.display = 'flex';
            qrCodeEl.innerHTML = '';
            new QRCode(qrCodeEl, {
                text: url,
                width: 150,
                height: 150
            });
        } else {
            qrContainer.style.display = 'none';
        }
    };
    
    document.getElementById('btn-download-qr').onclick = () => {
        const img = qrCodeEl.querySelector('img');
        if (img && img.src) {
            const a = document.createElement('a');
            a.href = img.src;
            a.download = `CodeSync-Room-${code}.png`;
            a.click();
        } else {
            const canvas = qrCodeEl.querySelector('canvas');
            if (canvas) {
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `CodeSync-Room-${code}.png`;
                a.click();
            }
        }
    };
    
    modal.classList.add('active');
};

function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    
    const particles = [];
    const colors = ['#f97316', '#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68'];
    for(let i=0; i<100; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            r: Math.random() * 6 + 2,
            dx: Math.random() * 4 - 2,
            dy: Math.random() * 5 + 2,
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }
    
    let animationId;
    let startTime = Date.now();
    function animate() {
        if (Date.now() - startTime > 2000) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            cancelAnimationFrame(animationId);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.x += p.dx;
            p.y += p.dy;
            if(p.y > canvas.height) { p.y = 0; p.x = Math.random() * canvas.width; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
            ctx.fillStyle = p.color;
            ctx.fill();
        });
        animationId = requestAnimationFrame(animate);
    }
    animate();
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    loadMyRooms();
    if (typeof loadJoinedRooms === 'function') {
      loadJoinedRooms();
    }
  }
});
