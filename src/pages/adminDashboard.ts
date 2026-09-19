// src/pages/adminDashboard.ts


import { logout } from "../services/authService";
import {
  getPendingUsers,
  collectShare,
  getTotalFunds,
  getTotalLoanedAmount,
  getDashboardSummary,
  type DashboardSummary,
  getTotalApprovedMembersCount,
  getCoopFinancialPools,           // ✅ ADD BACK
  type CoopFinancialPools,         // ✅ ADD BACK
} from "../services/adminService";
import { getUserFullName } from "../services/userUtils";

import { collection, query, where, getDocs, doc, getDoc, increment, runTransaction, serverTimestamp, updateDoc, setDoc } from "firebase/firestore"; // NEW: Added runTransaction and serverTimestamp
import { db, auth, app } from "../firebaseConfig";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import type { UserProfile } from "../type";
import { onAuthStateChanged, getAuth } from "firebase/auth";
import { loadAllLoansUI } from "./allLoans";
import { getLatestLoanForMember } from "../services/loanService";
import { formatDueDate } from "../services/loanService"; // you already have this helper
import { loadRepaymentsUI } from "./repayments";
import { initPaSwipeCollectionsAdmin } from "./paSwipeCollectionsAdmin";
import { initPaSwipeContractsAdmin } from "./paSwipeContractsAdmin";
import { initCreditCartRequestsAdmin } from "./creditCartRequestsAdmin";
import { initCreditCartCollectionsAdmin } from "./creditCartCollectionsAdmin";
import { initCreditCartContractsAdmin } from "./creditCartContractsAdmin";
import { initPaBentaShopsAdmin } from "./paBentaShopsAdmin";
import { initPaBentaListingsAdmin } from "./paBentaListingsAdmin";
console.log("AUTH EMAIL:", getAuth().currentUser?.email);


const storage = getStorage();

console.log("🔥 adminService.ts LOADED");

// import { loadAllLoansUI } from "./allLoans";
console.log("🔥 CONNECTED TO FIREBASE PROJECT:", app.options);
import { setLogLevel } from "firebase/firestore";
setLogLevel("debug");
import { initPaSwipeManager } from "./paSwipeManager";
import { initPaSwipeRequestsAdmin } from "./paSwipeRequestsAdmin";

let allLoansTabBtn: HTMLElement | null;


// =====================================================================
// DOM Elements (defined once, globally - these will be selected when initAdminDashboard is called)
// These need to be const for TypeScript but initially null because they don't exist yet
// =====================================================================
let adminSectionContent: HTMLElement | null = null;
let adminDashboardLayout: HTMLElement | null = null;
let adminSidebar: HTMLElement | null = null;
let globalToggleSidebarBtn: HTMLElement | null = null;

let overviewTabBtn: HTMLElement | null = null;
let pendingUsersTabBtn: HTMLElement | null = null;
let approvedUsersTabBtn: HTMLElement | null = null;
let approvedBorrowersTabBtn: HTMLElement | null = null;
let loanRequestsTabBtn: HTMLElement | null = null;
let repaymentsTabBtn: HTMLElement | null = null;
let paymentSettingsTabBtn: HTMLElement | null = null;
let paSwipeManagerTabBtn: HTMLElement | null = null;
let paSwipeRequestsTabBtn: HTMLElement | null = null;
let paSwipeCollectionsTabBtn: HTMLElement | null = null;
if (!paSwipeRequestsTabBtn) { console.warn("🟡 paSwipeRequestsTabBtn not found — skipping setup."); }
let globalLogoutBtn: HTMLElement | null = null;
let paSwipeContractsAdminTabBtn: HTMLElement | null = null;
let creditCartRequestsTabBtn: HTMLElement | null = null;
let creditCartCollectionsTabBtn: HTMLElement | null = null;
let creditCartContractsAdminTabBtn: HTMLElement | null = null;
let pabentaShopsAdminTabBtn: HTMLElement | null = null;
let pabentaListingsAdminTabBtn: HTMLElement | null = null;

// Collection Modal elements
let collectionModal: HTMLElement | null = null;
let modalMemberNameSpan: HTMLElement | null = null;
let collectionModalCloseBtn: HTMLElement | null = null;
let modalMonthsInput: HTMLInputElement | null = null;
let modalMonthSelect: HTMLSelectElement | null = null;
let modalYearInput: HTMLInputElement | null = null;
let modalCollectConfirmBtn: HTMLElement | null = null;
let modalmonthlyShareCommitmentDisplay: HTMLElement | null = null;
let modalSetToCommitmentBtn: HTMLElement | null = null;

// Receipt Modal elements
let receiptModal: HTMLElement | null = null;
let receiptModalCloseBtn: HTMLElement | null = null;
let receiptContentPre: HTMLElement | null = null;
let copyReceiptBtn: HTMLElement | null = null;
let isReceiptOpen = false;

// Internal State for Modals
let currentMemberIdForCollection: string | null = null;
let currentMembermonthlyShareCommitment: number | null = null;

// ✅ Role Confirmation Modal elements
let roleConfirmModal: HTMLElement | null = null;
let roleConfirmCloseBtn: HTMLElement | null = null;
let roleConfirmName: HTMLElement | null = null;
let roleConfirmEmail: HTMLElement | null = null;
let roleConfirmSelect: HTMLSelectElement | null = null;
let roleConfirmApproveBtn: HTMLElement | null = null;

// ✅ state
let currentPendingUser: UserProfile | null = null;

// ✅ Change Role Modal (Approved users)
let changeRoleModal: HTMLElement | null = null;
let changeRoleCloseBtn: HTMLElement | null = null;
let changeRoleName: HTMLElement | null = null;
let changeRoleEmail: HTMLElement | null = null;
let changeRoleCurrentRole: HTMLElement | null = null;
let changeRoleSelect: HTMLSelectElement | null = null;
let changeRoleConfirmBtn: HTMLElement | null = null;

// ✅ state (approved user being edited)
let currentApprovedUser: UserProfile | null = null;
let changeRoleReturnTab: "members" | "borrowers" = "members";

// =====================================================================
// Fetch Approved Members (temporary local function for now)
// =====================================================================
export async function getApprovedMembers(): Promise<UserProfile[]> {
  const q = query(
    collection(db, "users"),
    where("status", "==", "approved"),
    where("role", "==", "member")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id, // Ensure uid is also present, using doc.id as the primary identifier
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
    monthlyShareCommitment: d.data().monthlyShareCommitment || 0,
  }));
}

export async function getApprovedBorrowers(): Promise<UserProfile[]> {
  const q = query(
    collection(db, "users"),
    where("status", "==", "approved"),
    where("role", "==", "borrower")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    uid: d.id,
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
    monthlyShareCommitment: d.data().monthlyShareCommitment || 0,
  }));
} // 👈 function ends here CLEANLY

// =====================================================================
// Helper Functions (Top-level scope)
// =====================================================================
async function updateMonthlyShareCommitment(memberId: string, newCommitment: number) {
  const userRef = doc(db, "users", memberId);

  await updateDoc(userRef, {
    monthlyShareCommitment: newCommitment,
    updatedAt: serverTimestamp(),
  });
}

function openRoleConfirmModal(user: UserProfile) {
  if (
    !roleConfirmModal ||
    !roleConfirmName ||
    !roleConfirmEmail ||
    !roleConfirmSelect
  ) return;

  currentPendingUser = user;

  roleConfirmName.textContent = user.fullName || "—";
  roleConfirmEmail.textContent = user.email || "—";

  // default selection to what user chose (or borrower fallback)
  roleConfirmSelect.value = (user.role as any) || "borrower";

  roleConfirmModal.classList.add("active");
}

function closeRoleConfirmModal() {
  if (roleConfirmModal) roleConfirmModal.classList.remove("active");
  currentPendingUser = null;
}
function openChangeRoleModal(user: UserProfile, returnTab: "members" | "borrowers") {
  if (
    !changeRoleModal ||
    !changeRoleName ||
    !changeRoleEmail ||
    !changeRoleCurrentRole ||
    !changeRoleSelect
  ) return;

  currentApprovedUser = user;
  changeRoleReturnTab = returnTab;

  changeRoleName.textContent = user.fullName || "—";
  changeRoleEmail.textContent = user.email || "—";
  changeRoleCurrentRole.textContent = user.role || "—";

  changeRoleSelect.value = user.role === "borrower" ? "borrower" : "member";

  changeRoleModal.classList.add("active");
}

