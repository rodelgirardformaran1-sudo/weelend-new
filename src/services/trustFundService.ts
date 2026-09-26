// src/services/trustFundService.ts
//
// Trust Fund liquidation log — unlike Capital Pool / Effort Pool / share
// contributions, the Trust Fund is NOT reset to 0 at the fiscal year-end
// payout. It's the coop's risk-protection reserve (10% of every payment
// collected, plus 100% of late fees — see repaymentService.ts), and it's
// drawn down over time for coop expenses: app subscriptions, CDA
// registration, the year-end party, transportation, etc. Whatever is
// left over simply carries into the next fiscal year.
//
// Every expense is recorded here — permanently, with an optional receipt
// photo — for member transparency. Nothing here is ever edited or
// deleted once recorded; that's what makes it a real audit trail.

import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

const COLLECTION = "trustFundExpenses";

export const TRUST_FUND_EXPENSE_CATEGORIES = [
  "App/Software Subscription",
  "Government Registration (CDA, etc.)",
  "Food & Events",
  "Transportation",
  "Miscellaneous",
] as const;

export type TrustFundExpenseCategory = (typeof TRUST_FUND_EXPENSE_CATEGORIES)[number];

export interface TrustFundExpense {
  id: string;
  description: string;
  category: string;
  amount: number;
  receiptUrl: string | null;
  expenseDate: any; // Firestore Timestamp
  recordedBy: string;
  recordedByName: string;
  createdAt: any; // Firestore Timestamp
}

/**
 * Records one Trust Fund expense and deducts it from the running balance
 * in the same call. Admin-only (see firestore.rules) — this is a
 * financial liquidation record, not something members submit themselves.
 */
export async function recordTrustFundExpense(params: {
  description: string;
  category: string;
  amount: number;
  receiptUrl?: string | null;
  expenseDate: Date;
  adminId: string;
  adminName: string;
}): Promise<void> {
  const { description, category, amount, receiptUrl, expenseDate, adminId, adminName } = params;

  if (!description.trim()) throw new Error("Please describe what this expense was for.");
  if (!category) throw new Error("Please select a category.");
  if (!(amount > 0)) throw new Error("Amount must be greater than 0.");

  await addDoc(collection(db, COLLECTION), {
    description: description.trim(),
    category,
    amount,
    receiptUrl: receiptUrl || null,
    expenseDate,
    recordedBy: adminId,
    recordedByName: adminName,
    createdAt: serverTimestamp(),
  });

  const coopSummaryRef = doc(db, "coopFinancialSummary", "current_state");
  await updateDoc(coopSummaryRef, {
    trustFundBalance: increment(-amount),
    lastUpdated: serverTimestamp(),
  });
}

/** Every recorded expense, most recent first. Readable by any signed-in user (transparency). */
export async function getTrustFundExpenses(): Promise<TrustFundExpense[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TrustFundExpense));
}
