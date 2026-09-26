import { app } from "../firebaseConfig";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

import type { User } from "firebase/auth";
import { createUserProfile, type NewUserProfileInput } from "./userService";

// ✅ Auth instance
const auth = getAuth(app);

// ==========================
// REGISTER
// ==========================
export async function register(
  email: string,
  password: string,
  profile: NewUserProfileInput
) {
  console.log("🟡 register() started");

  try { // <-- Add try block here
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );
    const user = credential.user; // Extract user for token refresh

    console.log("🟢 Auth user created:", user.uid);

    // Re-introduce token refresh for immediate Firestore operations
    try {
      await user.getIdToken(true); // Force a refresh
      console.log("🟢 ID token refreshed for user:", user.uid);
    } catch (tokenError) {
      console.error("🔴 Error refreshing ID token after signup:", tokenError);
      // Decide how to handle this - perhaps re-throw or return null
      throw tokenError; // Re-throw to ensure createUserProfile isn't called with potentially stale token
    }

    console.log("🟢 register: Role being passed to createUserProfile is:", profile.role);

    await createUserProfile(user, { // Pass the user object
      ...profile,
      email,
    });

    console.log("🟢 Firestore profile write attempted and completed successfully");

    return user; // Return the user object
  } catch (error: any) { // <-- Catch any errors
    console.error("🔴 register() failed:", error.code, error.message);
    throw error; // Re-throw to be handled by the calling component (e.g., main.ts)
  }
}

// ==========================
// LOGIN
// ==========================
export function login(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

// ==========================
// LOGOUT
// ==========================
export function logout() {
  return signOut(auth);
}

// ==========================
// AUTH STATE LISTENER
// ==========================
export function listenToAuthChanges(
  callback: (user: User | null) => void
) {
  return onAuthStateChanged(auth, callback);
}

// ==========================
// ROLE HELPERS
// ==========================
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

const db = getFirestore(app);

// ==========================
// SECURITY GUARANTOR ACCOUNT CREATION
// ==========================
// A security guarantor is a lightweight, separate kind of account — they
// aren't a coop member or borrower, so they don't go through the normal
// signup form or the pending-approval queue. Their profile is minimal:
// just enough to sign in and complete their own identity verification.
export async function registerSecurityGuarantor(
  email: string,
  password: string,
  fullName: string,
  phoneNumber: string
): Promise<User> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const user = credential.user;

  await user.getIdToken(true);

  await setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    email,
    firstName: fullName,
    middleName: "",
    lastName: "",
    fullName,
    phoneNumber,
    role: "security_guarantor",
    // No coop-membership approval queue for this role — they're not a
    // member/borrower, so they skip straight past the pending-approval gate.
    status: "approved",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return user;
}

/** Fetch current user's profile doc from Firestore */
export async function getCurrentUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;

  const docRef = doc(db, "users", user.uid);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

/** Return user role: admin / member / borrower / null */
export async function getCurrentUserRole(): Promise<string | null> {
  const profile = await getCurrentUserProfile();
  return profile?.role ?? null;
}

/** Quick check for admin usage */
export async function isAdmin(): Promise<boolean> {
  return (await getCurrentUserRole()) === "admin";
}