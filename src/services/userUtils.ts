// src/services/userUtils.ts
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

export async function getUserFullName(uid: string | null | undefined): Promise<string> {
  try {
    if (!uid) return "N/A (no UID)";

    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return `Unknown User (${uid})`;

    const u = snap.data();

    // 🔥 Priority fallback logic
    const fullName =
      u.fullName?.trim() ||
      `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() ||
      uid;

    return fullName;
  } catch (err) {
    console.error("getUserFullName Error:", err);
    return `Error (${uid})`;
  }
}
