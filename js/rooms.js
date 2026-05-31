import { 
    db, rtdb, doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, 
    ref, onValue, set, onDisconnect, push, update as rtdbUpdate, remove
} from './firebase-config.js';
import { 
    editorInstance, currentUser, currentRoomId, setEditorContent, 
    setReadOnly, hideLoading, updateTabsUI, activeFile
} from './editor.js';
import { appendSystemMessage } from './chat.js';
import { localFilesMap, saveToLocalFile } from './file-system.js';

let roomData = null;
let isOwner = false;
let ignoreNextChange = false;
let activeUsersRef = null;
let cursorsRef = null;
let cursorsMap = new Map(); // uid -> decoration ids

const statusConnection = document.getElementById('status-connection');
const statusError = document.getElementById('status-error');
const activeUsersBar = document.getElementById('active-users-bar');

// --- INIT ROOM ---
window.addEventListener('monaco-ready', async () => {
    if (!currentRoomId || !currentUser) return;
    
    try {
        const roomDoc = await getDoc(doc(db, 'rooms', currentRoomId));
        if (!roomDoc.exists()) {
            alert("Room does not exist.");
            window.location.href = 'dashboard.html';
            return;
        }
        
        roomData = roomDoc.data();
        isOwner = roomData.ownerId === currentUser.uid;
        
        document.getElementById('room-name').innerText = roomData.name;
        
        // Handle Permissions & Locks
        if (roomData.isLocked && !roomData.collaborators.includes(currentUser.uid)) {
            alert("This room is locked by the owner.");
            window.location.href = 'dashboard.html';
            return;
        }
        
        const permission = roomData.permissions?.[currentUser.uid] || 'viewer';
        if (permission === 'viewer' && !isOwner) {
            setReadOnly(true);
        }

        setupPresence();
        setupWorkspaceSync();
        setupSettingsModal();
        
    } catch (e) {
        console.error("Failed to load room", e);
        statusError.style.display = 'flex';
        statusConnection.style.display = 'none';
        hideLoading();
    }
});

// --- PRESENCE SYSTEM ---
function setupPresence() {
    const connectedRef = ref(rtdb, '.info/connected');
    activeUsersRef = ref(rtdb, `rooms/${currentRoomId}/activeUsers/${currentUser.uid}`);
    
    // Fast name/avatar fetch from DOM header
    const bgImage = document.querySelector('.header-avatar')?.style.backgroundImage;
    const photoURL = bgImage ? bgImage.slice(5, -2) : 'assets/default-avatar.png';
    const name = document.getElementById('welcome-msg')?.innerText.split(', ')[1] || 'User';

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            statusConnection.style.display = 'flex';
            statusError.style.display = 'none';
            
            // Set disconnect hooks
            onDisconnect(activeUsersRef).remove();
            if(cursorsRef) onDisconnect(ref(rtdb, `rooms/${currentRoomId}/cursors/${currentUser.uid}`)).remove();
            
            // Set active
            set(activeUsersRef, { name, photoURL, color: getRandomColor() });
        } else {
            statusConnection.style.display = 'none';
            statusError.style.display = 'flex';
        }
    });
    
    // Listen for all users to update header bar
    onValue(ref(rtdb, `rooms/${currentRoomId}/activeUsers`), (snap) => {
        activeUsersBar.innerHTML = '';
        if (!snap.exists()) return;
        
        snap.forEach(child => {
            const u = child.val();
            const div = document.createElement('div');
            div.className = 'user-avatar-mini';
            div.style.backgroundImage = `url('${u.photoURL}')`;
            div.style.borderColor = u.color;
            div.title = u.name;
            activeUsersBar.appendChild(div);
        });
    });
}

