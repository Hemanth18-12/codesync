import { auth, db, doc, getDoc, onAuthStateChanged, collection, addDoc, serverTimestamp, rtdb, ref, set, onValue, push, rtdbUpdate, remove, get } from './firebase-config.js';

const PISTON_API = 'https://emkc.org/api/v2/piston/execute';

// --- GLOBAL STATE ---
export let editorInstance = null;
export let currentUser = null;
export let currentRoomId = new URLSearchParams(window.location.search).get('room');
export let activeFile = 'main';
export let userPreferences = { theme: 'vs-dark', fontSize: 14, minimap: true, wordWrap: true };
export let isReadOnly = false;

export const getActiveFile = () => activeFile;
export const setActiveFile = (fileId) => { activeFile = fileId; };

// Local file system (from old file-system.js) â€” kept as exports for rooms.js compatibility
export let localFilesMap = new Map();
export let saveToLocalFile = async (path, content) => {
    // No-op stub â€” overridden below when user opens a local folder
};

// --- DOM ELEMENTS ---
const monacoContainer = document.getElementById('monaco-container');
const loadingOverlay = document.getElementById('editor-loading');
const btnFormat = document.getElementById('btn-format');
const btnPreview = document.getElementById('btn-preview-toggle');
const previewPanel = document.getElementById('preview-panel');
const previewIframe = document.getElementById('preview-iframe');
const btnRefreshPreview = document.getElementById('btn-refresh-preview');
const tabsContainer = document.getElementById('editor-tabs');

function getPreviewFrame() {
    return document.getElementById('html-preview-frame') || document.getElementById('preview-iframe');
}

// Status Bar â€” use helper functions so null elements don't crash at module load
function getStatusLang()   { return document.getElementById('sb-language'); }
function getStatusCursor() { return document.getElementById('sb-cursor'); }
function getStatusFile()   { return null; }

// Layout
const activityItems = document.querySelectorAll('.activity-item');
const sidebar = document.getElementById('editor-sidebar');
const sidebarPanels = document.querySelectorAll('.sidebar-panel');

// --- TOAST NOTIFICATIONS ---
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'âœ…', error: 'âŒ', warning: 'âš ï¸', info: 'â„¹ï¸' };
    toast.innerHTML = `<span>${icons[type] || 'ðŸ“¢'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, 3700);
};

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
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});

function initMonaco() {
    require(['vs/editor/editor.main'], function () {

        // VS Code Dark+ (default) theme
        monaco.editor.defineTheme('vscode-dark-plus', {
            base: 'vs-dark',
            inherit: true,
            rules: [
                { token: 'comment', foreground: '6A9955' },
                { token: 'comment.keyword', foreground: '6A9955' },
                { token: 'comment.doc', foreground: '6A9955' },
                { token: 'keyword', foreground: '569CD6' },
                { token: 'keyword.control', foreground: '569CD6' },
                { token: 'keyword.operator', foreground: 'D4D4D4' },
                { token: 'keyword.other.important', foreground: '569CD6' },
                { token: 'storage', foreground: '569CD6' },
                { token: 'storage.type', foreground: '569CD6' },
                { token: 'storage.modifier', foreground: '569CD6' },
                { token: 'type', foreground: '4EC9B0' },
                { token: 'type.identifier', foreground: '4EC9B0' },
                { token: 'class', foreground: '4EC9B0' },
                { token: 'identifier', foreground: 'D4D4D4' },
                { token: 'identifier.js', foreground: 'D4D4D4' },
                { token: 'variable', foreground: 'D4D4D4' },
                { token: 'variable.other.readwrite', foreground: 'D4D4D4' },
                { token: 'parameter', foreground: '9CDCFE' },
                { token: 'function', foreground: 'DCDCAA' },
                { token: 'function.declaration', foreground: 'DCDCAA' },
                { token: 'method', foreground: 'DCDCAA' },
                { token: 'number', foreground: 'B5CEA8' },
                { token: 'string', foreground: 'CE9178' },
                { token: 'string.key', foreground: 'CE9178' },
                { token: 'string.value', foreground: 'CE9178' },
                { token: 'regexp', foreground: 'D16969' },
                { token: 'constant', foreground: '4FC1FF' },
                { token: 'constant.language', foreground: '569CD6' },
                { token: 'constant.numeric', foreground: 'B5CEA8' },
                { token: 'constant.character', foreground: 'CE9178' },
                { token: 'variable.language', foreground: '569CD6' },
                { token: 'variable.other.constant', foreground: '4FC1FF' },
                { token: 'variable.other.property', foreground: '9CDCFE' },
                { token: 'entity.name', foreground: 'DCDCAA' },
                { token: 'entity.name.type', foreground: '4EC9B0' },
                { token: 'entity.name.function', foreground: 'DCDCAA' },
                { token: 'entity.name.tag', foreground: '569CD6' },
                { token: 'entity.other.attribute-name', foreground: '9CDCFE' },
                { token: 'support.function', foreground: 'DCDCAA' },
                { token: 'support.type', foreground: '4EC9B0' },
                { token: 'support.constant', foreground: '4FC1FF' },
                { token: 'meta.embedded', foreground: 'D4D4D4' },
                { token: 'meta.tag', foreground: '569CD6' },
                { token: 'meta.tag.js', foreground: '569CD6' },
                { token: 'punctuation', foreground: 'D4D4D4' },
                { token: 'punctuation.definition.tag', foreground: '808080' },
                { token: 'punctuation.definition.string', foreground: 'CE9178' },
                { token: 'punctuation.definition.comment', foreground: '6A9955' },
                { token: 'string.quoted', foreground: 'CE9178' },
                { token: 'string.quoted.variable', foreground: 'CE9178' },
                { token: 'string.regexp', foreground: 'D16969' },
                { token: 'markup.heading', foreground: '569CD6' },
                { token: 'markup.list', foreground: '569CD6' },
                { token: 'markup.bold', foreground: '569CD6', fontStyle: 'bold' },
                { token: 'markup.italic', foreground: '569CD6', fontStyle: 'italic' },
                { token: 'markup.inline.raw', foreground: 'CE9178' },
                { token: 'delimiter', foreground: 'D4D4D4' },
                { token: 'delimiter.html', foreground: '808080' },
                { token: 'delimiter.xml', foreground: '808080' },
                { token: 'tag', foreground: '569CD6' },
                { token: 'tag.id', foreground: '569CD6' },
                { token: 'tag.class', foreground: '9CDCFE' },
                { token: 'attribute.name', foreground: '9CDCFE' },
                { token: 'attribute.value', foreground: 'CE9178' },
                { token: 'property.name', foreground: '9CDCFE' },
                { token: 'property.value', foreground: 'CE9178' },
                { token: 'css.keyword', foreground: '569CD6' },
                { token: 'css.selector', foreground: 'D7BA7D' },
                { token: 'css.property', foreground: '9CDCFE' },
                { token: 'css.value', foreground: 'CE9178' },
                { token: 'css.punctuation', foreground: 'D4D4D4' },
                { token: 'css.class', foreground: 'D7BA7D' },
                { token: 'css.id', foreground: '569CD6' },
                { token: 'css.tag', foreground: '569CD6' },
                { token: 'import.keyword', foreground: '569CD6' },
                { token: 'export.keyword', foreground: '569CD6' },
                { token: 'async', foreground: '569CD6' },
                { token: 'await', foreground: '569CD6' },
                { token: 'from', foreground: '569CD6' },
                { token: 'of', foreground: '569CD6' },
                { token: 'const', foreground: '569CD6' },
                { token: 'let', foreground: '569CD6' },
                { token: 'var', foreground: '569CD6' },
                { token: 'function.js', foreground: 'DCDCAA' },
                { token: 'this', foreground: '569CD6' },
                { token: 'super', foreground: '569CD6' },
                { token: 'class.js', foreground: '4EC9B0' },
                { token: 'new', foreground: '569CD6' },
                { token: 'delete', foreground: '569CD6' },
                { token: 'typeof', foreground: '569CD6' },
                { token: 'instanceof', foreground: '569CD6' },
                { token: 'void', foreground: '569CD6' },
                { token: 'return', foreground: '569CD6' },
                { token: 'if', foreground: '569CD6' },
                { token: 'else', foreground: '569CD6' },
                { token: 'for', foreground: '569CD6' },
                { token: 'while', foreground: '569CD6' },
                { token: 'do', foreground: '569CD6' },
                { token: 'switch', foreground: '569CD6' },
                { token: 'case', foreground: '569CD6' },
                { token: 'break', foreground: '569CD6' },
                { token: 'continue', foreground: '569CD6' },
                { token: 'try', foreground: '569CD6' },
                { token: 'catch', foreground: '569CD6' },
                { token: 'throw', foreground: '569CD6' },
                { token: 'finally', foreground: '569CD6' },
                { token: 'debugger', foreground: '569CD6' },
                { token: 'export', foreground: '569CD6' },
                { token: 'import', foreground: '569CD6' },
                { token: 'default', foreground: '569CD6' },
                { token: 'extends', foreground: '569CD6' },
                { token: 'implements', foreground: '569CD6' },
                { token: 'interface', foreground: '569CD6' },
                { token: 'abstract', foreground: '569CD6' },
                { token: 'static', foreground: '569CD6' },
                { token: 'private', foreground: '569CD6' },
                { token: 'protected', foreground: '569CD6' },
                { token: 'public', foreground: '569CD6' },
                { token: 'readonly', foreground: '569CD6' },
                { token: 'enum', foreground: '569CD6' },
                { token: 'type.keyword', foreground: '569CD6' },
                { token: 'module', foreground: '569CD6' },
                { token: 'namespace', foreground: '569CD6' },
                { token: 'declare', foreground: '569CD6' },
                { token: 'keyof', foreground: '569CD6' },
                { token: 'unknown', foreground: '569CD6' },
                { token: 'any', foreground: '569CD6' },
                { token: 'boolean', foreground: '569CD6' },
                { token: 'number.js', foreground: '569CD6' },
                { token: 'string.js', foreground: '569CD6' },
                { token: 'symbol', foreground: '569CD6' },
                { token: 'undefined', foreground: '569CD6' },
                { token: 'null', foreground: '569CD6' },
                { token: 'never', foreground: '569CD6' },
                { token: 'object', foreground: '569CD6' },
            ],
            colors: {
                'editor.background': '#1e1e1e',
                'editor.foreground': '#d4d4d4',
                'editor.lineHighlightBackground': '#2a2a2a',
                'editor.selectionBackground': '#264f78',
                'editor.inactiveSelectionBackground': '#3a3d41',
                'editorCursor.foreground': '#aeafad',
                'editorCursor.background': '#1e1e1e',
                'editor.selectionHighlightBackground': '#add6ff26',
                'editor.wordHighlightBackground': '#575757',
                'editor.wordHighlightStrongBackground': '#004972',
                'editor.findMatchBackground': '#515c6a',
                'editor.findMatchHighlightBackground': '#3a3d41',
                'editor.findRangeHighlightBackground': '#3a3d4055',
                'editor.hoverHighlightBackground': '#264f78',
                'editorHoverWidget.background': '#252526',
                'editorHoverWidget.border': '#454545',
                'editorSuggestWidget.background': '#252526',
                'editorSuggestWidget.border': '#454545',
                'editorSuggestWidget.selectedBackground': '#264f78',
                'editorSuggestWidget.foreground': '#d4d4d4',
                'editorLink.activeForeground': '#4e94ce',
                'editorLineNumber.foreground': '#858585',
                'editorLineNumber.activeForeground': '#c6c6c6',
                'editorGutter.background': '#1e1e1e',
                'editorRuler.foreground': '#5a5a5a',
                'editorCodeLens.foreground': '#999999',
                'editorBracketMatch.background': '#0d3a58',
                'editorBracketMatch.border': '#678991',
                'editorOverviewRuler.background': '#1e1e1e',
                'editorOverviewRuler.border': '#1e1e1e',
                'editorWidget.background': '#252526',
                'editorWidget.border': '#454545',
                'editorError.foreground': '#f48771',
                'editorError.border': '#e74847',
                'editorWarning.foreground': '#cca700',
                'editorWarning.border': '#cca700',
                'editorInfo.foreground': '#75beff',
                'editorInfo.border': '#75beff',
                'editorHint.foreground': '#75beff',
                'editorBracketPairGuide.background1': '#6b6b6b',
                'editorBracketPairGuide.background2': '#6b6b6b',
                'editorBracketPairGuide.activeBackground1': '#b4b4b4',
                'editorBracketPairGuide.activeBackground2': '#b4b4b4',
                'editorUnnecessaryCode.border': '#4b4b4b',
                'editorUnnecessaryCode.opacity': '#00000066',
                'editorIndentGuide.background': '#404040',
                'editorIndentGuide.activeBackground': '#707070',
                'minimap.background': '#1e1e1e',
                'minimap.selectionHighlight': '#264f78',
                'scrollbar.shadow': '#000000',
                'scrollbarSlider.background': '#424242',
                'scrollbarSlider.hoverBackground': '#535353',
                'scrollbarSlider.activeBackground': '#6e6e6e',
                'badge.background': '#4d4d4d',
                'badge.foreground': '#ffffff',
                'button.background': '#0e639c',
                'button.hoverBackground': '#1177bb',
                'dropdown.background': '#1e1e1e',
                'dropdown.border': '#454545',
                'list.activeSelectionBackground': '#264f78',
                'list.hoverBackground': '#2a2d2e',
                'list.highlightForeground': '#4e94ce',
                'menu.background': '#1e1e1e',
                'menu.foreground': '#cccccc',
                'menu.selectionBackground': '#264f78',
                'menu.separatorBackground': '#454545',
                'titleBar.activeBackground': '#1e1e1e',
                'titleBar.activeForeground': '#cccccc',
                'titleBar.inactiveBackground': '#1e1e1e',
                'titleBar.inactiveForeground': '#6b6b6b',
                'activityBar.background': '#1e1e1e',
                'activityBar.foreground': '#ffffff',
                'activityBar.inactiveForeground': '#6b6b6b',
                'activityBar.border': '#1e1e1e',
                'sideBar.background': '#252526',
                'sideBar.foreground': '#cccccc',
                'sideBar.border': '#1e1e1e',
                'sideBarTitle.foreground': '#bbbbbb',
                'sideBarSectionHeader.background': '#2d2d2d',
                'sideBarSectionHeader.foreground': '#cccccc',
                'statusBar.background': '#007acc',
                'statusBar.foreground': '#ffffff',
                'tab.activeBackground': '#1e1e1e',
                'tab.inactiveBackground': '#2d2d2d',
                'tab.activeForeground': '#ffffff',
                'tab.inactiveForeground': '#8a8a8a',
                'tab.border': '#1e1e1e',
                'tab.activeBorder': '#1e1e1e',
                'tab.activeBorderTop': '#007acc',
                'editorGroupHeader.tabsBackground': '#252526',
                'editorGroupHeader.tabsBorder': '#1e1e1e',
                'panel.background': '#1e1e1e',
                'panel.border': '#1e1e1e',
                'panelTitle.activeForeground': '#ffffff',
                'panelTitle.inactiveForeground': '#8a8a8a',
                'panelTitle.border': '#1e1e1e',
                'input.background': '#1e1e1e',
                'input.foreground': '#cccccc',
                'input.border': '#454545',
                'input.placeholderForeground': '#6b6b6b',
                'inputOption.activeBackground': '#264f78',
                'inputOption.activeBorder': '#264f78',
                'focusBorder': '#007acc',
                'widget.shadow': '#00000066',
                'progressBar.background': '#007acc',
                'debugIcon.breakpointForeground': '#e51400',
                'editorMarkerNavigation.background': '#1e1e1e',
                'editorMarkerNavigationError.background': '#f48771',
                'editorMarkerNavigationWarning.background': '#cca700',
                'editorMarkerNavigationInfo.background': '#75beff',
            }
        });

        editorInstance = monaco.editor.create(monacoContainer, {
            value: "// Loading...",
            language: "javascript",
            theme: userPreferences.theme === 'vs-dark' ? 'vscode-dark-plus' : (userPreferences.theme || 'vscode-dark-plus'),
            fontSize: userPreferences.fontSize || 14,
            fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
            fontLigatures: true,
            minimap: { enabled: userPreferences.minimap !== false },
            wordWrap: userPreferences.wordWrap !== false ? "on" : "off",
            automaticLayout: true,
            readOnly: isReadOnly,
            padding: { top: 16 },
            scrollBeyondLastLine: false,
            renderWhitespace: "selection",
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: true,
            selectionHighlight: true,
            renderLineHighlight: 'all',
            overviewRulerBorder: false,
            glyphMargin: true,
            folding: true,
            foldingStrategy: 'indentation',
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            autoIndent: 'full',
            formatOnPaste: false,
            matchBrackets: 'always',
            bracketPairColorization: { enabled: true },
            guides: { indentationGuides: true, bracketPairs: true, highlightActiveIndentation: true },
            colorDecorators: true,
            inlineSuggest: { enabled: true },
            suggest: { showKeywords: true, showSnippets: true, preview: true },
            suggestFontSize: 13,
            suggestLineHeight: 22,
            wordBasedSuggestions: true,
            parameterHints: { enabled: true, cycle: true },
            hover: { enabled: true, delay: 300, sticky: true },
        });

        // Update status bar cursor pos â€” update both visible and legacy hidden elements
        editorInstance.onDidChangeCursorPosition((e) => {
            const pos = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
            const el1 = document.getElementById('status-position'); if(el1) el1.innerText = pos;
            const el2 = document.getElementById('status-cursor');   if(el2) el2.innerText = pos;
        });

        // Add Format shortcut (Shift+Alt+F)
        editorInstance.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, formatCode);

        // Make editor globally accessible for safety
        window.monacoEditor = editorInstance;
        window.editorInstance = editorInstance;
        window.__monacoReady = true;

        // Dispatch custom event to notify other modules Monaco is ready
        window.dispatchEvent(new CustomEvent('monaco-ready'));
        
        hideLoadingScreen();
    });
}

function hideLoadingScreen() {
  const loadingElements = document.querySelectorAll('.editor-loading, #editor-loading, [id*="loading"], [id*="sync"]');
  loadingElements.forEach(el => {
    el.style.transition = 'opacity 0.5s ease';
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; }, 500);
  });
}

// --- EXPORTED METHODS FOR OTHER MODULES ---
export function setEditorContent(content, language, fileId) {
    if (!editorInstance) return;
    
    activeFile = fileId;
    const sf = getStatusFile(); if(sf) sf.innerText = fileId;
    
    // Update language model
    const langMap = {
        'js': 'javascript', 'ts': 'typescript', 'html': 'html',
        'css': 'css', 'json': 'json', 'py': 'python', 'md': 'markdown'
    };
    
    let ext = fileId.split('.').pop().toLowerCase();
    let mappedLang = langMap[ext] || language || 'plaintext';
    
    if (fileId === 'main') mappedLang = language || 'javascript'; // legacy support
    
    monaco.editor.setModelLanguage(editorInstance.getModel(), mappedLang);
    const displayName = mappedLang.charAt(0).toUpperCase() + mappedLang.slice(1);
    const sl = getStatusLang(); if(sl) sl.innerText = displayName;
    const slang2 = document.getElementById('sb-language'); if(slang2) slang2.innerText = displayName;
    
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

// Safety timeout â€” force-hide the loading screen after 10s
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
    const pp = document.getElementById('preview-panel');
    const pi = getPreviewFrame();
    if (!pi) return;
    if (pp && !pp.classList.contains('active')) return;
    
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(() => {
        let finalHtml = content;
        
        if (lang === 'javascript') {
            // Wrap in basic HTML to execute â€” use srcdoc to avoid CORS
            finalHtml = `<!DOCTYPE html><html><body><script>${content.replace(/<\/script>/gi,'<\\/script>')}<\/script></body></html>`;
        } else if (lang === 'markdown') {
            finalHtml = `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;white-space:pre-wrap;">${content}</body></html>`;
        }
        
        // CORS-safe: use srcdoc instead of contentDocument.write()
        pi.srcdoc = finalHtml;
    }, 1000); // 1s debounce
}

