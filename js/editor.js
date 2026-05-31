import { 
    auth, db, rtdb, 
    onAuthStateChanged,
    doc, getDoc, updateDoc,
    ref, set, onValue, onDisconnect, push, remove, onChildAdded
} from './firebase-config.js';

// --- Global State ---
let currentUser = null;
let userData = null;
let roomId = null;
let roomData = null;
let editor = null;
let Monaco = null;

// Realtime Presence & Sync
let codeRef, cursorsRef, activeUsersRef;
let isUpdatingContent = false;
let decorations = []; // Monaco cursor decorations
let cursorColors = {}; // userId -> color

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Extract Room ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    
    if (!roomId) {
        showToast("No room specified!", 'error');
        setTimeout(() => window.location.href = 'dashboard.html', 1500);
        return;
    }

    // 2. Auth Guard
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = `auth.html?redirect=editor.html?room=${roomId}`;
            return;
        }
        currentUser = user;
        
        try {
            await initializeWorkspace();
        } catch(err) {
            console.error(err);
            showToast(err.message, 'error');
            setTimeout(() => window.location.href = 'dashboard.html', 2000);
        }
    });

    setupUIListeners();
});

async function initializeWorkspace() {
    // 1. Fetch User Data
    const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if(!userDoc.exists()) throw new Error("User data not found");
    userData = userDoc.data();

    // 2. Fetch Room Data
    const roomRef = doc(db, 'rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) throw new Error("Room not found or deleted");
    roomData = roomSnap.data();

    // Access control check
    if (!roomData.isPublic && !roomData.collaborators.includes(currentUser.uid)) {
        throw new Error("You do not have access to this room");
    }

    // 3. Update UI Headers
    document.getElementById('room-name').textContent = roomData.name;
    document.getElementById('room-code-badge').textContent = roomId;
    document.getElementById('editor-lang').value = roomData.language;

    // Apply User Prefs
    document.documentElement.setAttribute('data-theme', userData.preferences.theme);

    // 4. Initialize Monaco
    initMonaco();

    // 5. Setup Firebase Realtime Listeners
    setupPresenceAndSync();
}

// --- Monaco Editor Setup ---
function initMonaco() {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
    require(['vs/editor/editor.main'], function() {
        Monaco = monaco;

        const container = document.getElementById('monaco-container');
        editor = monaco.editor.create(container, {
            value: "// Loading code...",
            language: roomData.language,
            theme: userData.preferences.theme === 'light' ? 'vs' : 'vs-dark',
            fontSize: userData.preferences.fontSize || 14,
            tabSize: userData.preferences.tabSize || 2,
            wordWrap: userData.preferences.wordWrap ? "on" : "off",
            minimap: { enabled: userData.preferences.minimap !== false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            padding: { top: 16 }
        });

        // Expose editor globally so rooms.js snapshot can access it
        window._monacoEditor = editor;
        window._currentUserData = userData;

        // Editor Change Event (Sync to RTDB)
        editor.onDidChangeModelContent(debounce(() => {
            if (isUpdatingContent) return;
            if (!codeRef) return;
            set(codeRef, {
                content: editor.getValue(),
                language: roomData.language,
                updatedBy: currentUser.uid,
                timestamp: Date.now()
            });
        }, 300));

        // Cursor Change Event (Sync to RTDB)
        editor.onDidChangeCursorPosition(debounce((e) => {
            if (!currentUser || !userData) return;
            const pos = e.position;
            set(ref(rtdb, `rooms/${roomId}/cursors/${currentUser.uid}`), {
                line: pos.lineNumber,
                column: pos.column,
                color: userData.avatar.color,
                username: userData.fullName.split(' ')[0],
                timestamp: Date.now()
            });
        }, 100));

        // Monaco keyboard shortcuts
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
            document.getElementById('btn-run')?.click();
        });
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            document.getElementById('btn-snapshot')?.click();
        });

        // Trigger initial data load from RTDB
        setupCodeListener();
    });
}

