import { auth, db, doc, getDoc, setDoc, onAuthStateChanged } from './firebase-config.js';

let currentUser = null;
let currentStep = 1;
const totalSteps = 4;
let photoBase64 = null;

// DOM Elements
const stepCards = document.querySelectorAll('.step-card');
const progressBar = document.getElementById('progress-bar');
const stepTitle = document.getElementById('step-title');
const stepSubtitle = document.getElementById('step-subtitle');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const setupFooter = document.getElementById('setup-footer');

const titles = {
    1: { title: "Welcome to CodeSync!", sub: "Let's get your profile set up so you can start collaborating." },
    2: { title: "Tell us about yourself", sub: "Add a bio and link your social profiles." },
    3: { title: "Set your preferences", sub: "Customize your editor experience." },
    4: { title: "You're all set!", sub: "Your profile is ready. Let's start coding together." }
};

// --- AUTH CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        // Pre-fill name if available
        const nameInput = document.getElementById('display-name');
        if (!nameInput.value) nameInput.value = user.displayName || user.email.split('@')[0];
        
        // Fetch existing data if any
        try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists()) {
                const data = userDoc.data();
                if (data.onboardingComplete) {
                    window.location.href = 'dashboard.html'; // Already done
                }
                if (data.photoURL) {
                    photoBase64 = data.photoURL;
                    document.getElementById('avatar-img').src = data.photoURL;
                    document.getElementById('avatar-img').classList.remove('hidden');
                    document.getElementById('avatar-placeholder').classList.add('hidden');
                }
            }
        } catch(e) { console.error("Error fetching user data", e); }
    } else {
        window.location.href = 'auth.html';
    }
});

// --- NAVIGATION LOGIC ---
function updateUI() {
    // Update progress bar
    progressBar.style.width = `${(currentStep / totalSteps) * 100}%`;
    
    // Update text
    stepTitle.innerText = titles[currentStep].title;
    stepSubtitle.innerText = titles[currentStep].sub;
    
    // Update cards
    stepCards.forEach(card => {
        const stepNum = parseInt(card.dataset.step);
        card.classList.remove('active', 'previous');
        if (stepNum === currentStep) {
            card.classList.add('active');
        } else if (stepNum < currentStep) {
            card.classList.add('previous');
        }
    });
    
    // Update buttons
    if (currentStep === 1) {
        btnPrev.style.visibility = 'hidden';
        btnNext.innerText = 'Continue';
        btnNext.style.display = 'block';
    } else if (currentStep === totalSteps) {
        setupFooter.style.display = 'none'; // Hide footer on last step
        fireConfetti();
        setTimeout(() => {
            window.location.href = 'dashboard.html';
        }, 3500);
    } else {
        btnPrev.style.visibility = 'visible';
        btnNext.innerText = currentStep === totalSteps - 1 ? 'Complete Setup' : 'Continue';
        btnNext.style.display = 'block';
    }
}

btnNext.addEventListener('click', async () => {
    // Validate current step before proceeding
    if (currentStep === 1) {
        const nameInput = document.getElementById('display-name');
        if (nameInput.value.trim().length < 2) {
            nameInput.style.border = '2px solid var(--error-color)';
            nameInput.focus();
            setTimeout(() => nameInput.style.border = '', 2000);
            return;
        }
    }
    
    if (currentStep === totalSteps - 1) {
        // Save everything to Firestore before showing final step
        btnNext.classList.add('loading');
        btnNext.disabled = true;
        try {
            await saveProfileData();
            // Only proceed if save succeeded
            btnNext.classList.remove('loading');
            btnNext.disabled = false;
            currentStep++;
            updateUI();
        } catch (e) {
            // Error already shown inside saveProfileData()
            btnNext.disabled = false;
        }
        return; // Early return — updateUI called inside try block
    }
    
    if (currentStep < totalSteps) {
        currentStep++;
        updateUI();
    }
});

