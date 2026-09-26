// src/services/adminService.ts

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp,
  increment,
  getDoc,
  setDoc, // NEW: Added setDoc for initializing/creating coop financial summary
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebaseConfig";
import type { UserProfile, AgreementProductType } from "../type";
import { getUserFullName } from "./userUtils";
import { generateLoanContract } from "../utils/generateLoanContract";
import { getInviteForRequest } from "./securityGuarantorService";
import {
  getCoopLoanAgreementPlainText,
  getEasyInstallmentAgreementPlainText,
  getCreditCartAgreementPlainText,
} from "../utils/loanAgreementModal";
import { getFiscalYearStart } from "./fiscalShareSchedule";

// ===========================================================
// 📄 LEGACY AGREEMENT BACKFILL — one-time admin action
// ===========================================================
// Stamps a clearly-labeled retroactive agreementAcceptance record onto
// loanRequests / paSwipeRequests / creditCartRequests that predate the new
// in-app checkbox-gated agreement flow. This is NOT presented as a live
// user confirmation — isLegacyBackfill: true and this version string make
// that explicit, so the record is honest about what it actually is if it's
// ever examined later.
//
// Covers all three products: MLF Easy Installment and Marimar's Credit
// Cart do have real legacy transactions predating their in-app agreement
// (confirmed 2026-09-23), so they're back in scope alongside Coop Loan.
//
// This also "tops up" records that already have an agreementAcceptance but
// are missing the verbatim agreementText field (added after the very first
// run of this backfill, and also possible on early real checkbox
// confirmations captured before that field existed). For a REAL
// confirmation (isLegacyBackfill is not set), the top-up only ever fills
// a missing agreementText — it never touches one that's already there,
// since that's an authentic historical snapshot of what the person saw
// and must never be rewritten.
//
// For an ADMINISTRATIVELY-BACKFILLED record (isLegacyBackfill: true),
// agreementText was never a real historical snapshot to begin with — it
// was always "the current policy wording, applied retroactively." So
// when that current wording changes (e.g. Coop Loan's agreement was
// expanded into a full promissory-note-style document), this re-stamps
// the newer wording onto every legacy-backfilled record whose stored
// text doesn't match it yet, so they don't stay frozen on stale wording
// forever. The rest of the record (version, terms, acceptedAt,
// backfilledBy) is left untouched either way.
export const LEGACY_AGREEMENT_VERSION = "legacy-backfill-2026-09-23";

const RECONSTRUCTED_TEXT_NOTE =
  "⚠️ Reconstructed text: this record predates verbatim-text storage. The wording above is the CURRENT policy text, applied retroactively for reference — it is not necessarily the exact wording shown at the original acceptance.\n\n";

// The text a legacy-backfilled record SHOULD carry right now, given its
// product — every product has its own full, structured agreement now.
function currentReconstructedTextFor(productType: AgreementProductType): string {
  const base =
    productType === "coopLoan"
      ? getCoopLoanAgreementPlainText()
      : productType === "easyInstallment"
      ? getEasyInstallmentAgreementPlainText()
      : getCreditCartAgreementPlainText();
  return RECONSTRUCTED_TEXT_NOTE + base;
}

export interface LegacyBackfillResult {
  loanRequests: number;
  paSwipeRequests: number;
  creditCartRequests: number;
  total: number;
}

