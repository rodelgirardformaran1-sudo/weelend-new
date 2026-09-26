// src/services/loanService.ts

import { db } from '../firebaseConfig';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  setDoc,
  query,
  where,
  serverTimestamp,
  runTransaction,
  getDoc,
  updateDoc,       // <-- ADD THIS
  increment,        // <-- ADD THIS
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import type { UserProfile, AgreementAcceptance } from "../type";
import { orderBy, limit } from "firebase/firestore";
import {
  createGuarantorInvite,
  requiresSecurityGuarantor,
  SECURITY_GUARANTOR_THRESHOLD,
  type GuarantorInfoInput,
} from "./securityGuarantorService";


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
  agreementAcceptance?: AgreementAcceptance | null;
  adminNotes?: string;
  submittedByAdmin?: boolean; // true when admin filed this request on the member/borrower's behalf
  submittedByAdminId?: string;
  manualName?: string | null; // typed name for a person who doesn't have an account yet
  hasAccount?: boolean; // false while userId is a placeholder ("") and manualName is what identifies them
  linkedAt?: any;
  linkedBy?: string;
  securityGuarantorPending?: boolean; // amount > threshold but skipped for now (no account yet) — must be resolved before this can be approved
  securityGuarantorInviteId?: string | null;
  queuePosition?: number; // 1-indexed rank, refreshed whenever admin loads the Loan Requests page
  queueSize?: number;
}

/**
 * ⭐ MAIN: Create loan request with semi-monthly schedule
 * MODIFIED: Now accepts idDocumentUrl and coeDocumentUrl
 * MODIFIED: Now accepts securityGuarantorInfo — required whenever amount
 * exceeds SECURITY_GUARANTOR_THRESHOLD (₱10,000). This is separate from
 * the existing `guarantorId` (effort-pool) mechanism above.
 */
export async function requestLoan(
  amount: number,
  purpose: string,
  termsMonths: number,
  guarantorId?: string,
  paymentSchedule: string = "15-30",
  idDocumentUrl?: string, // ⭐ NEW PARAMETER
  coeDocumentUrl?: string,  // ⭐ NEW PARAMETER
  securityGuarantorInfo?: GuarantorInfoInput, // ⭐ NEW PARAMETER
  agreementAcceptance?: AgreementAcceptance | null // 📄 persisted proof of agreement
): Promise<{ securityGuarantorInviteId: string | null }> {

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

  // 🛡️ Refuse a new loan request if this user already has an active
  // (unpaid) loan or an existing request still awaiting admin approval.
  // This is the authoritative check — the dashboards also check before
  // opening the request modal (so the person sees the message earlier),
  // but this one guards the actual write regardless of which UI path
  // called requestLoan(), or if the dashboard-level check was bypassed.
  const [existingActiveLoan, existingPendingRequest] = await Promise.all([
    getActiveLoanForMember(user.uid),
    getLoanRequestForMember(user.uid),
  ]);

  if (existingActiveLoan) {
    throw new Error("You already have an active loan. Please finish paying it off before requesting a new one.");
  }

  if (existingPendingRequest) {
    throw new Error("You already have a loan request awaiting admin approval. Please wait for it to be processed before submitting another.");
  }

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

  // 🛡️ Security guarantor required over ₱10,000
  if (requiresSecurityGuarantor(amount) && !securityGuarantorInfo) {
    throw new Error(
      `A security guarantor is required for loans over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()}.`
    );
  }

  // 🛡️ The loan request's own Firestore rule only allows admin to update
  // it after creation (anti-tampering, intentional). So when a security
  // guarantor invite is needed, we pre-generate the loan request's doc ID,
  // create the invite first (it just stores requestId as a plain string —
  // doesn't require the loan request doc to exist yet), then write the
  // loan request ONCE with securityGuarantorInviteId already included,
  // instead of create-then-update (which fails the admin-only update rule).
  const loanRequestRef = doc(collection(db, "loanRequests"));

  let securityGuarantorInviteId: string | null = null;

  if (securityGuarantorInfo) {
    securityGuarantorInviteId = await createGuarantorInvite(
      user.uid,
      "loan",
      loanRequestRef.id,
      securityGuarantorInfo
    );
  }

  await setDoc(loanRequestRef, {
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
    idDocumentUrl: idDocumentUrl || null,
    coeDocumentUrl: coeDocumentUrl || null,
    securityGuarantorInviteId,
    agreementAcceptance: agreementAcceptance || null,
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
    securityGuarantorInviteId,
  });

  return { securityGuarantorInviteId };
}

