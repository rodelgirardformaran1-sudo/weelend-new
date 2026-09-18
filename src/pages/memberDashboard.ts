// src/pages/memberDashboard.ts
// =======================================================
// IMPORTS
// =======================================================
import { getTotalFunds } from "../services/adminService";
import {
  requestLoan,
  getPotentialGuarantors,
  getActiveLoanForMember,
  getActiveGuaranteedLoansByGuarantor,
} from "../services/loanService";
import type { UserProfile } from "../type";
import type { User } from "firebase/auth";
import { doc, onSnapshot, getDoc, getDocs, query, where, collection } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { showPage } from "../main";
import { loadMemberLoanHistory } from "./memberHistory";


// =======================================================
// GLOBAL STATE
// =======================================================
let eventListenersAdded = false;
let snapshotsAttached = false;

let latestShareBalance = 0;

// these stay module-scoped
let selectedIdDocument: File | null = null;
let selectedCoeDocument: File | null = null;

// =======================================================
// MEMBER DASHBOARD DOM REF (SAFE)
// =======================================================
let el: {
  name?: HTMLElement | null;
  share?: HTMLElement | null;
  limit?: HTMLElement | null;
  funds?: HTMLElement | null;
  monthlyShare?: HTMLElement | null;
  btnRequest?: HTMLElement | null;
  modalClose?: HTMLElement | null;
  submit?: HTMLElement | null;
  idFile?: HTMLInputElement | null;
  coeFile?: HTMLInputElement | null;
  message?: HTMLElement | null;
} | null = null;