export async function backfillLegacyAgreements(adminUid: string): Promise<LegacyBackfillResult> {
  const targets: { name: "loanRequests" | "paSwipeRequests" | "creditCartRequests"; productType: AgreementProductType }[] = [
    { name: "loanRequests", productType: "coopLoan" },
    { name: "paSwipeRequests", productType: "easyInstallment" },
    { name: "creditCartRequests", productType: "creditCart" },
  ];

  const result: LegacyBackfillResult = {
    loanRequests: 0,
    paSwipeRequests: 0,
    creditCartRequests: 0,
    total: 0,
  };

  for (const { name, productType } of targets) {
    const snap = await getDocs(collection(db, name));

    const expectedText = currentReconstructedTextFor(productType);

    const docsMissingRecord = snap.docs.filter((d) => !d.data()?.agreementAcceptance);

    const docsNeedingTextTopUp = snap.docs.filter((d) => {
      const acc = d.data()?.agreementAcceptance;
      if (!acc) return false; // handled by docsMissingRecord above
      if (!acc.agreementText) return true; // never had text at all — fill it
      // Only re-stamp a record that was already an administrative
      // backfill AND whose text is now out of date with current policy.
      // A real user confirmation's agreementText is never touched here.
      return acc.isLegacyBackfill === true && acc.agreementText !== expectedText;
    });

    const docsNeedingWork = [...docsMissingRecord, ...docsNeedingTextTopUp];

    // Firestore batched writes cap at 500 ops — chunk defensively.
    for (let i = 0; i < docsNeedingWork.length; i += 400) {
      const chunk = docsNeedingWork.slice(i, i + 400);
      const batch = writeBatch(db);

      chunk.forEach((d) => {
        const data = d.data();
        const hasExistingRecord = !!data?.agreementAcceptance;

        if (hasExistingRecord) {
          // Top-up / re-stamp only: (re)write just the agreementText,
          // leave everything else on the existing record untouched.
          batch.update(d.ref, {
            "agreementAcceptance.agreementText": expectedText,
          });
        } else {
          const amount = data?.amount ?? data?.productSnapshot?.srp ?? null;

          batch.update(d.ref, {
            agreementAcceptance: {
              agreementVersion: LEGACY_AGREEMENT_VERSION,
              productType,
              termsSnapshot: {
                amount,
                note:
                  "This request predates the in-app agreement checkbox and was not confirmed by the requester through that flow. Administratively backfilled for record-keeping.",
              },
              agreementText: expectedText,
              acceptedAt: serverTimestamp(),
              isLegacyBackfill: true,
              backfilledBy: adminUid,
            },
          });
        }
      });

      await batch.commit();
    }

    result[name] = docsNeedingWork.length;
  }

  result.total = result.loanRequests + result.paSwipeRequests + result.creditCartRequests;
  return result;
}

// ===========================================================
// 🧾 GENERATE MISSING LOAN CONTRACTS — one-time admin action
// ===========================================================
// Coop loans approved before the loanContracts collection existed have no
// generated contract document (unlike MLF Easy Installment / Marimar's
// Credit Cart, which always got one at approval). This walks every
// activeLoans doc, skips any that already have a matching loanContracts
// doc (matched by requestId === activeLoans doc id), and generates one
// for the rest — clearly flagged as an administrative backfill so it's
// never mistaken for a contract generated at the actual approval moment.
export interface LoanContractsBackfillResult {
  generated: number;
  skipped: number;
}

