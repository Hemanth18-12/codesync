import { auth, db, doc, getDoc, onAuthStateChanged, collection, addDoc, serverTimestamp, rtdb, ref, set, onValue, push, update, remove, get } from './firebase-config.js';

// --- GLOBAL STATE ---
export let editorInstance = null;
export let currentUser = null;
export let currentRoomId = new URLSearchParams(window.location.search).get('room');
export let activeFile = 'main';
export let userPreferences = { theme: 'vs-dark', fontSize: 14, minimap: true, wordWrap: true };
export let isReadOnly = false;

export const getActiveFile = () => activeFile;
export const setActiveFile = (fileId) => { activeFile = fileId; };

// --- DOM ELEMENTS ---
const monacoContainer = document.getElementById('monaco-container');
const loadingOverlay = document.getElementById('editor-loading');
const btnFormat = document.getElementById('btn-format');
const btnPreview = document.getElementById('btn-preview-toggle');
const previewPanel = document.getElementById('preview-panel');
const previewIframe = document.getElementById('preview-iframe');
const btnRefreshPreview = document.getElementById('btn-refresh-preview');
const tabsContainer = document.getElementById('editor-tabs');

// Status Bar
const statusLang = document.getElementById('status-lang');
const statusCursor = document.getElementById('status-cursor');
const statusFile = document.getElementById('status-file');

// Layout
const activityItems = document.querySelectorAll('.activity-item');
const sidebar = document.getElementById('editor-sidebar');
const sidebarPanels = document.querySelectorAll('.sidebar-panel');

// --- INITIALIZATION ---
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'auth.html'; return; }
    currentUser = user;
    if (!currentRoomId) { window.location.href = 'dashboard.html'; return; }
    
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists() && userDoc.data().preferences) {
            userPreferences = userDoc.data().preferences;
        }
        
        initMonaco();
    } catch (e) {
        console.error("Failed to load user preferences", e);
        initMonaco(); // Init with defaults
    }
});

// --- MONACO EDITOR SETUP ---
function initMonaco() {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.38.0/min/vs' }});
    require(['vs/editor/editor.main'], function () {
        
        editorInstance = monaco.editor.create(monacoContainer, {
            value: "// Loading...",
            language: "javascript",
            theme: userPreferences.theme || "vs-dark",
            fontSize: userPreferences.fontSize || 14,
            minimap: { enabled: userPreferences.minimap !== false },
            wordWrap: userPreferences.wordWrap !== false ? "on" : "off",
            automaticLayout: true,
            readOnly: isReadOnly,
            padding: { top: 16 },
            scrollBeyondLastLine: false,
            fontFamily: "'JetBrains Mono', monospace",
            renderWhitespace: "selection"
        });

        // Update status bar cursor pos
        editorInstance.onDidChangeCursorPosition((e) => {
            statusCursor.innerText = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
        });

        // Add Format shortcut (Shift+Alt+F)
        editorInstance.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, formatCode);

        // Dispatch custom event to notify other modules Monaco is ready
        // Set flag BEFORE dispatching so any late-registering listeners can check it
        window.__monacoReady = true;
        window.dispatchEvent(new CustomEvent('monaco-ready'));
    });
}

// --- EXPORTED METHODS FOR OTHER MODULES ---
export function setEditorContent(content, language, fileId) {
    if (!editorInstance) return;
    
    activeFile = fileId;
    statusFile.innerText = fileId;
    
    // Update language model
    const langMap = {
        'js': 'javascript', 'ts': 'typescript', 'html': 'html',
        'css': 'css', 'json': 'json', 'py': 'python', 'md': 'markdown'
    };
    
    let ext = fileId.split('.').pop().toLowerCase();
    let mappedLang = langMap[ext] || language || 'plaintext';
    
    if (fileId === 'main') mappedLang = language || 'javascript'; // legacy support
    
    monaco.editor.setModelLanguage(editorInstance.getModel(), mappedLang);
    statusLang.innerText = mappedLang.charAt(0).toUpperCase() + mappedLang.slice(1);
    
    // Set value without triggering our own change events immediately
    if (editorInstance.getValue() !== content) {
        editorInstance.setValue(content);
    }
    
    updatePreview(content, mappedLang);
    updateTabsUI(fileId);
}

export function setReadOnly(ro) {
    isReadOnly = ro;
    if (editorInstance) editorInstance.updateOptions({ readOnly: ro });
    const badge = document.getElementById('readonly-badge');
    if (badge) {
        if (ro) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
}

export function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => loadingOverlay.style.display = 'none', 300);
    }
}

