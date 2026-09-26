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
  backfillLegacyAgreements,
  type LegacyBackfillResult,
  backfillMissingLoanContracts,
  type LoanContractsBackfillResult,
} from "../services/adminService";
import { getUserFullName } from "../services/userUtils";
import { DEFAULT_CREDIT_SCORE, computeEffectivePriority } from "../services/creditEngine";
import {
  TRUST_FUND_EXPENSE_CATEGORIES,
  recordTrustFundExpense,
  getTrustFundExpenses,
} from "../services/trustFundService";
import {
  computeFiscalYearPayoutPreview,
  releaseFiscalYearPayout,
  getPayoutHistory,
} from "../services/payoutService";
import {
  type BusinessKey,
  getBusinessLabel,
  getBusinessProfitSummary,
  getBusinessInterestForYear,
  recordBusinessWithdrawal,
  getBusinessPayoutHistory,
} from "../services/businessProfitService";
import { getFiscalYearStart } from "../services/fiscalShareSchedule";
import { getSharePrepaymentStatus } from "../services/fiscalShareSchedule";
import { getUserProfile } from "../services/userService";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";
import { generateLoanContract } from "../utils/generateLoanContract";
import { initLoanContractsAdmin } from "./loanContractsAdmin";
import { initLoanAgreementsAdmin } from "./loanAgreementsAdmin";
import { initPaSwipeAgreementsAdmin } from "./paSwipeAgreementsAdmin";
import { initCreditCartAgreementsAdmin } from "./creditCartAgreementsAdmin";
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
import { markUserInactive, reactivateUser, type MarkInactiveResult } from "../services/loanService";
import { loadRepaymentsUI } from "./repayments";
import { initPaSwipeCollectionsAdmin } from "./paSwipeCollectionsAdmin";
import { initPaSwipeContractsAdmin } from "./paSwipeContractsAdmin";
import { initCreditCartRequestsAdmin } from "./creditCartRequestsAdmin";
import { initCreditCartCollectionsAdmin } from "./creditCartCollectionsAdmin";
import { initCreditCartContractsAdmin } from "./creditCartContractsAdmin";
import { initPaBentaShopsAdmin } from "./paBentaShopsAdmin";
import { initPaBentaListingsAdmin } from "./paBentaListingsAdmin";
import { collection, query, where, getDocs, doc, getDoc, increment, runTransaction, serverTimestamp, updateDoc, setDoc, deleteDoc } from "firebase/firestore";
console.log("AUTH EMAIL:", getAuth().currentUser?.email);


const storage = getStorage();

console.log("🔥 adminService.ts LOADED");

// import { loadAllLoansUI } from "./allLoans";
console.log("🔥 CONNECTED TO FIREBASE PROJECT:", app.options);
import { setLogLevel } from "firebase/firestore";
setLogLevel("debug");
import { initPaSwipeManager } from "./paSwipeManager";
import { initPaSwipeRequestsAdmin } from "./paSwipeRequestsAdmin";
import { initAffiliateApplicationsAdmin, initAffiliatePayoutsAdmin } from "./affiliateAdmin";
import {
  getInviteForRequest,
  isGuarantorFullyVerified,
  describeGuarantorStatus,
  approveGuarantorVerification,
  rejectGuarantorVerification,
  buildGuarantorActivationLink,
} from "../services/securityGuarantorService";
import {
  requiresSecurityGuarantor,
  SECURITY_GUARANTOR_THRESHOLD,
  type GuarantorInfoInput,
} from "../services/securityGuarantorService";
import { adminSubmitLoanRequest, adminLinkLoanRequestToAccount, adminAttachSecurityGuarantor } from "../services/loanService";

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
let creditLimitsTabBtn: HTMLElement | null = null;
let trustFundTabBtn: HTMLElement | null = null;
let fiscalPayoutTabBtn: HTMLElement | null = null;
let paSwipeEarningsTabBtn: HTMLElement | null = null;
let creditCartEarningsTabBtn: HTMLElement | null = null;
let paSwipeManagerTabBtn: HTMLElement | null = null;
let paSwipeRequestsTabBtn: HTMLElement | null = null;
let paSwipeCollectionsTabBtn: HTMLElement | null = null;
if (!paSwipeRequestsTabBtn) { console.warn("🟡 paSwipeRequestsTabBtn not found — skipping setup."); }
let globalLogoutBtn: HTMLElement | null = null;
let paSwipeContractsAdminTabBtn: HTMLElement | null = null;
let loanContractsAdminTabBtn: HTMLElement | null = null;
let loanAgreementsAdminTabBtn: HTMLElement | null = null;
let paSwipeAgreementsAdminTabBtn: HTMLElement | null = null;
let creditCartAgreementsAdminTabBtn: HTMLElement | null = null;
let creditCartRequestsTabBtn: HTMLElement | null = null;
let creditCartCollectionsTabBtn: HTMLElement | null = null;
let creditCartContractsAdminTabBtn: HTMLElement | null = null;
let pabentaShopsAdminTabBtn: HTMLElement | null = null;
let pabentaListingsAdminTabBtn: HTMLElement | null = null;
let affiliateApplicationsTabBtn: HTMLElement | null = null;
let affiliatePayoutsTabBtn: HTMLElement | null = null;

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
    membershipStatus: d.data().membershipStatus || "active",
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
    membershipStatus: d.data().membershipStatus || "active",
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

// =====================================================================
// 💰 CREDIT LIMITS — single page listing every approved member AND
// borrower with an inline-editable loanLimit field, so admin never has
// to open the Firestore console and hunt for a user's doc by ID just to
// change their credit limit.
// =====================================================================
async function updateUserLoanLimit(userId: string, newLimit: number) {
  const userRef = doc(db, "users", userId);
  await updateDoc(userRef, {
    loanLimit: newLimit,
    updatedAt: serverTimestamp(),
  });
}

export async function loadCreditLimitsUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);

  const wrapper = document.createElement("div");
  wrapper.id = "credit-limits-container";
  wrapper.innerHTML = `
    <h3>💰 Credit Limits</h3>
    <p class="muted">Edit any member or borrower's credit limit directly — no need to look up their user ID in Firestore.</p>
    <input
      id="credit-limit-search"
      type="text"
      placeholder="🔍 Search by name or email..."
      style="width:100%; max-width:400px; padding:8px; margin-bottom:14px;"
    />
    <div id="credit-limit-rows"><p>Loading...</p></div>
  `;
  adminSectionContent.appendChild(wrapper);

  const [members, borrowers] = await Promise.all([
    getApprovedMembers(),
    getApprovedBorrowers(),
  ]);

  const allUsers = [...members, ...borrowers].sort((a, b) =>
    (a.fullName || "").localeCompare(b.fullName || "")
  );

  const rowsEl = wrapper.querySelector("#credit-limit-rows") as HTMLElement;

  if (allUsers.length === 0) {
    rowsEl.innerHTML = "<p>No approved members or borrowers found.</p>";
    return;
  }

  function renderRows(users: UserProfile[]) {
    if (users.length === 0) {
      rowsEl.innerHTML = "<p>No matching members or borrowers.</p>";
      return;
    }

    rowsEl.innerHTML = users.map((u) => `
      <div class="credit-limit-row" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:10px 12px; border:1px solid #eee; border-radius:8px; margin-bottom:8px;">
        <div>
          <strong>${u.fullName}</strong>
          <span class="loan-badge" style="margin-left:6px;">${u.role}</span>
          ${u.membershipStatus === "inactive" ? `<span class="loan-badge inactive-badge" style="margin-left:6px;">🚪 Inactive</span>` : ""}
          <span class="priority-badge" style="margin-left:6px;background:${Number(u.creditScore ?? DEFAULT_CREDIT_SCORE) >= 90 ? "#e6f4ea" : Number(u.creditScore ?? DEFAULT_CREDIT_SCORE) >= 70 ? "#fff3cd" : "#fdecea"};color:${Number(u.creditScore ?? DEFAULT_CREDIT_SCORE) >= 90 ? "#1e7e34" : Number(u.creditScore ?? DEFAULT_CREDIT_SCORE) >= 70 ? "#7a5b00" : "#a12e21"};">🏆 Credit Score: ${Number(u.creditScore ?? DEFAULT_CREDIT_SCORE)}</span>
          <div class="muted" style="font-size:12px;">${u.email}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span>Credit Limit: ₱</span>
          <input
            type="number"
            class="credit-limit-input"
            value="${u.loanLimit ?? 0}"
            min="0"
            step="500"
            data-user-id="${u.id}"
            style="width:110px;"
          />
          <button class="save-credit-limit-btn" data-user-id="${u.id}">Save</button>
        </div>
      </div>
    `).join("");
  }

  renderRows(allUsers);

  // 🔍 Client-side search filter (name or email), no re-fetch needed
  const searchInput = wrapper.querySelector("#credit-limit-search") as HTMLInputElement;
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) {
      renderRows(allUsers);
      return;
    }
    const filtered = allUsers.filter((u) =>
      (u.fullName || "").toLowerCase().includes(term) ||
      (u.email || "").toLowerCase().includes(term)
    );
    renderRows(filtered);
  });

  // 💾 Save handler (event delegation so it survives re-renders from search)
  rowsEl.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest(".save-credit-limit-btn") as HTMLButtonElement | null;
    if (!btn) return;

    const userId = btn.dataset.userId!;
    const input = btn.previousElementSibling as HTMLInputElement;
    const newLimit = Number(input.value);

    if (!Number.isFinite(newLimit) || newLimit < 0) {
      alert("Please enter a valid credit limit.");
      return;
    }

    btn.disabled = true;
    const oldLabel = btn.textContent;
    btn.textContent = "Saving...";

    try {
      await updateUserLoanLimit(userId, newLimit);
      // reflect the saved value in our in-memory list too, so search
      // filtering afterward doesn't show a stale amount
      const u = allUsers.find((x) => x.id === userId);
      if (u) u.loanLimit = newLimit;

      btn.textContent = "✅ Saved";
      setTimeout(() => {
        btn.textContent = oldLabel || "Save";
        btn.disabled = false;
      }, 1200);
    } catch (error) {
      console.error("❌ Error updating credit limit:", error);
      alert("Failed to update credit limit. Check console for details.");
      btn.textContent = oldLabel || "Save";
      btn.disabled = false;
    }
  });
}

// =====================================================================
// 🏦 TRUST FUND — expense/liquidation log. Unlike Capital Pool, Effort
// Pool and share contributions (which reset to 0 at the fiscal year-end
// payout), the Trust Fund carries over — it's drawn down over time by
// recording actual coop expenses here (with an optional receipt photo),
// for member transparency. Every signed-in user can view this list;
// only admin can add to it, and entries are never edited or deleted.
// =====================================================================
export async function loadTrustFundUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);

  const wrapper = document.createElement("div");
  wrapper.id = "trust-fund-container";
  wrapper.innerHTML = `
    <h3>🏦 Trust Fund</h3>
    <p class="muted">The coop's risk-protection reserve. Record every expense paid from it here — with a receipt when you have one — so the balance stays transparent to members. This carries over year to year; it is NOT reset at the fiscal year-end payout.</p>
    <p style="font-size:22px;font-weight:700;margin:10px 0 18px;" id="trust-fund-balance-display">Loading...</p>

    <div style="border:1px solid #ddd;border-radius:12px;padding:14px 16px;max-width:520px;margin-bottom:24px;">
      <h4 style="margin-top:0;">➕ Record an Expense</h4>
      <label>Description</label>
      <input id="tf-expense-description" type="text" placeholder="e.g. Claude Pro subscription, CDA registration fee" style="width:100%;margin-bottom:8px;" />
      <label>Category</label>
      <select id="tf-expense-category" style="width:100%;margin-bottom:8px;">
        <option value="">— Select —</option>
        ${TRUST_FUND_EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
      </select>
      <label>Amount (₱)</label>
      <input id="tf-expense-amount" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;margin-bottom:8px;" />
      <label>Date</label>
      <input id="tf-expense-date" type="date" style="width:100%;margin-bottom:8px;" />
      <label>Receipt / Proof of Payment (optional)</label>
      <input id="tf-expense-receipt" type="file" accept="image/*,application/pdf" style="width:100%;margin-bottom:4px;" />
      <p class="muted" style="font-size:12px;margin:0 0 10px;">No formal receipt? A screenshot of the bank transaction/confirmation works too — the description above is what explains what it was for. You can also leave this blank entirely if nothing is available.</p>
      <button id="tf-expense-submit-btn" type="button" class="request-loan-btn">Record Expense</button>
      <p id="tf-expense-message" style="margin-top:8px;font-size:13px;"></p>
    </div>

    <h4>Liquidation Log</h4>
    <div id="trust-fund-expense-list"><p>Loading...</p></div>
  `;
  adminSectionContent.appendChild(wrapper);

  const dateInput = wrapper.querySelector("#tf-expense-date") as HTMLInputElement;
  dateInput.value = new Date().toISOString().slice(0, 10);

  async function refreshBalance() {
    const summarySnap = await getDoc(doc(db, "coopFinancialSummary", "current_state"));
    const balance = Number(summarySnap.data()?.trustFundBalance ?? 0);
    const balanceEl = wrapper.querySelector("#trust-fund-balance-display") as HTMLElement;
    balanceEl.textContent = `Current Balance: ₱${balance.toLocaleString()}`;
  }

  async function refreshExpenseList() {
    const listEl = wrapper.querySelector("#trust-fund-expense-list") as HTMLElement;
    const expenses = await getTrustFundExpenses();

    if (expenses.length === 0) {
      listEl.innerHTML = "<p>No expenses recorded yet.</p>";
      return;
    }

    const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

    listEl.innerHTML = `
      <p class="muted" style="margin-top:-4px;">Total liquidated: ₱${totalSpent.toLocaleString()} across ${expenses.length} expense${expenses.length === 1 ? "" : "s"}.</p>
      ${expenses.map((e) => {
        const dateStr = e.expenseDate?.toDate ? e.expenseDate.toDate().toLocaleDateString() : "—";
        const recordedStr = e.createdAt?.toDate ? e.createdAt.toDate().toLocaleString() : "";
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:10px 12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;">
            <div>
              <strong>${e.description}</strong>
              <span class="loan-badge" style="margin-left:6px;">${e.category}</span>
              <div class="muted" style="font-size:12px;">${dateStr} · Recorded by ${e.recordedByName}${recordedStr ? ` on ${recordedStr}` : ""}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <strong>₱${Number(e.amount ?? 0).toLocaleString()}</strong>
              ${e.receiptUrl ? `<a href="${e.receiptUrl}" target="_blank">🧾 Receipt</a>` : `<span class="muted" style="font-size:12px;">No receipt</span>`}
            </div>
          </div>
        `;
      }).join("")}
    `;
  }

  await Promise.all([refreshBalance(), refreshExpenseList()]);

  const submitBtn = wrapper.querySelector("#tf-expense-submit-btn") as HTMLButtonElement;
  const messageEl = wrapper.querySelector("#tf-expense-message") as HTMLElement;

  submitBtn.addEventListener("click", async () => {
    messageEl.textContent = "";

    const descriptionInput = wrapper.querySelector("#tf-expense-description") as HTMLInputElement;
    const categorySelect = wrapper.querySelector("#tf-expense-category") as HTMLSelectElement;
    const amountInput = wrapper.querySelector("#tf-expense-amount") as HTMLInputElement;
    const receiptInput = wrapper.querySelector("#tf-expense-receipt") as HTMLInputElement;

    const description = descriptionInput.value.trim();
    const category = categorySelect.value;
    const amount = Number(amountInput.value);
    const expenseDate = dateInput.value ? new Date(dateInput.value) : new Date();

    if (!description) {
      messageEl.textContent = "⚠️ Please describe what this expense was for.";
      return;
    }
    if (!category) {
      messageEl.textContent = "⚠️ Please select a category.";
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      messageEl.textContent = "⚠️ Please enter a valid amount.";
      return;
    }

    const adminUser = auth.currentUser;
    if (!adminUser) {
      messageEl.textContent = "Authentication error. Please log in again.";
      return;
    }

    submitBtn.disabled = true;
    messageEl.textContent = "Recording...";

    try {
      let receiptUrl: string | null = null;
      const receiptFile = receiptInput.files?.[0];
      if (receiptFile) {
        const receiptRef = ref(storage, `trustFundReceipts/${Date.now()}_${receiptFile.name}`);
        await uploadBytes(receiptRef, receiptFile);
        receiptUrl = await getDownloadURL(receiptRef);
      }

      const adminProfileSnap = await getDoc(doc(db, "users", adminUser.uid));
      const adminName =
        adminProfileSnap.data()?.fullName || adminUser.email || "Admin";

      await recordTrustFundExpense({
        description,
        category,
        amount,
        receiptUrl,
        expenseDate,
        adminId: adminUser.uid,
        adminName,
      });

      descriptionInput.value = "";
      categorySelect.value = "";
      amountInput.value = "";
      receiptInput.value = "";
      dateInput.value = new Date().toISOString().slice(0, 10);

      messageEl.textContent = "✅ Expense recorded.";
      await Promise.all([refreshBalance(), refreshExpenseList()]);
    } catch (err: any) {
      console.error("❌ Failed to record trust fund expense:", err);
      messageEl.textContent = `❌ Failed: ${err.message || err}`;
      alert(`❌ Failed to record expense: ${err.message || err}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// =====================================================================
