import { 
    auth, 
    db, 
    googleProvider, 
    githubProvider, 
    signInWithPopup, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    sendPasswordResetEmail,
    doc, 
    getDoc, 
    setDoc,
    serverTimestamp,
    onAuthStateChanged
} from './firebase-config.js';

// --- UI ELEMENTS ---
const tabs = document.querySelectorAll('.tab-btn');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const resetForm = document.getElementById('reset-form');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const oauthButtons = document.querySelector('.oauth-buttons');
const divider = document.querySelector('.divider');
const forgotPwdLink = document.getElementById('forgot-pwd-link');
const backToLoginLink = document.getElementById('back-to-login');

// Inputs
const loginEmail = document.getElementById('login-email');
const loginPwd = document.getElementById('login-pwd');
const signupName = document.getElementById('signup-name');
const signupEmail = document.getElementById('signup-email');
const signupPwd = document.getElementById('signup-pwd');

// Buttons
const btnLogin = document.getElementById('btn-login-submit');
const btnSignup = document.getElementById('btn-signup-submit');
const btnReset = document.getElementById('btn-reset-submit');
const btnGoogle = document.getElementById('btn-google');
const btnGithub = document.getElementById('btn-github');

// Toast System
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : '⚠️';
    toast.innerHTML = `<span style="font-weight:bold;font-size:1.2rem">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 4000);
}

// Check Auth State on Load
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Check if onboarding is complete
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().onboardingComplete) {
                window.location.href = 'dashboard.html';
            } else {
                window.location.href = 'profile-setup.html';
            }
        } catch (e) {
            window.location.href = 'dashboard.html';
        }
    }
});

// --- TAB SWITCHING ---
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        const target = tab.dataset.tab;
        
        // Reset forms
        loginForm.classList.add('hidden');
        signupForm.classList.add('hidden');
        resetForm.classList.add('hidden');
        
        oauthButtons.style.display = 'flex';
        divider.style.display = 'flex';
        
        if (target === 'login') {
            authTitle.innerText = 'Welcome Back';
            authSubtitle.innerText = 'Log in to sync your code and collaborate.';
            loginForm.classList.remove('hidden');
        } else {
            authTitle.innerText = 'Create an Account';
            authSubtitle.innerText = 'Join thousands of developers coding together.';
            signupForm.classList.remove('hidden');
        }
    });
});

forgotPwdLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    oauthButtons.style.display = 'none';
    divider.style.display = 'none';
    tabs.forEach(t => t.style.display = 'none');
    
    authTitle.innerText = 'Reset Password';
    authSubtitle.innerText = 'Don\'t worry, it happens to the best of us.';
    resetForm.classList.remove('hidden');
});

backToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    resetForm.classList.add('hidden');
    oauthButtons.style.display = 'flex';
    divider.style.display = 'flex';
    tabs.forEach(t => {
        t.style.display = 'block';
        if(t.dataset.tab === 'login') t.classList.add('active');
        else t.classList.remove('active');
    });
    
    authTitle.innerText = 'Welcome Back';
    authSubtitle.innerText = 'Log in to sync your code and collaborate.';
    loginForm.classList.remove('hidden');
});


// --- INPUT VALIDATION ---
function validateInput(input, errDiv, condition, errMsg) {
    if (input.value.length === 0) {
        input.classList.remove('invalid', 'valid');
        errDiv.style.display = 'none';
        return false;
    }
    if (condition) {
        input.classList.remove('invalid');
        input.classList.add('valid');
        errDiv.style.display = 'none';
        return true;
    } else {
        input.classList.remove('valid');
        input.classList.add('invalid');
        errDiv.innerText = errMsg;
        errDiv.style.display = 'block';
        return false;
    }
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

loginEmail.addEventListener('input', () => validateInput(loginEmail, document.getElementById('login-email-err'), emailRegex.test(loginEmail.value), 'Invalid email format'));
signupEmail.addEventListener('input', () => validateInput(signupEmail, document.getElementById('signup-email-err'), emailRegex.test(signupEmail.value), 'Invalid email format'));
signupName.addEventListener('input', () => validateInput(signupName, document.getElementById('signup-name-err'), signupName.value.trim().length >= 2, 'Name must be at least 2 characters'));

// Password Strength
const pwdStrengthDiv = document.getElementById('pwd-strength');
const strengthText = document.getElementById('strength-text');

signupPwd.addEventListener('input', (e) => {
    const pwd = e.target.value;
    pwdStrengthDiv.style.display = pwd.length > 0 ? 'block' : 'none';
    
    let strength = 0;
    if (pwd.length >= 8) strength += 1;
    if (pwd.match(/[A-Z]/)) strength += 1;
    if (pwd.match(/[0-9]/)) strength += 1;
    if (pwd.match(/[^a-zA-Z0-9]/)) strength += 1;
    
    pwdStrengthDiv.className = 'password-strength'; // reset
    if (pwd.length < 8) {
        pwdStrengthDiv.classList.add('strength-weak');
        strengthText.innerText = 'Weak (min 8 chars)';
        validateInput(signupPwd, document.getElementById('signup-pwd-err'), false, 'Password too short');
    } else if (strength === 1 || strength === 2) {
        pwdStrengthDiv.classList.add('strength-fair');
        strengthText.innerText = 'Fair';
        validateInput(signupPwd, document.getElementById('signup-pwd-err'), true, '');
    } else if (strength === 3) {
        pwdStrengthDiv.classList.add('strength-good');
        strengthText.innerText = 'Good';
        validateInput(signupPwd, document.getElementById('signup-pwd-err'), true, '');
    } else if (strength === 4) {
        pwdStrengthDiv.classList.add('strength-strong');
        strengthText.innerText = 'Strong';
        validateInput(signupPwd, document.getElementById('signup-pwd-err'), true, '');
    }
});

// --- AUTH LOGIC ---
function setLoading(btn, isLoading) {
    if (isLoading) {
        btn.classList.add('loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

// Standardized User Doc Creation
async function ensureUserDocument(user, name = null) {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
        await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: name || user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL || null,
            createdAt: serverTimestamp(),
            lastActive: serverTimestamp(),
            onboardingComplete: false,
            stats: {
                totalCodingMinutes: 0,
                linesWritten: 0,
                streakDays: 0,
                lastSessionDate: null
            },
            preferences: {
                theme: 'vs-dark',
                fontSize: 14,
                wordWrap: true,
                minimap: true
            }
        });
        return false; // Onboarding not complete
    }
    return snap.data().onboardingComplete;
}

// OAuth Handlers
async function handleOAuth(provider) {
    try {
        const result = await signInWithPopup(auth, provider);
        const isComplete = await ensureUserDocument(result.user);
        
        if (isComplete) window.location.href = 'dashboard.html';
        else window.location.href = 'profile-setup.html';
        
    } catch (error) {
        console.error("OAuth Error:", error);
        showToast(error.message, 'error');
    }
}

btnGoogle.addEventListener('click', () => handleOAuth(googleProvider));
btnGithub.addEventListener('click', () => handleOAuth(githubProvider));

// Email/Password Signup
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!emailRegex.test(signupEmail.value) || signupPwd.value.length < 8 || signupName.value.trim().length < 2) {
        showToast('Please fix the errors in the form.', 'error');
        return;
    }
    
    setLoading(btnSignup, true);
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, signupEmail.value, signupPwd.value);
        await ensureUserDocument(userCredential.user, signupName.value.trim());
        // Automatically redirects due to onAuthStateChanged
    } catch (error) {
        setLoading(btnSignup, false);
        if (error.code === 'auth/email-already-in-use') showToast('Email already in use. Please log in.', 'error');
        else showToast(error.message, 'error');
    }
});

// Email/Password Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setLoading(btnLogin, true);
    try {
        await signInWithEmailAndPassword(auth, loginEmail.value, loginPwd.value);
        // Automatically redirects due to onAuthStateChanged
    } catch (error) {
        setLoading(btnLogin, false);
        if (error.code === 'auth/invalid-credential') showToast('Invalid email or password.', 'error');
        else showToast(error.message, 'error');
    }
});

// Password Reset
resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reset-email').value;
    setLoading(btnReset, true);
    try {
        await sendPasswordResetEmail(auth, email);
        setLoading(btnReset, false);
        showToast('Password reset link sent! Check your inbox.', 'success');
        setTimeout(() => backToLoginLink.click(), 3000);
    } catch (error) {
        setLoading(btnReset, false);
        showToast(error.message, 'error');
    }
});

// --- TYPING ANIMATION (Right Panel) ---
const mockupBody = document.getElementById('auth-typing');
const codeLines = [
    '<span style="color:var(--text-muted)">// Authenticate user securely</span>',
    '<span style="color:var(--primary-color)">import</span> { auth, db } <span style="color:var(--primary-color)">from</span> <span style="color:var(--success-color)">"codesync/core"</span>;',
    '',
    '<span style="color:var(--primary-color)">const</span> user = <span style="color:var(--primary-color)">await</span> auth.<span style="color:var(--secondary-color)">signIn</span>();',
    '<span style="color:var(--primary-color)">if</span> (user.isAuthenticated) {',
    '  <span style="color:var(--text-muted)">// Connect to Realtime Collab Engine</span>',
    '  <span style="color:var(--primary-color)">const</span> workspace = <span style="color:var(--primary-color)">new</span> <span style="color:var(--secondary-color)">Workspace</span>(user.uid);',
    '  <span style="color:var(--primary-color)">await</span> workspace.<span style="color:var(--secondary-color)">connect</span>();',
    '  ',
    '  console.<span style="color:var(--secondary-color)">log</span>(<span style="color:var(--success-color)">"Sync initialized!"</span>);',
    '}'
];

let lineIdx = 0;
function typeAuthCode() {
    if(!mockupBody) return;
    if (lineIdx >= codeLines.length) {
        setTimeout(() => {
            mockupBody.innerHTML = '';
            lineIdx = 0;
            typeAuthCode();
        }, 5000);
        return;
    }
    
    mockupBody.innerHTML += codeLines[lineIdx] + '<br>';
    lineIdx++;
    setTimeout(typeAuthCode, Math.random() * 400 + 100);
}

if(mockupBody) setTimeout(typeAuthCode, 1000);
