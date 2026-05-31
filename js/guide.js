import { auth, db, onAuthStateChanged, signOut, doc, getDoc } from './firebase-config.js';

const TOTAL_STEPS = 8;
const STORAGE_KEY = 'codesync_guide_step';

let currentStep = 1;
let completedSteps = new Set();

document.addEventListener('DOMContentLoaded', () => {
    // Auth guard - guide accessible when logged in
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'auth.html';
            return;
        }
        // Load user for sidebar
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById('user-avatar').textContent = data.avatar.initials;
            document.getElementById('user-avatar').style.backgroundColor = data.avatar.color;
            document.getElementById('user-name').textContent = data.fullName;
            document.getElementById('user-email').textContent = data.email;
        }
    });

    // Restore progress from localStorage
    const savedStep = parseInt(localStorage.getItem(STORAGE_KEY)) || 1;
    const savedCompleted = JSON.parse(localStorage.getItem(STORAGE_KEY + '_completed') || '[]');
    completedSteps = new Set(savedCompleted);

    // Build nav dots
    buildNavDots();

    // Go to saved step
    goToStep(savedStep, false);

    // Setup navigation
    document.getElementById('btn-next').addEventListener('click', () => {
        if (currentStep < TOTAL_STEPS) {
            markCompleted(currentStep);
            goToStep(currentStep + 1);
        }
    });

    document.getElementById('btn-prev').addEventListener('click', () => {
        if (currentStep > 1) goToStep(currentStep - 1);
    });

    // Step dot click navigation
    document.querySelectorAll('.step-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const step = parseInt(dot.dataset.step);
            goToStep(step);
        });
    });

    // Sidebar setup
    setupSidebar();

    // Step-specific animations
    setupStepAnimations();
});

function goToStep(step, animate = true) {
    // Bounds check
    step = Math.max(1, Math.min(step, TOTAL_STEPS));

    // Hide current card
    const prevCard = document.getElementById(`step-${currentStep}`);
    if (prevCard) {
        prevCard.classList.remove('active');
        if (animate) {
            prevCard.style.animation = 'fadeOut 0.2s forwards';
            setTimeout(() => { prevCard.style.animation = ''; }, 200);
        }
    }

    // Show new card
    currentStep = step;
    const newCard = document.getElementById(`step-${step}`);
    if (newCard) {
        newCard.classList.add('active');
        if (animate) newCard.style.animation = 'slideUp 0.4s ease';
    }

    // Update progress bar
    const pct = Math.round((step / TOTAL_STEPS) * 100);
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-pct').textContent = `${pct}%`;
    document.getElementById('current-step-num').textContent = step;

    // Update step dots
    document.querySelectorAll('.step-dot').forEach((dot, idx) => {
        const s = idx + 1;
        dot.classList.remove('active', 'completed');
        if (s === step) {
            dot.classList.add('active');
            dot.querySelector('.dot-inner').textContent = s;
        } else if (completedSteps.has(s)) {
            dot.classList.add('completed');
            dot.querySelector('.dot-inner').textContent = '✓';
        } else {
            dot.querySelector('.dot-inner').textContent = s;
        }
    });

    // Update nav dots
    document.querySelectorAll('.nav-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx + 1 === step);
    });

    // Update buttons
    document.getElementById('btn-prev').disabled = step === 1;
    const nextBtn = document.getElementById('btn-next');
    if (step === TOTAL_STEPS) {
        nextBtn.textContent = '🎉 Finish!';
        nextBtn.onclick = () => {
            markCompleted(step);
            showCompletionCelebration();
        };
    } else {
        nextBtn.textContent = 'Next →';
        nextBtn.onclick = () => {
            if (currentStep < TOTAL_STEPS) {
                markCompleted(currentStep);
                goToStep(currentStep + 1);
            }
        };
    }

    // Persist
    localStorage.setItem(STORAGE_KEY, step);

    // Trigger step-specific animation
    triggerStepAnimation(step);
}

function markCompleted(step) {
    completedSteps.add(step);
    localStorage.setItem(STORAGE_KEY + '_completed', JSON.stringify([...completedSteps]));
}