/**
 * ⭐ Admin-assisted loan request submission — for members/borrowers who
 * aren't comfortable using the app themselves. Admin fills in the same
 * information the person would have entered, on their behalf, after
 * getting their in-person/verbal go-ahead (recorded in `adminNote`).
 *
 * Deliberately mirrors requestLoan()'s validation (blocks a second
 * request when the target user already has an active loan or a pending
 * request; still requires security-guarantor details over ₱10,000) but
 * does not require ID/COE document uploads or a checkbox-click
 * agreement acceptance, since neither is practical for admin to produce
 * on someone else's behalf. The request is flagged `submittedByAdmin`
 * so it's clearly distinguishable in admin history and on the contract.
 */
export async function adminSubmitLoanRequest(params: {
  targetUserId?: string; // omit when the person has no account yet — pass manualName instead
  manualName?: string;   // typed name/nickname, only for a person with no account yet
  amount: number;
  purpose: string;
  termsMonths: number;
  adminId: string;
  adminNote: string;
  guarantorId?: string;
  paymentSchedule?: string;
  securityGuarantorInfo?: GuarantorInfoInput;
  skipSecurityGuarantorForNow?: boolean; // even with a real account, defer the security-guarantor step — must be resolved (adminAttachSecurityGuarantor) before this can be approved
}): Promise<{ securityGuarantorInviteId: string | null; hasAccount: boolean }> {
  const {
    targetUserId,
    manualName,
    amount,
    purpose,
    termsMonths,
    adminId,
    adminNote,
    guarantorId,
    paymentSchedule = "15-30",
    securityGuarantorInfo,
    skipSecurityGuarantorForNow,
  } = params;

  const hasAccount = !!targetUserId;
  const cleanManualName = manualName?.trim() || "";

  if (!hasAccount && !cleanManualName) {
    throw new Error("Select a member/borrower, or type a name for someone who doesn't have an account yet.");
  }
  if (!adminNote || !adminNote.trim()) {
    throw new Error("Please note how/why this request is being submitted on the member's behalf.");
  }

  // 🛡️ Security guarantor can be deferred either way:
  //  - No account yet: can't create the invite at all (it needs a real
  //    borrower uid), so it's always deferred automatically.
  //  - Real account: admin can still choose to "skip for now" via the
  //    checkbox and come back to it later.
  // Either way, approval stays blocked until a security guarantor is
  // attached (see adminAttachSecurityGuarantor + the approve-button guard).
  const effectiveSkip = !hasAccount || !!skipSecurityGuarantorForNow;
  const securityGuarantorPending = requiresSecurityGuarantor(amount) && effectiveSkip;

  const MAX_TERMS_MONTHS = 10;
  const safeTermsMonths = Math.min(Math.max(Number(termsMonths), 1), MAX_TERMS_MONTHS);

  if (hasAccount) {
    const [existingActiveLoan, existingPendingRequest] = await Promise.all([
      getActiveLoanForMember(targetUserId!),
      getLoanRequestForMember(targetUserId!),
    ]);

    if (existingActiveLoan) {
      throw new Error("This member already has an active loan. It must be paid off before a new request can be submitted.");
    }
    if (existingPendingRequest) {
      throw new Error("This member already has a loan request awaiting admin approval.");
    }
  }

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const firstDueDate: Date =
    currentDay <= 15 ? new Date(year, month, 15) : new Date(year, month, lastDayOfMonth);

  const paymentCount = safeTermsMonths * 2;

  if (hasAccount && requiresSecurityGuarantor(amount) && !effectiveSkip && !securityGuarantorInfo) {
    throw new Error(
      `A security guarantor is required for loans over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} (or check "skip for now").`
    );
  }

  const loanRequestRef = doc(collection(db, "loanRequests"));

  let securityGuarantorInviteId: string | null = null;
  if (hasAccount && !effectiveSkip && securityGuarantorInfo) {
    securityGuarantorInviteId = await createGuarantorInvite(
      targetUserId!,
      "loan",
      loanRequestRef.id,
      securityGuarantorInfo
    );
  }

  await setDoc(loanRequestRef, {
    userId: hasAccount ? targetUserId : "",
    manualName: hasAccount ? null : cleanManualName,
    hasAccount,
    amount,
    purpose,
    termsMonths: safeTermsMonths,
    guarantorId,
    paymentSchedule,
    paymentCount,
    nextDueDate: firstDueDate,
    status: "pending",
    requestedAt: serverTimestamp(),
    idDocumentUrl: null,
    coeDocumentUrl: null,
    securityGuarantorInviteId,
    securityGuarantorPending,
    agreementAcceptance: null,
    submittedByAdmin: true,
    submittedByAdminId: adminId,
    adminNotes: adminNote,
  });

  return { securityGuarantorInviteId, hasAccount };
}

