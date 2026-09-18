// src/services/loanService.ts

import { db } from '../firebaseConfig';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  query,
  where,
  serverTimestamp,
  runTransaction,
  getDoc,
  updateDoc,       // <-- ADD THIS
  increment,        // <-- ADD THIS
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { UserProfile } from "../type";
import { orderBy, limit } from "firebase/firestore";


export interface LoanRepayment {
  id: string;
  amount: number;
  date: any; // Firestore Timestamp
  loanId: string;
  userId: string;
}
// ⚠️ LEGACY — DO NOT USE FOR NEW COLLECTION LOGIC
export async function collectInstallmentPayment(
  loanId: string,
  scheduleId: string,
  userId: string,
) {
  const loanRef = doc(db, "activeLoans", loanId);
  const schedRef = doc(db, "activeLoans", loanId, "schedule", scheduleId);
  const userRef = doc(db, "users", userId);
  const coopRef = doc(db, "coopFinancialSummary", "current_state");

await runTransaction(db, async (tx) => {
  const loanSnap = await tx.get(loanRef);
  const schedSnap = await tx.get(schedRef);

  if (!loanSnap.exists()) throw new Error("Loan not found");
  if (!schedSnap.exists()) throw new Error("Schedule not found");

  const loan = loanSnap.data();
  const sched = schedSnap.data();

const principalPaid = Number(sched.principalDue ?? 0);
const interestPaid = Number(sched.interestDue ?? 0);
const totalPaid = principalPaid + interestPaid;

console.log("🔥 collectInstallmentPayment HIT", {
  loanId,
  scheduleId,
  userId,
  principalPaid,
  interestPaid,
  totalPaid,
});

// ==============================
// 💰 INTEREST DISTRIBUTION
// ==============================

// 10% Trust Fund from INTEREST only
const trustFromInterest = interestPaid * 0.10;

// Remaining interest after trust fund
const netInterest = interestPaid - trustFromInterest;

// Split remaining interest
const capitalFromInterest = netInterest * 0.70;
const effortFromInterest  = netInterest * 0.30;


// Phase 1: no late fee yet (future-ready)
const lateFeePaid = 0;


// ✅ Remaining balance must reduce by PRINCIPAL only
const newBalance = (loan.remainingBalance ?? 0) - principalPaid;
  if (newBalance < 0) throw new Error("Overpayment blocked");

  // ✅ mark installment paid
tx.update(schedRef, {
  paid: true,
  paidAt: serverTimestamp(),

  principalPaid,
  interestPaid,
  lateFeePaid,
  actualPaid: totalPaid
});

  // ✅ update loan
  tx.update(loanRef, {
    remainingBalance: newBalance,
    status: newBalance === 0 ? "completed" : "active",
    lastPaymentAt: serverTimestamp()
  });

  // ✅ borrower loan balance (principal only)
  tx.update(userRef, {
    loanBalance: increment(-principalPaid)
  });

  // ✅ coop accounting
// ==============================
// 🏦 COOP FINANCIAL POOL UPDATES
// ==============================
tx.update(coopRef, {
  // factual totals
  totalPrincipalCollected: increment(principalPaid),
  totalInterestCollected: increment(interestPaid),
  totalLateFeesCollected: increment(lateFeePaid),
  totalPaymentsCollected: increment(principalPaid + interestPaid + lateFeePaid),

  // pools
  capitalPool: increment(principalPaid + capitalFromInterest),
  effortPool: increment(effortFromInterest),
  trustFundBalance: increment(trustFromInterest),

  // liquidity
  totalLoanedAmount: increment(-principalPaid),
  totalLendableFunds: increment(principalPaid + interestPaid + lateFeePaid),

  lastUpdated: serverTimestamp(),
});
});
}

// ==========================
// 📌 Loan Type Definition
// ==========================
export interface LoanRecord {
  id: string;
  userId: string;
  termsMonths: number;
  status: "pending" | "approved" | "denied" | "reconsideration" | "paid" | "active" | "completed";
  nextDueDate: any;
  remainingBalance?: number;  // <-- new
  terms?: number; 
}

