// src/pages/adminLoanDetails.ts

import {
  doc,
  getDoc,
  getDocs,
  collection,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { getAuth } from "firebase/auth";
import { getUserFullName } from "../services/userUtils";
import { adminCorrectLoanSchedule } from "../services/loanService";
import { renderFinancialTotalsUI } from "./adminDashboard";

// =======================================================
// Types
// =======================================================
interface LoanScheduleItem {
  id: string;
  installmentNo?: number;
  dueDate?: any;
  principalDue?: number;
  interestDue?: number;
  paid?: boolean;
  status?: "voided";
}

// =======================================================
// Helpers
// =======================================================
function formatDate(date: any): string {
  if (!date) return "—";
  if (date.toDate) return date.toDate().toLocaleDateString();
  return new Date(date).toLocaleDateString();
}

async function isAdminUser(): Promise<boolean> {
  const user = getAuth().currentUser;
  if (!user) return false;

  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() && snap.data().role === "admin";
}

// =======================================================
// MAIN UI
// =======================================================
export async function loadAdminLoanDetailsUI(
  adminSectionContent: HTMLElement,
  loanId: string
) {
  adminSectionContent.innerHTML = "";
  await renderFinancialTotalsUI(adminSectionContent);

  const container = document.createElement("div");
  container.innerHTML = `<h3>📄 Admin Loan Details</h3><p>Loading...</p>`;
  adminSectionContent.appendChild(container);

  try {
    const isAdmin = await isAdminUser();

    // =========================
    // LOAD LOAN
    // =========================
    const loanRef = doc(db, "activeLoans", loanId);
    const loanSnap = await getDoc(loanRef);

    if (!loanSnap.exists()) {
      container.innerHTML = "<p>❌ Loan not found.</p>";
      return;
    }

    const loan = loanSnap.data();
    const borrowerName = await getUserFullName(loan.userId);

    // =========================
    // LOAD SCHEDULE
    // =========================
    const schedRef = collection(db, "activeLoans", loanId, "schedule");
    const schedSnap = await getDocs(schedRef);

    const schedules: LoanScheduleItem[] = schedSnap.docs
      .map((d) => ({
        id: d.id,
        ...(d.data() as Omit<LoanScheduleItem, "id">),
      }))
      .sort(
        (a, b) => (a.installmentNo ?? 0) - (b.installmentNo ?? 0)
      );

    // =========================
    // RENDER SUMMARY
    // =========================
    let html = `
      <div class="card">
        <h4>Borrower</h4>
        <p>${borrowerName}</p>

        <h4>Loan Summary</h4>
        <p><strong>Principal:</strong> ₱${Number(loan.principal ?? 0).toLocaleString()}</p>
        <p><strong>Total Interest:</strong> ₱${Number(loan.totalInterest ?? 0).toLocaleString()}</p>
        <p><strong>Total Payable:</strong> ₱${Number(loan.totalPayable ?? 0).toLocaleString()}</p>
        <p><strong>Remaining Balance:</strong> ₱${Number(loan.remainingBalance ?? 0).toLocaleString()}</p>
        <p><strong>Payment Schedule:</strong> ${loan.paymentSchedule}</p>
        <p><strong>Status:</strong> ${loan.status}</p>
        <p><strong>Next Due Date:</strong> ${formatDate(loan.nextDueDate)}</p>
      </div>

      <br/>

      <h4>📆 Repayment Schedule</h4>
      <table class="admin-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Due Date</th>
            <th>Principal</th>
            <th>Interest</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
    `;

    if (!schedules.length) {
      html += `<tr><td colspan="5">No schedule found.</td></tr>`;
    } else {
      for (const s of schedules) {
        const statusLabel =
          s.status === "voided"
            ? "🟥 Voided"
            : s.paid
            ? "🟩 Paid"
            : "⬜ Unpaid";

        html += `
          <tr>
            <td>${s.installmentNo ?? "—"}</td>
            <td>${formatDate(s.dueDate)}</td>
            <td>₱${Number(s.principalDue ?? 0).toLocaleString()}</td>
            <td>₱${Number(s.interestDue ?? 0).toLocaleString()}</td>
            <td>${statusLabel}</td>
          </tr>
        `;
      }
    }

    html += `</tbody></table>`;

    // =========================
    // ADMIN ACTIONS
    // =========================
    if (isAdmin && loan.status === "active") {
      html += `
        <br/>
        <div class="card admin-actions">
          <h4>⚠️ Admin Actions</h4>
          <button id="correct-schedule-btn" class="danger-btn">
            Correct Payment Schedule
          </button>
        </div>
      `;
    }

    html += `
      <br/>
      <button id="back-to-all-loans">⬅ Back to All Loans</button>
    `;

    container.innerHTML = html;

    // =========================
    // EVENTS
    // =========================
    document
      .getElementById("back-to-all-loans")
      ?.addEventListener("click", async () => {
        const { loadAllLoansUI } = await import("./allLoans");
        loadAllLoansUI(adminSectionContent);
      });

    document
      .getElementById("correct-schedule-btn")
      ?.addEventListener("click", async () => {
        const current = loan.paymentSchedule ?? "15-30";
        const next = current === "15-30" ? "monthly" : "15-30";

        const reason = prompt(
          `Change schedule from "${current}" to "${next}".\n\n` +
          `Paid installments will NOT be modified.\n\n` +
          `Enter reason:`
        );

        if (!reason) return;

        await adminCorrectLoanSchedule({
          loanId,
          newPaymentSchedule: next,
          adminId: getAuth().currentUser!.uid,
          reason,
        });

        alert("✅ Payment schedule corrected.");
        loadAdminLoanDetailsUI(adminSectionContent, loanId);
      });

  } catch (err) {
    console.error("❌ Admin loan details error:", err);
    container.innerHTML = "<p>Error loading loan details.</p>";
  }
}
