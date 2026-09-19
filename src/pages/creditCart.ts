// src/pages/creditCart.ts
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import { calcCreditCartPricing, type CreditCartCategory } from "../utils/creditCartCalc";
import { createCreditCartRequest } from "../services/creditCartRequestService";

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function loadCreditCartPage() {
  const container = document.getElementById("grocery-content") as HTMLElement | null;
  if (!container) return;

  container.innerHTML = `
    <div class="modal-form-group">
      <label>Category</label>
      <select id="cc-category">
        <option value="grocery">🛒 Grocery (1 month, 2 payments)</option>
        <option value="shopping">🏬 Department Store / Shopping Spree (3 months, 6 payments)</option>
      </select>
    </div>

    <div class="modal-form-group">
      <label>Purchase Amount (₱)</label>
      <input id="cc-amount" type="number" min="1" step="1" placeholder="e.g., 5000" />
    </div>

    <div class="card" style="background:#f7f7f7;">
      <h4 style="margin:0 0 8px 0;">Live Preview</h4>
      <div id="cc-preview" style="line-height:1.7; color:#222;">
        <div>Amount: <strong>-</strong></div>
        <div>Interest (10%): <strong>-</strong></div>
        <div>Total Payable: <strong>-</strong></div>
        <div>Semi-Monthly Installment: <strong>-</strong></div>
      </div>
    </div>

    <button id="cc-submit" class="request-loan-btn" style="margin-top:12px;">🧾 Request Credit</button>
    <p id="cc-msg" style="margin-top:10px;"></p>
  `;

  const categoryEl = document.getElementById("cc-category") as HTMLSelectElement;
  const amountEl = document.getElementById("cc-amount") as HTMLInputElement;
  const previewEl = document.getElementById("cc-preview") as HTMLElement;
  const submitBtn = document.getElementById("cc-submit") as HTMLButtonElement;
  const msgEl = document.getElementById("cc-msg") as HTMLElement;

  function refreshPreview() {
    const amount = Number(amountEl.value || 0);
    const category = categoryEl.value as CreditCartCategory;

    if (!amount) {
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
      <div>Semi-Monthly Installment (${pricing.installmentCount} payments): <strong>${peso(pricing.installmentAmount)}</strong></div>
    `;
  }

  categoryEl.addEventListener("change", refreshPreview);
  amountEl.addEventListener("input", refreshPreview);
  refreshPreview();

  submitBtn.addEventListener("click", () => {
    const amount = Number(amountEl.value || 0);
    const category = categoryEl.value as CreditCartCategory;

    if (!amount || amount <= 0) {
      msgEl.style.color = "red";
      msgEl.textContent = "Please enter a valid amount.";
      return;
    }

    openCreditCartAgreementModal(category, amount);
  });
}

function openCreditCartAgreementModal(category: CreditCartCategory, amount: number) {
  const pricing = calcCreditCartPricing({ amount, category });
  const categoryLabel = category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";

  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Credit Cart Agreement</h3>
      <p><strong>Category:</strong> ${categoryLabel}</p>
      <p><strong>Amount:</strong> ${peso(pricing.amount)}</p>
      <p><strong>Interest (10%):</strong> ${peso(pricing.interestAmount)}</p>
      <p><strong>Total Payable:</strong> ${peso(pricing.totalPayable)}</p>
      <p><strong>Term:</strong> ${pricing.termMonths} month(s), ${pricing.installmentCount} semi-monthly payments</p>
      <p><strong>Semi-Monthly Installment:</strong> ${peso(pricing.installmentAmount)}</p>
      <hr/>
      <p style="font-size:13px; opacity:.8;">
        3-day grace period, then a flat ₱100 late fee per missed cycle. No down payment required.
      </p>

      <label style="display:flex; gap:8px; align-items:center; margin-top:12px;">
        <input type="checkbox" id="cc-agree-checkbox" />
        <span>I agree to the terms above.</span>
      </label>

      <div class="modal-actions">
        <button id="cc-agree-confirm" class="btn-confirm" disabled>Submit Request</button>
        <button id="cc-agree-cancel" class="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const checkbox = document.getElementById("cc-agree-checkbox") as HTMLInputElement;
  const confirmBtn = document.getElementById("cc-agree-confirm") as HTMLButtonElement;

  checkbox.addEventListener("change", () => {
    confirmBtn.disabled = !checkbox.checked;
  });

  document.getElementById("cc-agree-cancel")?.addEventListener("click", () => modal.remove());

  confirmBtn.addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Please sign in.");
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Submitting...";

    try {
      const profileSnap = await getDoc(doc(db, "users", user.uid));
      const role = (profileSnap.data()?.role ?? "member") as "member" | "borrower";

      await createCreditCartRequest({ userId: user.uid, userRole: role, category, amount });

      alert("✅ Request submitted. Waiting for admin approval.");
      modal.remove();
    } catch (err: any) {
      alert("❌ Failed: " + (err?.message || "Unknown error"));
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Submit Request";
    }
  });
}