// =======================================================
// MAIN ENTRY
// =======================================================
export async function initMemberDashboard(user: User | null) {
  if (!user) {
    console.error("❌ No user passed to dashboard.");
    return;
  }

  console.log("📌 Init Member Dashboard:", user.uid);

  const memberPage = document.getElementById("page-dashboard-member");
  if (!memberPage) {
    console.error("❌ MEMBER DASHBOARD: page-dashboard-member not found");
    return;
  }

  // ✅ Scoped DOM references (SAFE)
  el = {
    name: memberPage.querySelector<HTMLElement>("#member-name-display"),
    share: memberPage.querySelector<HTMLElement>("#member-share-balance"),
    limit: memberPage.querySelector<HTMLElement>("#member-loan-limit"),
    funds: memberPage.querySelector<HTMLElement>("#member-available-funds"),
    monthlyShare: memberPage.querySelector<HTMLElement>("#member-current-month-share"),

    btnRequest: memberPage.querySelector<HTMLElement>("#member-request-loan-btn"),
    message: memberPage.querySelector<HTMLElement>("#member-message"),

    modalClose: document.getElementById("loan-application-modal-close") as HTMLElement | null,
    submit: document.getElementById("submit-loan-request-btn") as HTMLElement | null,

    idFile: document.getElementById("id-document-upload") as HTMLInputElement | null,
    coeFile: document.getElementById("coe-document-upload") as HTMLInputElement | null,
  };

  if (!el) {
    console.error("❌ Failed to initialize member DOM");
    return;
  }

  console.log("🟡 MEMBER ELEMENTS (SCOPED & SAFE):", el);


// ===================================================
// 🔄 REAL-TIME SNAPSHOTS (ATTACH ONCE)
// ===================================================
if (!snapshotsAttached) {
  snapshotsAttached = true;

  // ================= PROFILE SNAPSHOT =================
  onSnapshot(doc(db, "users", user.uid), (docSnap) => {
    if (!docSnap.exists() || !el) return;

    const data = docSnap.data() as UserProfile;

    latestShareBalance = data.shareBalance ?? 0;

    el.name && (el.name.textContent = data.fullName || data.email || "Member");
    el.share && (el.share.textContent =
      `₱${latestShareBalance.toLocaleString()}`);
    el.limit && (el.limit.textContent =
      `₱${(data.loanLimit ?? 0).toLocaleString()}`);
    el.monthlyShare && (el.monthlyShare.textContent =
      `₱${(data.monthlyShareCommitment ?? 0).toLocaleString()}`);
  });

// ============ COOP POOLS → RUNNING PAYOUT ============
onSnapshot(doc(db, "coopFinancialSummary", "current_state"), async (snap) => {
  if (!snap.exists()) return;

  try {
    const pools = snap.data();

    const payoutCapitalEl = document.getElementById("member-payout-capital");
    const payoutEffortEl = document.getElementById("member-payout-effort");
    const totalPayoutEl = document.getElementById("member-total-payout");

    const capitalPoolEl = document.getElementById("member-capital-pool");
    const poolShareEl = document.getElementById("member-pool-share");
    const trustFundEl = document.getElementById("member-trust-fund");

    

    // ==============================
    // ✅ EFFORT POOL (BASED ON LOAN VOLUME)
    // ==============================
    let effortShare = 0;

    const memberSnap = await getDoc(doc(db, "users", user.uid));
    const memberData = memberSnap.data();

    const memberVolume = Number(memberData?.lenderVolume ?? 0);
    const totalVolume = Number(pools.totalLentVolume ?? 0);

    if (totalVolume > 0) {
      effortShare = (pools.effortPool ?? 0) * (memberVolume / totalVolume);
    }

// ==============================
// ✅ CAPITAL POOL (BASED ON MONTHLY SHARE COMMITMENT — a fixed tier,
// NOT cumulative shareBalance, which grows every time a member pays)
// ==============================

const SHARE_VALUE = 1000;

// Member's own committed shares (their fixed tier)
const memberCommitment = Number(memberData?.monthlyShareCommitment ?? 0);
const memberShares = memberCommitment / SHARE_VALUE;

// Total committed shares across ALL approved members (queried fresh each time)
const allMembersSnap = await getDocs(
  query(
    collection(db, "users"),
    where("role", "==", "member"),
    where("status", "==", "approved")
  )
);

let totalCommittedShares = 0;
allMembersSnap.forEach(d => {
  const commitment = Number(d.data()?.monthlyShareCommitment ?? 0);
  totalCommittedShares += commitment / SHARE_VALUE;
});

let memberPoolShare = 0;

if (totalCommittedShares > 0) {
  const perShareValue = (pools.capitalPool ?? 0) / totalCommittedShares;
  memberPoolShare = perShareValue * memberShares;
}

// 🧪 DEBUG — VERIFY SHARE COMPUTATION
console.log("📊 POOL DEBUG", {
  capitalPool: pools.capitalPool,
  memberCommitment,
  totalCommittedShares,
  memberShares,
  perShareValue: totalCommittedShares > 0 ? (pools.capitalPool ?? 0) / totalCommittedShares : 0,
  computedMemberPoolShare: memberPoolShare,
});

// ==============================
// ✅ TOTAL PAYOUT
// ==============================
const totalPayout = memberPoolShare + effortShare;

    // ==============================
    // ✅ UPDATE UI
    // ==============================

    // Top cards
    capitalPoolEl && (capitalPoolEl.textContent =
      `₱${Math.round(pools.capitalPool ?? 0).toLocaleString()}`);

    trustFundEl && (trustFundEl.textContent =
      `₱${Math.round(pools.trustFundBalance ?? 0).toLocaleString()}`);

    poolShareEl && (poolShareEl.textContent =
      `₱${Math.round(memberPoolShare).toLocaleString()}`);

    // Running payout
    payoutCapitalEl && (payoutCapitalEl.textContent =
      `₱${Math.round(memberPoolShare).toLocaleString()}`);

    payoutEffortEl && (payoutEffortEl.textContent =
      `₱${Math.round(effortShare).toLocaleString()}`);

    totalPayoutEl && (totalPayoutEl.textContent =
      `₱${Math.round(totalPayout).toLocaleString()}`);

  } catch (err) {
    console.error("❌ Failed updating running payout:", err);
  }
});
}

  // ===================================================
  // 💰 COOP FUNDS
  // ===================================================
  try {
    const total = await getTotalFunds();
    el.funds && (el.funds.textContent = `₱${total.toLocaleString()}`);
  } catch {
    el.funds && (el.funds.textContent = "Error loading funds");
  }


  // ===================================================
  // 💳 ACTIVE LOAN
  // ===================================================
  try {
    const activeLoan = await getActiveLoanForMember(user.uid);
    updateLoanStatusUI(activeLoan);
  } catch (err) {
    console.error("❌ Failed to load active loan:", err);
  }

// ===================================================
// 🛡️ GUARANTOR STATUS (MEMBER DASHBOARD)
// ===================================================
try {
  const guaranteedLoans =
    await getActiveGuaranteedLoansByGuarantor(user.uid);

  const loansWithBorrowerNames = guaranteedLoans.map((loan) => {
    // 🧍 SELF-GUARANTEE
    if (loan.userId === user.uid) {
      return {
        ...loan,
        borrowerName: "Yourself (Self-guaranteed)",
      };
    }

    // ✅ USE STORED NAME (NO FIRESTORE READ)
    if (loan.borrowerName) {
      return loan;
    }

    // ⚠️ LEGACY FALLBACK
    return {
      ...loan,
      borrowerName: "Borrower (legacy record)",
    };
  });

  updateGuarantorStatusUI(loansWithBorrowerNames);

} catch (err) {
  console.error("❌ Failed to load guarantor status:", err);
}


  // ===================================================
  // ✅ ATTACH EVENTS (ONCE)
  // ===================================================
  if (!eventListenersAdded) {
    attachMemberEvents(user);
    attachMemberBottomNav(user); // ✅ ADD THIS
    eventListenersAdded = true;
  }
}

