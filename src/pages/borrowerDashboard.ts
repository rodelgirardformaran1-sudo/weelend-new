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
import { getActiveLoanForMember, getLoanRequestForMember, borrowerCompleteLoanRequest } from "../services/loanService";
import { showPage } from "../main";
import {
  SECURITY_GUARANTOR_THRESHOLD,
  requiresSecurityGuarantor,
  buildGuarantorActivationLink,
  type GuarantorInfoInput,
} from "../services/securityGuarantorService";
import { isUserIdentityVerified } from "../services/userService";
import { loadBorrowerLoanHistory } from "./borrowerHistory";
import { renderProfileCompletionBanner } from "../utils/profileNudgeBanner";
import { renderDueDateBanner } from "../utils/dueDateNudgeBanner";
import { renderCreditScoreBanner } from "../utils/creditScoreNudgeBanner";
import { renderBorrowerQueueBanner } from "../utils/loanQueueBanner";
import { buildAgreementAcceptance } from "../utils/loanAgreementModal";


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
const borrowerCreditScoreDisplay = document.getElementById("borrower-credit-score");
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

// 📝 "Continue Your Request" completion modal — for admin-filed requests
// left with no agreementAcceptance and/or securityGuarantorPending:true
// (see borrowerCompleteLoanRequest)
const completeRequestBanner = document.getElementById("borrower-complete-request-banner");
const completeRequestBannerText = document.getElementById("borrower-complete-request-banner-text");
const continueRequestBtn = document.getElementById("borrower-continue-request-btn");
const completeRequestModal = document.getElementById("complete-request-modal");
const closeCompleteRequestModalBtn = document.getElementById("close-complete-request-modal");
const completeRequestForm = document.getElementById("complete-request-form");
const completeRequestMessage = document.getElementById("complete-request-message");
const completeRequestAgreementSection = document.getElementById("complete-request-agreement-section");
const completeRequestAgreementSummary = document.getElementById("complete-request-agreement-summary");
const completeRequestAgreementCheckbox = document.getElementById("complete-request-agreement-checkbox") as HTMLInputElement | null;
const completeRequestGuarantorSection = document.getElementById("complete-request-guarantor-section");
let pendingRequestToComplete: { id: string; amount: number; termsMonths: number; paymentSchedule?: string; needsAgreement: boolean; needsGuarantor: boolean } | null = null;
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

    // 🔔 Due-date nudge banner — non-blocking, fetched once per dashboard
    // load (not on every profile snapshot) since it's its own Firestore
    // read across the user's active loan(s) schedule.
    renderDueDateBanner(
      document.querySelector<HTMLElement>("#page-dashboard-borrower .dp-header"),
      user.uid,
      (loanId) => {
        import("./borrowerLoanDetails").then((m) => m.loadBorrowerLoanDetails(loanId));
      }
    );

    // 🎫 Loan-request queue banner — informs the borrower where their
    // own pending request stands in the priority queue.
    renderBorrowerQueueBanner(
      document.querySelector<HTMLElement>("#page-dashboard-borrower .dp-header"),
      user.uid
    );

    // Set up real-time listener for the user's profile
    const userRef = doc(db, "users", user.uid);
    onSnapshot(userRef, async (docSnap) => {
    // 🛑 Guard: stop executing after logout
    if (!currentUser || !currentUser.uid) return;

    if (docSnap.exists()) {
        const latestUserProfile = docSnap.data() as UserProfile;

            console.log("BORROWER DASHBOARD: Real-time update received. User Profile:", latestUserProfile);

            // ⚠️ Nudge banner — missing emergency contact and/or ID verification
            renderProfileCompletionBanner(
              document.querySelector<HTMLElement>("#page-dashboard-borrower .dp-header"),
              latestUserProfile,
              () => {
                showPage("page-borrower-profile");
                import("./editProfile").then(m => m.initEditProfile("borrower"));
              }
            );

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

            // 🏆 Credit score — starts at 100 (DEFAULT_CREDIT_SCORE), adjusted
            // per coop-loan installment (late payment lowers it, on-time
            // raises it — see services/creditEngine.ts). Same number that
            // ranks their loan requests against everyone else's.
            const borrowerCreditScore = Number(latestUserProfile.creditScore ?? 100);
            if (borrowerCreditScoreDisplay) {
                borrowerCreditScoreDisplay.textContent = String(borrowerCreditScore);
                borrowerCreditScoreDisplay.style.background =
                    borrowerCreditScore >= 90 ? "#e6f4ea" : borrowerCreditScore >= 70 ? "#fff3cd" : "#fdecea";
                borrowerCreditScoreDisplay.style.color =
                    borrowerCreditScore >= 90 ? "#1e7e34" : borrowerCreditScore >= 70 ? "#7a5b00" : "#a12e21";
            }
            renderCreditScoreBanner(
                document.querySelector<HTMLElement>("#page-dashboard-borrower .dp-header"),
                borrowerCreditScore
            );

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

            // ⚠️ "Continue Your Request" banner — shows only when there's a
            // pending request (usually admin-filed) still missing the
            // borrower's own agreement confirmation and/or their security
            // guarantor's details (see borrowerCompleteLoanRequest).
            if (completeRequestBanner) {
              const p = pendingLoan as any;
              const needsAgreement = !!p && !p.agreementAcceptance;
              const needsGuarantor = !!p && !!p.securityGuarantorPending && !p.securityGuarantorInviteId;

              if (p && (needsAgreement || needsGuarantor)) {
                completeRequestBanner.style.display = "block";
                pendingRequestToComplete = {
                  id: p.id,
                  amount: p.amount ?? 0,
                  termsMonths: p.termsMonths ?? 1,
                  paymentSchedule: p.paymentSchedule,
                  needsAgreement,
                  needsGuarantor,
                };
                if (completeRequestBannerText) {
                  if (needsAgreement && needsGuarantor) {
                    completeRequestBannerText.textContent = "Please confirm the loan agreement and add your security guarantor's details so your request can move forward.";
                  } else if (needsAgreement) {
                    completeRequestBannerText.textContent = "Please review and confirm the loan agreement so your request can move forward.";
                  } else {
                    completeRequestBannerText.textContent = "A security guarantor is required for loans over ₱10,000. Please add their details so your request can move forward.";
                  }
                }
              } else {
                completeRequestBanner.style.display = "none";
                pendingRequestToComplete = null;
              }
            }

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

  // 🛡️ Don't let a borrower open a new loan request while they already
  // have an active (unpaid) loan or an existing request still awaiting
  // admin approval — otherwise they can stack multiple concurrent
  // requests/loans, which nothing downstream expects.
  try {
    const [existingActiveLoan, existingPendingRequest] = await Promise.all([
      getActiveLoanForMember(currentUser.uid),
      getLoanRequestForMember(currentUser.uid),
    ]);

    if (existingActiveLoan) {
      // ⚠️ loanRequestMessage lives inside the (still-closed) loan modal,
      // so setting its text here is invisible to the borrower — alert()
      // too so they actually see why nothing opened.
      if (loanRequestMessage) {
        loanRequestMessage.textContent = "⚠️ You already have an active loan. Please finish paying it off before requesting a new one.";
      }
      alert("⚠️ You already have an active loan. Please finish paying it off before requesting a new one.");
      return;
    }

    if (existingPendingRequest) {
      if (loanRequestMessage) {
        loanRequestMessage.textContent = "⚠️ You already have a loan request awaiting admin approval. Please wait for it to be processed before submitting another.";
      }
      alert("⚠️ You already have a loan request awaiting admin approval. Please wait for it to be processed before submitting another.");
      return;
    }
  } catch (err) {
    console.error("❌ Failed checking existing loan/request before opening loan modal:", err);
    // Fail open rather than blocking a legitimate request over a lookup glitch —
    // the request-time checks elsewhere still apply.
  }

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

  // 🪪 Require an admin-approved identity verification before a loan can
  // even be submitted.
  if (!(await isUserIdentityVerified(currentUser.uid))) {
    loanRequestMessage!.textContent =
      "⚠️ Please complete your Identity Verification in Edit Profile (and wait for admin approval) before requesting a loan.";
    return;
  }

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
      loanRequestMessage!.textContent = `⚠️ Loans over ₱${SECURITY_GUARANTOR_THRESHOLD.toLocaleString()} require complete security guarantor details.`;
      return;
    }

    securityGuarantorInfo = {
      name,
      relationship,
      phone,
      email,
      homeAddress: { street, barangay, city, province, zip },
    };
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

// 📄 Build the persisted proof-of-agreement record from the exact terms
// shown in the agreement modal the user just checked and confirmed.
const finalSchedule = paymentScheduleSelect?.value ?? "15-30";
const agreementSummary = buildLoanAgreementSummary(amount, termsMonths, finalSchedule);
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
  amount,                                  // amount
  purpose,                                // purpose
  termsMonths,                            // termsMonths
  guarantorId,                            // guarantorId
  finalSchedule,                          // paymentSchedule
  idDocumentUrl,                          // idDocumentUrl
  undefined,                              // coeDocumentUrl (not collected in this flow)
  securityGuarantorInfo,                  // securityGuarantorInfo
  agreementAcceptance                     // agreementAcceptance
);

  loanRequestMessage!.textContent = securityGuarantorInviteId
    ? `⏳ Loan request submitted. Share this link with your security guarantor so they can verify: ${buildGuarantorActivationLink(securityGuarantorInviteId)}`
    : "⏳ Loan request submitted. Waiting for admin approval.";

  setTimeout(() => {
    loanApplicationModal?.classList.remove("active");
    // Leave the guarantor link on screen so the borrower can copy it —
    // only auto-clear the plain "waiting for approval" message.
    if (!securityGuarantorInviteId) {
      loanRequestMessage!.textContent = "";
    }
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

  // 📄 Reset the "I agree" checkbox + confirm button every time the modal
  // opens, so a previous acceptance can never silently carry over.
  const agreementCheckboxEl = document.getElementById("loan-agreement-checkbox") as HTMLInputElement | null;
  if (agreementCheckboxEl) agreementCheckboxEl.checked = false;
  if (agreementConfirmBtn) agreementConfirmBtn.disabled = true;

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

// 📄 Required "I agree" checkbox — the confirm button stays disabled
// until it's checked, so there's no way to submit without it.
const agreementCheckboxToggle = document.getElementById(
  "loan-agreement-checkbox"
) as HTMLInputElement | null;

agreementCheckboxToggle?.addEventListener("change", () => {
  if (agreementConfirmBtn) {
    agreementConfirmBtn.disabled = !agreementCheckboxToggle.checked;
  }
});

agreementConfirmBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  console.log("✅ Agreement CONFIRM clicked");

  if (agreementConfirmBtn.disabled) return;

  const agreementCheckboxEl = document.getElementById("loan-agreement-checkbox") as HTMLInputElement | null;
  if (!agreementCheckboxEl?.checked) {
    if (loanRequestMessage) {
      loanRequestMessage.textContent = "⚠️ Please check the box confirming you agree to the terms before submitting.";
    }
    return;
  }

  agreementConfirmBtn.disabled = true;

  await submitLoanRequestFinal();

  document
    .getElementById("loan-agreement-modal")
    ?.classList.remove("active");

  agreementConfirmBtn.disabled = false;
});

// =======================================================
// 📝 CONTINUE YOUR REQUEST MODAL (borrower self-service completion
// of an admin-filed request — agreement confirmation +/- guarantor)
// =======================================================

// Open modal from the banner button
continueRequestBtn?.addEventListener("click", () => {
  if (!pendingRequestToComplete) return;
  if (completeRequestMessage) completeRequestMessage.textContent = "";

  // Show/hide the two sections based on what this specific request needs
  if (completeRequestAgreementSection) {
    completeRequestAgreementSection.style.display = pendingRequestToComplete.needsAgreement ? "block" : "none";
  }
  if (completeRequestGuarantorSection) {
    completeRequestGuarantorSection.style.display = pendingRequestToComplete.needsGuarantor ? "block" : "none";
  }
  if (completeRequestAgreementCheckbox) completeRequestAgreementCheckbox.checked = false;

  // Render the agreement summary from the terms admin already filed
  if (pendingRequestToComplete.needsAgreement && completeRequestAgreementSummary) {
    const schedule = pendingRequestToComplete.paymentSchedule ?? "15-30";
    const agreement = buildLoanAgreementSummary(
      pendingRequestToComplete.amount,
      pendingRequestToComplete.termsMonths,
      schedule
    );
    completeRequestAgreementSummary.innerHTML = `
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
  }

  completeRequestModal?.classList.add("active");
});

// Close modal (X button)
closeCompleteRequestModalBtn?.addEventListener("click", () => {
  completeRequestModal?.classList.remove("active");
  if (completeRequestMessage) completeRequestMessage.textContent = "";
});

// Submit
completeRequestForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (completeRequestMessage) completeRequestMessage.textContent = "";

  if (!currentUser) {
    if (completeRequestMessage) completeRequestMessage.textContent = "Authentication error. Please log in again.";
    return;
  }
  if (!pendingRequestToComplete) {
    if (completeRequestMessage) completeRequestMessage.textContent = "No pending request found. Please refresh and try again.";
    return;
  }

  const { id, amount, termsMonths, paymentSchedule, needsAgreement, needsGuarantor } = pendingRequestToComplete;

  let agreementAcceptance: ReturnType<typeof buildAgreementAcceptance> | undefined;
  if (needsAgreement) {
    if (!completeRequestAgreementCheckbox?.checked) {
      if (completeRequestMessage) {
        completeRequestMessage.textContent = "⚠️ Please check the box confirming you agree to the terms before submitting.";
      }
      return;
    }
    const schedule = paymentSchedule ?? "15-30";
    const summary = buildLoanAgreementSummary(amount, termsMonths, schedule);
    agreementAcceptance = buildAgreementAcceptance("coopLoan", {
      amount: summary.amount,
      monthlyInterestRate: summary.monthlyInterestRate,
      totalInterest: summary.totalInterest,
      totalPayable: summary.totalPayable,
      termsMonths: summary.termsMonths,
      schedule: summary.schedule,
      lateFee: summary.lateFee,
      escalatedLateFee: summary.escalatedLateFee,
    });
  }

  let securityGuarantorInfo: GuarantorInfoInput | undefined;
  if (needsGuarantor) {
    const nameInput = document.getElementById("sg-guarantor-name") as HTMLInputElement | null;
    const relInput = document.getElementById("sg-guarantor-relationship") as HTMLInputElement | null;
    const phoneInput = document.getElementById("sg-guarantor-phone") as HTMLInputElement | null;
    const emailInput = document.getElementById("sg-guarantor-email") as HTMLInputElement | null;
    const streetInput = document.getElementById("sg-guarantor-home-street") as HTMLInputElement | null;
    const barangayInput = document.getElementById("sg-guarantor-home-barangay") as HTMLInputElement | null;
    const cityInput = document.getElementById("sg-guarantor-home-city") as HTMLInputElement | null;
    const provinceInput = document.getElementById("sg-guarantor-home-province") as HTMLInputElement | null;
    const zipInput = document.getElementById("sg-guarantor-home-zip") as HTMLInputElement | null;

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
      if (completeRequestMessage) {
        completeRequestMessage.textContent = `⚠️ Please fill in all security guarantor details.`;
      }
      return;
    }

    securityGuarantorInfo = {
      name,
      relationship,
      phone,
      email,
      homeAddress: { street, barangay, city, province, zip },
    };
  }

  const submitBtn = document.getElementById("submit-complete-request-btn") as HTMLButtonElement | null;
  if (submitBtn) submitBtn.disabled = true;
  if (completeRequestMessage) completeRequestMessage.textContent = "Submitting...";

  try {
    await borrowerCompleteLoanRequest({
      requestId: id,
      userId: currentUser.uid,
      agreementAcceptance,
      securityGuarantorInfo,
    });

    completeRequestModal?.classList.remove("active");
    if (completeRequestBanner) completeRequestBanner.style.display = "none";
    pendingRequestToComplete = null;
    (e.target as HTMLFormElement).reset();
    alert("✅ Thank you! Your request has been updated and can now proceed once it's your turn.");
  } catch (err: any) {
    console.error("❌ Failed to complete loan request:", err);
    if (completeRequestMessage) {
      completeRequestMessage.textContent = `❌ Failed to submit: ${err.message || err}`;
    }
    alert(`❌ Failed to submit: ${err.message || err}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
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
