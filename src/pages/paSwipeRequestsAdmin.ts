// src/pages/paSwipeRequestsAdmin.ts
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebaseConfig";
import { generatePaSwipeContract } from "../utils/generatePaSwipeContract";

let unsubscribePaSwipeReqs: (() => void) | null = null;
let paSwipeAdminClickBound = false;

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ✅ Semi-monthly due date generator — same 15/30 pattern as loan schedules
function nextSemiMonthlyDate(from: Date): Date {
  const d = new Date(from);
  const day = d.getDate();

  if (day < 15) {
    d.setDate(15);
  } else if (day < 30) {
    // jump to last day of this month (handles Feb, 30/31-day months)
    d.setMonth(d.getMonth() + 1, 0);
  } else {
    d.setMonth(d.getMonth() + 1);
    d.setDate(15);
  }
  return d;
}

function buildSemiMonthlySchedule(
  startDate: Date,
  installmentCount: number,
  installmentAmount: number
) {
  const items: { dueDate: Date; installmentAmount: number }[] = [];
  let cursor = new Date(startDate);

  for (let i = 0; i < installmentCount; i++) {
    cursor = nextSemiMonthlyDate(cursor);
    items.push({
      dueDate: new Date(cursor),
      installmentAmount: Math.round(installmentAmount * 100) / 100,
    });
  }
  return items;
}

