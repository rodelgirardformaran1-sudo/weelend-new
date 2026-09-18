// src/pages/allLoans.ts
import { getAllActiveLoans } from "../services/loanService";
import { getUserFullName } from "../services/userUtils";
import { renderFinancialTotalsUI } from "./adminDashboard";
import { loadAdminLoanDetailsUI } from "./adminLoanDetails";

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

  const loans = await getAllActiveLoans();

  if (!loans.length) {
    container.innerHTML = "<h3>📋 All Loans</h3><p>No loans found.</p>";
    return;
  }

  let html = `
    <h3>📋 All Loans</h3>
    <table class="admin-table">
      <thead>
  <tr>
    <th>Borrower</th>
    <th>Original Amount</th>
    <th>Remaining Balance</th>
    <th>Status</th>
    <th>Next Due Date</th>
    <th>Action</th>
  </tr>
</thead>
      <tbody>
  `;

  for (const loan of loans) {
    const borrower = await getUserFullName(loan.userId).catch(
      () => "Unknown"
    );

    html += `
      <tr>
        <td>${borrower}</td>
        <td>₱${Number(loan.principal ?? 0).toLocaleString()}</td>
        <td>₱${Number(loan.remainingBalance ?? 0).toLocaleString()}</td>
        <td>${loan.status ?? "active"}</td>
        <td>${formatDate(loan.nextDueDate)}</td>
        <td>
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