function closeChangeRoleModal() {
  changeRoleModal?.classList.remove("active");
  currentApprovedUser = null;
}

async function adminUpdateUserRole(uid: string, role: "member" | "borrower") {
  await updateDoc(doc(db, "users", uid), {
    role,
    updatedAt: serverTimestamp(),
  });
}

async function approvePendingUserWithRole(uid: string, role: "member" | "borrower") {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    role,
    status: "approved",
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function generateRepaymentSchedule(
  principal: number,
  termsMonths: number,
  monthlyInterestRate: number,
  startDate: Date,
  schedule: string
) {
  // ✅ SAFETY CAPS — prevents excessively long terms or runaway interest
  const MAX_TERMS_MONTHS = 10;
  const safeTermsMonths = Math.min(Math.max(Number(termsMonths), 1), MAX_TERMS_MONTHS);

  if (safeTermsMonths !== termsMonths) {
    console.warn(`⚠️ Loan terms clamped from ${termsMonths} to ${safeTermsMonths} months`);
  }

  const payments: any[] = [];

  const computedInterest = principal * monthlyInterestRate * safeTermsMonths;
  const totalInterest = Math.min(computedInterest, principal); // ✅ interest can never exceed 100% of principal

  if (totalInterest !== computedInterest) {
    console.warn(`⚠️ Interest capped from ${computedInterest} to ${totalInterest} (100% of principal max)`);
  }

  const totalPayable = principal + totalInterest;

  const paymentCount = schedule === "15-30" ? safeTermsMonths * 2 : safeTermsMonths;

  const principalPerPayment = principal / paymentCount;
  const interestPerPayment = totalInterest / paymentCount;

  let dueDate = new Date(startDate);

  for (let i = 0; i < paymentCount; i++) {
    payments.push({
      dueDate: new Date(dueDate),
      principalDue: Math.round(principalPerPayment * 100) / 100,
      interestDue: Math.round(interestPerPayment * 100) / 100,
      totalDue: Math.round((principalPerPayment + interestPerPayment) * 100) / 100,
      paid: false,
      paidAt: null,
      lateFeeApplied: 0,
    });

    // advance due date
    if (schedule === "15-30") {
      dueDate = addDays(dueDate, 15);
    } else {
      dueDate.setMonth(dueDate.getMonth() + 1);
    }
  }

  return {
    totalInterest,
    totalPayable,
    paymentCount,
    payments,
    safeTermsMonths, // ✅ return the clamped value so the caller can store it correctly
  };
}

// Helper to fill month/year selectors
function fillMonthYearSelectors() {
    if (!modalMonthSelect || !modalYearInput) return;

    const today = new Date();
    const currentMonth = today.getMonth(); // 0-11
    const currentYear = today.getFullYear();

    // Fill months
    modalMonthSelect!.innerHTML = '';
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];
    monthNames.forEach((name, index) => {
        const option = document.createElement("option");
        option.value = (index + 1).toString(); // Month values 1-12
        option.textContent = name;
        if (index === currentMonth) {
            option.selected = true;
        }
        modalMonthSelect!.appendChild(option);
    });

    // Fill years (e.g., current year +/- 5 years)
    modalYearInput!.value = currentYear.toString();
}

// Function to open the collection modal
function openCollectionModal(memberId: string, memberName: string, monthlyShareCommitment: number) {
    if (!collectionModal || !modalMemberNameSpan || !modalMonthsInput || !modalmonthlyShareCommitmentDisplay) return;
    currentMemberIdForCollection = memberId;
  
    currentMembermonthlyShareCommitment = monthlyShareCommitment;

    modalMemberNameSpan!.textContent = memberName;
    modalMonthsInput!.value = "1";

    modalmonthlyShareCommitmentDisplay!.textContent = `₱${monthlyShareCommitment.toLocaleString()}`;

    fillMonthYearSelectors();

    collectionModal!.classList.add("active");
}

// Function to close the collection modal
function closeCollectionModal() {
    if (collectionModal) collectionModal!.classList.remove("active");
    currentMemberIdForCollection = null;
    currentMembermonthlyShareCommitment = null;
}

// Helper to generate receipt text
// MODIFIED: Now accepts actualAmount and actualMonthsPaid (which will be 1 for monthly commitment)
function generateReceipt(
  memberName: string,
  memberId: string,
  actualAmount: number,
  actualMonthsPaid: number,
  month: number,
  year: number
): string {

  const safeMemberName = memberName || "Member";
  const safeMemberId = memberId || "—";

  const paymentDate = new Date().toLocaleString();

  const forMonthName =
    typeof month === "number" && typeof year === "number"
      ? new Date(year, month - 1).toLocaleString("default", { month: "long" })
      : "—";

  return `--- WeeLend Cooperative Collection Receipt ---
Date: ${paymentDate}
Member: ${safeMemberName} (ID: ${safeMemberId})
Amount: ₱${Number(actualAmount || 0).toLocaleString()}
Months Paid: ${actualMonthsPaid || 1}
For Month/Year: ${forMonthName} ${year || "—"}

Thank you for your contribution!
-------------------------------------`;
}

// Function to open the receipt modal
function openReceiptModal(receiptText: string) {
  const modal = document.getElementById("receipt-modal") as HTMLElement | null;
  const content = document.getElementById("receipt-content") as HTMLElement | null;

  if (!modal || !content) {
    console.warn("⚠️ Receipt modal elements not found in DOM");
    return; // ❗ DO NOT THROW
  }

  isReceiptOpen = true; // ✅ LOCK UI
  content.textContent = receiptText;
  modal.classList.add("active");
}

// Function to close the receipt modal
function closeReceiptModal() {
    if (receiptModal) receiptModal!.classList.remove("active");
}


// =====================================================================
// UI Function: Render the financial totals (Available Funds, Total Loaned)
// =====================================================================
export async function renderFinancialTotalsUI(adminSectionContent: HTMLElement) {
  if (isReceiptOpen) return; // ⛔ HARD BLOCK while receipt is open
  
  let totalsDiv = document.getElementById("financial-totals-display");
  if (!totalsDiv) {
    totalsDiv = document.createElement("div");
    totalsDiv.id = "financial-totals-display";
    totalsDiv.classList.add("financial-totals-box");
    adminSectionContent.prepend(totalsDiv);
  }

  totalsDiv.innerHTML = `
    <p>💰 Available Funds: Loading...</p>
    <p>💸 Total Loaned: Loading...</p>
  `;

  const totalAvailable = await getTotalFunds();
  const totalLoaned = await getTotalLoanedAmount();

  totalsDiv.innerHTML = `
    <p>💰 Available Funds: ₱${totalAvailable.toLocaleString()}</p>
    <p>💸 Total Loaned: ₱${totalLoaned.toLocaleString()}</p>
  `;
}



// =====================================================================
// Helper: Clear just the main content area below the totals
// =====================================================================
function clearMainContentArea(adminSectionContent: HTMLElement) {
    Array.from(adminSectionContent.children).forEach(child => {
        if (child.id !== "financial-totals-display" && !child.classList.contains("summary-cards-grid")) {
            child.remove();
        }
    });
}


// =====================================================================
// UI Function: Load and display PENDING users
// =====================================================================
export async function loadPendingUsersUI(adminSectionContent: HTMLElement) {
  clearMainContentArea(adminSectionContent);
  await renderFinancialTotalsUI(adminSectionContent);

  const listContainer = document.createElement("div");
  listContainer.id = "pending-users-list-container";
  listContainer.innerHTML = "<h3>Pending Users</h3><p>Loading...</p>";
  adminSectionContent.appendChild(listContainer);

  const pendingUsers = await getPendingUsers();

  if (pendingUsers.length === 0) {
    listContainer.innerHTML = "<h3>Pending Users</h3><p>No pending users</p>";
    return;
  }

  let usersListHTML = "<h3>Pending Users</h3>";
  pendingUsers.forEach((user: UserProfile) => {
    usersListHTML += `
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span>${user.fullName} (${user.role})</span>
        <button class="approve-btn" data-uid="${user.id}">Approve</button>
      </div>
    `;
  });
  listContainer.innerHTML = usersListHTML;

 // 🔐 Intercept Approve button → open role confirmation modal
listContainer.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;

  if (target.classList.contains("approve-btn")) {
    console.log("✅ Approve button clicked");

    const uid = target.getAttribute("data-uid");
    console.log("UID:", uid);

    if (!uid) {
      console.warn("⚠️ No UID found on button");
      return;
    }

    const selectedUser = pendingUsers.find(u => u.id === uid);

    console.log("Selected user:", selectedUser);

    if (!selectedUser) {
      console.error("❌ Pending user not found in array");
      return;
    }

    openRoleConfirmModal(selectedUser);
  }
});
}

