// src/services/fiscalShareSchedule.ts
//
// Status of each member's fiscal-year share prepayment schedule: 3
// shares (₱3,000) collected in advance by Dec 15 (the start of the
// fiscal year, during the December payout), a 4th by end of January,
// then +1 share/month through all 12 by September.
//
// "Shares paid this fiscal year" is the sum of `monthsPaid` across every
// memberShareReceipts record whose createdAt falls within the current
// fiscal-year window. That sum is CACHED on the user's own doc
// (sharesPaidCache / sharesPaidCacheFiscalYearStartMs, kept up to date by
// collectShare() in adminService.ts every time a share payment is
// recorded) so that ranking N pending loan requests doesn't mean N live
// queries against memberShareReceipts on every admin page load — a real,
// measured cost since this used to run per-request, every load.
//
// The cache is self-healing: if it's missing (a user who paid before
// this was added) or stale (crossed into a new fiscal year since it was
// last written), getSharePrepaymentStatus() transparently falls back to
// the original live query ONCE, then writes the result back onto the
// user doc so every subsequent call — including from a totally different
// admin session — reads it for free until the next payment or rollover.

import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebaseConfig";

const FISCAL_YEAR_START_MONTH = 11; // December (0-indexed)
const FISCAL_YEAR_START_DAY = 15;
const TOTAL_SHARES_PER_YEAR = 12;
const ADVANCE_SHARES_AT_START = 3;

/** The most recent Dec 15 on or before referenceDate. */
export function getFiscalYearStart(referenceDate: Date = new Date()): Date {
  const year = referenceDate.getFullYear();
  const startThisYear = new Date(year, FISCAL_YEAR_START_MONTH, FISCAL_YEAR_START_DAY);
  if (referenceDate >= startThisYear) return startThisYear;
  return new Date(year - 1, FISCAL_YEAR_START_MONTH, FISCAL_YEAR_START_DAY);
}

/** How many of the 12 shares should be paid by now, per the checkpoint schedule. */
export function getExpectedSharesPaid(referenceDate: Date = new Date()): number {
  const start = getFiscalYearStart(referenceDate);
  const monthDiff =
    (referenceDate.getFullYear() - start.getFullYear()) * 12 +
    (referenceDate.getMonth() - start.getMonth());
  return Math.min(TOTAL_SHARES_PER_YEAR, ADVANCE_SHARES_AT_START + Math.max(0, monthDiff));
}

export interface SharePrepaymentStatus {
  fiscalYearStart: Date;
  sharesExpected: number;
  sharesPaid: number;
  behindBy: number;
  isOnTrack: boolean;
}

/**
 * @param preloadedProfile Pass the caller's already-fetched `users/{userId}`
 *   doc data (e.g. the borrowerSnap most callers already read anyway) to
 *   let a cache hit skip fetching it a second time. Omit to have this
 *   function fetch it itself.
 */
export async function getSharePrepaymentStatus(
  userId: string,
  referenceDate: Date = new Date(),
  preloadedProfile?: Record<string, any> | null
): Promise<SharePrepaymentStatus> {
  const fiscalYearStart = getFiscalYearStart(referenceDate);
  const sharesExpected = getExpectedSharesPaid(referenceDate);

  const userRef = doc(db, "users", userId);
  const profile =
    preloadedProfile !== undefined
      ? preloadedProfile
      : (await getDoc(userRef)).data() ?? null;

  const cacheFiscalYearStartMs = profile?.sharesPaidCacheFiscalYearStartMs;
  const cacheIsCurrent = cacheFiscalYearStartMs === fiscalYearStart.getTime();

  let sharesPaid: number;

  if (cacheIsCurrent) {
    // ⚡ Cache hit — zero queries.
    sharesPaid = Number(profile?.sharesPaidCache ?? 0);
  } else {
    // 🐢 Cache miss (never cached, or a new fiscal year has started since
    // it was last written) — fall back to the original live query, then
    // heal the cache so nobody pays this cost again until the next
    // payment or rollover.
    const snap = await getDocs(
      query(collection(db, "memberShareReceipts"), where("memberId", "==", userId))
    );

    sharesPaid = 0;
    snap.docs.forEach((d) => {
      const r = d.data() as any;
      const createdAt = r.createdAt?.toDate ? r.createdAt.toDate() : null;
      if (createdAt && createdAt >= fiscalYearStart) {
        sharesPaid += Number(r.monthsPaid ?? 1);
      }
    });

    updateDoc(userRef, {
      sharesPaidCache: sharesPaid,
      sharesPaidCacheFiscalYearStartMs: fiscalYearStart.getTime(),
    }).catch((err) => console.warn("⚠️ Failed to heal share-prepayment cache for", userId, err));
  }

  const behindBy = Math.max(0, sharesExpected - sharesPaid);

  return {
    fiscalYearStart,
    sharesExpected,
    sharesPaid,
    behindBy,
    isOnTrack: behindBy === 0,
  };
}
