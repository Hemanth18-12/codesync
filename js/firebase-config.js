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
  signOut,
  updateProfile,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  addDoc,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { 
  getDatabase, 
  ref, 
  set, 
  get,
  onValue, 
  onDisconnect, 
  push, 
  remove, 
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  update as rtdbUpdate
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Firebase configuration specific to the user's project
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDAZ2VaXg4v49ofkod54tulfKL27UgaqSY",
  authDomain: "codesync-11f70.firebaseapp.com",
  databaseURL: "https://codesync-11f70-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "codesync-11f70",
  storageBucket: "codesync-11f70.firebasestorage.app",
  messagingSenderId: "910021589735",
  appId: "1:910021589735:web:05bfbd51bfce2d57320042"
};

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
  updateProfile,
  updatePassword,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  addDoc,
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  ref, 
  set, 
  get,
  onValue, 
  onDisconnect, 
  push, 
  remove, 
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  rtdbUpdate
};