if (btnPreview) {
    btnPreview.addEventListener('click', () => {
        const pp = document.getElementById('preview-panel');
        if (!pp && typeof switchBottomTab === 'function') {
            document.getElementById('preview-tab-btn')?.style.setProperty('display', 'flex');
            switchBottomTab('preview');
            if(editorInstance) updatePreview(editorInstance.getValue(), editorInstance.getModel().getLanguageId());
            return;
        }
        if (!pp) return;
        pp.classList.toggle('active');
        if (pp.classList.contains('active')) {
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

    if (typeof showToast !== 'undefined') showToast('ðŸ“¸ Snapshot saved!', 'success');
  } catch (error) {
    console.error('Snapshot error:', error);
    if (typeof showToast !== 'undefined') showToast('Failed to save snapshot', 'error');
  }
};

// ============================================================================
// ðŸ†• FEATURE 1 â€” VS CODE STYLE FILE SYSTEM
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

const langColors = {
  javascript: '#F7DF1E',
  typescript: '#3178C6',
  python:     '#3776AB',
  java:       '#ED8B00',
  cpp:        '#00599C',
  c:          '#A8B9CC',
  csharp:     '#239120',
  go:         '#00ADD8',
  rust:       '#CE422B',
  php:        '#777BB4',
  ruby:       '#CC342D',
  html:       '#E34F26',
  css:        '#1572B6',
  scss:       '#CC6699',
  swift:      '#FA7343',
  kotlin:     '#7F52FF',
  bash:       '#4EAA25',
  shell:      '#4EAA25',
  sql:        '#336791',
  markdown:   '#083FA1',
  json:       '#CBCB41',
  yaml:       '#CC1018',
  xml:        '#F16529',
  dockerfile: '#0DB7ED',
  plaintext:  '#C5C5C5',
  r:          '#198CE7'
};

const langToExt = {
  javascript: 'js',
  typescript: 'ts',
  python:     'py',
  java:       'java',
  cpp:        'cpp',
  c:          'c',
  csharp:     'cs',
  go:         'go',
  rust:       'rs',
  php:        'php',
  ruby:       'rb',
  html:       'html',
  css:        'css',
  scss:       'scss',
  swift:      'swift',
  kotlin:     'kt',
  bash:       'sh',
  shell:      'sh',
  sql:        'sql',
  markdown:   'md',
  json:       'json',
  yaml:       'yml',
  xml:        'xml',
  dockerfile: 'dockerfile',
  r:          'r',
  plaintext:  'txt'
};

function getFileIconHTML(filename) {
  if (window.fileIcons) {
    const iconClass = window.fileIcons
      .getClassWithColor(filename);
    if (iconClass) {
      return `<i class="${iconClass}" 
        style="font-size:14px;
        width:16px;height:16px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex-shrink:0;"></i>`;
    }
  }

  const ext = filename.toLowerCase()
    .split('.').pop();

  const svgIcons = {
    js: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#F7DF1E"/>
      <text x="3" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#000">JS</text>
    </svg>`,

    ts: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#3178C6"/>
      <text x="3" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">TS</text>
    </svg>`,

    py: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#3776AB"/>
      <text x="3" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">PY</text>
    </svg>`,

    java: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#ED8B00"/>
      <text x="1" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">JAVA</text>
    </svg>`,

    cpp: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#00599C"/>
      <text x="1" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">C++</text>
    </svg>`,

    c: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#A8B9CC"/>
      <text x="4" y="13" 
        font-size="10" font-weight="bold"
        font-family="monospace" 
        fill="#000">C</text>
    </svg>`,

    cs: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#239120"/>
      <text x="2" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">C#</text>
    </svg>`,

    go: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#00ADD8"/>
      <text x="2" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">GO</text>
    </svg>`,

    rs: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#CE422B"/>
      <text x="2" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">RS</text>
    </svg>`,

    php: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#777BB4"/>
      <text x="1" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">PHP</text>
    </svg>`,

    rb: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#CC342D"/>
      <text x="2" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">RB</text>
    </svg>`,

    html: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#E34F26"/>
      <text x="1" y="12" 
        font-size="7" font-weight="bold"
        font-family="monospace" 
        fill="#fff">HTML</text>
    </svg>`,

    css: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#1572B6"/>
      <text x="2" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">CSS</text>
    </svg>`,

    scss: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#CC6699"/>
      <text x="1" y="12" 
        font-size="7" font-weight="bold"
        font-family="monospace" 
        fill="#fff">SCSS</text>
    </svg>`,

    json: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#CBCB41"/>
      <text x="1" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#000">JSON</text>
    </svg>`,

    md: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#083FA1"/>
      <text x="2" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">MD</text>
    </svg>`,

    sql: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#336791"/>
      <text x="1" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">SQL</text>
    </svg>`,

    sh: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#4EAA25"/>
      <text x="3" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">SH</text>
    </svg>`,

    yml: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#CC1018"/>
      <text x="1" y="12" 
        font-size="7" font-weight="bold"
        font-family="monospace" 
        fill="#fff">YAML</text>
    </svg>`,

    xml: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#F16529"/>
      <text x="2" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#fff">XML</text>
    </svg>`,

    swift: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#FA7343"/>
      <text x="1" y="12" 
        font-size="7" font-weight="bold"
        font-family="monospace" 
        fill="#fff">SWIFT</text>
    </svg>`,

    kt: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#7F52FF"/>
      <text x="3" y="13" 
        font-size="9" font-weight="bold"
        font-family="monospace" 
        fill="#fff">KT</text>
    </svg>`,

    txt: `<svg width="16" height="16" 
      viewBox="0 0 16 16">
      <rect width="16" height="16" 
        rx="2" fill="#C5C5C5"/>
      <text x="2" y="13" 
        font-size="8" font-weight="bold"
        font-family="monospace" 
        fill="#333">TXT</text>
    </svg>`
  };

  return svgIcons[ext] 
    || `<svg width="16" height="16" 
        viewBox="0 0 16 16">
        <rect width="16" height="16" 
          rx="2" fill="#C5C5C5"/>
        <text x="2" y="13" 
          font-size="8" font-weight="bold"
          font-family="monospace" 
          fill="#333">
          ${ext.toUpperCase()
            .substring(0,3)}
        </text>
      </svg>`;
}

function getDefaultContent(filename) {
  const ext = filename
    .toLowerCase()
    .split('.')
    .pop();

  const defaults = {
    'html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" 
      content="width=device-width, 
      initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    <h1>Hello World</h1>
</body>
</html>`,

    'css': `/* Styles */
body {
    margin: 0;
    padding: 0;
    font-family: sans-serif;
}`,

    'js': `// JavaScript
console.log('Hello, World!');`,

    'ts': `// TypeScript
const message: string = 'Hello, World!';
console.log(message);`,

    'py': `# Python
print("Hello, World!")`,

    'java': `public class Main {
    public static void main(
        String[] args) {
        System.out.println(
            "Hello, World!");
    }
}`,

    'cpp': `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    return 0;
}`,

    'c': `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    return 0;
}`,

    'cs': `using System;

class Program {
    static void Main() {
        Console.WriteLine(
            "Hello, World!");
    }
}`,

    'go': `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}`,

    'rs': `fn main() {
    println!("Hello, World!");
}`,

    'php': `<?php
echo "Hello, World!";
?>`,

    'rb': `puts "Hello, World!"`,

    'swift': `print("Hello, World!")`,

    'kt': `fun main() {
    println("Hello, World!")
}`,

    'sh': `#!/bin/bash
echo "Hello, World!"`,

    'sql': `-- SQL Query
SELECT 'Hello, World!' AS message;`,

    'json': `{
    "message": "Hello, World!"
}`,

    'md': `# Title

Hello, World!`,

    'xml': `<?xml version="1.0" 
  encoding="UTF-8"?>
<root>
    <message>Hello, World!</message>
</root>`
  };

  return defaults[ext] 
    || `// New file: ${filename}`;
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
    header.innerHTML = `<span class="arrow">▶</span><span class="icon">ðŸ“</span><span class="name">${folder.name}</span>`;
    
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
        arrow.innerText = header.classList.contains('open') ? 'â–¼' : '▶';
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
    const iconHTML = getFileIconHTML(file.name);
    div.innerHTML = `
      <div class="file-item" 
        data-file-id="${id}"
        style="display:flex;
        align-items:center;
        gap:6px;
        padding:3px 8px 3px 8px;
        cursor:pointer;
        border-radius:4px;
        transition:background 0.1s;
        font-size:13px;
        font-family:'Inter',sans-serif;
        color:#c0caf5;">
        ${iconHTML}
        <span style="flex:1;
          overflow:hidden;
          text-overflow:ellipsis;
          white-space:nowrap;">
          ${file.name}
        </span>
      </div>
    `;
    
    div.onclick = (e) => {
        e.stopPropagation();
        openFile(id);
    };
    div.oncontextmenu = (e) => showContextMenu(e, id, 'file');
    return div;
}

