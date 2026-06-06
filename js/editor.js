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
// ðŸ†• COMPILER & TERMINAL LOGIC
// ============================================================================

window.currentLanguage = 'javascript'; // Default

// 1. UTILS
const runBtn = document.getElementById('run-code-btn');
const headerRunBtn = document.getElementById('btn-run-code');
const outputLines = document.getElementById('output-lines');
const progressBar = document.getElementById('run-progress-bar');
const langBadge = document.getElementById('panel-lang-badge');

const getLangName = (lang) => {
  const map = {
    'javascript': 'JavaScript', 'typescript': 'TypeScript', 'python': 'Python',
    'java': 'Java', 'cpp': 'C++', 'c': 'C', 'csharp': 'C#', 'go': 'Go',
    'rust': 'Rust', 'php': 'PHP', 'ruby': 'Ruby', 'swift': 'Swift',
    'kotlin': 'Kotlin', 'html': 'HTML', 'css': 'CSS', 'bash': 'Bash',
    'sql': 'SQL', 'r': 'R'
  };
  return map[lang] || lang;
};

const getLangColor = (lang) => {
  const map = {
    'javascript': '#F7DF1E', 'typescript': '#3178C6', 'python': '#3776AB',
    'java': '#ED8B00', 'cpp': '#00599C', 'c': '#A8B9CC', 'csharp': '#239120',
    'go': '#00ADD8', 'rust': '#CE422B', 'php': '#777BB4', 'ruby': '#CC342D',
    'swift': '#FA7343', 'kotlin': '#7F52FF', 'html': '#E34F26', 'css': '#1572B6',
    'bash': '#4EAA25', 'sql': '#336791', 'r': '#276DC3'
  };
  return map[lang] || '#c0caf5';
};

// 2. TABS LOGIC
const switchBottomTab = (tabId) => {
  document.querySelectorAll('.panel-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.panel-tab-content').forEach(content => content.classList.remove('active'));
  
  const targetBtn = document.querySelector(`.panel-tab-btn[data-tab="${tabId}"]`);
  const targetContent = document.getElementById(`tab-${tabId}`);
  
  if (targetBtn) targetBtn.classList.add('active');
  if (targetContent) targetContent.classList.add('active');
};

document.querySelectorAll('.panel-tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    switchBottomTab(e.currentTarget.dataset.tab);
  });
});

// 3. RESIZE HANDLE JS
const panel = document.getElementById('bottom-panel');
const handle = document.getElementById('panel-resize-handle');
let isResizing = false;

if(handle) {
    handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    });

    window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight >= 120 && newHeight <= window.innerHeight * 0.8) {
        panel.style.height = `${newHeight}px`;
    }
    });

    window.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = 'default';
    }
    });

    handle.addEventListener('dblclick', () => {
    const currentHeight = parseInt(window.getComputedStyle(panel).height);
    if (currentHeight > 250) {
        panel.style.height = '200px';
    } else {
        panel.style.height = '50vh';
    }
    });
}

// Maximize/Close Actions
document.getElementById('maximize-panel-btn')?.addEventListener('click', () => {
  if(panel) panel.style.height = '80vh';
});
document.getElementById('close-panel-btn')?.addEventListener('click', () => {
  if(panel) panel.style.display = 'none'; // Or set height to 0
});

// 4. RUN COMPILER LOGIC
const clearOutputPanel = () => {
  if (outputLines) outputLines.innerHTML = '';
};

const appendToOutput = (type, text) => {
  if (!outputLines) return;
  const line = document.createElement('div');
  line.className = `output-line type-${type}`;
  line.textContent = text;
  outputLines.appendChild(line);
  outputLines.scrollTop = outputLines.scrollHeight;
};

const showOutputMessage = (type, msg) => {
  clearOutputPanel();
  appendToOutput(type, msg);
  switchBottomTab('output');
};

