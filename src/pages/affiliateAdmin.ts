// src/pages/affiliateAdmin.ts
//
// Admin UI for the MLF Easy Installment affiliate program:
//  - Affiliate Applications: approve/reject members & borrowers who applied
//  - Affiliate Payouts: see accrued vs. paid-out balances, record a payout

import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import {
  approveAffiliate,
  rejectAffiliate,
  recordAffiliatePayout,
} from "../services/affiliateService";

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayName(u: any, fallbackId: string) {
  return (
    u?.fullName ||
    `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() ||
    u?.email ||
    fallbackId
  );
}

// =====================================================================
// 📝 AFFILIATE APPLICATIONS
// =====================================================================
let unsubscribeApplications: (() => void) | null = null;
let applicationsClickBound = false;

export function initAffiliateApplicationsAdmin(container: HTMLElement) {
  if (unsubscribeApplications) unsubscribeApplications();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🤝 Affiliate Applications</h3>
      <p style="opacity:.8;">Any approved member or borrower can apply. Approve to generate their referral code.</p>
      <div id="affiliate-applications-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#affiliate-applications-list") as HTMLElement;

  if (!applicationsClickBound) {
    applicationsClickBound = true;

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest(
        "button.affiliate-app-btn"
      ) as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action!;
      const userId = btn.dataset.userId!;
      const msgEl = container.querySelector(`[data-msg="${userId}"]`) as HTMLElement | null;

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = action === "approve" ? "Approving..." : "Rejecting...";

      try {
        if (action === "approve") {
          await approveAffiliate(userId, auth.currentUser?.uid || null);
          if (msgEl) {
            msgEl.style.color = "green";
            msgEl.textContent = "✅ Approved — referral code generated.";
          }
        } else {
          if (!confirm("Reject this affiliate application?")) {
            btn.disabled = false;
            btn.textContent = oldText;
            return;
          }
          await rejectAffiliate(userId, auth.currentUser?.uid || null);
          if (msgEl) {
            msgEl.style.color = "red";
            msgEl.textContent = "❌ Application rejected.";
          }
        }
      } catch (err: any) {
        console.error(err);
        if (msgEl) {
          msgEl.style.color = "red";
          msgEl.textContent = err?.message || "Action failed.";
        }
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  }

  const q = query(collection(db, "users"), where("affiliateStatus", "==", "pending"));

  unsubscribeApplications = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p style="opacity:.75;">No pending affiliate applications.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs
      .map((d) => {
        const u = d.data() as any;
        const name = displayName(u, d.id);

        return `
          <div class="card" style="margin:12px 0; padding:14px;">
            <div style="font-weight:800;">${name}</div>
            <div style="opacity:.75; font-size:13px;">
              (${u.role || "—"}) • ${u.email || "—"}
            </div>

            <div style="display:flex; gap:10px; margin-top:12px;">
              <button class="request-loan-btn affiliate-app-btn" data-action="approve" data-user-id="${d.id}">✅ Approve</button>
              <button class="deny-btn affiliate-app-btn" data-action="reject" data-user-id="${d.id}">❌ Reject</button>
            </div>

            <p data-msg="${d.id}" style="margin-top:10px;"></p>
          </div>
        `;
      })
      .join("");
  });
}

// =====================================================================
// 💵 AFFILIATE PAYOUTS
// =====================================================================
let unsubscribeAffiliates: (() => void) | null = null;

export function initAffiliatePayoutsAdmin(container: HTMLElement) {
  if (unsubscribeAffiliates) unsubscribeAffiliates();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>💵 Affiliate Payouts</h3>
      <p style="opacity:.8;">Accrued = commission earned so far. Paid Out = cash actually released. Balance = what's still owed.</p>
      <div id="affiliate-payouts-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#affiliate-payouts-list") as HTMLElement;

  const q = query(collection(db, "users"), where("affiliateStatus", "==", "approved"));

  unsubscribeAffiliates = onSnapshot(q, (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p style="opacity:.75;">No approved affiliates yet.</p>`;
      return;
    }

    listEl.innerHTML = snap.docs
      .map((d) => {
        const u = d.data() as any;
        const name = displayName(u, d.id);
        const accrued = Number(u.affiliateEarningsAccrued || 0);
        const paidOut = Number(u.affiliateEarningsPaidOut || 0);
        const balance = Math.round((accrued - paidOut) * 100) / 100;

        return `
          <div class="card" style="margin:12px 0; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <div style="font-weight:800;">${name}</div>
                <div style="opacity:.7; font-size:13px;">Code: <strong>${u.affiliateCode || "—"}</strong></div>
              </div>

              <div style="text-align:right;">
                <div>Accrued: <strong>${peso(accrued)}</strong></div>
                <div>Paid Out: <strong>${peso(paidOut)}</strong></div>
                <div style="font-weight:800; color:${balance > 0 ? "#c0392b" : "#28a745"};">
                  Balance Owed: ${peso(balance)}
                </div>
              </div>
            </div>

            <button
              class="request-loan-btn record-payout-btn"
              data-affiliate-id="${d.id}"
              data-affiliate-name="${name}"
              data-balance="${balance}"
              style="margin-top:10px;"
              ${balance <= 0 ? "disabled" : ""}
            >
              💵 Record Payout
            </button>
            ${balance <= 0 ? `<span style="margin-left:10px;font-size:12px;opacity:.7;">No balance owed yet</span>` : ""}

            <p data-payout-msg="${d.id}" style="margin-top:8px;"></p>
          </div>
        `;
      })
      .join("");

    listEl.querySelectorAll(".record-payout-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const el = btn as HTMLButtonElement;
        openPayoutModal({
          affiliateId: el.dataset.affiliateId!,
          affiliateName: el.dataset.affiliateName!,
          balance: Number(el.dataset.balance),
        });
      });
    });
  });
}