// =====================================================================
// UI Function: Load and display APPROVED members
// =====================================================================
export async function loadApprovedMembersUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);
  await renderFinancialTotalsUI(adminSectionContent);

  const listContainer = document.createElement("div");
  listContainer.id = "approved-members-list-container";
  listContainer.innerHTML = "<h3>Approved Members</h3><p>Loading...</p>";
  adminSectionContent.appendChild(listContainer);

  const approvedMembers = await getApprovedMembers();

  if (approvedMembers.length === 0) {
    listContainer.innerHTML = "<h3>Approved Members</h3><p>No approved members found.</p>";
    return;
  }

  let membersHtml = "<h3>Approved Members</h3>";

membersHtml = "<h3>Approved Members</h3>";

for (const member of approvedMembers) {
  const hasLoan = await memberHasActiveLoan(member.id);

  membersHtml += `
    <div class="approved-member-row">
      <div class="member-main">
        <div class="member-name">
          ${member.fullName}
          ${hasLoan ? `<span class="loan-badge">🟢 Has Active Loan</span>` : ``}
        </div>
        <div class="member-meta">
          (${member.role}) – Share: ₱${(member.shareBalance ?? 0).toFixed(2)}
        </div>
      </div>

      <div class="member-commitment-control">
        <span>Commitment:</span>
        <input
          type="number"
          class="monthly-commitment-input"
          value="${member.monthlyShareCommitment ?? 0}"
          min="0"
          step="1000"
          data-member-id="${member.id}"
          style="width: 80px; margin-left: 5px;"
        />
        <button class="save-commitment-btn" data-member-id="${member.id}">Save</button>
      </div>

      <div class="member-actions">
        <button class="collect-share-btn"
                data-member-id="${member.id}"
                data-member-name="${member.fullName}"
                data-monthly-commitment="${member.monthlyShareCommitment ?? 0}">
          Collect Share
        </button>
        <button class="view-payments-btn" data-member-id="${member.id}">
          View History
        </button>
        <button class="change-role-btn"
        data-user-id="${member.id}"
        data-return-tab="members">
  Change Role
</button>
      </div>
    </div>
  `;
}

  listContainer.innerHTML = membersHtml;

// ✅ Change Role button (Approved Members) — event delegation
listContainer.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".change-role-btn") as HTMLElement | null;
  if (!btn) return;

  const userId = btn.dataset.userId;
  if (!userId) return;

  const user = approvedMembers.find(u => u.id === userId);
  if (!user) return;

  openChangeRoleModal(user, "members");
});

listContainer.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".collect-share-btn") as HTMLElement;
  if (!btn) return;

  const memberId = btn.dataset.memberId!;
  const memberName = btn.dataset.memberName!;
  const monthlyShareCommitment = Number(btn.dataset.monthlyCommitment || 0);

  openCollectionModal(memberId, memberName, monthlyShareCommitment);
});

document.querySelectorAll("#approved-members-list-container .save-commitment-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    const button = e.target as HTMLButtonElement;
    const memberId = button.getAttribute("data-member-id")!;
    const inputElement = button.previousElementSibling as HTMLInputElement;

    const newCommitment = Number(inputElement.value);

    // ✅ enforce valid values (1000 steps, non-negative)
    if (!Number.isFinite(newCommitment) || newCommitment < 0) {
      alert("Please enter a valid commitment amount.");
      return;
    }

    if (newCommitment % 1000 !== 0) {
      alert("Commitment must be in increments of ₱1,000.");
      return;
    }

    // ✅ prevent double-click spam
    button.disabled = true;
    const oldLabel = button.textContent;
    button.textContent = "Saving...";

    try {
      await updateMonthlyShareCommitment(memberId, newCommitment);

      alert(`✅ Commitment updated to ₱${newCommitment.toLocaleString()}`);
      await loadApprovedMembersUI(adminSectionContent!);

    } catch (error) {
      console.error("❌ Error updating monthly commitment:", error);
      alert("Failed to update commitment. Check console for details.");
    } finally {
      button.disabled = false;
      button.textContent = oldLabel || "Save";
    }
  });
});

document.querySelectorAll("#approved-members-list-container .view-payments-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    const memberId = (e.target as HTMLElement).getAttribute("data-member-id")!;
    await loadMemberPaymentHistory(adminSectionContent!, memberId);
  });
});
} // closes loadApprovedMembersUI

async function memberHasActiveLoan(userId: string): Promise<boolean> {
  const q = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    where("status", "==", "active")
  );

  const snap = await getDocs(q);
  return !snap.empty;
}


// =====================================================================
// 📜 MEMBER FINANCIAL HISTORY (Shares + Loans)
// =====================================================================
async function loadMemberPaymentHistory(container: HTMLElement, userId: string) {
  clearMainContentArea(container);
  await renderFinancialTotalsUI(container);

  const memberName = await getUserFullName(userId);

  container.innerHTML = `<h3>📜 Member Financial History</h3><p>Loading...</p>`;

  /* ============================
     💰 SHARE PAYMENTS
  ============================ */
  const paymentsQ = query(
    collection(db, "payments"),
    where("userId", "==", userId)
  );

  const paymentsSnap = await getDocs(paymentsQ);

  let shareHtml = `
    <h4>💰 Share Contributions</h4>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Amount</th>
          <th>For</th>
        </tr>
      </thead>
      <tbody>
  `;

  if (paymentsSnap.empty) {
    shareHtml += `<tr><td colspan="3">No share payments found.</td></tr>`;
  } else {
    paymentsSnap.docs.forEach(d => {
      const p = d.data();

      const date =
        p.createdAt?.toDate?.().toLocaleDateString() ?? "N/A";

      const forText =
        p.forMonth && p.forYear
          ? `${new Date(p.forYear, p.forMonth - 1).toLocaleString("default", { month: "long" })} ${p.forYear}`
          : "—";

      shareHtml += `
        <tr>
          <td>${date}</td>
          <td>₱${Number(p.amount ?? 0).toLocaleString()}</td>
          <td>${forText}</td>
        </tr>
      `;
    });
  }

  shareHtml += `</tbody></table>`;


  /* ============================
     💳 ACTIVE LOAN + REPAYMENTS
  ============================ */
const loan = await getLatestLoanForMember(userId);

  let loanHtml = `<h4>💳 Loan Information</h4>`;

  if (!loan) {
    loanHtml += `<p>No active loan found.</p>`;
  } else {
    loanHtml += `
      <p><strong>Original Amount:</strong> ₱${Number(
        loan.principal ?? loan.amountBorrowed ?? loan.amount ?? 0
      ).toLocaleString()}</p>

      <p><strong>Remaining Balance:</strong> ₱${Number(
        loan.remainingBalance ?? 0
      ).toLocaleString()}</p>

      <p><strong>Status:</strong> ${loan.status}</p>
      <p><strong>Next Due Date:</strong> ${formatDueDate(loan.nextDueDate)}</p>
    `;

    // ✅ FETCH LOAN REPAYMENTS FROM SCHEDULE
    const schedSnap = await getDocs(
      collection(db, "activeLoans", loan.id, "schedule")
    );

    const repayments = schedSnap.docs
      .map(d => ({ id: d.id, ...(d.data() as any) }))
      .filter(p => p.paid);

    loanHtml += `
      <h4>📆 Loan Repayment History</h4>
      <table class="admin-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Principal Paid</th>
            <th>Interest Paid</th>
            <th>Late Fee</th>
            <th>Total Paid</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (!repayments.length) {
      loanHtml += `<tr><td colspan="5">No repayments yet.</td></tr>`;
    } else {
      repayments.forEach(p => {
        const date = p.paidAt?.toDate
          ? p.paidAt.toDate().toLocaleDateString()
          : "N/A";

        loanHtml += `
          <tr>
            <td>${date}</td>
            <td>₱${Number(p.principalPaid ?? 0).toLocaleString()}</td>
            <td>₱${Number(p.interestPaid ?? 0).toLocaleString()}</td>
            <td>₱${Number(p.lateFeePaid ?? 0).toLocaleString()}</td>
            <td><strong>₱${Number(p.actualPaid ?? 0).toLocaleString()}</strong></td>
          </tr>
        `;
      });
    }

    loanHtml += `</tbody></table>`;
  }

  /* ============================
     FINAL RENDER
  ============================ */
container.innerHTML = `
  <h3>📜 Member Financial History</h3>
  <p><strong>Member:</strong> ${memberName}</p>
  <br/>

  ${shareHtml}
  <br/>

  ${loanHtml}
  <br/>

  <button id="back-to-members-btn">⬅ Back to Approved Members</button>
`;

  document.getElementById("back-to-members-btn")?.addEventListener("click", () => {
    loadApprovedMembersUI(container);
  });
}

// =====================================================================
// PHASE 5 ADDITION: UI Function: Load and display APPROVED borrowers
// =====================================================================
export async function loadApprovedBorrowersUI(adminSectionContent: HTMLElement | null) {
    if (!adminSectionContent) return;
    clearMainContentArea(adminSectionContent);
    await renderFinancialTotalsUI(adminSectionContent);

    const listContainer = document.createElement("div");
    listContainer.id = "approved-borrowers-list-container";
    listContainer.innerHTML = "<h3>Approved Borrowers</h3><p>Loading...</p>";
    adminSectionContent.appendChild(listContainer);

    const approvedBorrowers = await getApprovedBorrowers();

    if (approvedBorrowers.length === 0) {
        listContainer.innerHTML = "<h3>Approved Borrowers</h3><p>No approved borrowers found.</p>";
        return;
    }

    let borrowersHtml = "<h3>Approved Borrowers</h3>";

    approvedBorrowers.forEach((borrower: UserProfile) => {
        borrowersHtml += `
            <div class="approved-member-row">
                <div class="member-main">
                    <div class="member-name">${borrower.fullName}</div>
                    <div class="member-meta">(${borrower.role}) – Current Loan: ₱${(borrower.loanBalance ?? 0).toFixed(2)} / Limit: ₱${(borrower.loanLimit ?? 0).toFixed(2)}</div>
                </div>
                <div class="member-actions">
                    <button class="view-borrower-details-btn" data-member-id="${borrower.id}">View Details</button>
                    <button class="change-role-btn"
        data-user-id="${borrower.id}"
        data-return-tab="borrowers">
  Change Role
</button>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = borrowersHtml;

    // ✅ Change Role button (Approved Borrowers) — event delegation
listContainer.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".change-role-btn") as HTMLElement | null;
  if (!btn) return;

  const userId = btn.dataset.userId;
  if (!userId) return;

  const user = approvedBorrowers.find(u => u.id === userId);
  if (!user) return;

  openChangeRoleModal(user, "borrowers");
});