// =======================================================
// HELPERS
// =======================================================

// ✅ PASTE THIS FUNCTION HERE 👇
function initLoanSliders(userLoanLimit: number) {
  const amountSlider = document.getElementById("loan-amount-slider") as HTMLInputElement | null;
  const monthsSlider = document.getElementById("loan-months-slider") as HTMLInputElement | null;

  const amountDisplay = document.getElementById("loan-amount-display");
  const amountMaxDisplay = document.getElementById("loan-amount-max");
  const monthsDisplay = document.getElementById("loan-months-display");

  const interestPreview = document.getElementById("loan-interest-preview");
  const totalPreview = document.getElementById("loan-total-preview");

if (!amountSlider || !monthsSlider) {
  console.warn("⚠️ Loan sliders not found in DOM");
  return;
}

// ✅ Tell TypeScript these are now safe
const amtSlider = amountSlider;
const monSlider = monthsSlider;

const safeMax = Math.max(userLoanLimit, 1000);

amtSlider.min = "1000";
amtSlider.max = String(safeMax);
amtSlider.step = "1000";
amtSlider.value = amtSlider.min;

monSlider.min = "1";
monSlider.max = "10";
monSlider.step = "1";
monSlider.value = "1";


  amountMaxDisplay &&
    (amountMaxDisplay.textContent = `₱${safeMax.toLocaleString()}`);

  function refreshPreview() {
    const amount = Number(amtSlider.value);
    const months = Number(monSlider.value);

    const interest = amount * 0.10 * months;
    const total = amount + interest;

    amountDisplay &&
      (amountDisplay.textContent = `₱${amount.toLocaleString()}`);

    monthsDisplay &&
      (monthsDisplay.textContent = `${months}`);

    interestPreview &&
      (interestPreview.textContent = `₱${interest.toLocaleString()}`);

    totalPreview &&
      (totalPreview.textContent = `₱${total.toLocaleString()}`);
  }

    amtSlider.addEventListener("input", refreshPreview);
    monSlider.addEventListener("input", refreshPreview);

  refreshPreview();
}

// 🎯 Read slider values safely (single source of truth)
function getSliderLoanValues() {
  const amountSlider =
    document.getElementById("loan-amount-slider") as HTMLInputElement | null;
  const monthsSlider =
    document.getElementById("loan-months-slider") as HTMLInputElement | null;

  if (!amountSlider || !monthsSlider) {
    throw new Error("Loan sliders not found in DOM");
  }

  const amount = Number(amountSlider.value);
  const termsMonths = Number(monthsSlider.value);

  if (!Number.isFinite(amount) || !Number.isFinite(termsMonths)) {
    throw new Error("Invalid slider values");
  }

  return {
    amount,
    termsMonths,
  };
}

