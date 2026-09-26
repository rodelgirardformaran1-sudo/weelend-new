// src/pages/paSwipeAgreementsAdmin.ts
//
// Admin-only, read-only view of every MLF Easy Installment request's
// agreement acceptance record — regardless of status (pending, approved,
// rejected). Complements the Requests tab (pending only) and the
// Contracts tab (only requests that got approved into a contract) by
// giving admin one place to see the full agreement — version, terms, and
// the collapsible verbatim text — for ANY request, at any stage.

import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";
import { getUserFullName } from "../services/userUtils";

export async function initPaSwipeAgreementsAdmin(container: HTMLElement) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📜 MLF Easy Installment Agreements — Admin Reference</h3>
      <p style="opacity:.8;">Every buyer's proof-of-consent record, for any request regardless of status.</p>
      <div id="pa-swipe-agreements-admin-list">Loading...</div>
    </div>
  `;

  const listEl = container.querySelector("#pa-swipe-agreements-admin-list") as HTMLElement;

  const snap = await getDocs(query(collection(db, "paSwipeRequests"), orderBy("createdAt", "desc")));

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
      const product = r.productSnapshot || {};
      const userName = r.userName || (await getUserFullName(r.userId));
      const color = statusColor[r.status] || "#888";

      return `
        <div class="card" style="margin-bottom:12px; padding:14px;">
          <div style="display:flex; gap:12px;">
            <img class="lightbox-img" src="${product.imageUrl || ""}" style="width:56px; height:56px; object-fit:cover; border-radius:10px;" />
            <div style="flex:1;">
              <div style="font-weight:700;">${product.title || "Item"}</div>
              <div style="opacity:.75; font-size:13px;">
                Buyer: <strong>${userName}</strong>
              </div>
              <span style="background:${color}; color:white; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:700;">
                ${r.status || "unknown"}
              </span>
              ${renderAgreementAcceptanceHtml(r.agreementAcceptance)}
            </div>
          </div>
        </div>
      `;
    })
  );

  listEl.innerHTML = rows.join("");
}
