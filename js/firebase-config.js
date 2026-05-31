import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  GithubAuthProvider, 
  EmailAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  getDatabase, 
  ref, 
  set, 
  onValue, 
  onDisconnect, 
  push, 
  remove, 
  onChildAdded 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDAZ2VaXg4v49ofkod54tulfKL27UgaqSY",
  authDomain: "codesync-11f70.firebaseapp.com",
  databaseURL: "https://codesync-11f70-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "codesync-11f70",
  storageBucket: "codesync-11f70.firebasestorage.app",
  messagingSenderId: "910021589735",
  appId: "1:910021589735:web:05bfbd51bfce2d57320042"
};

/*
🔥 FIRESTORE STRUCTURE:
users/{userId}
  - fullName (string)
  - email (string)
  - avatar { color, initials }
  - bio (string)
  - githubUrl (string)
  - linkedinUrl (string)
  - createdAt (timestamp)
  - lastSeen (timestamp)
  - stats { roomsCreated, roomsJoined, totalSessions, linesWritten }
  - preferences { theme, fontSize, tabSize, autoSave }
  - rooms (array of roomIds)

rooms/{roomId}
  - name (string)
  - description (string)
  - language (string)
  - isPublic (boolean)
  - maxParticipants (number)
  - tags (array of strings)
  - ownerId (string)
  - collaborators (array of userIds)
  - createdAt (timestamp)
  - lastActive (timestamp)

rooms/{roomId}/snapshots/{snapshotId}
  - code (string)
  - language (string)
  - savedBy (string)
  - timestamp (timestamp)
  - label (string)

notifications/{userId}/items/{notificationId}
  - type (string)
  - message (string)
  - timestamp (timestamp)
  - read (boolean)
  - relatedId (string)

🔥 REALTIME DATABASE STRUCTURE:
rooms/{roomId}/code
  - content (string)
  - language (string)
  - updatedBy (string)
  - timestamp (number)

rooms/{roomId}/cursors/{userId}
  - line (number)
  - column (number)
  - color (string)
  - username (string)
  - timestamp (number)

rooms/{roomId}/typing/{userId}
  - isTyping (boolean)
  - timestamp (number)

rooms/{roomId}/chat/{messageId}
  - text (string)
  - userId (string)
  - username (string)
  - color (string)
  - timestamp (number)
  - type (string)

rooms/{roomId}/activeUsers/{userId}
  - online (boolean)
  - timestamp (number)

🔥 SECURITY RULES TEMPLATE:
// FIRESTORE
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /rooms/{roomId} {
      allow read: if request.auth != null && (resource.data.isPublic == true || request.auth.uid in resource.data.collaborators);
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
      
      match /snapshots/{snapshotId} {
        allow read, write: if request.auth != null && (get(/databases/$(database)/documents/rooms/$(roomId)).data.isPublic == true || request.auth.uid in get(/databases/$(database)/documents/rooms/$(roomId)).data.collaborators);
      }
    }
    match /notifications/{userId}/items/{itemId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}

// REALTIME DATABASE
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
*/

let app, auth, db, rtdb;
let googleProvider, githubProvider, emailProvider;

try {
  // Initialize Firebase App
  app = initializeApp(FIREBASE_CONFIG);
  
  // Initialize Services
  auth = getAuth(app);
  db = getFirestore(app);
  rtdb = getDatabase(app);
  
  // Initialize Auth Providers
  googleProvider = new GoogleAuthProvider();
  githubProvider = new GithubAuthProvider();
  emailProvider = new EmailAuthProvider();
  
  console.log("🔥 Firebase initialized successfully");
} catch (error) {
  console.error("❌ Firebase initialization failed:", error);
}

export { 
  app, 
  auth, 
  db, 
  rtdb, 
  googleProvider, 
  githubProvider, 
  emailProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  deleteDoc,
  serverTimestamp,
  ref, 
  set, 
  onValue, 
  onDisconnect, 
  push, 
  remove, 
  onChildAdded
};