// --- Realtime Sync Logic ---
function setupPresenceAndSync() {
    codeRef = ref(rtdb, `rooms/${roomId}/code`);
    cursorsRef = ref(rtdb, `rooms/${roomId}/cursors`);
    activeUsersRef = ref(rtdb, `rooms/${roomId}/activeUsers`);

    // 1. Presence
    const myPresenceRef = ref(rtdb, `rooms/${roomId}/activeUsers/${currentUser.uid}`);
    const connectedRef = ref(rtdb, '.info/connected');

    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            // We are connected
            showToast("Connected to room", "success");
            
            // Set disconnect hook
            onDisconnect(myPresenceRef).remove();
            onDisconnect(ref(rtdb, `rooms/${roomId}/cursors/${currentUser.uid}`)).remove();

            // Write presence
            set(myPresenceRef, {
                uid: currentUser.uid,
                name: userData.fullName,
                color: userData.avatar.color,
                initials: userData.avatar.initials,
                joinedAt: Date.now()
            });
        } else {
            showToast("Connection lost. Reconnecting...", "error");
        }
    });

    // Listen to Active Users
    onValue(activeUsersRef, (snap) => {
        const users = snap.val() || {};
        updatePresenceUI(users);
        
        // Clean up cursors of users who left
        Object.keys(cursorColors).forEach(uid => {
            if(!users[uid] && uid !== currentUser.uid) {
                remove(ref(rtdb, `rooms/${roomId}/cursors/${uid}`));
                delete cursorColors[uid];
            }
        });
    });

    // 2. Cursor Sync Listener
    onValue(cursorsRef, (snap) => {
        if (!editor || !Monaco) return;
        const cursors = snap.val() || {};
        const newDecorations = [];

        Object.keys(cursors).forEach(uid => {
            if (uid === currentUser.uid) return; // Ignore own cursor
            
            const cursor = cursors[uid];
            cursorColors[uid] = cursor.color;

            // Create CSS rule for cursor color if not exists
            let styleId = `cursor-style-${uid}`;
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.innerHTML = `
                    .cursor-${uid} { border-left: 2px solid ${cursor.color}; }
                    .cursor-${uid} .cursor-label { background-color: ${cursor.color}; }
                `;
                document.head.appendChild(style);
            }

            newDecorations.push({
                range: new Monaco.Range(cursor.line, cursor.column, cursor.line, cursor.column),
                options: {
                    className: `cursor-decorator cursor-${uid}`,
                    hoverMessage: { value: cursor.username },
                    beforeContentClassName: `cursor-label`,
                    before: {
                        content: cursor.username
                    }
                }
            });
        });

        decorations = editor.deltaDecorations(decorations, newDecorations);
    });

    // Lazy-load chat and room tool modules after sync is established
    import('./chat.js')
        .then(module => module.initChat(roomId, currentUser, userData))
        .catch(err => console.error('Chat module failed to load:', err));

    import('./rooms.js')
        .then(module => module.initRoomTools(roomId, currentUser, roomData))
        .catch(err => console.error('Rooms module failed to load:', err));
}

function setupCodeListener() {
    onValue(codeRef, (snap) => {
        const data = snap.val();
        if (!data || !editor) {
            if(!data && editor) editor.setValue("// Start typing...");
            return;
        }

        // Only update if someone else changed it to prevent cursor jumping
        if (data.updatedBy !== currentUser.uid) {
            isUpdatingContent = true;
            
            // Save cursor state
            const position = editor.getPosition();
            
            // Execute edit instead of setValue to preserve undo stack
            const fullRange = editor.getModel().getFullModelRange();
            editor.executeEdits("remote", [{
                range: fullRange,
                text: data.content
            }]);
            
            // Restore cursor state
            if(position) editor.setPosition(position);
            
            isUpdatingContent = false;
        }

        // Update language if changed
        if (data.language !== roomData.language) {
            roomData.language = data.language;
            document.getElementById('editor-lang').value = data.language;
            Monaco.editor.setModelLanguage(editor.getModel(), data.language);
        }
    });
}