// 3. File Operations (Inline Input)
function showInlineInput(parentId, type, action, targetId = null, existingName = '') {
    const inputContainer = document.createElement('div');
    inputContainer.className = 'tree-input-container';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = existingName;
    input.placeholder = type === 'folder' ? 'Folder Name' : 'File Name (e.g. index.js)';
    
    inputContainer.appendChild(input);
    
    let attachTarget = fileTreeDOM;
    if (parentId) {
        const parentChildren = document.getElementById(`folder-children-${parentId}`);
        if (parentChildren) {
            parentChildren.classList.add('open');
            const parentItem = document.querySelector(`.folder-item[data-id="${parentId}"]`);
            if (parentItem) {
                parentItem.classList.add('open');
                parentItem.querySelector('.arrow').innerText = 'â–¼';
            }
            attachTarget = parentChildren;
        }
    } else if (action === 'rename' && targetId) {
        const targetEl = document.querySelector(`[data-id="${targetId}"]`);
        if (targetEl) {
            targetEl.style.display = 'none';
            targetEl.parentNode.insertBefore(inputContainer, targetEl);
        }
    }
    
    if (action !== 'rename') {
        attachTarget.prepend(inputContainer);
    }
    
    input.focus();
    
    let isFinished = false;
    const finish = async (save) => {
        if (isFinished) return;
        isFinished = true;
        
        const val = input.value.trim();
        if (action === 'rename' && targetId) {
            const targetEl = document.querySelector(`[data-id="${targetId}"]`);
            if (targetEl) targetEl.style.display = '';
        }
        inputContainer.remove();
        
        if (save && val && val !== existingName) {
            if (action === 'rename') {
                const path = type === 'file' ? 'files' : 'folders';
                await rtdbUpdate(ref(rtdb, `rooms/${currentRoomId}/filesystem/${path}/${targetId}`), { name: val });
            } else if (action === 'create') {
                const path = type === 'file' ? 'files' : 'folders';
                const newRef = push(ref(rtdb, `rooms/${currentRoomId}/filesystem/${path}`));
                
                const data = {
                    name: val,
                    createdBy: auth.currentUser?.uid || 'anonymous',
                    createdAt: new Date().toISOString()
                };
                
                if (type === 'file') {
                    const lang = getFileLanguage(val);
                    data.content = getDefaultContent(val);
                    data.language = lang;
                    data.parentFolderId = parentId;
                    data.updatedAt = new Date().toISOString();
                } else {
                    data.parentId = parentId;
                }
                
                // --- Sync to Local Disk if Folder is Opened ---
                if (window.localDirectoryHandle) {
                    try {
                        if (type === 'file') {
                            const newHandle = await window.localDirectoryHandle.getFileHandle(val, { create: true });
                            // Re-read local directory to update handles
                            const treeDOM = document.getElementById('file-tree');
                            if(treeDOM) {
                                treeDOM.innerHTML = '';
                                localFilesMap.clear();
                                await readLocalDirectory(window.localDirectoryHandle, '', treeDOM);
                            }
                        } else {
                            await window.localDirectoryHandle.getDirectoryHandle(val, { create: true });
                        }
                    } catch (err) {
                        console.error('Failed to create locally:', err);
                    }
                }
                
                await set(newRef, data);
                if (type === 'file') openFile(newRef.key);
            }
        }
    };
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
}

function createNewFolder(parentId = null) { showInlineInput(parentId, 'folder', 'create'); }
function createNewFile(parentId = null) { showInlineInput(parentId, 'file', 'create'); }

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
    
    const btnNewFileCtx = document.getElementById('ctx-new-file');
    if (btnNewFileCtx) btnNewFileCtx.style.display = type === 'folder' ? 'block' : 'none';
    
    const btnNewFolderCtx = document.getElementById('ctx-new-folder');
    if (btnNewFolderCtx) btnNewFolderCtx.style.display = type === 'folder' ? 'block' : 'none';
}

if(ctxMenu) {
    const cnf = document.getElementById('ctx-new-file'); if (cnf) cnf.onclick = () => showInlineInput(contextTargetId, 'file', 'create');
    const cnfld = document.getElementById('ctx-new-folder'); if (cnfld) cnfld.onclick = () => createNewFolder(contextTargetId);
    const crn = document.getElementById('ctx-rename'); if (crn) crn.onclick = () => {
        const existingName = document.querySelector(`[data-id="${contextTargetId}"] .name`)?.innerText || '';
        showInlineInput(null, contextTargetType, 'rename', contextTargetId, existingName);
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

        // Update global language tracker
        window.currentLanguage = mappedLang;
        
        // Update compiler badge
        updateCompilerBadges(mappedLang);
        
        // Update panel lang badge
        if (typeof updatePanelLangBadge 
            === 'function') {
          updatePanelLangBadge(mappedLang);
        }
        
        // Focus the editor
        editorInstance.focus();
        
        const el = document.getElementById('sb-language'); if(el) el.innerText = mappedLang;
        const sf = document.getElementById('status-file'); if(sf) sf.innerText = file.name;
    }
    
    renderFileTree();
    renderFSTabsUI();
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
    renderFSTabsUI();
}

function renderFSTabsUI() {
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
            <span class="tab-close">Ã—</span>
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
                await rtdbUpdate(ref(rtdb, `rooms/${currentRoomId}/filesystem/files/${activeTabId}`), {
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
            paletteModal.classList.add('active');
            paletteInput.focus();
            paletteInput.value = '';
            renderPaletteResults('');
        }
    }
    if (e.key === 'Escape' && paletteModal && paletteModal.classList.contains('active')) {
        paletteModal.classList.remove('active');
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
            div.innerHTML = `<span class="icon">${getFileIconHTML(file.name)}</span> <span style="flex:1;">${file.name}</span> <span class="path">ID: ${id}</span>`;
            div.onclick = () => {
                openFile(id);
                paletteModal.style.display = 'none';
            };
            paletteResults.appendChild(div);
        }
    });
}

// ============================================================================
// ðŸ†• FEATURE 3 â€” SHARE ROOM FEATURE (Editor Side)
// ============================================================================

