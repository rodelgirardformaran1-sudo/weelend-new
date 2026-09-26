import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

const CONSENT_COLLECTION = "shopConsents";
const CONSENT_VERSION = "v1";

export async function hasAcceptedShopTerms(uid: string): Promise<boolean> {
  const ref = doc(db, CONSENT_COLLECTION, uid);
  const snap = await getDoc(ref);
  return snap.exists() && snap.data()?.accepted === true;
}

export async function acceptShopTerms(uid: string): Promise<void> {
  const ref = doc(db, CONSENT_COLLECTION, uid);
  await setDoc(
    ref,
    {
      accepted: true,
      version: CONSENT_VERSION,
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}