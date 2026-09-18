// src/pages/borrowerDashboard.ts

import { getTotalFunds } from "../services/adminService";
import { requestLoan } from "../services/loanService";
import type { UserProfile } from "../type";
import type { User } from "firebase/auth";

// 🔹 Firebase Imports
import {
  doc,
  onSnapshot,
  query,
  where,
  collection,
  getDocs
} from "firebase/firestore";
import { db } from "../firebaseConfig";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import { getUserLoanLimit } from "../services/loanService";
// ✅ correct
import { getUserFullName } from "../services/userService";
import { formatDueDate } from "../services/loanService";
import { getActiveLoanForMember, getLoanRequestForMember } from "../services/loanService";
import { showPage } from "../main";
import { loadBorrowerLoanHistory } from "./borrowerHistory";


let currentUser: User | null = null;
let borrowerNavBound = false;

/**
 * 📌 Load ACTIVE / APPROVED MEMBERS as guarantors
 * - No self-guarantee
 * - No effort pool logic yet
 */
async function loadGuarantorList(currentUid: string) {
  if (!guarantorSelect) {
    console.warn("⚠️ Guarantor select element not found.");
    return;
  }

  // Reset dropdown
  guarantorSelect.innerHTML = "";

  // Default placeholder
  guarantorSelect.appendChild(
    new Option("Select a guarantor", "")
  );

  try {
    const q = query(
      collection(db, "users"),
      where("role", "==", "member"),
      where("status", "==", "approved")
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      guarantorSelect.appendChild(
        new Option("No active members available", "")
      );
      return;
    }

    snap.forEach(docSnap => {
      // ❌ Do not allow self-guarantee (even if member)
      if (docSnap.id === currentUid) return;

      const data = docSnap.data();
      guarantorSelect.appendChild(
        new Option(
          data.fullName || data.email || "Unnamed Member",
          docSnap.id
        )
      );
    });

    console.log("✅ Guarantor list populated (members only).");
  } catch (err) {
    console.error("❌ Failed loading guarantors:", err);
  }
}


// Global DOM element references for the borrower dashboard
const borrowerNameDisplay = document.getElementById("borrower-name-display");
const borrowerLoanLimitCardDisplay = document.getElementById("borrower-loan-limit-display"); // Loan limit shown on dashboard card
// PHASE 5 ADDITION: New DOM elements for guarantor status and current loan
const borrowerGuarantorStatus = document.getElementById("borrower-guarantor-status");
const borrowerGuarantorDetails = document.getElementById("borrower-guarantor-details");
const borrowerCurrentLoanAmount = document.getElementById("borrower-current-loan-amount");
const borrowerCurrentLoanDueDate = document.getElementById("borrower-current-loan-due-date");
const borrowerCurrentLoanStatus = document.getElementById("borrower-current-loan-status");


// Note: memberAvailableFundsDisplay might be null if not present in borrower's HTML, but it's okay.
const memberAvailableFundsDisplay = document.getElementById("member-available-funds");


// Loan Application Modal DOM elements
const borrowerRequestLoanBtn = document.getElementById("borrower-request-loan-btn");
const loanApplicationModal = document.getElementById("loan-application-modal");
const loanApplicationModalCloseBtn = document.getElementById("loan-application-modal-close");
const loanAmountInput = document.getElementById("loan-amount-input") as HTMLInputElement | null;
const loanPurposeSelect = document.getElementById("loan-purpose-select") as HTMLSelectElement | null;
const currentLoanLimitSpan = document.getElementById("current-loan-limit"); // This is inside the modal
const loanRequestMessage = document.getElementById("loan-request-message");
const submitLoanRequestBtn = document.getElementById("submit-loan-request-btn");
const paymentScheduleSelect = document.getElementById("payment-schedule-select") as HTMLSelectElement | null;

// PHASE 5 ADDITION: Guarantor Select element in the modal
const guarantorSelect = document.getElementById("guarantor-select") as HTMLSelectElement | null;

