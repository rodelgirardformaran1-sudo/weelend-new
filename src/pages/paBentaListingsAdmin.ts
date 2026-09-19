// src/pages/paBentaListingsAdmin.ts
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

let unsubscribeListings: (() => void) | null = null;
let clickBound = false;

const REJECTION_REASONS = [
  "Prohibited Item",
  "Blurry Photo",
  "Incomplete Information",
  "Suspicious Price",
  "Other",
];

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function initPaBentaListingsAdmin(container: HTMLElement) {
  if (unsubscribeListings) unsubscribeListings();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📦 Pa-benta Marketplace — Listing Approvals</h3>
      <p style="opacity:.8;">Review new product listings before they appear in the marketplace feed.</p>
      <div id="pabenta-listings-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#pabenta-listings-list") as HTMLElement;

  if (!clickBound) {
    clickBound = true;

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest("button.pabenta-listing-action-btn") as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action!;
      const listingId = btn.dataset.id!;
      const msgEl = container.querySelector(`[data-msg="${listingId}"]`) as HTMLElement | null;

      if (action === "reject") {
        const reasonSelect = container.querySelector(`select[data-reason-for="${listingId}"]`) as HTMLSelectElement | null;
        const reason = reasonSelect?.value;

        if (!reason) {
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = "⛔ Please select a rejection reason first."; }
          return;
        }

        btn.disabled = true;
        try {
          await runTransaction(db, async (tx) => {
            tx.update(doc(db, "paBentaListings", listingId), {
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
            tx.update(doc(db, "paBentaListings", listingId), {
              status: "approved",
              approvedAt: serverTimestamp(),
              approvedBy: auth.currentUser?.uid || null,
            });
          });
          if (msgEl) { msgEl.style.color = "green"; msgEl.textContent = "✅ Listing approved."; }
        } catch (err: any) {
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = err?.message || "Failed."; }
        } finally {
          btn.disabled = false;
        }
        return;
      }
    });
  }

  const q = query(collection(db, "paBentaListings"), where("status", "==", "pending"), orderBy("createdAt", "desc"));

  unsubscribeListings = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p style="opacity:.75;">No pending listings.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs.map((d) => {
      const l = { id: d.id, ...(d.data() as any) };
      const img = l.imageUrls?.[0] || "";

      return `
        <div class="card" style="margin:12px 0; padding:14px;">
          <div style="display:flex; gap:12px;">
            ${img ? `<img class="lightbox-img" src="${img}" style="width:84px;height:84px;object-fit:cover;border-radius:12px;" />` : ""}
            <div style="flex:1;">
              <div style="font-weight:800; font-size:16px;">${l.productName}</div>
              <div style="opacity:.75; font-size:13px;">
                ${peso(l.price)} • ${l.category} • ${l.condition} • ${l.stockStatus}
              </div>
              ${l.description ? `<p style="margin-top:8px; font-size:14px;">${l.description}</p>` : ""}
              <div style="margin-top:8px; font-size:13px;">
                <strong>Contact:</strong> ${l.contactNumber} (${l.preferredContactMethod})
                ${l.location ? ` • <strong>Location:</strong> ${l.location}` : ""}
              </div>

              <div style="display:flex; gap:10px; margin-top:14px; align-items:center; flex-wrap:wrap;">
                <button class="request-loan-btn pabenta-listing-action-btn" data-action="approve" data-id="${l.id}">✅ Approve</button>

                <select data-reason-for="${l.id}" style="max-width:200px;">
                  <option value="">Select reason to reject...</option>
                  ${REJECTION_REASONS.map((r) => `<option value="${r}">${r}</option>`).join("")}
                </select>
                <button class="deny-btn pabenta-listing-action-btn" data-action="reject" data-id="${l.id}">❌ Reject</button>
              </div>

              <p data-msg="${l.id}" style="margin-top:10px;"></p>
            </div>
          </div>
        </div>
      `;
    }).join("");
  });
}