const setRunState = (state, lang) => {
  if (!runBtn) return;
  runBtn.className = '';
  if (state === 'running') {
    runBtn.classList.add('running');
    runBtn.innerHTML = `â³ Running...`;
    progressBar?.classList.add('running');
  } else if (state === 'success') {
    runBtn.classList.add('success');
    runBtn.innerHTML = `✓ Done`;
    progressBar?.classList.remove('running');
  } else if (state === 'error') {
    runBtn.classList.add('error');
    runBtn.innerHTML = `✕ Error`;
    progressBar?.classList.remove('running');
  } else {
    runBtn.innerHTML = `▶ Run`;
    progressBar?.classList.remove('running');
  }
};

let runCount = 0;

const runCode = async () => {
  if (!window.monacoEditor) return;

  const code = window.monacoEditor.getValue();
  if (!code.trim()) {
    showOutputMessage('warn', 'Editor is empty!');
    return;
  }

  const language = window.currentLanguage || 'javascript';
  const stdin = document.getElementById('stdin-input')?.value || '';

  runCount++;
  const runNum = runCount;
  const runTime = new Date().toLocaleTimeString();

  setRunState('running', language);
  switchBottomTab('output');
  clearOutputPanel();

  appendToOutput('divider', `── Run #${runNum} · ${getLangName(language)} · ${runTime} ─────────────────`);
  appendToOutput('info', `▶ Running ${getLangName(language)}...`);

  const startMs = performance.now();

  try {
    let result;
    if (language === 'javascript') {
      result = await runJSLocally(code, stdin);
    } else if (language === 'html' || language === 'css') {
      runHTMLPreview(code);
      setRunState('success', language);
      return;
    } else {
      result = await runWithPiston(code, language, stdin);
    }

    const ms = performance.now() - startMs;
    const secs = (ms / 1000).toFixed(3);

    clearOutputPanel();
    appendToOutput('divider', `── Run #${runNum} · ${getLangName(language)} · ${runTime} ─────────────────`);

    if (result.stdout?.trim()) {
      result.stdout.trim().split('\n').forEach(line => appendToOutput('output', line));
    }
    if (result.stderr?.trim()) {
      appendToOutput('divider', '');
      result.stderr.trim().split('\n').forEach(line => appendToOutput('error', line));
    }
    if (!result.stdout?.trim() && !result.stderr?.trim()) {
      appendToOutput('muted', '(Program produced no output)');
    }

    const hasError = !!result.stderr?.trim();
    appendToOutput('divider', hasError ? `── ✕ Failed · ${secs}s ───────` : `── ✓ Completed · ${secs}s ────`);
    setRunState(hasError ? 'error' : 'success', language);

    // Show errors in Problems tab
    if (result.stderr?.trim()) {
      parseAndShowProblems(
        result.stderr, language);
      switchBottomTab('problems');
    } else {
      showProblemsEmpty();
    }

  } catch (err) {
    clearOutputPanel();
    appendToOutput('error', `✕ Compiler Error: ${err.message}`);
    appendToOutput('muted', 'Check your internet connection');
    appendToOutput('divider', '── ✕ Failed ─────────────────');
    setRunState('error', language);
  }

  setTimeout(() => setRunState('idle', language), 2500);
};