export async function getAllLoans(): Promise<LoanRecord[]> {
  const snapshot = await getDocs(collection(db, "activeLoans"));
  
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...(doc.data() as Omit<LoanRecord, "id">),
  }));
}

export interface LoanRequest {
  id?: string;
  userId: string;
  amount: number;
  amountBorrowed: number;
  purpose: string;
  termsMonths: number;
  guarantorId?: string;
  paymentSchedule?: string;
  paymentCount?: number;
  nextDueDate?: Timestamp | Date;
  status: 'pending' | 'approved' | 'denied' | 'reconsideration' | 'paid';
  requestedAt: any;
  approvedAmount?: number;
  approvedBy?: string;
  approvedAt?: any;
  rejectedAt?: any;
  dueDate?: any;
  idDocumentUrl?: string; // Already exists
  coeDocumentUrl?: string; // Already exists
  adminNotes?: string;
}

/**
 * ⭐ MAIN: Create loan request with semi-monthly schedule
 * MODIFIED: Now accepts idDocumentUrl and coeDocumentUrl
 */
export async function requestLoan(
  amount: number,
  purpose: string,
  termsMonths: number,
  guarantorId?: string,
  paymentSchedule: string = "15-30",
  idDocumentUrl?: string, // ⭐ NEW PARAMETER
  coeDocumentUrl?: string  // ⭐ NEW PARAMETER
): Promise<void> {

    console.log("🚀 requestLoan() CALLED", {
    amount,
    purpose,
    termsMonths,
    guarantorId,
    paymentSchedule,
  });
  // ============================
// 🛡 LEGAL LIMIT ENFORCEMENT
// ============================
const MAX_TERMS_MONTHS = 10;

const safeTermsMonths = Math.min(
  Math.max(Number(termsMonths), 1),
  MAX_TERMS_MONTHS
);

if (safeTermsMonths !== termsMonths) {
  console.warn(`⚠️ Terms clamped from ${termsMonths} to ${safeTermsMonths}`);
}

  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated.");

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  let firstDueDate: Date;

  if (currentDay <= 15) {
    firstDueDate = new Date(year, month, 15);
  } else {
    firstDueDate = new Date(year, month, lastDayOfMonth);
  }

 const paymentCount = safeTermsMonths * 2;

  await addDoc(collection(db, "loanRequests"), {
    userId: user.uid,
    amount,
    purpose,
    termsMonths: safeTermsMonths,
    guarantorId,
    paymentSchedule,
    paymentCount,
    nextDueDate: firstDueDate,
    status: "pending",
    requestedAt: serverTimestamp(),
    idDocumentUrl: idDocumentUrl || null, // ⭐ STORE THE URL
    coeDocumentUrl: coeDocumentUrl || null, // ⭐ STORE THE URL
  });

  console.log("📌 LOAN REQUEST CREATED:", {
    user: user.uid,
    amount,
    termsMonths: safeTermsMonths,
    paymentSchedule,
    paymentCount,
    firstDueDate: firstDueDate.toLocaleDateString(),
    idDocumentUrl,
    coeDocumentUrl,
  });
}

/**
 * Get loan limit of the user
 */
export async function getUserLoanLimit(userId: string): Promise<number> {
  try {
    const userDocRef = doc(db, 'users', userId);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      return userData?.loanLimit || 0;
    } else {
      console.warn(`⚠️ User not found for loan limit: ${userId}`);
      return 0;
    }

  } catch (error) {
    console.error("❌ Error fetching user loan limit:", error);
    throw error;
  }
}
/**
 * Get user's active approved loan
 */
export async function getUsersActiveLoan(userId: string) {
  const q = query(
    collection(db, "loanRequests"),
    where("userId", "==", userId),
    where("status", "==", "approved")
  );
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() as LoanRequest };
}

/**
 * Get loans where this user is guarantor
 */
