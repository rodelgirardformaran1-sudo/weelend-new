// src/services/paBentaListingService.ts
import {
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebaseConfig";

export type ListingCategory = "food" | "apparel" | "home" | "electronics" | "services" | "other";
export type ListingCondition = "brand_new" | "like_new" | "used";
export type StockStatus = "in_stock" | "low_stock" | "out_of_stock" | "made_to_order";
export type ContactMethod = "call" | "sms" | "whatsapp" | "viber" | "messenger";

export interface PaBentaListing {
  id: string;
  shopId: string;
  ownerId: string;
  productName: string;
  description?: string;
  imageUrls: string[];
  price: number;
  category: ListingCategory;
  condition: ListingCondition;
  stockStatus: StockStatus;
  location?: string;
  contactNumber: string;
  preferredContactMethod: ContactMethod;
  socialLinks?: {
    facebook?: string;
    messenger?: string;
    instagram?: string;
    tiktok?: string;
  };
  status: "pending" | "approved" | "rejected" | "archived";
  rejectionReason?: string;
  viewCount: number;
  reportCount: number;
  createdAt?: any;
  lastRefreshedAt?: any;
}

const LISTINGS_COL = "paBentaListings";
const SHOPS_COL = "paBentaShops";

export async function uploadListingImage(file: File, shopId: string): Promise<string> {
  const path = `paBentaListings/${shopId}/${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

export async function createListing(params: {
  shopId: string;
  ownerId: string;
  productName: string;
  description?: string;
  imageUrls: string[];
  price: number;
  category: ListingCategory;
  condition: ListingCondition;
  stockStatus: StockStatus;
  location?: string;
  contactNumber: string;
  preferredContactMethod: ContactMethod;
  socialLinks?: PaBentaListing["socialLinks"];
}) {
  await runTransaction(db, async (tx) => {
    const shopRef = doc(db, SHOPS_COL, params.shopId);
    const shopSnap = await tx.get(shopRef);
    if (!shopSnap.exists()) throw new Error("Shop not found.");
    if (shopSnap.data().status !== "approved") throw new Error("Your shop must be approved before adding products.");

    const listingRef = doc(collection(db, LISTINGS_COL));

    tx.set(listingRef, {
      shopId: params.shopId,
      ownerId: params.ownerId,
      productName: params.productName.trim(),
      description: params.description?.trim() || "",
      imageUrls: params.imageUrls,
      price: params.price,
      category: params.category,
      condition: params.condition,
      stockStatus: params.stockStatus,
      location: params.location?.trim() || "",
      contactNumber: params.contactNumber.trim(),
      preferredContactMethod: params.preferredContactMethod,
      socialLinks: params.socialLinks || {},
      status: "pending" as const,
      viewCount: 0,
      reportCount: 0,
      createdAt: serverTimestamp(),
      lastRefreshedAt: serverTimestamp(),
    });

    tx.update(shopRef, {
      totalListings: increment(1),
    });
  });
}

export async function getMyListings(shopId: string): Promise<PaBentaListing[]> {
  const q = query(collection(db, LISTINGS_COL), where("shopId", "==", shopId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}