function parseAndShowProblems(stderr, language) {
  if (!stderr || !stderr.trim()) {
    showProblemsEmpty();
    return;
  }

  const problems = [];
  const lines = stderr.split('\n');

  if (language === 'javascript' 
      || language === 'typescript') {
    lines.forEach(line => {
      const m1 = line.match(
        /<anonymous>:(\d+):(\d+)/);
      const m2 = line.match(
        /line (\d+)/i);
      if (line.includes('Error') 
          || line.includes('error')) {
        problems.push({
          type: 'error',
          message: line.trim(),
          line: m1 ? parseInt(m1[1]) 
            : m2 ? parseInt(m2[1]) : 0,
          col: m1 ? parseInt(m1[2]) : 0,
          file: 'main.js'
        });
      }
    });
  }

  if (language === 'python') {
    let lineNum = 0;
    lines.forEach(line => {
      const m = line.match(/[Ll]ine (\d+)/);
      if (m) lineNum = parseInt(m[1]);
      if (line.includes('Error:') 
          || line.includes('Exception:')) {
        problems.push({
          type: 'error',
          message: line.trim(),
          line: lineNum,
          col: 0,
          file: 'main.py'
        });
      }
    });
  }

  if (language === 'java') {
    const re = /\.java:(\d+):\s*(error|warning):\s*(.+)/gi;
    let m;
    while ((m = re.exec(stderr)) !== null) {
      problems.push({
        type: m[2].lower(),
        message: m[3].trim(),
        line: parseInt(m[1]),
        col: 0,
        file: 'Main.java'
      });
    }
  }

  if (language === 'cpp' 
      || language === 'c') {
    const re = /main\.\w+:(\d+):(\d+):\s*(error|warning|note):\s*(.+)/gi;
    let m;
    while ((m = re.exec(stderr)) !== null) {
      problems.push({
        type: m[3] === 'error' 
          ? 'error' : 'warning',
        message: m[4].trim(),
        line: parseInt(m[1]),
        col: parseInt(m[2]),
        file: language === 'cpp'
          ? 'main.cpp' : 'main.c'
      });
    }
  }

  // Generic fallback
  if (problems.length === 0) {
    lines.filter(l => l.trim()).forEach(l => {
      problems.push({
        type: 'error',
        message: l.trim(),
        line: 0, col: 0,
        file: 'main'
      });
    });
  }

  renderProblems(problems);
}

function renderProblems(problems) {
  const list = document.getElementById(
    'problems-list');
  if (!list) return;

  const errCount = problems.filter(
    p => p.type === 'error').length;
  const warnCount = problems.filter(
    p => p.type === 'warning').length;

  // Update badge
  const badge = document.getElementById(
    'problems-badge');
  if (badge) {
    const total = errCount + warnCount;
    badge.textContent = total;
    badge.style.display = 
      total > 0 ? 'inline-block' : 'none';
    badge.style.background = 
      errCount > 0 ? '#f7768e' : '#e0af68';
  }

  if (problems.length === 0) {
    showProblemsEmpty();
    return;
  }

  list.innerHTML = `
    <div style="padding:6px 16px;
      font-size:11px;color:#565f89;
      border-bottom:1px solid #2d2f45;
      display:flex;gap:12px;">
      <span style="color:#f7768e">
        ✕ ${errCount} error${errCount!==1?'s':''}
      </span>
      <span style="color:#e0af68">
        ⚠ ${warnCount} warning${warnCount!==1?'s':''}
      </span>
    </div>
  `;

  problems.forEach(prob => {
    const item = document.createElement('div');
    const isErr = prob.type === 'error';
    
    item.style.cssText = `
      display:flex;align-items:flex-start;
      gap:8px;padding:6px 16px;
      cursor:pointer;
      transition:background 0.1s;
      border-left:3px solid ${
        isErr ? '#f7768e' : '#e0af68'};
      font-family:'JetBrains Mono',monospace;
      font-size:12px;line-height:1.5;
    `;

    item.innerHTML = `
      <span style="color:${
        isErr ? '#f7768e' : '#e0af68'};
        flex-shrink:0;margin-top:1px;">
        ${isErr ? '✕' : '⚠'}
      </span>
      <div style="flex:1;min-width:0;">
        <div style="color:#c0caf5;
          white-space:pre-wrap;
          word-break:break-word;">
          ${prob.message
            .replace(/&/g,'&amp;')
            .replace(/</g,'&lt;')
            .replace(/>/g,'&gt;')}
        </div>
        <div style="color:#565f89;
          font-size:11px;margin-top:2px;
          display:flex;gap:12px;">
          <span>📄 ${prob.file}</span>
          ${prob.line > 0 
            ? `<span>Ln ${prob.line}${
              prob.col > 0 
                ? ', Col '+prob.col : ''
              }</span>` 
            : ''}
        </div>
      </div>
    `;

    // Click jumps to line in Monaco
    item.addEventListener('click', () => {
      if (prob.line > 0 
          && window.monacoEditor) {
        window.monacoEditor
          .revealLineInCenter(prob.line);
        window.monacoEditor.setPosition({
          lineNumber: prob.line,
          column: prob.col || 1
        });
        window.monacoEditor.focus();

        // Highlight error line 2s
        const decs = window.monacoEditor
          .deltaDecorations([], [{
          range: new monaco.Range(
            prob.line,1,prob.line,1),
          options: {
            isWholeLine: true,
            className: 'error-line-hi'
          }
        }]);
        setTimeout(() => {
          window.monacoEditor
            .deltaDecorations(decs, []);
        }, 2000);
      }
      // Switch to problems tab
      switchBottomTab('problems');
    });

    item.addEventListener('mouseenter',
      () => item.style.background = 
        'rgba(255,255,255,0.04)');
    item.addEventListener('mouseleave',
      () => item.style.background = '');

    list.appendChild(item);
  });
}