document
  .querySelectorAll("#approved-borrowers-list-container .view-borrower-details-btn")
  .forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const borrowerId = (e.target as HTMLElement).getAttribute("data-member-id")!;
      await loadBorrowerLoanDetails(adminSectionContent!, borrowerId);
    });
  });
}

// =====================================================================
// 📄 Borrower Details — Loan + Repayment History
// =====================================================================
async function loadBorrowerLoanDetails(container: HTMLElement, userId: string) {
  clearMainContentArea(container);
  await renderFinancialTotalsUI(container);

  container.innerHTML = `<h3>Borrower Loan Details</h3><p>Loading...</p>`;

  // 1️⃣ Get active loan
const loan = await getLatestLoanForMember(userId);
const borrowerName = await getUserFullName(userId);

  if (!loan) {
    container.innerHTML += `<p>No active loan found for this borrower.</p>`;
    return;
  }

  // 2️⃣ Get repayment history
  const schedSnap = await getDocs(
  collection(db, "activeLoans", loan.id, "schedule")
);

const repayments = schedSnap.docs
  .map(d => ({ id: d.id, ...(d.data() as any) }))
  .filter(p => p.paid);


  let html = `
    <h3>Borrower Loan Details</h3>
    <p><strong>Borrower:</strong> ${borrowerName}</p>
    <h3>💳 Loan Summary</h3>
    <p><strong>Original Amount:</strong> ₱${Number(
      loan.principal ?? loan.amountBorrowed ?? loan.amount ?? 0
    ).toLocaleString()}</p>
    <p><strong>Remaining Balance:</strong> ₱${Number(
      loan.remainingBalance ?? 0
    ).toLocaleString()}</p>
    <p><strong>Status:</strong> ${loan.status}</p>
    <p><strong>Next Due Date:</strong> ${formatDueDate(loan.nextDueDate)}</p>

    <h3>📜 Repayment History</h3>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Principal</th>
          <th>Interest</th>
        </tr>
      </thead>
      <tbody>
  `;

if (!repayments.length) {
  html += `<tr><td colspan="3">No repayments yet.</td></tr>`;
} else {
  for (const p of repayments) {
    const date = p.paidAt?.toDate
      ? p.paidAt.toDate().toLocaleDateString()
      : "N/A";

    html += `
      <tr>
        <td>${date}</td>
        <td>₱${Number(p.principalDue).toLocaleString()}</td>
        <td>₱${Number(p.interestDue).toLocaleString()}</td>
      </tr>
    `;
  }
}

  html += `
      </tbody>
    </table>

    <br/>
    <button id="back-to-borrowers-btn">⬅ Back to Approved Borrowers</button>
  `;

  container.innerHTML = html;

  // Back button
  document.getElementById("back-to-borrowers-btn")?.addEventListener("click", () => {
    loadApprovedBorrowersUI(container);
  });
}

// =====================================================================
// PHASE 5 UPDATE: Load REAL pending loan requests from Firestore
// =====================================================================
export async function loadLoanRequestsUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);
  await renderFinancialTotalsUI(adminSectionContent);

  const listContainer = document.createElement("div");
  listContainer.id = "loan-requests-list-container";
  listContainer.innerHTML = "<h3>Pending Loan Requests</h3><p>Loading...</p>";
  adminSectionContent.appendChild(listContainer);

  // Fetch from Firestore instead of mock data
  const loanRequestsRef = collection(db, "loanRequests");
  const q = query(loanRequestsRef, where("status", "==", "pending"));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    listContainer.innerHTML = "<h3>Pending Loan Requests</h3><p>No pending loan requests.</p>";
    return;
  }

  let requestsHtml = "<h3>Pending Loan Requests</h3>";

  // Use Promise.all to fetch all names concurrently for efficiency
  const loanRequestItemsHtml = await Promise.all(snapshot.docs.map(async (loanDoc) => {
    const loan = loanDoc.data();
    // Fetch borrower's and guarantor's names using the helper function
    const borrowerName = await getUserFullName(loan.userId);
    const guarantorName = await getUserFullName(loan.guarantorId); // Assuming guarantorId exists on the loan document

    const submittedDate = loan.requestedAt?.toDate
      ? loan.requestedAt.toDate().toLocaleString()
      : "N/A";

    return `
      <div class="loan-request-item">
        <h4>Loan ID: ${loanDoc.id}</h4>
        <p><strong>Borrower:</strong> ${borrowerName}</p>
        <p><strong>Guarantor:</strong> ${guarantorName}</p>
        <p><strong>Amount:</strong> ₱${Number(loan.amount).toLocaleString()}</p>
        <p><strong>Purpose:</strong> ${loan.purpose || "Not specified"}</p>
        <p><strong>Terms:</strong> ${loan.termsMonths} month(s) — Schedule: ${loan.paymentSchedule}</p>
        <p><strong>Requested At:</strong> ${submittedDate}</p>

        ${loan.idDocumentUrl ? `<p><a href="${loan.idDocumentUrl}" target="_blank">📷 View ID Document</a></p>` : ""}
        ${loan.coeDocumentUrl ? `<p><a href="${loan.coeDocumentUrl}" target="_blank">📄 View COE Document</a></p>` : ""}

        <div class="actions">
          <button class="approve-loan-btn" data-loan-id="${loanDoc.id}" data-user-id="${loan.userId}">Approve</button>
          <button class="deny-loan-btn" data-loan-id="${loanDoc.id}" data-user-id="${loan.userId}">Deny</button>
        </div>
      </div>
    `;
  }));

  requestsHtml += loanRequestItemsHtml.join(''); // Join the array of HTML strings
  listContainer.innerHTML = requestsHtml;

// ======================================================
// 🔘 APPROVE / DENY LOAN REQUESTS (SAFE EVENT DELEGATION)
// ======================================================

