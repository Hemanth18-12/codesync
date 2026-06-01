import { auth, db, doc, updateDoc, increment } from './firebase-config.js';
import { onAuthStateChanged } from './firebase-config.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────
// API key is loaded from js/config.js (not tracked by git)
// To set up: create js/config.js with: window.GEMINI_API_KEY = 'your-key-here';
const GEMINI_API_KEY = window.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';

// ── STATE ─────────────────────────────────────────────────────────────────────
let conversationHistory = [];
let currentUser = null;
let isAILoading = false;

// ── WAIT FOR AUTH ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => { currentUser = user; });

// ── INJECT AI TAB INTO EDITOR SIDEBAR ────────────────────────────────────────
function injectAIPanel() {
    const activityBar = document.querySelector('.activity-bar');
    if (!activityBar || document.getElementById('ai-activity-item')) return;

    const aiActivityItem = document.createElement('div');
    aiActivityItem.className = 'activity-item';
    aiActivityItem.id = 'ai-activity-item';
    aiActivityItem.dataset.panel = 'ai';
    aiActivityItem.title = 'AI Assistant';
    aiActivityItem.innerHTML = '✨';
    activityBar.appendChild(aiActivityItem);

    const editorSidebar = document.getElementById('editor-sidebar');
    if (!editorSidebar) return;

    const aiPanel = document.createElement('div');
    aiPanel.className = 'sidebar-panel';
    aiPanel.id = 'panel-ai';
    aiPanel.innerHTML = `
        <div class="sidebar-title">
            <span>AI Assistant</span>
            <span class="ai-badge">Gemini ✨</span>
        </div>

        <div class="ai-quick-actions" id="ai-quick-actions">
            <button class="ai-action-btn" data-action="explain" id="ai-btn-explain">📖 Explain</button>
            <button class="ai-action-btn" data-action="fix" id="ai-btn-fix">🐛 Fix Bugs</button>
            <button class="ai-action-btn" data-action="optimize" id="ai-btn-optimize">⚡ Optimize</button>
            <button class="ai-action-btn" data-action="comments" id="ai-btn-comments">📝 Comment</button>
            <button class="ai-action-btn" data-action="convert" id="ai-btn-convert">🔄 Convert</button>
            <button class="ai-action-btn" data-action="tests" id="ai-btn-tests">✅ Tests</button>
        </div>

        <div class="ai-convert-select hidden" id="ai-convert-select">
            <select id="ai-target-lang">
                <option value="Python">Python</option>
                <option value="JavaScript">JavaScript</option>
                <option value="TypeScript">TypeScript</option>
                <option value="Java">Java</option>
                <option value="C++">C++</option>
                <option value="Go">Go</option>
                <option value="Rust">Rust</option>
                <option value="PHP">PHP</option>
            </select>
            <button class="ai-action-btn" id="ai-btn-convert-go" style="margin-top:0.5rem;width:100%;">Convert Now</button>
        </div>

        <div class="ai-messages" id="ai-messages">
            <div class="ai-welcome">
                <div class="ai-welcome-icon">✨</div>
                <p>Powered by Google Gemini. Ask me anything about your code. Select text in the editor for targeted help.</p>
            </div>
        </div>

        <div class="ai-input-area">
            <textarea 
                id="ai-input" 
                placeholder="Ask anything about your code..." 
                rows="2"
            ></textarea>
            <div class="ai-input-actions">
                <button class="ai-clear-btn" id="ai-clear-btn" title="Clear conversation">🗑️</button>
                <button class="ai-send-btn" id="ai-send-btn">Send ✨</button>
            </div>
        </div>
    `;
    editorSidebar.appendChild(aiPanel);

    aiActivityItem.addEventListener('click', () => {
        const sidebar = document.getElementById('editor-sidebar');
        const allItems = document.querySelectorAll('.activity-item');
        const allPanels = document.querySelectorAll('.sidebar-panel');

        if (aiActivityItem.classList.contains('active') && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            aiActivityItem.classList.remove('active');
            return;
        }

        sidebar.classList.remove('collapsed');
        allItems.forEach(i => i.classList.remove('active'));
        aiActivityItem.classList.add('active');
        allPanels.forEach(p => p.classList.remove('active'));
        aiPanel.classList.add('active');
    });

    document.getElementById('ai-btn-explain').addEventListener('click', () => runAction('explain'));
    document.getElementById('ai-btn-fix').addEventListener('click', () => runAction('fix'));
    document.getElementById('ai-btn-optimize').addEventListener('click', () => runAction('optimize'));
    document.getElementById('ai-btn-comments').addEventListener('click', () => runAction('comments'));
    document.getElementById('ai-btn-tests').addEventListener('click', () => runAction('tests'));

    document.getElementById('ai-btn-convert').addEventListener('click', () => {
        const sel = document.getElementById('ai-convert-select');
        sel.classList.toggle('hidden');
    });
    document.getElementById('ai-btn-convert-go').addEventListener('click', () => runAction('convert'));

    document.getElementById('ai-send-btn').addEventListener('click', sendCustomQuestion);
    document.getElementById('ai-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendCustomQuestion();
        }
    });

    document.getElementById('ai-clear-btn').addEventListener('click', clearConversation);

    document.querySelectorAll('.ai-action-btn').forEach((btn, i) => {
        btn.style.animationDelay = `${i * 80}ms`;
        btn.classList.add('ai-stagger-in');
    });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function getEditorCode() {
    const editor = window.monacoEditor || window.editorInstance;
    if (!editor) return '';
    return editor.getValue();
}

