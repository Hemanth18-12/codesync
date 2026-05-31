import { 
    auth, db,
    onAuthStateChanged, signOut,
    doc, getDoc, updateDoc, collection, query, where, getDocs, deleteDoc,
    serverTimestamp
} from './firebase-config.js';

import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    deleteUser
} from 'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js';

let currentUser = null;
let userData = null;

document.addEventListener('DOMContentLoaded', () => {
    // Auth guard
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'auth.html';
            return;
        }
        currentUser = user;
        await loadProfile(user.uid);
        setupSidebar();
        setupEventListeners();
        generateHeatmap();
    });
});

async function loadProfile(uid) {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    userData = snap.data();

    // Update UI
    document.getElementById('user-avatar').textContent = userData.avatar.initials;
    document.getElementById('user-avatar').style.backgroundColor = userData.avatar.color;
    document.getElementById('user-name').textContent = userData.fullName;
    document.getElementById('user-email').textContent = userData.email;

    document.getElementById('profile-avatar').textContent = userData.avatar.initials;
    document.getElementById('profile-avatar').style.backgroundColor = userData.avatar.color;
    document.getElementById('hero-name').textContent = userData.fullName;
    document.getElementById('hero-email').textContent = userData.email;

    // Member since
    const since = userData.createdAt?.toDate?.() || new Date();
    document.getElementById('hero-since').textContent = since.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // Form fields
    document.getElementById('pf-name').value = userData.fullName || '';
    document.getElementById('pf-bio').value = userData.bio || '';
    document.getElementById('pf-github').value = userData.githubUrl || '';
    document.getElementById('pf-linkedin').value = userData.linkedinUrl || '';

    // Stats
    document.getElementById('ps-created').textContent = userData.stats?.roomsCreated || 0;
    document.getElementById('ps-sessions').textContent = userData.stats?.totalSessions || 0;
    document.getElementById('ps-lines').textContent = (userData.stats?.linesWritten || 0).toLocaleString();
    document.getElementById('ps-joined').textContent = userData.stats?.roomsJoined || 0;

    // Preferences
    const prefs = userData.preferences || {};
    document.documentElement.setAttribute('data-theme', prefs.theme || 'dark');

    const fontSlider = document.getElementById('pref-font-size');
    fontSlider.value = prefs.fontSize || 14;
    document.getElementById('font-size-val').textContent = prefs.fontSize || 14;

    document.getElementById('pref-autosave').checked = prefs.autoSave !== false;

    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === (prefs.theme || 'dark'));
    });

    // Tab size buttons
    document.querySelectorAll('.tab-size-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.size) === (prefs.tabSize || 2));
    });

    // Load recent rooms
    await loadRecentRooms();
}

async function loadRecentRooms() {
    const container = document.getElementById('quick-rooms');
    if (!userData.rooms || userData.rooms.length === 0) {
        container.innerHTML = '<p class="text-muted text-sm">No rooms yet.</p>';
        return;
    }

    const recentIds = userData.rooms.slice(-5).reverse();
    container.innerHTML = '';

    for (const roomId of recentIds) {
        try {
            const roomSnap = await getDoc(doc(db, 'rooms', roomId));
            if (!roomSnap.exists()) continue;
            const room = roomSnap.data();

            const item = document.createElement('div');
            item.className = 'quick-room-item';
            item.innerHTML = `
                <div>
                    <div class="qr-name">${room.name}</div>
                    <div class="qr-meta">${room.language} • ${roomId}</div>
                </div>
                <a href="editor.html?room=${roomId}" class="btn-primary" style="padding:4px 12px;font-size:0.8rem;">Open</a>
            `;
            container.appendChild(item);
        } catch (e) {
            console.error("Failed to load room", roomId, e);
        }
    }
}

function generateHeatmap() {
    const grid = document.getElementById('heatmap-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Generate 12 weeks × 7 days = 84 cells
    for (let w = 0; w < 12; w++) {
        const week = document.createElement('div');
        week.className = 'heatmap-week';
        for (let d = 0; d < 7; d++) {
            const cell = document.createElement('div');
            // Random activity levels weighted toward low
            const rand = Math.random();
            let level = 0;
            if (rand > 0.7) level = 1;
            if (rand > 0.85) level = 2;
            if (rand > 0.93) level = 3;
            if (rand > 0.97) level = 4;
            cell.className = `hm-cell l${level}`;
            cell.title = `${level > 0 ? level * 2 : 0} sessions`;
            week.appendChild(cell);
        }
        grid.appendChild(week);
    }
}

function setupSidebar() {
    const collapseBtn = document.getElementById('collapse-btn');
    const sidebar = document.getElementById('sidebar');
    collapseBtn?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'auth.html';
    });

    // Intersection Observer for animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

