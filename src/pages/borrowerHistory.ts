// src/pages/borrowerHistory.ts
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebaseConfig";
import type { User } from "firebase/auth";
import { renderPaymentCards } from "./paymentCards";
import { evaluateScheduleItem } from "../services/paSwipeRepaymentService";
import { evaluateCreditCartScheduleItem } from "../services/creditCartRepaymentService";

function formatDate(date: any): string {
  if (!date) return "N/A";
  if (date.toDate) return date.toDate().toLocaleDateString();
  return new Date(date).toLocaleDateString();
}

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

async function buildMLFInstallmentsSection(userId: string): Promise<string> {
  const snap = await getDocs(
    query(collection(db, "paSwipeInstallments"), where("userId", "==", userId))
  );

  if (snap.empty) {
    return `<h3>📲 MLF Easy Installments</h3><p>No installment purchases yet.</p>`;
  }

  const cards = await Promise.all(
    snap.docs.map(async (d) => {
      const inst = { id: d.id, ...(d.data() as any) };
      const product = inst.productSnapshot || {};

      const scheduleSnap = await getDocs(
        collection(db, "paSwipeInstallments", inst.id, "schedule")
      );

      const schedule = scheduleSnap.docs
        .map((s) => s.data() as any)
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));

      const nextUnpaid = schedule.find((s) => !s.paid);

      const statusBadge =
        inst.status === "completed"
          ? `<span class="loan-badge completed">Completed</span>`
          : inst.status === "flagged_for_repossession"
          ? `<span class="loan-badge" style="background:#dc3545; color:white;">⚠️ Flagged</span>`
          : `<span class="loan-badge active">Active</span>`;

      let dueInfo = "";
      if (nextUnpaid && inst.status !== "completed") {
        const evaluation = evaluateScheduleItem(nextUnpaid);
        dueInfo = `
          <p><strong>Next Due:</strong> ${formatDate(nextUnpaid.dueDate)}</p>
          <p><strong>Installment ${nextUnpaid.installmentNumber} of ${inst.installmentCount}:</strong> ${peso(evaluation.remainingInstallment)}</p>
          ${evaluation.lateFeeRemaining > 0
            ? `<p style="color:#c0392b;"><strong>Late Fee:</strong> ${peso(evaluation.lateFeeRemaining)}</p>`
            : ""}
        `;
      }

      return `
        <div class="card" data-installment-id="${inst.id}">
          <div style="display:flex; gap:12px; align-items:center;">
            ${product.imageUrl ? `<img class="lightbox-img" src="${product.imageUrl}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;" />` : ""}
            <div style="flex:1;">
              <strong>${product.title || "Item"}</strong> ${statusBadge}
              <div style="font-size:13px; opacity:.8;">
                Downpayment: ${peso(inst.downpayment)} • Term: ${inst.termMonths} months
              </div>
              ${dueInfo}
            </div>
          </div>
        </div>
      `;
    })
  );

  return `<h3>📲 MLF Easy Installments</h3>${cards.join("")}`;
}

async function buildCreditCartSection(userId: string): Promise<string> {
  const snap = await getDocs(query(collection(db, "creditCartAccounts"), where("userId", "==", userId)));
  if (snap.empty) return `<h3>🛒 Marimar's Credit Cart</h3><p>No credit accounts yet.</p>`;

  const cards = await Promise.all(snap.docs.map(async (d) => {
    const acc = { id: d.id, ...(d.data() as any) };
    const scheduleSnap = await getDocs(collection(db, "creditCartAccounts", acc.id, "schedule"));
    const schedule = scheduleSnap.docs.map((s) => s.data() as any).sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
    const nextUnpaid = schedule.find((s) => !s.paid);
    const categoryLabel = acc.category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";

    const statusBadge = acc.status === "completed"
      ? `<span class="loan-badge completed">Completed</span>`
      : `<span class="loan-badge active">Active</span>`;

    let dueInfo = "";
    if (nextUnpaid && acc.status !== "completed") {
      const evaluation = evaluateCreditCartScheduleItem(nextUnpaid);
      dueInfo = `
        <p><strong>Next Due:</strong> ${formatDate(nextUnpaid.dueDate)}</p>
        <p><strong>Installment ${nextUnpaid.installmentNumber} of ${acc.installmentCount}:</strong> ${peso(evaluation.remainingInstallment)}</p>
        ${evaluation.lateFeeRemaining > 0 ? `<p style="color:#c0392b;"><strong>Late Fee:</strong> ${peso(evaluation.lateFeeRemaining)}</p>` : ""}
      `;
    }

    return `
      <div class="card">
        <strong>${categoryLabel}</strong> ${statusBadge}
        <div style="font-size:13px; opacity:.8;">Amount: ${peso(acc.amount)} • Term: ${acc.termMonths} month(s)</div>
        ${dueInfo}
      </div>
    `;
  }));

  return `<h3>🛒 Marimar's Credit Cart</h3>${cards.join("")}`;
}

