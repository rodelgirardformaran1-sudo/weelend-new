// src/services/creditCartRepaymentService.ts
import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { computeCreditCartLateFee, daysPastDue, GRACE_DAYS } from "../utils/creditCartCalc";
import { bumpCreditCartInterestCollected } from "./businessProfitService";

const ACCOUNTS_COL = "creditCartAccounts";

export async function getCreditCartSchedule(accountId: string) {
  const snap = await getDocs(collection(db, ACCOUNTS_COL, accountId, "schedule"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
}

export function evaluateCreditCartScheduleItem(item: any, referenceDate: Date = new Date()) {
  const dueDate: Date = item.dueDate?.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
  const daysLate = item.paid ? 0 : daysPastDue(dueDate, referenceDate);

  const installmentAmount = Number(item.installmentAmount ?? 0);
  const remainingInstallment = Math.max(installmentAmount - Number(item.amountPaid ?? 0), 0);

  const computedLateFee = item.paid ? 0 : computeCreditCartLateFee(daysLate);
  const lateFeeAlreadyPaid = Number(item.lateFeePaid ?? 0);
  const lateFeeRemaining = Math.max(computedLateFee - lateFeeAlreadyPaid, 0);

  return {
    daysLate,
    remainingInstallment,
    computedLateFee,
    lateFeeRemaining,
    totalDue: remainingInstallment + lateFeeRemaining,
    inGracePeriod: daysLate > 0 && daysLate <= GRACE_DAYS,
  };
}

export async function collectCreditCartPayment(params: { accountId: string; scheduleId: string; amountPaid: number }) {
  const { accountId, scheduleId, amountPaid } = params;
  if (amountPaid <= 0) throw new Error("Invalid payment amount");

  await runTransaction(db, async (tx) => {
    const accountRef = doc(db, ACCOUNTS_COL, accountId);
    const schedRef = doc(db, ACCOUNTS_COL, accountId, "schedule", scheduleId);

    const accountSnap = await tx.get(accountRef);
    const schedSnap = await tx.get(schedRef);

    if (!accountSnap.exists()) throw new Error("Account not found");
    if (!schedSnap.exists()) throw new Error("Schedule item not found");

    const sched = schedSnap.data();
    if (sched.paid) throw new Error("This installment is already fully paid");

    const evaluation = evaluateCreditCartScheduleItem(sched);
    if (amountPaid > evaluation.totalDue + 1) throw new Error("Payment exceeds amount currently owed for this installment");

    const installmentPaidNow = Math.min(amountPaid, evaluation.remainingInstallment);
    const leftover = amountPaid - installmentPaidNow;
    const lateFeePaidNow = Math.min(leftover, evaluation.lateFeeRemaining);

    const newAmountPaid = Number(sched.amountPaid ?? 0) + installmentPaidNow;
    const newLateFeePaid = Number(sched.lateFeePaid ?? 0) + lateFeePaidNow;
    const fullyPaid = newAmountPaid >= Number(sched.installmentAmount ?? 0) - 0.5;

    tx.update(schedRef, {
      amountPaid: newAmountPaid,
      lateFeePaid: newLateFeePaid,
      paid: fullyPaid,
      paidAt: fullyPaid ? serverTimestamp() : null,
    });

    const allSchedSnap = await getDocs(collection(db, ACCOUNTS_COL, accountId, "schedule"));
    const allPaidAfterThis = allSchedSnap.docs.every((d) => d.id === scheduleId ? fullyPaid : d.data().paid === true);

    tx.update(accountRef, {
      status: allPaidAfterThis ? "completed" : "active",
      lastPaymentAt: serverTimestamp(),
    });

    // 🧾 Payment log — this product had no payment history recorded at
    // all before now, so this is also what powers the "My Receipts" page.
    const account = accountSnap.data() as any;

    // 💰 Marimar's Credit Cart profit ledger — interest portion of this
    // payment, pro-rated the same way as MLF Easy Installment: the
    // interestAmount charged at approval time, spread proportionally
    // across the account's totalPayable (principal + interest) as it
    // gets paid down.
    const interestAmountTotal = Number(account.interestAmount || 0);
    const totalPayableTotal = Number(account.totalPayable || 0);
    const interestPortionThisPayment =
      totalPayableTotal > 0
        ? Math.round((installmentPaidNow * (interestAmountTotal / totalPayableTotal)) * 100) / 100
        : 0;

    const ccPayRef = doc(collection(db, "creditCartPayments"));
    tx.set(ccPayRef, {
      accountId,
      scheduleId,
      userId: account.userId,
      category: account.category || null,
      installmentPaid: installmentPaidNow,
      lateFeePaid: lateFeePaidNow,
      totalPaid: amountPaid,
      interestPortion: interestPortionThisPayment,
      fullyPaid,
      createdAt: serverTimestamp(),
    });

    bumpCreditCartInterestCollected(tx, interestPortionThisPayment);
  });
}