export async function backfillMissingLoanContracts(): Promise<LoanContractsBackfillResult> {
  const activeLoansSnap = await getDocs(collection(db, "activeLoans"));
  const existingContractsSnap = await getDocs(collection(db, "loanContracts"));

  const existingRequestIds = new Set(
    existingContractsSnap.docs
      .map((d) => d.data()?.requestId)
      .filter(Boolean)
  );

  let generated = 0;
  let skipped = 0;

  for (const loanDoc of activeLoansSnap.docs) {
    const loanId = loanDoc.id;

    if (existingRequestIds.has(loanId)) {
      skipped++;
      continue;
    }

    const data = loanDoc.data();
    const amount = Number(data.principal ?? 0);
    const termsMonths = Number(data.termsMonths ?? 0);
    const monthlyInterestRate = Number(data.monthlyInterestRate ?? 0.10);
    const totalInterest = Number(data.totalInterest ?? amount * monthlyInterestRate * termsMonths);
    const totalPayable = Number(data.totalPayable ?? amount + totalInterest);
    const paymentSchedule = data.paymentSchedule ?? "15-30";
    const userId = data.userId ?? null;
    const userName = data.borrowerName || (await getUserFullName(userId));

    // 📌 purpose and the security guarantor (if any) live on the original
    // loanRequests doc, not on activeLoans — same doc id as this loan.
    const requestSnap = await getDoc(doc(db, "loanRequests", loanId));
    const requestData = requestSnap.exists() ? requestSnap.data() : null;

    let securityGuarantor: { name: string; relationship: string; phone: string } | null = null;
    if (requestData?.securityGuarantorInviteId) {
      const invite = await getInviteForRequest(loanId);
      if (invite) {
        securityGuarantor = {
          name: invite.guarantorName,
          relationship: invite.guarantorRelationship,
          phone: invite.guarantorPhone,
        };
      }
    }

    const contractText = generateLoanContract({
      memberName: userName,
      amount,
      termsMonths,
      monthlyInterestRate,
      totalInterest,
      totalPayable,
      paymentSchedule,
      startDate: new Date().toLocaleDateString(),
      purpose: requestData?.purpose ?? null,
      securityGuarantor,
      note:
        "NOTE: This contract document was administratively regenerated from existing loan records — it was not generated at the original time of approval.",
    });

    const contractRef = doc(collection(db, "loanContracts"));
    await setDoc(contractRef, {
      requestId: loanId,
      loanId,
      userId,
      userName,
      amount,
      termsMonths,
      paymentSchedule,
      totalInterest,
      totalPayable,
      contractText,
      status: data.status === "completed" ? "completed" : "accepted",
      isLegacyBackfill: true,
      acceptedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });

    generated++;
  }

  return { generated, skipped };
}

// ===========================================================
// NEW: Get Cooperative Financial Pools & Earnings Summary
// ===========================================================
export interface CoopFinancialPools {
  totalPrincipalCollected: number;
  totalInterestCollected: number;
  totalLateFeesCollected: number;
  capitalPool: number;
  effortPool: number;
  trustFundBalance: number;
  totalShareCapital: number; // ✅ NEW
}

export async function getCoopFinancialPools(): Promise<CoopFinancialPools> {
  const docRef = doc(db, "coopFinancialSummary", "current_state");
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return {
      totalPrincipalCollected: 0,
      totalInterestCollected: 0,
      totalLateFeesCollected: 0,
      capitalPool: 0,
      effortPool: 0,
      trustFundBalance: 0,
      totalShareCapital: 0, // ✅ NEW
    };
  }

  const d = docSnap.data();

  return {
    totalPrincipalCollected: d.totalPrincipalCollected || 0,
    totalInterestCollected: d.totalInterestCollected || 0,
    totalLateFeesCollected: d.totalLateFeesCollected || 0,
    capitalPool: d.capitalPool || 0,
    effortPool: d.effortPool || 0,
    trustFundBalance: d.trustFundBalance || 0,
    totalShareCapital: d.totalShareCapital || 0, // ✅ NEW
  };
}

// =====================================================================
// NEW: Helper function to ensure the coopFinancialSummary document exists
// =====================================================================
async function ensureCoopFinancialSummaryExists() {
  const docRef = doc(db, "coopFinancialSummary", "current_state");
  const docSnap = await getDoc(docRef);
  if (!docSnap.exists()) {
    console.log("🟡 Initializing coopFinancialSummary/current_state...");
await setDoc(docRef, {
  totalLendableFunds: 0,
  totalLoanedAmount: 0,
  totalShareCapital: 0, // ✅ NEW

  // 🔥 NEW financial tracking fields
  totalPrincipalCollected: 0,
  totalInterestCollected: 0,
  totalLateFeesCollected: 0,

  capitalPool: 0,        // 70% of earnings
  effortPool: 0,         // 30% of earnings
  trustFundBalance: 0,   // optional reserve fund

  lastUpdated: serverTimestamp(),
});
  }
}