function getSelectedCode() {
    const editor = window.monacoEditor || window.editorInstance;
    if (!editor) return '';
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return '';
    return editor.getModel().getValueInRange(selection);
}

function getEditorLanguage() {
    const editor = window.monacoEditor || window.editorInstance;
    if (!editor) return 'code';
    return editor.getModel()?.getLanguageId() || 'code';
}

function applyCodeToEditor(code) {
    const editor = window.monacoEditor || window.editorInstance;
    if (!editor) return;
    editor.setValue(code);
}

// ── GEMINI API CALL ───────────────────────────────────────────────────────────
async function callAI(prompt) {
    if (GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY') {
        return '⚠️ **API Key Missing**\n\nTo use the AI Assistant:\n1. Visit [aistudio.google.com](https://aistudio.google.com)\n2. Click "Get API Key" — it is completely FREE\n3. Open `js/ai-assistant.js` and replace `YOUR_GEMINI_API_KEY` with your key\n\nThe AI Assistant uses Google Gemini to analyze and improve your code.';
    }

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    // Include conversation history
                    ...conversationHistory.map(msg => ({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    })),
                    // Add current prompt
                    {
                        role: 'user',
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048
                }
            })
        }
    );

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.candidates || data.candidates.length === 0) {
        throw new Error('No response from Gemini. Please try again.');
    }

    const reply = data.candidates[0].content.parts[0].text;

    // Update conversation history
    conversationHistory.push({ role: 'user', content: prompt });
    conversationHistory.push({ role: 'assistant', content: reply });

    // Keep history to last 10 turns (20 messages)
    if (conversationHistory.length > 20) {
        conversationHistory = conversationHistory.slice(-20);
    }

    return reply;
}

// ── TRACK AI USAGE IN FIRESTORE ───────────────────────────────────────────────
async function trackAIUsage(action) {
    if (!currentUser) return;
    try {
        const today = new Date().toISOString().slice(0, 10);
        await updateDoc(doc(db, 'users', currentUser.uid), {
            'stats.aiQueriesTotal': increment(1),
            [`stats.aiQueriesDaily.${today}`]: increment(1),
            [`stats.aiActions.${action}`]: increment(1)
        });
    } catch (e) {
        // Silently fail — stats are non-critical
    }
}

// ── QUICK ACTIONS ─────────────────────────────────────────────────────────────
async function runAction(action) {
    if (isAILoading) return;

    const code = getSelectedCode() || getEditorCode();
    const lang = getEditorLanguage();

    if (!code.trim()) {
        showAIMessage('user', `Run: ${action}`);
        showAIMessage('ai', '⚠️ The editor is empty. Please write or paste some code first.');
        return;
    }

    let prompt = '';
    let userLabel = '';

    switch (action) {
        case 'explain':
            const isSelected = !!getSelectedCode();
            userLabel = isSelected ? '📖 Explain selected code' : '📖 Explain all code';
            prompt = `Explain this ${lang} code clearly and concisely. Cover what it does, how it works, and any important patterns:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            break;

        case 'fix':
            userLabel = '🐛 Fix bugs in this code';
            prompt = `Find and fix all bugs in this ${lang} code. List each bug found, then provide the complete fixed version:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            break;

        case 'optimize':
            userLabel = '⚡ Optimize this code';
            prompt = `Optimize this ${lang} code for performance and best practices. Explain improvements made, then provide the optimized version:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            break;

        case 'comments':
            userLabel = '📝 Add professional comments';
            prompt = `Add professional, clear inline comments to this ${lang} code. Document functions, complex logic, and important steps. Return only the commented code:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            break;

        case 'convert':
            const targetLang = document.getElementById('ai-target-lang')?.value || 'Python';
            userLabel = `🔄 Convert to ${targetLang}`;
            prompt = `Convert this ${lang} code to ${targetLang}. Keep the same logic and functionality. Provide the complete converted code:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            document.getElementById('ai-convert-select')?.classList.add('hidden');
            break;

        case 'tests':
            userLabel = '✅ Write unit tests';
            prompt = `Write comprehensive unit tests for this ${lang} code. Cover edge cases and main functionality:\n\n\`\`\`${lang}\n${code}\n\`\`\``;
            break;
    }

    showAIMessage('user', userLabel);
    await fetchAndDisplayAI(prompt, action);
    await trackAIUsage(action);
}

