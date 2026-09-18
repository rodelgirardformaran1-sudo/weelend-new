// src/pages/paSwipeContracts.ts

import { auth, db } from "../firebaseConfig"; // ✅ align with your project imports
import { showPage } from "../main";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  serverTimestamp,
  orderBy,
} from "firebase/firestore";

type PaSwipeContract = {
  id: string;
  userId: string;
  userRole?: "member" | "borrower" | string;

  productSnapshot?: {
    title?: string;
    category?: string;
    imageUrl?: string;
    srp?: number;
  };

  termMonths: number;
  installmentCount: number;
  downpayment: number;
  installmentAmount: number;
  remainingBalance: number;
  interestRate?: number;

  status: "awaiting_acceptance" | "accepted" | "declined" | "released" | string;
  contractText?: string;

  createdAt?: any;
  acceptedAt?: any;
};

function formatMoney(n: number | undefined) {
  const v = Number(n || 0);
  return `₱${v.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ✅ Guards to prevent listener stacking
let contractsClickBound = false;
let backBtnsBound = false;

// ✅ Public entry point for BOTH member and borrower dashboards
export async function initPaSwipeContractsPage() {
  showPage("page-pa-swipe-contracts");

  const root = document.getElementById("pa-swipe-contracts-root");
  if (!root) {
    console.warn("❌ pa-swipe-contracts-root not found");
    return;
  }

  await renderPaSwipeContractsPage(root);

  // Bind back buttons once (optional but useful)
  if (!backBtnsBound) {
    backBtnsBound = true;

    document
      .querySelectorAll<HTMLButtonElement>(".back-btn[data-back='member']")
      .forEach((btn) =>
        btn.addEventListener("click", () => showPage("page-dashboard-member"))
      );

    document
      .querySelectorAll<HTMLButtonElement>(".back-btn[data-back='borrower']")
      .forEach((btn) =>
        btn.addEventListener("click", () => showPage("page-dashboard-borrower"))
      );
  }
}

export async function renderPaSwipeContractsPage(container: HTMLElement) {
  container.innerHTML = `
    <h2>Pa-Swipe Contracts</h2>
    <p class="muted">Review and accept your installment agreement(s).</p>

    <div id="contracts-state" class="muted">Loading...</div>
    <div id="contracts-list" class="contracts-list"></div>
  `;

  const user = auth.currentUser;
  const stateEl = container.querySelector("#contracts-state") as HTMLElement | null;
  const listEl = container.querySelector("#contracts-list") as HTMLElement | null;

  if (!stateEl || !listEl) return;

  if (!user) {
    stateEl.textContent = "You must be signed in.";
    return;
  }

  const q = query(
    collection(db, "paSwipeContracts"),
    where("userId", "==", user.uid),
    orderBy("createdAt", "desc")
  );

  const snap = await getDocs(q);
  const contracts: PaSwipeContract[] = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  }));

  if (contracts.length === 0) {
    stateEl.textContent = "No contracts found.";
    return;
  }

  stateEl.textContent = "";

  listEl.innerHTML = contracts
    .map((c) => {
      const productName = c.productSnapshot?.title || "Item";
      const image = c.productSnapshot?.imageUrl || "";

      const contractText = c.contractText || "(Contract text not available.)";
      const canDecide = c.status === "awaiting_acceptance";

      return `
        <div class="contract-card" data-id="${c.id}">
          <div class="contract-header">
            <div class="contract-left">
              ${image ? `<img class="contract-img lightbox-img" src="${image}" alt="${productName}" />` : ""}
              <div>
                <div class="contract-title">${productName}</div>
                <div class="muted small">
                  Term: <b>${c.termMonths}</b> months (${c.installmentCount} payments) • Downpayment: <b>${formatMoney(c.downpayment)}</b> • Semi-Monthly: <b>${formatMoney(c.installmentAmount)}</b>
                </div>
                <div class="muted small">
                  3-day grace period, then 0.1%/day late fee (capped at 10% of the overdue installment)
                </div>
                <div class="status-badge status-${c.status}">Status: ${c.status}</div>
              </div>
            </div>
          </div>

          <div class="contract-body">
            <label class="muted small">Contract Text</label>
            <textarea class="contract-text" readonly>${contractText.replaceAll("</", "<\\/")}</textarea>

            <div class="contract-actions">
              <button class="btn secondary" data-action="copy">📋 Copy</button>
              <button class="btn secondary" data-action="download">⬇️ Download .txt</button>

              ${canDecide ? `
                <button class="btn danger" data-action="decline">Decline</button>
                <button class="btn primary" data-action="accept">Agree</button>
              ` : ""}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  // ✅ Bind click ONCE using delegation to the container
  if (!contractsClickBound) {
    contractsClickBound = true;

    container.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (!action) return;

      const card = (e.target as HTMLElement).closest(".contract-card") as HTMLElement | null;
      if (!card) return;

      const contractId = card.getAttribute("data-id");
      if (!contractId) return;

      const textarea = card.querySelector(".contract-text") as HTMLTextAreaElement | null;
      const text = textarea?.value || "";

      try {
        if (action === "copy") {
          await navigator.clipboard.writeText(text);
          btn.textContent = "✅ Copied";
          setTimeout(() => (btn.textContent = "📋 Copy"), 1000);
          return;
        }

        if (action === "download") {
          downloadText(`WeeLend-PaSwipe-Contract-${contractId}.txt`, text);
          return;
        }

        if (action === "accept") {
          btn.disabled = true;
          await updateDoc(doc(db, "paSwipeContracts", contractId), {
            status: "accepted",
            acceptedAt: serverTimestamp(),
          });

          // refresh view
          const root = document.getElementById("pa-swipe-contracts-root");
          if (root) await renderPaSwipeContractsPage(root);
          return;
        }

        if (action === "decline") {
          btn.disabled = true;
          await updateDoc(doc(db, "paSwipeContracts", contractId), {
            status: "declined",
          });

          const root = document.getElementById("pa-swipe-contracts-root");
          if (root) await renderPaSwipeContractsPage(root);
          return;
        }
      } catch (err: any) {
        console.error("Contract action error:", err);
        alert(err?.message || "Something went wrong.");
        btn.disabled = false;
      }
    });
  }
}