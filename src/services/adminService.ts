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
  addDoc,
  getDoc,
  setDoc, // NEW: Added setDoc for initializing/creating coop financial summary
} from "firebase/firestore";

import { db } from "../firebaseConfig";
import type { UserProfile } from "../type";

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
    // 💰 UPDATE MEMBER + COOP
    // ==============================
    await updateDoc(userRef, {
      shareBalance: increment(amount),
      updatedAt: serverTimestamp(),
    });

    const coopSummaryRef = doc(db, "coopFinancialSummary", "current_state");
    await updateDoc(coopSummaryRef, {
      totalLendableFunds: increment(amount),
      totalShareCapital: increment(amount),
      lastUpdated: serverTimestamp(),
    });

    // ==============================
    // 📜 SAVE RECEIPT (SOURCE OF TRUTH)
    // ==============================
    await addDoc(collection(db, "memberShareReceipts"), {
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

    // ==============================
    // 🔁 LEGACY PAYMENT (KEEP)
    // ==============================
    await addDoc(collection(db, "payments"), {
      userId,
      amount,
      monthsPaid,
      forMonth: month,
      forYear: year,
      createdAt: serverTimestamp(),
    });

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