listContainer.addEventListener("click", async (e) => {
  const target = e.target as HTMLElement;

  const loanId = target.dataset.loanId;
  const userId = target.dataset.userId;

  if (!loanId) return;

// =========================
// ✅ APPROVE LOAN
// =========================
if (target.classList.contains("approve-loan-btn")) {
  if (!userId) return;

  console.log("✅ APPROVE CLICKED:", loanId);

  try {
    const loanRef = doc(db, "loanRequests", loanId);
    const loanSnap = await getDoc(loanRef);
    const loanData = loanSnap.data();

    if (!loanData) throw new Error("Loan data missing");

    const amount = loanData.amount ?? 0;
    const terms = loanData.termsMonths ?? 0;
    const schedule = loanData.paymentSchedule ?? "15-30";

    // Compute first due date
    const today = new Date();
    const nextDueDate = new Date(today);

    if (schedule === "15-30") {
      const day = today.getDate();
      if (day <= 15) {
        nextDueDate.setDate(15);
      } else {
        nextDueDate.setMonth(today.getMonth() + 1);
        nextDueDate.setDate(15);
      }
    }

    // 🔍 PRE-FETCH APPROVED MEMBERS
    const membersQuery = query(
      collection(db, "users"),
      where("role", "==", "member"),
      where("status", "==", "approved")
    );

    const membersSnap = await getDocs(membersQuery);

    let totalShares = 0;
    const members: { id: string; share: number }[] = [];

    membersSnap.forEach(d => {
      const data = d.data();
      const share = Number(data.shareBalance ?? 0);
      totalShares += share;
      members.push({ id: d.id, share });
    });

    await runTransaction(db, async (transaction) => {
      const coopRef = doc(db, "coopFinancialSummary", "current_state");
      const coopSnap = await transaction.get(coopRef);

      if (!coopSnap.exists()) {
        throw new Error("Cooperative financial summary not found.");
      }

      const coopData = coopSnap.data();
      const availableFunds = coopData.totalLendableFunds || 0;

      if (availableFunds < amount) {
        throw new Error("Insufficient cooperative funds.");
      }

      // 1️⃣ Update loan request
      transaction.update(loanRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        nextDueDate,
      });

      // 💰 FINANCIAL COMPUTATION
      const monthlyInterestRate = 0.10;

      const { totalInterest, totalPayable, payments, safeTermsMonths } =
        generateRepaymentSchedule(
          amount,
          terms,
          monthlyInterestRate,
          nextDueDate,
          schedule
        );

      // 2️⃣ CREATE ACTIVE LOAN
      const activeLoanRef = doc(db, "activeLoans", loanId);
      const borrowerName = await getUserFullName(userId);

      transaction.set(activeLoanRef, {
        userId,
        borrowerName,
        principal: amount,
        monthlyInterestRate,
        totalInterest,
        totalPayable,
        remainingBalance: amount,
        termsMonths: safeTermsMonths,
        paymentSchedule: schedule,
        nextDueDate,
        status: "active",
        guarantorId: loanData.guarantorId ?? null,
        createdAt: serverTimestamp(),
      });

      // 2.1️⃣ CREATE REPAYMENT SCHEDULE
      payments.forEach((p, index) => {
        const scheduleRef = doc(
          collection(db, "activeLoans", loanId, "schedule")
        );

        transaction.set(scheduleRef, {
          ...p,
          remainingDue: p.totalDue,
          partialPaid: 0,
          paid: false,
          partial: false,
          installmentNumber: index + 1,
          createdAt: serverTimestamp(),
        });
      });

// 🧮 ASSIGN LENDER VOLUME TO GUARANTOR ONLY
const guarantorId = loanData.guarantorId;

if (guarantorId) {
  const guarantorRef = doc(db, "users", guarantorId);

  transaction.update(guarantorRef, {
    lenderVolume: increment(amount),
  });
}

      // 3️⃣ Update borrower
      transaction.update(doc(db, "users", userId), {
        loanBalance: increment(amount),
      });

      // 4️⃣ Update cooperative totals
      transaction.update(coopRef, {
        totalLendableFunds: increment(-amount),
        totalLoanedAmount: increment(amount),
        totalLentVolume: increment(amount),
      });
    });

    alert("✅ Loan approved!");
    loadLoanRequestsUI(adminSectionContent);

  } catch (error: any) {
    console.error(error);
    alert(error.message || "Failed to approve loan.");
  }
}

  // =========================
  // ❌ DENY LOAN
  // =========================
  if (target.classList.contains("deny-loan-btn")) {
    console.log("❌ DENY CLICKED:", loanId);

    if (!confirm("Are you sure you want to deny this loan request?")) return;

    try {
      await updateDoc(doc(db, "loanRequests", loanId), {
        status: "denied",
        deniedAt: serverTimestamp(),
      });

      alert("❌ Loan request denied.");
      loadLoanRequestsUI(adminSectionContent);

    } catch (error: any) {
      console.error(error);
      alert(error.message || "Failed to deny loan.");
    }
  }
});
}

// =====================================================================
// UI Function: Load and display Admin Overview
// =====================================================================
export async function loadOverviewUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);
  await renderFinancialTotalsUI(adminSectionContent);

  const overviewContainer = document.createElement("div");
  overviewContainer.id = "admin-overview-container";
  overviewContainer.innerHTML = "<h3>Admin Overview</h3><p>Loading...</p>";
  adminSectionContent.appendChild(overviewContainer);

  try {
    const summary: DashboardSummary = await getDashboardSummary();
    const totalApprovedMembersCount = await getTotalApprovedMembersCount();
    const pools: CoopFinancialPools = await getCoopFinancialPools();


let overviewHtml = `<h3>Admin Overview</h3>
  <div class="summary-cards-grid">

    <div class="card stat-card">
      <h3>Total Available Funds</h3>
      <p class="amount">₱${summary.totalAvailableFunds.toLocaleString()}</p>
      <span class="label">Funds available for lending.</span>
    </div>

    <div class="card stat-card">
      <h3>Total Loaned Amount</h3>
      <p class="amount">₱${summary.totalLoanedAmount.toLocaleString()}</p>
      <span class="label">Outstanding principal across all loans.</span>
    </div>

    <div class="card stat-card">
      <h3>Approved Members</h3>
      <p class="amount">${totalApprovedMembersCount.toLocaleString()}</p>
      <span class="label">Active cooperative members.</span>
    </div>

    <div class="card stat-card">
      <h3>Pending Users</h3>
      <p class="amount">${summary.totalPendingUsers.toLocaleString()}</p>
      <span class="label">Awaiting admin approval.</span>
    </div>
    <div class="card stat-card">
  <h3>Principal Collected</h3>
  <p class="amount">₱${pools.totalPrincipalCollected.toLocaleString()}</p>
  <span class="label">Loan principal repaid</span>
</div>

<div class="card stat-card">
  <h3>Interest Collected</h3>
  <p class="amount">₱${pools.totalInterestCollected.toLocaleString()}</p>
  <span class="label">Earnings from interest</span>
</div>

<div class="card stat-card">
  <h3>Late Fees</h3>
  <p class="amount">₱${pools.totalLateFeesCollected.toLocaleString()}</p>
  <span class="label">Penalty collections</span>
</div>

<div class="card stat-card">
  <h3>Capital Pool (70%)</h3>
  <p class="amount">₱${pools.capitalPool.toLocaleString()}</p>
  <span class="label">Reinvested funds</span>
</div>

<div class="card stat-card">
  <h3>Effort Pool (30%)</h3>
  <p class="amount">₱${pools.effortPool.toLocaleString()}</p>
  <span class="label">Operations fund</span>
</div>

<div class="card stat-card">
  <h3>Trust Fund (10%)</h3>
  <p class="amount">₱${pools.trustFundBalance.toLocaleString()}</p>
  <span class="label">Risk reserve</span>
</div>

  </div>
`;
    overviewContainer.innerHTML = overviewHtml;

  } catch (error) {
    console.error("🔴 Error loading admin overview summary:", error);
    overviewContainer.innerHTML = `<h3>Admin Overview</h3><p style="color:red;">Error loading summary data.</p>`;
  }
}

