// src/pages/myReceipts.ts
//
// Borrower/member self-service "My Receipts" page — every payment
// receipt across all four WeeLend payment types (Coop Loan repayments,
// Monthly Share commitments, MLF Easy Installment, Marimar's Credit
// Cart), each downloadable as a PDF. See receiptService.ts for where
// the underlying data actually lives.

import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { showPage } from "../main";
import { getReceiptsForUser, type ReceiptRecord } from "../services/receiptService";
import { downloadReceiptPdf } from "../utils/receiptPdf";

function peso(n: number): string {
  return `₱${Number(n || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const TYPE_ICON: Record<ReceiptRecord["type"], string> = {
  loanRepayment: "🏦",
  shareCollection: "💰",
  easyInstallment: "💳",
  creditCart: "🛍️",
};

let currentMemberName = "Member";
let currentReceipts: ReceiptRecord[] = [];

// ✅ Public entry point for BOTH member and borrower dashboards
export async function initMyReceiptsPage() {
  showPage("page-my-receipts");

  const root = document.getElementById("my-receipts-root");
  if (!root) {
    console.warn("❌ my-receipts-root not found");
    return;
  }

  await renderMyReceiptsPage(root);
}

export async function renderMyReceiptsPage(container: HTMLElement) {
  container.innerHTML = `
    <h2>My Receipts</h2>
    <p class="muted">Every payment you've made — loan repayments, share contributions, MLF Easy Installment, and Marimar's Credit Cart. Each can be downloaded as a PDF.</p>

    <div id="receipts-state" class="muted">Loading...</div>
    <div id="receipts-list" class="contracts-list"></div>
  `;

  const user = auth.currentUser;
  const stateEl = container.querySelector("#receipts-state") as HTMLElement | null;
  const listEl = container.querySelector("#receipts-list") as HTMLElement | null;

  if (!stateEl || !listEl) return;

  if (!user) {
    stateEl.textContent = "You must be signed in.";
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    const userData = userSnap.exists() ? (userSnap.data() as any) : null;
    currentMemberName =
      userData?.fullName ||
      `${userData?.firstName ?? ""} ${userData?.lastName ?? ""}`.trim() ||
      userData?.email ||
      "Member";
  } catch (err) {
    console.error("❌ Failed to load member name for receipts:", err);
  }

  try {
    currentReceipts = await getReceiptsForUser(user.uid);
  } catch (err) {
    // A failed query here (e.g. a rules/permission issue on one of the
    // four payment-log collections) used to leave this stuck on
    // "Loading..." forever with no visible error. Now it says so.
    console.error("❌ Failed to load receipts:", err);
    stateEl.textContent = "Couldn't load your receipts right now. Please try again in a moment.";
    return;
  }

  if (currentReceipts.length === 0) {
    stateEl.textContent = "No receipts yet — they'll appear here as soon as a payment is collected.";
    return;
  }

  stateEl.textContent = "";

  listEl.innerHTML = currentReceipts
    .map((r, index) => {
      const breakdownParts: string[] = [];
      if (r.principalPaid !== undefined) breakdownParts.push(`Principal ${peso(r.principalPaid)}`);
      if (r.interestPaid) breakdownParts.push(`Interest ${peso(r.interestPaid)}`);
      if (r.lateFeePaid) breakdownParts.push(`Late Fee ${peso(r.lateFeePaid)}`);

      return `
        <div class="contract-card" data-index="${index}">
          <div class="contract-header">
            <div class="contract-left">
              <div style="width:100%;">
                <div class="contract-title">${TYPE_ICON[r.type]} ${r.productLabel}</div>
                <div class="muted" style="font-size:13px; margin-top:2px;">
                  ${r.createdAt.toLocaleString("en-PH")}
                  ${breakdownParts.length ? ` · ${breakdownParts.join(" · ")}` : ""}
                </div>
                <div style="font-weight:700; font-size:18px; margin-top:6px;">${peso(r.amount)}</div>
              </div>
            </div>
          </div>
          <button type="button" class="request-loan-btn download-receipt-btn" data-index="${index}" style="margin-top:8px;">
            ⬇ Download PDF
          </button>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll<HTMLButtonElement>(".download-receipt-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.index);
      const receipt = currentReceipts[index];
      if (!receipt) return;
      downloadReceiptPdf(receipt, currentMemberName);
    });
  });
}