function updatePresenceUI(users) {
    const stack = document.getElementById('presence-stack');
    const onlineCount = document.getElementById('online-count');
    
    stack.innerHTML = '';
    const userIds = Object.keys(users);
    onlineCount.textContent = `${userIds.length} Online`;

    // Max 5 avatars in stack
    const displayUsers = userIds.slice(0, 5);
    displayUsers.forEach(uid => {
        const u = users[uid];
        const av = document.createElement('div');
        av.className = 'presence-avatar';
        av.style.backgroundColor = u.color;
        av.textContent = u.initials;
        av.setAttribute('data-name', u.name);
        stack.appendChild(av);
    });

    if (userIds.length > 5) {
        const more = document.createElement('div');
        more.className = 'presence-avatar';
        more.style.backgroundColor = '#333';
        more.textContent = `+${userIds.length - 5}`;
        stack.appendChild(more);
    }
}

// --- UI Interaction Logic ---
function setupUIListeners() {
    // Title Edit — roomData available only after initializeWorkspace resolves,
    // so we defer content-editable enablement and rename logic.
    const titleEl = document.getElementById('room-name');
    titleEl.addEventListener('blur', async (e) => {
        if (!roomData || !currentUser) return;
        const newName = e.target.textContent.trim();
        if (newName && newName !== roomData.name) {
            if (roomData.ownerId === currentUser.uid) {
                try {
                    await updateDoc(doc(db, 'rooms', roomId), { name: newName });
                    roomData.name = newName;
                    showToast("Room renamed");
                } catch (err) {
                    showToast("Failed to rename room", "error");
                    e.target.textContent = roomData.name;
                }
            } else {
                showToast("Only the owner can rename the room", 'warning');
                e.target.textContent = roomData.name;
            }
        }
    });
    titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    });
    // Enable editing after workspace fully initializes
    setTimeout(() => {
        if (roomData && currentUser && roomData.ownerId === currentUser.uid) {
            titleEl.setAttribute('contenteditable', 'true');
        }
    }, 2000);

    // Copy Badge
    document.getElementById('room-code-badge').addEventListener('click', () => {
        navigator.clipboard.writeText(roomId);
        showToast("Room code copied!");
    });

    // Invite Btn
    document.getElementById('btn-invite').addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href);
        showToast("Invite link copied to clipboard!");
    });

    // Language change
    document.getElementById('editor-lang').addEventListener('change', (e) => {
        const newLang = e.target.value;
        if (editor && Monaco) {
            Monaco.editor.setModelLanguage(editor.getModel(), newLang);
            // Trigger sync
            set(codeRef, {
                content: editor.getValue(),
                language: newLang,
                updatedBy: currentUser.uid,
                timestamp: Date.now()
            });
        }
    });

    // Settings Menu
    const settingsBtn = document.getElementById('btn-settings');
    const settingsMenu = document.getElementById('settings-menu');
    settingsBtn.addEventListener('click', () => settingsMenu.classList.toggle('hidden'));
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if(!settingsBtn.contains(e.target) && !settingsMenu.contains(e.target)) {
            settingsMenu.classList.add('hidden');
        }
    });

    // Font size controls
    const fontVal = document.getElementById('font-val');
    document.getElementById('font-inc').addEventListener('click', () => {
        let size = parseInt(fontVal.textContent);
        if(size < 32) { size+=2; fontVal.textContent = size; updateEditorOption('fontSize', size); }
    });
    document.getElementById('font-dec').addEventListener('click', () => {
        let size = parseInt(fontVal.textContent);
        if(size > 10) { size-=2; fontVal.textContent = size; updateEditorOption('fontSize', size); }
    });

    // Toggle options — Monaco may not be ready immediately, guard with check
    document.getElementById('pref-theme').addEventListener('change', (e) => {
        if (Monaco) Monaco.editor.setTheme(e.target.value);
    });
    document.getElementById('pref-wrap').addEventListener('change', (e) => {
        updateEditorOption('wordWrap', e.target.checked ? 'on' : 'off');
    });
    document.getElementById('pref-minimap').addEventListener('change', (e) => {
        updateEditorOption('minimap', { enabled: e.target.checked });
    });

    // Fullscreen
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {});
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    });

    // Leave
    document.getElementById('btn-leave').addEventListener('click', () => {
        if(confirm("Leave this room?")) window.location.href = 'dashboard.html';
    });

    // Panels toggle
    // Shortcuts handled by editor above, these are visual buttons if added

    // --- Sandboxed Execution ---
    const btnRun = document.getElementById('btn-run');
    const consoleOutput = document.getElementById('console-output');
    const consolePanel = document.getElementById('console-panel');

    btnRun.addEventListener('click', () => {
        if (!editor) return;
        const code = editor.getValue();
        const lang = document.getElementById('editor-lang').value;
        
        consolePanel.classList.remove('collapsed');
        btnRun.classList.add('running');
        btnRun.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:6px"></div> Running';

        if (lang === 'javascript' || lang === 'typescript') {
            runSandboxedCode(code);
        } else {
            appendConsole(`Executing ${lang} requires a backend environment. In this static demo, only JS is evaluated in browser.`, 'warn');
            setTimeout(() => {
                btnRun.classList.remove('running');
                btnRun.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg> Run';
            }, 500);
        }
    });

    document.getElementById('btn-close-console').addEventListener('click', () => {
        consolePanel.classList.add('collapsed');
    });
    document.getElementById('btn-clear-console').addEventListener('click', () => {
        const inputLine = consoleOutput.querySelector('.console-input-line');
        consoleOutput.innerHTML = '';
        if(inputLine) consoleOutput.appendChild(inputLine);
    });

    // Setup iframe message listener
    window.addEventListener('message', (event) => {
        if (event.data.type === 'console') {
            appendConsole(event.data.message, event.data.method);
        } else if (event.data.type === 'error') {
            appendConsole(event.data.message, 'error');
        } else if (event.data.type === 'result') {
            if(event.data.message !== undefined) appendConsole(String(event.data.message), 'return');
            
            // Execution complete
            const time = event.data.time;
            appendConsole(`Execution finished in ${time}ms`, 'system');
            
            btnRun.classList.remove('running');
            btnRun.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg> Run';
        }
    });

    // Setup REPL input
    const consoleInput = document.getElementById('console-input');
    consoleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const code = e.target.value;
            e.target.value = '';
            if(code.trim() === '') return;
            appendConsole("> " + code, 'log');
            runSandboxedCode(code, true);
        }
    });
}

