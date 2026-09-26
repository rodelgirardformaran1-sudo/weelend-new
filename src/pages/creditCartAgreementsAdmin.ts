// src/pages/creditCartAgreementsAdmin.ts
//
// Admin-only, read-only view of every Marimar's Credit Cart request's
// agreement acceptance record — regardless of status (pending, approved,
// rejected). Complements the Requests tab (pending only) and the
// Contracts tab (only requests that got approved into a contract) by
// giving admin one place to see the full agreement — version, terms, and
// the collapsible verbatim text — for ANY request, at any stage.

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";
import { getUserFullName } from "../services/userUtils";

export async function initCreditCartAgreementsAdmin(container: HTMLElement) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📜 Marimar's Credit Cart Agreements — Admin Reference</h3>
      <p style="opacity:.8;">Every buyer's proof-of-consent record, for any request regardless of status.</p>
      <div id="credit-cart-agreements-admin-list">Loading...</div>
    </div>
  `;

  const listEl = container.querySelector("#credit-cart-agreements-admin-list") as HTMLElement;

  const snap = await getDocs(query(collection(db, "creditCartRequests"), orderBy("createdAt", "desc")));

  if (snap.empty) {
    listEl.innerHTML = `<p style="opacity:.75;">No requests yet.</p>`;
    return;
  }

  const statusColor: Record<string, string> = {
    pending: "#ffc107",
    approved: "#28a745",
    rejected: "#dc3545",
  };

  const rows = await Promise.all(
    snap.docs.map(async (d) => {
      const r = d.data() as any;
      const categoryLabel = r.category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";
      const userName = r.userName || (await getUserFullName(r.userId));
      const color = statusColor[r.status] || "#888";

      return `
        <div class="card" style="margin-bottom:12px; padding:14px;">
          <div style="font-weight:700;">${categoryLabel} — ₱${Number(r.amount || 0).toLocaleString()}</div>
          <div style="opacity:.75; font-size:13px;">
            Buyer: <strong>${userName}</strong>
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