// =====================================================
// 💾 SAVE PAYMENT SETTINGS (GCash + Bank + QR Upload)
// =====================================================
async function savePaymentSettings() {
  try {
    const messageEl = document.getElementById("payment-settings-message");

    const methods: any[] = [];

    // ============================
    // SLOT 1 – GCash Marimar
    // ============================
    const m1Name = (document.getElementById("m1-name") as HTMLInputElement)?.value.trim();
    const m1Number = (document.getElementById("m1-number") as HTMLInputElement)?.value.trim();
    const m1QrFile = (document.getElementById("m1-qr") as HTMLInputElement)?.files?.[0];

    let m1QrUrl = "";
    if (m1QrFile) {
      const qrRef = ref(storage, `payment-settings/gcash-marimar.png`);
      await uploadBytes(qrRef, m1QrFile);
      m1QrUrl = await getDownloadURL(qrRef);
    }

    if (m1Name && m1Number) {
      methods.push({
        type: "gcash",
        label: "GCash - Marimar",
        name: m1Name,
        number: m1Number,
        qrUrl: m1QrUrl
      });
    }

    // ============================
    // SLOT 2 – BDO Marimar
    // ============================
    const m2Name = (document.getElementById("m2-name") as HTMLInputElement)?.value.trim();
    const m2Number = (document.getElementById("m2-number") as HTMLInputElement)?.value.trim();
    const m2Bank = (document.getElementById("m2-bank") as HTMLInputElement)?.value.trim();

    if (m2Name && m2Number) {
      methods.push({
        type: "bank",
        label: "BDO - Marimar",
        name: m2Name,
        number: m2Number,
        bankName: m2Bank || "BDO"
      });
    }

    // ============================
    // SLOT 3 – GCash Rodel
    // ============================
    const m3Name = (document.getElementById("m3-name") as HTMLInputElement)?.value.trim();
    const m3Number = (document.getElementById("m3-number") as HTMLInputElement)?.value.trim();
    const m3QrFile = (document.getElementById("m3-qr") as HTMLInputElement)?.files?.[0];

    let m3QrUrl = "";
    if (m3QrFile) {
      const qrRef = ref(storage, `payment-settings/gcash-rodel.png`);
      await uploadBytes(qrRef, m3QrFile);
      m3QrUrl = await getDownloadURL(qrRef);
    }

    if (m3Name && m3Number) {
      methods.push({
        type: "gcash",
        label: "GCash - Rodel",
        name: m3Name,
        number: m3Number,
        qrUrl: m3QrUrl
      });
    }

    // ============================
    // SLOT 4 – Metrobank Rodel
    // ============================
    const m4Name = (document.getElementById("m4-name") as HTMLInputElement)?.value.trim();
    const m4Number = (document.getElementById("m4-number") as HTMLInputElement)?.value.trim();
    const m4Bank = (document.getElementById("m4-bank") as HTMLInputElement)?.value.trim();

    if (m4Name && m4Number) {
      methods.push({
        type: "bank",
        label: "Metrobank - Rodel",
        name: m4Name,
        number: m4Number,
        bankName: m4Bank || "Metrobank"
      });
    }

    // ============================
    // SAVE TO FIRESTORE
    // ============================
    const settingsRef = doc(db, "paymentSettings", "main");

    await setDoc(
      settingsRef,
      {
        methods,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    if (messageEl) {
      messageEl.textContent = "✅ Payment methods saved successfully!";
      messageEl.style.color = "green";
    }

    alert("✅ Payment methods saved!");

  } catch (error) {
    console.error("❌ Failed saving payment settings:", error);
    alert("Failed to save payment settings. Check console.");
  }
}

// =====================================================================
// Initialize Admin Dashboard (called by main.ts after admin login)
// =====================================================================
export async function initAdminDashboard() {
  console.log("Admin Dashboard Initializing (after login)");

  // Select DOM elements here, when initAdminDashboard is called and elements are guaranteed to exist
  adminSectionContent = document.getElementById("admin-section-content");
  adminDashboardLayout = document.getElementById("admin-dashboard-layout");
  adminSidebar = document.getElementById("admin-sidebar");
  globalToggleSidebarBtn = document.getElementById("global-toggle-sidebar-btn");

  overviewTabBtn = document.getElementById("overview-tab");
  allLoansTabBtn = document.getElementById("all-loans-tab");
  repaymentsTabBtn = document.getElementById("repayments-tab");
  pendingUsersTabBtn = document.getElementById("pending-users-tab");
  approvedUsersTabBtn = document.getElementById("approved-users-tab");
  approvedBorrowersTabBtn = document.getElementById("approved-borrowers-tab");
  loanRequestsTabBtn = document.getElementById("pending-loan-requests-tab");
  paymentSettingsTabBtn = document.getElementById("payment-settings-tab");
  paSwipeManagerTabBtn = document.getElementById("pa-swipe-manager-tab");
  paSwipeRequestsTabBtn = document.getElementById("pa-swipe-requests-tab");
  paSwipeCollectionsTabBtn = document.getElementById("pa-swipe-collections-tab");
  paSwipeContractsAdminTabBtn = document.getElementById("pa-swipe-contracts-admin-tab");
  creditCartRequestsTabBtn = document.getElementById("credit-cart-requests-tab");
creditCartCollectionsTabBtn = document.getElementById("credit-cart-collections-tab");
creditCartContractsAdminTabBtn = document.getElementById("credit-cart-contracts-admin-tab");
pabentaShopsAdminTabBtn = document.getElementById("pabenta-shops-admin-tab");
pabentaListingsAdminTabBtn = document.getElementById("pabenta-listings-admin-tab");
  console.log("✅ paSwipeRequestsTabBtn found?", !!paSwipeRequestsTabBtn);
  globalLogoutBtn = document.getElementById("global-logout-btn");

// ================================
// 📂 SIDEBAR GROUP COLLAPSE/EXPAND
// ================================
document.querySelectorAll<HTMLButtonElement>(".nav-group-header").forEach((header) => {
  header.addEventListener("click", () => {
    const groupName = header.dataset.group;
    const itemsEl = document.querySelector(`[data-group-items="${groupName}"]`) as HTMLElement | null;
    if (!itemsEl) return;

    const isCollapsed = itemsEl.classList.toggle("collapsed");
    header.classList.toggle("collapsed", isCollapsed);
  });
});

// Collapse groups that don't contain the currently active tab (nice UX default)
document.querySelectorAll<HTMLElement>(".nav-group-items").forEach((itemsEl) => {
  const hasActive = itemsEl.querySelector(".tab-button.active");
  if (!hasActive) {
    itemsEl.classList.add("collapsed");
    (itemsEl.previousElementSibling as HTMLElement | null)?.classList.add("collapsed");
  }
});


  // Collection Modal elements
  collectionModal = document.getElementById("collection-modal") as HTMLElement;
  collectionModalCloseBtn = document.getElementById("collection-modal-close");
  modalMemberNameSpan = document.getElementById("modal-member-name");
  modalMonthsInput = document.getElementById("modal-months-input") as HTMLInputElement;
  modalMonthSelect = document.getElementById("modal-month-select") as HTMLSelectElement;
  modalYearInput = document.getElementById("modal-year-input") as HTMLInputElement;
  modalCollectConfirmBtn = document.getElementById("modal-collect-confirm-btn");
  modalmonthlyShareCommitmentDisplay = document.getElementById("modal-monthly-commitment-display");
  modalSetToCommitmentBtn = document.getElementById("modal-set-to-commitment-btn");


  // Receipt Modal elements
  receiptModal = document.getElementById("receipt-modal") as HTMLElement;
  receiptModalCloseBtn = document.getElementById("receipt-modal-close");
  receiptContentPre = document.getElementById("receipt-content");
  copyReceiptBtn = document.getElementById("copy-receipt-btn");

  // ===============================
// ✅ Role Confirmation Modal Setup
// ===============================
roleConfirmModal = document.getElementById("role-confirm-modal");
roleConfirmCloseBtn = document.getElementById("role-confirm-close-btn");
roleConfirmName = document.getElementById("role-confirm-name");
roleConfirmEmail = document.getElementById("role-confirm-email");
roleConfirmSelect = document.getElementById("role-confirm-select") as HTMLSelectElement;
roleConfirmApproveBtn = document.getElementById("role-confirm-approve-btn");

// ===============================
// ✅ Change Role Modal Setup
// ===============================
changeRoleModal = document.getElementById("change-role-modal");
changeRoleCloseBtn = document.getElementById("change-role-close-btn");
changeRoleName = document.getElementById("change-role-name");
changeRoleEmail = document.getElementById("change-role-email");
changeRoleCurrentRole = document.getElementById("change-role-current-role");
changeRoleSelect = document.getElementById("change-role-select") as HTMLSelectElement;
changeRoleConfirmBtn = document.getElementById("change-role-confirm-btn");

// Close
changeRoleCloseBtn?.addEventListener("click", closeChangeRoleModal);

// Confirm
changeRoleConfirmBtn?.addEventListener("click", async () => {
  if (!currentApprovedUser || !changeRoleSelect) return;

  const uid = currentApprovedUser.id;
  const oldRole = currentApprovedUser.role;
  const newRole = changeRoleSelect.value as "member" | "borrower";

  try {
    (changeRoleConfirmBtn as HTMLButtonElement).disabled = true;

    if (oldRole === newRole) {
      alert("No changes made.");
      closeChangeRoleModal();
      return;
    }

// ✅ SAFETY: block ANY role change if active loan exists
const hasLoan = await memberHasActiveLoan(uid);
if (hasLoan) {
  alert("⛔ Cannot change role while user has an active loan.");
  return;
}

    await adminUpdateUserRole(uid, newRole);

    alert(`✅ Role changed to ${newRole}`);
    closeChangeRoleModal();

    if (changeRoleReturnTab === "members") {
      await loadApprovedMembersUI(adminSectionContent!);
      setActiveTab(approvedUsersTabBtn!);
    } else {
      await loadApprovedBorrowersUI(adminSectionContent!);
      setActiveTab(approvedBorrowersTabBtn!);
    }
  } catch (err) {
    console.error("❌ Failed changing role:", err);
    alert("Failed to change role. Check console.");
  } finally {
    (changeRoleConfirmBtn as HTMLButtonElement).disabled = false;
  }
});

console.log("roleConfirmModal:", roleConfirmModal);
console.log("roleConfirmName:", roleConfirmName);
console.log("roleConfirmEmail:", roleConfirmEmail);
console.log("roleConfirmSelect:", roleConfirmSelect);
console.log("roleConfirmApproveBtn:", roleConfirmApproveBtn);

// Close button
roleConfirmCloseBtn?.addEventListener("click", closeRoleConfirmModal);

// Approve button
roleConfirmApproveBtn?.addEventListener("click", async () => {
  if (!currentPendingUser || !roleConfirmSelect) return;

  const uid = currentPendingUser.id;
  const selectedRole = roleConfirmSelect.value as "member" | "borrower";

  try {
    await approvePendingUserWithRole(uid, selectedRole);

    closeRoleConfirmModal();

    await loadPendingUsersUI(adminSectionContent!);

    alert(`✅ User approved as ${selectedRole}`);
  } catch (err) {
    console.error("❌ Failed to approve user:", err);
    alert("Failed to approve user.");
  }
});

  // --- Validate elements exist ---
  if (!adminSectionContent) { console.error("🔴 adminSectionContent not found!"); return; }
  if (!adminDashboardLayout) { console.error("🔴 adminDashboardLayout not found!"); return; }
  if (!adminSidebar) { console.error("🔴 adminSidebar not found!"); return; }
  if (!globalToggleSidebarBtn) { console.error("🔴 globalToggleSidebarBtn not found!"); return; }
  if (!overviewTabBtn) { console.error("🔴 overviewTabBtn not found!"); return; }
  if (!pendingUsersTabBtn) { console.error("🔴 pendingUsersTabBtn not found!"); return; }
  if (!approvedUsersTabBtn) { console.error("🔴 approvedUsersTabBtn not found!"); return; }
  if (!approvedBorrowersTabBtn) { console.error("🔴 approvedBorrowersTabBtn not found!"); return; }
  if (!loanRequestsTabBtn) { console.error("🔴 loanRequestsTabBtn not found!"); return; }
  if (!paymentSettingsTabBtn) { console.error("🔴 paymentSettingsTabBtn not found!"); return; }
 if (!paSwipeManagerTabBtn) {
  console.warn("🟡 paSwipeManagerTabBtn not found — skipping setup.");
}
if (!paSwipeRequestsTabBtn) {
  console.warn("🟡 paSwipeRequestsTabBtn not found — skipping setup.");
}
  if (!globalLogoutBtn) { console.error("🔴 globalLogoutBtn not found!"); return; }
  if (!collectionModal) { console.error("🔴 collectionModal not found!"); return; }
  if (!collectionModalCloseBtn) { console.error("🔴 collectionModalCloseBtn not found!"); return; }
  if (!modalMonthsInput) { console.error("🔴 modalMonthsInput not found!"); return; }
  if (!modalMonthSelect) { console.error("🔴 modalMonthSelect not found!"); return; }
  if (!modalYearInput) { console.error("🔴 modalYearInput not found!"); return; }
  if (!modalCollectConfirmBtn) { console.error("🔴 modalCollectConfirmBtn not found!"); return; }
  if (!receiptModal) { console.error("🔴 receiptModal not found!"); return; }
  if (!receiptModalCloseBtn) { console.error("🔴 receiptModalCloseBtn not found!"); return; }
  if (!receiptContentPre) { console.error("🔴 receiptContentPre not found!"); return; }
  if (!copyReceiptBtn) { console.error("🔴 copyReceiptBtn not found!"); return; }
  if (!modalmonthlyShareCommitmentDisplay) { console.error("🔴 modalmonthlyShareCommitmentDisplay not found!"); return; }
  if (!modalSetToCommitmentBtn) { console.error("🔴 modalSetToCommitmentBtn not found!"); return; }
if (!changeRoleModal) { console.error("🔴 changeRoleModal not found!"); return; }
if (!changeRoleCloseBtn) { console.error("🔴 changeRoleCloseBtn not found!"); return; }
if (!changeRoleSelect) { console.error("🔴 changeRoleSelect not found!"); return; }
if (!changeRoleConfirmBtn) { console.error("🔴 changeRoleConfirmBtn not found!"); return; }


  // --- Modal Event Listeners ---
collectionModalCloseBtn!.addEventListener("click", closeCollectionModal);
receiptModalCloseBtn!.addEventListener("click", async () => {
  isReceiptOpen = false; // ✅ UNLOCK UI
  closeReceiptModal();

  // ✅ NOW it is safe to refresh the UI
  await loadApprovedMembersUI(adminSectionContent!);
  setActiveTab(approvedUsersTabBtn!);
});


modalSetToCommitmentBtn!.addEventListener("click", () => {
  if (modalMonthsInput && currentMembermonthlyShareCommitment !== null) {
    const monthsFromCommitment = currentMembermonthlyShareCommitment / 1000;
    if (monthsFromCommitment > 0) {
      modalMonthsInput.value = monthsFromCommitment.toString();
    } else {
      modalMonthsInput.value = "1";
    }
  }
});

modalCollectConfirmBtn!.onclick = async () => {
  if (modalCollectConfirmBtn!.getAttribute("data-busy") === "true") return;

  modalCollectConfirmBtn!.setAttribute("data-busy", "true");
  modalCollectConfirmBtn!.textContent = "Processing...";

  try {
    if (
      !currentMemberIdForCollection ||
      !modalMonthsInput ||
      !modalMonthSelect ||
      !modalYearInput
    ) {
      alert("Member ID, commitment amount, month, or year not set for collection.");
      return;
    }

    const numberOfSharesCommitted = parseInt(modalMonthsInput.value, 10);
    const month = parseInt(modalMonthSelect.value, 10);
    const year = parseInt(modalYearInput.value, 10);
    // ✅ STEP 1: Capture values for receipt BEFORE modal closes
const receiptMonth = month;
const receiptYear = year;
const receiptMemberId = currentMemberIdForCollection;

    const amountToCollect = numberOfSharesCommitted * 1000;
    const monthsPaidForReceipt = 1;

    if (
      isNaN(numberOfSharesCommitted) || numberOfSharesCommitted < 1 ||
      isNaN(month) || month < 1 || month > 12 ||
      isNaN(year) || year < 1900
    ) {
      alert("Please enter a valid number of shares, month, and year.");
      return;
    }

    // ==================================================
    // 🔴 CRITICAL SECTION — MONEY + FIRESTORE ONLY
    // ==================================================
    try {
      await collectShare(
        currentMemberIdForCollection,
        monthsPaidForReceipt,
        month,
        year,
        amountToCollect
      );
    } catch (err) {
      console.error("❌ Share collection failed:", err);
      alert("❌ Failed to collect share. No changes were saved.");
      return; // ⛔ STOP — nothing else should run
    }

// ==================================================
// 🧾 RECEIPT (isolated — UI errors won’t affect it)
// ==================================================
try {
  const userRef = doc(db, "users", receiptMemberId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error("User document not found for receipt.");
  }

  const userData = userSnap.data();

  const resolvedMemberName =
    userData.fullName ||
    `${userData.firstName ?? ""} ${userData.lastName ?? ""}`.trim() ||
    userData.email ||
    "Member";

const receiptText = generateReceipt(
  resolvedMemberName,
  receiptMemberId!,   // ✅ from Step 1
  amountToCollect,
  monthsPaidForReceipt,
  receiptMonth,       // ✅ from Step 1
  receiptYear         // ✅ from Step 1
);

  if (receiptText && receiptText.length > 0) {
  openReceiptModal(receiptText);
  closeCollectionModal();

} else {
  console.warn("⚠️ Receipt text empty — modal not opened");
}

} catch (err) {
  console.warn("⚠️ Receipt generation failed:", err);
  // 🚫 no alert — collection already succeeded
}

  } finally {
    modalCollectConfirmBtn!.removeAttribute("data-busy");
    modalCollectConfirmBtn!.textContent = "Confirm Collection";
  }
};


copyReceiptBtn!.addEventListener("click", async () => {
  if (receiptContentPre && receiptContentPre!.textContent) {
    try {
      await navigator.clipboard.writeText(receiptContentPre!.textContent);
      copyReceiptBtn!.textContent = "Copied!";
      setTimeout(() => {
        copyReceiptBtn!.textContent = "Copy to Clipboard";
      }, 2000);
    } catch (err) {
      console.error("Failed to copy receipt text: ", err);
      copyReceiptBtn!.textContent = "Copy failed";
    }
  }
});
// --- END Modal Event Listeners ---

// Default to showing overview first upon admin dashboard load
if (!isReceiptOpen) {
  loadOverviewUI(adminSectionContent!);
}

// 🔹 TAB BUTTON CLICK EVENTS - Consolidated

// 🛒 Pa-Swipe Manager Tab
paSwipeManagerTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return; // ⛔ block while receipt is open

  console.log("🛒 Pa-Swipe Manager clicked");
  setActiveTab(paSwipeManagerTabBtn!);
  autoCloseSidebar();
  initPaSwipeManager(adminSectionContent!);
});

paSwipeRequestsTabBtn?.addEventListener("click", () => {
  console.log("✅ CLICK FIRED: paSwipeRequestsTabBtn");
  if (isReceiptOpen) return;

  console.log("🧾 Pa-Swipe Requests clicked");
  setActiveTab(paSwipeRequestsTabBtn!);
  autoCloseSidebar();
  initPaSwipeRequestsAdmin(adminSectionContent!);
});

paSwipeCollectionsTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;

  console.log("💳 Pa-Swipe Collections clicked");
  setActiveTab(paSwipeCollectionsTabBtn!);
  autoCloseSidebar();
  initPaSwipeCollectionsAdmin(adminSectionContent!);
});

paSwipeContractsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(paSwipeContractsAdminTabBtn!);
  autoCloseSidebar();
  initPaSwipeContractsAdmin(adminSectionContent!);
});

creditCartRequestsTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(creditCartRequestsTabBtn!);
  autoCloseSidebar();
  initCreditCartRequestsAdmin(adminSectionContent!);
});

creditCartCollectionsTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(creditCartCollectionsTabBtn!);
  autoCloseSidebar();
  initCreditCartCollectionsAdmin(adminSectionContent!);
});

creditCartContractsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(creditCartContractsAdminTabBtn!);
  autoCloseSidebar();
  initCreditCartContractsAdmin(adminSectionContent!);
});

pabentaShopsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(pabentaShopsAdminTabBtn!);
  autoCloseSidebar();
  initPaBentaShopsAdmin(adminSectionContent!);
});

pabentaListingsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(pabentaListingsAdminTabBtn!);
  autoCloseSidebar();
  initPaBentaListingsAdmin(adminSectionContent!);
});

overviewTabBtn!.addEventListener("click", () => {
  if (isReceiptOpen) return; // ⛔ BLOCK while receipt is open
  console.log("Overview tab clicked");
  setActiveTab(overviewTabBtn!);
  autoCloseSidebar();
  loadOverviewUI(adminSectionContent!);
});

