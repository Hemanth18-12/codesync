import { auth, db, doc, getDoc, onAuthStateChanged } from './firebase-config.js';

// --- GLOBAL STATE ---
export let editorInstance = null;
export let currentUser = null;
export let currentRoomId = new URLSearchParams(window.location.search).get('room');
export let activeFile = 'main';
export let userPreferences = { theme: 'vs-dark', fontSize: 14, minimap: true, wordWrap: true };
export let isReadOnly = false;

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