// ── CUSTOM QUESTION ───────────────────────────────────────────────────────────
async function sendCustomQuestion() {
    if (isAILoading) return;
    const input = document.getElementById('ai-input');
    const question = input?.value?.trim();
    if (!question) return;

    const code = getEditorCode();
    const lang = getEditorLanguage();

    input.value = '';

    const prompt = code.trim()
        ? `Given this ${lang} code:\n\`\`\`${lang}\n${code}\n\`\`\`\n\nQuestion: ${question}`
        : question;

    showAIMessage('user', question);
    await fetchAndDisplayAI(prompt, 'custom');
    await trackAIUsage('custom');
}

// ── FETCH AI AND DISPLAY ──────────────────────────────────────────────────────
async function fetchAndDisplayAI(prompt, action) {
    isAILoading = true;
    const loadingId = showLoadingMessage();

    try {
        const response = await callAI(prompt);
        removeLoadingMessage(loadingId);
        showAIMessage('ai', response, action);
    } catch (error) {
        removeLoadingMessage(loadingId);
        showAIMessage('ai', `❌ **Error:** ${error.message}\n\nPlease check your API key and try again.`);
        console.error('AI error:', error);
    } finally {
        isAILoading = false;
    }
}

// ── MESSAGE RENDERING ─────────────────────────────────────────────────────────
function showAIMessage(role, content, action = null) {
    const container = document.getElementById('ai-messages');
    if (!container) return;

    const welcome = container.querySelector('.ai-welcome');
    if (welcome) welcome.remove();

    const msgEl = document.createElement('div');
    msgEl.className = `ai-message ai-message-${role}`;

    if (role === 'user') {
        msgEl.innerHTML = `<div class="ai-bubble ai-bubble-user">${escapeHtml(content)}</div>`;
    } else {
        const rendered = renderMarkdown(content);
        const hasCode = content.includes('```');
        const canApply = ['fix', 'optimize', 'comments', 'convert'].includes(action) && hasCode;

        msgEl.innerHTML = `
            <div class="ai-avatar-icon">✨</div>
            <div class="ai-bubble ai-bubble-ai">
                <div class="ai-response-content">${rendered}</div>
                ${canApply ? `<button class="ai-apply-btn" data-action="${action}">⚡ Apply to Editor</button>` : ''}
            </div>
        `;

        const applyBtn = msgEl.querySelector('.ai-apply-btn');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                const extracted = extractCodeFromResponse(content);
                if (extracted) {
                    applyCodeToEditor(extracted);
                    applyBtn.textContent = '✅ Applied!';
                    applyBtn.disabled = true;
                    setTimeout(() => {
                        applyBtn.textContent = '⚡ Apply to Editor';
                        applyBtn.disabled = false;
                    }, 2000);
                }
            });
        }

        msgEl.querySelectorAll('.ai-copy-code').forEach(btn => {
            btn.addEventListener('click', () => {
                const code = btn.nextElementSibling?.textContent || '';
                navigator.clipboard.writeText(code).then(() => {
                    btn.textContent = '✅ Copied!';
                    btn.style.color = '#10b981';
                    setTimeout(() => {
                        btn.textContent = '📋 Copy';
                        btn.style.color = '';
                    }, 2000);
                });
            });
        });

        typewriterEffect(msgEl.querySelector('.ai-response-content'));
    }

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

function showLoadingMessage() {
    const container = document.getElementById('ai-messages');
    if (!container) return null;

    const id = 'ai-loading-' + Date.now();
    const el = document.createElement('div');
    el.className = 'ai-message ai-message-ai';
    el.id = id;
    el.innerHTML = `
        <div class="ai-avatar-icon">✨</div>
        <div class="ai-bubble ai-bubble-ai">
            <div class="ai-thinking">
                <span>Gemini is thinking</span>
                <span class="ai-dots">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                </span>
            </div>
        </div>
    `;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return id;
}

function removeLoadingMessage(id) {
    if (id) document.getElementById(id)?.remove();
}

function clearConversation() {
    conversationHistory = [];
    const container = document.getElementById('ai-messages');
    if (container) {
        container.innerHTML = `
            <div class="ai-welcome">
                <div class="ai-welcome-icon">✨</div>
                <p>Conversation cleared. Ask me anything about your code.</p>
            </div>
        `;
    }
}

