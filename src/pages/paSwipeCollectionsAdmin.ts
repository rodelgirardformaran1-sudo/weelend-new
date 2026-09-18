// src/pages/paSwipeCollectionsAdmin.ts
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  evaluateScheduleItem,
  collectPaSwipeInstallmentPayment,
  flagOverdueInstallments,
} from "../services/paSwipeRepaymentService";

const INSTALLMENTS_COL = "paSwipeInstallments";

let unsubscribeCollections: (() => void) | null = null;

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d: any) {
  if (!d) return "N/A";
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString();
}

export async function initPaSwipeCollectionsAdmin(container: HTMLElement) {
  if (unsubscribeCollections) unsubscribeCollections();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>💳 MLF Easy Installments — Collections</h3>
      <p style="opacity:.8;">Checking for overdue accounts...</p>
    </div>
  `;

  // ✅ auto-flag overdue accounts before rendering the list
  await flagOverdueInstallments();

  const q = query(
    collection(db, INSTALLMENTS_COL),
    where("status", "in", ["active", "flagged_for_repossession"])
  );

  unsubscribeCollections = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      container.innerHTML = `
        <div class="card" style="padding:16px;">
          <h3>💳 MLF Easy Installments — Collections</h3>
          <p style="opacity:.75;">No active installment accounts.</p>
        </div>
      `;
      return;
    }

    const rows = await Promise.all(
      snap.docs.map(async (d) => {
        const installment = { id: d.id, ...(d.data() as any) };

        const scheduleSnap = await getDocs(
          collection(db, INSTALLMENTS_COL, installment.id, "schedule")
        );

        const schedule = scheduleSnap.docs
          .map((s) => ({ id: s.id, ...(s.data() as any) }))
          .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));

        const nextUnpaid = schedule.find((s) => !s.paid);

        if (!nextUnpaid) return ""; // fully paid, shouldn't appear but just in case

        const evaluation = evaluateScheduleItem(nextUnpaid);
        const product = installment.productSnapshot || {};

        const flaggedBadge =
          installment.status === "flagged_for_repossession"
            ? `<span style="background:#dc3545; color:white; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">⚠️ FLAGGED FOR REPOSSESSION (${evaluation.daysLate} days overdue)</span>`
            : evaluation.daysLate > 0
            ? `<span style="background:#ffc107; color:#333; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">${evaluation.daysLate} days late</span>`
            : `<span style="background:#28a745; color:white; padding:3px 10px; border-radius:12px; font-size:12px; font-weight:700;">On time</span>`;

        return `
          <div class="card" style="margin-bottom:12px; padding:14px;">
            <div style="display:flex; gap:12px;">
              <img class="lightbox-img"src="${product.imageUrl || ""}" style="width:72px; height:72px; object-fit:cover; border-radius:12px;" />
              <div style="flex:1;">
                <div style="font-weight:800;">${product.title || "Item"}</div>
                <div style="opacity:.75; font-size:13px;">
                  Borrower: <strong>${installment.userName || "—"}</strong> •
                  Installment ${nextUnpaid.installmentNumber} of ${installment.installmentCount}
                </div>

                <div style="margin-top:6px;">${flaggedBadge}</div>

                <div style="margin-top:8px; line-height:1.6;">
                  <div>Due Date: <strong>${formatDate(nextUnpaid.dueDate)}</strong></div>
                  <div>Installment Amount: <strong>${peso(nextUnpaid.installmentAmount)}</strong></div>
                  <div>Remaining on this installment: <strong>${peso(evaluation.remainingInstallment)}</strong></div>
                  ${
                    evaluation.lateFeeRemaining > 0
                      ? `<div style="color:#c0392b;">Late Fee: <strong>${peso(evaluation.lateFeeRemaining)}</strong></div>`
                      : evaluation.inGracePeriod
                      ? `<div style="color:#777;">In grace period (no late fee yet, ${3 - evaluation.daysLate} day(s) left)</div>`
                      : ""
                  }
                  <div style="font-weight:700; margin-top:4px;">Total Due Now: ${peso(evaluation.totalDue)}</div>
                </div>

                <button
                  class="request-loan-btn pa-swipe-collect-btn"
                  data-installment-id="${installment.id}"
                  data-schedule-id="${nextUnpaid.id}"
                  data-max="${evaluation.totalDue}"
                  data-product-title="${product.title || "Item"}"
                  data-borrower="${installment.userName || "—"}"
                  style="margin-top:10px;"
                >
                  💳 Collect Payment
                </button>
              </div>
            </div>
          </div>
        `;
      })
    );

    container.innerHTML = `
      <div class="card" style="padding:16px;">
        <h3>💳 MLF Easy Installments — Collections</h3>
        <p style="opacity:.8;">Collect payments on active installment accounts.</p>
      </div>
      ${rows.join("")}
    `;

    // ✅ bind collect buttons
    container.querySelectorAll(".pa-swipe-collect-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        openCollectModal({
          installmentId: el.dataset.installmentId!,
          scheduleId: el.dataset.scheduleId!,
          maxAmount: Number(el.dataset.max),
          productTitle: el.dataset.productTitle!,
          borrower: el.dataset.borrower!,
        });
      });
    });
  });
}

function openCollectModal(data: {
  installmentId: string;
  scheduleId: string;
  maxAmount: number;
  productTitle: string;
  borrower: string;
}) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Collect Payment</h3>
      <p><strong>${data.borrower}</strong> — ${data.productTitle}</p>
      <p>Total Due Now: <strong>${peso(data.maxAmount)}</strong></p>

      <label>Amount to Collect</label>
      <input type="number" id="pa-swipe-collect-amount" min="1" max="${data.maxAmount}" value="${data.maxAmount}" />

      <div class="modal-actions">
        <button id="pa-swipe-collect-confirm" class="btn-confirm">Confirm</button>
        <button id="pa-swipe-collect-cancel" class="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("pa-swipe-collect-cancel")?.addEventListener("click", () => modal.remove());

  document.getElementById("pa-swipe-collect-confirm")?.addEventListener("click", async () => {
    const amountInput = document.getElementById("pa-swipe-collect-amount") as HTMLInputElement;
    const amount = Number(amountInput.value);

    if (!amount || amount <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      await collectPaSwipeInstallmentPayment({
        installmentId: data.installmentId,
        scheduleId: data.scheduleId,
        amountPaid: amount,
      });

      alert("✅ Payment collected");
      modal.remove();
    } catch (err: any) {
      alert("❌ Failed: " + (err?.message || "Unknown error"));
    }
  });
}