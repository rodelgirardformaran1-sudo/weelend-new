// src/pages/affiliateEntry.ts
//
// Wires the "🤝 Affiliate Program" entry points on both the member and
// borrower dashboards into the shared page-affiliate section.
//
// Call initAffiliateEntryPoints() once at app startup (same place
// initShopPage() is called from), e.g. in main.ts.

import { auth } from "../firebaseConfig";
import { showPage } from "../main";
import { initAffiliateDashboard } from "./affiliateDashboard";

let lastOpenedFrom: "member" | "borrower" = "member";
let bound = false;

export function initAffiliateEntryPoints() {
  if (bound) return;
  bound = true;

  const openFrom = (role: "member" | "borrower") => {
    const user = auth.currentUser;
    if (!user) return;

    lastOpenedFrom = role;
    showPage("page-affiliate");

    const root = document.getElementById("affiliate-dashboard-root");
    if (root) initAffiliateDashboard(root, user.uid);
  };

  document
    .getElementById("member-affiliate-btn")
    ?.addEventListener("click", () => openFrom("member"));

  document
    .getElementById("borrower-affiliate-btn")
    ?.addEventListener("click", () => openFrom("borrower"));

  document
    .getElementById("affiliate-back-btn")
    ?.addEventListener("click", () => {
      showPage(lastOpenedFrom === "borrower" ? "page-dashboard-borrower" : "page-dashboard-member");
    });
}