function updateLoanStatusUI(loan: any) {
  const amountEl = document.getElementById("member-current-loan-amount");
  const dueEl = document.getElementById("member-current-loan-due-date");
  const statusEl = document.getElementById("member-current-loan-status");

  // If UI elements do not exist, stop here (prevents crash)
  if (!amountEl || !dueEl || !statusEl) {
    console.warn("⚠️ Loan status UI elements not found in DOM — Skipping update.");
    return;
  }

  // 🟡 No active loan
  if (!loan) {
    amountEl.textContent = "₱0";
    dueEl.textContent = "---";
    statusEl.textContent = "No Active Loan";
    statusEl.style.color = "gray";
    return;
  }

  // 🔵 Active loan
  amountEl.textContent = `₱${(loan.remainingBalance ?? loan.amount).toLocaleString()}`;
  dueEl.textContent = loan.nextDueDate?.toDate?.().toLocaleDateString?.() ?? "---";
  statusEl.textContent = loan.status === "active" ? "🔵 Active Loan" : "🟢 Completed";
  statusEl.style.color = loan.status === "active" ? "blue" : "green";
}

// =======================================================
// UPDATE GUARANTOR STATUS UI (MEMBER DASHBOARD)
// =======================================================
function updateGuarantorStatusUI(loans: any[]) {
  const statusEl = document.getElementById("member-guarantor-status");
  const detailsEl = document.getElementById("member-guarantor-details");

  if (!statusEl || !detailsEl) {
    console.warn("⚠️ Guarantor status elements not found in DOM");
    return;
  }

  if (!loans || loans.length === 0) {
    statusEl.textContent = "None";
    detailsEl.textContent =
      "You are not currently guaranteeing any loans.";
    return;
  }

  statusEl.textContent = "Active";

  const borrowerNames = loans
    .map(l => l.borrowerName || "Unknown Borrower");

  if (borrowerNames.length === 1) {
    detailsEl.textContent =
      `Guaranteeing: ${borrowerNames[0]}`;
  } else if (borrowerNames.length <= 3) {
    detailsEl.textContent =
      `Guaranteeing: ${borrowerNames.join(", ")}`;
  } else {
    detailsEl.textContent =
      `Guaranteeing: ${borrowerNames.slice(0, 2).join(", ")} (+${borrowerNames.length - 2} more)`;
  }
}

// =======================================================
// MODAL CONTROL FUNCTIONS (MEMBER DASHBOARD)
// =======================================================

function getLoanModal(): HTMLElement | null {
  return document.getElementById("loan-application-modal");
}

async function openLoanModal(user: User) {
  const modal = getLoanModal();
  if (!modal) return;

  modal.classList.add("active");

  // 🔑 Always reload guarantors when opening
  await populateGuarantorDropdown(user.uid);

  // ===============================
  // ✅ INIT LOAN SLIDERS
  // ===============================
  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.data();

    const loanLimit = Number(userData?.loanLimit ?? 0);

    console.log("🎚 Slider loan limit:", loanLimit);

    initLoanSliders(loanLimit);
  } catch (err) {
    console.error("❌ Failed initializing loan sliders:", err);
  }

  // Clear previous messages
  showMessage("");
}

function closeLoanModal() {
  const modal = getLoanModal();
  if (!modal) return;

  modal.classList.remove("active");
}

function attachMemberEvents(user: User) {
  if (!el) return;

  // ----------------------------
  // Loan modal buttons
  // ----------------------------
  el.btnRequest?.addEventListener("click", () => openLoanModal(user));
  el.modalClose?.addEventListener("click", closeLoanModal);

  // ----------------------------
  // File uploads
  // ----------------------------
  el.idFile?.addEventListener("change", (e: any) => {
    selectedIdDocument = e.target.files?.[0] ?? null;
  });

  el.coeFile?.addEventListener("change", (e: any) => {
    selectedCoeDocument = e.target.files?.[0] ?? null;
  });

  // ----------------------------
  // Submit → Agreement
  // ----------------------------
  el.submit?.addEventListener("click", (e: Event) => {
    e.preventDefault();
    openAgreementStep(user);
  });

  // =======================================================
  // AGREEMENT MODAL BUTTONS (MEMBER DASHBOARD)
  // =======================================================
  const agreementCancelBtn = document.getElementById(
    "loan-agreement-cancel-btn"
  );
  const agreementConfirmBtn = document.getElementById(
    "loan-agreement-confirm-btn"
  );

  agreementCancelBtn?.addEventListener("click", () => {
    closeAgreementModal();
  });

  agreementConfirmBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    await submitLoan(user, e);
  });
}