window.openShareModal = (roomName, code, url) => {
    const modal = document.getElementById('share-modal');
    if (!modal) return;
    
    const srn = document.getElementById('share-room-name'); if (srn) srn.textContent = roomName;
    const src = document.getElementById('share-room-code'); if (src) src.textContent = code;
    const sru = document.getElementById('share-room-url'); if (sru) sru.value = url;
    
    const bcc = document.getElementById('btn-share-copy-code');
    if (bcc) {
      bcc.onclick = () => {
        navigator.clipboard.writeText(code);
        showToast('Room code copied!', 'success');
      };
    }
    
    const bcu = document.getElementById('btn-share-copy-url');
    if (bcu) {
      bcu.onclick = () => {
        navigator.clipboard.writeText(url);
        showToast('URL copied to clipboard!', 'success');
      };
    }
    
    document.getElementById('share-wa').onclick = () => {
        const text = encodeURIComponent(`ðŸš€ Join me on CodeSync!\n\nRoom: ${roomName}\nCode: ${code}\n\nJoin here: ${url}\n\nCodeSync â€” Real-time collaborative code editor`);
        window.open(`https://wa.me/?text=${text}`, '_blank');
    };
    
    document.getElementById('share-tg').onclick = () => {
        const text = encodeURIComponent(`ðŸš€ Join my CodeSync room!\nRoom: ${roomName} | Code: ${code}`);
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`, '_blank');
    };
    
    document.getElementById('share-tw').onclick = () => {
        const text = encodeURIComponent(`Coding together on CodeSync! ðŸš€\nRoom: ${roomName} | Code: ${code}\nJoin me: ${url}\n#CodeSync #Coding #Collaboration`);
        window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
    };
    
    document.getElementById('share-li').onclick = () => {
        window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`, '_blank');
    };
    
    document.getElementById('share-em').onclick = () => {
        const subject = encodeURIComponent(`Join my CodeSync Room: ${roomName}`);
        const body = encodeURIComponent(`Hi!\n\nI'd like to invite you to collaborate on CodeSync.\n\nRoom Name: ${roomName}\nRoom Code: ${code}\nDirect Link: ${url}\n\nSteps to join:\n1. Go to ${window.location.origin}\n2. Sign in or create account\n3. Enter room code: ${code}\n\nSee you there! ðŸš€`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
    };
    
    document.getElementById('share-ig').onclick = () => {
        navigator.clipboard.writeText(`ðŸš€ Join my CodeSync room!\nRoom Code: ${code}\nDownload and join at: ${window.location.origin}`);
        showToast('ðŸ“‹ Copied for Instagram! Paste in your story or DM', 'success');
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

// ============================================================================
// ðŸ“‚ LOCAL FOLDER OPEN (replaces old file-system.js module)
// ============================================================================
let localDirectoryHandle = null;

const btnOpenFolder = document.getElementById('btn-open-folder');
if(btnOpenFolder) btnOpenFolder.addEventListener('click', openLocalFolder);

async function openLocalFolder() {
    if (isReadOnly) { alert('This room is read-only.'); return; }
    try {
        if (!window.showDirectoryPicker) {
            alert('Your browser does not support the File System Access API. Please use Chrome, Edge or Opera.');
            return;
        }
        localDirectoryHandle = await window.showDirectoryPicker();
        window.localDirectoryHandle = localDirectoryHandle;
        localFilesMap.clear();
        if(fileTreeDOM) fileTreeDOM.innerHTML = '';
        await readLocalDirectory(localDirectoryHandle, '', fileTreeDOM);
    } catch (e) {
        if (e.name !== 'AbortError') { console.error(e); alert('Failed to open directory.'); }
    }
}

async function readLocalDirectory(dirHandle, path, parentEl) {
    if(!parentEl) return;
    const entries = [];
    for await (const entry of dirHandle.values()) {
        if (['node_modules', '.git', '.firebase', 'dist', 'build'].includes(entry.name)) continue;
        entries.push(entry);
    }
    entries.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === 'directory' ? -1 : 1;
    });

    for (const entry of entries) {
        const currentPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
            const folderDiv = document.createElement('div');
            const hdr = document.createElement('div');
            hdr.className = 'tree-item';
            hdr.innerHTML = `<span class="arrow">▶</span><span class="icon">ðŸ“</span><span class="name">${entry.name}</span>`;
            const children = document.createElement('div');
            children.className = 'folder-children';
            hdr.onclick = () => {
                hdr.classList.toggle('open');
                children.classList.toggle('open');
                hdr.querySelector('.arrow').innerText = hdr.classList.contains('open') ? 'â–¼' : '▶';
            };
            folderDiv.appendChild(hdr);
            folderDiv.appendChild(children);
            parentEl.appendChild(folderDiv);
            await readLocalDirectory(entry, currentPath, children);
        } else {
            localFilesMap.set(currentPath, entry);
            const fileDiv = document.createElement('div');
            fileDiv.className = 'tree-item';
            const icon = getFileIcon(entry.name);
            fileDiv.innerHTML = `<span class="icon">${icon}</span><span class="name">${entry.name}</span>`;
            fileDiv.onclick = () => window.openLocalFile(currentPath);
            parentEl.appendChild(fileDiv);
        }
    }
}

// Override saveToLocalFile to actually write to disk
saveToLocalFile = async (path, content) => {
    if (!localDirectoryHandle) return;
    const handle = localFilesMap.get(path);
    if (!handle) return;
    try {
        const perm = await handle.queryPermission({mode: 'readwrite'});
        if (perm !== 'granted') {
            const np = await handle.requestPermission({mode: 'readwrite'});
            if (np !== 'granted') return;
        }
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
    } catch (e) { console.error('Failed to save to local file system', e); }
};

window.openLocalFile = async (path) => {
    if (isReadOnly) { alert('This room is read-only.'); return; }
    const handle = localFilesMap.get(path);
    if (!handle) return;
    try {
        const file = await handle.getFile();
        const content = await file.text();
        const lang = getFileLanguage(path.split('/').pop());
        await set(ref(rtdb, `rooms/${currentRoomId}/workspace/${path.replace(/\\//g, '_')}`), {
            content, language: lang, originalPath: path
        });
    } catch (e) { console.error('Error reading file', e); }
};

// ============================================================================
// ðŸ–¥ï¸ COMPILER & TERMINAL â€” implemented below in the NEW COMPILER section
// ============================================================================

// Compat shims: old code may call these; new implementations are at bottom of file


const PISTON_LANGUAGES = {
  javascript: { language: 'javascript', version: '18.15.0', fileName: 'main.js' },
  typescript: { language: 'typescript', version: '5.0.3', fileName: 'main.ts' },
  python: { language: 'python', version: '3.10.0', fileName: 'main.py' },
  java: { language: 'java', version: '15.0.2', fileName: 'Main.java' },
  cpp: { language: 'c++', version: '10.2.0', fileName: 'main.cpp' },
  c: { language: 'c', version: '10.2.0', fileName: 'main.c' },
  csharp: { language: 'csharp', version: '6.12.0', fileName: 'main.cs' },
  go: { language: 'go', version: '1.16.2', fileName: 'main.go' },
  rust: { language: 'rust', version: '1.50.0', fileName: 'main.rs' },
  php: { language: 'php', version: '8.0.2', fileName: 'main.php' },
  ruby: { language: 'ruby', version: '3.0.1', fileName: 'main.rb' },
  swift: { language: 'swift', version: '5.3.3', fileName: 'main.swift' },
  kotlin: { language: 'kotlin', version: '1.4.31', fileName: 'main.kt' },
  bash: { language: 'bash', version: '5.1.0', fileName: 'main.sh' },
  r: { language: 'r', version: '4.1.1', fileName: 'main.r' }
};

// MAIN RUN CODE FUNCTION
const runJSLocally = (code, stdin) => {
  return new Promise((resolve) => {
    const logs = [];
    const errors = [];
    const startTime = performance.now();
    let isDone = false;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = 'display:none;width:0;height:0;position:absolute;left:-9999px;';
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.removeEventListener('message', messageHandler);
      clearTimeout(timeoutId);
      setTimeout(() => {
        try { if (document.body.contains(iframe)) document.body.removeChild(iframe); } catch(e) {}
      }, 100);
    };

    const finish = () => {
      if (isDone) return;
      isDone = true;
      cleanup();
      resolve({
        stdout: logs.join('\n'),
        stderr: errors.join('\n'),
        time: ((performance.now() - startTime) / 1000).toFixed(3),
        status: errors.length ? 'Runtime Error' : 'Accepted'
      });
    };

    const messageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || !data.__csCompiler) return;
      if (data.type === 'log')   logs.push(String(data.value ?? ''));
      if (data.type === 'error') errors.push(String(data.value ?? ''));
      if (data.type === 'done')  finish();
    };

    window.addEventListener('message', messageHandler);

    const timeoutId = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      cleanup();
      resolve({ stdout: logs.join('\n'), stderr: 'â± Execution timed out (10s)', time: '10.000', status: 'Time Limit Exceeded' });
    }, 10000);

    const stdinArr = stdin ? stdin.split('\n') : [];
    const stdinJson = JSON.stringify(stdinArr);
    const safeCode = code.replace(/<\/script>/gi, '<\\/script>');

    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>'
      + '(function(){'
      + 'var __p=window.parent;'
      + 'var __s=function(t,v){try{__p.postMessage({__csCompiler:true,type:t,value:v},"*");}catch(e){}};'
      + 'var __fmt=function(v){if(v===null)return"null";if(v===undefined)return"undefined";if(typeof v==="object"){try{return JSON.stringify(v,null,2);}catch(e){return String(v);}}return String(v);};'
      + 'var __fmtAll=function(a){return Array.from(a).map(__fmt).join(" ");};'
      + 'window.console={'
      + '  log:function(){__s("log",__fmtAll(arguments));}'
      + ', error:function(){__s("error",__fmtAll(arguments));}'
      + ', warn:function(){__s("log","\u26a0 "+__fmtAll(arguments));}'
      + ', info:function(){__s("log","\u2139 "+__fmtAll(arguments));}'
      + ', table:function(d){try{__s("log",JSON.stringify(d,null,2));}catch(e){__s("log",String(d));}}'
      + ', dir:function(d){__s("log",__fmt(d));}'
      + ', clear:function(){}'
      + '};'
      + 'window.alert=function(m){__s("log","alert: "+String(m));};'
      + 'window.confirm=function(){return true;};'
      + 'var __stdinLines=' + stdinJson + ';'
      + 'window.prompt=function(m){if(m)__s("log",String(m));return __stdinLines.shift()||"";};'
      + 'try{'
      + safeCode
      + ';__s("done",null);'
      + '}catch(e){'
      + '__s("error",(e.name||"Error")+": "+e.message);'
      + '__s("done",null);'
      + '}'
      + '})();'
      + '<\/script></body></html>';

    iframe.srcdoc = html;
  });
};