// =====================================================================
// NEW: Update a member's monthlyShareCommitment
// =====================================================================
export async function updateMonthlyShareCommitment(userId: string, newCommitment: number) {
  const userRef = doc(db, "users", userId);
  try {
    await updateDoc(userRef, {
      monthlyShareCommitment: newCommitment,
      updatedAt: serverTimestamp(),
    });
    console.log(`🟢 adminService.ts: User ${userId} monthlyShareCommitment updated to ₱${newCommitment}.`);
  } catch (error: any) {
    console.error(`🔴 adminService.ts: FAILED to update user ${userId} monthlyShareCommitment:`, error.code, error.message, error);
    throw error;
  }
}


// =====================================================================
// Fetch pending users (service, no DOM)
// =====================================================================
export async function getPendingUsers(): Promise<UserProfile[]> {
  const q = query(
    collection(db, "users"),
    where("status", "==", "pending")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.data().uid,
    email: d.data().email,
    firstName: d.data().firstName,
    lastName: d.data().lastName,
    fullName:
      d.data().fullName ||
      `${d.data().firstName} ${d.data().lastName}`.trim(),
    role: d.data().role,
    status: d.data().status,
    createdAt: d.data().createdAt,
    updatedAt: d.data().updatedAt,
    shareBalance: d.data().shareBalance || 0,
    loanBalance: d.data().loanBalance || 0,
    loanLimit: d.data().loanLimit || 0,
    approvedAt: d.data().approvedAt || null,
  }));
}