function showProblemsEmpty() {
  const list = document.getElementById(
    'problems-list');
  if (!list) return;
  list.innerHTML = `
    <div style="display:flex;
      align-items:center;
      justify-content:center;
      height:80px;color:#565f89;
      font-size:12px;gap:6px;
      font-family:'JetBrains Mono',monospace;">
      <span style="color:#9ece6a">✓</span>
      No problems detected
    </div>
  `;
  const badge = document.getElementById(
    'problems-badge');
  if (badge) badge.style.display = 'none';
}

if (runBtn) {
  runBtn.addEventListener('click', runCode);
}
if (headerRunBtn) {
  headerRunBtn.addEventListener('click', runCode);
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  }
});

// 5. UPDATE COMPILER BADGES ON LANGUAGE CHANGE
const updateCompilerBadges = (lang) => {
  window.currentLanguage = lang;
  if (langBadge) {
    langBadge.innerHTML = `<span style="color:${getLangColor(lang)}">â—</span> ${getLangName(lang)}`;
    langBadge.style.borderColor = getLangColor(lang);
  }
  const terminalPrefix = document.getElementById('terminal-lang-prefix');
  if (terminalPrefix) {
    terminalPrefix.textContent = lang.substring(0, 3);
    terminalPrefix.style.color = getLangColor(lang);
  }

};

window.addEventListener('monaco-ready', () => {
  const checkLang = () => {
    const statusLangEl = document.getElementById('sb-language');
    if (statusLangEl) {
      updateCompilerBadges(statusLangEl.innerText.toLowerCase());
    }
  };
  checkLang();
  const elToObserve = document.getElementById('sb-language');
  if (elToObserve) {
    new MutationObserver(checkLang).observe(elToObserve, { childList: true, characterData: true, subtree: true });
  }
});

// GET CURRENT LANGUAGE HELPER
function getLanguageFromFilename(filename) {
  if (!filename) return 'plaintext';
  
  const ext = filename
    .toLowerCase()
    .split('.')
    .pop();

  const map = {
    // Web
    'html': 'html',
    'htm':  'html',
    'css':  'css',
    'scss': 'scss',
    'sass': 'scss',
    'less': 'css',
    // JavaScript
    'js':   'javascript',
    'jsx':  'javascript',
    'mjs':  'javascript',
    'cjs':  'javascript',
    // TypeScript
    'ts':   'typescript',
    'tsx':  'typescript',
    // Python
    'py':   'python',
    'pyw':  'python',
    // Java
    'java': 'java',
    // C family
    'c':    'c',
    'h':    'c',
    'cpp':  'cpp',
    'cxx':  'cpp',
    'cc':   'cpp',
    'hpp':  'cpp',
    'cs':   'csharp',
    // Other languages
    'go':   'go',
    'rs':   'rust',
    'php':  'php',
    'rb':   'ruby',
    'swift':'swift',
    'kt':   'kotlin',
    'kts':  'kotlin',
    'r':    'r',
    'sh':   'shell',
    'bash': 'shell',
    'zsh':  'shell',
    'ps1':  'powershell',
    // Data
    'json': 'json',
    'jsonc':'json',
    'yaml': 'yaml',
    'yml':  'yaml',
    'xml':  'xml',
    'svg':  'xml',
    'toml': 'ini',
    'ini':  'ini',
    'env':  'ini',
    // Docs
    'md':   'markdown',
    'mdx':  'markdown',
    'txt':  'plaintext',
    // DB
    'sql':  'sql',
    // Docker
    'dockerfile': 'dockerfile'
  };

  return map[ext] || 'plaintext';
}

