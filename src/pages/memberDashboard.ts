// src/pages/memberDashboard.ts
// =======================================================
// IMPORTS
// =======================================================
import { getTotalFunds } from "../services/adminService";
import {
  requestLoan,
  getPotentialGuarantors,
  getActiveLoanForMember,
  getLoanRequestForMember,
  getActiveGuaranteedLoansByGuarantor,
} from "../services/loanService";
import type { UserProfile } from "../type";
import type { User } from "firebase/auth";
import { doc, onSnapshot, getDoc, getDocs, query, where, collection } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { showPage } from "../main";
import { loadMemberLoanHistory } from "./memberHistory";
import {
  SECURITY_GUARANTOR_THRESHOLD,
  requiresSecurityGuarantor,
  buildGuarantorActivationLink,
  type GuarantorInfoInput,
} from "../services/securityGuarantorService";
import { isUserIdentityVerified } from "../services/userService";
import { renderProfileCompletionBanner } from "../utils/profileNudgeBanner";
import { renderDueDateBanner } from "../utils/dueDateNudgeBanner";
import { renderCreditScoreBanner } from "../utils/creditScoreNudgeBanner";
import { getTrustFundExpenses } from "../services/trustFundService";
import { getPayoutHistory } from "../services/payoutService";
import { renderBorrowerQueueBanner, renderGuarantorQueueBanner } from "../utils/loanQueueBanner";
import { buildAgreementAcceptance } from "../utils/loanAgreementModal";


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
  creditScore?: HTMLElement | null;
  btnRequest?: HTMLElement | null;
  modalClose?: HTMLElement | null;
  submit?: HTMLElement | null;
  idFile?: HTMLInputElement | null;
  coeFile?: HTMLInputElement | null;
  message?: HTMLElement | null;
} | null = null;

let currentMemberUid: string | null = null;

