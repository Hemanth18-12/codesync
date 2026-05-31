import { 
    auth, 
    db, 
    googleProvider, 
    githubProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from './firebase-config.js';

document.addEventListener('DOMContentLoaded', () => {
    // Check Auth State
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Already logged in, redirect to dashboard
            window.location.href = 'dashboard.html';
        }
    });

    // --- UI Logic ---
    const tabs = document.querySelectorAll('.tab-btn');
    const sections = document.querySelectorAll('.form-section');
    const tabIndicator = document.querySelector('.tab-indicator');
    const switchLinks = document.querySelectorAll('[data-switch]');
    
    function switchTab(tabId) {
        // Update tabs
        tabs.forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (activeTab) activeTab.classList.add('active');
        
        // Move indicator
        if (tabId === 'signin') {
            tabIndicator.style.transform = 'translateX(0)';
        } else if (tabId === 'signup') {
            tabIndicator.style.transform = 'translateX(100%)';
        }

        // Update sections
        sections.forEach(s => {
            s.classList.remove('active');
            s.style.animation = 'none';
            s.offsetHeight; // trigger reflow
        });
        const activeSection = document.getElementById(`${tabId}-section`);
        activeSection.classList.add('active');
        activeSection.style.animation = 'fadeIn 0.3s ease';
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    switchLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(e.target.dataset.switch);
        });
    });

    document.getElementById('forgot-link').addEventListener('click', (e) => {
        e.preventDefault();
        // Hide tabs
        document.querySelector('.auth-tabs').style.display = 'none';
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById('forgot-section').classList.add('active');
    });

    // Back to signin from forgot
    document.querySelector('#forgot-section [data-switch="signin"]').addEventListener('click', (e) => {
        document.querySelector('.auth-tabs').style.display = 'flex';
    });

    // Password visibility toggle
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function() {
            const input = this.previousElementSibling.previousElementSibling; // The input field
            if (input.type === 'password') {
                input.type = 'text';
                this.textContent = '🙈';
            } else {
                input.type = 'password';
                this.textContent = '👁️';
            }
        });
    });

    // --- Validation & Feedback Logic ---
    function showError(inputId, msg) {
        const input = document.getElementById(inputId);
        const group = input.closest('.input-group');
        const errorSpan = group.querySelector('.error-msg');
        group.classList.add('error');
        errorSpan.textContent = msg;
        // Shake animation
        group.style.animation = 'none';
        group.offsetHeight;
        group.style.animation = 'shake 0.4s ease';
    }

    function clearError(inputId) {
        const input = document.getElementById(inputId);
        const group = input.closest('.input-group');
        const errorSpan = group.querySelector('.error-msg');
        group.classList.remove('error');
        errorSpan.textContent = '';
    }

    // Live validation
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => clearError(input.id));
    });

    // Password Strength Meter
    const suPassword = document.getElementById('su-password');
    const strengthSection = document.querySelector('.password-strength');
    const bars = document.querySelectorAll('.strength-bars .bar');
    const strengthLabel = document.querySelector('.strength-label');
    
    const reqLen = document.getElementById('req-len');
    const reqUp = document.getElementById('req-up');
    const reqNum = document.getElementById('req-num');
    const reqSp = document.getElementById('req-sp');

    suPassword.addEventListener('focus', () => strengthSection.style.display = 'block');
    
    suPassword.addEventListener('input', (e) => {
        const val = e.target.value;
        let score = 0;
        
        // Checks
        const hasLen = val.length >= 8;
        const hasUp = /[A-Z]/.test(val);
        const hasNum = /[0-9]/.test(val);
        const hasSp = /[^A-Za-z0-9]/.test(val);

        reqLen.textContent = hasLen ? '✓ 8+ chars' : '✗ 8+ chars';
        reqLen.className = hasLen ? 'valid' : '';
        if(hasLen) score++;

        reqUp.textContent = hasUp ? '✓ uppercase' : '✗ uppercase';
        reqUp.className = hasUp ? 'valid' : '';
        if(hasUp) score++;

        reqNum.textContent = hasNum ? '✓ number' : '✗ number';
        reqNum.className = hasNum ? 'valid' : '';
        if(hasNum) score++;

        reqSp.textContent = hasSp ? '✓ special char' : '✗ special char';
        reqSp.className = hasSp ? 'valid' : '';
        if(hasSp) score++;

        // Update bars
        bars.forEach(b => b.style.background = 'var(--border-color)');
        const colors = ['var(--error-color)', 'var(--warning-color)', '#fbbf24', 'var(--success-color)'];
        const labels = ['Weak', 'Fair', 'Strong', 'Very Strong'];
        
        if (val.length > 0) {
            score = Math.max(1, score);
            for(let i=0; i<score; i++) {
                bars[i].style.background = colors[score-1];
            }
            strengthLabel.textContent = labels[score-1];
            strengthLabel.style.color = colors[score-1];
        } else {
            strengthLabel.textContent = 'Password strength';
            strengthLabel.style.color = 'var(--text-muted)';
        }
    });

    // Confirm password live match
    const suConfirm = document.getElementById('su-confirm');
    const matchInd = document.querySelector('.match-indicator');
    suConfirm.addEventListener('input', (e) => {
        if(e.target.value === '') {
            matchInd.textContent = '';
        } else if (e.target.value === suPassword.value) {
            matchInd.textContent = '✓';
            matchInd.style.color = 'var(--success-color)';
        } else {
            matchInd.textContent = '✗';
            matchInd.style.color = 'var(--error-color)';
        }
    });

    // Toast System
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = '';
        if(type==='success') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        if(type==='error') icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';

        toast.innerHTML = `${icon} <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            if(container.contains(toast)) toast.remove();
        }, 4000);
    }

    function handleFirebaseError(error, formType) {
        console.error(error);
        const code = error.code;
        let msg = "An error occurred. Please try again.";
        
        switch(code) {
            case 'auth/invalid-email': msg = "Invalid email format."; break;
            case 'auth/user-not-found': msg = "No account found with this email."; break;
            case 'auth/wrong-password': msg = "Incorrect password."; break;
            case 'auth/email-already-in-use': msg = "Email is already registered."; break;
            case 'auth/weak-password': msg = "Password is too weak."; break;
            case 'auth/too-many-requests': msg = "Too many failed attempts. Try again later."; break;
            case 'auth/invalid-credential': msg = "Invalid credentials provided."; break;
        }

        if (formType === 'signin') {
            if (code.includes('password')) showError('si-password', msg);
            else if (code.includes('email') || code.includes('user')) showError('si-email', msg);
            else showToast(msg, 'error');
            document.getElementById('signin-form').closest('.auth-card').style.animation = 'shake 0.4s';
        } else if (formType === 'signup') {
            if (code.includes('email')) showError('su-email', msg);
            else showToast(msg, 'error');
        } else {
            showToast(msg, 'error');
        }
    }

    function setLoading(btnId, isLoading) {
        const btn = document.getElementById(btnId);
        if(isLoading) {
            btn.classList.add('loading');
            btn.disabled = true;
        } else {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    }

    // --- Firebase Auth Functions ---

    // Create User Document
    async function createUserDoc(user, additionalData = {}) {
        const userRef = doc(db, 'users', user.uid);
        
        // Generate random color for avatar
        const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#e0af68', '#f7768e', '#73daca', '#ff9e64', '#2ac3de'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        // Get Initials
        let name = additionalData.fullName || user.displayName || 'Anonymous User';
        let initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

        const userData = {
            fullName: name,
            email: user.email,
            avatar: { color: randomColor, initials: initials },
            bio: '',
            githubUrl: '',
            linkedinUrl: '',
            createdAt: serverTimestamp(),
            lastSeen: serverTimestamp(),
            stats: {
                roomsCreated: 0,
                roomsJoined: 0,
                totalSessions: 0,
                linesWritten: 0
            },
            preferences: {
                theme: 'dark',
                fontSize: 14,
                tabSize: 2,
                autoSave: true
            },
            rooms: []
        };

        await setDoc(userRef, userData);
    }

    // Google Sign In
    document.getElementById('btn-google').addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, googleProvider);
            // Check if new user
            const userRef = doc(db, 'users', result.user.uid);
            const docSnap = await getDoc(userRef);
            if (!docSnap.exists()) {
                await createUserDoc(result.user);
            }
            showToast("Successfully signed in!");
            // Redirection handled by onAuthStateChanged
        } catch (error) {
            handleFirebaseError(error, 'social');
        }
    });

    // GitHub Sign In
    document.getElementById('btn-github').addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, githubProvider);
            const userRef = doc(db, 'users', result.user.uid);
            const docSnap = await getDoc(userRef);
            if (!docSnap.exists()) {
                await createUserDoc(result.user);
            }
            showToast("Successfully signed in!");
        } catch (error) {
            handleFirebaseError(error, 'social');
        }
    });

    // Email Sign In
    document.getElementById('signin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('si-email').value;
        const password = document.getElementById('si-password').value;

        if(!email || !password) return;

        setLoading('btn-signin', true);
        try {
            await signInWithEmailAndPassword(auth, email, password);
            showToast("Successfully signed in!");
        } catch (error) {
            handleFirebaseError(error, 'signin');
        } finally {
            setLoading('btn-signin', false);
        }
    });

    // Email Sign Up
    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('su-name').value;
        const email = document.getElementById('su-email').value;
        const password = document.getElementById('su-password').value;
        const confirm = document.getElementById('su-confirm').value;
        const terms = document.getElementById('terms-check').checked;

        let isValid = true;
        if (!name) { showError('su-name', 'Name is required'); isValid = false; }
        if (!email || !/\S+@\S+\.\S+/.test(email)) { showError('su-email', 'Valid email required'); isValid = false; }
        if (password.length < 8) { showError('su-password', 'Password must be at least 8 characters'); isValid = false; }
        if (password !== confirm) { showError('su-confirm', 'Passwords do not match'); isValid = false; }
        if (!terms) { showToast('You must agree to the terms', 'error'); isValid = false; }

        if (!isValid) return;

        setLoading('btn-signup', true);
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await createUserDoc(userCredential.user, { fullName: name });
            showToast("Account created successfully!");
        } catch (error) {
            handleFirebaseError(error, 'signup');
        } finally {
            setLoading('btn-signup', false);
        }
    });

    // Password Reset
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('fp-email').value;
        if(!email) { showError('fp-email', 'Email is required'); return; }

        setLoading('btn-reset', true);
        try {
            await sendPasswordResetEmail(auth, email);
            document.getElementById('reset-success').classList.remove('hidden');
            document.getElementById('btn-reset').style.display = 'none';
        } catch (error) {
            handleFirebaseError(error, 'forgot');
        } finally {
            setLoading('btn-reset', false);
        }
    });

    // --- Typwriter Animation for Mockup ---
    const codeSnippet = [
        "const room = new Room('dev-squad');",
        "room.connect();",
        "",
        "room.onSync((data) => {",
        "  renderEditor(data);",
        "});",
        "",
        "console.log('Real-time sync active ⚡');"
    ];

    const container = document.getElementById('typing-container');
    let lineIdx = 0;
    let charIdx = 0;

    function typeCode() {
        if (lineIdx < codeSnippet.length) {
            let currentLineText = codeSnippet[lineIdx];
            
            // Create line element if start of line
            if (charIdx === 0) {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'code-line';
                lineDiv.id = `line-${lineIdx}`;
                container.appendChild(lineDiv);
            }

            const lineEl = document.getElementById(`line-${lineIdx}`);
            
            if (charIdx < currentLineText.length) {
                // Add char
                let char = currentLineText.charAt(charIdx);
                // Basic syntax highlighting hack for the mockup
                let styledText = currentLineText.substring(0, charIdx + 1)
                    .replace(/(const|new|return)/g, '<span class="code-keyword">$1</span>')
                    .replace(/(Room|renderEditor|console)/g, '<span class="code-function">$1</span>')
                    .replace(/('[^']*')/g, '<span class="code-string">$1</span>');
                
                lineEl.innerHTML = styledText + '<span class="code-cursor"></span>';
                charIdx++;
                setTimeout(typeCode, Math.random() * 50 + 20); // random typing speed
            } else {
                // End of line
                lineEl.innerHTML = lineEl.innerHTML.replace('<span class="code-cursor"></span>', '');
                lineIdx++;
                charIdx = 0;
                setTimeout(typeCode, 300); // pause at end of line
            }
        } else {
            // Loop animation
            setTimeout(() => {
                container.innerHTML = '';
                lineIdx = 0;
                charIdx = 0;
                typeCode();
            }, 5000);
        }
    }
    
    // Start typing animation
    setTimeout(typeCode, 1000);

});