// --- WORKSPACE SYNC ---
function setupWorkspaceSync() {
    const workspaceRef = ref(rtdb, `rooms/${currentRoomId}/workspace`);
    
    onValue(workspaceRef, (snapshot) => {
        if (!snapshot.exists()) {
            setEditorContent('// Empty workspace', 'javascript', 'main');
            hideLoading();
            return;
        }
        
        const files = snapshot.val();
        renderTabsAndTree(files);
        
        // If active file is in the sync data, update editor
        if (files[activeFile]) {
            const remoteContent = files[activeFile].content;
            const remoteLang = files[activeFile].language;
            
            if (editorInstance.getValue() !== remoteContent) {
                ignoreNextChange = true;
                setEditorContent(remoteContent, remoteLang, activeFile);
            }
        }
        
        hideLoading();
    });
    
    // Outgoing Editor Changes
    editorInstance.onDidChangeModelContent((e) => {
        if (ignoreNextChange) {
            ignoreNextChange = false;
            return;
        }
        
        const content = editorInstance.getValue();
        const lang = editorInstance.getModel().getLanguageId();
        
        // Sync to RTDB
        rtdbUpdate(ref(rtdb, `rooms/${currentRoomId}/workspace/${activeFile}`), {
            content: content,
            language: lang,
            lastModifiedBy: currentUser.uid,
            timestamp: Date.now()
        });
        
        // Sync to Local FS if applicable
        const mappedLocalPath = activeFile.replace(/_/g, '/');
        if (localFilesMap.has(mappedLocalPath)) {
            saveToLocalFile(mappedLocalPath, content);
        }
    });

    // Outgoing Cursor Sync
    editorInstance.onDidChangeCursorPosition((e) => {
        const { lineNumber, column } = e.position;
        set(ref(rtdb, `rooms/${currentRoomId}/cursors/${currentUser.uid}`), {
            file: activeFile,
            line: lineNumber,
            col: column
        });
    });

    // Incoming Cursor Sync
    cursorsRef = ref(rtdb, `rooms/${currentRoomId}/cursors`);
    onValue(cursorsRef, (snap) => {
        updateRemoteCursors(snap.val() || {});
    });
}

function renderTabsAndTree(files) {
    const tabsContainer = document.getElementById('editor-tabs');
    const treeContainer = document.getElementById('file-tree');
    
    // Only render tabs for remote files. Local files are rendered by file-system.js in the tree.
    tabsContainer.innerHTML = '';
    
    Object.keys(files).forEach(fileId => {
        const f = files[fileId];
        // Tab DOM
        const tab = document.createElement('div');
        tab.className = `file-tab ${fileId === activeFile ? 'active' : ''}`;
        tab.dataset.path = fileId;
        
        const name = fileId === 'main' ? 'main' : f.originalPath?.split('/').pop() || fileId;
        
        tab.innerHTML = `
            <span class="file-icon">📄</span>
            <span class="tab-label">${name}</span>
            <span class="tab-close" onclick="closeRemoteFile('${fileId}', event)">✕</span>
        `;
        
        tab.onclick = (e) => {
            if(e.target.classList.contains('tab-close')) return;
            activeFile = fileId;
            setEditorContent(f.content, f.language, fileId);
            updateTabsUI(fileId);
        };
        
        tabsContainer.appendChild(tab);
    });
}

window.closeRemoteFile = async (fileId, event) => {
    event.stopPropagation();
    if(fileId === 'main') {
        alert("Cannot close main workspace file.");
        return;
    }
    // Delete from RTDB
    await remove(ref(rtdb, `rooms/${currentRoomId}/workspace/${fileId}`));
    if (activeFile === fileId) {
        activeFile = 'main';
        // The onValue listener will handle loading main content
    }
};