// Run with Piston API (FREE - no key needed)
const runWithPiston = async (code, language, stdin) => {
  const lang = PISTON_LANGUAGES[language] || PISTON_LANGUAGES[language.toLowerCase()];
  if (!lang) {
    return { stdout: '', stderr: `Language "${language}" not supported yet` };
  }

  const response = await fetch(PISTON_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: lang.language,
      version: lang.version,
      files: [{ name: lang.fileName, content: code }],
      stdin: stdin || '',
      args: [],
      compile_timeout: 10000,
      run_timeout: 10000
    })
  });

  if (!response.ok) {
    throw new Error(`Piston API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    stdout: data.run?.stdout || '',
    stderr: data.run?.stderr || data.compile?.stderr || '',
    time: data.run?.code === 0 ? 'Success' : 'Error'
  };
};

// Run HTML in preview panel
const runHTMLPreview = (code) => {
  // Switch to OUTPUT tab
  switchBottomTab('output');
  
  const outputEl = document.getElementById(
    'output-lines');
  if (!outputEl) return { 
    stdout: '', stderr: '' 
  };

  // Clear existing output
  outputEl.innerHTML = '';

  // Header line
  const header = document.createElement('div');
  header.className = 'output-line type-info';
  header.textContent = 
    '▶ HTML — Rendered Output';
  outputEl.appendChild(header);

  const divider = document.createElement('div');
  divider.className = 'output-line type-divider';
  divider.textContent = '─'.repeat(50);
  outputEl.appendChild(divider);

  // Create wrapper div
  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    flex: 1;
    padding: 8px;
    height: 150px;
    min-height: 120px;
  `;

  // Create CORS-safe iframe using srcdoc ONLY
  // NEVER use src= or contentDocument
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    width: 100%;
    height: 100%;
    border: 1px solid #2d2f45;
    border-radius: 6px;
    background: white;
  `;
  
  // srcdoc is CORS-safe — no cross-origin issue
  iframe.srcdoc = code;
  
  wrapper.appendChild(iframe);
  outputEl.appendChild(wrapper);

  // Make panel taller for HTML preview
  const panel = document.getElementById(
    'bottom-panel');
  if (panel) {
    const currentH = parseInt(
      window.getComputedStyle(panel).height);
    if (currentH < 300) {
      panel.style.height = '320px';
    }
  }

  return { 
    stdout: 'HTML rendered', 
    stderr: '' 
  };
};

// OUTPUT PANEL FUNCTIONS
const appendOutput = (type, text) => {
  const output = 
    document.getElementById('output-content')
    || document.querySelector('.output-area')
    || document.getElementById('compiler-output')
    || document.getElementById('terminal-output');
  if (!output) return;

  if (type === 'divider') {
    const div = document.createElement('div');
    div.style.cssText = `
      color: #2d2f45;
      padding: 2px 12px;
      font-size: 11px;
      font-family: 'JetBrains Mono',monospace;
      user-select: none;
    `;
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
    return;
  }

  const config = {
    output:  { 
      color: '#c0caf5', 
      prefix: '' 
    },
    error:   { 
      color: '#f7768e', 
      prefix: '✕ ',
      bg: 'rgba(247,118,142,0.05)'
    },
    warn:    { 
      color: '#e0af68', 
      prefix: 'âš  ' 
    },
    success: { 
      color: '#9ece6a', 
      prefix: '✓ ' 
    },
    info:    { 
      color: '#7aa2f7', 
      prefix: 'â„¹ ' 
    },
    muted:   { 
      color: '#565f89', 
      prefix: '' 
    },
    input:   { 
      color: '#bb9af7', 
      prefix: 'â¯ ' 
    }
  };

  const cfg = config[type] 
    || config.output;
  
  const line = document.createElement('div');
  line.style.cssText = `
    color: ${cfg.color};
    background: ${cfg.bg || 'transparent'};
    padding: 1px 12px;
    font-size: 13px;
    line-height: 1.7;
    font-family: 'JetBrains Mono', monospace;
    white-space: pre-wrap;
    word-break: break-word;
    animation: lineSlideIn 0.12s ease;
    border-left: ${cfg.bg 
      ? '2px solid ' + cfg.color 
      : '2px solid transparent'};
  `;
  
  line.textContent = cfg.prefix + text;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
};

const clearOutput = () => {
  const output = document.getElementById('output-content') || document.getElementById('compiler-output') || document.querySelector('.output-area');
  if (output) output.innerHTML = '';
};

// TERMINAL (interactive, type and run)
const terminal = {
  history: [],
  historyIndex: -1,
  
  init() {
    const input = document.getElementById(
      'terminal-input-field');
    if (!input) {
      console.warn('Terminal input not found: terminal-input-field');
      return;
    }

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = input.value.trim();
        if (!cmd) return;

        this.history.unshift(cmd);
        this.historyIndex = -1;
        input.value = '';

        this.appendLine('input', cmd);
        await this.execute(cmd);
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          input.value = this.history[this.historyIndex];
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          input.value = this.history[this.historyIndex];
        } else {
          this.historyIndex = -1;
          input.value = '';
        }
      }
    });
  },

  async execute(cmd) {
    const lang = window.currentLanguage 
      || document.getElementById(
        'sb-language')?.innerText
        ?.toLowerCase() 
      || 'javascript';
    const stdin = document.getElementById('stdin-input')?.value || '';

    this.appendLine('info', `Running ${lang}...`);

    try {
      let result;
      if (lang === 'javascript') {
        result = await runJSLocally(cmd, stdin);
      } else {
        result = await runWithPiston(cmd, lang, stdin);
      }

      if (result.stdout) {
        result.stdout.split('\n').forEach(l => {
          if (l.trim()) this.appendLine('output', l);
        });
      }
      if (result.stderr) {
        result.stderr.split('\n').forEach(l => {
          if (l.trim()) this.appendLine('error', l);
        });
      }
      if (!result.stdout && !result.stderr) {
        this.appendLine('muted', 'No output');
      }
    } catch (err) {
      this.appendLine('error', err.message);
    }
  },

  appendLine(type, text) {
    const termOut = document.getElementById('terminal-output') || document.querySelector('.terminal-output');
    if (!termOut) return;

    const colors = {
      input: '#bb9af7', output: '#c0caf5', error: '#f7768e',
      warn: '#e0af68', info: '#7aa2f7', muted: '#565f89'
    };

    const prefixes = {
      input: 'â¯ ', output: '  ', error: '✕ ', warn: 'âš  ', info: 'â„¹ ', muted: '  '
    };

    const line = document.createElement('div');
    line.style.cssText = `
      color: ${colors[type] || '#c0caf5'};
      padding: 1px 12px;
      font-size: 13px;
      line-height: 1.6;
      font-family: 'JetBrains Mono', monospace;
      white-space: pre-wrap;
    `;
    line.textContent = (prefixes[type] || '') + text;
    
    termOut.appendChild(line);
    termOut.scrollTop = termOut.scrollHeight;
  },

  clear() {
    const termOut = document.getElementById('terminal-output');
    if (termOut) {
      termOut.innerHTML = `
        <div style="color:#565f89; padding:8px 12px; font-size:12px; font-family:'JetBrains Mono'">
          CodeSync Terminal â€” Type code + Enter to run
        </div>`;
    }
  }
};

// RUN BUTTON STATE
const setRunButtonState = (state) => {
  const btns = document.querySelectorAll('.run-btn, #run-btn, [id*="run"]');
  
  btns.forEach(btn => {
    btn.className = btn.className.replace(/running|success|error/g, '').trim();
    
    switch(state) {
      case 'running':
        btn.classList.add('running');
        btn.innerHTML = '<span class="spinner"></span> Running...';
        btn.disabled = true;
        break;
      case 'success':
        btn.classList.add('success');
        btn.innerHTML = '✓ Done';
        btn.disabled = false;
        break;
      case 'error':
        btn.classList.add('error');
        btn.innerHTML = '✕ Error';
        btn.disabled = false;
        break;
      default:
        btn.innerHTML = '▶ Run';
        btn.disabled = false;
    }
  });
};

// TAB SWITCHING
const switchTab = (tabName) => {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-content, [id^="tab-"]').forEach(c => c.style.display = 'none');

  const tab = document.querySelector(`[data-target="tab-${tabName}"]`) || document.querySelector(`[data-tab="${tabName}"]`);
  const content = document.getElementById(`tab-${tabName}`) || document.getElementById(`panel-${tabName}`);

  if (tab) tab.classList.add('active');
  if (content) content.style.display = 'flex';
};

// GET LANGUAGE DISPLAY NAME
const getLanguageDisplayName = (lang) => {
  const names = {
    javascript: 'JavaScript', typescript: 'TypeScript', python: 'Python 3',
    java: 'Java', cpp: 'C++', c: 'C', csharp: 'C#', go: 'Go', rust: 'Rust',
    php: 'PHP', ruby: 'Ruby', swift: 'Swift', kotlin: 'Kotlin', html: 'HTML', bash: 'Bash'
  };
  return names[lang] || lang;
};

// KEYBOARD SHORTCUT â€” Ctrl+Enter to run
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  }
});

// Wire Run buttons
document.addEventListener('DOMContentLoaded', () => {
  terminal.init();

  // Also init terminal after monaco ready
  window.addEventListener('monaco-ready', () => {
    terminal.init();
  });
  
  document.querySelectorAll('.run-btn, #run-btn, [id*="run"]').forEach(btn => {
    btn.addEventListener('click', runCode);
  });

  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.target || tab.dataset.tab;
      if (target) {
        switchTab(target.replace('tab-', ''));
      }
    });
  });

  const btnClear = document.getElementById('compiler-clear-btn');
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const activeTab = document.querySelector('.panel-tab.active')?.dataset.target || 'tab-output';
      if (activeTab === 'tab-terminal') terminal.clear();
      else if (activeTab === 'tab-output') clearOutput();
      else if (activeTab === 'tab-input') {
        const stdin = document.getElementById('stdin-input');
        if (stdin) stdin.value = '';
      }
    });
  }
  
  const btnCollapse = document.getElementById('compiler-collapse-btn');
  const bottomPanel = document.getElementById('bottom-panel');
  let isPanelCollapsed = false;
  if(btnCollapse && bottomPanel) {
      btnCollapse.addEventListener('click', () => {
          if(isPanelCollapsed) {
              bottomPanel.style.height = '200px';
              btnCollapse.innerText = '^';
              isPanelCollapsed = false;
          } else {
              bottomPanel.style.height = '35px';
              btnCollapse.innerText = 'v';
              isPanelCollapsed = true;
          }
      });
  }
  
  // Panel Resizing Logic
  const resizer = document.getElementById('panel-resize-handle');
  if(resizer && bottomPanel) {
      let isResizing = false;
      let startY, startHeight;
      
      resizer.addEventListener('mousedown', (e) => {
          isResizing = true;
          startY = e.clientY;
          startHeight = parseInt(document.defaultView.getComputedStyle(bottomPanel).height, 10);
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
      });
      
      window.addEventListener('mousemove', (e) => {
          if(!isResizing) return;
          const newHeight = startHeight - (e.clientY - startY);
          if(newHeight >= 80 && newHeight <= 500) {
              bottomPanel.style.height = `${newHeight}px`;
          }
      });
      
      window.addEventListener('mouseup', () => {
          if(isResizing) {
              isResizing = false;
              document.body.style.cursor = 'default';
              document.body.style.userSelect = 'auto';
          }
      });
  }
});

// ============================================================================
// NEW FEATURES
// ============================================================================

const formatErrorOutput = (stderr) => {
  if (!stderr) return '';
  
  return stderr.split('\n').map(line => {
    // Highlight line numbers
    line = line.replace(
      /line (\d+)/gi,
      'line $1'
    );
    // Highlight error types
    line = line.replace(
      /^(ReferenceError|TypeError|SyntaxError|RangeError|URIError|EvalError):/,
      '$1:'
    );
    return line;
  }).join('\n');
};

const executionHistory = [];

// After each run, save to history
const saveToHistory = (code, result, lang) => {
  executionHistory.unshift({
    code: code.substring(0, 200),
    stdout: result.stdout,
    stderr: result.stderr,
    language: lang,
    time: result.time,
    timestamp: new Date().toLocaleTimeString()
  });
  
  // Keep last 10 runs only
  if (executionHistory.length > 10) {
    executionHistory.pop();
  }
  
  updateHistoryPanel();
};

const updateHistoryPanel = () => {
  const historyEl = document.getElementById(
    'execution-history');
  if (!historyEl) return;
  
  historyEl.innerHTML = executionHistory
    .map((run, i) => `
      <div class="history-item" 
        data-index="${i}"
        onclick="restoreFromHistory(${i})">
        <span class="history-lang">
          ${run.language}
        </span>
        <span class="history-time">
          ${run.timestamp}
        </span>
        <span class="history-status 
          ${run.stderr ? 'error' : 'success'}">
          ${run.stderr ? '✕' : '✓'}
        </span>
      </div>
    `).join('');
};

window.restoreFromHistory = (index) => {
  const run = executionHistory[index];
  if (!run || !window.monacoEditor) return;
  window.monacoEditor.setValue(run.code);
  if (window.showToast) window.showToast('Code restored from history', 
    'success');
};

const updateProblemsTab = () => {
  if (!window.monacoEditor) return;
  
  const model = window.monacoEditor.getModel();
  if (!model) return;

  // Get Monaco markers (errors/warnings)
  const markers = monaco.editor
    .getModelMarkers({ resource: model.uri });
  
  const problemsEl = document.getElementById(
    'problems-list')
    || document.querySelector('.problems-list')
    || document.getElementById('problems-output');
  
  if (!problemsEl) return;

  // Update problems tab badge
  const badge = document.querySelector(
    '[data-tab="problems"] .tab-badge')
    || document.getElementById('problems-badge');
  if (badge) {
    badge.textContent = markers.length;
    badge.style.display = markers.length > 0 
      ? 'inline' : 'none';
  }

  if (markers.length === 0) {
    problemsEl.innerHTML = `
      <div style="color:#565f89;
        padding:16px;font-size:12px;
        font-family:'JetBrains Mono'">
        ✓ No problems detected
      </div>
    `;
    return;
  }

  problemsEl.innerHTML = markers.map(m => `
    <div class="problem-item 
      problem-${m.severity === 8 
        ? 'error' : 'warning'}"
      onclick="goToLine(${m.startLineNumber})" style="cursor: pointer; padding: 4px; border-bottom: 1px solid #2d2f45; display: flex; align-items: center; gap: 8px;">
      <span class="problem-icon" style="color: ${m.severity === 8 ? '#f7768e' : '#e0af68'}">
        ${m.severity === 8 ? '✕' : 'âš '}
      </span>
      <span class="problem-message" style="flex: 1; color: #c0caf5;">
        ${m.message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
      </span>
      <span class="problem-location" style="color: #565f89; font-size: 11px;">
        Ln ${m.startLineNumber}, 
        Col ${m.startColumn}
      </span>
    </div>
  `).join('');
};

window.goToLine = (lineNumber) => {
  if (!window.monacoEditor) return;
  window.monacoEditor.revealLineInCenter(lineNumber);
  window.monacoEditor.setPosition({ 
    lineNumber, column: 1 
  });
  window.monacoEditor.focus();
};

const updateStatusBar = () => {
  if (!window.monacoEditor) return;

  // Update cursor position
  const pos = window.monacoEditor.getPosition();
  const posEl = document.getElementById('sb-cursor');
  if (posEl && pos) {
    posEl.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
  }

  // Update language
  const langEl = document.getElementById('sb-language');
  if (langEl) {
    const currentLanguage = langEl.innerText.toLowerCase() || 'javascript';
    langEl.textContent = getLanguageDisplayName(currentLanguage);
  }

  // Update errors/warnings count
  const model = window.monacoEditor.getModel();
  if (model) {
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    const errors = markers.filter(m => m.severity === 8).length;
    const warnings = markers.filter(m => m.severity === 4).length;
    
    const errEl = document.getElementById('sb-problems');
    if (errEl) {
      errEl.textContent = `✕ ${errors}  âš  ${warnings}`;
      errEl.style.color = errors > 0 ? '#f7768e' : warnings > 0 ? '#e0af68' : '#1a1b26';
    }
  }
};

const updateRunButton = (language) => {
  const langIcons = {
    javascript: 'ðŸŸ¡',
    typescript: 'ðŸ”µ',
    python:     'ðŸ',
    java:       'â˜•',
    cpp:        'âš™ï¸',
    c:          'ðŸ”§',
    csharp:     'ðŸ”·',
    go:         'ðŸ”µ',
    rust:       'ðŸ¦€',
    php:        'ðŸ˜',
    ruby:       'ðŸ’Ž',
    html:       'ðŸŒ',
    swift:      'ðŸŠ',
    kotlin:     'ðŸŸ£',
    bash:       'â¬›'
  };

  const icon = langIcons[language.toLowerCase()] || '▶';
  const name = getLanguageDisplayName(language);
  
  document.querySelectorAll(
    '.run-btn, #run-btn, [id*="run-btn"]').forEach(btn => {
    if (!btn.classList.contains('running')) {
      btn.innerHTML = `${icon} Run ${name}`;
    }
  });
};

window.addEventListener('monaco-ready', () => {
  if(window.monacoEditor) {
    window.monacoEditor.onDidChangeModelContent(() => {
      setTimeout(updateProblemsTab, 1000);
      updateStatusBar();
    });
    window.monacoEditor.onDidChangeCursorPosition(updateStatusBar);
    
    // Initial updates
    updateProblemsTab();
    updateStatusBar();
    
    const observer = new MutationObserver(() => {
        const currentLanguage = document.getElementById('sb-language')?.innerText.toLowerCase() || 'javascript';
        updateRunButton(currentLanguage);
    });
    const statusLangEl = document.getElementById('sb-language');
    if (statusLangEl) {
        observer.observe(statusLangEl, { childList: true, characterData: true, subtree: true });
        updateRunButton(statusLangEl.innerText.toLowerCase());
    }
  }
});

// ============================================================================
// 🆕 PROFESSIONAL COMPILER ENGINE v3.0
// ============================================================================

// ── CONSTANTS ────────────────────────────────
const PISTON_API = 
  'https://emkc.org/api/v2/piston/execute';

const PISTON_LANGS = {
  javascript: { 
    language: 'javascript', 
    version: '18.15.0', 
    file: 'main.js' 
  },
  typescript: { 
    language: 'typescript', 
    version: '5.0.3', 
    file: 'main.ts' 
  },
  python: { 
    language: 'python', 
    version: '3.10.0', 
    file: 'main.py' 
  },
  java: { 
    language: 'java', 
    version: '15.0.2', 
    file: 'Main.java' 
  },
  cpp: { 
    language: 'c++', 
    version: '10.2.0', 
    file: 'main.cpp' 
  },
  c: { 
    language: 'c', 
    version: '10.2.0', 
    file: 'main.c' 
  },
  csharp: { 
    language: 'csharp', 
    version: '6.12.0', 
    file: 'main.cs' 
  },
  go: { 
    language: 'go', 
    version: '1.16.2', 
    file: 'main.go' 
  },
  rust: { 
    language: 'rust', 
    version: '1.50.0', 
    file: 'main.rs' 
  },
  php: { 
    language: 'php', 
    version: '8.0.2', 
    file: 'main.php' 
  },
  ruby: { 
    language: 'ruby', 
    version: '3.0.1', 
    file: 'main.rb' 
  },
  swift: { 
    language: 'swift', 
    version: '5.3.3', 
    file: 'main.swift' 
  },
  kotlin: { 
    language: 'kotlin', 
    version: '1.4.31', 
    file: 'main.kt' 
  },
  bash: { 
    language: 'bash', 
    version: '5.1.0', 
    file: 'main.sh' 
  },
  r: { 
    language: 'r', 
    version: '4.1.1', 
    file: 'main.r' 
  },
  sql: { 
    language: 'sqlite3', 
    version: '3.36.0', 
    file: 'main.sql' 
  }
};

const LANG_NAMES = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python 3.10',
  java: 'Java 15',
  cpp: 'C++ (GCC 10)',
  c: 'C (GCC 10)',
  csharp: 'C# Mono',
  go: 'Go 1.16',
  rust: 'Rust 1.50',
  php: 'PHP 8.0',
  ruby: 'Ruby 3.0',
  swift: 'Swift 5.3',
  kotlin: 'Kotlin 1.4',
  bash: 'Bash 5.1',
  html: 'HTML5',
  css: 'CSS3',
  r: 'R 4.1',
  sql: 'SQLite 3'
};

const LANG_COLORS = {
  javascript: '#F7DF1E',
  typescript: '#3178C6',
  python: '#3776AB',
  java: '#ED8B00',
  cpp: '#00599C',
  c: '#A8B9CC',
  csharp: '#239120',
  go: '#00ADD8',
  rust: '#CE422B',
  php: '#777BB4',
  ruby: '#CC342D',
  html: '#E34F26',
  css: '#1572B6',
  swift: '#FA7343',
  kotlin: '#7F52FF',
  bash: '#4EAA25',
  r: '#276DC3',
  sql: '#336791'
};

// ── STATE ────────────────────────────────────
let __runCount = 0;
let __isRunning = false;
window.currentLanguage = 'javascript';

// ── HELPER: GET CURRENT LANGUAGE ─────────────
function __getLang() {
  return window.currentLanguage
    || document.getElementById('sb-language')
       ?.innerText?.toLowerCase()
       ?.trim()
    || 'javascript';
}

// ── HELPER: GET EDITOR CODE ───────────────────
function __getCode() {
  const editor = window.monacoEditor 
    || window.editorInstance;
  if (!editor) return '';
  return editor.getValue() || '';
}

// ── HELPER: LANG NAME ─────────────────────────
function __langName(lang) {
  return LANG_NAMES[lang] || lang;
}

// ── HELPER: LANG COLOR ────────────────────────
function __langColor(lang) {
  return LANG_COLORS[lang] || '#c0caf5';
}

// ── OUTPUT PANEL ──────────────────────────────
function __getOutputEl() {
  return document.getElementById('output-lines');
}

function __clearOutput() {
  const el = __getOutputEl();
  if (el) el.innerHTML = '';
}

function __appendOutput(type, text) {
  const el = __getOutputEl();
  if (!el) return;

  if (type === 'divider') {
    const div = document.createElement('div');
    div.style.cssText = `
      color:#2d2f45;
      padding:2px 16px;
      font-size:11px;
      font-family:'JetBrains Mono',monospace;
      user-select:none;
      white-space:pre;
    `;
    div.textContent = text;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return;
  }

  const styles = {
    output:  { color:'#c0caf5', bg:'',
                border:'transparent', pre:'' },
    error:   { color:'#f7768e',
                bg:'rgba(247,118,142,0.06)',
                border:'#f7768e', pre:'✕ ' },
    warn:    { color:'#e0af68', bg:'',
                border:'transparent', pre:'⚠ ' },
    success: { color:'#9ece6a', bg:'',
                border:'transparent', pre:'✓ ' },
    info:    { color:'#7aa2f7', bg:'',
                border:'transparent', pre:'ℹ ' },
    muted:   { color:'#565f89', bg:'',
                border:'transparent', pre:'' },
    input:   { color:'#bb9af7', bg:'',
                border:'transparent', pre:'❯ ' }
  };

  const s = styles[type] || styles.output;
  const line = document.createElement('div');
  line.style.cssText = `
    color:${s.color};
    background:${s.bg || 'transparent'};
    padding:1px 16px;
    font-size:13px;
    line-height:1.7;
    font-family:'JetBrains Mono',monospace;
    white-space:pre-wrap;
    word-break:break-word;
    border-left:2px solid ${s.border};
    animation:lineIn 0.08s ease;
  `;
  line.textContent = s.pre + text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ── SWITCH BOTTOM TAB ─────────────────────────
function __switchTab(tabId) {
  document.querySelectorAll('.panel-tab-btn')
    .forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel-tab-content')
    .forEach(c => c.classList.remove('active'));

  const btn = document.querySelector(
    `.panel-tab-btn[data-tab="${tabId}"]`);
  const content = document.getElementById(
    `tab-${tabId}`);

  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');
}

// ── SET RUN BUTTON STATE ──────────────────────
function __setRunState(state, lang) {
  const btns = [
    document.getElementById('run-code-btn'),
    document.getElementById('btn-run-code')
  ].filter(Boolean);

  const bar = document.getElementById(
    'run-progress-bar');

  btns.forEach(btn => {
    btn.disabled = state === 'running';
    btn.className = state === 'running' 
      ? 'running' 
      : state === 'success' 
        ? 'success' 
        : state === 'error' 
          ? 'error' : '';

    switch(state) {
      case 'running':
        btn.innerHTML = 
          '<span style="display:inline-block;'
          +'width:12px;height:12px;'
          +'border:2px solid #e0af68;'
          +'border-top-color:transparent;'
          +'border-radius:50%;'
          +'animation:spin 0.6s linear infinite;'
          +'vertical-align:middle;'
          +'margin-right:6px;"></span>'
          +'Running...';
        if (bar) bar.classList.add('running');
        break;
      case 'success':
        btn.textContent = '✓ Done';
        if (bar) bar.classList.remove('running');
        setTimeout(() => {
          btn.textContent = '▶ Run';
          btn.className = '';
        }, 2000);
        break;
      case 'error':
        btn.textContent = '✕ Error';
        if (bar) bar.classList.remove('running');
        setTimeout(() => {
          btn.textContent = '▶ Run';
          btn.className = '';
        }, 2000);
        break;
      default:
        btn.textContent = '▶ Run';
        if (bar) bar.classList.remove('running');
    }
  });
}

// ── UPDATE LANG BADGE ─────────────────────────
function __updateLangBadge(lang) {
  window.currentLanguage = lang;
  const badge = document.getElementById(
    'panel-lang-badge');
  if (badge) {
    const color = __langColor(lang);
    badge.innerHTML = `
      <span style="
        width:8px;height:8px;
        border-radius:50%;
        background:${color};
        display:inline-block;
        margin-right:5px;
        flex-shrink:0;">
      </span>
      <span style="
        font-size:11px;
        font-weight:600;
        color:${color};">
        ${__langName(lang)}
      </span>
    `;
    badge.style.borderColor = color + '50';
    badge.style.background = color + '12';
  }

  // Update terminal prefix
  const prefix = document.getElementById(
    'terminal-lang-prefix');
  if (prefix) {
    prefix.textContent = 
      lang.substring(0,2).toUpperCase();
    prefix.style.color = __langColor(lang);
  }
}

// ── JS SANDBOX (CORS-SAFE) ────────────────────
// Uses srcdoc + postMessage ONLY
// NEVER accesses iframe.contentDocument
// NEVER accesses iframe.contentWindow.document
function __runJS(code, stdin) {
  return new Promise((resolve) => {
    const logs = [];
    const errors = [];
    const t0 = performance.now();
    let done = false;

    // Create hidden iframe
    const iframe = document.createElement(
      'iframe');
    iframe.setAttribute('sandbox', 
      'allow-scripts');
    iframe.style.cssText = 
      'display:none;position:absolute;'
      + 'left:-9999px;width:1px;height:1px;';
    document.body.appendChild(iframe);

    // Cleanup
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener(
        'message', handler);
      clearTimeout(timer);
      try {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      } catch(e) {}
      resolve({
        stdout: logs.join('\n'),
        stderr: errors.join('\n'),
        time: (
          (performance.now()-t0)/1000
        ).toFixed(3),
        status: errors.length 
          ? 'Runtime Error' : 'Accepted'
      });
    };

    // Message handler
    const handler = (e) => {
      if (e.source !== iframe.contentWindow) 
        return;
      if (!e.data?.__cs) return;
      if (e.data.type === 'log') 
        logs.push(String(e.data.v ?? ''));
      if (e.data.type === 'err') 
        errors.push(String(e.data.v ?? ''));
      if (e.data.type === 'done') finish();
    };
    window.addEventListener('message', handler);

    // Timeout 10s
    const timer = setTimeout(() => {
      errors.push(
        '⏱ Timed out after 10 seconds.\n'
        + 'Hint: Check for infinite loops.');
      finish();
    }, 10000);

    // Build stdin array
    const stdinLines = stdin
      ? stdin.split('\n') : [];

    // Format values
    const fmt = `
      function __fmt(v){
        if(v===null)return'null';
        if(v===undefined)return'undefined';
        if(typeof v==='function')
          return'[Function: '+v.name+']';
        if(typeof v==='object'){
          try{return JSON.stringify(v,null,2);}
          catch(e){return String(v);}
        }
        return String(v);
      }
      function __fmtA(a){
        return Array.from(a).map(__fmt).join(' ');
      }
    `;

    // CORS-safe iframe code
    // srcdoc is the ONLY safe injection method
    iframe.srcdoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
</head><body><script>
(function(){
  var P=window.parent;
  var S=function(t,v){
    try{P.postMessage(
      {__cs:true,type:t,v:v},'*');
    }catch(e){}
  };
  ${fmt}
  // Override console
  window.console={
    log:function(){S('log',__fmtA(arguments));},
    error:function(){S('err',__fmtA(arguments));},
    warn:function(){S('log',
      '\u26a0 '+__fmtA(arguments));},
    info:function(){S('log',
      '\u2139 '+__fmtA(arguments));},
    table:function(d){
      try{S('log',JSON.stringify(d,null,2));}
      catch(e){S('log',String(d));}
    },
    dir:function(d){S('log',__fmt(d));},
    assert:function(c){
      if(!c)S('err',
        'Assertion failed: '
        +__fmtA(Array.prototype.slice
          .call(arguments,1)));
    },
    clear:function(){},
    group:function(){},
    groupEnd:function(){},
    time:function(l){
      S('log','timer: '+(l||'default'));},
    timeEnd:function(l){
      S('log','timer end: '+(l||'default'));}
  };
  // Override globals
  window.alert=function(m){
    S('log','[alert] '+String(m));};
  window.confirm=function(){return true;};
  window.prompt=function(msg){
    if(msg)S('log',String(msg));
    return ${JSON.stringify(stdinLines)}
      .shift()||'';
  };
  // process.stdout shim
  window.process={
    stdout:{write:function(s){S('log',s);}},
    stderr:{write:function(s){S('err',s);}},
    exit:function(){}
  };
  // Run user code
  try{
    ${code.replace(/<\/script>/gi,
      '<\\/script>')}
    S('done',null);
  }catch(e){
    S('err',(e.name||'Error')
      +': '+e.message);
    // Parse stack for line number
    if(e.stack){
      var st=e.stack.split('\n')
        .slice(1,4)
        .map(function(l){
          return l.trim()
            .replace(
              /at eval.+<anonymous>:/,
              'at line ');
        })
        .filter(Boolean);
      st.forEach(function(l){S('err',l);});
    }
    S('done',null);
  }
})();
<\/script></body></html>`;
  });
}

