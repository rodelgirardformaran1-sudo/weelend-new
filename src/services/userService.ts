// src/services/userService.ts

import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../firebaseConfig";
import type { UserProfile } from "../type"; // <-- Main Model for Users

// =======================================================
// 🟣 CREATE USER PROFILE (FIRESTORE INITIAL RECORD)
// =======================================================
export async function createUserProfile(
  user: User,
  data: {
    firstName: string;
    lastName: string;
    email: string;
    role: string; // "admin" | "borrower" | "member"
  }
) {
  if (!db) throw new Error("Firestore 'db' instance is not initialized.");

  const userRef = doc(db, "users", user.uid);

  try {
    await setDoc(userRef, {
      uid: user.uid,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: `${data.firstName} ${data.lastName}`.trim(),
      role: data.role,
      status: "pending",            // 👈 default user status
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log("🟣 User profile created:", user.uid);
  } catch (error: any) {
    console.error("🔴 Firestore profile creation failed:", error);
    throw error;
  }
}

// =======================================================
// 📌 GET FULL USER PROFILE OBJECT
// =======================================================
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (error) {
    console.error("❌ getUserProfile Error:", error);
    return null;
  }
}

// =======================================================
// 🧍 GET USER FULL NAME (SAFE FOR DASHBOARDS & UI)
// =======================================================
export async function getUserFullName(uid: string): Promise<string> {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) return "Unknown User";

    const data = snap.data();
    
    return (
      data.fullName ||
      `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() ||
      data.email ||
      "Unnamed User"
    );
  } catch (error) {
    console.error("❌ getUserFullName error:", error);
    return "Unknown User";
  }
}