export async function loadBorrowerLoanHistory(user: User) {
  const container = document.getElementById("borrower-history-content");
  if (!container) return;

  container.innerHTML = "<p>Loading history...</p>";

  try {
    // 🔵 ACTIVE LOAN
    const activeQ = query(
      collection(db, "activeLoans"),
      where("userId", "==", user.uid),
      where("status", "==", "active")
    );

    const activeSnap = await getDocs(activeQ);

    // 🟢 COMPLETED LOANS (try ordered, fallback unordered)
    let completedSnap;
    try {
      const completedQ = query(
        collection(db, "activeLoans"),
        where("userId", "==", user.uid),
        where("status", "==", "completed"),
        orderBy("createdAt", "desc")
      );
      completedSnap = await getDocs(completedQ);
    } catch (err) {
      console.warn("⚠️ Completed loans query failed (index?). Falling back:", err);

      const completedFallbackQ = query(
        collection(db, "activeLoans"),
        where("userId", "==", user.uid),
        where("status", "==", "completed")
      );
      completedSnap = await getDocs(completedFallbackQ);
    }

    let html = "";

    // =====================
    // ACTIVE LOAN
    // =====================
    html += `<h3>🔵 Active Coop Loan</h3>`;

    if (activeSnap.empty) {
      html += `<p>No active loan.</p>`;
    } else {
      const loan = activeSnap.docs[0].data();

      html += `
        <div class="card clickable" data-loan-id="${activeSnap.docs[0].id}">
          <p><strong>Remaining Balance:</strong> ₱${(loan.remainingBalance ?? 0).toLocaleString()}</p>
          <p><strong>Next Due Date:</strong> ${formatDate(loan.nextDueDate)}</p>
          <span class="loan-badge active">Active</span>
        </div>
      `;
    }

    html += `<hr />`;

    // =====================
    // COMPLETED LOANS
    // =====================
    html += `<h3>🟢 Completed Coop Loans</h3>`;

    if (completedSnap.empty) {
      html += `<p>No completed loans yet.</p>`;
    } else {
      completedSnap.forEach(docSnap => {
        const loan = docSnap.data();

        html += `
          <div class="card clickable" data-loan-id="${docSnap.id}">
            <p><strong>Principal:</strong> ₱${(loan.principal ?? 0).toLocaleString()}</p>
            <p><strong>Total Interest:</strong> ₱${(loan.totalInterest ?? 0).toLocaleString()}</p>
            <p><strong>Total Payable:</strong> ₱${(loan.totalPayable ?? 0).toLocaleString()}</p>
            <p><strong>Completed On:</strong> ${formatDate(loan.lastPaymentAt)}</p>
            <span class="loan-badge completed">Completed</span>
          </div>
        `;
      });
    }

    html += `<hr />`;

    // =====================
    // 📲 MLF EASY INSTALLMENTS
    // =====================
    html += await buildMLFInstallmentsSection(user.uid);
      html += `<hr />` + await buildCreditCartSection(user.uid);

    // ✅ Render loan history first
    container.innerHTML = html;

    // 💳 Render payment cards (GCash + Bank)
    await renderPaymentCards(container);

    // =====================
    // CLICK → OPEN DETAILS
    // =====================
    container.querySelectorAll<HTMLElement>(".card.clickable").forEach(card => {
      card.addEventListener("click", () => {
        const loanId = card.dataset.loanId;
        if (!loanId) return;

        import("./borrowerLoanDetails").then(m => {
          m.loadBorrowerLoanDetails(loanId);
        });
      });
    });

  } catch (err) {
    console.error("❌ Failed loading borrower history:", err);
    container.innerHTML = `<p style="color:red;">Failed to load loan history.</p>`;
  }
}