// ── PISTON API (all other languages) ─────────
async function __runPiston(code, lang, stdin) {
  const cfg = PISTON_LANGS[lang];
  if (!cfg) {
    return {
      stdout: '',
      stderr: `Language "${lang}" not supported.\nSupported: ${Object.keys(PISTON_LANGS).join(', ')}`,
      time: '0'
    };
  }

  const res = await fetch(PISTON_API, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({
      language: cfg.language,
      version: cfg.version,
      files: [{ 
        name: cfg.file, 
        content: code 
      }],
      stdin: stdin || '',
      args: [],
      compile_timeout: 15000,
      run_timeout: 10000,
      compile_memory_limit: -1,
      run_memory_limit: -1
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(
      `Piston API ${res.status}: ${txt}`);
  }

  const data = await res.json();

  // Handle compile errors (Java, C++, etc)
  const compileErr = 
    data.compile?.stderr?.trim() || '';
  const runOut = data.run?.stdout?.trim() || '';
  const runErr = data.run?.stderr?.trim() || '';

  return {
    stdout: runOut,
    stderr: compileErr 
      ? `Compile Error:\n${compileErr}` 
      : runErr,
    time: data.run?.code === 0 
      ? 'Success' : 'Error',
    exitCode: data.run?.code ?? -1
  };
}

// ── HTML PREVIEW IN OUTPUT TAB ────────────────
function __runHTML(code) {
  // Show in OUTPUT tab — NOT preview tab
  __switchTab('output');
  const el = __getOutputEl();
  if (!el) return;

  el.innerHTML = '';

  const hdr = document.createElement('div');
  hdr.className = 'output-line type-info';
  hdr.style.cssText = `
    color:#7aa2f7;padding:6px 16px;
    font-size:12px;
    font-family:'JetBrains Mono',monospace;
    border-bottom:1px solid #2d2f45;
  `;
  hdr.textContent = '▶ HTML5 — Live Rendered Output';
  el.appendChild(hdr);

  // Wrapper div
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    padding:8px;
    height:calc(100% - 36px);
    min-height:140px;
    display:flex;
    flex-direction:column;
  `;

  // CORS-safe iframe
  // srcdoc ONLY — never src=
  const frame = document.createElement('iframe');
  frame.style.cssText = `
    width:100%;flex:1;
    border:1px solid #2d2f45;
    border-radius:6px;
    background:white;
    min-height:120px;
  `;
  frame.srcdoc = code;

  wrap.appendChild(frame);
  el.appendChild(wrap);

  // Expand panel for HTML
  const panel = document.getElementById(
    'bottom-panel');
  if (panel) {
    const h = parseInt(
      window.getComputedStyle(panel).height);
    if (h < 280) panel.style.height = '300px';
  }
}

// ── PROBLEMS TAB ──────────────────────────────
function __parseProblems(stderr, lang) {
  if (!stderr?.trim()) {
    __showProblemsEmpty();
    return;
  }

  const probs = [];
  const lines = stderr.split('\n');

  // JavaScript / TypeScript
  if (lang === 'javascript' 
      || lang === 'typescript') {
    lines.forEach(l => {
      if (!l.trim()) return;
      const m = l.match(
        /<anonymous>:(\d+):(\d+)/
      ) || l.match(/line (\d+)/i);
      if (l.match(
        /Error|error|Warning|warning/)) {
        probs.push({
          type: l.toLowerCase()
            .includes('warning') 
            ? 'warning' : 'error',
          msg: l.trim(),
          line: m ? parseInt(m[1]) : 0,
          col: m?.[2] ? parseInt(m[2]) : 0,
          file: 'main.js'
        });
      }
    });
  }

  // Python
  if (lang === 'python') {
    let ln = 0;
    lines.forEach(l => {
      const m = l.match(/line (\d+)/i);
      if (m) ln = parseInt(m[1]);
      if (l.match(/Error:|Exception:/)) {
        probs.push({
          type: 'error', msg: l.trim(),
          line: ln, col: 0,
          file: 'main.py'
        });
      }
    });
  }

  // Java
  if (lang === 'java') {
    const re = 
      /\.java:(\d+):\s*(error|warning):\s*(.+)/gi;
    let m;
    while ((m = re.exec(stderr)) !== null) {
      probs.push({
        type: m[2].toLowerCase(),
        msg: m[3].trim(),
        line: parseInt(m[1]), col: 0,
        file: 'Main.java'
      });
    }
  }

  // C / C++
  if (lang === 'cpp' || lang === 'c') {
    const ext = lang === 'cpp' 
      ? 'cpp' : 'c';
    const re = new RegExp(
      `main\\.${ext}:(\\d+):(\\d+):`
      + `\\s*(error|warning|note):\\s*(.+)`,
      'gi'
    );
    let m;
    while ((m = re.exec(stderr)) !== null) {
      probs.push({
        type: m[3]==='error' 
          ? 'error' : 'warning',
        msg: m[4].trim(),
        line: parseInt(m[1]),
        col: parseInt(m[2]),
        file: `main.${ext}`
      });
    }
  }

  // Compile errors (generic prefix)
  if (probs.length === 0 
      && stderr.includes('Compile Error:')) {
    stderr.replace('Compile Error:\n','')
      .split('\n')
      .filter(l => l.trim())
      .forEach(l => {
        probs.push({
          type: 'error',
          msg: l.trim(),
          line: 0, col: 0,
          file: 'source'
        });
      });
  }

  // Generic fallback
  if (probs.length === 0) {
    lines.filter(l => l.trim()).forEach(l => {
      probs.push({
        type: 'error', msg: l.trim(),
        line: 0, col: 0, file: 'source'
      });
    });
  }

  __renderProblems(probs);
}

function __renderProblems(probs) {
  const list = document.getElementById(
    'problems-list');
  if (!list) return;

  const errs = probs.filter(
    p => p.type === 'error').length;
  const warns = probs.filter(
    p => p.type === 'warning').length;

  // Badge
  const badge = document.getElementById(
    'problems-badge');
  if (badge) {
    badge.textContent = errs + warns;
    badge.style.display = 
      (errs+warns) > 0 
        ? 'inline-block' : 'none';
    badge.style.background = 
      errs > 0 ? '#f7768e' : '#e0af68';
  }

  if (probs.length === 0) {
    __showProblemsEmpty();
    return;
  }

  list.innerHTML = `
    <div style="
      padding:5px 16px;
      font-size:11px;
      color:#565f89;
      border-bottom:1px solid #2d2f45;
      display:flex;gap:12px;
      font-family:'JetBrains Mono',monospace;">
      <span style="color:#f7768e">
        ✕ ${errs} error${errs!==1?'s':''}
      </span>
      <span style="color:#e0af68">
        ⚠ ${warns} warning${warns!==1?'s':''}
      </span>
    </div>
  `;

  probs.forEach(p => {
    const isErr = p.type === 'error';
    const row = document.createElement('div');
    row.style.cssText = `
      display:flex;align-items:flex-start;
      gap:8px;padding:5px 16px;
      cursor:pointer;
      transition:background 0.1s;
      border-left:3px solid ${
        isErr ? '#f7768e' : '#e0af68'};
      font-family:'JetBrains Mono',monospace;
      font-size:12px;line-height:1.5;
    `;

    row.innerHTML = `
      <span style="color:${
        isErr?'#f7768e':'#e0af68'};
        flex-shrink:0;font-size:13px;">
        ${isErr ? '✕' : '⚠'}
      </span>
      <div style="flex:1;min-width:0;">
        <div style="color:#c0caf5;
          white-space:pre-wrap;
          word-break:break-word;">
          ${p.msg
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')}
        </div>
        <div style="color:#565f89;
          font-size:11px;margin-top:2px;
          display:flex;gap:10px;">
          <span>📄 ${p.file}</span>
          ${p.line > 0 
            ? `<span>Ln ${p.line}${
                p.col>0
                  ? ', Col '+p.col:''
              }</span>` 
            : ''}
        </div>
      </div>
    `;

    // Click → jump to line in Monaco
    row.addEventListener('click', () => {
      const ed = window.monacoEditor;
      if (p.line > 0 && ed) {
        ed.revealLineInCenter(p.line);
        ed.setPosition({
          lineNumber: p.line,
          column: p.col || 1
        });
        ed.focus();

        // Flash the error line red
        const decs = ed.deltaDecorations(
          [], [{
          range: new monaco.Range(
            p.line,1,p.line,9999),
          options: {
            isWholeLine: true,
            className: '__err-hi',
            inlineClassName: '__err-hi-inline'
          }
        }]);
        setTimeout(() => {
          ed.deltaDecorations(decs, []);
        }, 2000);
      }
    });

    row.addEventListener('mouseenter', () => {
      row.style.background = 
        'rgba(255,255,255,0.04)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
    });

    list.appendChild(row);
  });
}

function __showProblemsEmpty() {
  const list = document.getElementById(
    'problems-list');
  if (list) {
    list.innerHTML = `
      <div style="
        display:flex;align-items:center;
        justify-content:center;
        height:70px;color:#565f89;
        font-size:12px;gap:6px;
        font-family:'JetBrains Mono',monospace;">
        <span style="color:#9ece6a">✓</span>
        No problems detected
      </div>
    `;
  }
  const badge = document.getElementById(
    'problems-badge');
  if (badge) badge.style.display = 'none';
}

// ── MAIN RUN CODE FUNCTION ────────────────────
async function runCode() {
  // Guard: only one run at a time
  if (__isRunning) {
    __appendOutput('warn', 
      '⚠ Already running. Please wait...');
    return;
  }

  // Get editor instance
  const ed = window.monacoEditor 
    || window.editorInstance;
  if (!ed) {
    alert('Editor not ready yet.');
    return;
  }

  // Get code from editor
  const code = ed.getValue();
  if (!code || !code.trim()) {
    __switchTab('output');
    __clearOutput();
    __appendOutput('warn', 
      '⚠ Editor is empty!');
    __appendOutput('muted', 
      'Write some code first then click Run.');
    return;
  }

  // Get language
  const lang = __getLang();
  const stdin = document.getElementById(
    'stdin-input')?.value || '';

  __isRunning = true;
  __runCount++;
  const num = __runCount;
  const time = new Date().toLocaleTimeString();

  // Update UI
  __setRunState('running', lang);
  __switchTab('output');
  __clearOutput();

  // Show run header
  __appendOutput('divider',
    `── Run #${num} · `
    + `${__langName(lang)} · `
    + `${time} `
    + '─'.repeat(20));
  __appendOutput('info',
    `▶ Compiling and running ${
      __langName(lang)}...`);

  const t0 = performance.now();

  try {
    let result;

    // Route by language
    if (lang === 'javascript' 
        || lang === 'js') {
      result = await __runJS(code, stdin);
    }
    else if (lang === 'html' 
        || lang === 'css') {
      __runHTML(code);
      __setRunState('success', lang);
      __isRunning = false;
      return;
    }
    else {
      result = await __runPiston(
        code, lang, stdin);
    }

    const ms = performance.now() - t0;
    const secs = (ms/1000).toFixed(3);

    // Clear loading message
    __clearOutput();
    __appendOutput('divider',
      `── Run #${num} · `
      + `${__langName(lang)} · `
      + `${time} `
      + '─'.repeat(20));

    // Show stdout
    if (result.stdout?.trim()) {
      result.stdout.trim()
        .split('\n')
        .forEach(l => __appendOutput(
          'output', l));
    }

    // Show stderr
    if (result.stderr?.trim()) {
      __appendOutput('divider', '');
      result.stderr.trim()
        .split('\n')
        .forEach(l => __appendOutput(
          'error', l));
    }

    // No output at all
    if (!result.stdout?.trim() 
        && !result.stderr?.trim()) {
      __appendOutput('muted',
        '(Program produced no output)');
    }

    const failed = !!result.stderr?.trim();

    // Footer
    __appendOutput('divider',
      failed
        ? `── ✕ Failed in ${secs}s ──────`
        : `── ✓ Completed in ${secs}s ───`);

    // Update run state
    __setRunState(
      failed ? 'error' : 'success', lang);

    // Update Problems tab
    if (result.stderr?.trim()) {
      __parseProblems(result.stderr, lang);
    } else {
      __showProblemsEmpty();
    }

  } catch (err) {
    __clearOutput();
    __appendOutput('error',
      `✕ Compiler Error: ${err.message}`);
    __appendOutput('muted',
      'Make sure you are connected to internet.');
    __appendOutput('muted',
      'Piston API: emkc.org/api/v2/piston');
    __appendOutput('divider',
      '── ✕ Failed ──────────────────');
    __setRunState('error', lang);
    console.error('RunCode error:', err);
  }

  __isRunning = false;
}

// Make runCode globally available
window.runCode = runCode;

// ── TERMINAL IMPLEMENTATION ───────────────────
const CodeTerminal = {
  _history: [],
  _histIdx: -1,
  _running: false,
  _input: null,

  init() {
    // Find terminal input — matches editor.html
    // which has id="terminal-input-field"
    this._input = document.getElementById(
      'terminal-input-field');

    if (!this._input) {
      console.warn(
        '[Terminal] input#terminal-input-field'
        + ' not found in DOM');
      return;
    }

    // Clone to remove any old listeners
    const fresh = this._input.cloneNode(true);
    this._input.parentNode.replaceChild(
      fresh, this._input);
    this._input = fresh;

    // ── KEYDOWN HANDLER ──
    this._input.addEventListener(
      'keydown', async (e) => {

      // ENTER → run code
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();

        const code = this._input.value.trim();
        if (!code) return;
        if (this._running) {
          this._print('warn',
            '⚠ Already running...');
          return;
        }

        // History
        if (this._history[0] !== code) {
          this._history.unshift(code);
          if (this._history.length > 100) {
            this._history.pop();
          }
        }
        this._histIdx = -1;
        this._input.value = '';

        await this._execute(code);
      }

      // ARROW UP → history back
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (this._histIdx < 
            this._history.length - 1) {
          this._histIdx++;
          this._input.value = 
            this._history[this._histIdx];
          requestAnimationFrame(() => {
            this._input.selectionStart = 
              this._input.value.length;
            this._input.selectionEnd = 
              this._input.value.length;
          });
        }
      }

      // ARROW DOWN → history forward
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (this._histIdx > 0) {
          this._histIdx--;
          this._input.value = 
            this._history[this._histIdx];
        } else {
          this._histIdx = -1;
          this._input.value = '';
        }
      }

      // CTRL+L → clear
      if (e.ctrlKey && 
          e.key.toLowerCase() === 'l') {
        e.preventDefault();
        this.clear();
      }

      // CTRL+C → cancel / clear input
      if (e.ctrlKey && 
          e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this._input.value = '';
        this._print('muted', '^C');
        this._running = false;
      }
    });

    // Click terminal area → focus input
    const panel = document.getElementById(
      'tab-terminal');
    if (panel) {
      panel.addEventListener('click', (e) => {
        if (e.target !== this._input) {
          this._input.focus();
        }
      });
    }

    // Focus when terminal tab clicked
    document.querySelectorAll(
      '.panel-tab-btn[data-tab="terminal"]')
      .forEach(btn => {
      btn.addEventListener('click', () => {
        setTimeout(() => {
          this._input?.focus();
        }, 80);
      });
    });

    // Show welcome message
    this._welcome();
    console.log('[Terminal] ✅ Initialized');
  },

  _welcome() {
    const lang = __getLang();
    this._print('success',
      '╔══════════════════════════════════╗');
    this._print('success',
      '║   CodeSync Terminal v3.0         ║');
    this._print('success',
      '╚══════════════════════════════════╝');
    this._print('info',
      `Language: ${__langName(lang)}`);
    this._print('muted',
      'Type code + Enter to compile and run');
    this._print('muted',
      '↑↓ history | Ctrl+L clear | Ctrl+C cancel');
    this._print('divider', '─'.repeat(44));
  },

  async _execute(code) {
    if (this._running) return;
    this._running = true;

    const lang = __getLang();
    const stdin = document.getElementById(
      'stdin-input')?.value || '';

    // Show what was typed
    this._print('input', '❯ ' + code);

    // Show compiling message
    this._print('info',
      `⚙ Compiling ${__langName(lang)}...`);

    const t0 = performance.now();

    try {
      let result;

      if (lang === 'javascript' 
          || lang === 'js') {
        result = await __runJS(code, stdin);
      }
      else if (lang === 'html' 
          || lang === 'css') {
        __runHTML(code);
        this._print('success',
          '✓ HTML rendered in Output tab');
        this._running = false;
        this._updatePrompt();
        return;
      }
      else {
        result = await __runPiston(
          code, lang, stdin);
      }

      const secs = (
        (performance.now()-t0)/1000
      ).toFixed(3);

      // Divider
      this._print('divider', '─'.repeat(44));

      // Stdout
      if (result.stdout?.trim()) {
        result.stdout.trim()
          .split('\n')
          .forEach(l => this._print('output',l));
      }

      // Stderr
      if (result.stderr?.trim()) {
        result.stderr.trim()
          .split('\n')
          .forEach(l => this._print('error',
            '✕ ' + l));
        __parseProblems(result.stderr, lang);
      }

      // No output
      if (!result.stdout?.trim() 
          && !result.stderr?.trim()) {
        this._print('muted', '(no output)');
      }

      // Time
      const failed = !!result.stderr?.trim();
      this._print('muted',
        failed
          ? `✗ Failed in ${secs}s`
          : `✓ Done in ${secs}s`);

    } catch (err) {
      this._print('error',
        '✕ Error: ' + err.message);
    }

    this._print('divider', '─'.repeat(44));
    this._running = false;
    this._updatePrompt();
  },

  _print(type, text) {
    const out = document.getElementById(
      'terminal-lines');
    if (!out) return;

    if (type === 'divider') {
      const el = document.createElement('div');
      el.style.cssText = `
        color:#2d2f45;padding:2px 12px;
        font-size:11px;user-select:none;
        font-family:'JetBrains Mono',monospace;
        white-space:pre;
      `;
      el.textContent = text;
      out.appendChild(el);
      out.scrollTop = out.scrollHeight;
      return;
    }

    const cfg = {
      input:   {c:'#bb9af7',bg:''},
      output:  {c:'#c0caf5',bg:''},
      error:   {c:'#f7768e',
                bg:'rgba(247,118,142,0.05)',
                bl:'2px solid #f7768e'},
      warn:    {c:'#e0af68',bg:''},
      success: {c:'#9ece6a',bg:''},
      info:    {c:'#7aa2f7',bg:''},
      muted:   {c:'#565f89',bg:''}
    }[type] || {c:'#c0caf5',bg:''};

    const el = document.createElement('div');
    el.style.cssText = `
      color:${cfg.c};
      background:${cfg.bg||'transparent'};
      ${cfg.bl
        ? `border-left:${cfg.bl};
           padding:1px 12px 1px 10px;`
        : 'padding:1px 12px;'}
      font-size:13px;
      line-height:1.65;
      font-family:'JetBrains Mono',monospace;
      white-space:pre-wrap;
      word-break:break-word;
      animation:lineIn 0.08s ease;
    `;
    el.textContent = text;
    out.appendChild(el);
    out.scrollTop = out.scrollHeight;
  },

  _updatePrompt() {
    const lang = __getLang();
    const pfx = document.getElementById(
      'terminal-lang-prefix');
    if (pfx) {
      pfx.textContent = 
        lang.substring(0,2).toUpperCase();
      pfx.style.color = __langColor(lang);
    }
  },

  clear() {
    const out = document.getElementById(
      'terminal-lines');
    if (out) {
      out.innerHTML = '';
      this._welcome();
    }
  }
};

