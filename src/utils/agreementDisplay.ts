// =======================================================
// AGREEMENT ACCEPTANCE — ADMIN DISPLAY HELPER
// =======================================================
// Shared renderer for showing a request's persisted AgreementAcceptance
// record (or its absence) inside admin review screens — Pending Loan
// Requests, the active-loan detail page, MLF Easy Installment requests,
// and Marimar's Credit Cart requests. Kept in one place so all four
// screens present the same information the same way.

import type { AgreementAcceptance } from "../type";

export function formatAcceptedAt(acceptedAt: any): string {
  if (!acceptedAt) return "—";
  if (acceptedAt.toDate) return acceptedAt.toDate().toLocaleString();
  try {
    return new Date(acceptedAt).toLocaleString();
  } catch {
    return "—";
  }
}

function formatTermValue(key: string, value: any): string {
  if (typeof value === "number") {
    // Anything that looks like a peso amount vs. a plain count/rate.
    const isMoneyish = /amount|payable|interest|balance|srp/i.test(key) && !/rate|count/i.test(key);
    return isMoneyish ? `₱${value.toLocaleString()}` : String(value);
  }
  return String(value);
}

export function renderAgreementAcceptanceHtml(
  acceptance: AgreementAcceptance | null | undefined
): string {
  if (!acceptance) {
    return `
      <div class="admin-agreement-block" style="margin-top:10px; padding:10px 12px; border-radius:10px; background:#fff3f3; border:1px solid #f3c2c2;">
        <h4 style="margin:0;">📄 Agreement</h4>
        <p style="margin:6px 0 0 0; color:#a02f2f;">⚠️ No agreement record on file for this request.</p>
      </div>
    `;
  }

  const badge = acceptance.isLegacyBackfill
    ? `<span style="background:#f0c7a0; color:#5c3a00; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700;">ADMINISTRATIVE BACKFILL</span>`
    : `<span style="background:#c5e8c5; color:#1e5c1e; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700;">CONFIRMED BY USER</span>`;

  const snapshot = acceptance.termsSnapshot || {};
  const termsRows = Object.entries(snapshot)
    .filter(([k]) => k !== "note")
    .map(([k, v]) => `<div><strong>${k}:</strong> ${formatTermValue(k, v)}</div>`)
    .join("");

  const noteHtml = snapshot.note
    ? `<p style="margin:8px 0 0 0; font-size:12px; opacity:.7;">${snapshot.note}</p>`
    : "";

  const backfilledByHtml = acceptance.isLegacyBackfill && acceptance.backfilledBy
    ? `<div><strong>Backfilled By (admin uid):</strong> ${acceptance.backfilledBy}</div>`
    : "";

  // 📄 The exact liability/responsibility wording the person was shown,
  // verbatim — not just a version reference. Collapsed by default since
  // it's the same text on every record; expand to verify word-for-word.
  const agreementTextHtml = acceptance.agreementText
    ? `
      <details style="margin-top:8px;">
        <summary style="cursor:pointer; font-size:12px; color:#555;">View exact agreement text shown to user</summary>
        <pre style="white-space:pre-wrap; font-size:12px; background:#fff; border:1px solid #e3d9f0; border-radius:8px; padding:10px; margin-top:6px; max-height:260px; overflow:auto;">${acceptance.agreementText}</pre>
      </details>
    `
    : `<p style="margin:8px 0 0 0; font-size:12px; color:#a02f2f;">⚠️ No verbatim agreement text stored on this record (predates that field).</p>`;

  return `
    <div class="admin-agreement-block" style="margin-top:10px; padding:10px 12px; border-radius:10px; background:#f7f4fb; border:1px solid #e3d9f0;">
      <h4 style="margin:0 0 6px 0; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">📄 Agreement ${badge}</h4>
      <div style="font-size:13px; line-height:1.7;">
        <div><strong>Version:</strong> ${acceptance.agreementVersion}</div>
        <div><strong>Accepted At:</strong> ${formatAcceptedAt(acceptance.acceptedAt)}</div>
        ${backfilledByHtml}
        ${termsRows}
      </div>
      ${noteHtml}
      ${agreementTextHtml}
    </div>
  `;
}

// Compact single-line badge for table rows (e.g. the "All Loans" list),
// where the full block above would be too tall. Hover for the timestamp.
export function renderAgreementStatusBadge(
  acceptance: AgreementAcceptance | null | undefined
): string {
  if (!acceptance) {
    return `<span title="No agreement record on file" style="background:#fbdada; color:#a02f2f; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700; white-space:nowrap;">⚠️ Missing</span>`;
  }

  const when = formatAcceptedAt(acceptance.acceptedAt);

  return acceptance.isLegacyBackfill
    ? `<span title="Administratively backfilled ${when}" style="background:#f0c7a0; color:#5c3a00; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700; white-space:nowrap;">🟠 Backfilled</span>`
    : `<span title="Confirmed by user ${when}" style="background:#c5e8c5; color:#1e5c1e; padding:2px 8px; border-radius:8px; font-size:11px; font-weight:700; white-space:nowrap;">✅ Confirmed</span>`;
}
