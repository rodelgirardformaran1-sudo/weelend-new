// src/services/affiliateService.ts
//
// Affiliate / referral commission program — MLF Easy Installment ONLY.
// Not used by Marimar's Credit Cart or Pa-benta.
//
// Economics (confirmed):
//   - Total commission = 10% of the installment's interest amount.
//   - First half  → released automatically once the admin confirms the
//                    downpayment and approves the PaSwipe request.
//   - Second half → accrues pro-rata as the buyer pays off the remaining
//                    balance (principal-equivalent + interest). If the
//                    buyer settles early in a lump sum, whatever remains
//                    of the second half releases immediately.
//   - No clawback on the first half if the buyer later defaults.
//   - No self-referral (enforced where the request is created).
//   - "Released"/"accrued" = affiliate is entitled to it. A separate
//     payout step (affiliatePayouts) records when cash actually changes
//     hands, so accrued vs. paid-out stays distinct for bookkeeping.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  Transaction,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export const AFFILIATE_COMMISSION_RATE = 0.10; // 10% of interest amount
export const AFFILIATE_ELIGIBLE_ROLES = ["member", "borrower"] as const;

export type AffiliateStatus = "none" | "pending" | "approved" | "rejected";

export type ReferralCommission = {
  rate: number; // e.g. 0.10
  totalCommission: number;
  firstHalfAmount: number;
  firstHalfReleasedAt: any; // Firestore Timestamp | null
  secondHalfAmount: number;
  secondHalfReleased: number; // cumulative amount accrued so far
  secondHalfFullyReleasedAt: any; // Timestamp | null, set once secondHalfReleased >= secondHalfAmount
};

// =====================================================================
// 💰 Commission math (pure, no I/O)
// =====================================================================

export function computeReferralCommission(interestAmount: number): {
  rate: number;
  totalCommission: number;
  firstHalfAmount: number;
  secondHalfAmount: number;
} {
  const interest = Number(interestAmount || 0);
  const totalCommission = Math.round(interest * AFFILIATE_COMMISSION_RATE * 100) / 100;
  const firstHalfAmount = Math.round((totalCommission / 2) * 100) / 100;
  const secondHalfAmount = Math.round((totalCommission - firstHalfAmount) * 100) / 100;

  return {
    rate: AFFILIATE_COMMISSION_RATE,
    totalCommission,
    firstHalfAmount,
    secondHalfAmount,
  };
}

/**
 * How much of the second-half commission should be accrued RIGHT NOW,
 * given how much of the installment's remaining balance has been paid
 * cumulatively (principal-equivalent + interest, excludes late fees).
 *
 * Returns the DELTA to release this payment (not the running total).
 * Capped so rounding never releases more than secondHalfAmount overall.
 */
export function computeSecondHalfAccrualDelta(params: {
  secondHalfAmount: number;
  secondHalfReleasedSoFar: number;
  cumulativePaid: number; // total amountPaid across the installment's schedule, so far
  remainingBalance: number; // installment.remainingBalance (the base the interest ratio is drawn from)
}): number {
  const { secondHalfAmount, secondHalfReleasedSoFar, cumulativePaid, remainingBalance } = params;

  if (remainingBalance <= 0 || secondHalfAmount <= 0) return 0;

  const ratio = Math.min(Math.max(cumulativePaid / remainingBalance, 0), 1);
  const entitlement = Math.round(ratio * secondHalfAmount * 100) / 100;
  const capped = Math.min(entitlement, secondHalfAmount);
  const delta = Math.round((capped - secondHalfReleasedSoFar) * 100) / 100;

  return delta > 0 ? delta : 0;
}

export function buildInitialReferralCommission(interestAmount: number): ReferralCommission {
  const { rate, totalCommission, firstHalfAmount, secondHalfAmount } =
    computeReferralCommission(interestAmount);

  return {
    rate,
    totalCommission,
    firstHalfAmount,
    firstHalfReleasedAt: null,
    secondHalfAmount,
    secondHalfReleased: 0,
    secondHalfFullyReleasedAt: null,
  };
}

// =====================================================================
// 📝 Application / Approval (self-service apply, admin approves)
// =====================================================================

