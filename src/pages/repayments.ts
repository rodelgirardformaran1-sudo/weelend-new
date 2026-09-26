
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

  // ⚡ PERFORMANCE FIX: this used to fetch each loan's borrower name AND
  // its repayment schedule one loan at a time — 2 sequential Firestore
  // round trips per loan, awaited one after another in the render loop
  // below. Fetching everything in parallel up front (deduping repeat
  // borrowers across multiple loans) turns that into one wave of
  // concurrent reads instead of 2×N in a row.
  const uniqueBorrowerIds = [...new Set(loans.map((l) => l.userId))];
  const [borrowerNamesEntries, scheduleEntries] = await Promise.all([
    Promise.all(
      uniqueBorrowerIds.map(async (uid) => [uid, await getUserFullName(uid)] as const)
    ),
    Promise.all(
      loans.map(
        async (loan) => [loan.id, (await getRepaymentSchedule(loan.id)) as RepaymentScheduleItem[]] as const
      )
    ),
  ]);
  const borrowerNames = new Map(borrowerNamesEntries);
  const schedulesByLoanId = new Map(scheduleEntries);

  // 🗂️ Flatten every unpaid installment across every loan into one list
  // first (each carrying its borrower + loan info), before grouping —
  // easier to sort and group than building HTML row-by-row as we go.
  type FlatInstallment = {
    loan: (typeof loans)[number];
    item: RepaymentScheduleItem;
    borrowerName: string;
    principal: number;
    interest: number;
    lateRate: number;
    totalDue: number;
    dueDateMs: number;
  };

  const flatInstallments: FlatInstallment[] = [];

  for (const loan of loans) {
    const borrowerName = borrowerNames.get(loan.userId) ?? "Unknown";
    const schedule = schedulesByLoanId.get(loan.id) ?? [];

    const unpaid = schedule.filter(
      s => (s.status !== "voided") && (!s.paid || s.partial)
    );

    for (const item of unpaid) {
      const principal = Number(item.principalDue ?? 0);
      const interest = Number(item.interestDue ?? 0);
      const base = Number(item.remainingDue ?? (principal + interest));
      const lateRate = computeLateFeeRate(item.dueDate);
      const lateFee = base * lateRate;

      const parsedDue =
        item.dueDate?.toDate ? item.dueDate.toDate() :
        item.dueDate instanceof Date ? item.dueDate :
        new Date(item.dueDate);

      flatInstallments.push({
        loan,
        item,
        borrowerName,
        principal,
        interest,
        lateRate,
        totalDue: base + lateFee,
        dueDateMs: isNaN(parsedDue.getTime()) ? Infinity : parsedDue.getTime(),
      });
    }
  }

  if (!flatInstallments.length) {
    target.innerHTML = `<h2>💸 Repayments</h2><p>😎 No unpaid installments.</p>`;
    return;
  }

  // 🗂️ Group by borrower, sort borrowers A→Z, and sort each borrower's
  // own installments soonest-due-first — instead of one long table
  // mixing every borrower and due date together, admin picks a name
  // from an alphabetical list and opens it to see exactly what's due,
  // already in order.
  const groups = new Map<string, FlatInstallment[]>();
  for (const flat of flatInstallments) {
    const key = flat.loan.userId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(flat);
  }

  const sortedBorrowerIds = [...groups.keys()].sort((a, b) =>
    (groups.get(a)![0].borrowerName || "").localeCompare(groups.get(b)![0].borrowerName || "")
  );

  let groupsHtml = "";

  for (const borrowerId of sortedBorrowerIds) {
    const installments = groups.get(borrowerId)!.sort((a, b) => a.dueDateMs - b.dueDateMs);
    const borrowerName = installments[0].borrowerName;

    let rowsHtml = "";
    for (const flat of installments) {
      rowsHtml += `
        <tr>
          <td data-label="Due Date">${formatDate(flat.item.dueDate)}</td>
          <td data-label="Principal">₱${flat.principal.toLocaleString()}</td>
          <td data-label="Interest">₱${flat.interest.toLocaleString()}</td>
          <td data-label="Late %">${flat.lateRate > 0 ? (flat.lateRate * 100) + "%" : "-"}</td>
          <td data-label="Total Due">₱${flat.totalDue.toLocaleString()}</td>
          <td data-label="Action" class="admin-table-actions">
            <button class="btn-confirm collect-full-btn"
              data-loanid="${flat.loan.id}"
              data-scheduleid="${flat.item.id}"
              data-userid="${flat.loan.userId}"
              data-principal="${flat.principal}"
              data-interest="${flat.interest}"
              data-laterate="${flat.lateRate}"
            >
              Collect Full
            </button>

            <button class="btn-cancel collect-partial-btn"
              data-loanid="${flat.loan.id}"
              data-scheduleid="${flat.item.id}"
              data-userid="${flat.loan.userId}"
              data-balance="${flat.loan.remainingBalance}"
            >
              Partial
            </button>
          </td>
        </tr>
      `;
    }

    groupsHtml += `
      <details class="repayment-group">
        <summary class="repayment-group-summary">
          <span>${borrowerName}</span>
          <span class="repayment-group-count">${installments.length} due</span>
        </summary>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Due Date</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Late %</th>
              <th>Total Due</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </details>
    `;
  }

  target.innerHTML = `
    <h2>💸 Repayments</h2>
    <p class="muted" style="font-size:13px; margin-top:-6px;">Grouped by borrower, A–Z. Tap a name to see their installments, soonest due first.</p>
    <div id="repayments-groups">
      ${groupsHtml}
    </div>
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
