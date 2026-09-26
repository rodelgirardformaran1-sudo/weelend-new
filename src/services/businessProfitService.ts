// src/services/businessProfitService.ts
//
// Profit ledger for the two owner side-businesses run through the app:
// MLF Easy Installment and Marimar's Credit Cart. These are NOT coop
// money — they're separate from coopFinancialSummary/trustFundBalance
// and are never touched by the fiscal year-end coop payout.
//
// Definition of "profit" here (confirmed with the app owner): interest
// actually collected from buyers, minus whatever the owner has withdrawn
// so far. Late fees are treated as a penalty/deterrent, not counted as
// revenue. For Credit Cart, the interestAmount charged IS the markup —
// no separate cost-of-goods is tracked in-app.
//
// Two independent ledgers (own summary doc + own withdrawal log each),
// since these are two different businesses:
//   - easyInstallmentFinancialSummary / easyInstallmentPayouts
//   - creditCartFinancialSummary      / creditCartPayouts
//
// The interest-collected side of each summary doc is written from the
// payment-collection transactions themselves (see
// bumpEasyInstallmentInterestCollected in affiliateService.ts, and
// bumpCreditCartInterestCollected below). This file owns the read side
// (summary + history) and the withdrawal ("release earnings") action —
// owner-only, admin-visible, never member-facing.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  Transaction,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export type BusinessKey = "easyInstallment" | "creditCart";

const BUSINESS_CONFIG: Record<
  BusinessKey,
  { label: string; summaryCollection: string; payoutCollection: string; paymentsCollection: string }
> = {
  easyInstallment: {
    label: "MLF Easy Installment",
    summaryCollection: "easyInstallmentFinancialSummary",
    payoutCollection: "easyInstallmentPayouts",
    paymentsCollection: "paSwipePayments",
  },
  creditCart: {
    label: "Marimar's Credit Cart",
    summaryCollection: "creditCartFinancialSummary",
    payoutCollection: "creditCartPayouts",
    paymentsCollection: "creditCartPayments",
  },
};

export function getBusinessLabel(business: BusinessKey): string {
  return BUSINESS_CONFIG[business].label;
}

export type BusinessProfitSummary = {
  totalInterestCollected: number;
  totalWithdrawn: number;
  undistributedProfit: number;
};

export type BusinessPayout = {
  id: string;
  amount: number;
  note: string;
  adminName: string;
  createdAt: any;
};

// =====================================================================
// 📥 Writer used by creditCartRepaymentService.ts (Easy Installment's
// equivalent, bumpEasyInstallmentInterestCollected, already lives in
// affiliateService.ts — kept there since it's alongside the affiliate
// commission math it also feeds).
// =====================================================================
export function bumpCreditCartInterestCollected(tx: Transaction, interestDelta: number) {
  if (interestDelta <= 0) return;
  const ref = doc(db, BUSINESS_CONFIG.creditCart.summaryCollection, "current_state");
  tx.set(
    ref,
    { totalInterestCollected: increment(interestDelta), updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// =====================================================================
// 📊 Read: lifetime summary
// =====================================================================
export async function getBusinessProfitSummary(business: BusinessKey): Promise<BusinessProfitSummary> {
  const cfg = BUSINESS_CONFIG[business];
  const snap = await getDoc(doc(db, cfg.summaryCollection, "current_state"));
  const d = snap.exists() ? (snap.data() as any) : {};

  const totalInterestCollected = Number(d.totalInterestCollected || 0);
  const totalWithdrawn = Number(d.totalWithdrawn || 0);

  return {
    totalInterestCollected,
    totalWithdrawn,
    undistributedProfit: Math.max(totalInterestCollected - totalWithdrawn, 0),
  };
}

// =====================================================================
// 📅 Read: interest actually collected within a calendar year — the
// "is the business doing well this year vs last year" view.
// =====================================================================
export async function getBusinessInterestForYear(business: BusinessKey, year: number): Promise<number> {
  const cfg = BUSINESS_CONFIG[business];

  const start = Timestamp.fromDate(new Date(year, 0, 1, 0, 0, 0));
  const end = Timestamp.fromDate(new Date(year + 1, 0, 1, 0, 0, 0));

  const q = query(
    collection(db, cfg.paymentsCollection),
    where("createdAt", ">=", start),
    where("createdAt", "<", end)
  );

  const snap = await getDocs(q);
  return snap.docs.reduce((sum, d) => sum + Number((d.data() as any).interestPortion || 0), 0);
}

// =====================================================================
// 💵 Release earnings — owner cash-out. Immutable log entry + deducts
// from the running undistributed-profit balance. Mirrors the Trust Fund
// expense log, just the mirror image (money OUT to the owner instead of
// money OUT to a coop expense).
// =====================================================================
export async function recordBusinessWithdrawal(params: {
  business: BusinessKey;
  amount: number;
  note: string;
  adminName: string;
}) {
  const { business, amount, note, adminName } = params;
  if (!(amount > 0)) throw new Error("Withdrawal amount must be greater than zero.");

  const cfg = BUSINESS_CONFIG[business];
  const summaryRef = doc(db, cfg.summaryCollection, "current_state");

  await runTransaction(db, async (tx) => {
    const summarySnap = await tx.get(summaryRef);
    const d = summarySnap.exists() ? (summarySnap.data() as any) : {};
    const totalInterestCollected = Number(d.totalInterestCollected || 0);
    const totalWithdrawn = Number(d.totalWithdrawn || 0);
    const available = totalInterestCollected - totalWithdrawn;

    if (amount > available + 1) {
      // small rounding tolerance, same pattern used elsewhere in the app
      throw new Error(
        `Withdrawal exceeds undistributed profit. Available: ₱${available.toLocaleString(undefined, { maximumFractionDigits: 2 })}.`
      );
    }

    const payoutRef = doc(collection(db, cfg.payoutCollection));
    tx.set(payoutRef, {
      amount,
      note: note || "",
      adminName,
      createdAt: serverTimestamp(),
    });

    tx.set(
      summaryRef,
      { totalWithdrawn: increment(amount), updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
}

// =====================================================================
// 📜 Read: withdrawal history
// =====================================================================
export async function getBusinessPayoutHistory(business: BusinessKey): Promise<BusinessPayout[]> {
  const cfg = BUSINESS_CONFIG[business];
  const snap = await getDocs(
    query(collection(db, cfg.payoutCollection), orderBy("createdAt", "desc"))
  );

  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      amount: Number(data.amount || 0),
      note: data.note || "",
      adminName: data.adminName || "",
      createdAt: data.createdAt,
    };
  });
}