export async function applyForAffiliate(userId: string) {
  const userRef = doc(db, "users", userId);
  await updateDoc(userRef, {
    affiliateStatus: "pending" as AffiliateStatus,
    affiliateAppliedAt: serverTimestamp(),
  });
}

function generateAffiliateCodeCandidate(): string {
  // Short, human-shareable code, e.g. "MLF-7K2Q9X"
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `MLF-${code}`;
}

async function isAffiliateCodeTaken(code: string): Promise<boolean> {
  const q = query(collection(db, "users"), where("affiliateCode", "==", code));
  const snap = await getDocs(q);
  return !snap.empty;
}

export async function approveAffiliate(userId: string, adminId: string | null) {
  const userRef = doc(db, "users", userId);

  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("User not found.");

  const existing = userSnap.data() as any;

  // Reuse existing code if they were previously approved/rejected before.
  let code = existing.affiliateCode as string | undefined;

  if (!code) {
    let attempt = generateAffiliateCodeCandidate();
    let tries = 0;
    while (await isAffiliateCodeTaken(attempt) && tries < 5) {
      attempt = generateAffiliateCodeCandidate();
      tries++;
    }
    code = attempt;
  }

  await updateDoc(userRef, {
    affiliateStatus: "approved" as AffiliateStatus,
    affiliateCode: code,
    affiliateApprovedAt: serverTimestamp(),
    affiliateApprovedBy: adminId || null,
    affiliateEarningsAccrued: existing.affiliateEarningsAccrued ?? 0,
    affiliateEarningsPaidOut: existing.affiliateEarningsPaidOut ?? 0,
  });
}

export async function rejectAffiliate(userId: string, adminId: string | null) {
  await updateDoc(doc(db, "users", userId), {
    affiliateStatus: "rejected" as AffiliateStatus,
    affiliateRejectedAt: serverTimestamp(),
    affiliateRejectedBy: adminId || null,
  });
}

