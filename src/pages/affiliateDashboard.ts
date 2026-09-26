// src/pages/affiliateDashboard.ts
//
// Self-contained affiliate program panel for a member/borrower dashboard.
// Mount it into any container: initAffiliateDashboard(container, userId).
//
// Shows:
//  - "Apply" button if not yet applied (or previously rejected)
//  - "Application pending" state
//  - Referral code + shareable link, earnings (accrued/paid out/balance),
//    and recent commission history — once approved.

import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import {
  applyForAffiliate,
  getAffiliateCommissionHistory,
  getAffiliatePayoutHistory,
} from "../services/affiliateService";

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(d: any) {
  if (!d) return "N/A";
  const date = d.toDate ? d.toDate() : new Date(d);
  return date.toLocaleDateString();
}

let unsubscribeAffiliateDashboard: (() => void) | null = null;

export function initAffiliateDashboard(container: HTMLElement, userId: string) {
  if (unsubscribeAffiliateDashboard) unsubscribeAffiliateDashboard();

  container.innerHTML = `<p style="opacity:.8;">Loading affiliate status...</p>`;

  unsubscribeAffiliateDashboard = onSnapshot(doc(db, "users", userId), async (snap) => {
    const u = snap.exists() ? (snap.data() as any) : {};
    const status: string = u.affiliateStatus || "none";

    if (status === "none" || status === "rejected") {
      renderApplyState(container, userId, status);
      return;
    }

    if (status === "pending") {
      container.innerHTML = `
        <div class="card" style="padding:16px;">
          <h3>🤝 Affiliate Program</h3>
          <p>Your application is under review. We'll notify you once it's approved.</p>
        </div>
      `;
      return;
    }

    if (status === "approved") {
      await renderApprovedState(container, userId, u);
      return;
    }

    container.innerHTML = `<p style="opacity:.75;">Affiliate status unavailable.</p>`;
  });
}