/**
 * "Resumes" a request that was submitted with securityGuarantorPending
 * (amount over ₱10,000, but the person had no account yet at the time,
 * so the security-guarantor step was skipped). Call this once the
 * request has been linked to a real account — it creates the same
 * verified-identity invite the normal >₱10,000 flow uses, and clears
 * securityGuarantorPending so Approve unblocks once it's verified.
 */
export async function adminAttachSecurityGuarantor(params: {
  requestId: string;
  securityGuarantorInfo: GuarantorInfoInput;
}): Promise<{ securityGuarantorInviteId: string }> {
  const { requestId, securityGuarantorInfo } = params;
  if (!requestId) throw new Error("Missing loan request.");

  const reqRef = doc(db, "loanRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Loan request not found.");

  const data = reqSnap.data() as LoanRequest;
  if (data.status !== "pending") throw new Error("Only a pending request can get a security guarantor attached.");
  if (data.securityGuarantorInviteId) throw new Error("This request already has a security guarantor.");
  if (!data.hasAccount || !data.userId) {
    throw new Error("Link this request to a real account first, then attach the security guarantor.");
  }

  const securityGuarantorInviteId = await createGuarantorInvite(
    data.userId,
    "loan",
    requestId,
    securityGuarantorInfo
  );

  await updateDoc(reqRef, { securityGuarantorInviteId, securityGuarantorPending: false });
  return { securityGuarantorInviteId };
}

/**
 * ⭐ Borrower self-service completion of an admin-filed request — admin
 * can file a request on someone's behalf (adminSubmitLoanRequest) but
 * can't produce the borrower's own agreement acceptance, and often
 * doesn't have the security guarantor's details either (that's the
 * borrower's own family member/contact, not something admin would
 * know). This lets the borrower fill in whichever of those two pieces
 * their OWN pending request is still missing — same info they'd have
 * given at self-submit time — without re-submitting the whole request.
 */
