const fs = require('fs');
let code = fs.readFileSync('js/editor.js', 'utf8');

// Fix setRunState
code = code.replace(/const setRunState = \(state, lang\) => \{[\s\S]*?\};\n\nlet runCount = 0;/g, 
`const setRunState = (state, lang) => {
  const btns = [runBtn, headerRunBtn].filter(Boolean);
  btns.forEach(btn => btn.className = btn.className.replace(/running|success|error/g, '').trim());

  if (state === 'running') {
    btns.forEach(btn => {
      btn.classList.add('running');
      btn.innerHTML = \`⏳ Running...\`;
    });
    progressBar?.classList.add('running');
  } else if (state === 'success') {
    btns.forEach(btn => {
      btn.classList.add('success');
      btn.innerHTML = \`✓ Done\`;
    });
    progressBar?.classList.remove('running');
  } else if (state === 'error') {
    btns.forEach(btn => {
      btn.classList.add('error');
      btn.innerHTML = \`✕ Error\`;
    });
    progressBar?.classList.remove('running');
  } else {
    btns.forEach(btn => {
      btn.innerHTML = \`▶ Run\`;
    });
    progressBar?.classList.remove('running');
  }
};

let runCount = 0;`);

// Fix mangled unicode
code = code.replace(/â”€/g, '─')
           .replace(/âœ—/g, '✕')
           .replace(/âœ“/g, '✓')
           .replace(/âœ•/g, '✕')
           .replace(/â–¶/g, '▶')
           .replace(/â— /g, '●')
           .replace(/â ¯/g, '❯')
           .replace(/Â·/g, '·')
           .replace(/â ³/g, '⏳');

fs.writeFileSync('js/editor.js', code, 'utf8');
console.log('Fixed runState and unicode.');
