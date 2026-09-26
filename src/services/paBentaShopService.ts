// src/services/paBentaShopService.ts
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export interface PaBentaShop {
  id: string;
  ownerId: string;
  ownerName: string;
  shopName: string;
  shopDescription?: string;
  status: "pending" | "approved" | "rejected" | "suspended" | "closed";
  rejectionReason?: string;
  isActive: boolean;
  totalListings: number;
  totalViews: number;
  createdAt?: any;
  approvedAt?: any;
}

const SHOPS_COL = "paBentaShops";

/** A member can only ever have ONE shop */
export async function getMyShop(userId: string): Promise<PaBentaShop | null> {
  const q = query(collection(db, SHOPS_COL), where("ownerId", "==", userId));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as any) };
}

export async function createShop(params: {
  ownerId: string;
  ownerName: string;
  shopName: string;
  shopDescription?: string;
}) {
  const existing = await getMyShop(params.ownerId);
  if (existing) throw new Error("You already have a shop.");

  return addDoc(collection(db, SHOPS_COL), {
    ownerId: params.ownerId,
    ownerName: params.ownerName,
    shopName: params.shopName.trim(),
    shopDescription: params.shopDescription?.trim() || "",
    status: "pending" as const,
    isActive: true,
    totalListings: 0,
    totalViews: 0,
    createdAt: serverTimestamp(),
  });
}

export async function getShopById(shopId: string): Promise<PaBentaShop | null> {
  const snap = await getDoc(doc(db, SHOPS_COL, shopId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as any) };
}

export async function updateShop(shopId: string, updates: { shopName: string; shopDescription?: string }) {
  await updateDoc(doc(db, SHOPS_COL, shopId), {
    shopName: updates.shopName.trim(),
    shopDescription: updates.shopDescription?.trim() || "",
  });
}

/** Closes the shop and archives its live listings so both disappear from the public feed. */
export async function closeShop(shopId: string) {
  const listingsQ = query(
    collection(db, "paBentaListings"),
    where("shopId", "==", shopId),
    where("status", "==", "approved")
  );
  const listingsSnap = await getDocs(listingsQ);

  const batch = writeBatch(db);
  listingsSnap.docs.forEach((d) => {
    batch.update(d.ref, { status: "archived" });
  });
  batch.update(doc(db, SHOPS_COL, shopId), { status: "closed" });

  await batch.commit();
}

/** Reopens the shop. Note: previously archived listings stay archived — member re-adds/reactivates products manually. */
export async function reopenShop(shopId: string) {
  await updateDoc(doc(db, SHOPS_COL, shopId), { status: "approved" });
}