export async function getGuaranteedLoansByGuarantor(guarantorId: string) {
  const q = query(
    collection(db, "loanRequests"),
    where("guarantorId", "==", guarantorId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() as LoanRequest }));
}

/**
 * Get approved members that can guarantee
 * @param requesterUid - UID of the requester
 * @param includeSelf - allow requester to appear as guarantor (member only)
 */
export async function getPotentialGuarantors(
  requesterUid: string,
  includeSelf: boolean = false
): Promise<UserProfile[]> {

  const qApproved = query(
    collection(db, "users"),
    where("status", "==", "approved"),
    where("role", "==", "member")
  );

  const snap = await getDocs(qApproved);

  return snap.docs
    .map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        uid: doc.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
      } as UserProfile;
    })
    .filter(u => includeSelf || u.uid !== requesterUid);
}

// --------------------------------------------------------
// 🔥 UNIFIED ActiveLoan Type (COVERS BOTH COLLECTIONS)
// --------------------------------------------------------
import type { Timestamp } from "firebase/firestore";

// --------------------------------------------------------
// 🔄 FLEXIBLE ActiveLoan Type (MATCHES FIRESTORE STRUCTURE)
// --------------------------------------------------------
export interface ActiveLoan {
  id: string;                   // doc id
  userId: string;               // borrower uid
  guarantorId?: string;         // optional
  principal?: number;        // ✅ NEW
  amountBorrowed?: number;      // legacy field
  amount?: number;              // newer field
  remainingBalance?: number;    // updated during repayments
  nextDueDate?: Date | string | any; // Timestamp from Firestore
  paymentSchedule?: string;     // "15-30" or "monthly", etc.
  status?: "active" | "completed" | "paid" | "overdue";
  createdAt?: any;
  updatedAt?: any;
  // Allow extra Firestore fields without errors
  [key: string]: any;
}

/** 
 * Fetch ALL active loans for admin 
 */
// ================================
// 🔐 ADMIN: Get ALL Active Loans
// ================================
export async function getAllActiveLoans() {
  try {
    const ref = collection(db, "activeLoans");

    // Admin should get ALL active loans
    const q = query(ref, where("status", "==", "active"));

    const snap = await getDocs(q);

const loans = snap.docs.map(doc => {
  const data = doc.data();

  const principal =
    data.principal ??
    data.amountBorrowed ??
    data.amount ??
    0;

  return {
    id: doc.id,
    userId: data.userId,
    guarantorId: data.guarantorId ?? null,
    principal, // ✅ unified original amount
    remainingBalance: data.remainingBalance ?? 0,
    nextDueDate: data.nextDueDate ?? null,
    status: data.status ?? "active"
  };
});

    console.log("📌 ADMIN ACTIVE LOANS:", loans);
    return loans;

  } catch (err) {
    console.error("❌ ADMIN getAllActiveLoans ERROR:", err);
    return [];
  }
}

/**
 * ⭐ Record a repayment - FULLY ATOMIC
 * - Logs payment
 * - Updates loan balance
 * - Updates borrower loanBalance
 * - Updates coop funds
 */
export async function recordRepayment(
  loanId: string,
  userId: string,
  amount: number,
) {
  const loanRef = doc(db, "activeLoans", loanId);
  const userRef = doc(db, "users", userId);
  const summaryRef = doc(db, "coopFinancialSummary", "current_state");

  // 1️⃣ Log to loan repayments
  await addDoc(collection(db, "activeLoans", loanId, "repayments"), {
    amount,
    date: serverTimestamp(),
    loanId,
    userId
  });

  // 2️⃣ Update Loan Balance
  const loanSnap = await getDoc(loanRef);
  const loanData = loanSnap.data();
  const newBalance = (loanData?.remainingBalance ?? loanData?.amount) - amount;

  await updateDoc(loanRef, {
    remainingBalance: newBalance,
    status: newBalance <= 0 ? "completed" : "active",
    lastPaymentAt: serverTimestamp(),
  });

  // 3️⃣ Update Borrower Profile
  await updateDoc(userRef, {
    loanBalance: increment(-amount)
  });

  // 4️⃣ Update Cooperative Funds Summary
  await updateDoc(summaryRef, {
    totalLoanedAmount: increment(-amount),
    totalLendableFunds: increment(amount),
    lastUpdated: serverTimestamp()
  });

  console.log(`💸 Repayment Recorded: ₱${amount.toLocaleString()} by ${userId}`);
}

