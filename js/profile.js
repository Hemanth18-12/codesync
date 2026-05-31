import { auth, db, doc, getDoc, updateDoc, onAuthStateChanged } from './firebase-config.js';

let currentUser = null;
let userData = null;
let selectedTheme = 'vs-dark';
let photoBase64 = null;
let hasUnsavedChanges = false;

// DOM Elements
const btnSave = document.getElementById('btn-save');
const btnEditAvatar = document.getElementById('btn-edit-avatar');
const avatarInput = document.getElementById('avatar-input');
const profileAvatar = document.getElementById('profile-avatar');

// Toast helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠️';
    toast.innerHTML = `<span style="font-weight:bold;font-size:1.2rem">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

function markChanged() {
    if (!hasUnsavedChanges) {
        hasUnsavedChanges = true;
        btnSave.style.display = 'block';
        btnSave.classList.add('pulse');
    }
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
        if (userDoc.exists()) {
            userData = userDoc.data();
            populateUI(userData);
            generateHeatmap(userData.stats?.activityLog || []);
        }
    } catch (e) {
        console.error("Error fetching profile", e);
        showToast("Error fetching profile data", "error");
    }
});

function populateUI(data) {
    // Header
    document.getElementById('display-name-header').innerText = data.displayName;
    document.getElementById('email-header').innerText = currentUser.email;
    if (data.photoURL) {
        profileAvatar.src = data.photoURL;
        photoBase64 = data.photoURL;
    }

    // Form
    document.getElementById('input-name').value = data.displayName || '';
    document.getElementById('input-bio').value = data.bio || '';
    document.getElementById('input-github').value = data.githubUrl || '';
    document.getElementById('input-linkedin').value = data.linkedinUrl || '';

    // Badges
    const badgesContainer = document.getElementById('badges-container');
    if (data.stats && data.stats.streakDays > 5) {
        badgesContainer.innerHTML += `<span class="badge" style="background: rgba(245,158,11,0.1); color: var(--warning-color);">🔥 ${data.stats.streakDays} Day Streak</span>`;
    }

    // Preferences
    const prefs = data.preferences || { theme: 'vs-dark', fontSize: 14, minimap: true, wordWrap: true };
    document.getElementById('input-fontsize').value = prefs.fontSize;
    document.getElementById('input-minimap').checked = prefs.minimap;
    document.getElementById('input-wordwrap').checked = prefs.wordWrap !== false; // default true
    
    selectedTheme = prefs.theme;
    document.querySelectorAll('.theme-option').forEach(opt => {
        if (opt.dataset.theme === selectedTheme) opt.classList.add('selected');
        else opt.classList.remove('selected');
    });

    // Reset unsaved changes
    hasUnsavedChanges = false;
    btnSave.style.display = 'none';
    btnSave.classList.remove('pulse');
    
    // Attach change listeners to all inputs AFTER population
    attachChangeListeners();
}

function attachChangeListeners() {
    const inputs = ['input-name', 'input-bio', 'input-github', 'input-linkedin', 'input-fontsize', 'input-minimap', 'input-wordwrap'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('change', markChanged);
        if(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'checkbox') el.addEventListener('input', markChanged);
    });
}

// --- AVATAR UPLOAD ---
btnEditAvatar.addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        showToast("File too large. Maximum size is 5MB.", "error");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 256; const MAX_HEIGHT = 256;
            let width = img.width; let height = img.height;
            
            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            photoBase64 = canvas.toDataURL('image/jpeg', 0.8);
            profileAvatar.src = photoBase64;
            markChanged();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- THEME SELECTOR ---
document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedTheme = opt.dataset.theme;
        markChanged();
    });
});

// --- SAVE PROFILE ---
btnSave.addEventListener('click', async () => {
    btnSave.classList.add('loading');
    try {
        const updates = {
            displayName: document.getElementById('input-name').value.trim(),
            bio: document.getElementById('input-bio').value.trim(),
            githubUrl: document.getElementById('input-github').value.trim(),
            linkedinUrl: document.getElementById('input-linkedin').value.trim(),
            'preferences.theme': selectedTheme,
            'preferences.fontSize': parseInt(document.getElementById('input-fontsize').value),
            'preferences.minimap': document.getElementById('input-minimap').checked,
            'preferences.wordWrap': document.getElementById('input-wordwrap').checked
        };
        
        if (photoBase64) updates.photoURL = photoBase64;
        
        await updateDoc(doc(db, 'users', currentUser.uid), updates);
        
        document.getElementById('display-name-header').innerText = updates.displayName;
        showToast("Profile updated successfully");
        hasUnsavedChanges = false;
        btnSave.style.display = 'none';
        btnSave.classList.remove('pulse');
        
    } catch (e) {
        console.error("Save error", e);
        showToast("Failed to save profile", "error");
    } finally {
        btnSave.classList.remove('loading');
    }
});

// --- HEATMAP GENERATOR ---
function generateHeatmap(activityLog) {
    const grid = document.getElementById('heatmap');
    grid.innerHTML = '';
    
    // We want 90 days = ~13 weeks
    const cols = 13;
    const rows = 7;
    const totalDays = cols * rows; // 91 days
    
    // Mock mapping of dates to activity levels (0-4)
    // In production, you would parse `activityLog` which contains timestamps and calculate levels
    // For now, we'll generate a realistic looking distribution biased towards recent days
    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    // Create an array of the last 91 days
    for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
            const cellIndex = c * rows + r;
            const daysAgo = totalDays - 1 - cellIndex;
            
            const cellDate = new Date(today);
            cellDate.setDate(today.getDate() - daysAgo);
            
            // Random level logic
            let level = 0;
            // Higher chance of activity if it's a weekday
            const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
            const rand = Math.random();
            
            if (!isWeekend && rand > 0.3) {
                level = Math.floor(Math.random() * 4) + 1; // 1-4
            } else if (isWeekend && rand > 0.8) {
                level = Math.floor(Math.random() * 3) + 1; // 1-3
            }
            
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            cell.dataset.level = level;
            cell.title = `${cellDate.toLocaleDateString()}: ${level === 0 ? 'No' : level*3} contributions`;
            
            grid.appendChild(cell);
        }
    }
}
