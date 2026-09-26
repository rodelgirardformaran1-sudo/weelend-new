// src/utils/loanQueueBanner.ts
//
// Two banners shown on Member/Borrower dashboards, same visual pattern
// as dueDateNudgeBanner.ts / profileNudgeBanner.ts:
//
//   1. renderBorrowerQueueBanner — for a user whose OWN loan request is
//      pending, still waiting its turn in the priority queue.
//   2. renderGuarantorQueueBanner — for a user who is the effort-pool
//      guarantor (guarantorId) on someone else's pending request(s).
//
// Both are purely informational (no admin action taken from here) and
// use the same priority ranking the admin's Pending Loan Requests page
// shows, via loanQueueService.ts.

import {
  getQueuePositionForBorrower,
  getQueuePositionsForGuarantor,
} from "../services/loanQueueService";
import { getUserFullName } from "../services/userUtils";

const BORROWER_BANNER_ID = "loan-queue-borrower-banner";
const GUARANTOR_BANNER_ID = "loan-queue-guarantor-banner";

function peso(n: number): string {
  return `₱${Number(n ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function renderBanner(
  id: string,
  anchorAfterEl: HTMLElement,
  headline: string,
  detail: string
) {
  const existing = document.getElementById(id);

  if (existing) {
    const headlineEl = existing.querySelector<HTMLElement>("[data-role='headline']");
    const detailEl = existing.querySelector<HTMLElement>("[data-role='detail']");
    if (headlineEl) headlineEl.textContent = headline;
    if (detailEl) detailEl.textContent = detail;
    return;
  }

  const banner = document.createElement("div");
  banner.id = id;
  banner.style.cssText =
    "background:#e8f1ff;border:1px solid #bcd6ff;border-radius:12px;" +
    "padding:14px 16px;margin:0 0 16px 0;";

  banner.innerHTML = `
    <strong data-role="headline" style="color:#12406b;">${headline}</strong>
    <p data-role="detail" style="margin:4px 0 0 0;color:#12406b;font-size:13px;">${detail}</p>
  `;

  anchorAfterEl.insertAdjacentElement("afterend", banner);
}

/**
 * Shown to the borrower/requester themselves when they have a pending
 * loan request still in the queue.
 */
export async function renderBorrowerQueueBanner(
  anchorAfterEl: HTMLElement | null,
  userId: string
) {
  if (!anchorAfterEl) return;
  const existing = document.getElementById(BORROWER_BANNER_ID);

  let queued;
  try {
    queued = await getQueuePositionForBorrower(userId);
  } catch (err) {
    console.error("❌ Failed to load borrower queue position:", err);
    return;
  }

  if (!queued) {
    existing?.remove();
    return;
  }

  const amount = peso(queued.request.amount);
  const hasPosition = queued.position > 0;

  const headline = !hasPosition
    ? "⏳ Loan Request Submitted"
    : queued.position === 1
    ? "🎉 You're Next in Line!"
    : "⏳ Loan Request Queued";

  const detail = !hasPosition
    ? `Your ${amount} loan request has been submitted and is awaiting admin review.`
    : queued.position === 1
    ? `Your ${amount} loan request is next in line. Please follow up with the admin.`
    : `You are added to the queue. You are the ${ordinal(queued.position)} on the list for your ${amount} loan request.`;

  renderBanner(BORROWER_BANNER_ID, anchorAfterEl, headline, detail);
}

/**
 * Shown to a member who is the (effort-pool) guarantor on one or more
 * other members' pending loan requests, informing them where each
 * request stands in the queue.
 */
export async function renderGuarantorQueueBanner(
  anchorAfterEl: HTMLElement | null,
  userId: string
) {
  if (!anchorAfterEl) return;
  const existing = document.getElementById(GUARANTOR_BANNER_ID);

  let queuedList;
  try {
    queuedList = await getQueuePositionsForGuarantor(userId);
  } catch (err) {
    console.error("❌ Failed to load guarantor queue positions:", err);
    return;
  }

  if (!queuedList.length) {
    existing?.remove();
    return;
  }

  const lines = await Promise.all(
    queuedList.map(async (q) => {
      const name = q.request.hasAccount === false
        ? `${q.request.manualName || "the person you referred"} (no account yet)`
        : await getUserFullName(q.request.userId);
      if (q.position <= 0) return `${name}'s request has been submitted and is awaiting admin review.`;
      return q.position === 1
        ? `${name} is next in the list — please contact/follow up with the admin.`
        : `${name} is the ${ordinal(q.position)} in the list.`;
    })
  );

  const headline =
    queuedList.length === 1
      ? "👥 Your Guaranteed Loan Request"
      : "👥 Your Guaranteed Loan Requests";

  const detail =
    queuedList.length === 1
      ? `Your guaranteeing user/s is/are: ${lines[0]}`
      : lines.join(" ");

  renderBanner(GUARANTOR_BANNER_ID, anchorAfterEl, headline, detail);
}