/**
 * 📌 Get repayment history for a loan
 */
export async function getLoanRepayments(loanId: string) {
  const ref = collection(db, "activeLoans", loanId, "repayments");
  const snap = await getDocs(ref);
  
  return snap.docs.map(r => ({
    id: r.id,
    ...r.data()
  }));
}

// --------------------------------------------------------
// ⭐ MEMBER DASHBOARD: Get active loan for current member
// --------------------------------------------------------
export async function getActiveLoanForMember(userId: string): Promise<ActiveLoan | null> {
  const q = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    where("status", "==", "active")
  );

const snap = await getDocs(q);

return snap.empty
  ? null
  : {
      ...(snap.docs[0].data() as ActiveLoan),
      id: snap.docs[0].id
    };
  }


export async function getLoanRequestForMember(userId: string): Promise<ActiveLoan | null> {
  const q = query(
    collection(db, "loanRequests"),
    where("userId", "==", userId),
    where("status", "==", "pending")
  );

const snapshot = await getDocs(q);

return snapshot.empty
  ? null
  : {
      ...(snapshot.docs[0].data() as ActiveLoan),
      id: snapshot.docs[0].id
    };
  }

// =====================================================
// Get LATEST loan for member (active OR completed)
// =====================================================
export async function getLatestLoanForMember(userId: string) {
  const q = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  const snap = await getDocs(q);

  if (snap.empty) return null;

  const docSnap = snap.docs[0];

  return {
    id: docSnap.id,
    ...(docSnap.data() as any),
  };
}

// ===============================
// 💸 RECORD LOAN REPAYMENT
// ===============================
export async function recordLoanRepayment(
  loanId: string,
  amount: number,
  paymentMethod: string = "cash"
) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("User not authenticated.");

  const repaymentData = {
    loanId,
    userId: user.uid,
    amount,
    paymentMethod,
    paidAt: serverTimestamp(),
  };

  await addDoc(collection(db, "loanPayments"), repaymentData);

  console.log("📌 Loan repayment recorded:", repaymentData);
  return repaymentData;
}
export function formatDueDate(date: any): string {
  if (!date) return "N/A";
  if (date.toDate) return date.toDate().toLocaleDateString(); // Timestamp (Firestore)
  if (date instanceof Date) return date.toLocaleDateString(); // JS Date
  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? "N/A" : parsed.toLocaleDateString();
}
export async function getActiveGuaranteedLoansByGuarantor(
  guarantorId: string
): Promise<ActiveLoan[]> {

  const q = query(
    collection(db, "activeLoans"),
    where("guarantorId", "==", guarantorId),
    where("status", "==", "active")
  );

  const snap = await getDocs(q);

  return snap.docs.map(d => ({
    ...(d.data() as ActiveLoan),
    id: d.id,
  }));
}

// ===============================
// 📜 Get repayment history of loan
// ===============================
export async function getLoanRepaymentHistory(
  loanId: string
): Promise<LoanRepayment[]> {

  const ref = collection(db, "activeLoans", loanId, "repayments");
  const snap = await getDocs(ref);

  return snap.docs.map(r => ({
    id: r.id,
    ...(r.data() as Omit<LoanRepayment, "id">)
  }));
}

// ===============================
// 📜 Get share payment history of member
// ===============================
export async function getMemberSharePayments(userId: string) {
  const q = query(
    collection(db, "payments"),
    where("userId", "==", userId)
  );

  const snap = await getDocs(q);

  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
  }));
}

