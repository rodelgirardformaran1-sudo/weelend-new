// src/services/payoutService.ts
//
// Fiscal year-end payout — the real, one-way release of the Capital Pool
// and Effort Pool to every active member, plus returning each member's
// accumulated Share Balance back to them. Mirrors the exact formulas
// memberDashboard.ts already uses for the live "Running Payout Estimate"
// (same SHARE_VALUE, same active-members-only scope, same weighting by
// monthlyShareCommitment for capital and lenderVolume for effort) so the
// number a member has been watching all year matches what they actually
// get at the party.
//
// What resets to ₱0 on release: capitalPool, effortPool, totalLendableFunds
// and totalShareCapital (coopFinancialSummary/current_state), plus every
// active member's own shareBalance and lenderVolume.
//
// What does NOT reset: trustFundBalance (carries over — see
// trustFundService.ts), monthlyShareCommitment (a member's ongoing pledge
// rate, not their balance), and every other lifetime/analytics counter on
// coopFinancialSummary (totalLoanedAmount, totalInterestCollected, etc.)
// — those are historical stats, not a live balance being distributed.
//
// A permanent snapshot of exactly what was computed and paid is written
// to `payoutHistory` BEFORE anything is reset, so the release is fully
// auditable even after the live numbers go back to 0.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const SHARE_VALUE = 1000;

export interface PayoutMemberBreakdown {
  userId: string;
  fullName: string;
  monthlyShareCommitment: number;
  lenderVolume: number;
  shareBalanceReturned: number;
  capitalShare: number;
  effortShare: number;
  totalPayout: number;
}

export interface PayoutPreview {
  capitalPool: number;
  effortPool: number;
  totalLendableFunds: number;
  totalShareCapital: number;
  totalCommittedShares: number;
  totalVolume: number;
  members: PayoutMemberBreakdown[];
  grandTotal: number;
}

/**
 * Read-only — computes exactly what a release would pay out right now,
 * without writing anything. Safe to call as often as needed to preview.
 */
export async function computeFiscalYearPayoutPreview(): Promise<PayoutPreview> {
  const summarySnap = await getDoc(doc(db, "coopFinancialSummary", "current_state"));
  const summary = summarySnap.data() ?? {};
  const capitalPool = Number(summary.capitalPool ?? 0);
  const effortPool = Number(summary.effortPool ?? 0);
  const totalLendableFunds = Number(summary.totalLendableFunds ?? 0);
  const totalShareCapital = Number(summary.totalShareCapital ?? 0);

  const membersSnap = await getDocs(
    query(collection(db, "users"), where("role", "==", "member"), where("status", "==", "approved"))
  );
  const activeMemberDocs = membersSnap.docs.filter((d) => d.data()?.membershipStatus !== "inactive");

  let totalCommittedShares = 0;
  let totalVolume = 0;
  activeMemberDocs.forEach((d) => {
    totalCommittedShares += Number(d.data()?.monthlyShareCommitment ?? 0) / SHARE_VALUE;
    totalVolume += Number(d.data()?.lenderVolume ?? 0);
  });

  const perShareValue = totalCommittedShares > 0 ? capitalPool / totalCommittedShares : 0;

  const members: PayoutMemberBreakdown[] = activeMemberDocs.map((d) => {
    const data = d.data();
    const monthlyShareCommitment = Number(data?.monthlyShareCommitment ?? 0);
    const lenderVolume = Number(data?.lenderVolume ?? 0);
    const shareBalanceReturned = Number(data?.shareBalance ?? 0);

    const memberShares = monthlyShareCommitment / SHARE_VALUE;
    const capitalShare = perShareValue * memberShares;
    const effortShare = totalVolume > 0 ? effortPool * (lenderVolume / totalVolume) : 0;

    return {
      userId: d.id,
      fullName: data?.fullName || data?.email || "Unnamed Member",
      monthlyShareCommitment,
      lenderVolume,
      shareBalanceReturned,
      capitalShare,
      effortShare,
      totalPayout: shareBalanceReturned + capitalShare + effortShare,
    };
  });

  members.sort((a, b) => b.totalPayout - a.totalPayout);

  const grandTotal = members.reduce((sum, m) => sum + m.totalPayout, 0);

  return { capitalPool, effortPool, totalLendableFunds, totalShareCapital, totalCommittedShares, totalVolume, members, grandTotal };
}

/**
 * THE irreversible part. Snapshots `preview` permanently to
 * `payoutHistory`, then resets every field it distributed back to ₱0.
 * Does NOT touch trustFundBalance. Admin-only (see firestore.rules).
 */
export async function releaseFiscalYearPayout(params: {
  preview: PayoutPreview;
  adminId: string;
  adminName: string;
  fiscalYearLabel: string;
  note?: string;
}): Promise<string> {
  const { preview, adminId, adminName, fiscalYearLabel, note } = params;

  // Firestore batches cap at 500 writes; 1 payoutHistory doc + 1 coop
  // summary update + 1 per member. Guard rather than silently truncating.
  if (preview.members.length > 490) {
    throw new Error(
      `Too many members (${preview.members.length}) for a single batch release. This needs to be split into chunks — contact your developer before proceeding.`
    );
  }

  const batch = writeBatch(db);

  const payoutRef = doc(collection(db, "payoutHistory"));
  batch.set(payoutRef, {
    fiscalYearLabel,
    note: note || null,
    capitalPool: preview.capitalPool,
    effortPool: preview.effortPool,
    totalLendableFunds: preview.totalLendableFunds,
    totalShareCapital: preview.totalShareCapital,
    totalCommittedShares: preview.totalCommittedShares,
    totalVolume: preview.totalVolume,
    grandTotal: preview.grandTotal,
    members: preview.members,
    releasedBy: adminId,
    releasedByName: adminName,
    releasedAt: serverTimestamp(),
  });

  const coopSummaryRef = doc(db, "coopFinancialSummary", "current_state");
  batch.update(coopSummaryRef, {
    capitalPool: 0,
    effortPool: 0,
    totalLendableFunds: 0,
    totalShareCapital: 0,
    lastUpdated: serverTimestamp(),
  });

  preview.members.forEach((m) => {
    const userRef = doc(db, "users", m.userId);
    batch.update(userRef, {
      shareBalance: 0,
      lenderVolume: 0,
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return payoutRef.id;
}

/** Every past payout release, most recent first. Readable by any signed-in user (transparency). */
export async function getPayoutHistory() {
  const snap = await getDocs(collection(db, "payoutHistory"));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as any))
    .sort((a, b) => (b.releasedAt?.toMillis?.() ?? 0) - (a.releasedAt?.toMillis?.() ?? 0));
}