// Safety timeout — force-hide the loading screen after 10s
// in case Firebase RTDB never responds (e.g., auth delay, network issue)
setTimeout(() => {
    if (loadingOverlay && loadingOverlay.style.display !== 'none') {
        console.warn('CodeSync: Force-hiding loading screen after 10s timeout');
        hideLoading();
    }
}, 10000);

// --- TABS MANAGEMENT ---
export function updateTabsUI(activeId) {
    // Other modules will build the tabs DOM, this just highlights the active one
    document.querySelectorAll('.file-tab').forEach(tab => {
        if (tab.dataset.path === activeId) tab.classList.add('active');
        else tab.classList.remove('active');
    });
}

// --- LAYOUT TOGGLING ---
activityItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetPanel = item.dataset.panel;
        
        // If clicking already active item, collapse sidebar
        if (item.classList.contains('active') && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            item.classList.remove('active');
            return;
        }
        
        sidebar.classList.remove('collapsed');
        activityItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        sidebarPanels.forEach(p => p.classList.remove('active'));
        document.getElementById(`panel-${targetPanel}`).classList.add('active');
    });
});

// --- CODE FORMATTING ---
async function formatCode() {
    if (!editorInstance || isReadOnly) return;
    const code = editorInstance.getValue();
    const lang = editorInstance.getModel().getLanguageId();
    let formatted = code;
    
    btnFormat.classList.add('loading');
    
    try {
        if (lang === 'javascript' || lang === 'typescript' || lang === 'json') {
            formatted = prettier.format(code, { parser: "babel", plugins: prettierPlugins });
        } else if (lang === 'html') {
            formatted = prettier.format(code, { parser: "html", plugins: prettierPlugins });
        } else if (lang === 'css') {
            formatted = prettier.format(code, { parser: "css", plugins: prettierPlugins });
        }
        
        if (formatted !== code) {
            editorInstance.pushUndoStop();
            editorInstance.executeEdits("formatter", [{
                range: editorInstance.getModel().getFullModelRange(),
                text: formatted
            }]);
            editorInstance.pushUndoStop();
        }
    } catch (e) {
        console.warn("Formatting failed", e);
    } finally {
        btnFormat.classList.remove('loading');
    }
}

if (btnFormat) btnFormat.addEventListener('click', formatCode);

// --- LIVE PREVIEW ---
let previewTimeout;

function updatePreview(content, lang) {
    if (!previewPanel.classList.contains('active')) return;
    
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        let finalHtml = content;
        
        if (lang === 'javascript') {
            // Wrap in basic HTML to execute
            finalHtml = `<!DOCTYPE html><html><body><script>${content}</script></body></html>`;
        } else if (lang === 'markdown') {
            // Fallback since we don't have marked.js loaded
            finalHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;white-space:pre-wrap;">${content}</body></html>`;
        }
        
        const doc = previewIframe.contentDocument || previewIframe.contentWindow.document;
        doc.open();
        doc.write(finalHtml);
        doc.close();
    }, 1000); // 1s debounce
}

if (btnPreview) {
    btnPreview.addEventListener('click', () => {
        previewPanel.classList.toggle('active');
        if (previewPanel.classList.contains('active')) {
            btnPreview.classList.add('active');
            btnPreview.style.background = 'rgba(249, 115, 22, 0.2)';
            if(editorInstance) updatePreview(editorInstance.getValue(), editorInstance.getModel().getLanguageId());
        } else {
            btnPreview.classList.remove('active');
            btnPreview.style.background = '';
        }
    });
}

if (btnRefreshPreview) {
    btnRefreshPreview.addEventListener('click', () => {
        if(editorInstance) updatePreview(editorInstance.getValue(), editorInstance.getModel().getLanguageId());
    });
}

// --- SNAPSHOTS ---
export const saveSnapshot = async (label) => {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const code = window.monacoEditor?.getValue() || editorInstance?.getValue() || '';
    const lineCount = code.split('\n').length;

    // Save to Firestore
    await addDoc(
      collection(db, 'rooms', currentRoomId, 'snapshots'),
      {
        label: label || `Snapshot ${new Date().toLocaleString()}`,
        code: code,
        language: editorInstance?.getModel().getLanguageId() || 'javascript',
        savedBy: user.uid,
        savedByName: user.displayName || user.email,
        timestamp: serverTimestamp(),
        lineCount: lineCount
      }
    );

    if (typeof showToast !== 'undefined') showToast('📸 Snapshot saved!', 'success');
  } catch (error) {
    console.error('Snapshot error:', error);
    if (typeof showToast !== 'undefined') showToast('Failed to save snapshot', 'error');
  }
};