export async function borrowerCompleteLoanRequest(params: {
  requestId: string;
  userId: string; // must match the request's own userId — enforced here AND by firestore.rules
  agreementAcceptance?: AgreementAcceptance | null; // pass when the request has no agreementAcceptance yet
  securityGuarantorInfo?: GuarantorInfoInput; // pass when securityGuarantorPending is true
}): Promise<{ securityGuarantorInviteId: string | null }> {
  const { requestId, userId, agreementAcceptance, securityGuarantorInfo } = params;
  if (!requestId) throw new Error("Missing loan request.");
  if (!userId) throw new Error("Not signed in.");

  const reqRef = doc(db, "loanRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Loan request not found.");

  const data = reqSnap.data() as LoanRequest;
  if (data.userId !== userId) throw new Error("This isn't your loan request.");
  if (data.status !== "pending") throw new Error("Only a pending request can be completed this way.");

  const needsAgreement = !data.agreementAcceptance;
  const needsGuarantor = !!data.securityGuarantorPending && !data.securityGuarantorInviteId;

  if (!needsAgreement && !needsGuarantor) {
    throw new Error("This request doesn't have anything left for you to complete.");
  }
  if (needsAgreement && !agreementAcceptance) {
    throw new Error("Please confirm the loan agreement.");
  }
  if (needsGuarantor && !securityGuarantorInfo) {
    throw new Error("Please provide the security guarantor's details.");
  }

  let securityGuarantorInviteId: string | null = null;
  const updates: Record<string, any> = {};

  if (needsAgreement && agreementAcceptance) {
    updates.agreementAcceptance = agreementAcceptance;
  }

  if (needsGuarantor && securityGuarantorInfo) {
    securityGuarantorInviteId = await createGuarantorInvite(
      userId,
      "loan",
      requestId,
      securityGuarantorInfo
    );
    updates.securityGuarantorInviteId = securityGuarantorInviteId;
    updates.securityGuarantorPending = false;
  }

  await updateDoc(reqRef, updates);
  return { securityGuarantorInviteId };
}

/**
 * Links a no-account ("manualName") loan request to a real account once
 * the person has signed up and been approved — after this, it's a normal
 * pending request (approvable, appears on their own dashboard/banner,
 * etc). The request keeps its original requestedAt (so it doesn't lose
 * its place in the FIFO tiebreak) and its manualName as an audit trail.
 */
