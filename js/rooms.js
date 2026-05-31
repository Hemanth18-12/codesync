import { 
    db, rtdb,
    doc, getDoc, updateDoc, addDoc, collection, serverTimestamp,
    ref, set, push
} from './firebase-config.js';

let roomId, currentUser, roomData;

export function initRoomTools(rId, user, rData) {
    roomId = rId;
    currentUser = user;
    roomData = rData;

    setupRoomToolsUI();
}

function setupRoomToolsUI() {
    // Snapshot Button
    const btnSnapshot = document.getElementById('btn-snapshot');
    if (btnSnapshot) {
        btnSnapshot.addEventListener('click', saveSnapshot);
    }

    // Leave Room Button (already handled in editor.js but cross-check)
    const btnLeave = document.getElementById('btn-leave');
    if (btnLeave) {
        btnLeave.addEventListener('click', async () => {
            if (confirm('Leave this room?')) {
                await handleLeaveRoom();
                window.location.href = 'dashboard.html';
            }
        });
    }

    // Online / Offline Detection
    window.addEventListener('offline', () => {
        showEditorToast("⚠ Connection lost. Changes may not sync.", 'warning');
        const btnRun = document.getElementById('btn-run');
        const btnSend = document.getElementById('btn-send-chat');
        if (btnRun) btnRun.disabled = true;
        if (btnSend) btnSend.disabled = true;
    });

    window.addEventListener('online', () => {
        showEditorToast("✅ Back online!", 'success');
        const btnRun = document.getElementById('btn-run');
        const btnSend = document.getElementById('btn-send-chat');
        if (btnRun) btnRun.disabled = false;
        if (btnSend) btnSend.disabled = false;
    });

    // Keyboard Shortcuts for panels
    document.addEventListener('keydown', handleGlobalShortcuts);

    // Console resize handle
    setupConsoleResize();
}

function handleGlobalShortcuts(e) {
    const ctrlOrCmd = e.ctrlKey || e.metaKey;

    if (ctrlOrCmd && e.key === 'k') {
        e.preventDefault();
        const panelRight = document.getElementById('panel-right');
        if (panelRight) panelRight.classList.toggle('collapsed');
    }

    if (ctrlOrCmd && e.key === 'b') {
        e.preventDefault();
        const panelLeft = document.getElementById('panel-left');
        if (panelLeft) panelLeft.classList.toggle('collapsed');
    }

    if (ctrlOrCmd && e.key === '`') {
        e.preventDefault();
        const consolePanel = document.getElementById('console-panel');
        if (consolePanel) consolePanel.classList.toggle('collapsed');
    }

    if (e.key === 'F11') {
        e.preventDefault();
        document.getElementById('btn-fullscreen')?.click();
    }

    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        document.getElementById('settings-menu')?.classList.add('hidden');
    }
}

async function saveSnapshot() {
    const btn = document.getElementById('btn-snapshot');
    if (!btn) return;

    const editorInstance = getEditorInstance();
    if (!editorInstance) {
        showEditorToast("Editor not ready", 'error');
        return;
    }

    const code = editorInstance.getValue();
    const label = prompt("Snapshot label (optional):", `Snapshot ${formatDate(new Date())}`);
    if (label === null) return; // User cancelled

    btn.textContent = '⏳';
    btn.disabled = true;

    try {
        const snapshotsRef = collection(db, 'rooms', roomId, 'snapshots');
        await addDoc(snapshotsRef, {
            code: code,
            language: roomData.language,
            savedBy: currentUser.uid,
            savedByName: getUserName(),
            timestamp: serverTimestamp(),
            label: label || `Snapshot ${formatDate(new Date())}`
        });

        // Notify the room via RTDB chat
        const chatRef = ref(rtdb, `rooms/${roomId}/chat`);
        await push(chatRef, {
            text: `📸 Snapshot saved by ${getUserName()}`,
            type: 'system',
            timestamp: Date.now()
        });

        showEditorToast("📸 Snapshot saved!");
    } catch (err) {
        console.error("Snapshot error:", err);
        showEditorToast("Failed to save snapshot", 'error');
    } finally {
        btn.textContent = '📸';
        btn.disabled = false;
    }
}

async function handleLeaveRoom() {
    if (!roomData || !currentUser) return;

    // If not the owner, remove from collaborators
    if (roomData.ownerId !== currentUser.uid) {
        const roomRef = doc(db, 'rooms', roomId);
        const updatedCollabs = (roomData.collaborators || []).filter(uid => uid !== currentUser.uid);
        await updateDoc(roomRef, { collaborators: updatedCollabs });
    }

    // Remove presence from RTDB
    const presenceRef = ref(rtdb, `rooms/${roomId}/activeUsers/${currentUser.uid}`);
    await set(presenceRef, null);
}

// --- Room Code Utilities ---
export async function generateUniqueCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code, exists = true;

    while (exists) {
        code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        // Check if code already exists in Firestore
        const snap = await getDoc(doc(db, 'rooms', code));
        exists = snap.exists();
    }

    return code;
}

export function generateShareURL(code) {
    const base = window.location.origin + window.location.pathname.replace('editor.html', '');
    return `${base}editor.html?room=${code}`;
}

// --- Console Resize ---
function setupConsoleResize() {
    const handle = document.getElementById('console-resize');
    const consolePanel = document.getElementById('console-panel');
    if (!handle || !consolePanel) return;

    let isResizing = false;
    let startY, startH;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startH = consolePanel.offsetHeight;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = startY - e.clientY;
        const newH = Math.max(80, Math.min(400, startH + delta));
        consolePanel.style.height = `${newH}px`;
        consolePanel.classList.remove('collapsed');
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

// --- Helpers ---
function getUserName() {
    return window._currentUserData?.fullName?.split(' ')[0] || 'A user';
}

function getEditorInstance() {
    return window._monacoEditor || null;
}

function formatDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function showEditorToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { if (container.contains(toast)) toast.remove(); }, 4000);
}
