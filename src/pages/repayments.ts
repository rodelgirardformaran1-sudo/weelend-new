
// ================================
// 🟣 REPAYMENTS PAGE (Admin) — INSTALLMENT + PARTIAL
// ================================

import { getAllActiveLoans } from "../services/loanService";
import { getUserFullName } from "../services/userUtils";
import { getRepaymentSchedule } from "../services/repaymentService";
import {
  collectScheduledPaymentTransaction,
  collectPartialPaymentTransaction,
} from "../services/repaymentService";


interface RepaymentScheduleItem {
  id: string;
  dueDate: any;

  principalDue: number;
  interestDue: number;
  totalDue?: number;

  remainingDue?: number;
  partialPaid?: number;

  paid: boolean;
  partial?: boolean;
  lateFeeApplied?: number;

  status?: string; // 🔹 ADD THIS
}

// --------------------
// Utils
// --------------------
function computeLateFeeRate(dueDate: any): number {
  const due =
    dueDate?.toDate ? dueDate.toDate() :
    dueDate instanceof Date ? dueDate :
    new Date(dueDate);

  const today = new Date();

  if (today <= due) return 0;

  const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 15) return 0.05;
  return 0.03;
}

function formatDate(d: any) {
  if (!d) return "N/A";
  if (d.toDate) return d.toDate().toLocaleDateString();
  if (d instanceof Date) return d.toLocaleDateString();
  return new Date(d).toLocaleDateString();
}