// =======================================================
// ✅ ADMIN: APPROVE LOAN + CREATE SCHEDULE (ATOMIC)
// =======================================================
export async function approveLoanAndCreateSchedule(params: {
  loanRequestId: string;
  approvedBy: string;
}) {
  const { loanRequestId, approvedBy } = params;

  const reqRef = doc(db, "loanRequests", loanRequestId);

  await runTransaction(db, async (tx) => {

    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error("Loan request not found");

    const req = reqSnap.data();

    if (req.status !== "pending") throw new Error("Loan already processed");

const borrowerId = req.userId;
const principal = Number(req.amount);
const guarantorId = req.guarantorId ?? null;
const paymentSchedule = req.paymentSchedule ?? "15-30";

// ============================
// 🛡 LEGAL LIMIT ENFORCEMENT
// ============================
const MAX_TERMS_MONTHS = 10;
const MONTHLY_INTEREST_RATE = 0.10;

const rawTermsMonths = Number(req.termsMonths);

if (!Number.isFinite(rawTermsMonths) || rawTermsMonths <= 0) {
  throw new Error("Invalid repayment terms.");
}

if (rawTermsMonths > MAX_TERMS_MONTHS) {
  throw new Error(
    `Repayment terms exceed legal maximum of ${MAX_TERMS_MONTHS} months.`
  );
}

const termsMonths = rawTermsMonths;
const monthlyInterestRate = MONTHLY_INTEREST_RATE;

// ----------------------------
// 🧮 Interest Calculation
// ----------------------------
const computedInterest = principal * monthlyInterestRate * termsMonths;

// 🔒 Absolute cap: interest cannot exceed 100% of principal
const totalInterest = Math.min(computedInterest, principal);

const totalPayable = principal + totalInterest;

    const installmentCount =
      paymentSchedule === "15-30"
        ? termsMonths * 2
        : termsMonths;

    const principalPer = principal / installmentCount;
    const interestPer = totalInterest / installmentCount;

    // ---------- Create Active Loan ----------
    const loanRef = doc(collection(db, "activeLoans"));

    tx.set(loanRef, {
      userId: borrowerId,
      guarantorId,
      principal,
      remainingBalance: principal,
      monthlyInterestRate,
      termsMonths,
      paymentSchedule,
      totalInterest,
      totalPayable,
      status: "active",
      createdAt: serverTimestamp(),
      nextDueDate: req.nextDueDate,
    });

    // ---------- Create Schedule ----------
    let due = req.nextDueDate.toDate ? req.nextDueDate.toDate() : new Date(req.nextDueDate);

    for (let i = 0; i < installmentCount; i++) {

      const schedRef = doc(collection(db, "activeLoans", loanRef.id, "schedule"));

      tx.set(schedRef, {
        installmentNo: i + 1,
        principalDue: Number(principalPer.toFixed(2)),
        interestDue: Number(interestPer.toFixed(2)),
        dueDate: due,
        paid: false,
      });

      // advance due date
      if (paymentSchedule === "15-30") {
        const d = new Date(due);
        if (d.getDate() <= 15) {
          due = new Date(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
        } else {
          due = new Date(d.getFullYear(), d.getMonth() + 1, 15);
        }
      } else {
        due = new Date(due.getFullYear(), due.getMonth() + 1, due.getDate());
      }
    }

    // ---------- Update Borrower ----------
    const userRef = doc(db, "users", borrowerId);

    tx.update(userRef, {
      loanBalance: increment(principal),
    });

    // ---------- Update Coop ----------
    const coopRef = doc(db, "coopFinancialSummary", "current_state");

    tx.update(coopRef, {
      totalLoanedAmount: increment(principal),
      totalLendableFunds: increment(-principal),
      lastUpdated: serverTimestamp(),
    });

    // ---------- Update Request ----------
    tx.update(reqRef, {
      status: "approved",
      approvedAt: serverTimestamp(),
      approvedBy,
      activeLoanId: loanRef.id,
    });
  });

  console.log("✅ Loan approved and schedule created");
}

/**
 * 🔐 ADMIN — Correct Loan Payment Schedule
 * - Locks paid & partial installments
 * - Voids unpaid future installments
 * - Regenerates correct schedule
 * - Does NOT touch balances or coop funds
 */
export async function adminCorrectLoanSchedule(params: {
  loanId: string;
  newPaymentSchedule: "15-30" | "monthly";
  adminId: string;
  reason: string;
}) {
  const { loanId, newPaymentSchedule, adminId, reason } = params;

  if (!reason.trim()) {
    throw new Error("Correction reason is required.");
  }

  const loanRef = doc(db, "activeLoans", loanId);
  const scheduleRef = collection(db, "activeLoans", loanId, "schedule");

  await runTransaction(db, async (tx) => {
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error("Loan not found");

    const loan = loanSnap.data();

    if (loan.status === "completed") {
      throw new Error("Completed loans cannot be corrected.");
    }

    if (loan.paymentSchedule === newPaymentSchedule) {
      throw new Error("Payment schedule is already correct.");
    }

    const schedSnap = await getDocs(scheduleRef);

    const lockedSchedules: any[] = [];
    const adjustableSchedules: any[] = [];

    schedSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.paid || d.partial) {
        lockedSchedules.push({ id: docSnap.id, ...d });
      } else {
        adjustableSchedules.push({ id: docSnap.id, ...d });
      }
    });

    if (!adjustableSchedules.length) {
      throw new Error("No future installments to correct.");
    }

    // 🔒 VOID incorrect future schedules (do NOT delete)
    for (const s of adjustableSchedules) {
      const ref = doc(scheduleRef, s.id);
      tx.update(ref, {
        status: "voided",
        voidedAt: serverTimestamp(),
        voidedBy: adminId,
        voidedReason: reason,
      });
    }

    // 🔢 Determine remaining balance
    const remainingBalance = Number(loan.remainingBalance ?? 0);
    if (remainingBalance <= 0) return;

    const termsMonths = Number(loan.termsMonths ?? 0);
    const completedInstallments = lockedSchedules.length;

    const originalInstallments =
      loan.paymentSchedule === "15-30"
        ? termsMonths * 2
        : termsMonths;

    const remainingInstallments =
      originalInstallments - completedInstallments;

    if (remainingInstallments <= 0) return;

    const newInstallmentCount =
      newPaymentSchedule === "15-30"
        ? Math.ceil(remainingInstallments * 2)
        : Math.ceil(remainingInstallments / 2);

    const principalPer = Number(
      (remainingBalance / newInstallmentCount).toFixed(2)
    );

    const interestPer = Number(
      ((loan.totalInterest ?? 0) / originalInstallments).toFixed(2)
    );

    // 🕒 Determine starting due date
    let lastDueDate: Date | null = null;

    if (lockedSchedules.length) {
      const last = lockedSchedules
        .map(s => s.dueDate?.toDate?.() ?? new Date(s.dueDate))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      lastDueDate = last;
    }

    let due = lastDueDate ? new Date(lastDueDate) : new Date();

    // 🔁 Generate corrected schedule
    for (let i = 0; i < newInstallmentCount; i++) {
      const ref = doc(scheduleRef);

      if (newPaymentSchedule === "15-30") {
        const d = due.getDate();
        if (d <= 15) {
          due = new Date(due.getFullYear(), due.getMonth(),
            new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate());
        } else {
          due = new Date(due.getFullYear(), due.getMonth() + 1, 15);
        }
      } else {
        due = new Date(due.getFullYear(), due.getMonth() + 1, due.getDate());
      }

      tx.set(ref, {
        installmentNo: completedInstallments + i + 1,
        principalDue: principalPer,
        interestDue: interestPer,
        remainingDue: principalPer + interestPer,
        dueDate: due,
        paid: false,
        createdAt: serverTimestamp(),
        generatedBy: "admin_correction",
      });
    }

    // 📌 Update loan metadata ONLY
    tx.update(loanRef, {
      paymentSchedule: newPaymentSchedule,
      updatedAt: serverTimestamp(),
      correctedBy: adminId,
      correctionReason: reason,
    });
  });

  console.log("✅ Loan schedule corrected safely");
}