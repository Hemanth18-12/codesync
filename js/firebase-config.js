/**
 * CodeSync v2.0 - Firebase Configuration
 * 
 * Modular SDK implementation (v10.x).
 * Make sure to replace placeholders below before deploying.
 */

// ==========================================
// FIREBASE CONFIGURATION PLACEHOLDERS
// ==========================================
const FIREBASE_CONFIG = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

/**
 * ==========================================
 * DATABASE STRUCTURE REFERENCE
 * ==========================================
 * 
 * Realtime Database:
 * -----------------
 * rooms/{roomId}/
 *   info: { name: string, language: string, createdBy: string, createdAt: number, isPublic: boolean }
 *   code: { content: string, lastUpdatedBy: string, timestamp: number }
 *   users/{userId}: { name: string, color: string, joinedAt: number }
 *   chat/{messageId}: { text: string, sender: string, uid: string, timestamp: number }
 * 
 * Firestore (or Realtime Database, depending on preference. Here we'll use RTDB for everything for consistency):
 * -----------------
 * users/{userId}/
 *   profile: { name: string, email: string, avatar: string, createdAt: number }
 *   stats: { roomsCreated: number, roomsJoined: number, totalSessions: number, linesWritten: number }
 *   rooms/
 *     created/{roomId}: boolean
 *     joined/{roomId}: boolean
 * 
 * ==========================================
 * SECURITY RULES TEMPLATE
 * ==========================================
 * 
 * {
 *   "rules": {
 *     "users": {
 *       "$uid": {
 *         ".read": "$uid === auth.uid",
 *         ".write": "$uid === auth.uid"
 *       }
 *     },
 *     "rooms": {
 *       "$roomId": {
 *         // Anyone authenticated can read/write to a room for now
 *         ".read": "auth != null",
 *         ".write": "auth != null"
 *       }
 *     }
 *   }
 * }
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let app, auth, database, firestore, googleProvider;
let isDev = false;

try {
    // Check if running without real config (Dev mode)
    if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
        console.warn("⚠️ CodeSync: Firebase credentials missing. Running in Simulation/Dev Mode.");
        isDev = true;
    } else {
        // Initialize Firebase
        app = initializeApp(FIREBASE_CONFIG);
        auth = getAuth(app);
        database = getDatabase(app);
        firestore = getFirestore(app);
        googleProvider = new GoogleAuthProvider();
        
        console.log("✅ CodeSync: Firebase successfully initialized.");
    }
} catch (error) {
    console.error("❌ CodeSync: Error initializing Firebase:", error);
}

// Export the initialized services
export { app, auth, database, firestore, googleProvider, isDev };
