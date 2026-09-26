// src/services/paBentaWishlistService.ts
import { deleteDoc, doc, getDoc, collection, onSnapshot, query, where, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

const WISHLIST_COL = "paBentaWishlist";

function wishlistDocId(userId: string, listingId: string) {
  return `${userId}_${listingId}`;
}

export async function isInWishlist(userId: string, listingId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, WISHLIST_COL, wishlistDocId(userId, listingId)));
  return snap.exists();
}

export async function addToWishlist(userId: string, listingId: string) {
  await setDoc(doc(db, WISHLIST_COL, wishlistDocId(userId, listingId)), {
    userId,
    listingId,
    createdAt: serverTimestamp(),
  });
}

export async function removeFromWishlist(userId: string, listingId: string) {
  await deleteDoc(doc(db, WISHLIST_COL, wishlistDocId(userId, listingId)));
}

/** Returns the NEW saved state (true = now saved, false = now removed) */
/** Pass the CURRENT saved state (from your own tracked wishlist ids) to avoid an extra read.
 *  Returns the NEW saved state (true = now saved, false = now removed) */
export async function toggleWishlist(userId: string, listingId: string, isSaved: boolean): Promise<boolean> {
  if (isSaved) {
    await removeFromWishlist(userId, listingId);
    return false;
  } else {
    await addToWishlist(userId, listingId);
    return true;
  }
}

export function subscribeToMyWishlistIds(userId: string, callback: (listingIds: string[]) => void) {
  const q = query(collection(db, WISHLIST_COL), where("userId", "==", userId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => d.data().listingId as string));
  });
}