// Borrower-specific content area
const borrowerSectionContent = document.getElementById("borrower-section-content");


// Main function to initialize and render the Borrower Dashboard

export async function initBorrowerDashboard(user: User | null) {
    if (!user) {
        console.error("BORROWER DASHBOARD: Authenticated user not available for initialization.");
        return;
    }
    console.log("BORROWER DASHBOARD: Initializing for UID:", user.uid);
    currentUser = user; // ✅ STORE USER ONCE

    // Set up real-time listener for the user's profile
    const userRef = doc(db, "users", user.uid);
    onSnapshot(userRef, async (docSnap) => {
    // 🛑 Guard: stop executing after logout
    if (!currentUser || !currentUser.uid) return;

    if (docSnap.exists()) {
        const latestUserProfile = docSnap.data() as UserProfile;

            console.log("BORROWER DASHBOARD: Real-time update received. User Profile:", latestUserProfile);

            // Update borrower's name dynamically
            if (borrowerNameDisplay) {
                borrowerNameDisplay.textContent = latestUserProfile.fullName || latestUserProfile.email || "Borrower";
            } else {
                console.warn("BORROWER DASHBOARD: Element 'borrower-name-display' not found.");
            }

            // Update borrower's loan limit on the dashboard card
            if (borrowerLoanLimitCardDisplay) {
                borrowerLoanLimitCardDisplay.textContent = `₱${(latestUserProfile.loanLimit ?? 0).toLocaleString()}`;
            } else {
                console.warn("BORROWER DASHBOARD: Element 'borrower-loan-limit-display' not found.");
            }

            // Update loan limit display IN THE MODAL whenever profile updates
            if (currentLoanLimitSpan && loanAmountInput) {
                const loanLimit = await getUserLoanLimit(currentUser!.uid);
                currentLoanLimitSpan.textContent = `₱${loanLimit.toLocaleString()}`;
                loanAmountInput.max = loanLimit.toString(); // Set max for input field in modal
            } else {
                 console.warn("BORROWER DASHBOARD: Elements 'current-loan-limit' or 'loan-amount-input' not found (for modal).");
            }

            // PHASE 5 ADDITION: Populate Guarantor Status Card
            // For a borrower, this means who is guaranteeing THEIR loan
            if (borrowerGuarantorStatus && borrowerGuarantorDetails) {
            const activeLoan = await getActiveLoanForMember(currentUser!.uid);

            console.log("🔍 Active Loan:", activeLoan);

            const guarantorUid =
              activeLoan?.guarantorId ||
              (activeLoan as any)?.guarantor ||
              (activeLoan as any)?.guarantorUid ||
              (activeLoan as any)?.guarantorUID ||
              (activeLoan as any)?.guarantorUserId;

            if (guarantorUid) {
             borrowerGuarantorStatus.textContent = "Guaranteed";
              const guarantorName = await getUserFullName(guarantorUid);
              borrowerGuarantorDetails.textContent = `Guaranteed by: ${guarantorName}`;
            } else {
              borrowerGuarantorStatus.textContent = "None";
              borrowerGuarantorDetails.textContent = "No guarantor for your active loan.";
            }
            } else {
                console.warn("BORROWER DASHBOARD: Elements 'borrower-guarantor-status' or 'borrower-guarantor-details' not found.");
            }

            // PHASE 5 ADDITION: Populate Current Loan Card
            const pendingLoan = await getLoanRequestForMember(currentUser!.uid);
            const activeLoan = await getActiveLoanForMember(currentUser!.uid);

            if (borrowerCurrentLoanAmount && borrowerCurrentLoanDueDate && borrowerCurrentLoanStatus) {

             // ⏳ Pending Loan Request
              if (pendingLoan) {
                borrowerCurrentLoanAmount.textContent = `₱${(pendingLoan.amount ?? 0).toLocaleString()}`
                borrowerCurrentLoanDueDate.textContent = "Waiting for Approval";
                borrowerCurrentLoanStatus.textContent = "⏳ Pending Approval";
                return;
            }

              // 🔵 Active Loan
              if (activeLoan) {
                const balance =
                  typeof activeLoan.remainingBalance === "number"
                    ? activeLoan.remainingBalance
                    : activeLoan.amountBorrowed ?? activeLoan.amount ?? 0;

                borrowerCurrentLoanAmount.textContent = `₱${balance.toLocaleString()}`;
                borrowerCurrentLoanDueDate.textContent = formatDueDate(activeLoan.nextDueDate);
                borrowerCurrentLoanStatus.textContent = "🔵 Active";
                return;
              }

            // ⚪ No loan
            borrowerCurrentLoanStatus.textContent = "No loans yet";
            borrowerCurrentLoanAmount.textContent = "₱0";
            borrowerCurrentLoanDueDate.textContent = "N/A";

            } else {
            console.warn("BORROWER DASHBOARD: One or more elements for 'Your Current Loan' card not found.");
            }

            // TODO: Display borrower's current outstanding loans, history, etc. in borrowerSectionContent
            if (borrowerSectionContent) {
                // Example: borrowerSectionContent.innerHTML = `<h3>Your Current Loans</h3><p>You owe: ₱${latestUserProfile.loanBalance ?? 0}</p>`;
            } else {
                 console.warn("BORROWER DASHBOARD: Element 'borrower-section-content' not found.");
            }

        } else {
            console.error("BORROWER DASHBOARD: User profile not found for UID:", user.uid);
        }
    });

    // Fetch and display co-op funds (if relevant for borrower dashboard, otherwise consider removing)
    if (memberAvailableFundsDisplay) {
        memberAvailableFundsDisplay.textContent = "Loading...";
        try {
            const totalCoopFunds = await getTotalFunds();
            memberAvailableFundsDisplay.textContent = `₱${totalCoopFunds.toLocaleString()}`;
        } catch (error: any) {
            console.error("BORROWER DASHBOARD: Error loading co-op funds:", error);
            memberAvailableFundsDisplay.textContent = "Error";
        }
    } else {
        console.warn("BORROWER DASHBOARD: Element 'member-available-funds' not found. (Optional for borrower)");
    }
        attachBorrowerBottomNav(user); // ✅ ADD

  }

    