// ── MARKDOWN RENDERER ─────────────────────────────────────────────────────────
function renderMarkdown(text) {
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = escapeHtml(code.trim());
        return `<div class="ai-code-block">
            <div class="ai-code-header">
                <span class="ai-code-lang">${lang || 'code'}</span>
                <button class="ai-copy-code">📋 Copy</button>
            </div>
            <pre><code>${escaped}</code></pre>
        </div>`;
    });

    text = text.replace(/`([^`]+)`/g, '<code class="ai-inline-code">$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^[-•] (.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    text = text.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    text = text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
    text = `<p>${text}</p>`;

    return text;
}

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function extractCodeFromResponse(text) {
    const match = text.match(/```(?:\w*)\n?([\s\S]*?)```/);
    return match ? match[1].trim() : null;
}

// ── TYPEWRITER EFFECT ─────────────────────────────────────────────────────────
function typewriterEffect(el) {
    if (!el) return;
    const html = el.innerHTML;
    el.innerHTML = html;
    el.style.animation = 'aiFadeIn 0.4s ease';
}

// ── FLOATING AI BUTTON (Dashboard) ───────────────────────────────────────────
export function initDashboardAIButton() {
    if (document.getElementById('ai-float-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'ai-float-btn';
    btn.className = 'ai-float-btn';
    btn.innerHTML = '✨';
    btn.title = 'Quick AI Assistant';
    document.body.appendChild(btn);

    const modal = document.createElement('div');
    modal.id = 'ai-quick-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-card" style="max-width:600px;">
            <div class="modal-header">
                <h2>✨ Quick AI Assistant</h2>
                <span class="ai-badge" style="font-size:0.7rem;">
                    Gemini
                </span>
                <button class="icon-btn" 
                    onclick="document.getElementById(
                    'ai-quick-modal').classList.remove('active')">
                    ✕
                </button>
            </div>
            <div class="form-group">
                <label>Paste your code (optional)</label>
                <textarea 
                    id="ai-quick-code" 
                    rows="6" 
                    placeholder="Paste code here..."
                    style="width:100%;
                    font-family:monospace;
                    background:var(--bg-secondary);
                    border:1px solid var(--border-color);
                    color:var(--text-primary);
                    padding:0.75rem;
                    border-radius:var(--radius-md);
                    resize:vertical;">
                </textarea>
            </div>
            <div class="form-group">
                <label>Your question</label>
                <input 
                    type="text" 
                    id="ai-quick-question" 
                    placeholder="What does this code do? How can I improve it?"
                    style="width:100%;">
            </div>
            <div id="ai-quick-response" 
                class="ai-quick-response hidden">
            </div>
            <div class="modal-actions">
                <button class="btn-secondary" 
                    onclick="document.getElementById(
                    'ai-quick-modal').classList.remove('active')">
                    Close
                </button>
                <button class="btn-primary" 
                    id="ai-quick-submit" 
                    style="background:linear-gradient(
                    135deg,#7c3aed,#a855f7);">
                    ✨ Ask Gemini
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    btn.addEventListener('click', () => 
        modal.classList.add('active'));

    document.getElementById('ai-quick-submit')
        .addEventListener('click', async () => {
        const code = document.getElementById(
            'ai-quick-code').value.trim();
        const question = document.getElementById(
            'ai-quick-question').value.trim();
        if (!question) return;

        const submitBtn = document.getElementById(
            'ai-quick-submit');
        const responseEl = document.getElementById(
            'ai-quick-response');

        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Thinking...';
        responseEl.classList.remove('hidden');
        responseEl.innerHTML = `
            <div class="ai-thinking">
                <span>Gemini is thinking</span>
                <span class="ai-dots">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                </span>
            </div>`;

        try {
            const prompt = code
                ? `Given this code:\n\`\`\`\n${code}\n\`\`\`\n\nQuestion: ${question}`
                : question;

            const result = await callAI(prompt);
            responseEl.innerHTML = renderMarkdown(result);

            responseEl.querySelectorAll('.ai-copy-code')
                .forEach(btn => {
                btn.addEventListener('click', () => {
                    const codeText = 
                        btn.nextElementSibling
                        ?.textContent || '';
                    navigator.clipboard
                        .writeText(codeText);
                    btn.textContent = '✅ Copied!';
                    setTimeout(() => 
                        btn.textContent = '📋 Copy', 
                        2000);
                });
            });
        } catch (err) {
            responseEl.innerHTML = `
                <p style="color:var(--error-color)">
                    ❌ ${err.message}
                </p>`;
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = '✨ Ask Gemini';
        }
    });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
if (document.getElementById('monaco-container')) {
    if (window.__monacoReady) {
        injectAIPanel();
    } else {
        window.addEventListener('monaco-ready', injectAIPanel);
    }
}

if (document.getElementById('view-overview')) {
    document.addEventListener('DOMContentLoaded', () => {
        import('./ai-assistant.js').then(m => 
            m.initDashboardAIButton());
    });
}