pendingUsersTabBtn!.addEventListener("click", () => {
  console.log("Pending Users tab clicked");
  setActiveTab(pendingUsersTabBtn!);
  autoCloseSidebar();
  loadPendingUsersUI(adminSectionContent!);
});

approvedUsersTabBtn!.addEventListener("click", () => {
  console.log("Approved Users tab clicked");
  setActiveTab(approvedUsersTabBtn!);
  autoCloseSidebar();
  loadApprovedMembersUI(adminSectionContent!);
});

// PHASE 5 ADDITION: Event listener for Approved Borrowers tab
approvedBorrowersTabBtn!.addEventListener("click", () => {
  console.log("Approved Borrowers tab clicked");
  setActiveTab(approvedBorrowersTabBtn!);
  autoCloseSidebar();
  loadApprovedBorrowersUI(adminSectionContent!);
});

// Loan Requests
loanRequestsTabBtn!.addEventListener("click", () => {
  console.log("Loan Requests clicked");
  setActiveTab(loanRequestsTabBtn!);
  autoCloseSidebar();
  loadLoanRequestsUI(adminSectionContent!);
});

// 🟣 All Loans Tab
allLoansTabBtn?.addEventListener("click", () => {
  console.log("All Loans clicked");
  setActiveTab(allLoansTabBtn!);
  autoCloseSidebar();
  loadAllLoansUI(adminSectionContent!);
});


// 💸 Repayments Tab

repaymentsTabBtn?.addEventListener("click", () => {
  console.log("➡️ Repayments tab clicked");
  setActiveTab(repaymentsTabBtn!);
  autoCloseSidebar();

  onAuthStateChanged(auth, (user) => {
    if (!user) {
      console.warn("⛔ Not logged in yet — stopping Repayments load.");
      alert("Please log in again to continue.");
      return;
    }

    console.log("🔥 Auth confirmed:", user.uid);
    loadRepaymentsUI(adminSectionContent!);
  });
});

// 💳 Payment Settings Tab
paymentSettingsTabBtn?.addEventListener("click", () => {
  console.log("💳 Payment Settings clicked");
  setActiveTab(paymentSettingsTabBtn!);
  autoCloseSidebar();

adminSectionContent!.innerHTML = `
  <h3>💳 Payment Settings</h3>
  <p>Configure all cooperative payment channels.</p>

  <div class="card" style="max-width:800px;">

    <!-- SLOT 1 -->
    <h4>🍀 GCash – Marimar</h4>
    <input id="m1-name" placeholder="Account Name" />
    <input id="m1-number" placeholder="Account Number" />
    <input id="m1-qr" type="file" accept="image/*" />
    <hr/>

    <!-- SLOT 2 -->
    <h4>🏦 BDO – Marimar</h4>
    <input id="m2-name" placeholder="Account Name" />
    <input id="m2-number" placeholder="Account Number" />
    <input id="m2-bank" placeholder="Bank Name (BDO)" />
    <hr/>

    <!-- SLOT 3 -->
    <h4>☘️ GCash – Rodel</h4>
    <input id="m3-name" placeholder="Account Name" />
    <input id="m3-number" placeholder="Account Number" />
    <input id="m3-qr" type="file" accept="image/*" />
    <hr/>

    <!-- SLOT 4 -->
    <h4>🏦 Metrobank – Rodel</h4>
    <input id="m4-name" placeholder="Account Name" />
    <input id="m4-number" placeholder="Account Number" />
    <input id="m4-bank" placeholder="Bank Name (Metrobank)" />

    <br/><br/>
    <button id="save-payment-settings-btn" class="primary">
      💾 Save All Payment Methods
    </button>

    <p id="payment-settings-message"></p>

  </div>
`;

  setTimeout(() => {
    const saveBtn = document.getElementById("save-payment-settings-btn");
    saveBtn?.addEventListener("click", savePaymentSettings);
  }, 0);
});

// LOGOUT (already global, but safe to add listener again if needed)
globalLogoutBtn!.addEventListener("click", logout);

// ✅ Auto close sidebar helper
function autoCloseSidebar() {
  if (!adminSidebar || !adminDashboardLayout || !globalToggleSidebarBtn) return;

  adminSidebar.classList.add("collapsed");
  adminDashboardLayout.classList.add("sidebar-collapsed");
  globalToggleSidebarBtn.textContent = "☰";
}

// Helper function to set the active tab visual state
function setActiveTab(clickedButton: HTMLElement) {
  if (isReceiptOpen) return; // ⛔ BLOCK tab switching
  document.querySelectorAll("#admin-nav-links .tab-button").forEach(button => {
    button.classList.remove("active");
  });
  clickedButton.classList.add("active");
}

// Set the default active tab on first load
setActiveTab(overviewTabBtn!)
}