// ===============================
// EVENT LISTENERS: LOAN MODAL
// ===============================

// 1️⃣ OPEN LOAN MODAL (SETUP ONLY)
borrowerRequestLoanBtn?.addEventListener("click", async () => {
  if (!loanApplicationModal || !currentUser) return;

  // Open modal
  loanApplicationModal.classList.add("active");

  // Load guarantors
  await loadGuarantorList(currentUser.uid);

  try {
    const limit = await getUserLoanLimit(currentUser.uid);

    // Update label (optional display)
    if (currentLoanLimitSpan) {
      currentLoanLimitSpan.textContent = `₱${limit.toLocaleString()}`;
    }

    // 🎚 Initialize sliders
    initLoanSliders(limit);
  } catch (err) {
    console.error("❌ Failed initializing borrower sliders:", err);
  }

  // Clear messages
  if (loanRequestMessage) loanRequestMessage.textContent = "";
});


// 2️⃣ CLOSE MODAL (X BUTTON) — ATTACH ONCE
loanApplicationModalCloseBtn?.addEventListener("click", () => {
  loanApplicationModal?.classList.remove("active");
  if (loanRequestMessage) loanRequestMessage.textContent = "";
});


// 3️⃣ SUBMIT LOAN REQUEST (ALL LOGIC HERE)
submitLoanRequestBtn?.addEventListener("click", (e) => {
  e.preventDefault();

  // Clear old messages
  if (loanRequestMessage) loanRequestMessage.textContent = "";

  // Close loan form modal FIRST
  loanApplicationModal?.classList.remove("active");

  // Open agreement modal with computed data
  openLoanAgreementModal();
});

