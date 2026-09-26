// src/utils/dueDateNudgeBanner.ts
//
// Shown on Member/Borrower dashboards whenever the signed-in user has an
// active loan installment due soon (within DUE_SOON_WINDOW_DAYS) or
// already overdue. Non-blocking, purely informational — links to their
// loan details page. Same visual pattern as profileNudgeBanner.ts.

import { getNextDueInstallmentForUser } from "../services/repaymentService";

const BANNER_ID = "due-date-nudge-banner";
const DUE_SOON_WINDOW_DAYS = 3;

function peso(n: number): string {
  return `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Renders (or removes/updates) the due-date nudge banner, inserted
 * immediately after `anchorAfterEl` (typically the dashboard's
 * `.dp-header`).
 */
export async function renderDueDateBanner(
  anchorAfterEl: HTMLElement | null,
  userId: string,
  onViewLoan: (loanId: string) => void
) {
  if (!anchorAfterEl) return;

  const existing = document.getElementById(BANNER_ID);

  let next;
  try {
    next = await getNextDueInstallmentForUser(userId);
  } catch (err) {
    console.error("❌ Failed to load next due installment:", err);
    return;
  }

  if (!next || (!next.isOverdue && next.daysDiff > DUE_SOON_WINDOW_DAYS)) {
    existing?.remove();
    return;
  }

  const dueDateStr = next.dueDate.toLocaleDateString();
  const isOverdue = next.isOverdue;
  const overdueDays = isOverdue ? -next.daysDiff : 0;

  const headline = isOverdue
    ? "⚠️ Payment Overdue"
    : next.daysDiff === 0
    ? "🔔 Payment Due Today"
    : "🔔 Payment Due Soon";

  const detail = isOverdue
    ? `Your installment of ${peso(next.totalDue)} was due on ${dueDateStr} (${overdueDays} day${overdueDays === 1 ? "" : "s"} ago). A late fee applies until it's settled.`
    : next.daysDiff === 0
    ? `Your installment of ${peso(next.totalDue)} is due today (${dueDateStr}).`
    : `Your installment of ${peso(next.totalDue)} is due on ${dueDateStr} (in ${next.daysDiff} day${next.daysDiff === 1 ? "" : "s"}).`;

  const bg = isOverdue ? "#fdecea" : "#fff3cd";
  const border = isOverdue ? "#f5b7ae" : "#ffe58f";
  const textColor = isOverdue ? "#7a1f13" : "#7a5b00";
  const loanId = next.loanId;

  if (existing) {
    const headlineEl = existing.querySelector<HTMLElement>("[data-role='headline']");
    const detailEl = existing.querySelector<HTMLElement>("[data-role='detail']");
    if (headlineEl) {
      headlineEl.textContent = headline;
      headlineEl.style.color = textColor;
    }
    if (detailEl) {
      detailEl.textContent = detail;
      detailEl.style.color = textColor;
    }
    existing.style.background = bg;
    existing.style.borderColor = border;

    const btn = existing.querySelector("button");
    if (btn) (btn as HTMLButtonElement).onclick = () => onViewLoan(loanId);
    return;
  }

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    `background:${bg};border:1px solid ${border};border-radius:12px;` +
    "padding:14px 16px;margin:0 0 16px 0;display:flex;align-items:center;" +
    "justify-content:space-between;gap:12px;flex-wrap:wrap;";

  const textWrap = document.createElement("div");
  textWrap.style.cssText = "flex:1;min-width:200px;";
  textWrap.innerHTML = `
    <strong data-role="headline" style="color:${textColor};">${headline}</strong>
    <p data-role="detail" style="margin:4px 0 0 0;color:${textColor};font-size:13px;">${detail}</p>
  `;

  const btn = document.createElement("button");
  btn.textContent = "View Loan";
  btn.type = "button";
  btn.className = "request-loan-btn";
  btn.style.flexShrink = "0";
  btn.onclick = () => onViewLoan(loanId);

  banner.appendChild(textWrap);
  banner.appendChild(btn);

  anchorAfterEl.insertAdjacentElement("afterend", banner);
}
