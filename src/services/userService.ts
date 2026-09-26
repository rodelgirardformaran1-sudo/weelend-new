// src/services/userService.ts

import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../firebaseConfig";
import type {
  UserProfile,
  AddressInfo,
  EmergencyContactInfo,
} from "../type"; // <-- Main Model for Users

// =======================================================
// 🧩 SUPPORTING SHAPES
// =======================================================

/**
 * Everything the signup form collects, besides the auth email/password.
 *
 * NOTE: `homeAddress` and `phoneNumber` are intentionally named to match
 * the legacy `UserProfile` fields (`phoneNumber`, and the *separate*
 * freeform `address` string used by the Edit Profile page). Keeping
 * `homeAddress` as its own field means the structured signup address can
 * never be overwritten by — or overwrite — the Edit Profile textarea's
 * plain-string `address`.
 */
export interface NewUserProfileInput {
  firstName: string;
  middleName?: string;
  lastName: string;
  phoneNumber: string;
  role: string; // "borrower" | "member"
  emergencyContact: EmergencyContactInfo;
  homeAddress: AddressInfo;
}

// =======================================================
// 🟣 CREATE USER PROFILE (FIRESTORE INITIAL RECORD)
// =======================================================
export async function createUserProfile(
  user: User,
  data: NewUserProfileInput & { email: string }
) {
  if (!db) throw new Error("Firestore 'db' instance is not initialized.");

  const userRef = doc(db, "users", user.uid);

  const fullName = [data.firstName, data.middleName, data.lastName]
    .filter((part) => !!part && part.trim().length > 0)
    .join(" ")
    .trim();

  try {
    await setDoc(userRef, {
      uid: user.uid,
      email: data.email,
      firstName: data.firstName,
      middleName: data.middleName || "",
      lastName: data.lastName,
      fullName,
      phoneNumber: data.phoneNumber,
      role: data.role,
      emergencyContact: {
        name: data.emergencyContact.name,
        relationship: data.emergencyContact.relationship,
        phone: data.emergencyContact.phone,
      },
      homeAddress: {
        street: data.homeAddress.street,
        barangay: data.homeAddress.barangay,
        city: data.homeAddress.city,
        province: data.homeAddress.province,
        zip: data.homeAddress.zip,
      },
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
// =======================================================
// 🪪 IDENTITY VERIFICATION GATE
// =======================================================
/**
 * Whether this member's one-time profile-level identity verification
 * has been submitted AND approved by admin. Used to block submitting a
 * coop loan, Easy Installment purchase, or Pa-benta seller application.
 */
export function isIdentityVerified(profile: UserProfile | null | undefined): boolean {
  return profile?.identityVerification?.status === "approved";
}

/** Fetch-and-check convenience wrapper for call sites that don't already have the profile loaded. */
export async function isUserIdentityVerified(uid: string): Promise<boolean> {
  const profile = await getUserProfile(uid);
  return isIdentityVerified(profile);
}

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