async function submitLoanRequestFinal() {
  console.log("🚀 submitLoanRequestFinal() STARTED");

  if (!currentUser) {
    console.warn("⛔ currentUser is null");
    loanRequestMessage!.textContent = "Authentication error. Please log in again.";
    return;
  }

  console.log("✅ currentUser OK");

if (!loanPurposeSelect) {
  console.warn("⛔ Missing loanPurposeSelect");
  loanRequestMessage!.textContent = "Form error. Please refresh.";
  return;
}


  console.log("✅ Form elements OK");

  let amount: number;
  let termsMonths: number;

  try {
    const values = getSliderLoanValues();
    amount = values.amount;
    termsMonths = values.termsMonths;
  } catch (err) {
    console.error("❌ getSliderLoanValues FAILED:", err);
    loanRequestMessage!.textContent = "⚠️ Invalid loan slider values.";
    return;
  }

  // FILE VALIDATION
  const idDocumentInput = document.getElementById("id-document-upload") as HTMLInputElement;
  const coeDocumentInput = document.getElementById("coe-document-upload") as HTMLInputElement;

  if (!idDocumentInput?.files?.length) {
    loanRequestMessage!.textContent = "Please upload a Valid ID.";
    return;
  }


  loanRequestMessage!.textContent = "Submitting loan request...";
  submitLoanRequestBtn!.setAttribute("disabled", "true");

  try {
  const storage = getStorage();

  // 1️⃣ Upload ID (REQUIRED)
  const idFile = idDocumentInput.files[0];
  const idRef = ref(storage, `loanDocuments/${currentUser!.uid}/ID_${Date.now()}`);
  await uploadBytes(idRef, idFile);
  const idDocumentUrl = await getDownloadURL(idRef);



// 3️⃣ Send loan request (ALWAYS RUNS)
const purpose = loanPurposeSelect.value || "";
const guarantorId = guarantorSelect?.value || undefined;

await requestLoan(
  amount,                                  // amount
  purpose,                                // purpose
  termsMonths,                            // termsMonths
  guarantorId,                            // guarantorId
  paymentScheduleSelect?.value ?? "15-30",// paymentSchedule
  idDocumentUrl                           // idDocumentUrl
);

  loanRequestMessage!.textContent =
    "⏳ Loan request submitted. Waiting for admin approval.";

  setTimeout(() => {
    loanApplicationModal?.classList.remove("active");
    loanRequestMessage!.textContent = "";
  }, 1500);

// 4️⃣ Reset form (null-safe)
if (loanPurposeSelect) loanPurposeSelect.value = "";
if (idDocumentInput) idDocumentInput.value = "";
if (coeDocumentInput) coeDocumentInput.value = "";
if (guarantorSelect) guarantorSelect.value = "";

} catch (error: any) {
  console.error("❌ Loan Request Failed:", error);
  loanRequestMessage!.textContent = `❌ Failed to submit: ${error.message}`;
} finally {
  submitLoanRequestBtn!.removeAttribute("disabled");
  }
}

// =======================================================
// 🎚 LOAN SLIDER HELPERS (BORROWER)
// =======================================================