btnPrev.addEventListener('click', () => {
    if (currentStep > 1) {
        currentStep--;
        updateUI();
    }
});

// --- AVATAR UPLOAD ---
const avatarPreview = document.getElementById('avatar-preview');
const avatarInput = document.getElementById('avatar-input');
const avatarImg = document.getElementById('avatar-img');
const avatarPlaceholder = document.getElementById('avatar-placeholder');

avatarPreview.addEventListener('click', () => avatarInput.click());

avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        alert("File too large. Maximum size is 5MB.");
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
        // Compress image using canvas
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 256;
            const MAX_HEIGHT = 256;
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            photoBase64 = canvas.toDataURL('image/jpeg', 0.8);
            
            avatarImg.src = photoBase64;
            avatarImg.classList.remove('hidden');
            avatarPlaceholder.classList.add('hidden');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// --- THEME SELECTOR ---
const themeOptions = document.querySelectorAll('.theme-option');
let selectedTheme = 'vs-dark';

themeOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        themeOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedTheme = opt.dataset.theme;
    });
});

// --- SAVE TO FIRESTORE ---
async function saveProfileData() {
    if (!currentUser) return;
    
    // Use nested object — setDoc(merge) does NOT support dot-notation keys
    const updates = {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: document.getElementById('display-name').value.trim(),
        bio: document.getElementById('bio-input').value.trim(),
        githubUrl: document.getElementById('github-input').value.trim(),
        linkedinUrl: document.getElementById('linkedin-input').value.trim(),
        preferences: {
            theme: selectedTheme,
            fontSize: parseInt(document.getElementById('font-size').value),
            minimap: document.getElementById('pref-minimap').checked,
            wordWrap: true
        },
        onboardingComplete: true,
        stats: {
            totalCodingMinutes: 0,
            linesWritten: 0,
            streakDays: 0,
            lastSessionDate: null
        }
    };
    
    if (photoBase64) {
        updates.photoURL = photoBase64;
    }
    
    try {
        // setDoc with merge:true = create if not exists, update if exists
        await setDoc(doc(db, 'users', currentUser.uid), updates, { merge: true });
        console.log('✅ Profile saved successfully');
    } catch (e) {
        console.error("Failed to save profile:", e);
        // Show error inline instead of blocking alert
        const btn = document.getElementById('btn-next');
        btn.classList.remove('loading');
        btn.style.border = '2px solid var(--error-color)';
        btn.innerText = '❌ Save Failed — Retry';
        setTimeout(() => {
            btn.style.border = '';
            btn.innerText = 'Complete Setup';
        }, 3000);
        throw e; // Re-throw so the caller knows it failed
    }
}

// --- CONFETTI ANIMATION ---
function fireConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const colors = ['#f97316', '#4ade80', '#f59e0b', '#3b82f6', '#ec4899'];
    
    for (let i = 0; i < 150; i++) {
        particles.push({
            x: canvas.width / 2,
            y: canvas.height / 2 + 100,
            r: Math.random() * 6 + 2,
            dx: Math.random() * 20 - 10,
            dy: Math.random() * -15 - 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.floor(Math.random() * 10) - 10,
            tiltAngleInc: (Math.random() * 0.07) + 0.05,
            tiltAngle: 0
        });
    }
    
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        
        particles.forEach(p => {
            p.tiltAngle += p.tiltAngleInc;
            p.y += (Math.cos(p.tiltAngle) + 1 + p.r / 2) / 2;
            p.x += Math.sin(p.tiltAngle) * 2 + p.dx;
            p.dy += 0.1; // gravity
            p.y += p.dy;
            
            if (p.y <= canvas.height) active = true;
            
            ctx.beginPath();
            ctx.lineWidth = p.r;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
            ctx.stroke();
        });
        
        if (active) requestAnimationFrame(draw);
    }
    draw();
}

// Init
updateUI();
