/**
 * CodeSync v2.0 - Authentication Logic
 */
import { auth, googleProvider, database, firestore, isDev } from './firebase-config.js';
import { 
    signInWithPopup, 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    sendPasswordResetEmail,
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp as fsServerTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, set, serverTimestamp as rtdbServerTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const appAuth = {
    currentTab: 'signin',

    init: function() {
        // Auth state listener
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // If logged in, go to dashboard
                window.location.href = 'dashboard.html';
            }
        });

        this.startTypingDemo();
    },

    // --- UI Methods ---
    switchTab: function(tab) {
        this.currentTab = tab;
        document.getElementById('tab-signin').classList.toggle('active', tab === 'signin');
        document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
        
        document.getElementById('tab-indicator').style.transform = tab === 'signin' ? 'translateX(0)' : 'translateX(100%)';
        
        document.getElementById('form-signin').style.display = tab === 'signin' ? 'block' : 'none';
        document.getElementById('form-signup').style.display = tab === 'signup' ? 'block' : 'none';
        document.getElementById('form-forgot').style.display = 'none';
    },

    showForgot: function() {
        document.getElementById('form-signin').style.display = 'none';
        document.getElementById('form-signup').style.display = 'none';
        document.getElementById('form-forgot').style.display = 'block';
        document.querySelector('.auth-tabs').style.display = 'none';
    },

    hideForgot: function() {
        this.switchTab('signin');
        document.querySelector('.auth-tabs').style.display = 'flex';
    },

    togglePassword: function(inputId, iconEl) {
        const input = document.getElementById(inputId);
        if(input.type === 'password') {
            input.type = 'text';
            iconEl.classList.remove('fa-eye-slash');
            iconEl.classList.add('fa-eye');
        } else {
            input.type = 'password';
            iconEl.classList.remove('fa-eye');
            iconEl.classList.add('fa-eye-slash');
        }
    },

    checkStrength: function(val) {
        let score = 0;
        if(val.length > 5) score++;
        if(val.length > 8) score++;
        if(/[A-Z]/.test(val) && /[0-9]/.test(val)) score++;
        if(/[^A-Za-z0-9]/.test(val)) score++;

        const colors = ['var(--border-strong)', '#ff4444', '#ffa500', '#00ff88', '#00ff88'];
        const labels = ['Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];

        for(let i=1; i<=4; i++) {
            document.getElementById(`str-${i}`).style.background = (i <= score) ? colors[score] : colors[0];
        }
        document.getElementById('str-label').innerText = labels[score];
        document.getElementById('str-label').style.color = colors[score];
    },

    showToast: function(msg, type="info") {
        const container = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<span>${msg}</span>`;
        container.appendChild(t);
        setTimeout(() => { t.style.opacity=0; setTimeout(()=>t.remove(), 300); }, 3000);
    },

    shake: function() {
        const box = document.querySelector('.auth-form-container');
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 400);
    },

    setLoading: function(btnId, isLoading, originalText) {
        const btn = document.getElementById(btnId);
        if(isLoading) {
            btn.dataset.text = btn.innerHTML;
            btn.innerHTML = '<div class="spinner"></div>';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.text || originalText;
            btn.disabled = false;
        }
    },

    // --- Firebase Auth Methods ---
    googleSignIn: async function() {
        if(isDev) return this.mockAuth();
        this.setLoading('btn-google', true);
        try {
            const result = await signInWithPopup(auth, googleProvider);
            await this.checkAndCreateProfile(result.user);
            this.showSuccess();
        } catch(error) {
            this.handleError(error);
        } finally {
            this.setLoading('btn-google', false, 'Continue with Google');
        }
    },

    emailSignIn: async function() {
        if(isDev) return this.mockAuth();
        const email = document.getElementById('in-email').value;
        const pass = document.getElementById('in-password').value;
        
        this.setLoading('btn-signin', true);
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            this.showSuccess();
        } catch(error) {
            this.handleError(error);
        } finally {
            this.setLoading('btn-signin', false, 'Sign In');
        }
    },

    emailSignUp: async function() {
        if(isDev) return this.mockAuth();
        const name = document.getElementById('up-name').value;
        const email = document.getElementById('up-email').value;
        const pass = document.getElementById('up-password').value;
        const confirm = document.getElementById('up-confirm').value;

        if(pass !== confirm) {
            this.showToast("Passwords do not match", "error");
            this.shake();
            return;
        }

        this.setLoading('btn-signup', true);
        try {
            const result = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(result.user, { displayName: name });
            await this.checkAndCreateProfile(result.user);
            this.showSuccess();
        } catch(error) {
            this.handleError(error);
        } finally {
            this.setLoading('btn-signup', false, 'Create Account');
        }
    },

    resetPassword: async function() {
        if(isDev) return this.showToast("Mock email sent", "success");
        const email = document.getElementById('forgot-email').value;
        this.setLoading('btn-forgot', true);
        try {
            await sendPasswordResetEmail(auth, email);
            this.showToast("Password reset link sent!", "success");
            this.hideForgot();
        } catch(error) {
            this.handleError(error);
        } finally {
            this.setLoading('btn-forgot', false, 'Send Reset Link');
        }
    },

    // --- Helpers ---
    checkAndCreateProfile: async function(user) {
        try {
            // We use both Firestore and RTDB just in case, but rely mostly on Firestore for profiles
            const docRef = doc(firestore, "users", user.uid);
            const docSnap = await getDoc(docRef);
            
            if (!docSnap.exists()) {
                const initials = (user.displayName || user.email || '?').substring(0,2).toUpperCase();
                // Create in Firestore
                await setDoc(docRef, {
                    name: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    initials: initials,
                    createdAt: fsServerTimestamp(),
                    stats: { roomsCreated: 0, roomsJoined: 0, totalSessions: 0, linesWritten: 0 }
                });
                
                // Duplicate minimal info in RTDB for fast real-time access
                await set(ref(database, `users/${user.uid}/profile`), {
                    name: user.displayName || user.email.split('@')[0],
                    initials: initials
                });
            }
        } catch(e) {
            console.error("Error creating user profile", e);
        }
    },

    handleError: function(error) {
        let msg = "An error occurred";
        if(error.code === 'auth/invalid-credential') msg = "Invalid email or password.";
        if(error.code === 'auth/email-already-in-use') msg = "Email already in use.";
        if(error.code === 'auth/weak-password') msg = "Password is too weak.";
        this.showToast(msg, "error");
        this.shake();
    },

    showSuccess: function() {
        document.querySelector('.auth-form-container').classList.add('success-burst');
        // Let listener redirect
    },

    mockAuth: function() {
        this.showToast("Simulation Auth Success", "success");
        this.showSuccess();
        setTimeout(() => window.location.href = 'dashboard.html', 1000);
    },

    // --- Animation ---
    startTypingDemo: function() {
        const el = document.getElementById('typing-demo');
        if(!el) return;
        const code = `import { SyncEngine } from '@codesync/core';\n\nconst session = new SyncEngine({\n  room: 'PROD_DB',\n  latency: 'sub-ms'\n});\n\nsession.on('change', (diff) => {\n  editor.apply(diff);\n  console.log('Synced!');\n});`;
        
        let i = 0;
        el.innerHTML = '';
        const interval = setInterval(() => {
            if (i < code.length) {
                let char = code.charAt(i);
                if(char === '\n') char = '<br>';
                if(char === ' ') char = '&nbsp;';
                
                // Simple pseudo syntax highlight
                if(code.substring(i).startsWith('import')) char = '<span style="color:#c678dd">i</span>';
                if(code.substring(i).startsWith('const')) char = '<span style="color:#c678dd">c</span>';
                if(code.substring(i).startsWith('SyncEngine')) char = '<span style="color:#e5c07b">S</span>';
                
                el.innerHTML += char;
                i++;
            } else {
                clearInterval(interval);
                el.innerHTML += '<span class="cursor-blink"></span>';
                setTimeout(() => this.startTypingDemo(), 5000); // loop
            }
        }, 50);
    }
};

window.appAuth = appAuth;
document.addEventListener('DOMContentLoaded', () => appAuth.init());
