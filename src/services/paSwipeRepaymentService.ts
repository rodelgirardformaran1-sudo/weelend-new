// src/services/paSwipeRepaymentService.ts
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { computeLateFee, daysPastDue, isRepossessionDue, GRACE_DAYS } from "../utils/paSwipeCalc";
import {
  computeSecondHalfAccrualDelta,
  writeSecondHalfAccrual,
  bumpEasyInstallmentInterestCollected,
} from "./affiliateService";

const INSTALLMENTS_COL = "paSwipeInstallments";

// =========================================================
// 📋 Get full schedule for a Pa-Swipe installment
// =========================================================
export async function getPaSwipeSchedule(installmentId: string) {
  const scheduleRef = collection(db, INSTALLMENTS_COL, installmentId, "schedule");
  const snap = await getDocs(scheduleRef);

  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
}

// =========================================================
// 🔎 Live status check for one schedule item (no writes)
// Used for display: how much is owed right now, including late fee.
// =========================================================
export function evaluateScheduleItem(item: any, referenceDate: Date = new Date()) {
  const dueDate: Date = item.dueDate?.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
  const daysLate = item.paid ? 0 : daysPastDue(dueDate, referenceDate);

  const installmentAmount = Number(item.installmentAmount ?? 0);
  const remainingInstallment = Math.max(
    installmentAmount - Number(item.amountPaid ?? 0),
    0
  );

  const computedLateFee = item.paid ? 0 : computeLateFee(installmentAmount, daysLate);
  const lateFeeAlreadyPaid = Number(item.lateFeePaid ?? 0);
  const lateFeeRemaining = Math.max(computedLateFee - lateFeeAlreadyPaid, 0);

  const totalDue = remainingInstallment + lateFeeRemaining;
  const repossessionDue = isRepossessionDue(daysLate);
  const inGracePeriod = daysLate > 0 && daysLate <= GRACE_DAYS;

  return {
    daysLate,
    remainingInstallment,
    computedLateFee,
    lateFeeRemaining,
    totalDue,
    repossessionDue,
    inGracePeriod,
  };
}