export async function getPendingAffiliateApplications() {
  const q = query(collection(db, "users"), where("affiliateStatus", "==", "pending"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

/**
 * Resolve a referral code to an APPROVED affiliate's user id.
 * Returns null if the code doesn't exist or the affiliate isn't approved
 * (e.g. later revoked). Used at PaSwipe request-submission time.
 */
export async function resolveAffiliateCode(
  code: string
): Promise<{ affiliateId: string; affiliateName: string } | null> {
  const trimmed = (code || "").trim().toUpperCase();
  if (!trimmed) return null;

  const q = query(collection(db, "users"), where("affiliateCode", "==", trimmed));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const d = snap.docs[0];
  const data = d.data() as any;

  if (data.affiliateStatus !== "approved") return null;

  return {
    affiliateId: d.id,
    affiliateName: data.fullName || `${data.firstName ?? ""} ${data.lastName ?? ""}`.trim() || d.id,
  };
}

// =====================================================================
// 📒 Ledger writes — MUST be called inside an existing transaction,
// during its write phase (all tx.get() reads must already be done).
// =====================================================================

/**
 * Records the first-half commission release. Call this from inside the
 * PaSwipe request-approval transaction, right after confirming the
 * affiliate is valid (approved, not the buyer themselves).
 */
export function writeFirstHalfCommission(
  tx: Transaction,
  params: {
    affiliateId: string;
    affiliateName: string;
    installmentId: string;
    amount: number;
    productTitle?: string;
  }
) {
  const { affiliateId, affiliateName, installmentId, amount, productTitle } = params;
  if (amount <= 0) return;

  const ledgerRef = doc(collection(db, "affiliateCommissions"));
  tx.set(ledgerRef, {
    affiliateId,
    affiliateName,
    installmentId,
    productTitle: productTitle || null,
    type: "first_half",
    amount,
    triggerEvent: "downpayment_confirmed",
    createdAt: serverTimestamp(),
  });

  tx.update(doc(db, "users", affiliateId), {
    affiliateEarningsAccrued: increment(amount),
  });

  bumpEasyInstallmentSummary(tx, { commissionDelta: amount });
}

/**
 * Records an incremental (or final) second-half accrual. Call this from
 * inside collectPaSwipeInstallmentPayment's transaction.
 */
export function writeSecondHalfAccrual(
  tx: Transaction,
  params: {
    affiliateId: string;
    affiliateName: string;
    installmentId: string;
    scheduleId: string;
    amount: number;
    isFinal: boolean; // true if this delta completes the second half
    productTitle?: string;
  }
) {
  const { affiliateId, affiliateName, installmentId, scheduleId, amount, isFinal, productTitle } = params;
  if (amount <= 0) return;

  const ledgerRef = doc(collection(db, "affiliateCommissions"));
  tx.set(ledgerRef, {
    affiliateId,
    affiliateName,
    installmentId,
    scheduleId,
    productTitle: productTitle || null,
    type: "second_half_accrual",
    amount,
    triggerEvent: "installment_payment",
    createdAt: serverTimestamp(),
  });

  const installmentRef = doc(db, "paSwipeInstallments", installmentId);
  const update: Record<string, any> = {
    "referralCommission.secondHalfReleased": increment(amount),
  };
  if (isFinal) {
    update["referralCommission.secondHalfFullyReleasedAt"] = serverTimestamp();
  }
  tx.update(installmentRef, update);

  tx.update(doc(db, "users", affiliateId), {
    affiliateEarningsAccrued: increment(amount),
  });

  bumpEasyInstallmentSummary(tx, { commissionDelta: amount });
}

function bumpEasyInstallmentSummary(
  tx: Transaction,
  delta: { interestDelta?: number; commissionDelta?: number }
) {
  const ref = doc(db, "easyInstallmentFinancialSummary", "current_state");
  const update: Record<string, any> = {};
  if (delta.interestDelta) update.totalInterestCollected = increment(delta.interestDelta);
  if (delta.commissionDelta) update.totalCommissionsAccrued = increment(delta.commissionDelta);
  update.updatedAt = serverTimestamp();
  tx.set(ref, update, { merge: true });
}

/** Track interest actually collected (separate call, used alongside payment recording). */
export function bumpEasyInstallmentInterestCollected(tx: Transaction, interestDelta: number) {
  if (interestDelta <= 0) return;
  bumpEasyInstallmentSummary(tx, { interestDelta });
}

// =====================================================================
// 💵 Payout recording (accrued → actually paid out to the affiliate)
// =====================================================================

export async function recordAffiliatePayout(params: {
  affiliateId: string;
  amount: number;
  method: string; // "cash" | "gcash" | "bank" | etc.
  notes?: string;
  adminId: string | null;
}) {
  const { affiliateId, amount, method, notes, adminId } = params;
  if (amount <= 0) throw new Error("Payout amount must be greater than 0.");

  await runTransaction(db, async (tx) => {
    const userRef = doc(db, "users", affiliateId);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("Affiliate not found.");

    const u = userSnap.data() as any;
    const accrued = Number(u.affiliateEarningsAccrued || 0);
    const paidOut = Number(u.affiliateEarningsPaidOut || 0);
    const balance = Math.round((accrued - paidOut) * 100) / 100;

    if (amount > balance + 0.5) {
      throw new Error(
        `Payout exceeds outstanding balance (₱${balance.toLocaleString()} owed).`
      );
    }

    const payoutRef = doc(collection(db, "affiliatePayouts"));
    tx.set(payoutRef, {
      affiliateId,
      affiliateName: u.fullName || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || affiliateId,
      amount,
      method,
      notes: notes || "",
      paidBy: adminId || null,
      createdAt: serverTimestamp(),
    });

    tx.update(userRef, {
      affiliateEarningsPaidOut: increment(amount),
    });
  });
}

export async function getAffiliateBalance(affiliateId: string): Promise<{
  accrued: number;
  paidOut: number;
  balance: number;
}> {
  const snap = await getDoc(doc(db, "users", affiliateId));
  const u = snap.exists() ? (snap.data() as any) : {};
  const accrued = Number(u.affiliateEarningsAccrued || 0);
  const paidOut = Number(u.affiliateEarningsPaidOut || 0);
  return { accrued, paidOut, balance: Math.round((accrued - paidOut) * 100) / 100 };
}

export async function getAffiliateCommissionHistory(affiliateId: string) {
  const q = query(collection(db, "affiliateCommissions"), where("affiliateId", "==", affiliateId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function getAffiliatePayoutHistory(affiliateId: string) {
  const q = query(collection(db, "affiliatePayouts"), where("affiliateId", "==", affiliateId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}