// ============================================================================
// 🆕 FEATURE 1 — VS CODE STYLE FILE SYSTEM
// ============================================================================

const fileTreeDOM = document.getElementById('file-tree');
const tabsContainerDOM = document.getElementById('editor-tabs');
const btnNewFile = document.getElementById('btn-new-file');
const btnNewFolder = document.getElementById('btn-new-folder');
const ctxMenu = document.getElementById('file-context-menu');
const paletteModal = document.getElementById('command-palette');
const paletteInput = document.getElementById('palette-input');
const paletteResults = document.getElementById('palette-results');
const btnInvite = document.getElementById('btn-invite');
const shareModal = document.getElementById('share-modal');

let filesData = {};
let foldersData = {};
let openTabs = [];
let activeTabId = null;
let contextTargetId = null;
let contextTargetType = null; // 'file' or 'folder' or 'root'
let autoSaveTimer = null;

const langMapByExt = {
    'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript',
    'ts': 'typescript', 'tsx': 'typescript',
    'py': 'python', 'pyw': 'python',
    'java': 'java',
    'cpp': 'cpp', 'cxx': 'cpp', 'cc': 'cpp', 'c': 'cpp', 'h': 'cpp', 'hpp': 'cpp',
    'cs': 'csharp',
    'go': 'go',
    'rs': 'rust',
    'php': 'php',
    'rb': 'ruby',
    'swift': 'swift',
    'kt': 'kotlin',
    'html': 'html', 'htm': 'html',
    'css': 'css',
    'scss': 'scss', 'sass': 'scss',
    'json': 'json', 'jsonc': 'json',
    'md': 'markdown', 'mdx': 'markdown',
    'yml': 'yaml', 'yaml': 'yaml',
    'xml': 'xml', 'svg': 'xml',
    'sql': 'sql',
    'sh': 'shell', 'bash': 'shell', 'zsh': 'shell'
};

function getFileLanguage(filename) {
    if (filename.toLowerCase() === 'dockerfile') return 'dockerfile';
    const ext = filename.split('.').pop().toLowerCase();
    return langMapByExt[ext] || 'plaintext';
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['js','jsx','mjs'].includes(ext)) return '🟡';
    if (['ts','tsx'].includes(ext)) return '🔵';
    if (['py','pyw'].includes(ext)) return '🐍';
    if (['java'].includes(ext)) return '☕';
    if (['cpp','cxx','cc','c','h','hpp'].includes(ext)) return '🔷';
    if (['html','htm'].includes(ext)) return '🟠';
    if (['css','scss','sass'].includes(ext)) return '🔵';
    if (['json','jsonc'].includes(ext)) return '🟡';
    if (['md','mdx'].includes(ext)) return '📝';
    if (['txt'].includes(ext)) return '📄';
    if (['go'].includes(ext)) return '🔵';
    if (['rs'].includes(ext)) return '🦀';
    if (['php'].includes(ext)) return '🐘';
    if (['rb'].includes(ext)) return '💎';
    if (['swift'].includes(ext)) return '🍊';
    if (['kt'].includes(ext)) return '🟣';
    if (['sh','bash','zsh'].includes(ext)) return '⬛';
    if (['sql'].includes(ext)) return '🗄️';
    return '📄';
}

// 1. Initialize Real-time Listeners
window.addEventListener('monaco-ready', () => {
    if(!currentRoomId) return;
    
    // Listen to folders
    onValue(ref(rtdb, `rooms/${currentRoomId}/filesystem/folders`), (snap) => {
        foldersData = snap.val() || {};
        renderFileTree();
    });
    
    // Listen to files
    onValue(ref(rtdb, `rooms/${currentRoomId}/filesystem/files`), (snap) => {
        filesData = snap.val() || {};
        renderFileTree();
        updateTabsUI();
        
        // Auto-open first file if none open
        if (openTabs.length === 0 && Object.keys(filesData).length > 0) {
            const firstFileId = Object.keys(filesData)[0];
            openFile(firstFileId);
        }
    });
});

// 2. Render File Tree
function renderFileTree() {
    if(!fileTreeDOM) return;
    fileTreeDOM.innerHTML = '';
    
    // Root level rendering
    const rootFolders = Object.entries(foldersData).filter(([_, f]) => !f.parentId).sort((a,b) => a[1].name.localeCompare(b[1].name));
    const rootFiles = Object.entries(filesData).filter(([_, f]) => !f.parentFolderId).sort((a,b) => a[1].name.localeCompare(b[1].name));
    
    rootFolders.forEach(([id, f]) => fileTreeDOM.appendChild(createFolderDOM(id, f)));
    rootFiles.forEach(([id, f]) => fileTreeDOM.appendChild(createFileDOM(id, f)));
}