// =========================================================
// 💳 Collect a payment against a specific schedule item
// Order: installment amount first, then late fee.
// =========================================================
export async function collectPaSwipeInstallmentPayment(params: {
  installmentId: string;
  scheduleId: string;
  amountPaid: number;
}) {
  const { installmentId, scheduleId, amountPaid } = params;

  if (amountPaid <= 0) throw new Error("Invalid payment amount");

  await runTransaction(db, async (tx) => {
    const installmentRef = doc(db, INSTALLMENTS_COL, installmentId);
    const schedRef = doc(db, INSTALLMENTS_COL, installmentId, "schedule", scheduleId);

    const installmentSnap = await tx.get(installmentRef);
    const schedSnap = await tx.get(schedRef);

    if (!installmentSnap.exists()) throw new Error("Installment contract not found");
    if (!schedSnap.exists()) throw new Error("Schedule item not found");

    const sched = schedSnap.data();

    if (sched.paid) throw new Error("This installment is already fully paid");

    const evaluation = evaluateScheduleItem(sched);
    const { remainingInstallment, lateFeeRemaining, totalDue } = evaluation;

    if (amountPaid > totalDue + 1) {
      // small rounding tolerance, same pattern as loan repayments
      throw new Error("Payment exceeds amount currently owed for this installment");
    }

    // ✅ allocate: installment amount first, then late fee
    const installmentPaidNow = Math.min(amountPaid, remainingInstallment);
    const leftover = amountPaid - installmentPaidNow;
    const lateFeePaidNow = Math.min(leftover, lateFeeRemaining);

    const newAmountPaid = Number(sched.amountPaid ?? 0) + installmentPaidNow;
    const newLateFeePaid = Number(sched.lateFeePaid ?? 0) + lateFeePaidNow;
    const fullyPaid = newAmountPaid >= Number(sched.installmentAmount ?? 0) - 0.5; // rounding tolerance

    tx.update(schedRef, {
      amountPaid: newAmountPaid,
      lateFeePaid: newLateFeePaid,
      lateFeeChargedSnapshot: evaluation.computedLateFee, // for record-keeping
      paid: fullyPaid,
      paidAt: fullyPaid ? serverTimestamp() : null,
    });

    // ✅ Determine installment contract's overall status
    const allSchedSnap = await getDocs(
      collection(db, INSTALLMENTS_COL, installmentId, "schedule")
    );

    // NOTE: allSchedSnap is a plain (non-transactional) read, so it won't
    // reflect the tx.update above yet — override this schedule item's
    // amountPaid/paid with the values we just computed, same pattern the
    // original code used for the "paid" flag.
    const allPaidAfterThis = allSchedSnap.docs.every((d) => {
      if (d.id === scheduleId) return fullyPaid;
      return d.data().paid === true;
    });

    const cumulativePaid = allSchedSnap.docs.reduce((sum, d) => {
      const amt = d.id === scheduleId ? newAmountPaid : Number(d.data().amountPaid ?? 0);
      return sum + amt;
    }, 0);

    tx.update(installmentRef, {
      status: allPaidAfterThis ? "completed" : "active",
      lastPaymentAt: serverTimestamp(),
    });

    // 🧾 Payment log — this product had no payment history recorded at
    // all before now, so this is also what powers the "My Receipts" page.
    const installment = installmentSnap.data() as any;

    // ✅ Easy Installment financial summary — interest portion of this payment.
    // Computed BEFORE the payment log write so the log itself can carry
    // interestPortion too — that's what lets the year-end earnings report
    // sum "interest actually collected in year X" instead of only ever
    // seeing a lifetime total.
    const interestAmountTotal = Number(installment.interestAmount || 0);
    const remainingBalanceTotal = Number(installment.remainingBalance || 0);

    const interestPortionThisPayment =
      remainingBalanceTotal > 0
        ? Math.round((installmentPaidNow * (interestAmountTotal / remainingBalanceTotal)) * 100) / 100
        : 0;

    const paSwipePayRef = doc(collection(db, "paSwipePayments"));
    tx.set(paSwipePayRef, {
      installmentId,
      scheduleId,
      userId: installment.userId,
      userName: installment.userName || null,
      productTitle: installment.productSnapshot?.title || "Item",
      installmentPaid: installmentPaidNow,
      lateFeePaid: lateFeePaidNow,
      totalPaid: amountPaid,
      interestPortion: interestPortionThisPayment,
      fullyPaid,
      createdAt: serverTimestamp(),
    });

    bumpEasyInstallmentInterestCollected(tx, interestPortionThisPayment);

    // ✅ Affiliate second-half commission — pro-rata accrual, releases the
    // remainder immediately if the buyer just settled everything early.
    const affiliateId = installment.affiliateId as string | null;
    const referralCommission = installment.referralCommission as {
      secondHalfAmount: number;
      secondHalfReleased: number;
    } | null;

    if (affiliateId && referralCommission) {
      const secondHalfReleasedSoFar = Number(referralCommission.secondHalfReleased || 0);

      const delta = computeSecondHalfAccrualDelta({
        secondHalfAmount: Number(referralCommission.secondHalfAmount || 0),
        secondHalfReleasedSoFar,
        cumulativePaid,
        remainingBalance: remainingBalanceTotal,
      });

      if (delta > 0) {
        const newSecondHalfReleased = secondHalfReleasedSoFar + delta;
        const isFinal =
          newSecondHalfReleased >= Number(referralCommission.secondHalfAmount || 0) - 0.5;

        writeSecondHalfAccrual(tx, {
          affiliateId,
          affiliateName: installment.affiliateName || affiliateId,
          installmentId,
          scheduleId,
          amount: delta,
          isFinal,
          productTitle: installment.productSnapshot?.title || "Item",
        });
      }
    }
  });
}

// =========================================================
// 🚩 Automatic repossession flagging
// Call this whenever the admin views Pa-Swipe requests/collections,
// so overdue accounts (30+ days) get flagged without a manual step.
// =========================================================
export async function flagOverdueInstallments() {
  const installmentsSnap = await getDocs(collection(db, INSTALLMENTS_COL));

  const flaggedIds: string[] = [];

  for (const installmentDoc of installmentsSnap.docs) {
    const installment = installmentDoc.data();
    if (installment.status === "completed") continue;

    const scheduleSnap = await getDocs(
      collection(db, INSTALLMENTS_COL, installmentDoc.id, "schedule")
    );

    let mostOverdueDays = 0;

    scheduleSnap.docs.forEach((s) => {
      const item = s.data();
      if (item.paid) return;

      const dueDate = item.dueDate?.toDate ? item.dueDate.toDate() : new Date(item.dueDate);
      const days = daysPastDue(dueDate);
      if (days > mostOverdueDays) mostOverdueDays = days;
    });

    const shouldFlag = isRepossessionDue(mostOverdueDays);

    if (shouldFlag && installment.status !== "flagged_for_repossession") {
      await runTransaction(db, async (tx) => {
        tx.update(doc(db, INSTALLMENTS_COL, installmentDoc.id), {
          status: "flagged_for_repossession",
          flaggedAt: serverTimestamp(),
        });
      });
      flaggedIds.push(installmentDoc.id);
    }

    // ✅ Un-flag automatically if it's caught back up (no longer 30+ days overdue)
    if (!shouldFlag && installment.status === "flagged_for_repossession") {
      await runTransaction(db, async (tx) => {
        tx.update(doc(db, INSTALLMENTS_COL, installmentDoc.id), {
          status: "active",
          unflaggedAt: serverTimestamp(),
        });
      });
    }
  }

  return flaggedIds;
}