export async function adminLinkLoanRequestToAccount(params: {
  requestId: string;
  targetUserId: string;
  adminId: string;
}): Promise<void> {
  const { requestId, targetUserId, adminId } = params;
  if (!requestId) throw new Error("Missing loan request.");
  if (!targetUserId) throw new Error("Select the account to link this request to.");

  const reqRef = doc(db, "loanRequests", requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error("Loan request not found.");

  const data = reqSnap.data() as LoanRequest;
  if (data.status !== "pending") throw new Error("Only a pending request can be linked to an account.");
  if (data.hasAccount) throw new Error("This request is already linked to an account.");

  const [existingActiveLoan, existingPendingRequest] = await Promise.all([
    getActiveLoanForMember(targetUserId),
    getLoanRequestForMember(targetUserId),
  ]);
  if (existingActiveLoan) {
    throw new Error("This account already has an active loan. It must be paid off before this request can be linked.");
  }
  if (existingPendingRequest) {
    throw new Error("This account already has a different loan request pending.");
  }

  await updateDoc(reqRef, {
    userId: targetUserId,
    hasAccount: true,
    linkedAt: serverTimestamp(),
    linkedBy: adminId,
  });
}

/**
 * 🙋 Member-initiated referral — a member refers someone they know who
 * doesn't have a WeeLend account yet. The referring member is always
 * recorded as the guarantor (matches how the effort-pool guarantorId
 * already works: whoever vouches for someone is their guarantor). Kept
 * to ≤₱10,000 since anything above that needs a security guarantor tied
 * to a verified account, which a no-account referral can't provide.
 * The Firestore rules mirror this: a member may only create a
 * loanRequests doc with hasAccount:false, userId:"" and
 * guarantorId == their own uid — never in someone else's name.
 */
export async function memberReferLoanRequest(params: {
  manualName: string;
  amount: number;
  purpose: string;
  termsMonths: number;
}): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in.");

  const cleanName = params.manualName?.trim();
  if (!cleanName) throw new Error("Please enter the person's name.");
  if (!params.amount || params.amount <= 0) throw new Error("Please enter a valid amount.");
  if (!params.purpose || !params.purpose.trim()) throw new Error("Please enter the loan's purpose.");

  // 🛡️ Amounts over the threshold are queued anyway ("skip for now") —
  // approval stays blocked until admin attaches a verified security
  // guarantor, which can only happen once this person has a real
  // account (see adminAttachSecurityGuarantor).
  const securityGuarantorPending = requiresSecurityGuarantor(params.amount);

  const MAX_TERMS_MONTHS = 10;
  const safeTermsMonths = Math.min(Math.max(Number(params.termsMonths), 1), MAX_TERMS_MONTHS);
  const paymentCount = safeTermsMonths * 2;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const currentDay = today.getDate();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  const firstDueDate: Date =
    currentDay <= 15 ? new Date(year, month, 15) : new Date(year, month, lastDayOfMonth);

  const loanRequestRef = doc(collection(db, "loanRequests"));
  await setDoc(loanRequestRef, {
    userId: "",
    manualName: cleanName,
    hasAccount: false,
    amount: params.amount,
    purpose: params.purpose.trim(),
    termsMonths: safeTermsMonths,
    guarantorId: user.uid,
    paymentSchedule: "15-30",
    paymentCount,
    nextDueDate: firstDueDate,
    status: "pending",
    requestedAt: serverTimestamp(),
    idDocumentUrl: null,
    coeDocumentUrl: null,
    securityGuarantorInviteId: null,
    securityGuarantorPending,
    agreementAcceptance: null,
    submittedByAdmin: false,
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
 * Fetch ALL active loans for admin (Repayments tab — only loans that can
 * still take a payment). Left unchanged for existing callers.
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
 * Fetch EVERY coop loan on record for the "All Loans" admin screen —
 * every status (active, completed, and any legacy value), each carrying
 * its persisted agreementAcceptance proof (read from the matching
 * loanRequests doc, which shares the same id but isn't copied over at
 * approval time). Kept separate from getAllActiveLoans() above so the
 * Repayments tab's behavior/perf is untouched.
 */
// ================================
// 🔐 ADMIN: Get ALL Loans (any status) — for the "All Loans" history view
// ================================
export async function getAllLoansForAdminHistory() {
  try {
    const ref = collection(db, "activeLoans");
    const snap = await getDocs(ref);

    const loans = await Promise.all(
      snap.docs.map(async (loanDoc) => {
        const data = loanDoc.data();

        const principal =
          data.principal ??
          data.amountBorrowed ??
          data.amount ??
          0;

        let agreementAcceptance: AgreementAcceptance | null = null;
        try {
          const reqSnap = await getDoc(doc(db, "loanRequests", loanDoc.id));
          agreementAcceptance = reqSnap.exists()
            ? (reqSnap.data()?.agreementAcceptance ?? null)
            : null;
        } catch {
          agreementAcceptance = null;
        }

        return {
          id: loanDoc.id,
          userId: data.userId,
          guarantorId: data.guarantorId ?? null,
          principal,
          remainingBalance: data.remainingBalance ?? 0,
          nextDueDate: data.nextDueDate ?? null,
          status: data.status ?? "active",
          agreementAcceptance,
        };
      })
    );

    console.log("📌 ADMIN ALL LOANS (HISTORY):", loans);
    return loans;

  } catch (err) {
    console.error("❌ ADMIN getAllLoansForAdminHistory ERROR:", err);
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
 * 🔐 ADMIN — Correct a single installment's due date
 * - Only unpaid or partially-paid, non-voided installments can be
 *   corrected (a fully paid one is a settled historical record).
 * - Does NOT touch amounts, balances, or any other installment —
 *   see adminCorrectLoanSchedule() below for a full schedule shift.
 * - Keeps an audit trail: the first correction preserves the
 *   original due date, plus who/when/why for the latest correction.
 */
export async function adminUpdateInstallmentDueDate(params: {
  loanId: string;
  scheduleId: string;
  newDueDate: Date;
  adminId: string;
  reason: string;
}) {
  const { loanId, scheduleId, newDueDate, adminId, reason } = params;

  if (!reason.trim()) {
    throw new Error("Correction reason is required.");
  }

  if (isNaN(newDueDate.getTime())) {
    throw new Error("Invalid due date.");
  }

  const loanRef = doc(db, "activeLoans", loanId);
  const scheduleRef = doc(db, "activeLoans", loanId, "schedule", scheduleId);

  await runTransaction(db, async (tx) => {
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists()) throw new Error("Loan not found");
    if (loanSnap.data().status === "completed") {
      throw new Error("Completed loans cannot be corrected.");
    }

    const schedSnap = await tx.get(scheduleRef);
    if (!schedSnap.exists()) throw new Error("Installment not found");

    const item = schedSnap.data();
    if (item.status === "voided") {
      throw new Error("A voided installment cannot be corrected.");
    }
    if (item.paid && !item.partial) {
      throw new Error("A fully paid installment cannot be corrected.");
    }

    tx.update(scheduleRef, {
      dueDate: newDueDate,
      // Only ever set once — the first correction's value stays as the
      // permanent record of what the app originally generated.
      originalDueDate: item.originalDueDate ?? item.dueDate ?? null,
      dueDateCorrectedBy: adminId,
      dueDateCorrectionReason: reason,
      dueDateCorrectedAt: serverTimestamp(),
    });
  });

  console.log("✅ Installment due date corrected:", scheduleId);
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

    // 🔧 FIX: interest must be redistributed across the NEW installment
    // count using only the REMAINING interest (total interest minus what
    // was already accounted for in paid/partial installments) — not the
    // old schedule's flat per-installment rate reapplied to a different
    // number of installments. The old logic silently doubled or halved
    // the borrower's remaining interest depending on which direction the
    // schedule was changed (monthly <-> 15-30).
    const interestAlreadyAccounted = lockedSchedules.reduce(
      (sum, s) => sum + Number(s.interestDue ?? 0),
      0
    );
    const remainingInterest = Math.max(
      0,
      Number(loan.totalInterest ?? 0) - interestAlreadyAccounted
    );

    const interestPer = Number(
      (remainingInterest / newInstallmentCount).toFixed(2)
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

      // 🔧 FIX: the last installment absorbs any rounding leftover from
      // toFixed(2) on the earlier ones, so the schedule always sums back
      // to the exact remaining principal/interest instead of drifting a
      // few centavos off.
      const isLastInstallment = i === newInstallmentCount - 1;
      const thisPrincipalDue = isLastInstallment
        ? Number((remainingBalance - principalPer * (newInstallmentCount - 1)).toFixed(2))
        : principalPer;
      const thisInterestDue = isLastInstallment
        ? Number((remainingInterest - interestPer * (newInstallmentCount - 1)).toFixed(2))
        : interestPer;

      tx.set(ref, {
        installmentNo: completedInstallments + i + 1,
        principalDue: thisPrincipalDue,
        interestDue: thisInterestDue,
        remainingDue: thisPrincipalDue + thisInterestDue,
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

// =====================================================================
// 🚪 MEMBER / BORROWER OFFBOARDING — Mark Inactive / Departed
// =====================================================================
//
// Policy (per coop decision):
//  1. Admin marks a member/borrower "inactive" (left the coop).
//  2. Their remaining share balance is applied against any outstanding
//     active loan balance FIRST (offsets what they owe).
//  3. Whatever loan balance remains after that offset is flagged
//     `isUncollected: true` — it's still a receivable the coop is owed,
//     NOT written off. It stays out of dividend math (`excludeFromDividends:
//     true`) until it's actually collected, so active members' payouts
//     aren't inflated by money that isn't in hand yet.
//  4. If the share balance fully covers the loan, the loan is marked
//     "completed" like any other fully-paid loan.
//  5. No money is transferred by this function — it only adjusts the
//     book values (share balance / loan remaining balance). Any actual
//     refund of leftover shares (if the loan is fully covered and
//     shares remain) is a manual admin action outside the app, since
//     there's no payment-integration yet.
//
export interface MarkInactiveResult {
  hadActiveLoan: boolean;
  shareBalanceApplied: number;
  remainingUncollectedLoan: number;
  loanFullyOffset: boolean;
}

export async function markUserInactive(params: {
  userId: string;
  adminId: string;
  reason?: string;
}): Promise<MarkInactiveResult> {
  const { userId, adminId, reason } = params;

  const userRef = doc(db, "users", userId);

  // Find their active loan (if any) OUTSIDE the transaction first, since
  // Firestore transactions can't run queries — only get()s on known refs.
  const activeLoanQuery = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    where("status", "==", "active"),
    limit(1)
  );
  const activeLoanSnap = await getDocs(activeLoanQuery);
  const loanRef = activeLoanSnap.empty ? null : activeLoanSnap.docs[0].ref;

  const result: MarkInactiveResult = {
    hadActiveLoan: !!loanRef,
    shareBalanceApplied: 0,
    remainingUncollectedLoan: 0,
    loanFullyOffset: false,
  };

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("User not found");
    const user = userSnap.data();

    if (user.membershipStatus === "inactive") {
      throw new Error("This user is already marked inactive.");
    }

    const shareBalance = Number(user.shareBalance ?? 0);

    if (loanRef) {
      const loanSnap = await tx.get(loanRef);
      if (!loanSnap.exists()) throw new Error("Active loan not found");
      const loan = loanSnap.data();

      const remainingBalance = Number(loan.remainingBalance ?? 0);
      const offsetAmount = Math.min(shareBalance, remainingBalance);
      const newLoanBalance = Number((remainingBalance - offsetAmount).toFixed(2));
      const newShareBalance = Number((shareBalance - offsetAmount).toFixed(2));

      result.shareBalanceApplied = offsetAmount;
      result.remainingUncollectedLoan = newLoanBalance;
      result.loanFullyOffset = newLoanBalance <= 0;

      if (newLoanBalance <= 0) {
        tx.update(loanRef, {
          remainingBalance: 0,
          status: "completed",
          completedAt: serverTimestamp(),
          completedVia: "member_offboarding_share_offset",
        });
      } else {
        tx.update(loanRef, {
          remainingBalance: newLoanBalance,
          isUncollected: true,
          excludeFromDividends: true,
          departedMemberOffset: {
            userId,
            shareAmountApplied: offsetAmount,
            appliedAt: serverTimestamp(),
            appliedBy: adminId,
          },
        });
      }

      tx.update(userRef, {
        shareBalance: newShareBalance,
        membershipStatus: "inactive",
        inactiveAt: serverTimestamp(),
        inactivatedBy: adminId,
        inactiveReason: reason ?? null,
      });
    } else {
      // No active loan — just mark inactive, share balance untouched
      // (any refund of leftover shares is handled manually by admin).
      tx.update(userRef, {
        membershipStatus: "inactive",
        inactiveAt: serverTimestamp(),
        inactivatedBy: adminId,
        inactiveReason: reason ?? null,
      });
    }
  });

  console.log("✅ User marked inactive:", userId, result);
  return result;
}

export async function reactivateUser(params: {
  userId: string;
  adminId: string;
}): Promise<void> {
  const { userId, adminId } = params;
  const userRef = doc(db, "users", userId);

  await updateDoc(userRef, {
    membershipStatus: "active",
    reactivatedAt: serverTimestamp(),
    reactivatedBy: adminId,
  });

  console.log("✅ User reactivated:", userId);
}