export function initPaSwipeRequestsAdmin(container: HTMLElement) {
  if (unsubscribePaSwipeReqs) unsubscribePaSwipeReqs();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📄 MLF Easy Installments — Requests</h3>
      <p style="opacity:.8;">Review pending requests. Confirm the required downpayment was received before approving.</p>
      <div id="pa-swipe-requests-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#pa-swipe-requests-list") as HTMLElement;

  if (!paSwipeAdminClickBound) {
    paSwipeAdminClickBound = true;

    // ✅ Downpayment checkbox toggles the Approve button
    container.addEventListener("change", (e) => {
      const checkbox = (e.target as HTMLElement).closest(
        "input[data-downpayment-check]"
      ) as HTMLInputElement | null;
      if (!checkbox) return;

      const requestId = checkbox.dataset.downpaymentCheck!;
      const approveBtn = container.querySelector(
        `button[data-action="approve"][data-id="${requestId}"]`
      ) as HTMLButtonElement | null;

      if (approveBtn) approveBtn.disabled = !checkbox.checked;
    });

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest(
        "button.pa-swipe-action-btn"
      ) as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action!;
      const requestId = btn.dataset.id!;
      const msgEl = container.querySelector(`[data-msg="${requestId}"]`) as HTMLElement | null;

      // ✅ Extra safety: block approval if the checkbox somehow isn't checked
      if (action === "approve") {
        const checkbox = container.querySelector(
          `input[data-downpayment-check="${requestId}"]`
        ) as HTMLInputElement | null;

        if (!checkbox?.checked) {
          if (msgEl) {
            msgEl.style.color = "red";
            msgEl.textContent = "⛔ Please confirm the downpayment was received first.";
          }
          return;
        }
      }

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = action === "approve" ? "Approving..." : "Denying...";

      try {
        if (action === "deny") {
          await runTransaction(db, async (tx) => {
            const reqRef = doc(db, "paSwipeRequests", requestId);
            tx.update(reqRef, {
              status: "denied",
              deniedAt: serverTimestamp(),
              deniedBy: auth.currentUser?.uid || null,
            });
          });

          if (msgEl) {
            msgEl.style.color = "red";
            msgEl.textContent = "❌ Request denied.";
          }
          return;
        }

        // ✅ APPROVE: confirm downpayment, update request, create installment + semi-monthly schedule
        await runTransaction(db, async (tx) => {
          const reqRef = doc(db, "paSwipeRequests", requestId);
          const reqSnap = await tx.get(reqRef);
          if (!reqSnap.exists()) throw new Error("Request not found.");

          const r = reqSnap.data() as any;
          if (r.status !== "pending") throw new Error("Request already processed.");

          const userId = r.userId;
          if (!userId) throw new Error("Missing userId on request.");

          let userName = r.userName || "";
          if (!userName) {
            const uRef = doc(db, "users", userId);
            const uSnap = await tx.get(uRef);
            const u = uSnap.exists() ? uSnap.data() : null;
            userName =
              (u as any)?.fullName ||
              `${(u as any)?.firstName ?? ""} ${(u as any)?.lastName ?? ""}`.trim() ||
              (u as any)?.email ||
              userId;
          }

          const termMonths = Number(r.termMonths || 12);
          const installmentCount = Number(r.installmentCount || termMonths * 2);
          const installmentAmount = Number(r.installmentAmount || 0);

          const startDate = new Date(); // delivery/approval date

          const installmentRef = doc(db, "paSwipeInstallments", requestId);
          const existingInstallmentSnap = await tx.get(installmentRef);
          if (existingInstallmentSnap.exists()) {
            throw new Error("Installment already exists for this request.");
          }

          // 1) mark request approved + downpayment confirmed
          tx.update(reqRef, {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser?.uid || null,
            downpaymentConfirmed: true,
            userName,
          });

          // 2) build semi-monthly schedule
          const schedule = buildSemiMonthlySchedule(startDate, installmentCount, installmentAmount);
          const nextDueDate = schedule[0]?.dueDate ?? startDate;

          // 3) create installment master doc
          tx.set(installmentRef, {
            requestId,
            userId,
            userName,
            userRole: r.userRole || "member",
            productId: r.productId || null,
            productSnapshot: r.productSnapshot || {},

            srp: Number(r.productSnapshot?.srp || 0),
            termMonths,
            installmentCount,
            downpayment: Number(r.downpayment || 0),
            interestRate: Number(r.interestRate || 0),
            interestAmount: Number(r.interestAmount || 0),
            remainingBalance: Number(r.remainingBalance || 0),
            installmentAmount,

            startDate: Timestamp.fromDate(startDate),
            nextDueDate: Timestamp.fromDate(nextDueDate),
            status: "active", // active | completed | flagged_for_repossession
            createdAt: serverTimestamp(),
          });

          // 4) create schedule docs
          schedule.forEach((s, idx) => {
            const schedRef = doc(
              db,
              "paSwipeInstallments",
              requestId,
              "schedule",
              String(idx + 1)
            );

            tx.set(schedRef, {
              installmentNumber: idx + 1,
              dueDate: Timestamp.fromDate(s.dueDate),
              installmentAmount: s.installmentAmount,
              amountPaid: 0,
              lateFeePaid: 0,
              paid: false,
              paidAt: null,
              createdAt: serverTimestamp(),
            });
          });

          // 5) create the buyer-facing contract for review/acceptance (ONCE per request)
          const contractRef = doc(collection(db, "paSwipeContracts"));

          const contractText = generatePaSwipeContract({
            memberName: userName,
            productName: r.productSnapshot?.title || "Item",
            srp: Number(r.productSnapshot?.srp || 0),
            termMonths,
            downpaymentRate: Number(r.downpaymentRate || 0.20),
            downpayment: Number(r.downpayment || 0),
            interestRate: Number(r.interestRate || 0),
            interestAmount: Number(r.interestAmount || 0),
            remainingBalance: Number(r.remainingBalance || 0),
            installmentAmount,
            installmentCount,
            startDate: startDate.toLocaleDateString(),
          });

          tx.set(contractRef, {
            requestId,
            installmentId: requestId,
            userId,
            userName,
            userRole: r.userRole || "member",
            productSnapshot: r.productSnapshot || {},
            termMonths,
            installmentCount,
            downpayment: Number(r.downpayment || 0),
            interestRate: Number(r.interestRate || 0),
            installmentAmount,
            remainingBalance: Number(r.remainingBalance || 0),
            contractText,
            status: "awaiting_acceptance",
            createdAt: serverTimestamp(),
          });
        });

        if (msgEl) {
          msgEl.style.color = "green";
          msgEl.textContent = "✅ Approved. Installment contract created.";
        }
      } catch (err: any) {
        console.error(err);
        if (msgEl) {
          msgEl.style.color = "red";
          msgEl.textContent = err?.message || "Action failed.";
        }
      } finally {
        btn.disabled = false;
        btn.textContent = oldText || (action === "approve" ? "✅ Approve" : "❌ Deny");
      }
    });
  }

  const q = query(
    collection(db, "paSwipeRequests"),
    where("status", "==", "pending"),
    orderBy("createdAt", "desc")
  );

  unsubscribePaSwipeReqs = onSnapshot(q, async (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p style="opacity:.75;">No pending requests.</p>`;
      return;
    }

    const rows = await Promise.all(
      snap.docs.map(async (d) => {
        const r = d.data() as any;
        const requestId = d.id;

        const userId = r.userId;
        let userName = r.userName || "";
        if (!userName && userId) {
          const uSnap = await getDoc(doc(db, "users", userId));
          const u = uSnap.exists() ? uSnap.data() : null;
          userName =
            (u as any)?.fullName ||
            `${(u as any)?.firstName ?? ""} ${(u as any)?.lastName ?? ""}`.trim() ||
            (u as any)?.email ||
            userId;
        }

        const product = r.productSnapshot || {};
        const title = product.title || "Item";
        const category = product.category || "—";
        const imageUrl = product.imageUrl || "";

        return `
          <div class="card" style="margin:12px 0; padding:14px;">
            <div style="display:flex; gap:12px;">
              <img class="lightbox-img"src="${imageUrl}" style="width:84px;height:84px;object-fit:cover;border-radius:12px;" />
              <div style="flex:1;">
                <div style="font-weight:800; font-size:18px;">${title}</div>
                <div style="opacity:.75; margin-top:2px;">Category: ${category}</div>

                <div style="margin-top:10px; line-height:1.6;">
                  <div><strong>User:</strong> ${userName} <span style="opacity:.7;">(${r.userRole || "—"})</span></div>
                  <div><strong>Term:</strong> ${r.termMonths} months (${r.installmentCount} installments)</div>
                  <div><strong>SRP:</strong> ${peso(product.srp)}</div>
                  <div><strong>Downpayment (${(Number(r.downpaymentRate || 0.20) * 100).toFixed(0)}%):</strong> ${peso(r.downpayment)}</div>
                  <div><strong>Interest Rate:</strong> ${(Number(r.interestRate || 0) * 100).toFixed(0)}%</div>
                  <div><strong>Remaining Balance:</strong> ${peso(r.remainingBalance)}</div>
                  <div><strong>Semi-Monthly Installment:</strong> ${peso(r.installmentAmount)}</div>
                </div>

                <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-weight:600;">
                  <input type="checkbox" data-downpayment-check="${requestId}" />
                  I confirm the ${peso(r.downpayment)} downpayment was received.
                </label>

                <div style="display:flex; gap:10px; margin-top:14px;">
                  <button class="request-loan-btn pa-swipe-action-btn" data-action="approve" data-id="${requestId}" disabled>✅ Approve</button>
                  <button class="deny-btn pa-swipe-action-btn" data-action="deny" data-id="${requestId}">❌ Deny</button>
                </div>

                <p data-msg="${requestId}" style="margin-top:10px;"></p>
              </div>
            </div>
          </div>
        `;
      })
    );

    listEl.innerHTML = rows.join("");
  });
}