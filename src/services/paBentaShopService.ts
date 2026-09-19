// src/services/paBentaShopService.ts
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export interface PaBentaShop {
  id: string;
  ownerId: string;
  ownerName: string;
  shopName: string;
  shopDescription?: string;
  status: "pending" | "approved" | "rejected" | "suspended";
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