// =======================================================
// LOAN AGREEMENT HELPERS
// =======================================================

function buildLoanAgreementSummary(
  amount: number,
  termsMonths: number,
  schedule: string
) {
  const monthlyInterestRate = 0.10; // 10% per month
  const lateFee = 0.03;
  const escalatedLateFee = 0.05;

  const totalInterest = amount * monthlyInterestRate * termsMonths;
  const totalPayable = amount + totalInterest;

  return {
    amount,
    monthlyInterestRate,
    totalInterest,
    totalPayable,
    termsMonths,
    schedule,
    lateFee,
    escalatedLateFee,
  };
}

function renderAgreementSummary(
  amount: number,
  termsMonths: number,
  schedule: string
): string {
  const summary = buildLoanAgreementSummary(amount, termsMonths, schedule);

return `
  <ul>
    <li><strong>Loan Amount:</strong> ₱${summary.amount.toLocaleString()}</li>
    <li><strong>Interest Rate:</strong> 10% per month</li>
    <li><strong>Total Interest (${summary.termsMonths} months):</strong> ₱${summary.totalInterest.toLocaleString()}</li>
    <li><strong>Total Payable:</strong> ₱${summary.totalPayable.toLocaleString()}</li>
    <li><strong>Terms:</strong> ${summary.termsMonths} months</li>
    <li><strong>Payment Schedule:</strong> ${summary.schedule}</li>
    <li><strong>Late Fee:</strong> 3% (5% after 15 days)</li>
  </ul>
`;
}

// =======================================================
// AGREEMENT STEP CONTROLLER
// =======================================================

function openAgreementStep(_user: User) {
  const scheduleSelect =
    document.getElementById("payment-schedule-select") as HTMLSelectElement | null;

  if (!scheduleSelect) {
    return showMessage("❌ Loan form is incomplete.");
  }

  let amount: number;
  let termsMonths: number;

  try {
    // ✅ Single source of truth
    const values = getSliderLoanValues();
    amount = values.amount;
    termsMonths = values.termsMonths;
  } catch (err) {
    console.error(err);
    return showMessage("⚠️ Please adjust the loan sliders.");
  }

  const schedule = scheduleSelect.value;

  if (!schedule) {
    return showMessage("⚠️ Please select a payment schedule.");
  }

  const summaryHtml = renderAgreementSummary(amount, termsMonths, schedule);
  closeLoanModal();
  openAgreementModal(summaryHtml);
}

