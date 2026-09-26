// src/firebaseConfig.ts

import { initializeApp } from "firebase/app";
import { getFirestore, setLogLevel } from "firebase/firestore";
import { getAuth } from "firebase/auth"; // ⭐ ADD THIS FOR AUTH
import { getStorage } from "firebase/storage";


const firebaseConfig = {
  apiKey: "AIzaSyCo-RPUUtTn8rbCddoHcF-9MN6tzgqtReE",
  authDomain: "weelend-new.firebaseapp.com",
  projectId: "weelend-new",
  storageBucket: "weelend-new.firebasestorage.app",
  messagingSenderId: "77044660975",
  appId: "1:77044660975:web:be75e0a063545368e7791a"
};

export const app = initializeApp(firebaseConfig);

// Firestore
export const db = getFirestore(app);

// Authentication ⭐
export const auth = getAuth(app);

export const storage = getStorage(app);

// Debug logs (optional)
setLogLevel("debug");
// Debug — expose to browser console (not for production)

// --------------------------------------------------------
// 🛠️ DEBUG HELPERS — expose Firebase to the browser console
// ⚠️ Only for development, remove before production
// --------------------------------------------------------

;(window as any).firebaseAuth = auth;
;(window as any).firebaseDB = db;