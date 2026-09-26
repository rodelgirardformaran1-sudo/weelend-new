// src/pages/loanAgreementsAdmin.ts
//
// Admin-only, read-only view of every Coop Loan request's agreement
// acceptance record — regardless of status (pending, approved, rejected,
// completed). Complements the Loan Requests tab (pending only) and All
// Loans (active/completed loans only) by giving admin one place to see
// the full agreement — version, terms, and the collapsible verbatim
// text — for ANY loan request, at any stage, including ones that were
// never approved.

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";
import { getUserFullName } from "../services/userUtils";

export async function initLoanAgreementsAdmin(container: HTMLElement) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📜 Coop Loan Agreements — Admin Reference</h3>
      <p style="opacity:.8;">Every borrower's proof-of-consent record, for any loan request regardless of status.</p>
      <div id="loan-agreements-admin-list">Loading...</div>
    </div>
  `;

  const listEl = container.querySelector("#loan-agreements-admin-list") as HTMLElement;

  const snap = await getDocs(query(collection(db, "loanRequests"), orderBy("requestedAt", "desc")));

  if (snap.empty) {
    listEl.innerHTML = `<p style="opacity:.75;">No loan requests yet.</p>`;
    return;
  }

  const statusColor: Record<string, string> = {
    pending: "#ffc107",
    approved: "#28a745",
    rejected: "#dc3545",
    completed: "#28a745",
  };

  const rows = await Promise.all(
    snap.docs.map(async (d) => {
      const r = d.data() as any;
      const userName = r.userName || (await getUserFullName(r.userId));
      const color = statusColor[r.status] || "#888";

      return `
        <div class="card" style="margin-bottom:12px; padding:14px;">
          <div style="font-weight:700;">₱${Number(r.amount || 0).toLocaleString()} — ${r.termsMonths || "?"} month(s)</div>
          <div style="opacity:.75; font-size:13px;">
            Borrower: <strong>${userName}</strong>
          </div>
          <span style="background:${color}; color:white; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:700;">
            ${r.status || "unknown"}
          </span>
          ${renderAgreementAcceptanceHtml(r.agreementAcceptance)}
        </div>
      `;
    })
  );

  listEl.innerHTML = rows.join("");
}