// ── WIRE UP ALL BUTTONS ───────────────────────
function __wireCompilerUI() {

  // Run buttons
  ['run-code-btn', 'btn-run-code']
    .forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        runCode();
      });
    }
  });

  // Ctrl+Enter → run
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      runCode();
    }
  });

  // Tab switching
  document.querySelectorAll('.panel-tab-btn')
    .forEach(btn => {
    btn.addEventListener('click', () => {
      __switchTab(btn.dataset.tab);
    });
  });

  // Panel resize
  const panel = document.getElementById(
    'bottom-panel');
  const handle = document.getElementById(
    'panel-resize-handle');
  if (panel && handle) {
    let isResizing = false;
    handle.addEventListener('mousedown', () => {
      isResizing = true;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const h = window.innerHeight - e.clientY;
      if (h >= 100 && 
          h <= window.innerHeight * 0.8) {
        panel.style.height = h + 'px';
      }
    });
    window.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
    handle.addEventListener('dblclick', () => {
      const cur = parseInt(
        window.getComputedStyle(panel).height);
      panel.style.height = 
        cur > 250 ? '200px' : '50vh';
    });
  }

  // Maximize button
  document.getElementById('maximize-panel-btn')
    ?.addEventListener('click', () => {
    if (panel) panel.style.height = '75vh';
  });

  // Close/collapse button
  document.getElementById('close-panel-btn')
    ?.addEventListener('click', () => {
    if (panel) {
      const cur = parseInt(
        window.getComputedStyle(panel).height);
      panel.style.height = 
        cur > 50 ? '35px' : '220px';
    }
  });

  // Copy Output button
  document.getElementById('btn-copy-output')?.addEventListener('click', () => {
    const isTerminal = document.getElementById('tab-terminal')?.classList.contains('active');
    const targetId = isTerminal ? 'terminal-lines' : 'output-lines';
    const el = document.getElementById(targetId);
    
    if (el) {
      const text = el.innerText || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        if (typeof showToast !== 'undefined') showToast('📋 Output copied!', 'success');
      }).catch(err => {
        console.error('Copy failed:', err);
        if (typeof showToast !== 'undefined') showToast('❌ Failed to copy', 'error');
      });
    }
  });

  // Stdin clear
  document.querySelector(
    '#stdin-wrapper .panel-action-btn')
    ?.addEventListener('click', () => {
    const el = document.getElementById(
      'stdin-input');
    if (el) el.value = '';
  });

  // Language badge observer
  // Watch sb-language element for changes
  const sbLang = document.getElementById(
    'sb-language');
  if (sbLang) {
    __updateLangBadge(
      sbLang.innerText.toLowerCase().trim()
      || 'javascript');

    new MutationObserver(() => {
      const lang = sbLang.innerText
        .toLowerCase().trim();
      if (lang) __updateLangBadge(lang);
    }).observe(sbLang, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
}

// ── INIT ON DOM READY ─────────────────────────
// Use multiple hooks to guarantee init runs
// whether DOM is already ready or not

const __doInit = () => {
  __wireCompilerUI();
  CodeTerminal.init();
};

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded', __doInit);
} else {
  // DOM already ready
  __doInit();
}

// Also re-init terminal after monaco ready
window.addEventListener('monaco-ready', () => {
  CodeTerminal.init();
  const lang = __getLang();
  __updateLangBadge(lang);
});

// ── CSS to add to editor.css ──────────────────
// (Copy these styles into your editor.css file)
/*
.__err-hi {
  background: rgba(247,118,142,0.15) !important;
}
.__err-hi-inline {
  color: #f7768e !important;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes lineIn {
  from { opacity:0; transform:translateY(2px); }
  to   { opacity:1; transform:translateY(0); }
}
*/
