// src/pages/borrowerLoanDetails.ts
import {
  doc,
  getDoc,
  collection,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { showPage } from "../main";
import { getAuth } from "firebase/auth";
import { adminCorrectLoanSchedule } from "../services/loanService";

console.log("AUTH EMAIL:", getAuth().currentUser?.email);

function formatDate(date: any): string {
  if (!date) return "N/A";
  if (date.toDate) return date.toDate().toLocaleDateString();
  return new Date(date).toLocaleDateString();
}

function isAdminUser(): boolean {
  const auth = getAuth();
  const user = auth.currentUser;
  return !!user && !!user.email && user.email.includes("admin");
}

export async function loadBorrowerLoanDetails(loanId: string) {
  showPage("page-borrower-loan-details");

  // ⬅ Back to history
  document
    .querySelectorAll<HTMLButtonElement>(".back-btn[data-back='borrower-history']")
    .forEach((btn) => {
      btn.onclick = () => {
        showPage("page-borrower-history");
      };
    });

  const summaryDiv = document.getElementById("borrower-loan-details-summary");
  const historyDiv = document.getElementById("borrower-loan-payment-history");

  if (!summaryDiv || !historyDiv) return;

  summaryDiv.innerHTML = "<p>Loading loan details...</p>";
  historyDiv.innerHTML = "<p>Loading payment history...</p>";

  try {
    // =========================
    // 🔍 LOAD LOAN DOC
    // =========================
    const loanRef = doc(db, "activeLoans", loanId);
    const loanSnap = await getDoc(loanRef);

    if (!loanSnap.exists()) {
      summaryDiv.innerHTML = "<p>Loan not found.</p>";
      historyDiv.innerHTML = "";
      return;
    }

    const loan = loanSnap.data();

    // =========================
    // 💳 LOAD PAYMENT HISTORY (FROM activeLoans/{loanId}/repayments)
    // =========================
    const repayRef = collection(db, "activeLoans", loanId, "repayments");
    const repayQ = query(repayRef, orderBy("date", "desc"));
    const repaySnap = await getDocs(repayQ);

    let paymentsHtml = "<p>No payments recorded yet.</p>";

    if (!repaySnap.empty) {
      paymentsHtml = `
        <table class="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Late Fee</th>
              <th>Total Paid</th>
            </tr>
          </thead>
          <tbody>
      `;

      repaySnap.forEach((p) => {
        const row = p.data();

        paymentsHtml += `
          <tr>
            <td>${formatDate(row.date)}</td>
            <td>₱${Number(row.principalPaid ?? 0).toLocaleString()}</td>
            <td>₱${Number(row.interestPaid ?? 0).toLocaleString()}</td>
            <td>₱${Number(row.lateFeePaid ?? 0).toLocaleString()}</td>
            <td>₱${Number(row.amount ?? 0).toLocaleString()}</td>
          </tr>
        `;
      });

      paymentsHtml += `</tbody></table>`;
    }

    historyDiv.innerHTML = paymentsHtml; // ✅ ALWAYS RENDER

    // =========================
    // 🧾 RENDER SUMMARY
    // =========================
    summaryDiv.innerHTML = `
      <div class="card">
        <p><strong>Principal:</strong> ₱${(loan.principal ?? 0).toLocaleString()}</p>
        <p><strong>Total Interest:</strong> ₱${(loan.totalInterest ?? 0).toLocaleString()}</p>
        <p><strong>Total Payable:</strong> ₱${(loan.totalPayable ?? 0).toLocaleString()}</p>
        <p><strong>Remaining Balance:</strong> ₱${(loan.remainingBalance ?? 0).toLocaleString()}</p>
        <p><strong>Status:</strong> ${loan.status}</p>
        <p><strong>Payment Schedule:</strong> ${
          loan.paymentSchedule === "15-30" ? "Semi-monthly (15–30)" : "Monthly"
        }</p>
        <p><strong>Next Due Date:</strong> ${formatDate(loan.nextDueDate)}</p>
      </div>
    `;

    // 🔐 ADMIN-ONLY ACTION
    if (isAdminUser() && loan.status === "active") {
      summaryDiv.innerHTML += `
        <div class="card admin-actions">
          <h4>Admin Actions</h4>
          <button id="btn-correct-schedule" class="danger-btn">
            Correct Payment Schedule
          </button>
        </div>
      `;
    }

    const correctBtn = document.getElementById("btn-correct-schedule");

    if (correctBtn) {
      correctBtn.addEventListener("click", async () => {
        const currentSchedule = loan.paymentSchedule ?? "15-30";
        const newSchedule = currentSchedule === "15-30" ? "monthly" : "15-30";

        const reason = prompt(
          `Correct payment schedule from "${currentSchedule}" to "${newSchedule}".\n\n` +
          `⚠️ Paid and partial payments will NOT be changed.\n\n` +
          `Enter reason for correction:`
        );

        if (!reason) return;

        try {
          await adminCorrectLoanSchedule({
            loanId,
            newPaymentSchedule: newSchedule,
            adminId: getAuth().currentUser!.uid,
            reason,
          });

          alert("✅ Payment schedule corrected successfully.");
          loadBorrowerLoanDetails(loanId); // refresh UI
        } catch (err: any) {
          console.error(err);
          alert(err.message || "Failed to correct payment schedule.");
        }
      });
    }
  } catch (err) {
    console.error("❌ Failed loading loan details:", err);
    summaryDiv.innerHTML = "<p>Error loading loan details.</p>";
    historyDiv.innerHTML = `<p style="color:red;">Failed to load payment history.</p>`;
  }
}