// src/pages/paBentaShopsAdmin.ts
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";

let unsubscribeShops: (() => void) | null = null;
let clickBound = false;

const REJECTION_REASONS = [
  "Incomplete Information",
  "Inappropriate Shop Name",
  "Duplicate Shop",
  "Other",
];

export function initPaBentaShopsAdmin(container: HTMLElement) {
  if (unsubscribeShops) unsubscribeShops();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🏪 Pa-benta Marketplace — Shop Approvals</h3>
      <p style="opacity:.8;">Review new shop applications before they go live.</p>
      <div id="pabenta-shops-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#pabenta-shops-list") as HTMLElement;

  if (!clickBound) {
    clickBound = true;

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest("button.pabenta-shop-action-btn") as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action!;
      const shopId = btn.dataset.id!;
      const msgEl = container.querySelector(`[data-msg="${shopId}"]`) as HTMLElement | null;

      if (action === "reject") {
        const reasonSelect = container.querySelector(`select[data-reason-for="${shopId}"]`) as HTMLSelectElement | null;
        const reason = reasonSelect?.value;

        if (!reason) {
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = "⛔ Please select a rejection reason first."; }
          return;
        }

        btn.disabled = true;
        try {
          await runTransaction(db, async (tx) => {
            tx.update(doc(db, "paBentaShops", shopId), {
              status: "rejected",
              rejectionReason: reason,
              rejectedAt: serverTimestamp(),
              rejectedBy: auth.currentUser?.uid || null,
            });
          });
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = `❌ Rejected: ${reason}`; }
        } catch (err: any) {
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = err?.message || "Failed."; }
        } finally {
          btn.disabled = false;
        }
        return;
      }

      if (action === "approve") {
        btn.disabled = true;
        try {
          await runTransaction(db, async (tx) => {
            tx.update(doc(db, "paBentaShops", shopId), {
              status: "approved",
              approvedAt: serverTimestamp(),
              approvedBy: auth.currentUser?.uid || null,
            });
          });
          if (msgEl) { msgEl.style.color = "green"; msgEl.textContent = "✅ Shop approved."; }
        } catch (err: any) {
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = err?.message || "Failed."; }
        } finally {
          btn.disabled = false;
        }
        return;
      }
    });
  }

  const q = query(collection(db, "paBentaShops"), where("status", "==", "pending"), orderBy("createdAt", "desc"));

  unsubscribeShops = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p style="opacity:.75;">No pending shop applications.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs.map((d) => {
      const s = { id: d.id, ...(d.data() as any) };

      return `
        <div class="card" style="margin:12px 0; padding:14px;">
          <div style="font-weight:800; font-size:16px;">${s.shopName}</div>
          <div style="opacity:.75; font-size:13px;">Owner: <strong>${s.ownerName}</strong></div>
          ${s.shopDescription ? `<p style="margin-top:8px;">${s.shopDescription}</p>` : ""}

          <div style="display:flex; gap:10px; margin-top:14px; align-items:center; flex-wrap:wrap;">
            <button class="request-loan-btn pabenta-shop-action-btn" data-action="approve" data-id="${s.id}">✅ Approve</button>

            <select data-reason-for="${s.id}" style="max-width:220px;">
              <option value="">Select reason to reject...</option>
              ${REJECTION_REASONS.map((r) => `<option value="${r}">${r}</option>`).join("")}
            </select>
            <button class="deny-btn pabenta-shop-action-btn" data-action="reject" data-id="${s.id}">❌ Reject</button>
          </div>

          <p data-msg="${s.id}" style="margin-top:10px;"></p>
        </div>
      `;
    }).join("");
  });
}