# ⚡ CodeSync — Real-Time Collaborative Code Editor

> A production-grade, serverless collaborative code editor built with Firebase, Monaco Editor, and vanilla JS. Designed for GitHub Pages hosting.

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue?style=for-the-badge)](https://your-username.github.io/codesync)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Firebase](https://img.shields.io/badge/Firebase-10.x-orange?style=for-the-badge)

---

## ✨ Features

- 🔴 **Real-time code sync** — sub-100ms via Firebase Realtime Database
- 🖱️ **Live cursors** — color-coded per collaborator
- 💬 **Built-in chat** — Markdown + code block support, typing indicators
- 🧑‍💻 **Monaco Editor** — full VS Code experience in the browser
- 🔐 **Auth** — Google, GitHub OAuth + Email/Password
- 📸 **Code Snapshots** — save & label versions to Firestore
- 🚀 **Zero backend** — 100% static, Firebase-only
- 📱 **Responsive** — works on all screen sizes

---

## 📁 Project Structure

```
codesync/
├── index.html          # Landing page
├── auth.html           # Sign in / Sign up
├── dashboard.html      # Room management
├── editor.html         # Collaborative editor
├── profile.html        # User profile & preferences
├── guide.html          # Onboarding guide
├── 404.html            # Error page
├── css/
│   ├── global.css      # Design system & shared utilities
│   ├── landing.css
│   ├── auth.css
│   ├── dashboard.css
│   ├── editor.css
│   ├── profile.css
│   └── guide.css
└── js/
    ├── firebase-config.js   # Firebase init & all exports
    ├── auth.js
    ├── dashboard.js
    ├── editor.js
    ├── chat.js
    ├── rooms.js
    ├── profile.js
    ├── guide.js
    └── notifications.js
```

---

## 🔥 Firebase Setup (Required)

### Step 1 — Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **"Add project"** → name it `codesync` → continue
3. Disable Google Analytics (optional) → create project

### Step 2 — Enable Authentication

1. In your project sidebar → **Build → Authentication → Get started**
2. Enable the following providers:
   - ✅ **Email/Password**
   - ✅ **Google**
   - ✅ **GitHub** *(requires GitHub OAuth App — see below)*

#### GitHub OAuth Setup
1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**
2. Set **Homepage URL** to your GitHub Pages URL (e.g., `https://yourusername.github.io/codesync`)
3. Set **Authorization callback URL** to `https://YOUR_PROJECT.firebaseapp.com/__/auth/handler`
4. Copy the **Client ID** and **Client Secret** into Firebase → Auth → GitHub provider settings

### Step 3 — Create Firestore Database

1. Sidebar → **Build → Firestore Database → Create database**
2. Choose **"Start in production mode"** → pick your region → enable
3. Go to **Rules** tab and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /rooms/{roomId} {
      allow read: if request.auth != null &&
        (resource.data.isPublic == true ||
         request.auth.uid in resource.data.collaborators);
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null &&
        request.auth.uid == resource.data.ownerId;
      match /snapshots/{snapshotId} {
        allow read, write: if request.auth != null &&
          (get(/databases/$(database)/documents/rooms/$(roomId)).data.isPublic == true ||
           request.auth.uid in get(/databases/$(database)/documents/rooms/$(roomId)).data.collaborators);
      }
    }
    match /notifications/{userId}/items/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### Step 4 — Create Realtime Database

1. Sidebar → **Build → Realtime Database → Create database**
2. Choose your region → **Start in locked mode** → enable
3. Go to **Rules** tab and paste:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

### Step 5 — Get Your Firebase Config

1. Sidebar → **Project Settings** (gear icon) → **Your apps** → **Add app** → Web (`</>`)
2. Register app (no Firebase Hosting needed)
3. Copy the `firebaseConfig` object

### Step 6 — Paste Config into the Project

Open `js/firebase-config.js` and replace the placeholder `FIREBASE_CONFIG`:

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

> ⚠️ **This is the only file you need to edit before deploying.**

---

## 🚀 Deploy to GitHub Pages

```bash
# 1. Create a new GitHub repo (e.g., "codesync")

# 2. Clone or init git in this folder
git init
git add .
git commit -m "Initial commit"

# 3. Push to GitHub
git remote add origin https://github.com/YOUR_USERNAME/codesync.git
git branch -M main
git push -u origin main

# 4. Enable GitHub Pages
# Go to repo Settings → Pages → Source: main branch → / (root) → Save
```

Your site will be live at: `https://YOUR_USERNAME.github.io/codesync`

### Fix Authorized Domains
After deploying, add your GitHub Pages domain to Firebase:
1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Add: `YOUR_USERNAME.github.io`

---

## 🛠️ Local Development

No build step needed — just serve the files:

```bash
# Using Python (built-in)
python -m http.server 8080

# Using Node.js (npx)
npx serve .

# Using VS Code
# Install "Live Server" extension → Right-click index.html → Open with Live Server
```

> ⚠️ Must run on a local server (not `file://`) for ES Modules to work.

---

## ⌨️ Keyboard Shortcuts (Editor)

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Run Code |
| `Ctrl+S` | Save Snapshot |
| `Ctrl+K` | Toggle Chat |
| `Ctrl+B` | Toggle File Explorer |
| `Ctrl+\`` | Toggle Console |
| `F11` | Fullscreen |
| `Escape` | Close modals |

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| **Auth** | Firebase Authentication |
| **Database** | Firestore (rooms, users, snapshots, notifications) |
| **Real-time sync** | Firebase Realtime Database (code, cursors, chat) |
| **Code Editor** | Monaco Editor (via CDN) |
| **Syntax highlighting** | Prism.js (chat code blocks) |
| **Fonts** | Inter + JetBrains Mono (Google Fonts) |
| **Hosting** | GitHub Pages (static) |
| **Bundler** | None — native ES Modules |

---

## 📄 License

MIT © 2025 — Free to use, modify, and distribute.
