// src/services/paBentaFeedService.ts
import { collection, doc, getDocs, onSnapshot, orderBy, query, updateDoc, increment, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import type { PaBentaListing } from "./paBentaListingService";

const LISTINGS_COL = "paBentaListings";
const SHOPS_COL = "paBentaShops";

export type FeedListing = PaBentaListing & { shopName: string };

/**
 * Live feed of all approved listings, with shop names attached.
 * Category + search filtering happens client-side (see feed.ts).
 */
export function subscribeToApprovedFeed(callback: (listings: FeedListing[]) => void) {
  const q = query(collection(db, LISTINGS_COL), where("status", "==", "approved"), orderBy("createdAt", "desc"));

  return onSnapshot(q, async (snap) => {
    const rawListings = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PaBentaListing[];

    // Look up shop names for the unique shopIds present
    const uniqueShopIds = [...new Set(rawListings.map((l) => l.shopId))];
    const shopNameMap: Record<string, string> = {};

    await Promise.all(
      uniqueShopIds.map(async (shopId) => {
        const shopDocs = await getDocs(query(collection(db, SHOPS_COL), where("__name__", "==", shopId)));
        shopDocs.forEach((d) => {
          shopNameMap[shopId] = (d.data() as any).shopName || "Shop";
        });
      })
    );

    const enriched: FeedListing[] = rawListings.map((l) => ({
      ...l,
      shopName: shopNameMap[l.shopId] || "Shop",
    }));

    callback(enriched);
  });
}

export async function incrementListingView(listingId: string) {
  await updateDoc(doc(db, LISTINGS_COL, listingId), {
    viewCount: increment(1),
  });
}