// Initialize sliders when modal opens
function initLoanSliders(userLoanLimit: number) {
  const amountSlider =
    document.getElementById("loan-amount-slider") as HTMLInputElement | null;
  const monthsSlider =
    document.getElementById("loan-months-slider") as HTMLInputElement | null;

  const amountDisplay = document.getElementById("loan-amount-display");
  const amountMaxDisplay = document.getElementById("loan-amount-max");
  const monthsDisplay = document.getElementById("loan-months-display");

  const interestPreview = document.getElementById("loan-interest-preview");
  const totalPreview = document.getElementById("loan-total-preview");

if (!amountSlider || !monthsSlider) {
  console.warn("⚠️ Borrower loan sliders not found in DOM");
  return;
}

// ✅ Tell TypeScript these are safe
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

function openLoanAgreementModal() {
  let amount: number;
  let termsMonths: number;

  try {
    const values = getSliderLoanValues();
    amount = values.amount;
    termsMonths = values.termsMonths;
  } catch (err) {
    console.error(err);
    loanRequestMessage!.textContent =
      "⚠️ Please adjust the loan sliders before proceeding.";
    return;
  }

  const schedule = paymentScheduleSelect?.value ?? "Semi-Monthly";

  if (!amount || amount <= 0 || !termsMonths) {
    loanRequestMessage!.textContent =
      "Please complete the loan form before proceeding.";
    return;
  }

  const agreement = buildLoanAgreementSummary(
    amount,
    termsMonths,
    schedule
  );

  const summaryEl = document.getElementById("loan-agreement-summary");
  if (!summaryEl) {
    console.error("Loan agreement summary container not found.");
    return;
  }

  summaryEl.innerHTML = `
    <ul>
      <li><strong>Loan Amount:</strong> ₱${agreement.amount.toLocaleString()}</li>
      <li><strong>Interest Rate:</strong> 10% per month</li>
      <li><strong>Total Interest (${agreement.termsMonths} months):</strong> ₱${agreement.totalInterest.toLocaleString()}</li>
      <li><strong>Total Payable:</strong> ₱${agreement.totalPayable.toLocaleString()}</li>
      <li><strong>Terms:</strong> ${agreement.termsMonths} months</li>
      <li><strong>Payment Schedule:</strong> ${agreement.schedule}</li>
      <li><strong>Late Fee:</strong> 3% (5% after 15 days)</li>
    </ul>
  `;

  document
    .getElementById("loan-agreement-modal")
    ?.classList.add("active");
}

// =======================================================
// AGREEMENT MODAL BUTTON EVENTS (BORROWER DASHBOARD)
// =======================================================

const agreementCancelBtn = document.getElementById(
  "loan-agreement-cancel-btn"
) as HTMLButtonElement | null;

const agreementConfirmBtn = document.getElementById(
  "loan-agreement-confirm-btn"
) as HTMLButtonElement | null;

agreementCancelBtn?.addEventListener("click", () => {
  document
    .getElementById("loan-agreement-modal")
    ?.classList.remove("active");
});

agreementConfirmBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  console.log("✅ Agreement CONFIRM clicked");

  if (agreementConfirmBtn.disabled) return;

  agreementConfirmBtn.disabled = true;

  await submitLoanRequestFinal();

  document
    .getElementById("loan-agreement-modal")
    ?.classList.remove("active");

  agreementConfirmBtn.disabled = false;
});

// =======================================================
// 🔽 BORROWER BOTTOM NAVIGATION
// =======================================================
function attachBorrowerBottomNav(user: User) {
  if (borrowerNavBound) return;
borrowerNavBound = true;
  const nav = document.getElementById("borrower-bottom-nav")
  if (!nav) return;

  nav.querySelectorAll<HTMLButtonElement>(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;

      switch (target) {
        case "home":
          showPage("page-dashboard-borrower");
          break;
        case "history":
          showPage("page-borrower-history");
          loadBorrowerLoanHistory(user);
        break;
        case "info":
          showPage("page-borrower-info");
          break;
          case "contracts":
  import("./paSwipeContracts").then(m => m.initPaSwipeContractsPage());
  break;
        case "profile":
  showPage("page-borrower-profile");
  import("./editProfile").then(m => m.initEditProfile("borrower"));
  break;

      }
    });
  });
    // Back buttons inside borrower sub-pages
  document.querySelectorAll<HTMLButtonElement>(".back-btn[data-back='borrower']")
    .forEach(btn => {
      btn.addEventListener("click", () => {
        showPage("page-dashboard-borrower");
      });
    });
}
