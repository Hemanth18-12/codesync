import sys
import re

def apply_fixes():
    with open('js/editor.js', 'r', encoding='utf-8') as f:
        content = f.read()

    # Fix 1: runHTMLPreview
    old_html_preview = '''const runHTMLPreview = (code) => {
  // Switch to preview tab
  switchTab('preview');
  
  // Find or create preview iframe
  let previewFrame = document.getElementById(
    'html-preview-frame');
  
  if (!previewFrame) {
    const previewPanel = 
      document.getElementById('panel-preview')
      || document.querySelector(
        '.panel-preview');
    if (!previewPanel) {
      return {
        stdout: 'Preview panel not found',
        stderr: ''
      };
    }
    previewFrame = document.createElement(
      'iframe');
    previewFrame.id = 'html-preview-frame';
    previewFrame.style.cssText = 
      'width:100%;height:100%;border:none;' +
      'background:white;';
    previewPanel.appendChild(previewFrame);
  }

  // Use srcdoc to avoid CORS
  // This is the ONLY safe way to inject HTML
  previewFrame.srcdoc = code;
  
  return {
    stdout: '✓ HTML rendered in Preview tab',
    stderr: ''
  };
};'''
    new_html_preview = '''const runHTMLPreview = (code) => {
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
};'''
    if old_html_preview in content:
        content = content.replace(old_html_preview, new_html_preview)
        print('Fix 1 (runHTMLPreview) applied')
    else:
        print('Fix 1 (runHTMLPreview) NOT found')

    # Fix 1 part 2: Remove preview-tab-btn
    old_preview_btn_1 = '''  const previewTabBtn = document.getElementById('preview-tab-btn');
  if (previewTabBtn) {
    previewTabBtn.style.display = (lang === 'html' || lang === 'css') ? 'flex' : 'none';
  }'''
    if old_preview_btn_1 in content:
        content = content.replace(old_preview_btn_1, '')
        print('Fix 1 (preview-tab-btn 1) removed')
        
    old_preview_btn_2 = '''  // Show/hide preview tab
  const previewBtn = document.getElementById(
    'preview-tab-btn');
  if (previewBtn) {
    previewBtn.style.display = 
      (language === 'html' || 
       language === 'css') 
      ? 'flex' : 'none';
  }'''
    if old_preview_btn_2 in content:
        content = content.replace(old_preview_btn_2, '')
        print('Fix 1 (preview-tab-btn 2) removed')

    # Fix 2: Terminal
    old_term_init = '''  init() {
    const input = document.getElementById('terminal-input');
    if (!input) return;'''
    new_term_init = '''  init() {
    const input = document.getElementById(
      'terminal-input-field');
    if (!input) {
      console.warn('Terminal input not found: terminal-input-field');
      return;
    }'''
    if old_term_init in content:
        content = content.replace(old_term_init, new_term_init)
        print('Fix 2 (term init) applied')

    old_term_exec = '''  async execute(cmd) {
    const lang = document.getElementById('sb-language')?.innerText.toLowerCase() || 'javascript';'''
    new_term_exec = '''  async execute(cmd) {
    const lang = window.currentLanguage 
      || document.getElementById(
        'sb-language')?.innerText
        ?.toLowerCase() 
      || 'javascript';'''
    if old_term_exec in content:
        content = content.replace(old_term_exec, new_term_exec)
        print('Fix 2 (term execute) applied')

    old_dom_loaded = '''document.addEventListener('DOMContentLoaded', () => {
  terminal.init();'''
    new_dom_loaded = '''document.addEventListener('DOMContentLoaded', () => {
  terminal.init();

  // Also init terminal after monaco ready
  window.addEventListener('monaco-ready', () => {
    terminal.init();
  });'''
    if old_dom_loaded in content:
        content = content.replace(old_dom_loaded, new_dom_loaded)
        print('Fix 2 (term monaco-ready) applied')

    # Remove second terminal listener
    term_input_regex = re.compile(r'// 6\. TERMINAL INPUT HANDLER.*?const terminalInput.*?// GET CURRENT LANGUAGE HELPER', re.DOTALL)
    if term_input_regex.search(content):
        content = term_input_regex.sub('// GET CURRENT LANGUAGE HELPER', content)
        print('Fix 2 (duplicate terminal logic) removed')
        
    # Fix 3: Errors not showing in Problems tab
    if 'function parseAndShowProblems' not in content:
        run_code_end = '''  setTimeout(() => setRunState('idle', language), 2500);
};'''
        parse_problems_code = '''

function parseAndShowProblems(stderr, language) {
  if (!stderr || !stderr.trim()) {
    showProblemsEmpty();
    return;
  }

  const problems = [];
  const lines = stderr.split('\\n');

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
}'''
        parse_problems_code = parse_problems_code.replace('${', '${') # python formatting
        if run_code_end in content:
            content = content.replace(run_code_end, run_code_end + parse_problems_code)
            print('Fix 3 (parseAndShowProblems added) applied')

    old_run_err = '''    const hasError = !!result.stderr?.trim();
    appendToOutput('divider', hasError ? `── ✕ Failed · ${secs}s ───────` : `── ✓ Completed · ${secs}s ────`);
    setRunState(hasError ? 'error' : 'success', language);'''
    new_run_err = '''    const hasError = !!result.stderr?.trim();
    appendToOutput('divider', hasError ? `── ✕ Failed · ${secs}s ───────` : `── ✓ Completed · ${secs}s ────`);
    setRunState(hasError ? 'error' : 'success', language);

    // Show errors in Problems tab
    if (result.stderr?.trim()) {
      parseAndShowProblems(
        result.stderr, language);
      switchBottomTab('problems');
    } else {
      showProblemsEmpty();
    }'''
    if old_run_err in content:
        content = content.replace(old_run_err, new_run_err)
        print('Fix 3 (runCode problems hook) applied')

    # Fix 5: Workspace
    old_open_file = '''        monaco.editor.setModelLanguage(editorInstance.getModel(), mappedLang);
        if(editorInstance.getValue() !== file.content) {
            editorInstance.setValue(file.content || '');
        }'''
    new_open_file = '''        monaco.editor.setModelLanguage(editorInstance.getModel(), mappedLang);
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
        editorInstance.focus();'''
    if old_open_file in content:
        content = content.replace(old_open_file, new_open_file)
        print('Fix 5 (openFile updates) applied')

    if 'const PISTON_API =' not in content:
        content = content.replace("from './firebase-config.js';", "from './firebase-config.js';\n\nconst PISTON_API = \n  'https://emkc.org/api/v2/piston/execute';")
        print('Fix 5 (PISTON_API) applied')

    if 'function getFileIcon(filename)' not in content:
        content += '''\nfunction getFileIcon(filename) {
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
}'''
        print('Fix 5 (getFileIcon) applied')

    with open('js/editor.js', 'w', encoding='utf-8') as f:
        f.write(content)

apply_fixes()