// =======================================================
// MAIN ENTRY
// =======================================================
export async function initMemberDashboard(user: User | null) {
  if (!user) {
    console.error("❌ No user passed to dashboard.");
    return;
  }

  currentMemberUid = user.uid;
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
    creditScore: memberPage.querySelector<HTMLElement>("#member-credit-score"),

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

  // 🔔 Due-date nudge banner — non-blocking, fetched once per dashboard
  // load (not on every profile snapshot) since it's its own Firestore
  // read across the user's active loan(s) schedule.
  renderDueDateBanner(
    document.querySelector<HTMLElement>("#page-dashboard-member .dp-header"),
    user.uid,
    (loanId) => {
      import("./memberLoanDetails").then((m) => m.loadMemberLoanDetails(loanId));
    }
  );

  // 🎫 Loan-request queue banners — informs the member where their own
  // pending request stands, and where any request(s) they guaranteed
  // (effort-pool guarantorId) stand.
  renderBorrowerQueueBanner(
    document.querySelector<HTMLElement>("#page-dashboard-member .dp-header"),
    user.uid
  );
  renderGuarantorQueueBanner(
    document.querySelector<HTMLElement>("#page-dashboard-member .dp-header"),
    user.uid
  );


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

    // 🏆 Credit score — starts at 100 (DEFAULT_CREDIT_SCORE), adjusted per
    // coop-loan installment (late payment lowers it, on-time raises it —
    // see services/creditEngine.ts). Same number that ranks loan requests.
    const memberCreditScore = Number(data.creditScore ?? 100);
    if (el.creditScore) {
      el.creditScore.textContent = String(memberCreditScore);
      el.creditScore.style.background =
        memberCreditScore >= 90 ? "#e6f4ea" : memberCreditScore >= 70 ? "#fff3cd" : "#fdecea";
      el.creditScore.style.color =
        memberCreditScore >= 90 ? "#1e7e34" : memberCreditScore >= 70 ? "#7a5b00" : "#a12e21";
    }
    renderCreditScoreBanner(
      document.querySelector<HTMLElement>("#page-dashboard-member .dp-header"),
      memberCreditScore
    );

    // ⚠️ Nudge banner — missing emergency contact and/or ID verification
    renderProfileCompletionBanner(
      document.querySelector<HTMLElement>("#page-dashboard-member .dp-header"),
      data,
      () => {
        showPage("page-member-profile");
        import("./editProfile").then(m => m.initEditProfile("member"));
      }
    );
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

    

    const memberSnap = await getDoc(doc(db, "users", user.uid));
    const memberData = memberSnap.data();

    // 🚪 A departed/inactive member (or a guarantor who has since left) is
    // excluded from BOTH pools — they no longer share in the dividends,
    // and their committed shares / lender volume are dropped from the
    // denominators so active members split the full amount between them.
    const viewerIsActive = memberData?.membershipStatus !== "inactive";

    // Fetch all approved members ONCE, fresh each time, and use it for
    // both the effort-pool and capital-pool denominators below.
    const allMembersSnap = await getDocs(
      query(
        collection(db, "users"),
        where("role", "==", "member"),
        where("status", "==", "approved")
      )
    );

    const activeMemberDocs = allMembersSnap.docs.filter(
      d => d.data()?.membershipStatus !== "inactive"
    );

    // ==============================
    // ✅ EFFORT POOL (BASED ON LOAN VOLUME) — active members only
    // ==============================
    let effortShare = 0;

    const memberVolume = viewerIsActive ? Number(memberData?.lenderVolume ?? 0) : 0;

    let totalVolume = 0;
    activeMemberDocs.forEach(d => {
      totalVolume += Number(d.data()?.lenderVolume ?? 0);
    });

    if (totalVolume > 0) {
      effortShare = (pools.effortPool ?? 0) * (memberVolume / totalVolume);
    }

// ==============================
// ✅ CAPITAL POOL (BASED ON MONTHLY SHARE COMMITMENT — a fixed tier,
// NOT cumulative shareBalance, which grows every time a member pays)
// — active members only
// ==============================

const SHARE_VALUE = 1000;

// Member's own committed shares (their fixed tier) — zero if inactive
const memberCommitment = viewerIsActive ? Number(memberData?.monthlyShareCommitment ?? 0) : 0;
const memberShares = memberCommitment / SHARE_VALUE;

// Total committed shares across ACTIVE approved members only
let totalCommittedShares = 0;
activeMemberDocs.forEach(d => {
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

    // 🛡️ Show/hide the security guarantor section as the slider crosses
    // the ₱10,000 threshold.
    const guarantorSection = document.getElementById("loan-security-guarantor-section");
    if (guarantorSection) {
      guarantorSection.style.display = requiresSecurityGuarantor(amount) ? "block" : "none";
    }
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

  // 🛡️ Don't let a member open a new loan request while they already
  // have an active (unpaid) loan or an existing request still awaiting
  // admin approval — otherwise they can stack multiple concurrent
  // requests/loans, which nothing downstream expects.
  try {
    const [existingActiveLoan, existingPendingRequest] = await Promise.all([
      getActiveLoanForMember(user.uid),
      getLoanRequestForMember(user.uid),
    ]);

    if (existingActiveLoan) {
      showMessage("⚠️ You already have an active loan. Please finish paying it off before requesting a new one.");
      return;
    }

    if (existingPendingRequest) {
      showMessage("⚠️ You already have a loan request awaiting admin approval. Please wait for it to be processed before submitting another.");
      return;
    }
  } catch (err) {
    console.error("❌ Failed checking existing loan/request before opening loan modal:", err);
    // Fail open rather than blocking a legitimate request over a lookup glitch —
    // the request-time checks elsewhere still apply.
  }

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
  // 🙋 Refer someone for a loan (no account yet)
  // ----------------------------
  const referBtn = document.getElementById("member-refer-loan-btn");
  const referPanel = document.getElementById("member-refer-loan-panel");
  const referSubmitBtn = document.getElementById("refer-loan-submit-btn");
  const referMsgEl = document.getElementById("refer-loan-message");

  referBtn?.addEventListener("click", () => {
    if (!referPanel) return;
    referPanel.style.display = referPanel.style.display === "none" ? "block" : "none";
  });

  referSubmitBtn?.addEventListener("click", async () => {
    if (!referMsgEl) return;
    referMsgEl.textContent = "";

    const nameInput = document.getElementById("refer-loan-name") as HTMLInputElement | null;
    const amountInput = document.getElementById("refer-loan-amount") as HTMLInputElement | null;
    const termsInput = document.getElementById("refer-loan-terms") as HTMLInputElement | null;
    const purposeInput = document.getElementById("refer-loan-purpose") as HTMLInputElement | null;

    const manualName = nameInput?.value.trim() || "";
    const amount = Number(amountInput?.value || 0);
    const termsMonths = Number(termsInput?.value || 1);
    const purpose = purposeInput?.value.trim() || "";

    if (!manualName) { referMsgEl.textContent = "⚠️ Please enter the person's name."; return; }
    if (!amount || amount <= 0) { referMsgEl.textContent = "⚠️ Please enter a valid amount."; return; }
    if (!purpose) { referMsgEl.textContent = "⚠️ Please enter the loan's purpose."; return; }

    (referSubmitBtn as HTMLButtonElement).setAttribute("disabled", "true");
    referMsgEl.textContent = "Submitting...";
    try {
      const { memberReferLoanRequest } = await import("../services/loanService");
      await memberReferLoanRequest({ manualName, amount, purpose, termsMonths });
      referMsgEl.textContent = `✅ ${manualName} has been added to the queue. You're recorded as their guarantor.`;
      if (nameInput) nameInput.value = "";
      if (amountInput) amountInput.value = "";
      if (termsInput) termsInput.value = "1";
      if (purposeInput) purposeInput.value = "";
      setTimeout(() => {
        if (referPanel) referPanel.style.display = "none";
      }, 2000);
    } catch (err: any) {
      referMsgEl.textContent = `❌ ${err.message || "Failed to submit referral."}`;
    } finally {
      (referSubmitBtn as HTMLButtonElement).removeAttribute("disabled");
    }
  });

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

  // 📄 Required "I agree" checkbox — the confirm button stays disabled
  // until it's checked, so there's no way to submit without it.
  const agreementCheckbox = document.getElementById(
    "loan-agreement-checkbox"
  ) as HTMLInputElement | null;

  agreementCheckbox?.addEventListener("change", () => {
    if (agreementConfirmBtn) {
      (agreementConfirmBtn as HTMLButtonElement).disabled = !agreementCheckbox.checked;
    }
  });

  agreementConfirmBtn?.addEventListener("click", async (e) => {
    e.preventDefault();

    if (!agreementCheckbox?.checked) {
      return showMessage("⚠️ Please check the box confirming you agree to the terms before submitting.", "red");
    }

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

  // 📄 Reset the "I agree" checkbox + confirm button every time the modal
  // opens, so a previous acceptance can never silently carry over.
  const checkbox = document.getElementById("loan-agreement-checkbox") as HTMLInputElement | null;
  const confirmBtn = document.getElementById("loan-agreement-confirm-btn") as HTMLButtonElement | null;
  if (checkbox) checkbox.checked = false;
  if (confirmBtn) confirmBtn.disabled = true;

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

  // 🪪 Require an admin-approved identity verification before a loan can
  // even be submitted.
  if (!(await isUserIdentityVerified(user.uid))) {
    return showMessage(
      "⚠️ Please complete your Identity Verification in Edit Profile (and wait for admin approval) before requesting a loan.",
      "red"
    );
  }

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

  // 🛡️ Security guarantor info (required over ₱10,000)
  let securityGuarantorInfo: GuarantorInfoInput | undefined;

  if (requiresSecurityGuarantor(amount)) {
    const nameInput = document.getElementById("loan-guarantor-name") as HTMLInputElement | null;
    const relInput = document.getElementById("loan-guarantor-relationship") as HTMLInputElement | null;
    const phoneInput = document.getElementById("loan-guarantor-phone") as HTMLInputElement | null;
    const emailInput = document.getElementById("loan-guarantor-email") as HTMLInputElement | null;
    const streetInput = document.getElementById("loan-guarantor-home-street") as HTMLInputElement | null;
    const barangayInput = document.getElementById("loan-guarantor-home-barangay") as HTMLInputElement | null;
    const cityInput = document.getElementById("loan-guarantor-home-city") as HTMLInputElement | null;
    const provinceInput = document.getElementById("loan-guarantor-home-province") as HTMLInputElement | null;
    const zipInput = document.getElementById("loan-guarantor-home-zip") as HTMLInputElement | null;

    const name = nameInput?.value.trim() || "";
    const relationship = relInput?.value.trim() || "";
    const phone = phoneInput?.value.trim() || "";
    const email = emailInput?.value.trim() || "";
    const street = streetInput?.value.trim() || "";
    const barangay = barangayInput?.value.trim() || "";
    const city = cityInput?.value.trim() || "";
    const province = provinceInput?.value.trim() || "";
    const zip = zipInput?.value.trim() || "";

    if (!name || !relationship || !phone || !email || !street || !barangay || !city || !province || !zip) {
      return showMessage(
        `⚠️ Loans over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} require complete security guarantor details.`,
        "red"
      );
    }

    // 🛡️ The Security Guarantor must be a separate, reachable third party
    // (unlike the effort-pool guarantorId above, which is allowed to be
    // the borrower themself). Block self-selection here.
    if (user.email && email.toLowerCase() === user.email.toLowerCase()) {
      return showMessage(
        "⚠️ Your security guarantor must be someone other than yourself — please provide a family member or other reachable contact.",
        "red"
      );
    }

    securityGuarantorInfo = {
      name,
      relationship,
      phone,
      email,
      homeAddress: { street, barangay, city, province, zip },
    };
  }

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

    // 📄 Build the persisted proof-of-agreement record from the exact
    // terms shown in the agreement modal the user just checked and
    // confirmed.
    const agreementSummary = buildLoanAgreementSummary(amount, termsMonths, schedule);
    const agreementAcceptance = buildAgreementAcceptance("coopLoan", {
      amount: agreementSummary.amount,
      monthlyInterestRate: agreementSummary.monthlyInterestRate,
      totalInterest: agreementSummary.totalInterest,
      totalPayable: agreementSummary.totalPayable,
      termsMonths: agreementSummary.termsMonths,
      schedule: agreementSummary.schedule,
      lateFee: agreementSummary.lateFee,
      escalatedLateFee: agreementSummary.escalatedLateFee,
    });

    const { securityGuarantorInviteId } = await requestLoan(
      amount,
      purpose,
      termsMonths,
      guarantorId,
      schedule,
      idUrl,
      coeUrl,
      securityGuarantorInfo,
      agreementAcceptance
    );

    if (securityGuarantorInviteId) {
      const link = buildGuarantorActivationLink(securityGuarantorInviteId);
      showMessage(
        `✅ Loan request submitted. Share this link with your security guarantor so they can verify: ${link}`,
        "blue"
      );
    } else {
      showMessage("✅ Loan request submitted. Waiting for admin approval.", "blue");
    }
closeAgreementModal();

  } catch (err: any) {
    console.error(err);
    showMessage(err?.message || "❌ Error submitting loan request.", "red");
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

// =======================================================
// 🏦 TRUST FUND EXPENSE TRANSPARENCY (read-only, toggled inline)
// =======================================================
let trustFundExpensesLoaded = false;
const viewTrustFundBtn = document.getElementById("member-view-trust-fund-expenses-btn");
const trustFundExpensesList = document.getElementById("member-trust-fund-expenses-list");

viewTrustFundBtn?.addEventListener("click", async () => {
  if (!trustFundExpensesList) return;

  const isOpen = trustFundExpensesList.style.display !== "none";
  if (isOpen) {
    trustFundExpensesList.style.display = "none";
    viewTrustFundBtn.textContent = "🧾 View Trust Fund Expenses";
    return;
  }

  trustFundExpensesList.style.display = "block";
  viewTrustFundBtn.textContent = "🧾 Hide Trust Fund Expenses";

  if (trustFundExpensesLoaded) return;
  trustFundExpensesLoaded = true;

  trustFundExpensesList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">Loading...</p>";

  try {
    const expenses = await getTrustFundExpenses();

    if (expenses.length === 0) {
      trustFundExpensesList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">No expenses recorded yet.</p>";
      return;
    }

    const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

    trustFundExpensesList.innerHTML = `
      <p class="muted" style="font-size:12px;margin-bottom:8px;">Total liquidated: ₱${totalSpent.toLocaleString()} across ${expenses.length} expense${expenses.length === 1 ? "" : "s"}.</p>
      ${expenses.map((e: any) => {
        const dateStr = e.expenseDate?.toDate ? e.expenseDate.toDate().toLocaleDateString() : "—";
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 10px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;font-size:13px;">
            <div>
              <strong>${e.description}</strong>
              <div class="muted" style="font-size:11px;">${e.category} · ${dateStr}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <strong>₱${Number(e.amount ?? 0).toLocaleString()}</strong>
              ${e.receiptUrl ? `<a href="${e.receiptUrl}" target="_blank">🧾 Receipt</a>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    `;
  } catch (err) {
    console.error("❌ Failed to load trust fund expenses:", err);
    trustFundExpensesList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">Failed to load. Please try again.</p>";
  }
});

// =======================================================
// 🎉 PAYOUT HISTORY TRANSPARENCY (read-only, toggled inline)
// =======================================================
let payoutHistoryLoaded = false;
const viewPayoutHistoryBtn = document.getElementById("member-view-payout-history-btn");
const payoutHistoryList = document.getElementById("member-payout-history-list");

viewPayoutHistoryBtn?.addEventListener("click", async () => {
  if (!payoutHistoryList) return;

  const isOpen = payoutHistoryList.style.display !== "none";
  if (isOpen) {
    payoutHistoryList.style.display = "none";
    viewPayoutHistoryBtn.textContent = "🎉 View Past Payouts";
    return;
  }

  payoutHistoryList.style.display = "block";
  viewPayoutHistoryBtn.textContent = "🎉 Hide Past Payouts";

  if (payoutHistoryLoaded) return;
  payoutHistoryLoaded = true;

  payoutHistoryList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">Loading...</p>";

  try {
    const history = await getPayoutHistory();
    const myUid = currentMemberUid;

    if (history.length === 0) {
      payoutHistoryList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">No payouts released yet.</p>";
      return;
    }

    payoutHistoryList.innerHTML = history.map((p: any) => {
      const releasedStr = p.releasedAt?.toDate ? p.releasedAt.toDate().toLocaleDateString() : "";
      const mine = (p.members ?? []).find((m: any) => m.userId === myUid);
      return `
        <div style="padding:8px 10px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;font-size:13px;">
          <strong>${p.fiscalYearLabel}</strong>
          <span class="muted" style="font-size:11px;"> — ${releasedStr}</span>
          <div style="margin-top:4px;">
            Grand Total Paid Out: ₱${Number(p.grandTotal ?? 0).toLocaleString()}
            ${mine ? `<br/><strong>Your Payout: ₱${Number(mine.totalPayout ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> (Share Balance ₱${Number(mine.shareBalanceReturned ?? 0).toLocaleString()} + Capital ₱${Number(mine.capitalShare ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} + Effort ₱${Number(mine.effortShare ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })})` : ""}
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("❌ Failed to load payout history:", err);
    payoutHistoryList.innerHTML = "<p class=\"muted\" style=\"font-size:13px;\">Failed to load. Please try again.</p>";
  }
});
