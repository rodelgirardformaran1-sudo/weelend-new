// src/pages/creditCart.ts
//
// Member/borrower-facing page for Marimar's Credit Cart. Buyer already
// went shopping (grocery or department store), tells us the total
// amount, and submits it here for admin verification/approval — no
// product catalog, no downpayment.

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { calcCreditCartPricing, type CreditCartCategory } from "../utils/creditCartCalc";
import { createCreditCartRequest } from "../services/creditCartRequestService";
import { requiresSecurityGuarantor, buildGuarantorActivationLink } from "../services/securityGuarantorService";
import { promptForSecurityGuarantorInfo } from "../utils/guarantorInfoModal";
import { isUserIdentityVerified } from "../services/userService";
import { promptForAgreementAcceptance } from "../utils/loanAgreementModal";

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function initCreditCartPage() {
  const container = document.getElementById("credit-cart-content") as HTMLElement | null;
  if (!container) return;

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <p style="opacity:.85; margin-bottom:12px;">
        Already did your shopping? Enter the total amount below and we'll
        pay for it using MLF's credit card. No downpayment needed —
        repayment is semi-monthly (10% flat interest).
      </p>

      <div class="modal-form-group">
        <label>Category</label>
        <select id="cc-category">
          <option value="grocery">🛒 Grocery (1 month, 2 payments)</option>
          <option value="shopping">🏬 Department Store / Shopping Spree (3 months, 6 payments)</option>
        </select>
      </div>

      <div class="modal-form-group">
        <label>Total Amount Spent (₱)</label>
        <input id="cc-amount" type="number" min="1" step="1" placeholder="e.g., 5000" />
      </div>

      <div class="card" style="background:#f7f7f7; margin-top:10px;">
        <h4 style="margin:0 0 8px 0;">Preview</h4>
        <div id="cc-preview" style="line-height:1.7; color:#222;">
          <div>Amount: <strong>-</strong></div>
          <div>Interest (10%): <strong>-</strong></div>
          <div>Total Payable: <strong>-</strong></div>
          <div>Semi-Monthly Installment: <strong>-</strong></div>
        </div>
      </div>

      <button id="cc-submit" class="request-loan-btn" style="margin-top:12px;">🧾 Submit Request</button>
      <p id="cc-msg" style="margin-top:10px;"></p>
    </div>
  `;

  const categoryEl = container.querySelector("#cc-category") as HTMLSelectElement;
  const amountEl = container.querySelector("#cc-amount") as HTMLInputElement;
  const previewEl = container.querySelector("#cc-preview") as HTMLElement;
  const submitBtn = container.querySelector("#cc-submit") as HTMLButtonElement;
  const msgEl = container.querySelector("#cc-msg") as HTMLElement;

  function refreshPreview() {
    const amount = Number(amountEl.value || 0);
    const category = categoryEl.value as CreditCartCategory;

    if (!amount || amount <= 0) {
      previewEl.innerHTML = `
        <div>Amount: <strong>-</strong></div>
        <div>Interest (10%): <strong>-</strong></div>
        <div>Total Payable: <strong>-</strong></div>
        <div>Semi-Monthly Installment: <strong>-</strong></div>
      `;
      return;
    }

    const pricing = calcCreditCartPricing({ amount, category });
    previewEl.innerHTML = `
      <div>Amount: <strong>${peso(pricing.amount)}</strong></div>
      <div>Interest (10%): <strong>${peso(pricing.interestAmount)}</strong></div>
      <div>Total Payable: <strong>${peso(pricing.totalPayable)}</strong></div>
      <div>Term: <strong>${pricing.termMonths} month(s), ${pricing.installmentCount} payments</strong></div>
      <div>Semi-Monthly Installment: <strong>${peso(pricing.installmentAmount)}</strong></div>
    `;
  }

  categoryEl.addEventListener("change", refreshPreview);
  amountEl.addEventListener("input", refreshPreview);
  refreshPreview();

  submitBtn.addEventListener("click", async () => {
    msgEl.style.color = "red";
    msgEl.textContent = "";

    const user = auth.currentUser;
    if (!user) {
      msgEl.textContent = "Please sign in to submit a request.";
      return;
    }

    const amount = Number(amountEl.value || 0);
    const category = categoryEl.value as CreditCartCategory;

    if (!amount || amount <= 0) {
      msgEl.textContent = "Please enter a valid amount.";
      return;
    }

    // 🪪 Require an admin-approved identity verification before a Credit
    // Cart purchase can even be submitted (same rule as loans / Easy
    // Installment / Pa-benta).
    if (!(await isUserIdentityVerified(user.uid))) {
      msgEl.textContent = "⚠️ Please complete your Identity Verification in Edit Profile (and wait for admin approval) before requesting this.";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      const role = (profileSnap.data()?.role ?? "member") as "member" | "borrower";

      // 🛡️ Security guarantor required over ₱10,000
      let securityGuarantorInfo = undefined;

      if (requiresSecurityGuarantor(amount)) {
        const info = await promptForSecurityGuarantorInfo(user.email);
        if (!info) {
          // Cancelled — leave the button re-enabled, don't submit.
          submitBtn.disabled = false;
          submitBtn.textContent = "🧾 Submit Request";
          return;
        }
        securityGuarantorInfo = info;
      }

      // 📄 Loan agreement — required proof of acceptance before any
      // Marimar's Credit Cart request is submitted.
      const pricingForAgreement = calcCreditCartPricing({ amount, category });

      const agreementSummaryHtml = `
        <ul>
          <li><strong>Amount:</strong> ${peso(pricingForAgreement.amount)}</li>
          <li><strong>Interest (10%):</strong> ${peso(pricingForAgreement.interestAmount)}</li>
          <li><strong>Total Payable:</strong> ${peso(pricingForAgreement.totalPayable)}</li>
          <li><strong>Term:</strong> ${pricingForAgreement.termMonths} month(s), ${pricingForAgreement.installmentCount} payments</li>
          <li><strong>Semi-Monthly Installment:</strong> ${peso(pricingForAgreement.installmentAmount)}</li>
        </ul>
      `;

      const agreementAcceptance = await promptForAgreementAcceptance(
        "creditCart",
        "Marimar's Credit Cart Agreement",
        agreementSummaryHtml,
        {
          category,
          amount: pricingForAgreement.amount,
          interestAmount: pricingForAgreement.interestAmount,
          totalPayable: pricingForAgreement.totalPayable,
          termMonths: pricingForAgreement.termMonths,
          installmentCount: pricingForAgreement.installmentCount,
          installmentAmount: pricingForAgreement.installmentAmount,
        }
      );

      if (!agreementAcceptance) {
        // Cancelled — leave the button re-enabled, don't submit.
        submitBtn.disabled = false;
        submitBtn.textContent = "🧾 Submit Request";
        return;
      }

      const { securityGuarantorInviteId } = await createCreditCartRequest({
        userId: user.uid,
        userRole: role,
        category,
        amount,
        securityGuarantorInfo,
        agreementAcceptance,
      });

      msgEl.style.color = "green";
      msgEl.textContent = securityGuarantorInviteId
        ? `✅ Request submitted. Share this link with your security guarantor so they can verify: ${buildGuarantorActivationLink(securityGuarantorInviteId)}`
        : "✅ Request submitted. Waiting for admin approval.";
      amountEl.value = "";
      refreshPreview();
    } catch (err: any) {
      console.error(err);
      msgEl.textContent = err?.message || "Failed to submit request.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "🧾 Submit Request";
    }
  });
}