// ================================
// MAIN UI
// ================================
export async function loadRepaymentsUI(target: HTMLElement) {
  target.innerHTML = `<h2>💸 Repayments</h2><p>Loading...</p>`;

  const loans = await getAllActiveLoans();

  let rows = "";

  for (const loan of loans) {
    const borrowerName = await getUserFullName(loan.userId);
    const schedule = (await getRepaymentSchedule(loan.id)) as RepaymentScheduleItem[];


    const unpaid = schedule.filter(
  s => (s.status !== "voided") && (!s.paid || s.partial)
);


    for (const item of unpaid) {
      const principal = Number(item.principalDue ?? 0);
      const interest = Number(item.interestDue ?? 0);
      const base = Number(item.remainingDue ?? (principal + interest));

      const lateRate = computeLateFeeRate(item.dueDate);
      const lateFee = base * lateRate;

      rows += `
        <tr>
          <td>${borrowerName}</td>
          <td>${formatDate(item.dueDate)}</td>
          <td>₱${principal.toLocaleString()}</td>
          <td>₱${interest.toLocaleString()}</td>
          <td>${lateRate > 0 ? (lateRate * 100) + "%" : "-"}</td>
          <td>₱${(base + lateFee).toLocaleString()}</td>
          <td>
            <button class="btn-confirm collect-full-btn"
              data-loanid="${loan.id}"
              data-scheduleid="${item.id}"
              data-userid="${loan.userId}"
              data-principal="${principal}"
              data-interest="${interest}"
              data-laterate="${lateRate}"
            >
              Collect Full
            </button>

            <button class="btn-cancel collect-partial-btn"
              data-loanid="${loan.id}"
              data-scheduleid="${item.id}"
              data-userid="${loan.userId}"
              data-balance="${loan.remainingBalance}"
            >
              Partial
            </button>
          </td>
        </tr>
      `;
    }
  }

  if (!rows) {
    target.innerHTML = `<h2>💸 Repayments</h2><p>😎 No unpaid installments.</p>`;
    return;
  }

  target.innerHTML = `
    <h2>💸 Repayments</h2>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Borrower</th>
          <th>Due Date</th>
          <th>Principal</th>
          <th>Interest</th>
          <th>Late %</th>
          <th>Total Due</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  // -------- FULL COLLECTION --------
  document.querySelectorAll(".collect-full-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const el = e.currentTarget as HTMLElement;

      openFullCollectModal({
        loanId: el.dataset.loanid!,
        scheduleId: el.dataset.scheduleid!,
        borrowerId: el.dataset.userid!,
        principal: Number(el.dataset.principal),
        interest: Number(el.dataset.interest),
        lateRate: Number(el.dataset.laterate),
      });
    });
  });

  // -------- PARTIAL COLLECTION --------
  document.querySelectorAll(".collect-partial-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const el = e.currentTarget as HTMLElement;

      openPartialCollectModal({
        loanId: el.dataset.loanid!,
        scheduleId: el.dataset.scheduleid!,
        borrowerId: el.dataset.userid!,
        maxAmount: Number(el.dataset.balance),
      });
    });
  });
}

// ================================
// FULL COLLECTION MODAL
// ================================
function openFullCollectModal(data: {
  loanId: string;
  scheduleId: string;
  borrowerId: string;
  principal: number;
  interest: number;
  lateRate: number;
}) {
  const base = data.principal + data.interest;
  const lateFee = base * data.lateRate;

  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Collect Full Installment</h3>

      <p>Principal: ₱${data.principal.toLocaleString()}</p>
      <p>Interest: ₱${data.interest.toLocaleString()}</p>
      <p>Late Fee (${data.lateRate * 100}%): ₱${lateFee.toLocaleString()}</p>

      <label>
        <input type="checkbox" id="waive-late-fee" />
        Waive Late Fee
      </label>

      <hr/>
      <p><strong>Total:</strong> ₱${(base + lateFee).toLocaleString()}</p>

      <div class="modal-actions">
        <button id="confirm-full-btn" class="btn-confirm">Confirm</button>
        <button id="cancel-full-btn" class="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancel-full-btn")?.addEventListener("click", () => modal.remove());

  document.getElementById("confirm-full-btn")?.addEventListener("click", async () => {
    const waive = (document.getElementById("waive-late-fee") as HTMLInputElement).checked;

    const now = new Date();

    try {
      await collectScheduledPaymentTransaction({
        loanId: data.loanId,
        scheduleId: data.scheduleId,
        borrowerId: data.borrowerId,
        waiveLateFee: waive,
        forMonth: now.getMonth() + 1,
        forYear: now.getFullYear(),
      });

      alert("✅ Installment collected");
      modal.remove();
      location.reload();

    } catch (err: any) {
      alert("❌ Failed: " + err.message);
    }
  });
}

// ================================
// PARTIAL COLLECTION MODAL
// ================================
function openPartialCollectModal(data: {
  loanId: string;
  scheduleId: string;
  borrowerId: string;
  maxAmount: number;
}) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Partial Payment (Principal Only)</h3>

      <label>Amount</label>
      <input type="number" id="partial-amount"
             min="1"
             max="${data.maxAmount}"
             value="" />

      <p style="font-size:12px;color:#777;">
        This will reduce principal only. Installment will remain unpaid.
      </p>

      <div class="modal-actions">
        <button id="confirm-partial-btn" class="btn-confirm">Confirm</button>
        <button id="cancel-partial-btn" class="btn-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("cancel-partial-btn")?.addEventListener("click", () => modal.remove());

  document.getElementById("confirm-partial-btn")?.addEventListener("click", async () => {
    const amount = Number((document.getElementById("partial-amount") as HTMLInputElement).value);

    if (!amount || amount <= 0) {
      alert("Invalid amount");
      return;
    }

    const now = new Date();

    try {
      await collectPartialPaymentTransaction({
        loanId: data.loanId,
        scheduleId: data.scheduleId,
        borrowerId: data.borrowerId,
        amountPaid: amount,
        forMonth: now.getMonth() + 1,
        forYear: now.getFullYear(),
      });

      alert("⚠ Partial payment recorded");
      modal.remove();
      location.reload();

    } catch (err: any) {
      alert("❌ Failed: " + err.message);
    }
  });
}
