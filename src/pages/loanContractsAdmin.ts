// src/pages/loanContractsAdmin.ts
//
// Admin "Loan Contracts" tab — read-only, collapsible list of every coop
// loan's generated contract document. Same pattern as
// paSwipeContractsAdmin.ts / creditCartContractsAdmin.ts, so all three
// WeeLend lending products are consistent in the admin panel.

import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { renderAgreementStatusBadge } from "../utils/agreementDisplay";

let clickBound = false;

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function initLoanContractsAdmin(container: HTMLElement) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🧾 Coop Loan Contracts — Admin Reference</h3>
      <p style="opacity:.8;">Read-only view of every borrower's coop loan agreement — active and completed.</p>
      <div id="loan-contracts-admin-list">Loading...</div>
    </div>
  `;

  const listEl = container.querySelector("#loan-contracts-admin-list") as HTMLElement;

  let snap;
  try {
    snap = await getDocs(query(collection(db, "loanContracts"), orderBy("createdAt", "desc")));
  } catch (err) {
    console.error("❌ Failed to load loan contracts:", err);
    listEl.innerHTML = `<p style="opacity:.75;">Error loading contracts.</p>`;
    return;
  }

  if (snap.empty) {
    listEl.innerHTML = `<p style="opacity:.75;">No contracts yet. Use "Generate Missing Loan Contracts" in Admin Tools (Overview tab) to backfill existing loans.</p>`;
    return;
  }

  const statusColor: Record<string, string> = {
    accepted: "#28a745",
    completed: "#28a745",
    awaiting_acceptance: "#ffc107",
    declined: "#dc3545",
  };

  listEl.innerHTML = (await Promise.all(
    snap.docs.map(async (d) => {
      const c = d.data() as any;
      const color = statusColor[c.status] || "#888";

      // 📄 Agreement acceptance lives on the original loanRequests doc
      // (requestId field on this contract), not on the contract itself.
      let agreementAcceptance: any = null;
      if (c.requestId) {
        try {
          const reqSnap = await getDoc(doc(db, "loanRequests", c.requestId));
          agreementAcceptance = reqSnap.exists() ? reqSnap.data()?.agreementAcceptance ?? null : null;
        } catch {
          agreementAcceptance = null;
        }
      }

      const backfillTag = c.isLegacyBackfill
        ? `<span style="background:#f0c7a0; color:#5c3a00; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700; margin-left:6px;">CONTRACT BACKFILLED</span>`
        : "";

      return `
        <div class="card" style="margin-bottom:12px; padding:14px;">
          <div style="font-weight:700;">Loan: ₱${Number(c.amount || 0).toLocaleString()}</div>
          <div style="opacity:.75; font-size:13px;">
            Borrower: <strong>${c.userName || c.userId}</strong> •
            ${c.termsMonths} month(s) • Schedule: ${c.paymentSchedule || "—"} •
            Total Payable: ₱${Number(c.totalPayable || 0).toLocaleString()}
          </div>
          <span style="background:${color}; color:white; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:700;">
            ${c.status}
          </span>
          ${backfillTag}
          ${renderAgreementStatusBadge(agreementAcceptance)}

          <details style="margin-top:8px;">
            <summary style="cursor:pointer; font-size:13px; color:#555;">View full contract text</summary>
            <textarea readonly style="width:100%; min-height:220px; margin-top:8px; font-size:12px; padding:8px;">${(c.contractText || "").replaceAll("</", "<\\/")}</textarea>
            <button class="loan-contract-download-btn" data-text="${encodeURIComponent(c.contractText || "")}" data-name="${(c.userName || "borrower").replace(/\s+/g, "-")}-loan" style="margin-top:6px;">
              ⬇️ Download .txt
            </button>
          </details>
        </div>
      `;
    })
  )).join("");

  if (!clickBound) {
    clickBound = true;
    container.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(
        ".loan-contract-download-btn"
      ) as HTMLButtonElement | null;
      if (!btn) return;

      const text = decodeURIComponent(btn.dataset.text || "");
      const name = btn.dataset.name || "contract";
      downloadText(`WeeLend-${name}.txt`, text);
    });
  }
}