function renderApplyState(container: HTMLElement, userId: string, status: string) {
  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🤝 Affiliate Program</h3>
      <p style="opacity:.85;">
        Refer buyers to MLF Easy Installment and earn 10% of the interest on every sale you help close —
        half when their downpayment is confirmed, the rest as they pay off their installments.
      </p>
      ${
        status === "rejected"
          ? `<p style="color:#c0392b;">Your previous application was not approved. You may apply again.</p>`
          : ""
      }
      <button id="apply-affiliate-btn" class="request-loan-btn">📝 Apply to Become an Affiliate</button>
      <p id="apply-affiliate-msg" style="margin-top:10px;"></p>
    </div>
  `;

  const btn = container.querySelector("#apply-affiliate-btn") as HTMLButtonElement;
  const msgEl = container.querySelector("#apply-affiliate-msg") as HTMLElement;

  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
      await applyForAffiliate(userId);
      msgEl.style.color = "green";
      msgEl.textContent = "✅ Application submitted. Waiting for admin approval.";
    } catch (err: any) {
      console.error(err);
      msgEl.style.color = "red";
      msgEl.textContent = err?.message || "Failed to submit application.";
      btn.disabled = false;
      btn.textContent = "📝 Apply to Become an Affiliate";
    }
  });
}

async function renderApprovedState(container: HTMLElement, userId: string, u: any) {
  const accrued = Number(u.affiliateEarningsAccrued || 0);
  const paidOut = Number(u.affiliateEarningsPaidOut || 0);
  const balance = Math.round((accrued - paidOut) * 100) / 100;
  const code = u.affiliateCode || "—";

  const referralLink = code !== "—"
    ? `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(code)}`
    : "";

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>🤝 Your Affiliate Referral</h3>

      <div style="margin-top:8px;">
        <label style="font-weight:600;">Your Referral Code</label>
        <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
          <input id="aff-code-display" type="text" value="${code}" readonly style="padding:8px; border-radius:10px; font-weight:700;" />
          <button id="copy-code-btn" class="request-loan-btn">📋 Copy Code</button>
        </div>
      </div>

      ${
        referralLink
          ? `
      <div style="margin-top:12px;">
        <label style="font-weight:600;">Shareable Link</label>
        <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
          <input id="aff-link-display" type="text" value="${referralLink}" readonly style="padding:8px; border-radius:10px; flex:1; min-width:0;" />
          <button id="copy-link-btn" class="request-loan-btn">📋 Copy Link</button>
        </div>
      </div>`
          : ""
      }

      <div class="card" style="background:#f7f7f7; margin-top:14px; padding:12px;">
        <div>Accrued: <strong>${peso(accrued)}</strong></div>
        <div>Paid Out: <strong>${peso(paidOut)}</strong></div>
        <div style="font-weight:800; color:${balance > 0 ? "#c0392b" : "#28a745"};">
          Balance Owed to You: ${peso(balance)}
        </div>
      </div>

      <p id="aff-copy-msg" style="margin-top:8px;"></p>
    </div>

    <div class="card" style="padding:16px; margin-top:12px;">
      <h3>📜 Commission History</h3>
      <div id="aff-commission-history"><p style="opacity:.75;">Loading...</p></div>
    </div>

    <div class="card" style="padding:16px; margin-top:12px;">
      <h3>💵 Payout History</h3>
      <div id="aff-payout-history"><p style="opacity:.75;">Loading...</p></div>
    </div>
  `;

  const msgEl = container.querySelector("#aff-copy-msg") as HTMLElement;

  container.querySelector("#copy-code-btn")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(code);
    msgEl.style.color = "green";
    msgEl.textContent = "✅ Code copied.";
  });

  container.querySelector("#copy-link-btn")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(referralLink);
    msgEl.style.color = "green";
    msgEl.textContent = "✅ Link copied.";
  });

  // Commission + payout history (one-time fetch; re-fetches on every user-doc update)
  const [commissions, payouts] = await Promise.all([
    getAffiliateCommissionHistory(userId),
    getAffiliatePayoutHistory(userId),
  ]);

  const historyEl = container.querySelector("#aff-commission-history") as HTMLElement;
  if (!commissions.length) {
    historyEl.innerHTML = `<p style="opacity:.75;">No commissions yet.</p>`;
  } else {
    // ✅ Group by referred item (installmentId) so an affiliate who referred
    // multiple purchases gets one collapsible section per item instead of
    // one long flat table mixing every referral together.
    type CommissionRow = (typeof commissions)[number];
    const groups = new Map<string, { productTitle: string; rows: CommissionRow[] }>();

    commissions.forEach((c: any) => {
      const key = c.installmentId || `no-item-${c.id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          productTitle: c.productTitle || "Item",
          rows: [],
        });
      }
      groups.get(key)!.rows.push(c);
    });

    // Sort each group's rows newest-first, then sort the groups themselves
    // by their most recent activity (so the most recently active referral
    // appears first / open by default).
    const groupList = Array.from(groups.values()).map((g) => {
      const rows = [...g.rows].sort(
        (a: any, b: any) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
      );
      const total = rows.reduce((sum, r: any) => sum + Number(r.amount || 0), 0);
      const mostRecentMs = rows[0]?.createdAt?.toMillis?.() ?? 0;
      return { productTitle: g.productTitle, rows, total, mostRecentMs };
    });

    groupList.sort((a, b) => b.mostRecentMs - a.mostRecentMs);

    historyEl.innerHTML = groupList
      .map(
        (g, idx) => `
      <details ${idx === 0 ? "open" : ""} style="margin-bottom:10px; border:1px solid #e2e2e2; border-radius:10px; padding:8px 12px;">
        <summary style="cursor:pointer; font-weight:700; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <span>🧾 ${g.productTitle}</span>
          <span style="font-weight:600; opacity:.8; white-space:nowrap;">${g.rows.length} event${g.rows.length === 1 ? "" : "s"} — Total: ${peso(g.total)}</span>
        </summary>
        <table class="admin-table" style="margin-top:10px;">
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th></tr></thead>
          <tbody>
            ${g.rows
              .map(
                (c: any) => `
              <tr>
                <td>${formatDate(c.createdAt)}</td>
                <td>${c.type === "first_half" ? "First Half (downpayment)" : "Second Half (installment)"}</td>
                <td>${peso(c.amount)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </details>`
      )
      .join("");
  }

  const payoutEl = container.querySelector("#aff-payout-history") as HTMLElement;
  if (!payouts.length) {
    payoutEl.innerHTML = `<p style="opacity:.75;">No payouts recorded yet.</p>`;
  } else {
    const sorted = [...payouts].sort(
      (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
    );
    payoutEl.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Date</th><th>Method</th><th>Amount</th></tr></thead>
        <tbody>
          ${sorted
            .map(
              (p) => `
            <tr>
              <td>${formatDate(p.createdAt)}</td>
              <td>${p.method || "—"}</td>
              <td>${peso(p.amount)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }
}