function openFileInEditor(file) {
  const editor = window.monacoEditor || editorInstance;
  if (!editor) return;
  
  const language = 
    getLanguageFromFilename(file.name)
    || file.language
    || 'plaintext';

  // Set correct language in Monaco
  const model = editor.getModel();
  if (model) {
    monaco.editor.setModelLanguage(model, language);
  }

  // Set file content
  editor.setValue(file.content || '');

  // Update current language globally
  window.currentLanguage = language;
  window.editorLanguage = language;

  // Update language selector if exists
  const langSelect = document.getElementById(
    'language-select');
  if (langSelect) {
    langSelect.value = language;
  }

  // Update run button language
  if (typeof updateRunButton !== 'undefined') {
    updateRunButton(language);
  }

  // Update panel language badge
  updatePanelLangBadge(language);



  // Focus editor
  editor.focus();
}

function updatePanelLangBadge(language) {
  const badge = document.getElementById(
    'panel-lang-badge');
  if (!badge) return;

  const color = langColors[language] 
    || '#C5C5C5';
  const ext = langToExt[language] 
    || language;

  // Get real icon class from file-icons-js
  let iconClass = '';
  if (window.fileIcons) {
    iconClass = window.fileIcons
      .getClassWithColor(
        `main.${ext}`) || '';
  }

  // Build badge with real icon
  if (iconClass) {
    badge.innerHTML = `
      <i class="${iconClass}" 
        style="font-size:14px;
        margin-right:5px;
        vertical-align:middle;">
      </i>
      <span style="
        font-size:11px;
        font-weight:600;
        font-family:'Inter',sans-serif;
        color:${color};
        letter-spacing:0.3px;">
        ${getLanguageDisplayName(language)}
      </span>
    `;
  } else {
    // Fallback: colored dot + name
    badge.innerHTML = `
      <span style="
        width:8px;height:8px;
        border-radius:50%;
        background:${color};
        display:inline-block;
        margin-right:6px;
        flex-shrink:0;">
      </span>
      <span style="
        font-size:11px;
        font-weight:600;
        color:${color};">
        ${getLanguageDisplayName(language)}
      </span>
    `;
  }

  badge.style.borderColor = color + '50';
  badge.style.background = color + '15';
  badge.style.color = color;
}

function updateLanguageSelector(language) {
  const sel = document.getElementById(
    'language-select');
  if (!sel) return;
  
  // Update selected option styling
  const color = langColors[language] 
    || '#c0caf5';
  sel.style.borderColor = color + '60';
  sel.style.color = color;
  
  // Update run button with SVG icon
  const runBtn = document.getElementById(
    'run-code-btn');
  if (runBtn && !runBtn.classList
      .contains('running')) {
    const iconSVG = getFileIconHTML(
      `main.${langToExt[language] 
        || language}`);
    runBtn.innerHTML = `
      ${iconSVG}
      <span>Run ${
        getLanguageDisplayName(language)
      }</span>
    `;
  }
}

// GET CURRENT LANGUAGE HELPER
function getCurrentLanguage() {
  return window.currentLanguage
    || window.editorLanguage
    || document.getElementById('sb-language')?.innerText?.toLowerCase()
    || document.getElementById('language-select')?.value
    || document.querySelector('[data-language]')?.dataset.language
    || 'javascript';
}

function getFileIcon(filename) {
  const ext = filename.toLowerCase()
    .split('.').pop();
  const icons = {
    js: '🟡', ts: '🔵', py: '🐍',
    java: '☕', cpp: '⚙️', c: '🔧',
    cs: '#️⃣', go: '🔵', rs: '🦀',
    php: '🐘', rb: '💎', html: '🌐',
    css: '🎨', scss: '🎨', json: '📋',
    md: '📝', sql: '🗄️', sh: '⬛',
    yml: '⚙️', yaml: '⚙️', xml: '📄',
    swift: '🍊', kt: '🟣', txt: '📄'
  };
  return icons[ext] || '📄';
}