// =======================================================
// DOCUMENT UPLOAD HELPER (MEMBER DASHBOARD)
// =======================================================
async function uploadDocument(
  file: File,
  userId: string,
  folder: string,
  name: string
): Promise<string> {
  const storage = getStorage();
  const path = `loanDocuments/${userId}/${folder}/${Date.now()}_${name}`;
  const fileRef = ref(storage, path);

  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

// =======================================================
// LOAN AGREEMENT MODAL HELPERS
// =======================================================

function getAgreementModal(): HTMLElement | null {
  return document.getElementById("loan-agreement-modal");
}

function openAgreementModal(summaryHtml: string) {
  const modal = getAgreementModal();
  const summaryEl = document.getElementById("loan-agreement-summary");

  if (!modal || !summaryEl) return;

  summaryEl.innerHTML = summaryHtml;
  modal.classList.add("active");
}

function closeAgreementModal() {
  const modal = getAgreementModal();
  if (!modal) return;
  modal.classList.remove("active");
}

// =======================================================
// SUBMIT LOAN REQUEST (MEMBER DASHBOARD)
// =======================================================

async function submitLoan(user: User, e: Event) {
  e.preventDefault();

  // 🔍 Query modal inputs ON DEMAND (SPA-safe)
const purposeSelect =
  document.getElementById("loan-purpose-select") as HTMLSelectElement | null;
const scheduleSelect =
  document.getElementById("payment-schedule-select") as HTMLSelectElement | null;
const guarantorSelect =
  document.getElementById("guarantor-select") as HTMLSelectElement | null;

if (
  !purposeSelect ||
  !scheduleSelect ||
  !guarantorSelect
) {
  return showMessage("❌ Loan form is not ready. Please try again.");
}

let amount: number;
let termsMonths: number;

try {
  const values = getSliderLoanValues();
  amount = values.amount;
  termsMonths = values.termsMonths;
} catch (err) {
  console.error(err);
  return showMessage("⚠️ Invalid loan slider values.");
}

const purpose = purposeSelect.value;
const guarantorId = guarantorSelect.value;
const schedule = scheduleSelect.value;

  let idUrl: string | undefined;
  let coeUrl: string | undefined;

    try {
    showMessage("⏳ Submitting loan request...", "blue");

    // ✅ DOCUMENT UPLOADS — MUST STAY HERE
    if (selectedIdDocument) {
      idUrl = await uploadDocument(
        selectedIdDocument,
        user.uid,
        "id",
        selectedIdDocument.name
      );
    }

    if (selectedCoeDocument) {
      coeUrl = await uploadDocument(
        selectedCoeDocument,
        user.uid,
        "coe",
        selectedCoeDocument.name
      );
    }

    await requestLoan(
      amount,
      purpose,
      termsMonths,
      guarantorId,
      schedule,
      idUrl,
      coeUrl
    );

    showMessage("✅ Loan request submitted. Waiting for admin approval.", "blue");
closeAgreementModal();

  } catch (err) {
    console.error(err);
    showMessage("❌ Error submitting loan request.", "red");
  }
}


// =======================================================
// LOAD GUARANTORS (MEMBER DASHBOARD)
// =======================================================
async function populateGuarantorDropdown(currentUid: string) {
  const guarantorSelect = document.getElementById(
    "guarantor-select"
  ) as HTMLSelectElement | null;

  if (!guarantorSelect) {
    console.warn("⚠️ Guarantor select not found (member)");
    return;
  }

  // Reset dropdown
  guarantorSelect.innerHTML = `<option value="">Select guarantor</option>`;

  try {
    // ✅ existing service
    const guarantors = await getPotentialGuarantors(currentUid, true);

    if (!guarantors.length) {
      guarantorSelect.innerHTML +=
        `<option value="">No active members available</option>`;
      return;
    }

    guarantors.forEach(member => {
      const option = document.createElement("option");
      option.value = member.uid;
      option.textContent = member.fullName || member.email;
      guarantorSelect.appendChild(option);
    });

    console.log("✅ Member guarantor dropdown populated");
  } catch (err) {
    console.error("❌ Failed loading member guarantors:", err);
  }
}


// =======================================================
// SMALL HELPER FOR MESSAGES
// =======================================================

function showMessage(msg: string, color = "red") {
  const msgEl = document.getElementById("member-message");
  if (!msgEl) return;
  msgEl.textContent = msg;
  msgEl.style.color = color;
}

// =======================================================
// 🔽 MEMBER BOTTOM NAVIGATION
// =======================================================
function attachMemberBottomNav(user: User) {
  const nav = document.getElementById("member-bottom-nav");
  if (!nav) return;

  nav.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;

      switch (target) {
        case "home":
          showPage("page-dashboard-member");
          break;
        case "history":
          showPage("page-member-history");
          loadMemberLoanHistory(user);
          break;
        case "info":
          showPage("page-member-info");
          break;
          case "contracts":
  import("./paSwipeContracts").then(m => m.initPaSwipeContractsPage());
  break;
case "profile":
  showPage("page-member-profile");
  import("./editProfile").then(m => m.initEditProfile("member"));
  break;
      }
    });
  });

  // Back buttons inside member sub-pages
  document
    .querySelectorAll<HTMLButtonElement>(".back-btn[data-back='member']")
    .forEach(btn => {
      btn.addEventListener("click", () => {
        showPage("page-dashboard-member");
      });
    });
}



