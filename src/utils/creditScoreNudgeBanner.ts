// src/utils/creditScoreNudgeBanner.ts
//
// Shown on Member/Borrower dashboards whenever the signed-in user's
// credit score has dropped below CREDIT_SCORE_WARNING_THRESHOLD (late
// coop-loan installments lower it — see creditEngine.ts). Non-blocking,
// purely informational. Same visual pattern as dueDateNudgeBanner.ts /
// profileNudgeBanner.ts, but doesn't need its own Firestore read — the
// caller already has the score from its profile onSnapshot listener.

import { CREDIT_SCORE_WARNING_THRESHOLD, DEFAULT_CREDIT_SCORE } from "../services/creditEngine";

const BANNER_ID = "credit-score-nudge-banner";

/**
 * Renders (or removes/updates) the low-credit-score nudge banner,
 * inserted immediately after `anchorAfterEl` (typically the dashboard's
 * `.dp-header`).
 */
export function renderCreditScoreBanner(
  anchorAfterEl: HTMLElement | null,
  creditScore: number | undefined | null
) {
  if (!anchorAfterEl) return;

  const score = Number(creditScore ?? DEFAULT_CREDIT_SCORE);
  const existing = document.getElementById(BANNER_ID);

  if (score >= CREDIT_SCORE_WARNING_THRESHOLD) {
    existing?.remove();
    return;
  }

  const detail =
    `Your current score is ${score}/100. Late loan payments lower it, and a low score can place your ` +
    `future loan requests behind others in the queue. Pay your installments on time to raise it back up.`;

  if (existing) {
    const detailEl = existing.querySelector<HTMLElement>("[data-role='detail']");
    if (detailEl) detailEl.textContent = detail;
    return;
  }

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    "background:#fdecea;border:1px solid #f5b7ae;border-radius:12px;" +
    "padding:14px 16px;margin:0 0 16px 0;";

  banner.innerHTML = `
    <strong style="color:#7a1f13;">📉 Your Credit Score Needs Attention</strong>
    <p data-role="detail" style="margin:4px 0 0 0;color:#7a1f13;font-size:13px;">${detail}</p>
  `;

  anchorAfterEl.insertAdjacentElement("afterend", banner);
}