function setupEventListeners() {
    // Avatar color picker toggle
    const profileAvatar = document.getElementById('profile-avatar');
    const colorRow = document.getElementById('color-picker-row');
    const btnPickColor = document.getElementById('btn-pick-color');

    btnPickColor?.addEventListener('click', () => colorRow.classList.toggle('visible'));

    colorRow.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', async (e) => {
            const color = e.target.dataset.color;
            profileAvatar.style.backgroundColor = color;
            document.getElementById('user-avatar').style.backgroundColor = color;
            colorRow.classList.remove('visible');

            try {
                await updateDoc(doc(db, 'users', currentUser.uid), {
                    'avatar.color': color
                });
                showToast("Avatar color updated!");
            } catch (err) {
                showToast("Failed to update color", 'error');
            }
        });
    });

    // Profile Form Submit
    document.getElementById('profile-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save-profile');
        btn.classList.add('loading');

        const name = document.getElementById('pf-name').value.trim();
        const bio = document.getElementById('pf-bio').value.trim();
        const github = document.getElementById('pf-github').value.trim();
        const linkedin = document.getElementById('pf-linkedin').value.trim();

        if (!name) { showToast("Name is required", 'error'); btn.classList.remove('loading'); return; }

        const newInitials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                fullName: name,
                bio: bio,
                githubUrl: github,
                linkedinUrl: linkedin,
                'avatar.initials': newInitials
            });

            document.getElementById('hero-name').textContent = name;
            document.getElementById('user-name').textContent = name;
            document.getElementById('profile-avatar').textContent = newInitials;
            document.getElementById('user-avatar').textContent = newInitials;

            showToast("Profile saved successfully!");
        } catch (err) {
            showToast("Failed to save profile", 'error');
        } finally {
            btn.classList.remove('loading');
        }
    });

    // Preferences
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            document.documentElement.setAttribute('data-theme', e.target.dataset.theme);
        });
    });

    document.querySelectorAll('.tab-size-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-size-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    document.getElementById('pref-font-size').addEventListener('input', (e) => {
        document.getElementById('font-size-val').textContent = e.target.value;
    });

    document.getElementById('btn-save-prefs').addEventListener('click', async () => {
        const theme = document.querySelector('.theme-btn.active')?.dataset.theme || 'dark';
        const fontSize = parseInt(document.getElementById('pref-font-size').value);
        const tabSize = parseInt(document.querySelector('.tab-size-btn.active')?.dataset.size || '2');
        const autoSave = document.getElementById('pref-autosave').checked;

        try {
            await updateDoc(doc(db, 'users', currentUser.uid), {
                preferences: { theme, fontSize, tabSize, autoSave }
            });
            showToast("Preferences saved!");
        } catch (err) {
            showToast("Failed to save preferences", 'error');
        }
    });

    // Password Form
    document.getElementById('password-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-change-pw');
        btn.classList.add('loading');

        const current = document.getElementById('pw-current').value;
        const newPw = document.getElementById('pw-new').value;
        const confirm = document.getElementById('pw-confirm').value;

        if (newPw.length < 8) { showToast("New password must be at least 8 characters", 'error'); btn.classList.remove('loading'); return; }
        if (newPw !== confirm) { showToast("Passwords do not match", 'error'); btn.classList.remove('loading'); return; }

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, current);
            await reauthenticateWithCredential(currentUser, credential);
            await updatePassword(currentUser, newPw);
            showToast("Password updated successfully!");
            document.getElementById('password-form').reset();
        } catch (err) {
            if (err.code === 'auth/wrong-password') showToast("Current password is incorrect", 'error');
            else showToast(err.message || "Failed to update password", 'error');
        } finally {
            btn.classList.remove('loading');
        }
    });

    // Delete Account
    document.getElementById('btn-delete-account').addEventListener('click', () => {
        document.getElementById('delete-modal').classList.add('active');
    });
    document.getElementById('btn-cancel-delete').addEventListener('click', () => {
        document.getElementById('delete-modal').classList.remove('active');
    });
    document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
        const email = document.getElementById('delete-confirm-email').value;
        const pw = document.getElementById('delete-confirm-pw').value;

        if (email !== currentUser.email) { showToast("Email does not match", 'error'); return; }
        if (!pw) { showToast("Password is required", 'error'); return; }

        try {
            const credential = EmailAuthProvider.credential(currentUser.email, pw);
            await reauthenticateWithCredential(currentUser, credential);

            // Delete all user's rooms
            const roomsQuery = query(collection(db, 'rooms'), where('ownerId', '==', currentUser.uid));
            const roomsSnap = await getDocs(roomsQuery);
            const deletes = roomsSnap.docs.map(d => deleteDoc(d.ref));
            await Promise.all(deletes);

            // Delete user doc
            await deleteDoc(doc(db, 'users', currentUser.uid));

            // Delete auth account
            await deleteUser(currentUser);

            window.location.href = 'index.html';
        } catch (err) {
            if (err.code === 'auth/wrong-password') showToast("Wrong password", 'error');
            else showToast(err.message || "Failed to delete account", 'error');
        }
    });
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (container.contains(toast)) toast.remove(); }, 4000);
}