// 🎉 FISCAL YEAR-END PAYOUT — the real, one-way release of the Capital
// Pool + Effort Pool to every active member, plus returning each
// member's accumulated Share Balance. See payoutService.ts for the
// exact math (mirrors the live "Running Payout Estimate" members already
// see) and exactly what resets vs. what carries over (Trust Fund never
// resets here).
// =====================================================================
export async function loadFiscalPayoutUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);

  const wrapper = document.createElement("div");
  wrapper.id = "fiscal-payout-container";
  wrapper.innerHTML = `
    <h3>🎉 Fiscal Year-End Payout</h3>
    <p class="muted">
      This computes and releases the Capital Pool + Effort Pool to every active member, and returns each
      member's Share Balance to them. <strong>This is one-way</strong> — Capital Pool, Effort Pool, Coop
      Available Funds and every active member's Share Balance + guarantor volume reset to ₱0 immediately
      after release. The Trust Fund is NOT affected — it carries over into the new fiscal year.
    </p>
    <div id="fiscal-payout-preview"><p>Loading preview...</p></div>

    <h4 style="margin-top:28px;">Past Payouts</h4>
    <div id="fiscal-payout-history"><p>Loading...</p></div>
  `;
  adminSectionContent.appendChild(wrapper);

  const previewEl = wrapper.querySelector("#fiscal-payout-preview") as HTMLElement;
  const historyEl = wrapper.querySelector("#fiscal-payout-history") as HTMLElement;

  async function renderHistory() {
    const history = await getPayoutHistory();
    if (history.length === 0) {
      historyEl.innerHTML = "<p>No payouts released yet.</p>";
      return;
    }
    historyEl.innerHTML = history.map((p) => {
      const releasedStr = p.releasedAt?.toDate ? p.releasedAt.toDate().toLocaleString() : "";
      return `
        <div style="border:1px solid #eee;border-radius:10px;padding:12px 14px;margin-bottom:10px;">
          <strong>${p.fiscalYearLabel}</strong>
          <span class="muted" style="font-size:12px;"> — released ${releasedStr} by ${p.releasedByName}</span>
          <div style="margin-top:6px;font-size:13px;">
            Capital Pool: ₱${Number(p.capitalPool ?? 0).toLocaleString()} ·
            Effort Pool: ₱${Number(p.effortPool ?? 0).toLocaleString()} ·
            Share Balances Returned: ₱${(p.members ?? []).reduce((s: number, m: any) => s + Number(m.shareBalanceReturned ?? 0), 0).toLocaleString()} ·
            <strong>Grand Total: ₱${Number(p.grandTotal ?? 0).toLocaleString()}</strong>
            (${(p.members ?? []).length} member${(p.members ?? []).length === 1 ? "" : "s"})
          </div>
          ${p.note ? `<div class="muted" style="font-size:12px;margin-top:4px;">Note: ${p.note}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  async function renderPreview() {
    previewEl.innerHTML = "<p>Loading preview...</p>";
    const preview = await computeFiscalYearPayoutPreview();

    if (preview.members.length === 0) {
      previewEl.innerHTML = "<p>No active members to pay out.</p>";
      return;
    }

    const defaultLabel = (() => {
      const start = getFiscalYearStart(new Date());
      return `FY ${start.getFullYear()}–${start.getFullYear() + 1}`;
    })();

    previewEl.innerHTML = `
      <div class="dp-cols payout-stat-cols" style="--dp-cols:4;margin-bottom:16px;">
        <div class="dp-col"><span class="dp-col-label">Capital Pool</span><span class="dp-col-value">₱${preview.capitalPool.toLocaleString()}</span></div>
        <div class="dp-col"><span class="dp-col-label">Effort Pool</span><span class="dp-col-value">₱${preview.effortPool.toLocaleString()}</span></div>
        <div class="dp-col"><span class="dp-col-label">Share Balances Returned</span><span class="dp-col-value">₱${preview.members.reduce((s, m) => s + m.shareBalanceReturned, 0).toLocaleString()}</span></div>
        <div class="dp-col"><span class="dp-col-label">Grand Total</span><span class="dp-col-value" style="font-weight:700;">₱${preview.grandTotal.toLocaleString()}</span></div>
      </div>

      <div class="payout-table-wrap" style="margin-bottom:20px;">
        <table class="payout-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Share Balance Returned</th>
              <th>Capital Share</th>
              <th>Effort Share</th>
              <th>Total Payout</th>
            </tr>
          </thead>
          <tbody>
            ${preview.members.map((m) => `
              <tr>
                <td data-label="Member">${m.fullName}</td>
                <td data-label="Share Balance Returned">₱${m.shareBalanceReturned.toLocaleString()}</td>
                <td data-label="Capital Share">₱${m.capitalShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td data-label="Effort Share">₱${m.effortShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td data-label="Total Payout" class="payout-table-total">₱${m.totalPayout.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div style="border:2px solid #d9534f;border-radius:12px;padding:16px;max-width:520px;">
        <h4 style="margin-top:0;color:#a12e21;">⚠️ Release This Payout</h4>
        <p style="font-size:13px;">This cannot be undone. Double-check the table above matches what you're about to physically hand out before proceeding.</p>
        <label>Fiscal Year Label</label>
        <input id="fp-fiscal-year-label" type="text" value="${defaultLabel}" style="width:100%;margin-bottom:8px;" />
        <label>Note (optional)</label>
        <input id="fp-note" type="text" placeholder="e.g. Released at the year-end party" style="width:100%;margin-bottom:8px;" />
        <label>Type <strong>RELEASE</strong> to confirm</label>
        <input id="fp-confirm-input" type="text" style="width:100%;margin-bottom:10px;" />
        <button id="fp-release-btn" type="button" style="background:#d9534f;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer;">🎉 Release Payout</button>
        <p id="fp-release-message" style="margin-top:8px;font-size:13px;"></p>
      </div>
    `;

    const confirmInput = previewEl.querySelector("#fp-confirm-input") as HTMLInputElement;
    const releaseBtn = previewEl.querySelector("#fp-release-btn") as HTMLButtonElement;
    const releaseMessage = previewEl.querySelector("#fp-release-message") as HTMLElement;
    const labelInput = previewEl.querySelector("#fp-fiscal-year-label") as HTMLInputElement;
    const noteInput = previewEl.querySelector("#fp-note") as HTMLInputElement;

    releaseBtn.addEventListener("click", async () => {
      releaseMessage.textContent = "";

      if (confirmInput.value.trim() !== "RELEASE") {
        releaseMessage.textContent = "⚠️ Type RELEASE (all caps) in the box above to confirm.";
        return;
      }
      if (!labelInput.value.trim()) {
        releaseMessage.textContent = "⚠️ Please give this payout a fiscal year label.";
        return;
      }

      const adminUser = auth.currentUser;
      if (!adminUser) {
        releaseMessage.textContent = "Authentication error. Please log in again.";
        return;
      }

      if (!confirm(`Release ₱${preview.grandTotal.toLocaleString()} across ${preview.members.length} members and reset the pools to ₱0? This cannot be undone.`)) {
        return;
      }

      releaseBtn.disabled = true;
      releaseMessage.textContent = "Releasing...";

      try {
        const adminProfileSnap = await getDoc(doc(db, "users", adminUser.uid));
        const adminName = adminProfileSnap.data()?.fullName || adminUser.email || "Admin";

        await releaseFiscalYearPayout({
          preview,
          adminId: adminUser.uid,
          adminName,
          fiscalYearLabel: labelInput.value.trim(),
          note: noteInput.value.trim() || undefined,
        });

        releaseMessage.textContent = "✅ Payout released and recorded.";
        await Promise.all([renderPreview(), renderHistory()]);
      } catch (err: any) {
        console.error("❌ Failed to release payout:", err);
        releaseMessage.textContent = `❌ Failed: ${err.message || err}`;
        alert(`❌ Failed to release payout: ${err.message || err}`);
        releaseBtn.disabled = false;
      }
    });
  }

  await Promise.all([renderPreview(), renderHistory()]);
}

// =====================================================================
// 🩺 DIAGNOSTIC (READ-ONLY, console only) — finds loans whose data is
// inconsistent, e.g. a loan still marked "active" even though its
// repayment schedule is fully paid off, or a borrower with more than
// one "activeLoans" doc carrying conflicting statuses (this is what
// causes someone to show "Has Active Loan" on Approved Members/
// Borrowers while All Loans shows their loan as "Completed").
//
// Run it from the browser console while logged in as admin:
//   diagnoseActiveLoanMismatch()
//
// Nothing is written — it only reads and logs.
// =====================================================================
async function diagnoseActiveLoanMismatch() {
  console.log("===========================================");
  console.log("🩺 Diagnostic: activeLoans status consistency");
  console.log("===========================================");

  const loansSnap = await getDocs(collection(db, "activeLoans"));
  console.log(`Fetched ${loansSnap.docs.length} loan docs. Fetching schedules in parallel...`);

  const loanInfos = await Promise.all(
    loansSnap.docs.map(async (loanDoc) => {
      const loan = loanDoc.data();
      const scheduleSnap = await getDocs(collection(db, "activeLoans", loanDoc.id, "schedule"));

      const scheduleItems = scheduleSnap.docs.map((d) => d.data());
      const totalItems = scheduleItems.length;
      const unpaidItems = scheduleItems.filter(
        (s: any) => s.status !== "voided" && (!s.paid || s.partial)
      ).length;

      return {
        userId: loan.userId as string | undefined,
        loanId: loanDoc.id,
        status: loan.status ?? "unknown",
        remainingBalance: loan.remainingBalance ?? null,
        principal: loan.principal ?? loan.amountBorrowed ?? loan.amount ?? null,
        totalScheduleItems: totalItems,
        unpaidScheduleItems: unpaidItems,
      };
    })
  );

  console.log("Schedules fetched. Grouping by user...");

  const byUser = new Map<string, typeof loanInfos>();
  for (const info of loanInfos) {
    if (!info.userId) continue;
    if (!byUser.has(info.userId)) byUser.set(info.userId, []);
    byUser.get(info.userId)!.push(info);
  }

  // 🎯 The ONLY genuine bug signal: a loan doc still marked "active"
  // whose own repayment schedule shows zero unpaid items — meaning it
  // was fully paid off but its status field was never flipped to
  // "completed". Having multiple loan docs per user (e.g. one completed
  // + one genuinely still-active loan with real unpaid installments) is
  // normal for a repeat borrower and is NOT flagged here.
  const flaggedUserIds: string[] = [];
  for (const [userId, loans] of byUser) {
    const anyActiveButFullyPaid = loans.some(
      (l) => l.status === "active" && l.totalScheduleItems > 0 && l.unpaidScheduleItems === 0
    );
    if (anyActiveButFullyPaid) flaggedUserIds.push(userId);
  }

  console.log(`Fetching names for ${flaggedUserIds.length} flagged users...`);

  const nameEntries = await Promise.all(
    flaggedUserIds.map(async (uid) => {
      const userSnap = await getDoc(doc(db, "users", uid));
      const userData = userSnap.exists() ? userSnap.data() : null;
      return [uid, (userData?.fullName as string) || uid] as const;
    })
  );
  const nameMap = new Map(nameEntries);

  for (const userId of flaggedUserIds) {
    console.log(`\n🚩 ${nameMap.get(userId)} (${userId}) — has a loan marked "active" with 0 unpaid installments left`);
    console.table(byUser.get(userId));
  }

  // ℹ️ Informational only, not a bug: users with more than one loan doc
  // (normal for a repeat borrower) but not otherwise flagged above.
  const multiLoanUserIds = [...byUser.keys()].filter(
    (uid) => byUser.get(uid)!.length > 1 && !flaggedUserIds.includes(uid)
  );

  console.log(`\n===========================================`);
  console.log(`Total users scanned: ${byUser.size}`);
  console.log(`🚩 Genuinely stale "active" status (real bug): ${flaggedUserIds.length}`);
  console.log(`ℹ️ Have multiple loans but look consistent (not a bug): ${multiLoanUserIds.length}`);
  console.log("🎉 Diagnostic complete (nothing was written).");

  return {
    totalUsers: byUser.size,
    flaggedUserIds,
    multiLoanUserIds,
    byUser: Object.fromEntries(byUser),
  };
}

// Expose to the browser console for ad-hoc admin diagnostics — safe: it
// only reads data the admin dashboard already reads elsewhere, and logs
// a report. Nothing here writes to Firestore.
(window as any).diagnoseActiveLoanMismatch = diagnoseActiveLoanMismatch;

// =====================================================================
// 🔧 ONE-TIME REPAIR (console only) — fixes existing loan docs already
// stuck with status "active" despite a fully-paid schedule (the bug
// repaymentService.ts's safeFinalBalance() used to cause — now fixed
// there for all FUTURE payments, but that fix doesn't reachrows already
// written to Firestore before today).
//
// SAFE BY DEFAULT: calling repairStaleActiveLoans() with no arguments
// only lists what it WOULD change — it writes nothing. You must pass
// { confirm: true } to actually apply the fix:
//
//   repairStaleActiveLoans()                 // dry run, no writes
//   repairStaleActiveLoans({ confirm: true }) // actually fixes them
// =====================================================================
// A "safe to auto-zero" residue is at most ₱1 — the same tolerance
// repaymentService.ts's safeFinalBalance() now uses for float drift.
// Anything bigger is a real balance sitting on a fully-paid schedule
// (a different, more serious bug — e.g. a payment that updated the
// schedule but never decremented the loan) and must NOT be silently
// zeroed out here; it needs a human to look at it.
const AUTO_ZERO_TOLERANCE = 1;

async function repairStaleActiveLoans(opts: { confirm?: boolean } = {}) {
  const result = await diagnoseActiveLoanMismatch();
  const safeLoans: { loanId: string; remainingBalance: number }[] = [];
  const needsReviewLoans: { loanId: string; userId: string; remainingBalance: number }[] = [];

  for (const uid of result.flaggedUserIds) {
    const loans = (result.byUser as any)[uid] as Array<{
      loanId: string;
      status: string;
      remainingBalance: number;
      totalScheduleItems: number;
      unpaidScheduleItems: number;
    }>;
    for (const l of loans) {
      if (l.status === "active" && l.totalScheduleItems > 0 && l.unpaidScheduleItems === 0) {
        if (Math.abs(l.remainingBalance) <= AUTO_ZERO_TOLERANCE) {
          safeLoans.push({ loanId: l.loanId, remainingBalance: l.remainingBalance });
        } else {
          needsReviewLoans.push({ loanId: l.loanId, userId: uid, remainingBalance: l.remainingBalance });
        }
      }
    }
  }

  if (needsReviewLoans.length > 0) {
    console.log(
      `\n⚠️ ${needsReviewLoans.length} loan(s) are fully paid on schedule but still show a REAL remaining balance (not just rounding drift). These are NOT touched by this tool — they need manual review:`
    );
    console.table(needsReviewLoans);
  }

  if (safeLoans.length === 0) {
    console.log("\n✅ Nothing safe to auto-repair (rounding-drift cases). See any ⚠️ list above for loans needing manual review.");
    return { repaired: [], needsReview: needsReviewLoans };
  }

  if (!opts.confirm) {
    console.log(
      `\n🔎 DRY RUN — would mark ${safeLoans.length} loan(s) as "completed" (remainingBalance → 0). Each of these has only a tiny rounding-drift balance (≤ ₱${AUTO_ZERO_TOLERANCE}):`
    );
    console.table(safeLoans);
    console.log(`\nNothing was written. Re-run as repairStaleActiveLoans({ confirm: true }) to apply.`);
    return { wouldRepair: safeLoans.map((l) => l.loanId), needsReview: needsReviewLoans };
  }

  console.log(`\n✍️ Applying fix to ${safeLoans.length} loan(s)...`);

  for (const l of safeLoans) {
    await updateDoc(doc(db, "activeLoans", l.loanId), {
      remainingBalance: 0,
      status: "completed",
      updatedAt: serverTimestamp(),
    });
    console.log(`   ✅ ${l.loanId} → status: completed, remainingBalance: 0`);
  }

  console.log(`\n🎉 Repair complete. ${safeLoans.length} loan(s) fixed.`);
  if (needsReviewLoans.length > 0) {
    console.log(`⚠️ ${needsReviewLoans.length} loan(s) still need your manual review (see table above).`);
  }
  return { repaired: safeLoans.map((l) => l.loanId), needsReview: needsReviewLoans };
}

(window as any).repairStaleActiveLoans = repairStaleActiveLoans;

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
// 💰 SIDE-BUSINESS EARNINGS — profit ledger for MLF Easy Installment and
// Marimar's Credit Cart. Owner-only (not member-visible, unlike the coop's
// Trust Fund/Payout). Separate from coopFinancialSummary/trustFundBalance
// and never touched by the coop's fiscal year-end payout — these two
// businesses run on their own calendar, tracked independently of each
// other too. See businessProfitService.ts for the math.
// =====================================================================
export async function loadBusinessEarningsUI(
  adminSectionContent: HTMLElement | null,
  business: BusinessKey
) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);

  const label = getBusinessLabel(business);
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];

  const wrapper = document.createElement("div");
  wrapper.id = "business-earnings-container";
  wrapper.innerHTML = `
    <h3>💰 ${label} — Earnings</h3>
    <p class="muted">This is a separate business from the coop — its profit is never touched by the coop's fiscal year-end payout, and this page is only visible to admins.</p>

    <div class="dp-cols" style="--dp-cols:3;margin:14px 0 18px;">
      <div class="dp-col"><span class="dp-col-label">Total Interest Collected (Lifetime)</span><span class="dp-col-value" id="be-total-collected">Loading...</span></div>
      <div class="dp-col"><span class="dp-col-label">Total Withdrawn</span><span class="dp-col-value" id="be-total-withdrawn">Loading...</span></div>
      <div class="dp-col"><span class="dp-col-label">Undistributed Profit</span><span class="dp-col-value" style="font-weight:700;" id="be-undistributed">Loading...</span></div>
    </div>

    <div style="border:1px solid #ddd;border-radius:12px;padding:14px 16px;max-width:420px;margin-bottom:24px;">
      <h4 style="margin-top:0;">📅 Year-End Earnings Check</h4>
      <label>Year</label>
      <select id="be-year-select" style="width:100%;margin-bottom:8px;">
        ${yearOptions.map((y) => `<option value="${y}">${y}</option>`).join("")}
      </select>
      <p id="be-year-result" style="font-size:15px;font-weight:600;margin:6px 0 0;">Loading...</p>
      <p class="muted" style="font-size:12px;margin-top:4px;">Interest actually collected from buyers within that calendar year — compare year to year to see if the business is growing.</p>
    </div>

    <div style="border:2px solid #6f42c1;border-radius:12px;padding:16px;max-width:520px;margin-bottom:24px;">
      <h4 style="margin-top:0;color:#4a2a84;">💵 Release Earnings</h4>
      <p style="font-size:13px;">Record a withdrawal — this is money you're taking out of the business as profit. It's deducted from the undistributed profit balance above and logged permanently below.</p>
      <label>Amount (₱)</label>
      <input id="be-withdraw-amount" type="number" min="0" step="0.01" placeholder="0.00" style="width:100%;margin-bottom:8px;" />
      <label>Note (optional)</label>
      <input id="be-withdraw-note" type="text" placeholder="e.g. Owner draw, reinvested into inventory" style="width:100%;margin-bottom:8px;" />
      <button id="be-withdraw-submit-btn" type="button" class="request-loan-btn">Record Withdrawal</button>
      <p id="be-withdraw-message" style="margin-top:8px;font-size:13px;"></p>
    </div>

    <h4>Withdrawal Log</h4>
    <div id="be-withdrawal-list"><p>Loading...</p></div>
  `;
  adminSectionContent.appendChild(wrapper);

  async function refreshSummary() {
    const summary = await getBusinessProfitSummary(business);
    (wrapper.querySelector("#be-total-collected") as HTMLElement).textContent =
      `₱${summary.totalInterestCollected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    (wrapper.querySelector("#be-total-withdrawn") as HTMLElement).textContent =
      `₱${summary.totalWithdrawn.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    (wrapper.querySelector("#be-undistributed") as HTMLElement).textContent =
      `₱${summary.undistributedProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  async function refreshYearResult() {
    const yearSelect = wrapper.querySelector("#be-year-select") as HTMLSelectElement;
    const yearResultEl = wrapper.querySelector("#be-year-result") as HTMLElement;
    yearResultEl.textContent = "Loading...";
    const year = Number(yearSelect.value);
    const interest = await getBusinessInterestForYear(business, year);
    yearResultEl.textContent = `Interest collected in ${year}: ₱${interest.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  async function refreshWithdrawalList() {
    const listEl = wrapper.querySelector("#be-withdrawal-list") as HTMLElement;
    const payouts = await getBusinessPayoutHistory(business);

    if (payouts.length === 0) {
      listEl.innerHTML = "<p>No withdrawals recorded yet.</p>";
      return;
    }

    const totalWithdrawn = payouts.reduce((sum, p) => sum + p.amount, 0);

    listEl.innerHTML = `
      <p class="muted" style="margin-top:-4px;">Total withdrawn: ₱${totalWithdrawn.toLocaleString()} across ${payouts.length} withdrawal${payouts.length === 1 ? "" : "s"}.</p>
      ${payouts.map((p) => {
        const recordedStr = p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString() : "";
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:10px 12px;border:1px solid #eee;border-radius:8px;margin-bottom:8px;">
            <div>
              <strong>${p.note || "Withdrawal"}</strong>
              <div class="muted" style="font-size:12px;">Recorded by ${p.adminName}${recordedStr ? ` on ${recordedStr}` : ""}</div>
            </div>
            <strong>₱${p.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
          </div>
        `;
      }).join("")}
    `;
  }

  await Promise.all([refreshSummary(), refreshYearResult(), refreshWithdrawalList()]);

  const yearSelect = wrapper.querySelector("#be-year-select") as HTMLSelectElement;
  yearSelect.addEventListener("change", refreshYearResult);

  const submitBtn = wrapper.querySelector("#be-withdraw-submit-btn") as HTMLButtonElement;
  const messageEl = wrapper.querySelector("#be-withdraw-message") as HTMLElement;

  submitBtn.addEventListener("click", async () => {
    messageEl.textContent = "";

    const amountInput = wrapper.querySelector("#be-withdraw-amount") as HTMLInputElement;
    const noteInput = wrapper.querySelector("#be-withdraw-note") as HTMLInputElement;

    const amount = Number(amountInput.value);
    const note = noteInput.value.trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      messageEl.textContent = "⚠️ Please enter a valid amount.";
      return;
    }

    const adminUser = auth.currentUser;
    if (!adminUser) {
      messageEl.textContent = "Authentication error. Please log in again.";
      return;
    }

    submitBtn.disabled = true;
    messageEl.textContent = "Recording...";

    try {
      const adminProfileSnap = await getDoc(doc(db, "users", adminUser.uid));
      const adminName = adminProfileSnap.data()?.fullName || adminUser.email || "Admin";

      await recordBusinessWithdrawal({ business, amount, note, adminName });

      amountInput.value = "";
      noteInput.value = "";

      messageEl.textContent = "✅ Withdrawal recorded.";
      await Promise.all([refreshSummary(), refreshWithdrawalList()]);
    } catch (err: any) {
      console.error(`❌ Failed to record ${label} withdrawal:`, err);
      messageEl.textContent = `❌ Failed: ${err.message || err}`;
      alert(`❌ Failed to record withdrawal: ${err.message || err}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
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
      <div class="approved-member-row">
        <div class="member-main">
          <div class="member-name">${user.fullName}</div>
          <div class="member-meta">(${user.role})</div>
        </div>
        <div class="member-actions" style="grid-template-columns: repeat(2, 1fr);">
          <button class="approve-btn" data-uid="${user.id}">Approve</button>
          <button class="delete-pending-btn" data-uid="${user.id}" style="background:#dc3545;">Delete</button>
        </div>
      </div>
    `;
  });
  listContainer.innerHTML = usersListHTML;

  listContainer.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;

    // 🔐 Approve → open role confirmation modal
    if (target.classList.contains("approve-btn")) {
      const uid = target.getAttribute("data-uid");
      if (!uid) return;

      const selectedUser = pendingUsers.find(u => u.id === uid);
      if (!selectedUser) return;

      openRoleConfirmModal(selectedUser);
      return;
    }

    // 🗑 Delete pending application
    if (target.classList.contains("delete-pending-btn")) {
      const uid = target.getAttribute("data-uid");
      if (!uid) return;

      const selectedUser = pendingUsers.find(u => u.id === uid);
      const name = selectedUser?.fullName || "this application";

      if (!confirm(`Delete the pending application for "${name}"? This cannot be undone.`)) return;

      const btn = target as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Deleting...";

      try {
        await deleteDoc(doc(db, "users", uid));
        await loadPendingUsersUI(adminSectionContent);
      } catch (error: any) {
        console.error("❌ Error deleting pending user:", error);
        alert(error?.message || "Failed to delete pending application.");
        btn.disabled = false;
        btn.textContent = "Delete";
      }
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

  // 🔤 Alphabetical order (A→Z) instead of Firestore's arbitrary order
  approvedMembers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  if (approvedMembers.length === 0) {
    listContainer.innerHTML = "<h3>Approved Members</h3><p>No approved members found.</p>";
    return;
  }

  let membersHtml = "<h3>Approved Members</h3>";

membersHtml = "<h3>Approved Members</h3>";

// ⚡ PERFORMANCE FIX: these two lookups used to run one member at a time
// inside this loop — 2 sequential Firestore round trips PER member, so
// with 20+ approved members that was 40+ round trips completed one
// after another before this tab could even render. Firing them all in
// parallel up front cuts the wait from "sum of every round trip" down
// to roughly the time of the single slowest one.
const memberExtras = new Map(
  await Promise.all(
    approvedMembers.map(async (member) => {
      const [hasLoan, completedLoansCount] = await Promise.all([
        memberHasActiveLoan(member.id),
        getCompletedLoansCount(member.id),
      ]);
      return [member.id, { hasLoan, completedLoansCount }] as const;
    })
  )
);

for (const member of approvedMembers) {
  const { hasLoan, completedLoansCount } = memberExtras.get(member.id)!;

  const isInactive = member.membershipStatus === "inactive";

  membersHtml += `
    <div class="approved-member-row${isInactive ? " member-row-inactive" : ""}">
      <div class="member-main">
        <div class="member-name">
          ${member.fullName}
          ${hasLoan ? `<span class="loan-badge">🟢 Has Active Loan</span>` : ``}
          ${completedLoansCount > 0 ? `<span class="loan-badge" style="background:#dff0d8;color:#2a6b2a;">✅ Completed Loans: ${completedLoansCount}</span>` : ``}
          ${isInactive ? `<span class="loan-badge inactive-badge">🚪 Inactive</span>` : ``}
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
        <button class="view-member-profile-btn" data-member-id="${member.id}">
          View Profile
        </button>
        <button class="verify-id-btn" data-member-id="${member.id}" data-return-tab="members">
          🪪 Verify ID ${verificationBadgeShorthand(member.identityVerification)}
        </button>
        <button class="change-role-btn"
        data-user-id="${member.id}"
        data-return-tab="members">
  Change Role
</button>
        ${isInactive
          ? `<button class="view-payments-btn reactivate-user-btn" data-user-id="${member.id}">✅ Reactivate</button>`
          : `<button class="deny-btn mark-inactive-btn" data-user-id="${member.id}" data-user-name="${member.fullName}">🚪 Mark Inactive</button>`
        }
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

// ✅ Mark Inactive / Reactivate (Approved Members) — event delegation
listContainer.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const markBtn = target.closest(".mark-inactive-btn") as HTMLElement | null;
  const reactivateBtn = target.closest(".reactivate-user-btn") as HTMLElement | null;

  if (markBtn) {
    handleMarkUserInactive(markBtn.dataset.userId!, markBtn.dataset.userName || "this member", "members");
  } else if (reactivateBtn) {
    handleReactivateUser(reactivateBtn.dataset.userId!, "members");
  }
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

document.querySelectorAll("#approved-members-list-container .view-member-profile-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    const memberId = (e.target as HTMLElement).getAttribute("data-member-id")!;
    await loadMemberProfileDetails(adminSectionContent!, memberId);
  });
});

document.querySelectorAll("#approved-members-list-container .verify-id-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    const target = (e.currentTarget ?? e.target) as HTMLElement;
    const memberId = target.getAttribute("data-member-id")!;
    await loadIdentityVerificationDetails(adminSectionContent!, memberId, "members");
  });
});
} // closes loadApprovedMembersUI

// =====================================================================
// 👤 APPROVED MEMBER — Profile Details (Personal Information)
// =====================================================================
async function loadMemberProfileDetails(container: HTMLElement, userId: string) {
  clearMainContentArea(container);
  await renderFinancialTotalsUI(container);

  container.innerHTML = `<h3>Member Profile</h3><p>Loading...</p>`;

  const profile = await getUserProfile(userId);

  if (!profile) {
    container.innerHTML = `
      <h3>Member Profile</h3>
      <p>No profile found for this member.</p>
      <br/>
      <button id="back-to-members-from-profile-btn">⬅ Back to Approved Members</button>
    `;
    document.getElementById("back-to-members-from-profile-btn")?.addEventListener("click", () => {
      loadApprovedMembersUI(container);
    });
    return;
  }

  const fullName = `${profile.firstName ?? ""} ${profile.middleName ? profile.middleName + " " : ""}${profile.lastName ?? ""}`.trim();
  const home = profile.homeAddress;
  const ec = profile.emergencyContact;

  container.innerHTML = `
    <h3>Member Profile</h3>
    <p><strong>Name:</strong> ${fullName || "N/A"}</p>

    <h3>🧾 Personal Information</h3>
    <p><strong>Middle Name:</strong> ${profile.middleName || "N/A"}</p>
    <p><strong>Phone Number:</strong> ${profile.phoneNumber || "N/A"}</p>

    <h4>🏠 Home Address</h4>
    <p>${home?.street || "N/A"}, ${home?.barangay || "N/A"}, ${home?.city || "N/A"}, ${home?.province || "N/A"} ${home?.zip || ""}</p>

    <h4>🚨 Emergency Contact</h4>
    <p><strong>Name:</strong> ${ec?.name || "N/A"}</p>
    <p><strong>Relationship:</strong> ${ec?.relationship || "N/A"}</p>
    <p><strong>Phone:</strong> ${ec?.phone || "N/A"}</p>

    <br/>
    <button id="back-to-members-from-profile-btn">⬅ Back to Approved Members</button>
  `;

  document.getElementById("back-to-members-from-profile-btn")?.addEventListener("click", () => {
    loadApprovedMembersUI(container);
  });
}

// =====================================================================
// 🪪 IDENTITY VERIFICATION (KYC) — shared by member & borrower panels
// =====================================================================

function verificationBadgeShorthand(v?: import("../type").IdentityVerification): string {
  const status = v?.status ?? "not_started";
  const shorthand: Record<string, string> = {
    not_started: "⬜",
    pending_review: "⏳",
    approved: "✅",
    rejected: "❌",
  };
  return shorthand[status] ?? "⬜";
}

function verificationStatusBadgeHtml(v?: import("../type").IdentityVerification): string {
  const status = v?.status ?? "not_started";
  const label: Record<string, string> = {
    not_started: "⬜ Not started",
    pending_review: "⏳ Pending review",
    approved: "✅ Verified",
    rejected: "❌ Rejected",
  };
  return `<span class="admin-verification-badge" data-status="${status}">${label[status] ?? status}</span>`;
}

async function loadIdentityVerificationDetails(
  container: HTMLElement,
  userId: string,
  returnTab: "members" | "borrowers"
) {
  clearMainContentArea(container);
  await renderFinancialTotalsUI(container);

  container.innerHTML = `<h3>🪪 Identity Verification</h3><p>Loading...</p>`;

  const profile = await getUserProfile(userId);
  const name = await getUserFullName(userId);
  const v = profile?.identityVerification;

  const goBack = () => {
    if (returnTab === "members") loadApprovedMembersUI(container);
    else loadApprovedBorrowersUI(container);
  };

  if (!v || v.status === "not_started") {
    container.innerHTML = `
      <h3>🪪 Identity Verification</h3>
      <p><strong>${name}</strong> ${verificationStatusBadgeHtml(v)}</p>
      <p>This member hasn't submitted verification photos yet.</p>
      <br/><button id="back-from-verification-btn">⬅ Back</button>
    `;
    document.getElementById("back-from-verification-btn")?.addEventListener("click", goBack);
    return;
  }

  container.innerHTML = `
    <h3>🪪 Identity Verification</h3>
    <p><strong>${name}</strong> ${verificationStatusBadgeHtml(v)}</p>

    <div class="admin-verification-photos">
      <div>
        <h4>Selfie</h4>
        ${v.selfieUrl ? `<img src="${v.selfieUrl}" class="admin-verification-img" />` : "<p>N/A</p>"}
      </div>
      <div>
        <h4>Selfie Holding ID</h4>
        ${v.selfieWithIdUrl ? `<img src="${v.selfieWithIdUrl}" class="admin-verification-img" />` : "<p>N/A</p>"}
      </div>
      <div>
        <h4>Gov ID</h4>
        ${v.govIdFrontUrl ? `<img src="${v.govIdFrontUrl}" class="admin-verification-img" />` : "<p>N/A</p>"}
      </div>
    </div>

    ${v.status === "rejected" && v.rejectionReason
      ? `<p><strong>Previous rejection reason:</strong> ${v.rejectionReason}</p>`
      : ""}

    ${v.status === "pending_review"
      ? `<div class="admin-verification-actions">
           <button id="approve-verification-btn">✅ Approve</button>
           <button id="reject-verification-btn">❌ Reject</button>
         </div>`
      : ""}

    <br/><button id="back-from-verification-btn">⬅ Back</button>
  `;

  document.getElementById("back-from-verification-btn")?.addEventListener("click", goBack);

  document.getElementById("approve-verification-btn")?.addEventListener("click", async () => {
    await updateDoc(doc(db, "users", userId), {
      identityVerification: {
        ...v,
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid ?? null,
        rejectionReason: null,
      },
    });
    alert("✅ Verification approved.");
    await loadIdentityVerificationDetails(container, userId, returnTab);
  });

  document.getElementById("reject-verification-btn")?.addEventListener("click", async () => {
    const reason = prompt("Reason for rejection (shown to the member):");
    if (reason === null) return;
    await updateDoc(doc(db, "users", userId), {
      identityVerification: {
        ...v,
        status: "rejected",
        rejectionReason: reason,
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid ?? null,
      },
    });
    alert("❌ Verification rejected.");
    await loadIdentityVerificationDetails(container, userId, returnTab);
  });
}

async function memberHasActiveLoan(userId: string): Promise<boolean> {
  const q = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    where("status", "==", "active")
  );

  const snap = await getDocs(q);
  return !snap.empty;
}

// ✅ How many of this user's coop loans have been fully paid off — a
// separate, positive signal from "no active loan right now" (which could
// just mean they've never borrowed). Lets admin tell apart a clean
// repayment track record from simply having no loan history.
async function getCompletedLoansCount(userId: string): Promise<number> {
  const q = query(
    collection(db, "activeLoans"),
    where("userId", "==", userId),
    where("status", "==", "completed")
  );

  const snap = await getDocs(q);
  return snap.size;
}

// =====================================================================
// 🚪 MARK INACTIVE / REACTIVATE — shared by Approved Members & Borrowers
// =====================================================================
async function handleMarkUserInactive(
  userId: string,
  userName: string,
  returnTab: "members" | "borrowers"
) {
  const confirmed = confirm(
    `Mark ${userName} as inactive (left the coop)?\n\n` +
    `Their share balance will be applied against any active loan first. ` +
    `Any remaining loan balance stays on record as an uncollected receivable ` +
    `and is excluded from dividend calculations until it's actually collected.`
  );
  if (!confirmed) return;

  const adminId = auth.currentUser?.uid;
  if (!adminId) {
    alert("❌ Not signed in as admin.");
    return;
  }

  try {
    const result: MarkInactiveResult = await markUserInactive({ userId, adminId });

    let summary = `✅ ${userName} marked inactive.\n\n`;
    if (result.hadActiveLoan) {
      summary += `Share balance applied to loan: ₱${result.shareBalanceApplied.toLocaleString()}\n`;
      summary += result.loanFullyOffset
        ? `Loan fully covered by shares — marked completed.`
        : `Remaining uncollected loan balance: ₱${result.remainingUncollectedLoan.toLocaleString()} (excluded from dividends until collected).`;
    } else {
      summary += `No active loan on record.`;
    }
    alert(summary);
  } catch (err: any) {
    console.error("🔴 markUserInactive error:", err);
    alert(`❌ ${err.message || "Failed to mark user inactive."}`);
    return;
  }

  if (returnTab === "members") {
    await loadApprovedMembersUI(adminSectionContent);
  } else {
    await loadApprovedBorrowersUI(adminSectionContent);
  }
}

async function handleReactivateUser(
  userId: string,
  returnTab: "members" | "borrowers"
) {
  const adminId = auth.currentUser?.uid;
  if (!adminId) {
    alert("❌ Not signed in as admin.");
    return;
  }

  try {
    await reactivateUser({ userId, adminId });
    alert("✅ User reactivated.");
  } catch (err: any) {
    console.error("🔴 reactivateUser error:", err);
    alert(`❌ ${err.message || "Failed to reactivate user."}`);
    return;
  }

  if (returnTab === "members") {
    await loadApprovedMembersUI(adminSectionContent);
  } else {
    await loadApprovedBorrowersUI(adminSectionContent);
  }
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

    // 🔤 Alphabetical order (A→Z) instead of Firestore's arbitrary order
    approvedBorrowers.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

    if (approvedBorrowers.length === 0) {
        listContainer.innerHTML = "<h3>Approved Borrowers</h3><p>No approved borrowers found.</p>";
        return;
    }

    let borrowersHtml = "<h3>Approved Borrowers</h3>";

    // ⚡ PERFORMANCE FIX: same N+1 problem as Approved Members — these two
    // lookups used to run one borrower at a time (2 sequential Firestore
    // round trips per borrower). Fired in parallel up front instead.
    const borrowerExtras = new Map(
      await Promise.all(
        (approvedBorrowers as UserProfile[]).map(async (borrower) => {
          const [hasLoan, completedLoansCount] = await Promise.all([
            memberHasActiveLoan(borrower.id),
            getCompletedLoansCount(borrower.id),
          ]);
          return [borrower.id, { hasLoan, completedLoansCount }] as const;
        })
      )
    );

    for (const borrower of approvedBorrowers as UserProfile[]) {
        const isInactive = borrower.membershipStatus === "inactive";
        const { hasLoan, completedLoansCount } = borrowerExtras.get(borrower.id)!;

        borrowersHtml += `
            <div class="approved-member-row${isInactive ? " member-row-inactive" : ""}">
                <div class="member-main">
                    <div class="member-name">
                      ${borrower.fullName}
                      ${hasLoan ? `<span class="loan-badge">🟢 Has Active Loan</span>` : ``}
                      ${completedLoansCount > 0 ? `<span class="loan-badge" style="background:#dff0d8;color:#2a6b2a;">✅ Completed Loans: ${completedLoansCount}</span>` : ``}
                      ${isInactive ? `<span class="loan-badge inactive-badge">🚪 Inactive</span>` : ``}
                    </div>
                    <div class="member-meta">(${borrower.role}) – Current Loan: ₱${(borrower.loanBalance ?? 0).toFixed(2)} / Limit: ₱${(borrower.loanLimit ?? 0).toFixed(2)}</div>
                </div>
                <div class="member-actions">
                    <button class="view-borrower-details-btn" data-member-id="${borrower.id}">View Details</button>
                    <button class="verify-id-btn" data-member-id="${borrower.id}" data-return-tab="borrowers">
                      🪪 Verify ID ${verificationBadgeShorthand(borrower.identityVerification)}
                    </button>
                    <button class="change-role-btn"
        data-user-id="${borrower.id}"
        data-return-tab="borrowers">
  Change Role
</button>
                    ${isInactive
                      ? `<button class="view-payments-btn reactivate-user-btn" data-user-id="${borrower.id}">✅ Reactivate</button>`
                      : `<button class="deny-btn mark-inactive-btn" data-user-id="${borrower.id}" data-user-name="${borrower.fullName}">🚪 Mark Inactive</button>`
                    }
                </div>
            </div>
        `;
    }

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

// ✅ Mark Inactive / Reactivate (Approved Borrowers) — event delegation
listContainer.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const markBtn = target.closest(".mark-inactive-btn") as HTMLElement | null;
  const reactivateBtn = target.closest(".reactivate-user-btn") as HTMLElement | null;

  if (markBtn) {
    handleMarkUserInactive(markBtn.dataset.userId!, markBtn.dataset.userName || "this borrower", "borrowers");
  } else if (reactivateBtn) {
    handleReactivateUser(reactivateBtn.dataset.userId!, "borrowers");
  }
});

document
  .querySelectorAll("#approved-borrowers-list-container .view-borrower-details-btn")
  .forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const borrowerId = (e.target as HTMLElement).getAttribute("data-member-id")!;
      await loadBorrowerLoanDetails(adminSectionContent!, borrowerId);
    });
  });

document
  .querySelectorAll("#approved-borrowers-list-container .verify-id-btn")
  .forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const target = (e.currentTarget ?? e.target) as HTMLElement;
      const borrowerId = target.getAttribute("data-member-id")!;
      await loadIdentityVerificationDetails(adminSectionContent!, borrowerId, "borrowers");
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
const borrowerProfile = await getUserProfile(userId);

  const borrowerHome = borrowerProfile?.homeAddress;
  const borrowerEc = borrowerProfile?.emergencyContact;

  const personalInfoHtml = `
    <h3>🧾 Personal Information</h3>
    <p><strong>Middle Name:</strong> ${borrowerProfile?.middleName || "N/A"}</p>
    <p><strong>Phone Number:</strong> ${borrowerProfile?.phoneNumber || "N/A"}</p>

    <h4>🏠 Home Address</h4>
    <p>${borrowerHome?.street || "N/A"}, ${borrowerHome?.barangay || "N/A"}, ${borrowerHome?.city || "N/A"}, ${borrowerHome?.province || "N/A"} ${borrowerHome?.zip || ""}</p>

    <h4>🚨 Emergency Contact</h4>
    <p><strong>Name:</strong> ${borrowerEc?.name || "N/A"}</p>
    <p><strong>Relationship:</strong> ${borrowerEc?.relationship || "N/A"}</p>
    <p><strong>Phone:</strong> ${borrowerEc?.phone || "N/A"}</p>

    <p>${verificationStatusBadgeHtml(borrowerProfile?.identityVerification)}</p>
  `;

  if (!loan) {
    container.innerHTML = `
      <h3>Borrower Loan Details</h3>
      <p><strong>Borrower:</strong> ${borrowerName}</p>

      ${personalInfoHtml}

      <p>No active loan found for this borrower.</p>

      <br/>
      <button id="back-to-borrowers-btn">⬅ Back to Approved Borrowers</button>
    `;
    document.getElementById("back-to-borrowers-btn")?.addEventListener("click", () => {
      loadApprovedBorrowersUI(container);
    });
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

    ${personalInfoHtml}

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
// =====================================================================
// ➕ Admin-assisted loan request submission — for members/borrowers who
// aren't comfortable submitting a request themselves. Admin picks the
// person, fills in the same info they'd have entered, and files it on
// their behalf (adminSubmitLoanRequest records who did it and why).
// =====================================================================
// ⚡ approvedMembers/approvedBorrowers are fetched ONCE by the caller
// (loadLoanRequestsUI) and passed in here — this panel used to fetch its
// own copies of the exact same two collections, doubling those queries
// on every Loan Requests tab load.
async function renderAdminLoanSubmitPanel(
  adminSectionContent: HTMLElement,
  approvedMembers: UserProfile[],
  approvedBorrowers: UserProfile[]
) {
  const wrap = document.createElement("div");
  wrap.id = "admin-loan-submit-wrap";
  wrap.style.cssText = "margin-bottom:16px;";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.textContent = "➕ Submit Loan Request for a Member";
  toggleBtn.className = "request-loan-btn";

  const panel = document.createElement("div");
  panel.id = "admin-loan-submit-panel";
  panel.style.cssText =
    "display:none;margin-top:10px;padding:14px 16px;border:1px solid #ddd;border-radius:12px;background:#fafafa;max-width:520px;";

  const allPeople = [
    ...approvedMembers.map((u) => ({ ...u, roleLabel: "Member" })),
    ...approvedBorrowers.map((u) => ({ ...u, roleLabel: "Borrower" })),
  ].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  const targetOptions = allPeople
    .map((u) => `<option value="${u.uid}">${u.fullName || u.email} (${u.roleLabel})</option>`)
    .join("");

  const guarantorOptions = approvedMembers
    .map((u) => `<option value="${u.uid}">${u.fullName || u.email}</option>`)
    .join("");

  panel.innerHTML = `
    <p style="margin:0 0 10px 0;font-size:13px;color:#555;">
      Fill this out the way the member/borrower would, based on what they told you in person.
    </p>
    <label>Member/Borrower:</label>
    <select id="admin-loan-target" style="width:100%;margin-bottom:8px;">
      <option value="">— Select —</option>
      ${targetOptions}
    </select>

    <p style="text-align:center;margin:2px 0;font-size:12px;color:#888;">— or —</p>

    <label>Type a name manually (no account yet):</label>
    <input id="admin-loan-manual-name" type="text" placeholder="Name or nickname as added in chat" style="width:100%;margin-bottom:4px;" />
    <p style="margin:0 0 8px 0;font-size:12px;color:#a15c00;">
      Holds this person's place in the queue. You'll link this to their real account once they sign up, before it can be approved. If the amount is over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()}, it's queued anyway ("skip for now") — you'll add a security guarantor for it once the account is linked.
    </p>

    <label>Loan Amount (₱):</label>
    <input id="admin-loan-amount" type="number" min="500" step="1" style="width:100%;margin-bottom:8px;" />

    <label>Terms (months, 1–10):</label>
    <input id="admin-loan-terms" type="number" min="1" max="10" value="1" style="width:100%;margin-bottom:8px;" />

    <label>Purpose:</label>
    <input id="admin-loan-purpose" type="text" style="width:100%;margin-bottom:8px;" />

    <label>Guarantor (optional):</label>
    <select id="admin-loan-guarantor" style="width:100%;margin-bottom:8px;">
      <option value="">— None —</option>
      ${guarantorOptions}
    </select>

    <div id="admin-loan-security-guarantor-section" style="display:none;border-top:1px dashed #ccc;padding-top:8px;margin-bottom:8px;">
      <p style="margin:0 0 6px 0;font-size:12px;color:#a15c00;">
        ⚠️ This amount exceeds ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} — a security guarantor is required before this can be approved.
      </p>
      <label style="font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input id="admin-loan-skip-sg" type="checkbox" style="width:auto;" />
        ⏸️ Skip for now — add the security guarantor later, before approving
      </label>
      <div id="admin-loan-security-guarantor-fields">
        <input id="admin-sg-name" type="text" placeholder="Guarantor full name" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-relationship" type="text" placeholder="Relationship to borrower" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-phone" type="text" placeholder="Phone number" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-email" type="email" placeholder="Email" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-street" type="text" placeholder="Street" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-barangay" type="text" placeholder="Barangay" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-city" type="text" placeholder="City" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-province" type="text" placeholder="Province" style="width:100%;margin-bottom:6px;" />
        <input id="admin-sg-zip" type="text" placeholder="ZIP" style="width:100%;margin-bottom:6px;" />
      </div>
    </div>

    <p id="admin-loan-skip-note" style="display:none;border-top:1px dashed #ccc;padding-top:8px;margin-bottom:8px;font-size:12px;color:#a15c00;">
      ⏸️ This amount is over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} and this person has no account yet, so the security guarantor step is skipped for now. It'll be queued, but can't be approved until you link it to a real account and add a security guarantor.
    </p>

    <label>Admin Note (required — how/why you're filing this for them):</label>
    <textarea id="admin-loan-note" rows="2" style="width:100%;margin-bottom:10px;"></textarea>

    <button id="admin-loan-submit-btn" type="button" class="request-loan-btn">Submit Request</button>
    <p id="admin-loan-submit-message" style="margin-top:8px;font-size:13px;"></p>
  `;

  toggleBtn.onclick = () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  };

  const amountInput = panel.querySelector<HTMLInputElement>("#admin-loan-amount")!;
  const sgSection = panel.querySelector<HTMLElement>("#admin-loan-security-guarantor-section")!;
  const sgFields = panel.querySelector<HTMLElement>("#admin-loan-security-guarantor-fields")!;
  const skipSgCheckbox = panel.querySelector<HTMLInputElement>("#admin-loan-skip-sg")!;
  const skipNote = panel.querySelector<HTMLElement>("#admin-loan-skip-note")!;
  const targetSelectEl = panel.querySelector<HTMLSelectElement>("#admin-loan-target")!;
  const manualNameInputEl = panel.querySelector<HTMLInputElement>("#admin-loan-manual-name")!;

  const updateSgVisibility = () => {
    const amt = Number(amountInput.value || 0);
    const needsSg = requiresSecurityGuarantor(amt);
    const hasTarget = !!targetSelectEl.value;
    const hasManual = !!manualNameInputEl.value.trim();

    if (needsSg && hasTarget) {
      // Real account — admin can fill the fields now, or check "skip for now".
      sgSection.style.display = "block";
      sgFields.style.display = skipSgCheckbox.checked ? "none" : "block";
      skipNote.style.display = "none";
    } else if (needsSg && hasManual) {
      // No account yet — always deferred, no choice to make here.
      sgSection.style.display = "none";
      skipNote.style.display = "block";
    } else {
      sgSection.style.display = "none";
      skipNote.style.display = "none";
    }
  };

  amountInput.addEventListener("input", updateSgVisibility);
  targetSelectEl.addEventListener("change", updateSgVisibility);
  manualNameInputEl.addEventListener("input", updateSgVisibility);
  skipSgCheckbox.addEventListener("change", updateSgVisibility);

  const submitBtn = panel.querySelector<HTMLButtonElement>("#admin-loan-submit-btn")!;
  const msgEl = panel.querySelector<HTMLElement>("#admin-loan-submit-message")!;

  submitBtn.onclick = async () => {
    msgEl.textContent = "";
    const targetUserId = (panel.querySelector<HTMLSelectElement>("#admin-loan-target")!).value;
    const manualName = (panel.querySelector<HTMLInputElement>("#admin-loan-manual-name")!).value.trim();
    const amount = Number((panel.querySelector<HTMLInputElement>("#admin-loan-amount")!).value || 0);
    const termsMonths = Number((panel.querySelector<HTMLInputElement>("#admin-loan-terms")!).value || 1);
    const purpose = (panel.querySelector<HTMLInputElement>("#admin-loan-purpose")!).value.trim();
    const guarantorId = (panel.querySelector<HTMLSelectElement>("#admin-loan-guarantor")!).value || undefined;
    const adminNote = (panel.querySelector<HTMLTextAreaElement>("#admin-loan-note")!).value.trim();

    if (targetUserId && manualName) {
      msgEl.textContent = "⚠️ Select a member/borrower OR type a name manually — not both.";
      return;
    }
    if (!targetUserId && !manualName) { msgEl.textContent = "⚠️ Please select a member/borrower, or type a name manually."; return; }
    if (!amount || amount <= 0) { msgEl.textContent = "⚠️ Please enter a valid amount."; return; }
    if (!purpose) { msgEl.textContent = "⚠️ Please enter the loan's purpose."; return; }
    if (!adminNote) { msgEl.textContent = "⚠️ Please note how/why you're filing this for them."; return; }

    const skipSecurityGuarantorForNow = (panel.querySelector<HTMLInputElement>("#admin-loan-skip-sg")!).checked;

    let securityGuarantorInfo: GuarantorInfoInput | undefined;
    if (targetUserId && requiresSecurityGuarantor(amount) && !skipSecurityGuarantorForNow) {
      const name = (panel.querySelector<HTMLInputElement>("#admin-sg-name")!).value.trim();
      const relationship = (panel.querySelector<HTMLInputElement>("#admin-sg-relationship")!).value.trim();
      const phone = (panel.querySelector<HTMLInputElement>("#admin-sg-phone")!).value.trim();
      const email = (panel.querySelector<HTMLInputElement>("#admin-sg-email")!).value.trim();
      const street = (panel.querySelector<HTMLInputElement>("#admin-sg-street")!).value.trim();
      const barangay = (panel.querySelector<HTMLInputElement>("#admin-sg-barangay")!).value.trim();
      const city = (panel.querySelector<HTMLInputElement>("#admin-sg-city")!).value.trim();
      const province = (panel.querySelector<HTMLInputElement>("#admin-sg-province")!).value.trim();
      const zip = (panel.querySelector<HTMLInputElement>("#admin-sg-zip")!).value.trim();

      if (!name || !relationship || !phone || !email || !street || !barangay || !city || !province || !zip) {
        msgEl.textContent = `⚠️ Loans over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} require complete security guarantor details (or check "skip for now").`;
        return;
      }
      securityGuarantorInfo = { name, relationship, phone, email, homeAddress: { street, barangay, city, province, zip } };
    }

    submitBtn.setAttribute("disabled", "true");
    msgEl.textContent = "Submitting...";
    try {
      const adminId = auth.currentUser?.uid ?? "";
      const { securityGuarantorInviteId } = await adminSubmitLoanRequest({
        targetUserId: targetUserId || undefined,
        manualName: manualName || undefined,
        amount,
        purpose,
        termsMonths,
        adminId,
        adminNote,
        guarantorId,
        securityGuarantorInfo,
        skipSecurityGuarantorForNow,
      });

      const isDeferred = requiresSecurityGuarantor(amount) && (!targetUserId || skipSecurityGuarantorForNow);

      msgEl.textContent = securityGuarantorInviteId
        ? `✅ Request submitted. Send this link to the security guarantor to verify: ${buildGuarantorActivationLink(securityGuarantorInviteId)}`
        : isDeferred && manualName
        ? `✅ Request submitted and added to the queue for "${manualName}" (skipped security guarantor for now — add it once their account is linked).`
        : isDeferred
        ? `✅ Request submitted and added to the queue (skipped security guarantor for now — add it before approving).`
        : manualName
        ? `✅ Request submitted and added to the queue for "${manualName}". Link it to their real account once they sign up.`
        : "✅ Request submitted and added to the queue.";

      setTimeout(() => {
        panel.style.display = "none";
        loadLoanRequestsUI(adminSectionContent);
      }, 1800);
    } catch (err: any) {
      msgEl.textContent = `❌ ${err.message || "Failed to submit request."}`;
    } finally {
      submitBtn.removeAttribute("disabled");
    }
  };

  wrap.appendChild(toggleBtn);
  wrap.appendChild(panel);
  adminSectionContent.appendChild(wrap);
}

export async function loadLoanRequestsUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);
  await renderFinancialTotalsUI(adminSectionContent);

  // ⚡ Fetched ONCE here and reused everywhere below (the submit panel,
  // the "link to account" dropdown) — this used to be fetched 2x per
  // page load (4 queries instead of 2) because two different call sites
  // each pulled their own copy of the exact same two collections.
  const [approvedMembersForPanel, approvedBorrowersForPanel] = await Promise.all([
    getApprovedMembers(),
    getApprovedBorrowers(),
  ]);

  await renderAdminLoanSubmitPanel(adminSectionContent, approvedMembersForPanel, approvedBorrowersForPanel);

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

  // 💰 Funds-waiting list — a request whose amount currently exceeds
  // available coop funds is flagged "waiting" rather than silently
  // failing when admin tries to approve it. Sorted by effective
  // priority (credit score, penalized for being behind on the
  // fiscal-year share prepayment schedule) so admin can see who's most
  // deserving of being funded next, not just who asked first.
  const availableFunds = await getTotalFunds();

  const requestsWithPriority = await Promise.all(
    snapshot.docs.map(async (loanDoc) => {
      const loan = loanDoc.data();

      const hasAccount = loan.hasAccount !== false && !!loan.userId;

      // ⚡ Single read of the borrower's user doc — this used to be
      // fetched TWICE per request (getUserFullName() doing its own
      // getDoc, then a second separate getDoc right here for
      // creditScore), and getSharePrepaymentStatus() used to ALWAYS run
      // a live memberShareReceipts query. Now that profile doc is
      // fetched once and handed to getSharePrepaymentStatus(), which
      // uses its cached share-prepayment fields when they're current
      // (see fiscalShareSchedule.ts) instead of querying at all.
      const [borrowerSnap, guarantorName] = await Promise.all([
        hasAccount ? getDoc(doc(db, "users", loan.userId)) : Promise.resolve(null),
        getUserFullName(loan.guarantorId),
      ]);

      const borrowerProfile = borrowerSnap && borrowerSnap.exists() ? (borrowerSnap.data() as any) : null;

      const shareStatus = hasAccount
        ? await getSharePrepaymentStatus(loan.userId, new Date(), borrowerProfile)
        : ({ fiscalYearStart: new Date(), sharesExpected: 0, sharesPaid: 0, behindBy: 0, isOnTrack: true } as any);
      const borrowerName = hasAccount
        ? (borrowerProfile?.fullName || `${borrowerProfile?.firstName ?? ""} ${borrowerProfile?.lastName ?? ""}`.trim() || borrowerProfile?.email || "Unnamed User")
        : `${loan.manualName || "Unnamed"} (no account yet)`;
      const creditScore = Number(borrowerProfile?.creditScore ?? DEFAULT_CREDIT_SCORE);
      const effectivePriority = computeEffectivePriority(creditScore, shareStatus.behindBy);

      const requestedAtMs = loan.requestedAt?.toMillis ? loan.requestedAt.toMillis() : 0;
      const isFundable = Number(loan.amount ?? 0) <= availableFunds;

      return {
        loanDoc,
        loan,
        borrowerName,
        guarantorName,
        creditScore,
        shareStatus,
        effectivePriority,
        requestedAtMs,
        isFundable,
        hasAccount,
      };
    })
  );

  // Highest priority first; ties broken by whoever asked first (FIFO).
  requestsWithPriority.sort((a, b) => {
    if (b.effectivePriority !== a.effectivePriority) return b.effectivePriority - a.effectivePriority;
    return a.requestedAtMs - b.requestedAtMs;
  });

  // 📌 Save each request's rank onto its own doc. Members can't list the
  // whole loanRequests collection (security rules only let them read
  // their own), so this is how their queue-position banner — scoped to
  // just their own doc — gets a real number instead of failing outright.
  // Refreshes every time this admin page loads — but skips the write
  // entirely when the rank hasn't actually changed, since re-writing
  // the same two numbers on every tab open was pure overhead.
  await Promise.all(
    requestsWithPriority.map(({ loanDoc, loan }, idx) => {
      const nextPosition = idx + 1;
      const nextSize = requestsWithPriority.length;
      if (loan.queuePosition === nextPosition && loan.queueSize === nextSize) {
        return Promise.resolve();
      }
      return updateDoc(loanDoc.ref, {
        queuePosition: nextPosition,
        queueSize: nextSize,
      }).catch((err) => console.warn("⚠️ Failed to save queue position for", loanDoc.id, err));
    })
  );

  let requestsHtml = `
    <h3>Pending Loan Requests</h3>
    <p class="muted" style="margin-top:-6px;">
      💰 Available Funds right now: ₱${availableFunds.toLocaleString()}.
      Sorted by priority (credit score, penalized for being behind on the share prepayment schedule) — not just request order.
    </p>
  `;

  const allApprovedPeopleForLinking = [
    ...approvedMembersForPanel.map((u) => ({ ...u, roleLabel: "Member" })),
    ...approvedBorrowersForPanel.map((u) => ({ ...u, roleLabel: "Borrower" })),
  ].sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
  const linkAccountOptionsHtml = allApprovedPeopleForLinking
    .map((u) => `<option value="${u.uid}">${u.fullName || u.email} (${u.roleLabel})</option>`)
    .join("");

  const loanRequestItemsHtml = await Promise.all(requestsWithPriority.map(
    async ({ loanDoc, loan, borrowerName, guarantorName, creditScore, shareStatus, effectivePriority, isFundable, hasAccount }) => {
    const submittedDate = loan.requestedAt?.toDate
      ? loan.requestedAt.toDate().toLocaleString()
      : "N/A";

    const priorityBadge = isFundable
      ? `<span class="priority-badge priority-badge-ready">✅ Fundable now</span>`
      : `<span class="priority-badge priority-badge-waiting">⏳ Waiting for funds (needs ₱${Number(loan.amount ?? 0).toLocaleString()})</span>`;

    const shareBadge = shareStatus.behindBy > 0
      ? `<span class="priority-badge priority-badge-behind">⚠️ Behind on shares: ${shareStatus.sharesPaid}/${shareStatus.sharesExpected} paid</span>`
      : "";

    // 🛡️ Security guarantor (required over ₱10,000) — separate from the
    // effort-pool guarantorId above.
    const invite = loan.securityGuarantorInviteId
      ? await getInviteForRequest(loanDoc.id)
      : null;

    const securityGuarantorHtml = loan.securityGuarantorInviteId ? `
      <div class="admin-guarantor-block">
        <h4>🛡️ Security Guarantor</h4>
        <p>${describeGuarantorStatus(invite)}</p>
        ${invite ? `<p><strong>${invite.guarantorName}</strong> (${invite.guarantorRelationship}) — ${invite.guarantorPhone} — ${invite.guarantorEmail}</p>` : ""}
        ${invite ? `
          <div class="admin-guarantor-link" style="margin-top:6px; padding:8px; background:#f5f5f5; border-radius:8px;">
            <label style="font-size:12px; opacity:.7;">Guarantor invite link — share this with the guarantor if they lost the original message:</label>
            <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
              <input type="text" readonly value="${buildGuarantorActivationLink(invite.id)}" style="flex:1; font-size:12px; padding:4px 6px;" onclick="this.select()" />
              <button type="button" onclick="navigator.clipboard.writeText('${buildGuarantorActivationLink(invite.id)}'); this.textContent='✅ Copied'; setTimeout(()=>this.textContent='📋 Copy',1500);">📋 Copy</button>
            </div>
          </div>
        ` : ""}
        ${invite?.identityVerification ? `
          <div class="admin-verification-photos">
            <div><h5>Selfie</h5>${invite.identityVerification.selfieUrl ? `<img class="admin-verification-img" src="${invite.identityVerification.selfieUrl}" />` : "N/A"}</div>
            <div><h5>Selfie w/ ID</h5>${invite.identityVerification.selfieWithIdUrl ? `<img class="admin-verification-img" src="${invite.identityVerification.selfieWithIdUrl}" />` : "N/A"}</div>
            <div><h5>Gov ID</h5>${invite.identityVerification.govIdFrontUrl ? `<img class="admin-verification-img" src="${invite.identityVerification.govIdFrontUrl}" />` : "N/A"}</div>
          </div>
        ` : ""}
        ${invite?.status === "verification_pending" ? `
          <div class="admin-verification-actions">
            <button class="approve-guarantor-btn" data-invite-id="${invite.id}" data-loan-id="${loanDoc.id}">✅ Approve Guarantor</button>
            <button class="reject-guarantor-btn" data-invite-id="${invite.id}" data-loan-id="${loanDoc.id}">❌ Reject Guarantor</button>
          </div>
        ` : ""}
      </div>
    ` : "";

    // ⏸️ "Skip for now" case — amount over ₱10,000 but the person had no
    // account when this was submitted, so no security guarantor invite
    // exists yet. Resumes once linked to an account: admin attaches a
    // guarantor here, which then follows the normal verification flow
    // above. Approval stays blocked until this is resolved.
    const pendingSecurityGuarantorHtml = (loan.securityGuarantorPending && !loan.securityGuarantorInviteId) ? `
      <div class="admin-guarantor-block">
        <h4>🛡️ Security Guarantor — Skipped For Now</h4>
        ${hasAccount ? `
          <p>This loan is over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} and now has a real account — add their security guarantor to unlock approval.</p>
          <div class="admin-attach-sg-form" data-loan-id="${loanDoc.id}" style="max-width:420px;">
            <input class="attach-sg-name" type="text" placeholder="Guarantor full name" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-relationship" type="text" placeholder="Relationship to borrower" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-phone" type="text" placeholder="Phone number" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-email" type="email" placeholder="Email" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-street" type="text" placeholder="Street" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-barangay" type="text" placeholder="Barangay" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-city" type="text" placeholder="City" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-province" type="text" placeholder="Province" style="width:100%;margin-bottom:6px;" />
            <input class="attach-sg-zip" type="text" placeholder="ZIP" style="width:100%;margin-bottom:6px;" />
            <button class="attach-sg-btn" data-loan-id="${loanDoc.id}" type="button">➕ Attach Security Guarantor</button>
            <p class="attach-sg-message" data-loan-id="${loanDoc.id}" style="margin-top:6px;font-size:13px;"></p>
          </div>
        ` : `<p>This loan is over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} — link this request to a real account first, then a security guarantor can be added.</p>`}
      </div>
    ` : "";

    return `
      <details class="loan-request-item">
        <summary>
          <span class="loan-request-summary-name">${borrowerName}</span>
          <span class="loan-request-summary-badges">
            ${priorityBadge}
            ${shareBadge}
          </span>
        </summary>
        <div class="loan-request-body">
          <h4>Loan ID: ${loanDoc.id}</h4>
          <p><strong>Borrower:</strong> ${borrowerName}</p>
          <p><strong>Guarantor:</strong> ${guarantorName}</p>
          <p><strong>Amount:</strong> ₱${Number(loan.amount).toLocaleString()}</p>
          <p><strong>Purpose:</strong> ${loan.purpose || "Not specified"}</p>
          <p><strong>Terms:</strong> ${loan.termsMonths} month(s) — Schedule: ${loan.paymentSchedule}</p>
          <p><strong>Requested At:</strong> ${submittedDate}</p>
          <p><strong>Priority:</strong> Credit Score ${creditScore}${shareStatus.behindBy > 0 ? ` − ${shareStatus.behindBy * 5} (behind on shares)` : ""} = ${effectivePriority}</p>

          ${loan.idDocumentUrl ? `<p><a href="${loan.idDocumentUrl}" target="_blank">📷 View ID Document</a></p>` : ""}
          ${loan.coeDocumentUrl ? `<p><a href="${loan.coeDocumentUrl}" target="_blank">📄 View COE Document</a></p>` : ""}

          ${renderAgreementAcceptanceHtml(loan.agreementAcceptance)}

          ${securityGuarantorHtml}
          ${pendingSecurityGuarantorHtml}

          <div class="actions">
            ${hasAccount ? `
              <button class="approve-loan-btn" data-loan-id="${loanDoc.id}" data-user-id="${loan.userId}">Approve</button>
            ` : `
              <span class="priority-badge priority-badge-behind">🔒 No account yet — link one to approve</span>
              <div style="margin-top:6px;">
                <select class="link-account-select" data-loan-id="${loanDoc.id}" style="max-width:260px;">
                  <option value="">— Select account for ${loan.manualName || "this person"} —</option>
                  ${linkAccountOptionsHtml}
                </select>
                <button class="link-account-btn" data-loan-id="${loanDoc.id}">🔗 Link to Account</button>
              </div>
            `}
            <button class="deny-loan-btn" data-loan-id="${loanDoc.id}" data-user-id="${loan.userId}">Deny</button>
          </div>
        </div>
      </details>
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
// 🔗 LINK NO-ACCOUNT REQUEST TO A REAL ACCOUNT
// =========================
if (target.classList.contains("link-account-btn")) {
  const selectEl = listContainer.querySelector<HTMLSelectElement>(`.link-account-select[data-loan-id="${loanId}"]`);
  const chosenUserId = selectEl?.value;
  if (!chosenUserId) {
    alert("⚠️ Select the account to link this request to first.");
    return;
  }
  try {
    await adminLinkLoanRequestToAccount({
      requestId: loanId,
      targetUserId: chosenUserId,
      adminId: auth.currentUser?.uid ?? "",
    });
    loadLoanRequestsUI(adminSectionContent);
  } catch (err: any) {
    alert(`❌ ${err.message || "Failed to link this request to that account."}`);
  }
  return;
}

// =========================
// 🛡️ ATTACH SECURITY GUARANTOR (resume a "skipped for now" request)
// =========================
if (target.classList.contains("attach-sg-btn")) {
  const formEl = listContainer.querySelector<HTMLElement>(`.admin-attach-sg-form[data-loan-id="${loanId}"]`);
  const msgEl2 = listContainer.querySelector<HTMLElement>(`.attach-sg-message[data-loan-id="${loanId}"]`);
  if (!formEl) return;

  const val = (sel: string) => formEl.querySelector<HTMLInputElement>(sel)?.value.trim() || "";
  const name = val(".attach-sg-name");
  const relationship = val(".attach-sg-relationship");
  const phone = val(".attach-sg-phone");
  const email = val(".attach-sg-email");
  const street = val(".attach-sg-street");
  const barangay = val(".attach-sg-barangay");
  const city = val(".attach-sg-city");
  const province = val(".attach-sg-province");
  const zip = val(".attach-sg-zip");

  if (!name || !relationship || !phone || !email || !street || !barangay || !city || !province || !zip) {
    if (msgEl2) msgEl2.textContent = "⚠️ Please fill in all security guarantor fields.";
    return;
  }

  try {
    if (msgEl2) msgEl2.textContent = "Saving...";
    const { securityGuarantorInviteId } = await adminAttachSecurityGuarantor({
      requestId: loanId,
      securityGuarantorInfo: { name, relationship, phone, email, homeAddress: { street, barangay, city, province, zip } },
    });
    if (msgEl2) msgEl2.textContent = `✅ Security guarantor attached. Send this link to verify: ${buildGuarantorActivationLink(securityGuarantorInviteId)}`;
    setTimeout(() => loadLoanRequestsUI(adminSectionContent), 2200);
  } catch (err: any) {
    if (msgEl2) msgEl2.textContent = `❌ ${err.message || "Failed to attach security guarantor."}`;
  }
  return;
}

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

    // 🛡️ Block approval while this is still a "skip for now" no-account
    // referral over ₱10,000 with no security guarantor attached yet.
    if (loanData.securityGuarantorPending && !loanData.securityGuarantorInviteId) {
      alert(
        loanData.hasAccount === false
          ? "⚠️ Can't approve yet — link this request to a real account, then attach a security guarantor (required over ₱10,000)."
          : "⚠️ Can't approve yet — attach a security guarantor for this loan first (required over ₱10,000)."
      );
      return;
    }

    // 🛡️ Block approval until the security guarantor (required over
    // ₱10,000) is fully verified — separate from the effort-pool
    // guarantorId above. Kept in scope (not just checked) so the
    // verified guarantor's details can be stamped onto the generated
    // loan contract below.
    let verifiedSecurityGuarantorInvite: Awaited<ReturnType<typeof getInviteForRequest>> = null;
    if (loanData.securityGuarantorInviteId) {
      const invite = await getInviteForRequest(loanId);
      if (!isGuarantorFullyVerified(invite)) {
        alert(`⚠️ Can't approve yet — ${describeGuarantorStatus(invite)}`);
        return;
      }
      verifiedSecurityGuarantorInvite = invite;
    }

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

      // 2.2️⃣ CREATE LOAN CONTRACT — full generated contract text, same
      // pattern as paSwipeContracts / creditCartContracts, so Coop Loans
      // have a real persisted, downloadable contract document too. The
      // borrower already checked "I agree" at request time (see
      // agreementAcceptance on the loanRequests doc), so this contract
      // is recorded as accepted immediately rather than awaiting a
      // separate post-approval acceptance step.
      const loanContractRef = doc(collection(db, "loanContracts"));
      const loanContractText = generateLoanContract({
        memberName: borrowerName,
        amount,
        termsMonths: safeTermsMonths,
        monthlyInterestRate,
        totalInterest,
        totalPayable,
        paymentSchedule: schedule,
        startDate: new Date().toLocaleDateString(),
        purpose: loanData.purpose ?? null,
        securityGuarantor: verifiedSecurityGuarantorInvite
          ? {
              name: verifiedSecurityGuarantorInvite.guarantorName,
              relationship: verifiedSecurityGuarantorInvite.guarantorRelationship,
              phone: verifiedSecurityGuarantorInvite.guarantorPhone,
            }
          : null,
      });

      transaction.set(loanContractRef, {
        requestId: loanId,
        loanId,
        userId,
        userName: borrowerName,
        amount,
        termsMonths: safeTermsMonths,
        paymentSchedule: schedule,
        totalInterest,
        totalPayable,
        contractText: loanContractText,
        status: "accepted",
        acceptedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
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

  // =========================
  // 🛡️ APPROVE / REJECT SECURITY GUARANTOR
  // =========================
  const guarantorBtn = target.closest(
    ".approve-guarantor-btn, .reject-guarantor-btn"
  ) as HTMLElement | null;

  if (guarantorBtn) {
    const inviteId = guarantorBtn.dataset.inviteId!;
    const adminUid = auth.currentUser?.uid ?? "";

    if (guarantorBtn.classList.contains("approve-guarantor-btn")) {
      try {
        await approveGuarantorVerification(inviteId, adminUid);
        alert("✅ Security guarantor verified.");
      } catch (error: any) {
        console.error(error);
        alert(error.message || "Failed to approve guarantor.");
      }
    } else {
      const reason = prompt("Reason for rejecting this guarantor's verification:");
      if (reason === null) return;
      try {
        await rejectGuarantorVerification(inviteId, adminUid, reason);
        alert("❌ Guarantor verification rejected.");
      } catch (error: any) {
        console.error(error);
        alert(error.message || "Failed to reject guarantor.");
      }
    }

    loadLoanRequestsUI(adminSectionContent);
  }
});
}

// =====================================================================
// UI Function: Load and display Admin Overview
// =====================================================================
export async function loadOverviewUI(adminSectionContent: HTMLElement | null) {
  if (!adminSectionContent) return;
  clearMainContentArea(adminSectionContent);
  // Note: renderFinancialTotalsUI() intentionally not called here — the
  // hero cards below already show Available Funds / Total Loaned.

  const overviewContainer = document.createElement("div");
  overviewContainer.id = "admin-overview-container";
  overviewContainer.innerHTML = "<h3>Admin Overview</h3><p>Loading...</p>";
  adminSectionContent.appendChild(overviewContainer);

  try {
    const summary: DashboardSummary = await getDashboardSummary();
    const totalApprovedMembersCount = await getTotalApprovedMembersCount();
    const pools: CoopFinancialPools = await getCoopFinancialPools();
    const allApprovedMembers = await getApprovedMembers();
    const allApprovedBorrowers = await getApprovedBorrowers();
    const totalApprovedBorrowersCount = allApprovedBorrowers.length;

    // Active/inactive breakdown + total monthly shares (active members only)
    const activeMembersCount = allApprovedMembers.filter(m => m.membershipStatus !== "inactive").length;
    const inactiveMembersCount = allApprovedMembers.filter(m => m.membershipStatus === "inactive").length;
    const activeBorrowersCount = allApprovedBorrowers.filter(b => b.membershipStatus !== "inactive").length;
    const inactiveBorrowersCount = allApprovedBorrowers.filter(b => b.membershipStatus === "inactive").length;
    const totalMonthlyShares = allApprovedMembers
      .filter(m => m.membershipStatus !== "inactive")
      .reduce((sum, m) => sum + Number(m.monthlyShareCommitment ?? 0), 0);

    // 📅 Total Annual Running Shares — sum of every "Collect Share" receipt
    // recorded for the CURRENT calendar year (resets each year, unlike
    // Total Monthly Shares above, which is just the current committed rate).
    const currentYear = new Date().getFullYear();
    let totalAnnualShares = 0;
    try {
      const annualSharesSnap = await getDocs(
        query(
          collection(db, "memberShareReceipts"),
          where("forYear", "==", currentYear)
        )
      );
      annualSharesSnap.forEach(d => {
        totalAnnualShares += Number(d.data()?.amountPaid ?? 0);
      });
    } catch (err) {
      console.error("❌ Failed to compute total annual shares:", err);
    }

    // Proportions for the Collections panel bars (guard against divide-by-zero)
    const collectionsTotal =
      pools.totalPrincipalCollected + pools.totalInterestCollected + pools.totalLateFeesCollected || 1;
    const principalPct = Math.round((pools.totalPrincipalCollected / collectionsTotal) * 100);
    const interestPct = Math.round((pools.totalInterestCollected / collectionsTotal) * 100);
    const lateFeesPct = Math.round((pools.totalLateFeesCollected / collectionsTotal) * 100);

    // Proportions for the Fund Pools segmented bar
    const poolsTotal = pools.capitalPool + pools.effortPool + pools.trustFundBalance || 1;
    const capitalPoolPct = ((pools.capitalPool / poolsTotal) * 100).toFixed(1);
    const effortPoolPct = ((pools.effortPool / poolsTotal) * 100).toFixed(1);
    const trustPoolPct = ((pools.trustFundBalance / poolsTotal) * 100).toFixed(1);

let overviewHtml = `
  <div class="dp-page">

    <div class="dp-header">
      <div>
        <h2>Admin Overview</h2>
        <span class="dp-subtitle">Cooperative funds &amp; membership at a glance</span>
      </div>
      <span class="dp-live-pill"><span class="dp-live-dot"></span> Live data</span>
    </div>

    <!-- Hero: Total Available Funds + Total Loaned Amount -->
    <div class="dp-grid-2">
      <div class="dp-hero">
        <span class="dp-eyebrow">TOTAL AVAILABLE FUNDS</span>
        <div class="dp-amount">₱${summary.totalAvailableFunds.toLocaleString()}</div>
        <span class="dp-caption">Funds available for lending</span>
      </div>
      <div class="dp-stat">
        <span class="dp-eyebrow">TOTAL LOANED AMOUNT</span>
        <div class="dp-amount">₱${summary.totalLoanedAmount.toLocaleString()}</div>
        <span class="dp-caption">Outstanding principal across all loans</span>
      </div>
    </div>

    <!-- Community panel: Members / Borrowers / Pending -->
    <div class="dp-panel">
      <h3 class="dp-panel-title">Community</h3>
      <div class="dp-cols" style="--dp-cols:3;">
        <div class="dp-col">
          <span class="dp-col-label">
            <span class="dp-icon dp-icon-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            Approved Members
          </span>
          <span class="dp-col-value">${totalApprovedMembersCount.toLocaleString()}</span>
          <span class="dp-col-caption">Active cooperative members</span>
        </div>
        <div class="dp-col">
          <span class="dp-col-label">
            <span class="dp-icon dp-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            Approved Borrowers
          </span>
          <span class="dp-col-value">${totalApprovedBorrowersCount.toLocaleString()}</span>
          <span class="dp-col-caption">Active borrowers</span>
        </div>
        <div class="dp-col">
          <span class="dp-col-label">
            <span class="dp-icon dp-icon-amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span>
            Pending Users
          </span>
          <span class="dp-col-value">${summary.totalPendingUsers.toLocaleString()}</span>
          <span class="dp-col-caption">Awaiting admin approval</span>
        </div>
      </div>
    </div>

    <!-- Membership Status panel: Active/Inactive breakdown + Total Monthly Shares -->
    <div class="dp-panel">
      <h3 class="dp-panel-title">Membership Status<span class="dp-panel-hint">Active vs. departed</span></h3>

      <div class="dp-row">
        <div class="dp-row-main">
          <span class="dp-icon dp-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="dp-row-label">Active Members</span>
        </div>
        <span class="dp-row-value">${activeMembersCount.toLocaleString()}</span>
      </div>
      <div class="dp-row">
        <div class="dp-row-main">
          <span class="dp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V9"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg></span>
          <span class="dp-row-label">Inactive Members</span>
        </div>
        <span class="dp-row-value">${inactiveMembersCount.toLocaleString()}</span>
      </div>
      <div class="dp-row">
        <div class="dp-row-main">
          <span class="dp-icon dp-icon-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="dp-row-label">Active Borrowers</span>
        </div>
        <span class="dp-row-value">${activeBorrowersCount.toLocaleString()}</span>
      </div>
      <div class="dp-row" style="border-bottom:none;">
        <div class="dp-row-main">
          <span class="dp-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21V9"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg></span>
          <span class="dp-row-label">Inactive Borrowers</span>
        </div>
        <span class="dp-row-value">${inactiveBorrowersCount.toLocaleString()}</span>
      </div>

      <div class="dp-row" style="border-top:1px solid #f2eef6;padding-top:14px;">
        <span class="dp-row-label" style="font-weight:700;color:#2a1240;">Total Monthly Shares</span>
        <span class="dp-row-value dp-row-value-lg">₱${totalMonthlyShares.toLocaleString()}</span>
      </div>
      <div class="dp-row" style="border-bottom:none;">
        <span class="dp-row-label" style="font-weight:700;color:#2a1240;">Total Annual Shares (${currentYear})</span>
        <span class="dp-row-value dp-row-value-lg">₱${totalAnnualShares.toLocaleString()}</span>
      </div>
    </div>

    <!-- Collections panel: Principal / Interest / Late Fees -->
    <div class="dp-panel">
      <h3 class="dp-panel-title">Collections</h3>

      <div class="dp-row">
        <div class="dp-row-main">
          <div class="dp-row-text">
            <span class="dp-row-label">Principal Collected</span>
            <span class="dp-row-sub">Loan principal repaid</span>
          </div>
        </div>
        <span class="dp-row-value dp-row-value-lg">₱${pools.totalPrincipalCollected.toLocaleString()}</span>
      </div>
      <div class="dp-bar-track"><div class="dp-bar-fill" style="width:${principalPct}%;"></div></div>

      <div class="dp-row">
        <div class="dp-row-main">
          <div class="dp-row-text">
            <span class="dp-row-label">Interest Collected</span>
            <span class="dp-row-sub">Earnings from interest</span>
          </div>
        </div>
        <span class="dp-row-value dp-row-value-lg">₱${pools.totalInterestCollected.toLocaleString()}</span>
      </div>
      <div class="dp-bar-track"><div class="dp-bar-fill" style="width:${interestPct}%;"></div></div>

      <div class="dp-row" style="border-bottom:none;">
        <div class="dp-row-main">
          <div class="dp-row-text">
            <span class="dp-row-label">Late Fees</span>
            <span class="dp-row-sub">Penalty collections</span>
          </div>
        </div>
        <span class="dp-row-value dp-row-value-lg">₱${pools.totalLateFeesCollected.toLocaleString()}</span>
      </div>
      <div class="dp-bar-track"><div class="dp-bar-fill" style="width:${lateFeesPct}%;"></div></div>
    </div>

    <!-- Fund Pools panel: Capital / Effort / Trust -->
    <div class="dp-panel">
      <h3 class="dp-panel-title">Fund Pools<span class="dp-panel-hint">70 / 30 / 10 split</span></h3>

      <div class="dp-segmented">
        <span style="width:${capitalPoolPct}%; background:var(--secondary-purple);"></span>
        <span style="width:${effortPoolPct}%; background:#a86fe0;"></span>
        <span style="width:${trustPoolPct}%; background:#e3c9f7;"></span>
      </div>

      <div class="dp-cols" style="--dp-cols:3;">
        <div class="dp-col">
          <span class="dp-col-label"><span class="dp-legend-dot" style="background:var(--secondary-purple);"></span> Capital Pool (70%)</span>
          <span class="dp-col-value">₱${pools.capitalPool.toLocaleString()}</span>
          <span class="dp-col-caption">Reinvested funds</span>
        </div>
        <div class="dp-col">
          <span class="dp-col-label"><span class="dp-legend-dot" style="background:#a86fe0;"></span> Effort Pool (30%)</span>
          <span class="dp-col-value">₱${pools.effortPool.toLocaleString()}</span>
          <span class="dp-col-caption">Operations fund</span>
        </div>
        <div class="dp-col">
          <span class="dp-col-label"><span class="dp-legend-dot" style="background:#e3c9f7;"></span> Trust Fund (10%)</span>
          <span class="dp-col-value">₱${pools.trustFundBalance.toLocaleString()}</span>
          <span class="dp-col-caption">Risk reserve</span>
        </div>
      </div>
    </div>

    <!-- Admin Tools panel: one-time / maintenance actions -->
    <div class="dp-panel">
      <h3 class="dp-panel-title">Admin Tools<span class="dp-panel-hint">One-time / maintenance actions</span></h3>
      <div class="dp-row" style="border-bottom:none; flex-direction:column; align-items:flex-start; gap:8px;">
        <div>
          <span class="dp-row-label" style="font-weight:700;color:#2a1240;">📄 Backfill Legacy Agreements</span>
          <p style="margin:4px 0 0 0; font-size:13px; opacity:.75; max-width:520px;">
            Stamps a clearly-labeled retroactive agreement record onto any Coop Loan,
            MLF Easy Installment, or Marimar's Credit Cart request made before the new
            in-app "I Agree" checkbox existed. These are marked as an administrative
            backfill, not a live confirmation from the borrower.
          </p>
        </div>
        <button id="backfill-legacy-agreements-btn" type="button">Run Backfill</button>
        <p id="backfill-legacy-agreements-status" style="margin:0; font-size:13px;"></p>
      </div>

      <div class="dp-row" style="border-bottom:none; border-top:1px solid #f2eef6; padding-top:14px; margin-top:10px; flex-direction:column; align-items:flex-start; gap:8px;">
        <div>
          <span class="dp-row-label" style="font-weight:700;color:#2a1240;">🧾 Generate Missing Loan Contracts</span>
          <p style="margin:4px 0 0 0; font-size:13px; opacity:.75; max-width:520px;">
            Generates a full downloadable Coop Loan contract document for any active or
            completed loan that doesn't already have one (so the Loan Contracts tab
            shows every borrower, not just loans approved after this feature shipped).
            Regenerated contracts are clearly marked as an administrative backfill.
          </p>
        </div>
        <button id="backfill-loan-contracts-btn" type="button">Run Backfill</button>
        <p id="backfill-loan-contracts-status" style="margin:0; font-size:13px;"></p>
      </div>
    </div>

  </div>
`;
    overviewContainer.innerHTML = overviewHtml;

    // 📄 Wire the legacy-agreement backfill button (admin-only maintenance
    // action — see backfillLegacyAgreements() in adminService.ts).
    const backfillBtn = document.getElementById("backfill-legacy-agreements-btn") as HTMLButtonElement | null;
    const backfillStatusEl = document.getElementById("backfill-legacy-agreements-status");

    backfillBtn?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "This will stamp a retroactive 'agreement accepted' record on every existing loan / Easy Installment / Credit Cart request that doesn't already have one (including completed and rejected ones). This cannot be undone. Continue?"
      );
      if (!confirmed) return;

      backfillBtn.disabled = true;
      backfillBtn.textContent = "Running...";
      if (backfillStatusEl) {
        backfillStatusEl.style.color = "#555";
        backfillStatusEl.textContent = "⏳ Backfilling — this may take a moment for a large ledger...";
      }

      try {
        const adminUid = auth.currentUser?.uid ?? "";
        const result: LegacyBackfillResult = await backfillLegacyAgreements(adminUid);

        if (backfillStatusEl) {
          backfillStatusEl.style.color = "green";
          backfillStatusEl.textContent =
            result.total === 0
              ? "✅ Nothing to backfill — every request already has an agreement record."
              : `✅ Backfilled ${result.total} record(s): ${result.loanRequests} loan(s), ${result.paSwipeRequests} Easy Installment, ${result.creditCartRequests} Credit Cart.`;
        }
      } catch (err: any) {
        console.error("❌ Legacy agreement backfill failed:", err);
        if (backfillStatusEl) {
          backfillStatusEl.style.color = "red";
          backfillStatusEl.textContent = `❌ Backfill failed: ${err?.message || "Unknown error"}`;
        }
      } finally {
        backfillBtn.disabled = false;
        backfillBtn.textContent = "Run Backfill";
      }
    });

    // 🧾 Wire the missing-loan-contracts backfill button.
    const backfillContractsBtn = document.getElementById("backfill-loan-contracts-btn") as HTMLButtonElement | null;
    const backfillContractsStatusEl = document.getElementById("backfill-loan-contracts-status");

    backfillContractsBtn?.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "This will generate a downloadable loan contract document for every active/completed coop loan that doesn't already have one. This cannot be undone. Continue?"
      );
      if (!confirmed) return;

      backfillContractsBtn.disabled = true;
      backfillContractsBtn.textContent = "Running...";
      if (backfillContractsStatusEl) {
        backfillContractsStatusEl.style.color = "#555";
        backfillContractsStatusEl.textContent = "⏳ Generating contracts — this may take a moment...";
      }

      try {
        const result: LoanContractsBackfillResult = await backfillMissingLoanContracts();

        if (backfillContractsStatusEl) {
          backfillContractsStatusEl.style.color = "green";
          backfillContractsStatusEl.textContent =
            result.generated === 0
              ? "✅ Nothing to generate — every loan already has a contract."
              : `✅ Generated ${result.generated} contract(s). Skipped ${result.skipped} that already had one.`;
        }
      } catch (err: any) {
        console.error("❌ Loan contracts backfill failed:", err);
        if (backfillContractsStatusEl) {
          backfillContractsStatusEl.style.color = "red";
          backfillContractsStatusEl.textContent = `❌ Backfill failed: ${err?.message || "Unknown error"}`;
        }
      } finally {
        backfillContractsBtn.disabled = false;
        backfillContractsBtn.textContent = "Run Backfill";
      }
    });

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
  creditLimitsTabBtn = document.getElementById("credit-limits-tab");
  trustFundTabBtn = document.getElementById("trust-fund-tab");
  fiscalPayoutTabBtn = document.getElementById("fiscal-payout-tab");
  paSwipeManagerTabBtn = document.getElementById("pa-swipe-manager-tab");
  paSwipeRequestsTabBtn = document.getElementById("pa-swipe-requests-tab");
  paSwipeCollectionsTabBtn = document.getElementById("pa-swipe-collections-tab");
  paSwipeContractsAdminTabBtn = document.getElementById("pa-swipe-contracts-admin-tab");
  loanContractsAdminTabBtn = document.getElementById("loan-contracts-admin-tab");
  loanAgreementsAdminTabBtn = document.getElementById("loan-agreements-admin-tab");
  paSwipeAgreementsAdminTabBtn = document.getElementById("pa-swipe-agreements-admin-tab");
  creditCartAgreementsAdminTabBtn = document.getElementById("credit-cart-agreements-admin-tab");
  creditCartRequestsTabBtn = document.getElementById("credit-cart-requests-tab");
creditCartCollectionsTabBtn = document.getElementById("credit-cart-collections-tab");
creditCartContractsAdminTabBtn = document.getElementById("credit-cart-contracts-admin-tab");
pabentaShopsAdminTabBtn = document.getElementById("pabenta-shops-admin-tab");
pabentaListingsAdminTabBtn = document.getElementById("pabenta-listings-admin-tab");
affiliateApplicationsTabBtn = document.getElementById("affiliate-applications-tab");
affiliatePayoutsTabBtn = document.getElementById("affiliate-payouts-tab");
paSwipeEarningsTabBtn = document.getElementById("pa-swipe-earnings-tab");
creditCartEarningsTabBtn = document.getElementById("credit-cart-earnings-tab");
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

loanContractsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(loanContractsAdminTabBtn!);
  autoCloseSidebar();
  initLoanContractsAdmin(adminSectionContent!);
});

loanAgreementsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(loanAgreementsAdminTabBtn!);
  autoCloseSidebar();
  initLoanAgreementsAdmin(adminSectionContent!);
});

paSwipeAgreementsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(paSwipeAgreementsAdminTabBtn!);
  autoCloseSidebar();
  initPaSwipeAgreementsAdmin(adminSectionContent!);
});

creditCartAgreementsAdminTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(creditCartAgreementsAdminTabBtn!);
  autoCloseSidebar();
  initCreditCartAgreementsAdmin(adminSectionContent!);
});

affiliateApplicationsTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(affiliateApplicationsTabBtn!);
  autoCloseSidebar();
  initAffiliateApplicationsAdmin(adminSectionContent!);
});

affiliatePayoutsTabBtn?.addEventListener("click", () => {
  if (isReceiptOpen) return;
  setActiveTab(affiliatePayoutsTabBtn!);
  autoCloseSidebar();
  initAffiliatePayoutsAdmin(adminSectionContent!);
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

// 💰 Credit Limits Tab
creditLimitsTabBtn?.addEventListener("click", () => {
  console.log("💰 Credit Limits clicked");
  setActiveTab(creditLimitsTabBtn!);
  autoCloseSidebar();
  loadCreditLimitsUI(adminSectionContent!);
});

// 🏦 Trust Fund Tab
trustFundTabBtn?.addEventListener("click", () => {
  console.log("🏦 Trust Fund clicked");
  setActiveTab(trustFundTabBtn!);
  autoCloseSidebar();
  loadTrustFundUI(adminSectionContent!);
});

// 🎉 Fiscal Year Payout Tab
fiscalPayoutTabBtn?.addEventListener("click", () => {
  console.log("🎉 Fiscal Year Payout clicked");
  setActiveTab(fiscalPayoutTabBtn!);
  autoCloseSidebar();
  loadFiscalPayoutUI(adminSectionContent!);
});

// 💰 MLF Easy Installment Earnings Tab
paSwipeEarningsTabBtn?.addEventListener("click", () => {
  console.log("💰 MLF Easy Installment Earnings clicked");
  setActiveTab(paSwipeEarningsTabBtn!);
  autoCloseSidebar();
  loadBusinessEarningsUI(adminSectionContent!, "easyInstallment");
});

// 💰 Marimar's Credit Cart Earnings Tab
creditCartEarningsTabBtn?.addEventListener("click", () => {
  console.log("💰 Marimar's Credit Cart Earnings clicked");
  setActiveTab(creditCartEarningsTabBtn!);
  autoCloseSidebar();
  loadBusinessEarningsUI(adminSectionContent!, "creditCart");
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