function createFolderDOM(id, folder) {
    const div = document.createElement('div');
    const header = document.createElement('div');
    header.className = 'tree-item folder-item';
    header.dataset.id = id;
    header.innerHTML = `<span class="arrow">▶</span><span class="icon">📁</span><span class="name">${folder.name}</span>`;
    
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    childrenContainer.id = `folder-children-${id}`;
    
    // Populate children
    const childFolders = Object.entries(foldersData).filter(([_, f]) => f.parentId === id).sort((a,b) => a[1].name.localeCompare(b[1].name));
    const childFiles = Object.entries(filesData).filter(([_, f]) => f.parentFolderId === id).sort((a,b) => a[1].name.localeCompare(b[1].name));
    
    childFolders.forEach(([cid, cf]) => childrenContainer.appendChild(createFolderDOM(cid, cf)));
    childFiles.forEach(([cid, cf]) => childrenContainer.appendChild(createFileDOM(cid, cf)));
    
    header.onclick = (e) => {
        e.stopPropagation();
        header.classList.toggle('open');
        childrenContainer.classList.toggle('open');
        const arrow = header.querySelector('.arrow');
        arrow.innerText = header.classList.contains('open') ? '▼' : '▶';
    };
    
    header.oncontextmenu = (e) => showContextMenu(e, id, 'folder');
    
    div.appendChild(header);
    div.appendChild(childrenContainer);
    return div;
}

function createFileDOM(id, file) {
    const div = document.createElement('div');
    div.className = `tree-item file-item ${id === activeTabId ? 'active' : ''}`;
    div.dataset.id = id;
    const icon = getFileIcon(file.name);
    div.innerHTML = `<span class="icon">${icon}</span><span class="name">${file.name}</span>`;
    
    div.onclick = (e) => {
        e.stopPropagation();
        openFile(id);
    };
    div.oncontextmenu = (e) => showContextMenu(e, id, 'file');
    return div;
}

// 3. File Operations
async function createNewFolder(parentId = null) {
    const name = prompt("Enter folder name:");
    if(!name) return;
    
    const newRef = push(ref(rtdb, `rooms/${currentRoomId}/filesystem/folders`));
    await set(newRef, {
        name: name,
        parentId: parentId,
        createdBy: auth.currentUser?.uid || 'anonymous',
        createdAt: new Date().toISOString()
    });
}