function updateEditorOption(key, value) {
    if (editor) {
        editor.updateOptions({ [key]: value });
    }
}

// --- Sandboxed Execution Logic ---
function runSandboxedCode(code, isRepl = false) {
    const iframe = document.getElementById('sandbox-frame');
    
    // Inject script into iframe to intercept console
    const scriptContent = `
        <script>
            // Intercept console
            const methods = ['log', 'error', 'warn', 'info'];
            methods.forEach(method => {
                const original = console[method];
                console[method] = function(...args) {
                    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
                    window.parent.postMessage({ type: 'console', method: method, message: msg }, '*');
                    original.apply(console, args);
                };
            });

            // Catch errors
            window.onerror = function(msg, url, line, col, error) {
                window.parent.postMessage({ type: 'error', message: msg + ' (Line: ' + line + ')' }, '*');
                return true;
            };

            // Execute
            try {
                const start = performance.now();
                ${isRepl ? 'const result = eval(' + JSON.stringify(code) + ');' : code + '\nconst result = undefined;'}
                const end = performance.now();
                window.parent.postMessage({ 
                    type: 'result', 
                    message: result,
                    time: (end - start).toFixed(2)
                }, '*');
            } catch (err) {
                window.parent.postMessage({ type: 'error', message: err.toString() }, '*');
                window.parent.postMessage({ type: 'result', time: 0 }, '*');
            }
        </script>
    `;

    // Rewrite iframe content
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(scriptContent);
    doc.close();
}

function appendConsole(text, type = 'log') {
    const output = document.getElementById('console-output');
    const inputLine = output.querySelector('.console-input-line');
    
    const div = document.createElement('div');
    div.className = `console-line ${type}`;
    
    // Formatting
    let prefix = '';
    if(type === 'error') prefix = '✕ ';
    if(type === 'warn') prefix = '⚠ ';
    if(type === 'return') prefix = '← ';
    
    div.textContent = prefix + text;
    
    if (inputLine) {
        output.insertBefore(div, inputLine);
    } else {
        output.appendChild(div);
    }
    
    output.scrollTop = output.scrollHeight;
}

// Utils
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '';
    if(type==='success') icon = '✅';
    if(type==='error') icon = '❌';
    if(type==='warning') icon = '⚠';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        if(container.contains(toast)) toast.remove();
    }, 4000);
}
