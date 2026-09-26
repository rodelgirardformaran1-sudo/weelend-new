// src/pages/allLoans.ts
import { getAllLoansForAdminHistory } from "../services/loanService";
import { getUserFullName } from "../services/userUtils";
import { renderFinancialTotalsUI } from "./adminDashboard";
import { loadAdminLoanDetailsUI } from "./adminLoanDetails";
import { renderAgreementStatusBadge } from "../utils/agreementDisplay";

// =====================================================================
// 🛠 Helper: Format Firestore Timestamp / Date
// =====================================================================
function formatDate(date: any): string {
  if (!date) return "N/A";
  if (date.toDate) return date.toDate().toLocaleDateString();
  if (date instanceof Date) return date.toLocaleDateString();

  const parsed = new Date(date);
  return isNaN(parsed.getTime()) ? "N/A" : parsed.toLocaleDateString();
}

// =====================================================================
// 📋 UI Function: ALL LOANS (Admin)
// =====================================================================
export async function loadAllLoansUI(adminSectionContent: HTMLElement) {
  adminSectionContent.innerHTML = "";
  await renderFinancialTotalsUI(adminSectionContent);

  const container = document.createElement("div");
  container.id = "all-loans-container";
  container.innerHTML = "<h3>📋 All Loans</h3><p>Loading...</p>";
  adminSectionContent.appendChild(container);

  const loans = await getAllLoansForAdminHistory();

  if (!loans.length) {
    container.innerHTML = "<h3>📋 All Loans</h3><p>No loans found.</p>";
    return;
  }

  // ⚡ PERFORMANCE FIX: this used to fetch each borrower's name one loan
  // at a time (a sequential Firestore read per loan, awaited in the
  // render loop below). Fetching every unique borrower in parallel up
  // front — and deduping repeat borrowers across multiple loans — turns
  // that into one wave of concurrent reads instead of N in a row.
  const uniqueBorrowerIds = [...new Set(loans.map((l) => l.userId))];
  const borrowerNames = new Map(
    await Promise.all(
      uniqueBorrowerIds.map(
        async (uid) => [uid, await getUserFullName(uid).catch(() => "Unknown")] as const
      )
    )
  );

  // 🔤 Sort by borrower name (A→Z) so loans for the same person are
  // grouped together and the whole list reads in a predictable order,
  // instead of whatever order Firestore happened to return them in.
  loans.sort((a, b) =>
    (borrowerNames.get(a.userId) ?? "").localeCompare(borrowerNames.get(b.userId) ?? "")
  );

  let html = `
    <h3>📋 All Loans</h3>
    <p style="opacity:.75; font-size:13px; margin-top:-6px;">Every coop loan on record — active, completed, and otherwise.</p>
    <table class="admin-table">
      <thead>
  <tr>
    <th>Borrower</th>
    <th>Original Amount</th>
    <th>Remaining Balance</th>
    <th>Status</th>
    <th>Agreement</th>
    <th>Next Due Date</th>
    <th>Action</th>
  </tr>
</thead>
      <tbody>
  `;

  for (const loan of loans) {
    const borrower = borrowerNames.get(loan.userId) ?? "Unknown";

    const statusLabel =
      loan.status === "completed"
        ? "✅ Completed"
        : loan.status === "active"
        ? "🔵 Active"
        : (loan.status ?? "active");

    html += `
      <tr>
        <td data-label="Borrower">${borrower}</td>
        <td data-label="Original Amount">₱${Number(loan.principal ?? 0).toLocaleString()}</td>
        <td data-label="Remaining Balance">₱${Number(loan.remainingBalance ?? 0).toLocaleString()}</td>
        <td data-label="Status">${statusLabel}</td>
        <td data-label="Agreement">${renderAgreementStatusBadge(loan.agreementAcceptance)}</td>
        <td data-label="Next Due Date">${formatDate(loan.nextDueDate)}</td>
        <td data-label="Action" class="admin-table-actions">
          <button
            class="view-loan-btn"
            data-loan-id="${loan.id}">
            View
          </button>
        </td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;

  // ======================================================
  // TEMP: View button (log only for now)
  // ======================================================
  container.querySelectorAll(".view-loan-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const loanId = (e.currentTarget as HTMLElement).dataset.loanId!;
      console.log("🧾 Admin clicked loan:", loanId);
      loadAdminLoanDetailsUI(adminSectionContent, loanId);
    });
  });
}