async function createNewFile(parentId = null) {
    const name = prompt("Enter file name (e.g. index.js):");
    if(!name) return;
    
    const newRef = push(ref(rtdb, `rooms/${currentRoomId}/filesystem/files`));
    await set(newRef, {
        name: name,
        content: '',
        language: getFileLanguage(name),
        parentFolderId: parentId,
        createdBy: auth.currentUser?.uid || 'anonymous',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    
    openFile(newRef.key);
}

if(btnNewFolder) btnNewFolder.onclick = () => createNewFolder(null);
if(btnNewFile) btnNewFile.onclick = () => createNewFile(null);

// Context Menu
document.addEventListener('click', () => { if(ctxMenu) ctxMenu.style.display = 'none'; });

function showContextMenu(e, id, type) {
    e.preventDefault();
    e.stopPropagation();
    if(!ctxMenu) return;
    contextTargetId = id;
    contextTargetType = type;
    
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = e.pageX + 'px';
    ctxMenu.style.top = e.pageY + 'px';
    
    document.getElementById('ctx-new-file').style.display = type === 'folder' ? 'block' : 'none';
    document.getElementById('ctx-new-folder').style.display = type === 'folder' ? 'block' : 'none';
}

if(ctxMenu) {
    document.getElementById('ctx-new-file').onclick = () => createNewFile(contextTargetId);
    document.getElementById('ctx-new-folder').onclick = () => createNewFolder(contextTargetId);
    document.getElementById('ctx-rename').onclick = async () => {
        const newName = prompt("Enter new name:");
        if(!newName) return;
        const path = contextTargetType === 'file' ? 'files' : 'folders';
        await update(ref(rtdb, `rooms/${currentRoomId}/filesystem/${path}/${contextTargetId}`), { name: newName });
    };
    document.getElementById('ctx-delete').onclick = async () => {
        if(confirm(`Are you sure you want to delete this ${contextTargetType}?`)) {
            const path = contextTargetType === 'file' ? 'files' : 'folders';
            await remove(ref(rtdb, `rooms/${currentRoomId}/filesystem/${path}/${contextTargetId}`));
            if(contextTargetType === 'file') closeTab(contextTargetId);
        }
    };
    document.getElementById('ctx-collapse-all').onclick = () => {
        document.querySelectorAll('.folder-children').forEach(el => el.classList.remove('open'));
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('open'));
        document.querySelectorAll('.arrow').forEach(el => el.innerText = '▶');
    };
}

// 4. File Tabs & Editing
function openFile(id) {
    if(!filesData[id]) return;
    
    if(!openTabs.includes(id)) openTabs.push(id);
    activeTabId = id;
    
    // Set Editor Content
    if(editorInstance) {
        const file = filesData[id];
        const mappedLang = getFileLanguage(file.name) || 'plaintext';
        
        monaco.editor.setModelLanguage(editorInstance.getModel(), mappedLang);
        if(editorInstance.getValue() !== file.content) {
            editorInstance.setValue(file.content || '');
        }
        
        document.getElementById('status-lang').innerText = mappedLang;
        document.getElementById('status-file').innerText = file.name;
    }
    
    renderFileTree();
    updateTabsUI();
}

function closeTab(id) {
    openTabs = openTabs.filter(t => t !== id);
    if(activeTabId === id) {
        if(openTabs.length > 0) openFile(openTabs[openTabs.length - 1]);
        else {
            activeTabId = null;
            if(editorInstance) editorInstance.setValue('// No file open');
        }
    }
    updateTabsUI();
}

function updateTabsUI() {
    if(!tabsContainerDOM) return;
    tabsContainerDOM.innerHTML = '';
    
    openTabs.forEach(id => {
        const file = filesData[id];
        if(!file) return;
        const div = document.createElement('div');
        div.className = `file-tab ${id === activeTabId ? 'active' : ''}`;
        div.innerHTML = `
            <span class="file-icon">${getFileIcon(file.name)}</span>
            <span class="tab-label">${file.name}</span>
            <span class="unsaved-dot"></span>
            <span class="tab-close">×</span>
        `;
        div.onclick = () => openFile(id);
        div.querySelector('.tab-close').onclick = (e) => {
            e.stopPropagation();
            closeTab(id);
        };
        // Middle click to close tab
        div.addEventListener('auxclick', (e) => {
            if (e.button === 1) closeTab(id);
        });
        tabsContainerDOM.appendChild(div);
    });
}

// Editor Change listener for Auto-save
window.addEventListener('monaco-ready', () => {
    if(editorInstance) {
        editorInstance.onDidChangeModelContent(() => {
            if(!activeTabId || isReadOnly) return;
            const content = editorInstance.getValue();
            
            // Mark tab as unsaved
            const tab = tabsContainerDOM?.querySelector(`.file-tab.active`);
            if(tab) tab.classList.add('unsaved');
            
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(async () => {
                await update(ref(rtdb, `rooms/${currentRoomId}/filesystem/files/${activeTabId}`), {
                    content: content,
                    updatedAt: new Date().toISOString()
                });
                if(tab) tab.classList.remove('unsaved');
            }, 2000);
        });
    }
});

// 5. Command Palette (Ctrl+P)
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        if(paletteModal) {
            paletteModal.style.display = 'flex';
            paletteInput.focus();
            paletteInput.value = '';
            renderPaletteResults('');
        }
    }
    if (e.key === 'Escape' && paletteModal) {
        paletteModal.style.display = 'none';
    }
});

if(paletteInput) {
    paletteInput.addEventListener('input', (e) => renderPaletteResults(e.target.value));
}

function renderPaletteResults(query) {
    if(!paletteResults) return;
    paletteResults.innerHTML = '';
    const q = query.toLowerCase();
    
    Object.entries(filesData).forEach(([id, file]) => {
        if(file.name.toLowerCase().includes(q)) {
            const div = document.createElement('div');
            div.className = 'palette-item';
            div.innerHTML = `<span class="icon">${getFileIcon(file.name)}</span> <span style="flex:1;">${file.name}</span> <span class="path">ID: ${id}</span>`;
            div.onclick = () => {
                openFile(id);
                paletteModal.style.display = 'none';
            };
            paletteResults.appendChild(div);
        }
    });
}

// ============================================================================
// 🆕 FEATURE 3 — SHARE ROOM FEATURE (Editor Side)
// ============================================================================

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
            new QRCode(qrCodeEl, { text: url, width: 150, height: 150 });
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

if(btnInvite) {
    btnInvite.onclick = () => {
        if(shareModal && currentRoomId) {
            getDoc(doc(db, 'rooms', currentRoomId)).then(docSnap => {
                if(docSnap.exists()) {
                    const data = docSnap.data();
                    window.openShareModal(data.name, data.roomCode, window.location.href);
                }
            });
        }
    };
}
