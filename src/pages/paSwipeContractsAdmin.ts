// src/pages/paSwipeContractsAdmin.ts
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";

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

export async function initPaSwipeContractsAdmin(container: HTMLElement) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🧾 MLF Contracts — Admin Reference</h3>
      <p style="opacity:.8;">Read-only view of every buyer's installment agreement.</p>
      <div id="pa-swipe-contracts-admin-list">Loading...</div>
    </div>
  `;

  const listEl = container.querySelector("#pa-swipe-contracts-admin-list") as HTMLElement;

  const q = query(collection(db, "paSwipeContracts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    listEl.innerHTML = `<p style="opacity:.75;">No contracts yet.</p>`;
    return;
  }

  const statusColor: Record<string, string> = {
    awaiting_acceptance: "#ffc107",
    accepted: "#28a745",
    declined: "#dc3545",
  };

  listEl.innerHTML = (await Promise.all(
    snap.docs.map(async (d) => {
      const c = d.data() as any;
      const product = c.productSnapshot || {};
      const color = statusColor[c.status] || "#888";

      // 📄 Agreement acceptance lives on the original paSwipeRequests doc
      // (requestId field on this contract), not on the contract itself.
      let agreementAcceptance: any = null;
      if (c.requestId) {
        try {
          const reqSnap = await getDoc(doc(db, "paSwipeRequests", c.requestId));
          agreementAcceptance = reqSnap.exists() ? reqSnap.data()?.agreementAcceptance ?? null : null;
        } catch {
          agreementAcceptance = null;
        }
      }

      return `
        <div class="card" style="margin-bottom:12px; padding:14px;">
          <div style="display:flex; gap:12px;">
            <img class="lightbox-img"src="${product.imageUrl || ""}" style="width:64px; height:64px; object-fit:cover; border-radius:10px;" />
            <div style="flex:1;">
              <div style="font-weight:700;">${product.title || "Item"}</div>
              <div style="opacity:.75; font-size:13px;">
                Buyer: <strong>${c.userName || c.userId}</strong> •
                ${c.termMonths} months • Downpayment: ₱${Number(c.downpayment || 0).toLocaleString()}
              </div>
              <span style="background:${color}; color:white; padding:2px 8px; border-radius:10px; font-size:12px; font-weight:700;">
                ${c.status}
              </span>
              ${renderAgreementAcceptanceHtml(agreementAcceptance)}

              <details style="margin-top:8px;">
                <summary style="cursor:pointer; font-size:13px; color:#555;">View full contract text</summary>
                <textarea readonly style="width:100%; min-height:220px; margin-top:8px; font-size:12px; padding:8px;">${(c.contractText || "").replaceAll("</", "<\\/")}</textarea>
                <button class="pa-swipe-contract-download-btn" data-text="${encodeURIComponent(c.contractText || "")}" data-name="${(c.userName || "buyer").replace(/\s+/g, "-")}-${product.title || "item"}" style="margin-top:6px;">
                  ⬇️ Download .txt
                </button>
              </details>
            </div>
          </div>
        </div>
      `;
    })
  )).join("");

  if (!clickBound) {
    clickBound = true;
    container.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(
        ".pa-swipe-contract-download-btn"
      ) as HTMLButtonElement | null;
      if (!btn) return;

      const text = decodeURIComponent(btn.dataset.text || "");
      const name = btn.dataset.name || "contract";
      downloadText(`WeeLend-${name}.txt`, text);
    });
  }
}