// =====================================================================
// Approve user update Firestore only (Phase 4 - Step 1)
// PHASE 5 UPDATE: Conditionally set initial loanLimit for members AND borrowers
// =====================================================================
export async function approveUser(userId: string) {
  const userRef = doc(db, "users", userId);

  try {
    // First, get the user's current profile to determine their role
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      console.error(`User ${userId} not found for approval.`);
      throw new Error(`User ${userId} not found.`);
    }
    const userData = userSnap.data();
    const userRole = userData.role;

    let initialLoanLimit = 0;
    // Set initial loan limit for both 'member' and 'borrower' roles upon approval
    if (userRole === "borrower" || userRole === "member") {
      initialLoanLimit = 5000;
      console.log(`User ${userId} is a ${userRole}. Setting initial loanLimit to ₱${initialLoanLimit}.`);
    } else {
      console.log(`User ${userId} is a ${userRole}. Initial loanLimit remains ₱${initialLoanLimit}.`);
    }

    // Determine initial monthlyShareCommitment
    let initialMonthlyShareCommitment = 0;
    if (userRole === "member") {
      initialMonthlyShareCommitment = 1000; // Default to ₱1000 for members
    }
    // No commitment for borrowers initially, or other roles

    await updateDoc(userRef, {
      status: "approved",
      shareBalance: userData.shareBalance || 0,
      loanBalance: userData.loanBalance || 0,
      loanLimit: initialLoanLimit, // Apply the determined initial loan limit
      monthlyShareCommitment: initialMonthlyShareCommitment, // NEW: Set initial monthly share commitment
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log(`User ${userId} approved, financial balances initialized/updated, loanLimit, and monthlyShareCommitment set.`);
  } catch (error) {
    console.error(`Error approving user ${userId}:`, error);
    throw error;
  }
}

// =====================================================================
// Collect Share (Phase 4 - Step 3)
// MODIFIED: Also increments totalLendableFunds in coopFinancialSummary
// =====================================================================
export async function collectShare(
  userId: string,
  monthsPaid: number = 1,
  month?: number,
  year?: number,
  customAmount?: number
): Promise<string> {
  console.log("🔥 collectShare CALLED", { userId, month, year });

  await ensureCoopFinancialSummaryExists();

  const userRef = doc(db, "users", userId);
  const amount = customAmount !== undefined ? customAmount : 1000 * monthsPaid;

  // 🔍 Fetch member profile FIRST
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error("Member profile not found");

  const userData = userSnap.data();
  const memberName =
    userData.fullName ||
    `${userData.firstName ?? ""} ${userData.lastName ?? ""}`.trim() ||
    userData.email ||
    "Member";

  // 🧾 Generate receipt text ONCE (source of truth)
  const paymentDate = new Date().toLocaleString();
  const forMonthName =
    month && year
      ? new Date(year, month - 1).toLocaleString("default", { month: "long" })
      : "—";

  const receiptText = `--- WeeLend Cooperative Collection Receipt ---
Date: ${paymentDate}
Member: ${memberName} (ID: ${userId})
Amount: ₱${amount.toLocaleString()}
Months Paid: ${monthsPaid}
For Month/Year: ${forMonthName} ${year ?? ""}

Thank you for your contribution!
-------------------------------------`;

  try {
    // ==============================
    // 💰 UPDATE MEMBER + COOP + RECEIPT — ALL IN ONE BATCH
    // ==============================
    // Previously these were four separate sequential writes: if the
    // receipt write (or the legacy payment write) failed partway through
    // — a transient network blip, a rules hiccup — the member's balance
    // and the coop totals had ALREADY been updated, but no receipt got
    // created. The admin usually saw an error alert, assumed nothing had
    // happened, and the money had in fact already moved — leaving a real
    // gap between "shares paid" and "receipts on file" with no way to
    // tell after the fact. A writeBatch makes all four atomic: either
    // every write lands, or none of them do.
    const fiscalYearStart = getFiscalYearStart(new Date());
    const cacheIsCurrent = userData.sharesPaidCacheFiscalYearStartMs === fiscalYearStart.getTime();
    const priorSharesPaidCache = cacheIsCurrent ? Number(userData.sharesPaidCache ?? 0) : 0;

    const batch = writeBatch(db);

    batch.update(userRef, {
      shareBalance: increment(amount),
      sharesPaidCache: priorSharesPaidCache + monthsPaid,
      sharesPaidCacheFiscalYearStartMs: fiscalYearStart.getTime(),
      updatedAt: serverTimestamp(),
    });

    const coopSummaryRef = doc(db, "coopFinancialSummary", "current_state");
    batch.update(coopSummaryRef, {
      totalLendableFunds: increment(amount),
      totalShareCapital: increment(amount),
      lastUpdated: serverTimestamp(),
    });

    // 📜 SAVE RECEIPT (SOURCE OF TRUTH)
    const receiptRef = doc(collection(db, "memberShareReceipts"));
    batch.set(receiptRef, {
      type: "member_share",
      memberId: userId,
      memberName,
      receiptText,
      amountPaid: amount,
      monthsPaid,
      forMonth: month,
      forYear: year,
      collectedBy: "admin",
      createdAt: serverTimestamp(),
    });

    // 🔁 LEGACY PAYMENT (KEEP)
    const legacyPaymentRef = doc(collection(db, "payments"));
    batch.set(legacyPaymentRef, {
      userId,
      amount,
      monthsPaid,
      forMonth: month,
      forYear: year,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    console.log("✅ Share collected + receipt saved");

    // ⭐ RETURN RECEIPT TEXT
    return receiptText;

  } catch (err) {
    console.error("❌ collectShare failed:", err);
    throw err;
  }
}

// ===========================================================
// Get TOTAL Lendable Funds (previously getTotalFunds)
// Now reads from coopFinancialSummary/current_state
// ===========================================================
export async function getTotalFunds(): Promise<number> {
  await ensureCoopFinancialSummaryExists(); // Ensure the document exists
  const docRef = doc(db, "coopFinancialSummary", "current_state");
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    const total = data.totalLendableFunds || 0;
    console.log(`💰 TOTAL LENDABLE FUNDS computed: ₱${total}`);
    return total;
  }
  console.log(`💰 TOTAL LENDABLE FUNDS computed: ₱0 (document not found)`);
  return 0;
}

// ===========================================================
// Get TOTAL Loaned Amount
// Now reads from coopFinancialSummary/current_state
// ===========================================================
export async function getTotalLoanedAmount(): Promise<number> {
  await ensureCoopFinancialSummaryExists(); // Ensure the document exists
  const docRef = doc(db, "coopFinancialSummary", "current_state");
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    const total = data.totalLoanedAmount || 0;
    console.log(`💸 TOTAL LOANED AMOUNT computed: ₱${total}`);
    return total;
  }
  console.log(`💸 TOTAL LOANED AMOUNT computed: ₱0 (document not found)`);
  return 0;
}

// =====================================================================
// Get Payments by User (Phase 4 - Step 4B)
// =====================================================================
export interface PaymentRecord {
  id: string;
  userId: string;
  amount: number;
  monthsPaid: number;
  createdAt: any;
  forMonth?: number;
  forYear?: number;
}

export async function getPaymentsByUser(userId: string): Promise<PaymentRecord[]> {
  const q = query(
    collection(db, "payments"),
    where("userId", "==", userId)
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map(d => ({
    id: d.id,
    ...d.data()
  })) as PaymentRecord[];
}
// =====================================================================
// Get Dashboard Summary Data (Phase 4 - Admin Overview)
// PHASE 5 ADDITION: Includes new share data
// =====================================================================
export interface DashboardSummary {
  totalAvailableFunds: number;
  totalLoanedAmount: number;
  totalApprovedMembers: number;
  totalPendingUsers: number;
  sharesCollectedThisMonth: number; // NEW
}

// PHASE 5 ADDITION: New function to get total approved members count
export async function getTotalApprovedMembersCount(): Promise<number> {
  const q = query(
    collection(db, "users"),
    where("status", "==", "approved"),
    where("role", "==", "member")
  );
  const snapshot = await getDocs(q);
  return snapshot.size;
}

// PHASE 5 ADDITION: New function to get shares collected this month for all members
export async function getSharesCollectedThisMonth(): Promise<number> {
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // getMonth() is 0-indexed, forMonth is 1-indexed
  const currentYear = today.getFullYear();

  const q = query(
    collection(db, "payments"),
    where("forMonth", "==", currentMonth), // Filter by the target month of collection
    where("forYear", "==", currentYear)    // Filter by the target year of collection
  );
  const snapshot = await getDocs(q);

  let totalShares = 0;
  snapshot.forEach(doc => {
    totalShares += doc.data().amount || 0;
  });

  return totalShares;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  // Use the new functions to get these global totals
  const totalAvailableFunds = await getTotalFunds();
  const totalLoanedAmount = await getTotalLoanedAmount();

  let totalApprovedMembers = 0;
  let totalPendingUsers = 0;
  let sharesCollectedThisMonth = 0;

  // Query users for approved/pending counts (still needed here as it's not in coopFinancialSummary)
  const usersQ = query(collection(db, "users"));
  const usersSnapshot = await getDocs(usersQ);

  usersSnapshot.forEach(doc => {
    const data = doc.data();

    if (data.status === "approved" && data.role === "member") { // Only count approved members here
      totalApprovedMembers++;
    } else if (data.status === "pending") {
      totalPendingUsers++;
    }
  });

  // Fetch shares collected this month separately
  sharesCollectedThisMonth = await getSharesCollectedThisMonth();


  const summary: DashboardSummary = {
    totalAvailableFunds: totalAvailableFunds,
    totalLoanedAmount: totalLoanedAmount,
    totalApprovedMembers: totalApprovedMembers,
    totalPendingUsers: totalPendingUsers,
    sharesCollectedThisMonth: sharesCollectedThisMonth,
  };

  console.log(`📊 DASHBOARD SUMMARY computed:`, summary);
  return summary;
}

