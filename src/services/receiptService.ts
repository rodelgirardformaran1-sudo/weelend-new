// src/services/receiptService.ts
//
// Reads receipts for the "My Receipts" page. Deliberately NOT a new
// write path — every payment type already writes (or, for MLF Easy
// Installment / Marimar's Credit Cart, was just given) its own flat
// payment-log collection at the moment of collection:
//   - Coop Loan repayments  → "payments" (borrowerId)
//   - Monthly Share         → "memberShareReceipts" (memberId)
//   - MLF Easy Installment  → "paSwipePayments" (userId)
//   - Marimar's Credit Cart → "creditCartPayments" (userId)
// This just reads all four for one user and normalizes them into one
// shape, rather than adding a fifth "receipts" collection that would
// duplicate data already written inside money-moving transactions.

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";

export type ReceiptType = "loanRepayment" | "shareCollection" | "easyInstallment" | "creditCart";

export interface ReceiptRecord {
  id: string;
  type: ReceiptType;
  productLabel: string;
  amount: number;
  principalPaid?: number;
  interestPaid?: number;
  lateFeePaid?: number;
  monthsPaid?: number;
  forMonth?: number;
  forYear?: number;
  createdAt: Date;
  raw: any; // the original doc, in case the PDF renderer needs anything extra
}

function toDate(value: any): Date {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

const CREDIT_CART_CATEGORY_LABELS: Record<string, string> = {
  grocery: "Grocery Credit",
  department_store: "Department Store Credit",
};

export async function getReceiptsForUser(userId: string): Promise<ReceiptRecord[]> {
  const [paymentsSnap, shareSnap, paSwipeSnap, ccSnap] = await Promise.all([
    getDocs(query(collection(db, "payments"), where("borrowerId", "==", userId))),
    getDocs(query(collection(db, "memberShareReceipts"), where("memberId", "==", userId))),
    getDocs(query(collection(db, "paSwipePayments"), where("userId", "==", userId))),
    getDocs(query(collection(db, "creditCartPayments"), where("userId", "==", userId))),
  ]);

  const records: ReceiptRecord[] = [];

  paymentsSnap.docs.forEach((d) => {
    const r = d.data() as any;
    records.push({
      id: d.id,
      type: "loanRepayment",
      productLabel: `Coop Loan Repayment (${r.type === "partial" ? "Partial" : "Full"})`,
      amount: Number(r.totalPaid ?? 0),
      principalPaid: Number(r.principalPaid ?? 0),
      interestPaid: Number(r.interestPaid ?? 0),
      lateFeePaid: Number(r.lateFeePaid ?? 0),
      forMonth: r.forMonth,
      forYear: r.forYear,
      createdAt: toDate(r.createdAt),
      raw: r,
    });
  });

  shareSnap.docs.forEach((d) => {
    const r = d.data() as any;
    records.push({
      id: d.id,
      type: "shareCollection",
      productLabel: "Monthly Share Commitment",
      amount: Number(r.amountPaid ?? 0),
      monthsPaid: r.monthsPaid,
      forMonth: r.forMonth,
      forYear: r.forYear,
      createdAt: toDate(r.createdAt),
      raw: r,
    });
  });

  paSwipeSnap.docs.forEach((d) => {
    const r = d.data() as any;
    const isDownpayment = r.kind === "downpayment";
    records.push({
      id: d.id,
      type: "easyInstallment",
      productLabel: `MLF Easy Installment — ${isDownpayment ? "Downpayment — " : ""}${r.productTitle || "Item"}`,
      amount: Number(r.totalPaid ?? 0),
      principalPaid: Number(r.installmentPaid ?? 0),
      lateFeePaid: Number(r.lateFeePaid ?? 0),
      createdAt: toDate(r.createdAt),
      raw: r,
    });
  });

  ccSnap.docs.forEach((d) => {
    const r = d.data() as any;
    const categoryLabel = CREDIT_CART_CATEGORY_LABELS[r.category] || "Credit";
    records.push({
      id: d.id,
      type: "creditCart",
      productLabel: `Marimar's Credit Cart — ${categoryLabel}`,
      amount: Number(r.totalPaid ?? 0),
      principalPaid: Number(r.installmentPaid ?? 0),
      lateFeePaid: Number(r.lateFeePaid ?? 0),
      createdAt: toDate(r.createdAt),
      raw: r,
    });
  });

  records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return records;
}
