// src/pages/myAgreements.ts
//
// Borrower/member self-service "My Agreements" page — shows the exact
// agreement this person accepted (or was administratively backfilled
// with) for every WeeLend lending product they've used: Coop Loan, MLF
// Easy Installment, Marimar's Credit Cart. Complements "My Contracts"
// (the generated contract document) with the underlying proof-of-consent
// record itself — the same full block admin sees (version, terms, and
// the collapsible verbatim agreement text), since it's the person's own
// record about their own request.

import { auth, db } from "../firebaseConfig";
import { showPage } from "../main";
import { collection, query, where, getDocs } from "firebase/firestore";
import { renderAgreementAcceptanceHtml } from "../utils/agreementDisplay";
import {
  getInviteForRequest,
  describeGuarantorStatus,
  buildGuarantorActivationLink,
} from "../services/securityGuarantorService";

function peso(n: number | undefined) {
  const v = Number(n || 0);
  return `₱${v.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ✅ Public entry point for BOTH member and borrower dashboards
export async function initMyAgreementsPage() {
  showPage("page-my-agreements");

  const root = document.getElementById("my-agreements-root");
  if (!root) {
    console.warn("❌ my-agreements-root not found");
    return;
  }

  await renderMyAgreementsPage(root);
}

export async function renderMyAgreementsPage(container: HTMLElement) {
  container.innerHTML = `
    <h2>My Agreements</h2>
    <p class="muted">The exact terms you agreed to for every WeeLend request you've submitted — Coop Loan, MLF Easy Installment, and Marimar's Credit Cart.</p>

    <div id="agreements-state" class="muted">Loading...</div>
    <div id="agreements-list" class="contracts-list"></div>
  `;

  const user = auth.currentUser;
  const stateEl = container.querySelector("#agreements-state") as HTMLElement | null;
  const listEl = container.querySelector("#agreements-list") as HTMLElement | null;

  if (!stateEl || !listEl) return;

  if (!user) {
    stateEl.textContent = "You must be signed in.";
    return;
  }

  // Note: intentionally no orderBy() here — combining it with the userId
  // equality filter would require a new Firestore composite index on each
  // of these three collections. The three result sets are merged and
  // sorted client-side below instead, which needs no index at all.
  const [loanSnap, paSwipeSnap, creditCartSnap] = await Promise.all([
    getDocs(query(collection(db, "loanRequests"), where("userId", "==", user.uid))),
    getDocs(query(collection(db, "paSwipeRequests"), where("userId", "==", user.uid))),
    getDocs(query(collection(db, "creditCartRequests"), where("userId", "==", user.uid))),
  ]);

  type Row = {
    id: string;
    label: string;
    agreementAcceptance: any;
    createdAt: any;
    securityGuarantorInviteId?: string | null;
  };

  const rows: Row[] = [
    ...loanSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        label: `📜 Coop Loan — ${peso(data.amount)}`,
        agreementAcceptance: data.agreementAcceptance ?? null,
        createdAt: data.createdAt,
        securityGuarantorInviteId: data.securityGuarantorInviteId ?? null,
      };
    }),
    ...paSwipeSnap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        label: `📜 MLF Easy Installment — ${data.productSnapshot?.title || "Item"}`,
        agreementAcceptance: data.agreementAcceptance ?? null,
        createdAt: data.createdAt,
        securityGuarantorInviteId: data.securityGuarantorInviteId ?? null,
      };
    }),
    ...creditCartSnap.docs.map((d) => {
      const data = d.data() as any;
      const categoryLabel = data.category === "grocery" ? "Grocery Credit" : "Department Store Credit";
      return {
        id: d.id,
        label: `📜 Marimar's Credit Cart — ${categoryLabel}`,
        agreementAcceptance: data.agreementAcceptance ?? null,
        createdAt: data.createdAt,
        securityGuarantorInviteId: data.securityGuarantorInviteId ?? null,
      };
    }),
  ].sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));

  if (rows.length === 0) {
    stateEl.textContent = "No agreements found — you haven't submitted a loan, installment, or credit request yet.";
    return;
  }

  stateEl.textContent = "";

  // 🛡️ For any request that needed a security guarantor, fetch the
  // invite so we can show its activation link permanently here — this
  // was previously only ever shown once, in the submit success message,
  // and lost for good if the person navigated away or refreshed.
  const cards = await Promise.all(
    rows.map(async (r) => {
      let guarantorHtml = "";

      if (r.securityGuarantorInviteId) {
        try {
          const invite = await getInviteForRequest(r.id);
          if (invite) {
            guarantorHtml = `
              <div class="admin-guarantor-block" style="margin-top:10px; padding:10px 12px; border-radius:10px; background:#fff7f0; border:1px solid #f0c7a0;">
                <h4 style="margin:0 0 6px 0;">🛡️ Security Guarantor</h4>
                <p style="margin:0 0 6px 0;">${describeGuarantorStatus(invite)}</p>
                <p style="margin:0 0 6px 0;"><strong>${invite.guarantorName}</strong> (${invite.guarantorRelationship}) — ${invite.guarantorPhone}</p>
                <label style="font-size:12px; opacity:.7;">Share this link with your guarantor if they haven't verified yet:</label>
                <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
                  <input type="text" readonly value="${buildGuarantorActivationLink(invite.id)}" style="flex:1; font-size:12px; padding:4px 6px;" onclick="this.select()" />
                  <button type="button" onclick="navigator.clipboard.writeText('${buildGuarantorActivationLink(invite.id)}'); this.textContent='✅ Copied'; setTimeout(()=>this.textContent='📋 Copy',1500);">📋 Copy</button>
                </div>
              </div>
            `;
          }
        } catch (err) {
          console.error("❌ Failed fetching guarantor invite for", r.id, err);
        }
      }

      return `
        <div class="contract-card" data-id="${r.id}">
          <div class="contract-header">
            <div class="contract-left">
              <div style="width:100%;">
                <div class="contract-title">${r.label}</div>
                ${renderAgreementAcceptanceHtml(r.agreementAcceptance)}
                ${guarantorHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    })
  );

  listEl.innerHTML = cards.join("");
}