function buildNavDots() {
    const navDotsContainer = document.querySelector('.nav-dots');
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const dot = document.createElement('div');
        dot.className = 'nav-dot';
        dot.dataset.step = i;
        dot.addEventListener('click', () => goToStep(i));
        navDotsContainer.appendChild(dot);
    }
}

// ===== Step-specific Animations =====
function setupStepAnimations() {
    // Step 4: Copy button simulation
    const mockCopyBtn = document.getElementById('mock-copy-btn');
    if (mockCopyBtn) {
        mockCopyBtn.addEventListener('click', () => {
            mockCopyBtn.textContent = '✓ Copied!';
            mockCopyBtn.classList.add('copied');
            setTimeout(() => {
                mockCopyBtn.textContent = '📋 Copy';
                mockCopyBtn.classList.remove('copied');
            }, 2000);
        });
    }

    // Step 8: Run button simulation
    const mockRunBtn = document.getElementById('mock-run-btn');
    const mockConsole = document.getElementById('mock-console');
    if (mockRunBtn && mockConsole) {
        mockRunBtn.addEventListener('click', () => {
            mockRunBtn.classList.add('running');
            mockConsole.innerHTML = '<div class="c-line sys">Running...</div>';

            const lines = [
                { text: 'const greeting = "Hello, CodeSync!";', cls: 'log', delay: 300 },
                { text: '"Hello, CodeSync!"', cls: 'ret', delay: 600 },
                { text: 'console.log(2 + 2);', cls: 'log', delay: 900 },
                { text: '4', cls: 'ret', delay: 1200 },
                { text: 'Execution finished in 1.23ms', cls: 'sys', delay: 1500 },
            ];

            lines.forEach(({ text, cls, delay }) => {
                setTimeout(() => {
                    const div = document.createElement('div');
                    div.className = `c-line ${cls}`;
                    div.textContent = (cls === 'ret' ? '← ' : '') + text;
                    mockConsole.appendChild(div);
                    mockConsole.scrollTop = mockConsole.scrollHeight;
                }, delay);
            });

            setTimeout(() => {
                mockRunBtn.classList.remove('running');
            }, 1600);
        });
    }
}

function triggerStepAnimation(step) {
    if (step === 2) {
        // Cycle avatar colors
        const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e'];
        const av = document.getElementById('mock-avatar-animated');
        if (av) {
            let i = 0;
            const interval = setInterval(() => {
                i = (i + 1) % colors.length;
                av.style.backgroundColor = colors[i];
            }, 800);
            // Clear when leaving step
            setTimeout(() => clearInterval(interval), 5000);
        }
    }

    if (step === 3) {
        // Cycle room code characters
        const codeEl = document.getElementById('gen-code');
        if (codeEl) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let finalCode = 'CS4X9Z';
            let iteration = 0;
            const interval = setInterval(() => {
                codeEl.textContent = finalCode
                    .split('')
                    .map((char, index) => {
                        if (index < iteration) return finalCode[index];
                        return chars[Math.floor(Math.random() * chars.length)];
                    })
                    .join('');
                if (iteration >= finalCode.length) clearInterval(interval);
                iteration += 0.5;
            }, 50);
        }
    }

    if (step === 8 && completedSteps.size >= TOTAL_STEPS - 1) {
        // Show completion CTA if all previous steps done
        document.getElementById('completion-cta')?.classList.remove('hidden');
    }
}

function showCompletionCelebration() {
    const completionCta = document.getElementById('completion-cta');
    if (completionCta) completionCta.classList.remove('hidden');

    // Confetti burst
    const container = document.getElementById('confetti-container');
    if (!container) return;

    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca'];
    for (let i = 0; i < 30; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.cssText = `
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 50}%;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            transform: rotate(${Math.random() * 360}deg);
            animation-delay: ${Math.random() * 0.5}s;
            animation-duration: ${1.5 + Math.random()}s;
        `;
        container.appendChild(piece);
    }

    // Clear confetti after
    setTimeout(() => {
        if (container) container.innerHTML = '';
    }, 3000);
}

function setupSidebar() {
    const collapseBtn = document.getElementById('collapse-btn');
    const sidebar = document.getElementById('sidebar');
    collapseBtn?.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        await signOut(auth);
        window.location.href = 'auth.html';
    });
}
