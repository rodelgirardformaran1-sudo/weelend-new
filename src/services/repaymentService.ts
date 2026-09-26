// firebase/repaymentService.ts
import { db } from "../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
} from "firebase/firestore";
import { runTransaction, increment } from "firebase/firestore";
import {
  computeCreditScoreDelta,
  clampCreditScore,
  computeCreditLimitAfterPayoff,
  DEFAULT_CREDIT_SCORE,
} from "./creditEngine";

/* =========================================================
   ⚠️ LEGACY REPAYMENT FUNCTIONS (KEEP FOR NOW)
   These keep your current app from breaking
   ========================================================= */

// borrower submits repayment (legacy – flat payments)
export async function submitRepayment(
  loanId: string,
  borrowerUid: string,
  amount: number
) {
  try {
    const repaymentsRef = collection(db, "repayments");

    await addDoc(repaymentsRef, {
      loanId,
      borrowerUid,
      amount,
      paidAt: serverTimestamp(),
      type: "legacy",
    });

    console.log("✅ Legacy repayment recorded");
  } catch (error) {
    console.error("❌ Error submitting repayment:", error);
    throw error;
  }
}

// get repayments for a specific loan (legacy)
export async function getRepaymentsByLoan(loanId: string) {
  const repaymentsRef = collection(db, "repayments");
  const q = query(repaymentsRef, where("loanId", "==", loanId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// admin fetch all repayments (legacy)
export async function getAllRepayments() {
  const repaymentsRef = collection(db, "repayments");
  const snapshot = await getDocs(repaymentsRef);

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}


/* =========================================================
   ✅ NEW: SCHEDULE-BASED REPAYMENT SYSTEM (CORRECT MODEL)
   ========================================================= */

export async function getRepaymentSchedule(loanId: string) {
  const scheduleRef = collection(db, "activeLoans", loanId, "schedule");
  const snapshot = await getDocs(scheduleRef);

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/* =========================================================
   🔔 DUE-DATE LOOKUP — for the Member/Borrower dashboard nudge
   banner. Reads the same schedule subcollection the admin
   Repayments tab reads (the real source of truth for due dates —
   activeLoans.nextDueDate is only set once at loan creation and
   goes stale the moment the first payment is collected).
   ========================================================= */
export interface NextDueInstallment {
  loanId: string;
  dueDate: Date;
  totalDue: number; // includes the late fee if already overdue
  isOverdue: boolean;
  daysDiff: number; // negative = days overdue, 0 = due today, positive = days until due
}

/** Earliest unpaid installment across all of a user's ACTIVE loans, or null if none. */
export async function getNextDueInstallmentForUser(
  userId: string
): Promise<NextDueInstallment | null> {
  const loansSnap = await getDocs(
    query(
      collection(db, "activeLoans"),
      where("userId", "==", userId),
      where("status", "==", "active")
    )
  );

  if (loansSnap.empty) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let earliest: NextDueInstallment | null = null;

  for (const loanDoc of loansSnap.docs) {
    const scheduleSnap = await getDocs(
      collection(db, "activeLoans", loanDoc.id, "schedule")
    );

    for (const itemDoc of scheduleSnap.docs) {
      const item = itemDoc.data() as any;

      if (item.status === "voided") continue;
      if (item.paid && !item.partial) continue;

      const dueDate =
        item.dueDate?.toDate ? item.dueDate.toDate() :
        item.dueDate instanceof Date ? item.dueDate :
        new Date(item.dueDate);

      if (isNaN(dueDate.getTime())) continue;

      const dueDay = new Date(dueDate);
      dueDay.setHours(0, 0, 0, 0);
      const daysDiff = Math.round((dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const principal = Number(item.principalDue ?? 0);
      const interest = Number(item.interestDue ?? 0);
      const base = Number(item.remainingDue ?? (principal + interest));

      let lateRate = 0;
      if (daysDiff < 0) {
        const overdueDays = -daysDiff;
        lateRate = overdueDays >= 15 ? 0.05 : 0.03;
      }

      const totalDue = base + base * lateRate;

      if (!earliest || dueDate.getTime() < earliest.dueDate.getTime()) {
        earliest = {
          loanId: loanDoc.id,
          dueDate,
          totalDue,
          isOverdue: daysDiff < 0,
          daysDiff,
        };
      }
    }
  }

  return earliest;
}

export async function markScheduledPaymentPaid(
  loanId: string,
  paymentId: string,
  actualPaidAmount: number
) {
  try {
    const paymentRef = doc(db, "activeLoans", loanId, "schedule", paymentId);

    await updateDoc(paymentRef, {
      paid: true,
      paidAt: serverTimestamp(),
      actualPaid: actualPaidAmount,
    });

    console.log("✅ Scheduled payment marked as paid");
  } catch (error) {
    console.error("❌ Failed to mark scheduled payment:", error);
    throw error;
  }
}// ⚠ DO NOT USE FOR ADMIN COLLECTION — use transaction functions instead

export async function applyLateFeeToSchedule(
  loanId: string,
  paymentId: string,
  lateFeeAmount: number
) {
  try {
    const paymentRef = doc(db, "activeLoans", loanId, "schedule", paymentId);

    await updateDoc(paymentRef, {
      lateFeeApplied: lateFeeAmount,
    });

    console.log("⚠️ Late fee applied to scheduled payment");
  } catch (error) {
    console.error("❌ Failed applying late fee:", error);
    throw error;
  }
}// ⚠ DO NOT USE FOR ADMIN COLLECTION — use transaction functions instead

export async function reduceLoanBalance(
  loanId: string,
  newRemainingBalance: number
) {
  try {
    const loanRef = doc(db, "activeLoans", loanId);

    await updateDoc(loanRef, {
      remainingBalance: newRemainingBalance,
      updatedAt: serverTimestamp(),
    });

    console.log("✅ Loan balance updated");
  } catch (error) {
    console.error("❌ Failed updating loan balance:", error);
    throw error;
  }
}// ⚠ DO NOT USE FOR ADMIN COLLECTION — use transaction functions instead

export async function getActiveLoanById(loanId: string) {
  const loanRef = doc(db, "activeLoans", loanId);
  const snap = await getDoc(loanRef);

  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// =========================================================
// 🔧 Small helper: tolerate centavo-level rounding drift
// instead of blocking a legitimate final payment.
// =========================================================
const ROUNDING_TOLERANCE = 1; // pesos

function safeFinalBalance(rawBalance: number): number {
  // 🐛 FIX: this used to only catch a tiny NEGATIVE overshoot (e.g.
  // -0.02 from floating-point drift across several payments) and snap
  // that to 0. It never caught the mirror case — a tiny POSITIVE
  // leftover like 0.02000000000436557 — so a loan that was truly paid
  // off in full could be left with a microscopic non-zero balance
  // forever, which made `newRemainingBalance === 0` fail and kept the
  // loan's status stuck on "active" even though every installment was
  // paid. Treating BOTH directions of drift as "fully paid" within the
  // same tolerance fixes that.
  if (Math.abs(rawBalance) <= ROUNDING_TOLERANCE) {
    return 0; // tiny rounding drift, either direction — treat as fully paid
  }
  if (rawBalance < 0) {
    throw new Error("Overpayment blocked");
  }
  return rawBalance;
}

export async function collectScheduledPaymentTransaction(params: {
  loanId: string;
  scheduleId: string;
  borrowerId: string;
  waiveLateFee: boolean;
  paymentAmount?: number;
  forMonth: number;
  forYear: number;
}) {
  const { loanId, scheduleId, borrowerId, waiveLateFee, paymentAmount, forMonth, forYear } = params;

  try {
    await runTransaction(db, async (tx) => {

      const loanRef = doc(db, "activeLoans", loanId);
      const schedRef = doc(db, "activeLoans", loanId, "schedule", scheduleId);
      const userRef = doc(db, "users", borrowerId);
      const coopRef = doc(db, "coopFinancialSummary", "current_state");
      const paymentsRef = collection(db, "payments");
      const loanRepaymentsRef = collection(db, "activeLoans", loanId, "repayments");

      const loanSnap = await tx.get(loanRef);
      const schedSnap = await tx.get(schedRef);
      const coopSnap = await tx.get(coopRef);
      const userSnap = await tx.get(userRef);

      if (!loanSnap.exists()) throw new Error("Loan not found");
      if (!schedSnap.exists()) throw new Error("Schedule not found");
      if (!coopSnap.exists()) throw new Error("Coop summary missing");

      const loan = loanSnap.data();
      const sched = schedSnap.data();
      const borrowerProfile = userSnap.exists() ? userSnap.data() : null;

      if (sched.paid) throw new Error("Installment already paid");

      const principalPaid = Number(sched.principalDue ?? 0);

      // ✅ FIX #1: account for interest already paid via an earlier partial payment
      const interestDueOriginal = Number(sched.interestDue ?? 0);
      const interestAlreadyPaid = Number(sched.interestPaid ?? 0);
      const interestPaid = Math.max(interestDueOriginal - interestAlreadyPaid, 0);

      // ✅ use remainingDue if partial already happened
      const baseAmount = Number(
        sched.remainingDue ?? (principalPaid + interestPaid)
      );

      // -------- Late fee calc --------
      const dueDate =
        sched.dueDate?.toDate ? sched.dueDate.toDate() :
        sched.dueDate instanceof Date ? sched.dueDate :
        new Date(sched.dueDate);

      const today = new Date();

      let lateRate = 0;

      if (today > dueDate) {
        const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        lateRate = diffDays >= 15 ? 0.05 : 0.03;
      }

      const computedLateFee = baseAmount * lateRate;
      const lateFeePaid = waiveLateFee ? 0 : computedLateFee;

      const requestedPayment = paymentAmount ?? (baseAmount + lateFeePaid);

      // allocate payment: installment balance first, then late fee
      let remainingPayment = requestedPayment;

      let installmentPaid = Math.min(baseAmount, remainingPayment);
      remainingPayment -= installmentPaid;

      let principalPaidFinal = 0;
      let interestPaidFinal = 0;

      // if only interest remains (after an earlier partial principal payment)
      if (baseAmount <= interestPaid) {
        interestPaidFinal = installmentPaid;
      } else {
        const remainingPrincipalInInstallment = baseAmount - interestPaid;
        principalPaidFinal = Math.min(remainingPrincipalInInstallment, installmentPaid);
        interestPaidFinal = installmentPaid - principalPaidFinal;
      }

      let lateFeePaidFinal = waiveLateFee ? 0 : Math.min(computedLateFee, remainingPayment);

      const totalPaid = principalPaidFinal + interestPaidFinal + lateFeePaidFinal;

      // ✅ FIX #2: rounding-tolerant balance check
      const rawNewBalance = (loan.remainingBalance ?? 0) - principalPaidFinal;
      const newRemainingBalance = safeFinalBalance(rawNewBalance);

      // -------- Profit & pools --------
      // ✅ Late fees go 100% to Trust Fund — never shared with members.
      // Only interest income gets split into pools.
      const interestProfit = interestPaidFinal;
      const trustFundFromInterest = interestProfit * 0.10;
      const remainingInterest = interestProfit - trustFundFromInterest;

      const capitalShare = remainingInterest * 0.70;
      const effortShare = remainingInterest * 0.30;

      const trustFund = trustFundFromInterest + lateFeePaidFinal;
      const fullyPaid = installmentPaid >= baseAmount;

      // -------- Updates --------
      const schedUpdate: any = {
        paid: fullyPaid,
        partial: !fullyPaid,
        remainingDue: fullyPaid ? 0 : increment(-installmentPaid),
        principalPaid: increment(principalPaidFinal),
        interestPaid: increment(interestPaidFinal),
        lateFeePaid: increment(lateFeePaidFinal),
        lateFeeRateApplied: lateRate,
        lateFeeWaived: waiveLateFee,
        actualPaid: increment(totalPaid),
      };

      if (fullyPaid) {
        schedUpdate.paidAt = serverTimestamp();
      }

      tx.update(schedRef, schedUpdate);

      // --- Credit score (per installment) + credit limit (at payoff) ---
      // hadAnyLatePayment carries forward on the loan doc so a loan that
      // was ever late stays flagged even after later on-time payments,
      // and the limit engine can tell "clean payoff" from "recovered but
      // was late at some point" once the loan is fully settled.
      const loanHadLateBefore = Boolean(loan.hadAnyLatePayment);
      const isLateNow = lateRate > 0;
      const anyLateOverall = loanHadLateBefore || isLateNow;

      const loanUpdate: any = {
        remainingBalance: newRemainingBalance,
        status: newRemainingBalance === 0 ? "completed" : "active",
        lastPaymentAt: serverTimestamp(),
      };
      if (fullyPaid) {
        loanUpdate.hadAnyLatePayment = anyLateOverall;
      }
      tx.update(loanRef, loanUpdate);

      const currentCreditScore = Number(borrowerProfile?.creditScore ?? DEFAULT_CREDIT_SCORE);
      const scoreDelta = fullyPaid ? computeCreditScoreDelta(lateRate) : 0;
      const newCreditScore = clampCreditScore(currentCreditScore + scoreDelta);

      const userUpdate: any = {
        loanBalance: increment(-principalPaidFinal),
        creditScore: newCreditScore,
      };

      if (fullyPaid && newRemainingBalance === 0) {
        const role: "member" | "borrower" = borrowerProfile?.role === "borrower" ? "borrower" : "member";
        const currentLimit = Number(borrowerProfile?.loanLimit ?? 0);
        userUpdate.loanLimit = computeCreditLimitAfterPayoff(currentLimit, role, anyLateOverall);
      }

      tx.update(userRef, userUpdate);

      const payRef = doc(paymentsRef);

      tx.set(payRef, {
        loanId,
        borrowerId,
        scheduleId,

        principalPaid: principalPaidFinal,
        interestPaid: interestPaidFinal,
        lateFeePaid: lateFeePaidFinal,
        lateFeeRateApplied: lateRate,
        lateFeeWaived: waiveLateFee,

        totalPaid,
        forMonth,
        forYear,
        createdAt: serverTimestamp(),
      });

      const loanPayRef = doc(loanRepaymentsRef);

      tx.set(loanPayRef, {
        loanId,
        userId: borrowerId,

        principalPaid: principalPaidFinal,
        interestPaid: interestPaidFinal,
        lateFeePaid: lateFeePaidFinal,

        amount: totalPaid,
        date: serverTimestamp(),
        type: "full",
      });

      tx.update(coopRef, {
        totalLoanedAmount: increment(-principalPaidFinal),
        totalPrincipalCollected: increment(principalPaidFinal),
        totalInterestCollected: increment(interestPaidFinal),
        totalLateFeesCollected: increment(lateFeePaidFinal),

        trustFundBalance: increment(trustFund),
        capitalPool: increment(capitalShare),
        effortPool: increment(effortShare),

        totalLendableFunds: increment(totalPaid),
        lastUpdated: serverTimestamp(),
      });
    });

    console.log("✅ Installment collected with pools + trust fund");

  } catch (err) {
    console.error("❌ Payment transaction failed:", err);
    throw err;
  }
}

/* =========================================================
   ⚠ PARTIAL PAYMENT — now splits interest + principal correctly
   ========================================================= */

export async function collectPartialPaymentTransaction(params: {
  loanId: string;
  scheduleId: string;
  borrowerId: string;
  amountPaid: number;
  forMonth: number;
  forYear: number;
}) {
  const { loanId, scheduleId, borrowerId, amountPaid, forMonth, forYear } = params;

  if (amountPaid <= 0) throw new Error("Invalid payment amount");

  try {
    await runTransaction(db, async (tx) => {

      const loanRef = doc(db, "activeLoans", loanId);
      const schedRef = doc(db, "activeLoans", loanId, "schedule", scheduleId);
      const userRef = doc(db, "users", borrowerId);
      const coopRef = doc(db, "coopFinancialSummary", "current_state");
      const paymentsRef = collection(db, "payments");
      const loanRepaymentsRef = collection(db, "activeLoans", loanId, "repayments");

      const loanSnap = await tx.get(loanRef);
      const schedSnap = await tx.get(schedRef);
      const coopSnap = await tx.get(coopRef);
      const userSnap = await tx.get(userRef);

      if (!loanSnap.exists()) throw new Error("Loan not found");
      if (!schedSnap.exists()) throw new Error("Schedule not found");
      if (!coopSnap.exists()) throw new Error("Coop summary missing");

      const loan = loanSnap.data();
      const sched = schedSnap.data();
      const borrowerProfile = userSnap.exists() ? userSnap.data() : null;

      if (sched.paid) throw new Error("Installment already paid");

      const remainingDue = Number(sched.remainingDue ?? sched.totalDue ?? 0);

      // ✅ NEW: calculate late fee the same way full payments do
      const dueDate =
        sched.dueDate?.toDate ? sched.dueDate.toDate() :
        sched.dueDate instanceof Date ? sched.dueDate :
        new Date(sched.dueDate);

      const today = new Date();
      let lateRate = 0;

      if (today > dueDate) {
        const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        lateRate = diffDays >= 15 ? 0.05 : 0.03;
      }

      const computedLateFee = remainingDue * lateRate;
      const lateFeeAlreadyPaid = Number(sched.lateFeePaid ?? 0);
      const lateFeeRemaining = Math.max(computedLateFee - lateFeeAlreadyPaid, 0);

      const maxPayable = remainingDue + lateFeeRemaining;

      if (amountPaid > maxPayable) {
        throw new Error("Payment exceeds remaining installment balance");
      }

      // ✅ FIX: split payment — interest first, then late fee, then principal
      const interestDueOriginal = Number(sched.interestDue ?? 0);
      const interestAlreadyPaid = Number(sched.interestPaid ?? 0);
      const interestRemaining = Math.max(interestDueOriginal - interestAlreadyPaid, 0);

      const interestPaidNow = Math.min(amountPaid, interestRemaining);
      let leftoverAfterInterest = amountPaid - interestPaidNow;

      const lateFeePaidNow = Math.min(leftoverAfterInterest, lateFeeRemaining);
      const leftoverAfterLateFee = leftoverAfterInterest - lateFeePaidNow;

      const principalPaid = leftoverAfterLateFee;

      const remainingLoanBalance = Number(loan.remainingBalance ?? 0);

      if (principalPaid > remainingLoanBalance) {
        throw new Error("Payment exceeds remaining balance");
      }

      // ✅ UPDATED: interest gets 10/70/30 split; late fee goes 100% to Trust Fund
      const interestProfit = interestPaidNow;
      const trustFundFromInterest = interestProfit * 0.10;
      const remainingInterest = interestProfit - trustFundFromInterest;
      const capitalShare = remainingInterest * 0.70;
      const effortShare = remainingInterest * 0.30;
      const trustFund = trustFundFromInterest + lateFeePaidNow;
      const newRemainingBalance = safeFinalBalance(remainingLoanBalance - principalPaid);

      // -------- Updates --------
      // A partial payment never marks the installment itself "paid" (see
      // below), so no per-installment credit-score delta happens here —
      // that fires later, when a follow-up payment actually completes
      // it. But the LOAN as a whole can still reach a zero balance via a
      // partial payment (e.g. the last bit of principal clears here even
      // though a small late fee remains) — so the credit-limit-at-payoff
      // check still applies, same as the full-payment path.
      const loanHadLateBefore = Boolean(loan.hadAnyLatePayment);
      const isLateNow = lateRate > 0;
      const anyLateOverall = loanHadLateBefore || isLateNow;

      const loanUpdate: any = {
        remainingBalance: newRemainingBalance,
        status: newRemainingBalance === 0 ? "completed" : "active",
        lastPaymentAt: serverTimestamp(),
        hadAnyLatePayment: anyLateOverall,
      };
      tx.update(loanRef, loanUpdate);

      tx.update(schedRef, {
        partial: true,
        partialPaid: increment(amountPaid),
        remainingDue: increment(-(interestPaidNow + principalPaid)), // late fee isn't part of the installment's principal+interest total
        interestPaid: increment(interestPaidNow),
        lateFeePaid: increment(lateFeePaidNow),
        lateFeeRateApplied: lateRate,
        lastPartialAt: serverTimestamp(),
      });

      const userUpdate: any = {
        loanBalance: increment(-principalPaid),
      };

      if (newRemainingBalance === 0) {
        const role: "member" | "borrower" = borrowerProfile?.role === "borrower" ? "borrower" : "member";
        const currentLimit = Number(borrowerProfile?.loanLimit ?? 0);
        userUpdate.loanLimit = computeCreditLimitAfterPayoff(currentLimit, role, anyLateOverall);
      }

      tx.update(userRef, userUpdate);

      const payRef = doc(paymentsRef);

      tx.set(payRef, {
        loanId,
        borrowerId,
        scheduleId,

        type: "partial",

        principalPaid,
        interestPaid: interestPaidNow,
        lateFeePaid: lateFeePaidNow,

        totalPaid: amountPaid,
        forMonth,
        forYear,
        createdAt: serverTimestamp(),
      });

      const loanPayRef = doc(loanRepaymentsRef);

      tx.set(loanPayRef, {
        loanId,
        userId: borrowerId,

        principalPaid,
        interestPaid: interestPaidNow,
        lateFeePaid: lateFeePaidNow,

        amount: amountPaid,
        date: serverTimestamp(),
        type: "partial",
      });

      tx.update(coopRef, {
        totalLoanedAmount: increment(-principalPaid),
        totalPrincipalCollected: increment(principalPaid),
        totalInterestCollected: increment(interestPaidNow),
        totalLateFeesCollected: increment(lateFeePaidNow),

        trustFundBalance: increment(trustFund),
        capitalPool: increment(capitalShare),
        effortPool: increment(effortShare),

        totalLendableFunds: increment(amountPaid),
        lastUpdated: serverTimestamp(),
      });
    });

    console.log("⚠ Partial payment collected (principal + interest split)");

  } catch (err) {
    console.error("❌ Partial payment failed:", err);
    throw err;
  }
}