// --- CURSORS ---
function updateRemoteCursors(cursorsData) {
    // Get colors from activeUsers
    get(ref(rtdb, `rooms/${currentRoomId}/activeUsers`)).then(usersSnap => {
        const users = usersSnap.val() || {};
        const decorations = [];
        
        Object.keys(cursorsData).forEach(uid => {
            if (uid === currentUser.uid) return;
            
            const cursor = cursorsData[uid];
            if (cursor.file !== activeFile) return; // Only show cursors in same file
            
            const user = users[uid];
            if (!user) return;
            
            decorations.push({
                range: new monaco.Range(cursor.line, cursor.col, cursor.line, cursor.col),
                options: {
                    className: 'remote-cursor',
                    hoverMessage: { value: user.name },
                    beforeContentClassName: 'remote-cursor-caret',
                    isWholeLine: false,
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
            
            // We need to inject dynamic CSS for cursor colors
            const styleId = `cursor-style-${uid}`;
            let styleEl = document.getElementById(styleId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                document.head.appendChild(styleEl);
            }
            // Using a hack to pass color via css vars attached to the monaco line DOM isn't easy,
            // so we inject global classes. Monaco's API for dynamic decorations is limited regarding inline styles.
            // For production, a custom ContentWidget is better, but this suffices for the scope.
        });
        
        const oldDecos = Array.from(cursorsMap.values()).flat();
        const newDecoIds = editorInstance.deltaDecorations(oldDecos, decorations);
        
        // Save new IDs
        cursorsMap.clear();
        cursorsMap.set('all', newDecoIds);
    });
}

// --- SNAPSHOTS ---
document.getElementById('btn-snapshot').addEventListener('click', () => {
    document.getElementById('snap-name-modal').classList.add('active');
});

document.getElementById('btn-save-snapshot-confirm').addEventListener('click', async () => {
    const label = document.getElementById('snap-label').value || 'Unnamed Snapshot';
    const btn = document.getElementById('btn-save-snapshot-confirm');
    btn.classList.add('loading');
    
    try {
        const content = editorInstance.getValue();
        
        // Save to global snapshots collection
        await addDoc(collection(db, `users/${currentUser.uid}/snapshots`), {
            roomId: currentRoomId,
            roomName: roomData.name,
            label: label,
            code: content,
            language: editorInstance.getModel().getLanguageId(),
            lineCount: editorInstance.getModel().getLineCount(),
            timestamp: serverTimestamp()
        });
        
        // Notify room
        appendSystemMessage(`📸 ${userData?.displayName || 'A user'} saved a snapshot: "${label}"`);
        
        document.getElementById('snap-name-modal').classList.remove('active');
        document.getElementById('snap-label').value = '';
    } catch (e) {
        console.error("Failed to save snapshot", e);
        alert("Failed to save snapshot");
    } finally {
        btn.classList.remove('loading');
    }
});

// --- ROOM SETTINGS MODAL ---
document.getElementById('btn-room-settings').addEventListener('click', () => {
    if (!isOwner) {
        alert("Only the room owner can change settings.");
        return;
    }
    
    document.getElementById('setting-lock').checked = roomData.isLocked || false;
    
    const list = document.getElementById('permissions-list');
    list.innerHTML = '';
    
    roomData.collaborators.forEach(uid => {
        if (uid === currentUser.uid) return; // Owner is always owner
        
        const currentPerm = roomData.permissions?.[uid] || 'viewer';
        
        const item = document.createElement('div');
        item.className = 'permission-item';
        item.innerHTML = `
            <span>User ID: ${uid.substring(0,8)}...</span>
            <select onchange="updateUserPermission('${uid}', this.value)" style="background:var(--bg-color); border:1px solid var(--border-color); color:white; padding:4px; border-radius:4px;">
                <option value="viewer" ${currentPerm === 'viewer' ? 'selected' : ''}>Viewer (Read-Only)</option>
                <option value="editor" ${currentPerm === 'editor' ? 'selected' : ''}>Editor</option>
            </select>
        `;
        list.appendChild(item);
    });
    
    document.getElementById('settings-modal').classList.add('active');
});

document.getElementById('setting-lock').addEventListener('change', async (e) => {
    try {
        await updateDoc(doc(db, 'rooms', currentRoomId), { isLocked: e.target.checked });
        roomData.isLocked = e.target.checked;
        appendSystemMessage(e.target.checked ? "🔒 Room is now locked." : "🔓 Room is now unlocked.");
    } catch(e) { console.error(e); }
});

window.updateUserPermission = async (uid, perm) => {
    try {
        await updateDoc(doc(db, 'rooms', currentRoomId), {
            [`permissions.${uid}`]: perm
        });
        roomData.permissions[uid] = perm;
        appendSystemMessage(`Shield: Permissions updated for user.`);
    } catch(e) { console.error(e); }
};

// Check for restore param on load
const urlParams = new URLSearchParams(window.location.search);
const restoreId = urlParams.get('restore');
if (restoreId) {
    // Wait for auth to complete
    setTimeout(async () => {
        try {
            const snapDoc = await getDoc(doc(db, `users/${currentUser.uid}/snapshots`, restoreId));
            if(snapDoc.exists()) {
                const code = snapDoc.data().code;
                rtdbUpdate(ref(rtdb, `rooms/${currentRoomId}/workspace/main`), {
                    content: code,
                    timestamp: Date.now()
                });
                appendSystemMessage("🔄 Restored from snapshot: " + snapDoc.data().label);
                
                // Clean URL
                window.history.replaceState({}, document.title, `editor.html?room=${currentRoomId}`);
            }
        } catch(e) {}
    }, 1500);
}

// Utils
const colors = ['#f97316', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6'];
function getRandomColor() { return colors[Math.floor(Math.random() * colors.length)]; }
