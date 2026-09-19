// src/pages/creditCartCollectionsAdmin.ts
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { evaluateCreditCartScheduleItem, collectCreditCartPayment } from "../services/creditCartRepaymentService";

const ACCOUNTS_COL = "creditCartAccounts";
let unsubscribeCollections: (() => void) | null = null;

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatDate(d: any) {
  if (!d) return "N/A";
  return (d.toDate ? d.toDate() : new Date(d)).toLocaleDateString();
}

export async function initCreditCartCollectionsAdmin(container: HTMLElement) {
  if (unsubscribeCollections) unsubscribeCollections();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>💳 Marimar's Credit Cart — Collections</h3>
      <p style="opacity:.8;">Collect payments on active credit accounts.</p>
    </div>
  `;

  const q = query(collection(db, ACCOUNTS_COL), where("status", "==", "active"));

  unsubscribeCollections = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      container.innerHTML = `<div class="card" style="padding:16px;"><h3>💳 Marimar's Credit Cart — Collections</h3><p style="opacity:.75;">No active credit accounts.</p></div>`;
      return;
    }

    const rows = await Promise.all(
      snap.docs.map(async (d) => {
        const account = { id: d.id, ...(d.data() as any) };
        const scheduleSnap = await getDocs(collection(db, ACCOUNTS_COL, account.id, "schedule"));
        const schedule = scheduleSnap.docs.map((s) => ({ id: s.id, ...(s.data() as any) }))
          .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));

        const nextUnpaid = schedule.find((s) => !s.paid);
        if (!nextUnpaid) return "";

        const evaluation = evaluateCreditCartScheduleItem(nextUnpaid);
        const categoryLabel = account.category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";

        const badge = evaluation.daysLate > 3
          ? `<span style="background:#dc3545; color:white; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">${evaluation.daysLate} days overdue</span>`
          : evaluation.daysLate > 0
          ? `<span style="background:#ffc107; color:#333; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">${evaluation.daysLate} days late (grace period)</span>`
          : `<span style="background:#28a745; color:white; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">On time</span>`;

        return `
          <div class="card" style="margin-bottom:12px; padding:14px;">
            <div style="font-weight:800;">${categoryLabel}</div>
            <div style="opacity:.75; font-size:13px;">Borrower: <strong>${account.userName || "—"}</strong> • Installment ${nextUnpaid.installmentNumber} of ${account.installmentCount}</div>
            <div style="margin-top:6px;">${badge}</div>
            <div style="margin-top:8px; line-height:1.6;">
              <div>Due Date: <strong>${formatDate(nextUnpaid.dueDate)}</strong></div>
              <div>Installment Amount: <strong>${peso(nextUnpaid.installmentAmount)}</strong></div>
              <div>Remaining on this installment: <strong>${peso(evaluation.remainingInstallment)}</strong></div>
              ${evaluation.lateFeeRemaining > 0
                ? `<div style="color:#c0392b;">Late Fee (flat ₱100): <strong>${peso(evaluation.lateFeeRemaining)}</strong></div>`
                : evaluation.inGracePeriod
                ? `<div style="color:#777;">In grace period (${3 - evaluation.daysLate} day(s) left)</div>`
                : ""}
              <div style="font-weight:700; margin-top:4px;">Total Due Now: ${peso(evaluation.totalDue)}</div>
            </div>
            <button class="request-loan-btn credit-cart-collect-btn" data-account-id="${account.id}" data-schedule-id="${nextUnpaid.id}" data-max="${evaluation.totalDue}" data-category="${categoryLabel}" data-borrower="${account.userName || "—"}" style="margin-top:10px;">💳 Collect Payment</button>
          </div>
        `;
      })
    );

    container.innerHTML = `<div class="card" style="padding:16px;"><h3>💳 Marimar's Credit Cart — Collections</h3><p style="opacity:.8;">Collect payments on active credit accounts.</p></div>${rows.join("")}`;

    container.querySelectorAll(".credit-cart-collect-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        openCollectModal({
          accountId: el.dataset.accountId!,
          scheduleId: el.dataset.scheduleId!,
          maxAmount: Number(el.dataset.max),
          category: el.dataset.category!,
          borrower: el.dataset.borrower!,
        });
      });
    });
  });
}

function openCollectModal(data: { accountId: string; scheduleId: string; maxAmount: number; category: string; borrower: string }) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Collect Payment</h3>
      <p><strong>${data.borrower}</strong> — ${data.category}</p>
      <p>Total Due Now: <strong>${peso(data.maxAmount)}</strong></p>
      <label>Amount to Collect</label>
      <input type="number" id="cc-collect-amount" min="1" max="${data.maxAmount}" value="${data.maxAmount}" />
      <div class="modal-actions">
        <button id="cc-collect-confirm" class="btn-confirm">Confirm</button>
        <button id="cc-collect-cancel" class="btn-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById("cc-collect-cancel")?.addEventListener("click", () => modal.remove());
  document.getElementById("cc-collect-confirm")?.addEventListener("click", async () => {
    const amount = Number((document.getElementById("cc-collect-amount") as HTMLInputElement).value);
    if (!amount || amount <= 0) { alert("Please enter a valid amount."); return; }
    try {
      await collectCreditCartPayment({ accountId: data.accountId, scheduleId: data.scheduleId, amountPaid: amount });
      alert("✅ Payment collected");
      modal.remove();
    } catch (err: any) {
      alert("❌ Failed: " + (err?.message || "Unknown error"));
    }
  });
}