function openPayoutModal(data: { affiliateId: string; affiliateName: string; balance: number }) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="repayment-modal">
      <h3>Record Payout</h3>
      <p><strong>${data.affiliateName}</strong></p>
      <p>Outstanding Balance: <strong>${peso(data.balance)}</strong></p>

      <label>Amount to Pay Out</label>
      <input type="number" id="payout-amount" min="1" max="${data.balance}" value="${data.balance}" />

      <label>Method</label>
      <select id="payout-method">
        <option value="cash">Cash</option>
        <option value="gcash">GCash</option>
        <option value="bank">Bank Transfer</option>
        <option value="other">Other</option>
      </select>

      <label>Notes (optional)</label>
      <input type="text" id="payout-notes" placeholder="e.g., reference number" />

      <div class="modal-actions">
        <button id="payout-confirm" class="btn-confirm">Confirm</button>
        <button id="payout-cancel" class="btn-cancel">Cancel</button>
      </div>
      <p id="payout-modal-msg" style="margin-top:8px;"></p>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById("payout-cancel")?.addEventListener("click", () => modal.remove());

  document.getElementById("payout-confirm")?.addEventListener("click", async () => {
    const amountInput = document.getElementById("payout-amount") as HTMLInputElement;
    const methodInput = document.getElementById("payout-method") as HTMLSelectElement;
    const notesInput = document.getElementById("payout-notes") as HTMLInputElement;
    const msgEl = document.getElementById("payout-modal-msg") as HTMLElement;

    const amount = Number(amountInput.value);
    if (!amount || amount <= 0) {
      msgEl.style.color = "red";
      msgEl.textContent = "Please enter a valid amount.";
      return;
    }

    try {
      await recordAffiliatePayout({
        affiliateId: data.affiliateId,
        amount,
        method: methodInput.value,
        notes: notesInput.value.trim(),
        adminId: auth.currentUser?.uid || null,
      });

      alert("✅ Payout recorded");
      modal.remove();
    } catch (err: any) {
      msgEl.style.color = "red";
      msgEl.textContent = err?.message || "Failed to record payout.";
    }
  });
}