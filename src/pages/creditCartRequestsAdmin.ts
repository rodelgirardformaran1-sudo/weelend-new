// src/pages/creditCartRequestsAdmin.ts
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
import { generateCreditCartContract } from "../utils/generateCreditCartContract";

let unsubscribeCreditCartReqs: (() => void) | null = null;
let creditCartAdminClickBound = false;

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function nextSemiMonthlyDate(from: Date): Date {
  const d = new Date(from);
  const day = d.getDate();
  if (day < 15) d.setDate(15);
  else if (day < 30) d.setMonth(d.getMonth() + 1, 0);
  else { d.setMonth(d.getMonth() + 1); d.setDate(15); }
  return d;
}

function buildSemiMonthlySchedule(startDate: Date, installmentCount: number, installmentAmount: number) {
  const items: { dueDate: Date; installmentAmount: number }[] = [];
  let cursor = new Date(startDate);
  for (let i = 0; i < installmentCount; i++) {
    cursor = nextSemiMonthlyDate(cursor);
    items.push({ dueDate: new Date(cursor), installmentAmount: Math.round(installmentAmount * 100) / 100 });
  }
  return items;
}

export function initCreditCartRequestsAdmin(container: HTMLElement) {
  if (unsubscribeCreditCartReqs) unsubscribeCreditCartReqs();

  container.innerHTML = `
    <div class="card" style="padding:16px;">
      <h3>📝 Marimar's Credit Cart — Requests</h3>
      <p style="opacity:.8;">Review pending credit requests.</p>
      <div id="credit-cart-requests-list"></div>
    </div>
  `;

  const listEl = container.querySelector("#credit-cart-requests-list") as HTMLElement;

  if (!creditCartAdminClickBound) {
    creditCartAdminClickBound = true;

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest("button.credit-cart-action-btn") as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.dataset.action!;
      const requestId = btn.dataset.id!;
      const msgEl = container.querySelector(`[data-msg="${requestId}"]`) as HTMLElement | null;

      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = action === "approve" ? "Approving..." : "Denying...";

      try {
        if (action === "deny") {
          await runTransaction(db, async (tx) => {
            tx.update(doc(db, "creditCartRequests", requestId), {
              status: "denied",
              deniedAt: serverTimestamp(),
              deniedBy: auth.currentUser?.uid || null,
            });
          });
          if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = "❌ Request denied."; }
          return;
        }

        await runTransaction(db, async (tx) => {
          const reqRef = doc(db, "creditCartRequests", requestId);
          const reqSnap = await tx.get(reqRef);
          if (!reqSnap.exists()) throw new Error("Request not found.");

          const r = reqSnap.data() as any;
          if (r.status !== "pending") throw new Error("Request already processed.");

          const userId = r.userId;
          if (!userId) throw new Error("Missing userId on request.");

          let userName = r.userName || "";
          if (!userName) {
            const uSnap = await tx.get(doc(db, "users", userId));
            const u = uSnap.exists() ? uSnap.data() : null;
            userName = (u as any)?.fullName || `${(u as any)?.firstName ?? ""} ${(u as any)?.lastName ?? ""}`.trim() || (u as any)?.email || userId;
          }

          const installmentCount = Number(r.installmentCount || 2);
          const installmentAmount = Number(r.installmentAmount || 0);
          const startDate = new Date();

          const accountRef = doc(db, "creditCartAccounts", requestId);
          const existingSnap = await tx.get(accountRef);
          if (existingSnap.exists()) throw new Error("Account already exists for this request.");

          tx.update(reqRef, {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: auth.currentUser?.uid || null,
            userName,
          });

          const schedule = buildSemiMonthlySchedule(startDate, installmentCount, installmentAmount);
          const nextDueDate = schedule[0]?.dueDate ?? startDate;

          tx.set(accountRef, {
            requestId,
            userId,
            userName,
            userRole: r.userRole || "member",
            category: r.category,
            amount: Number(r.amount || 0),
            termMonths: Number(r.termMonths || 1),
            installmentCount,
            interestRate: Number(r.interestRate || 0.10),
            interestAmount: Number(r.interestAmount || 0),
            totalPayable: Number(r.totalPayable || 0),
            installmentAmount,
            startDate: Timestamp.fromDate(startDate),
            nextDueDate: Timestamp.fromDate(nextDueDate),
            status: "active",
            createdAt: serverTimestamp(),
          });

          schedule.forEach((s, idx) => {
            const schedRef = doc(db, "creditCartAccounts", requestId, "schedule", String(idx + 1));
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

          const contractRef = doc(collection(db, "creditCartContracts"));
          const contractText = generateCreditCartContract({
            memberName: userName,
            category: r.category,
            amount: Number(r.amount || 0),
            termMonths: Number(r.termMonths || 1),
            installmentCount,
            interestAmount: Number(r.interestAmount || 0),
            totalPayable: Number(r.totalPayable || 0),
            installmentAmount,
            startDate: startDate.toLocaleDateString(),
          });

          tx.set(contractRef, {
            requestId,
            accountId: requestId,
            userId,
            userName,
            userRole: r.userRole || "member",
            category: r.category,
            amount: Number(r.amount || 0),
            termMonths: Number(r.termMonths || 1),
            installmentCount,
            installmentAmount,
            totalPayable: Number(r.totalPayable || 0),
            contractText,
            status: "awaiting_acceptance",
            createdAt: serverTimestamp(),
          });
        });

        if (msgEl) { msgEl.style.color = "green"; msgEl.textContent = "✅ Approved. Credit account created."; }
      } catch (err: any) {
        console.error(err);
        if (msgEl) { msgEl.style.color = "red"; msgEl.textContent = err?.message || "Action failed."; }
      } finally {
        btn.disabled = false;
        btn.textContent = oldText || (action === "approve" ? "✅ Approve" : "❌ Deny");
      }
    });
  }

  const q = query(collection(db, "creditCartRequests"), where("status", "==", "pending"), orderBy("createdAt", "desc"));

  unsubscribeCreditCartReqs = onSnapshot(q, async (snap) => {
    if (snap.empty) { listEl.innerHTML = `<p style="opacity:.75;">No pending requests.</p>`; return; }

    const rows = await Promise.all(
      snap.docs.map(async (d) => {
        const r = d.data() as any;
        const requestId = d.id;
        const userId = r.userId;
        let userName = r.userName || "";
        if (!userName && userId) {
          const uSnap = await getDoc(doc(db, "users", userId));
          const u = uSnap.exists() ? uSnap.data() : null;
          userName = (u as any)?.fullName || `${(u as any)?.firstName ?? ""} ${(u as any)?.lastName ?? ""}`.trim() || (u as any)?.email || userId;
        }

        const categoryLabel = r.category === "grocery" ? "Grocery" : "Department Store / Shopping Spree";

        return `
          <div class="card" style="margin:12px 0; padding:14px;">
            <div style="font-weight:800; font-size:16px;">${categoryLabel}</div>
            <div style="margin-top:8px; line-height:1.6;">
              <div><strong>User:</strong> ${userName} <span style="opacity:.7;">(${r.userRole || "—"})</span></div>
              <div><strong>Amount:</strong> ${peso(r.amount)}</div>
              <div><strong>Term:</strong> ${r.termMonths} month(s) (${r.installmentCount} payments)</div>
              <div><strong>Interest (10%):</strong> ${peso(r.interestAmount)}</div>
              <div><strong>Total Payable:</strong> ${peso(r.totalPayable)}</div>
              <div><strong>Semi-Monthly Installment:</strong> ${peso(r.installmentAmount)}</div>
            </div>
            <div style="display:flex; gap:10px; margin-top:14px;">
              <button class="request-loan-btn credit-cart-action-btn" data-action="approve" data-id="${requestId}">✅ Approve</button>
              <button class="deny-btn credit-cart-action-btn" data-action="deny" data-id="${requestId}">❌ Deny</button>
            </div>
            <p data-msg="${requestId}" style="margin-top:10px;"></p>
          </div>
        `;
      })
    );

    listEl.innerHTML = rows.join("");
  });
}