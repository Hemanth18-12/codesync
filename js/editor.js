/**
 * CodeSync v2.0 - Core Editor Logic (Monaco + Real-time Sync)
 */
import { auth, database, isDev } from './firebase-config.js';
import { ref, onValue, set, serverTimestamp, update, remove, onDisconnect } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const appEditor = {
    roomId: null,
    editorInstance: null,
    isApplyingRemote: false,
    saveTimeout: null,
    userColors: ['#ff6b00', '#00ff88', '#4488ff', '#ff4444', '#ffcc00', '#b042ff'],
    decorations: {},

    init: function() {
        const urlParams = new URLSearchParams(window.location.search);
        this.roomId = urlParams.get('room');

        if (!this.roomId) {
            window.location.href = 'dashboard.html';
            return;
        }

        // Wait for Monaco to be loaded by script tag
        const checkMonaco = setInterval(() => {
            if (window.monaco) {
                clearInterval(checkMonaco);
                this.initMonaco();
            }
        }, 100);

        // Bind shortcuts
        document.addEventListener('keydown', (e) => {
            if(e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.runCode(); }
            if(e.ctrlKey && e.key === 'k') { e.preventDefault(); this.togglePanel('chat'); }
            if(e.ctrlKey && e.key === '`') { e.preventDefault(); this.toggleConsole(); }
        });

        // Setup Console Eval
        document.getElementById('console-eval').addEventListener('keypress', (e) => {
            if(e.key === 'Enter') {
                const code = e.target.value;
                if(code) {
                    this.printToConsole('> ' + code, 'log');
                    this.evalInSandbox(code);
                    e.target.value = '';
                }
            }
        });
    },

    initMonaco: function() {
        this.editorInstance = monaco.editor.create(document.getElementById('monaco-container'), {
            value: '// Loading...',
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: true },
            fontSize: 16,
            fontFamily: 'JetBrains Mono',
            padding: { top: 20 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: "smooth"
        });

        if(isDev) {
            this.editorInstance.setValue("// CodeSync Dev Mode\nconsole.log('Hello World');");
            document.getElementById('room-name').innerText = "Local Dev Room";
            document.getElementById('room-code').innerText = this.roomId;
            document.getElementById('room-name').classList.remove('skeleton-loader');
            this.setupLocalListeners();
            return;
        }

        // Setup Firebase Listeners once auth is ready
        const checkAuth = setInterval(() => {
            if (auth.currentUser) {
                clearInterval(checkAuth);
                this.setupFirebaseSync();
                window.appRooms.initPresence();
                window.appChat.init();
            }
        }, 100);
    },

    setupFirebaseSync: function() {
        const codeRef = ref(database, `rooms/${this.roomId}/code`);
        const infoRef = ref(database, `rooms/${this.roomId}/info`);

        // Load room info
        onValue(infoRef, (snap) => {
            if(snap.exists()) {
                const info = snap.val();
                document.getElementById('room-name').innerText = info.name;
                document.getElementById('room-name').classList.remove('skeleton-loader');
                document.getElementById('room-code').innerText = this.roomId;
                document.getElementById('lang-select').value = info.language;
                this.changeLanguage(info.language, false);
            } else {
                this.showToast("Room does not exist", "error");
                setTimeout(() => window.location.href = 'dashboard.html', 2000);
            }
        });

        // Listen for remote code changes
        onValue(codeRef, (snap) => {
            if(snap.exists()) {
                const data = snap.val();
                if(data.lastUpdatedBy !== auth.currentUser.uid && this.editorInstance) {
                    this.isApplyingRemote = true;
                    // Preserve cursor position
                    const position = this.editorInstance.getPosition();
                    this.editorInstance.setValue(data.content);
                    this.editorInstance.setPosition(position);
                    this.isApplyingRemote = false;
                }
            }
        });

        // Listen for local code changes to push
        this.editorInstance.onDidChangeModelContent((e) => {
            if(this.isApplyingRemote) return;
            
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => {
                const content = this.editorInstance.getValue();
                update(ref(database, `rooms/${this.roomId}/code`), {
                    content: content,
                    lastUpdatedBy: auth.currentUser.uid,
                    timestamp: serverTimestamp()
                });
            }, 500); // 500ms debounce
        });

        // Listen for local cursor changes to push presence
        this.editorInstance.onDidChangeCursorPosition((e) => {
            update(ref(database, `rooms/${this.roomId}/users/${auth.currentUser.uid}`), {
                cursor: { lineNumber: e.position.lineNumber, column: e.position.column }
            });
        });

        // Listen for remote cursor changes
        onValue(ref(database, `rooms/${this.roomId}/users`), (snap) => {
            if(!snap.exists() || !this.editorInstance) return;
            const users = snap.val();
            let newDecorations = [];
            
            let colorIndex = 0;
            Object.keys(users).forEach(uid => {
                if(uid !== auth.currentUser.uid && users[uid].cursor) {
                    const c = users[uid].cursor;
                    const color = this.userColors[colorIndex % this.userColors.length];
                    
                    // Create CSS rule for this user's cursor dynamically if not exists
                    const className = `cursor-${uid}`;
                    if(!document.getElementById(`style-${uid}`)) {
                        const style = document.createElement('style');
                        style.id = `style-${uid}`;
                        style.innerHTML = `
                            .${className} { border-left: 2px solid ${color}; position: absolute; z-index:99; }
                            .${className}::after { content: '${users[uid].name.split(' ')[0]}'; position: absolute; top: -15px; left: 0; background: ${color}; color: #fff; font-size: 10px; padding: 2px 4px; border-radius: 2px; white-space: nowrap; pointer-events: none; }
                        `;
                        document.head.appendChild(style);
                    }

                    newDecorations.push({
                        range: new monaco.Range(c.lineNumber, c.column, c.lineNumber, c.column),
                        options: { className: className }
                    });
                }
                colorIndex++;
            });

            this.decorations[this.roomId] = this.editorInstance.deltaDecorations(
                this.decorations[this.roomId] || [], 
                newDecorations
            );
        });
    },

    setupLocalListeners: function() {
        this.editorInstance.onDidChangeModelContent(() => {
            document.getElementById('btn-run').classList.add('pulse');
            setTimeout(()=> document.getElementById('btn-run').classList.remove('pulse'), 500);
        });
    },

    // --- Editor Commands ---
    changeLanguage: function(lang, notify = true) {
        if(!this.editorInstance) return;
        monaco.editor.setModelLanguage(this.editorInstance.getModel(), lang);
        
        const iconMap = { 'javascript': 'fa-js', 'python': 'fa-python', 'html': 'fa-html5', 'typescript': 'fa-js' };
        document.getElementById('lang-icon').className = `fa-brands ${iconMap[lang] || 'fa-code'}`;
        
        if(notify && !isDev) {
            update(ref(database, `rooms/${this.roomId}/info`), { language: lang });
            this.showToast(`Language changed to ${lang}`, "success");
        }
    },

    changeTheme: function(theme) {
        monaco.editor.setTheme(theme);
    },

    changeFontSize: function(delta) {
        const current = this.editorInstance.getOption(monaco.editor.EditorOption.fontSize);
        const next = Math.max(10, Math.min(32, current + delta));
        this.editorInstance.updateOptions({ fontSize: next });
        document.getElementById('font-size-disp').innerText = next + 'px';
    },

    toggleSetting: function(setting, value) {
        let opts = {};
        if(setting === 'minimap') opts.minimap = { enabled: value };
        if(setting === 'wordWrap') opts.wordWrap = value ? "on" : "off";
        this.editorInstance.updateOptions(opts);
    },

    // --- UI Toggles ---
    togglePanel: function(panel) {
        const el = document.getElementById(`panel-${panel}`);
        el.classList.toggle('hidden');
        // Force monaco layout update
        setTimeout(() => this.editorInstance.layout(), 300);
    },

    toggleConsole: function() {
        const panel = document.getElementById('panel-console');
        const icon = document.getElementById('console-toggle-icon');
        panel.classList.toggle('collapsed');
        icon.classList.toggle('fa-chevron-down', !panel.classList.contains('collapsed'));
        icon.classList.toggle('fa-chevron-up', panel.classList.contains('collapsed'));
        setTimeout(() => this.editorInstance.layout(), 300);
    },

    // --- Execution Engine ---
    runCode: function() {
        if(!this.editorInstance) return;
        const lang = document.getElementById('lang-select').value;
        const code = this.editorInstance.getValue();
        
        const panel = document.getElementById('panel-console');
        if(panel.classList.contains('collapsed')) this.toggleConsole();
        
        this.clearConsole();
        this.printToConsole(`[CodeSync] Running ${lang}...`, 'log');
        
        const startTime = performance.now();

        if (lang === 'javascript' || lang === 'typescript') {
            this.evalInSandbox(code, startTime);
        } else {
            this.printToConsole(`[Error] Client-side execution for ${lang} is currently mocked.`, 'error');
            setTimeout(() => this.printToConsole('Execution finished.', 'log'), 500);
        }
    },

    evalInSandbox: function(code, startTime = null) {
        // We inject the code into our hidden iframe to run it safely and capture console
        const frame = document.getElementById('sandbox-frame');
        const content = `
            <script>
                const origLog = console.log;
                const origErr = console.error;
                const origWarn = console.warn;
                
                console.log = function(...args) { window.parent.postMessage({type: 'console', level: 'log', args: args.map(a => String(a))}, '*'); origLog(...args); };
                console.error = function(...args) { window.parent.postMessage({type: 'console', level: 'error', args: args.map(a => String(a))}, '*'); origErr(...args); };
                console.warn = function(...args) { window.parent.postMessage({type: 'console', level: 'warn', args: args.map(a => String(a))}, '*'); origWarn(...args); };
                
                window.onerror = function(msg, url, line) {
                    console.error("Runtime Error: " + msg + " (Line " + (line - 16) + ")"); // approx offset
                    return true;
                };

                try {
                    const result = eval(${JSON.stringify(code)});
                    if(result !== undefined) {
                        window.parent.postMessage({type: 'eval_result', data: String(result)}, '*');
                    }
                } catch(e) {
                    console.error(e.toString());
                }
                
                window.parent.postMessage({type: 'eval_done'}, '*');
            </script>
        `;
        
        // Listen for messages from iframe
        const listener = (e) => {
            if(e.data.type === 'console') {
                this.printToConsole(e.data.args.join(' '), e.data.level);
            }
            if(e.data.type === 'eval_result') {
                this.printToConsole(`<- ${e.data.data}`, 'return');
            }
            if(e.data.type === 'eval_done') {
                if(startTime) {
                    const t = (performance.now() - startTime).toFixed(2);
                    this.printToConsole(`[CodeSync] Execution finished in ${t}ms.`, 'log');
                }
                window.removeEventListener('message', listener);
            }
        };
        window.addEventListener('message', listener);
        
        frame.srcdoc = content;
    },

    printToConsole: function(msg, level) {
        const out = document.getElementById('console-output');
        const el = document.createElement('div');
        el.className = `console-line console-${level}`;
        
        let prefix = '';
        if(level === 'error') prefix = '<i class="fa-solid fa-triangle-exclamation"></i> ';
        if(level === 'warn') prefix = '<i class="fa-solid fa-circle-exclamation"></i> ';
        
        el.innerHTML = prefix + msg.replace(/\n/g, '<br>');
        out.appendChild(el);
        out.scrollTop = out.scrollHeight;
    },

    clearConsole: function() {
        document.getElementById('console-output').innerHTML = '';
    },

    showToast: function(msg, type="info") {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(), 300); }, 3000);
    }
};

window.appEditor = appEditor;
document.addEventListener('DOMContentLoaded', () => appEditor.init());
