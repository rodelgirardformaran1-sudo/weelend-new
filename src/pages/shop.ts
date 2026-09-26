import { showPage } from "../main";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "../firebaseConfig";
import {
  calcPaSwipePricing,
  TERM_OPTIONS,
  DOWNPAYMENT_OPTIONS,
  DEFAULT_DOWNPAYMENT_RATE,
} from "../utils/paSwipeCalc";
import { createPaSwipeRequest } from "../services/paSwipeRequestService";
import { initCreditCartPage } from "./creditCart";
import { loadPaBentaPage } from "./paBenta";
import { requiresSecurityGuarantor, buildGuarantorActivationLink } from "../services/securityGuarantorService";
import { promptForSecurityGuarantorInfo } from "../utils/guarantorInfoModal";
import { isUserIdentityVerified } from "../services/userService";
import { promptForAgreementAcceptance } from "../utils/loanAgreementModal";

let unsubscribePaSwipe: (() => void) | null = null;

const AFFILIATE_CODE_STORAGE_KEY = "mlf_affiliate_referral_code";

// ✅ Capture ?ref=CODE from a shared referral link and remember it
// for this browser, so it's applied automatically on any future request.
function captureReferralCodeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.trim()) {
      localStorage.setItem(AFFILIATE_CODE_STORAGE_KEY, ref.trim().toUpperCase());
    }
  } catch {
    // ignore (e.g. private browsing blocking storage)
  }
}

function getStoredReferralCode(): string {
  try {
    return localStorage.getItem(AFFILIATE_CODE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function setStoredReferralCode(code: string) {
  try {
    if (code.trim()) {
      localStorage.setItem(AFFILIATE_CODE_STORAGE_KEY, code.trim().toUpperCase());
    } else {
      localStorage.removeItem(AFFILIATE_CODE_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

export function initShopPage() {
  captureReferralCodeFromUrl();
  const paSwipe = document.getElementById("shop-card-pa-swipe");
  const paBenta = document.getElementById("shop-card-pa-benta");
  const grocery = document.getElementById("shop-card-grocery");
  const backBtn = document.getElementById("shop-back-btn");

  paSwipe?.addEventListener("click", () => {
  showPage("page-pa-swipe");
  loadPaSwipeProducts();
});
paBenta?.addEventListener("click", () => {
  showPage("page-marketplace");
  loadPaBentaPage();
});

grocery?.addEventListener("click", () => {
  showPage("page-grocery");
  initCreditCartPage();
});

  backBtn?.addEventListener("click", () => {
    showPage("page-dashboard-member"); // we’ll make role-aware later
  });

  document.getElementById("pa-swipe-back-btn")?.addEventListener("click", () => showPage("page-shop"));
  document.getElementById("marketplace-back-btn")?.addEventListener("click", () => showPage("page-shop"));
  document.getElementById("grocery-back-btn")?.addEventListener("click", () => showPage("page-shop"));
}

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function loadPaSwipeProducts() {
    console.log("🔥 loadPaSwipeProducts() running");
const container = document.getElementById("pa-swipe-content") as HTMLElement | null;
if (!container) return;

// ✅ from here on, TypeScript knows it's non-null
const root = container;

  // Persist term + downpayment selection per product while this page is open
  const termById: Record<string, number> = {};
  const downpaymentRateById: Record<string, number> = {};

  function getSelectedTerm(id: string) {
    return termById[id] ?? 12;
  }
  function setSelectedTerm(id: string, term: number) {
    termById[id] = term;
  }
  function getSelectedDownpaymentRate(id: string) {
    return downpaymentRateById[id] ?? DEFAULT_DOWNPAYMENT_RATE;
  }
  function setSelectedDownpaymentRate(id: string, rate: number) {
    downpaymentRateById[id] = rate;
  }

  const q = query(
    collection(db, "paSwipeProducts"),
    where("isActive", "==", true),
    where("stockStatus", "==", "in_stock"),
    orderBy("createdAt", "desc")
  );

  if (unsubscribePaSwipe) unsubscribePaSwipe();

unsubscribePaSwipe = onSnapshot(q, (snap) => {
    if (snap.empty) {
      root.innerHTML = `<p style="opacity:.8;">No items available right now.</p>`;
      return;
    }

    // Build product list with ids for button actions
    const products = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    function render() {
      const referralBanner = `
        <div class="card" style="margin-bottom:12px; padding:12px;">
          <label style="font-weight:600; display:block; margin-bottom:6px;">
            🤝 Referral Code <span style="font-weight:400; opacity:.7;">(optional)</span>
          </label>
          <input
            id="pa-swipe-referral-code"
            type="text"
            placeholder="e.g., MLF-7K2Q9X"
            value="${getStoredReferralCode()}"
            style="padding:8px; border-radius:10px; width:220px; text-transform:uppercase;"
          />
          <small style="display:block; opacity:.7; margin-top:4px;">
            Were you referred by a WeeLend affiliate? Enter their code here.
          </small>
        </div>
      `;

      root.innerHTML = referralBanner + products
        .map((p) => {
          const srp = Number(p.srp ?? 0);
          const term = getSelectedTerm(p.id);
          const downpaymentRate = getSelectedDownpaymentRate(p.id);

          const pricing = calcPaSwipePricing({
            srp,
            termMonths: term,
            downpaymentRate,
          });

          return `
            <div class="card" style="margin-bottom:12px;">
              <div style="display:flex; gap:12px; align-items:center;">
                <img src="${p.imageUrl}" style="width:84px; height:84px; object-fit:cover; border-radius:12px;" />
                <div style="flex:1;">
                  <div style="font-weight:800;">${p.title}</div>
                  <div style="opacity:.8; font-size:13px;">Category: ${p.category}</div>

                  <div style="margin-top:6px; line-height:1.6;">
                    <div>SRP: <strong>${peso(srp)}</strong></div>
                    <div>Downpayment (${(pricing.downpaymentRate * 100).toFixed(0)}%): <strong>${peso(pricing.downpayment)}</strong></div>
                    <div>Interest Rate: <strong>${(pricing.interestRate * 100).toFixed(0)}%</strong></div>
                    <div>Interest Amount: <strong>${peso(pricing.interest)}</strong></div>
                    <div>Remaining Balance: <strong>${peso(pricing.remainingBalance)}</strong></div>
                    <div>Semi-Monthly Installment: <strong>${peso(pricing.installmentAmount)}</strong> (${pricing.installmentCount} payments)</div>
                  </div>

                  <div style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap;">
                    <select data-term="${p.id}" style="padding:8px; border-radius:10px;">
                      ${TERM_OPTIONS.map(
                        (t) =>
                          `<option value="${t}" ${
                            Number(t) === Number(term) ? "selected" : ""
                          }>${t} months</option>`
                      ).join("")}
                    </select>

                    <select data-downpayment="${p.id}" style="padding:8px; border-radius:10px;">
                      ${DOWNPAYMENT_OPTIONS.map(
                        (r) =>
                          `<option value="${r}" ${
                            Number(r) === Number(downpaymentRate) ? "selected" : ""
                          }>${(r * 100).toFixed(0)}% downpayment</option>`
                      ).join("")}
                    </select>

                    <button class="request-loan-btn" data-request="${p.id}">
                      🧾 Request
                    </button>
                  </div>

                  <p data-msg="${p.id}" style="margin-top:8px; font-size:13px;"></p>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      // Persist referral code as the buyer types it
      const referralInput = root.querySelector("#pa-swipe-referral-code") as HTMLInputElement | null;
      referralInput?.addEventListener("change", () => {
        setStoredReferralCode(referralInput.value);
      });

      // Term change
      root.querySelectorAll("select[data-term]").forEach((el) => {
        el.addEventListener("change", () => {
          const sel = el as HTMLSelectElement;
          const id = sel.dataset.term!;
          const term = Number(sel.value);
          setSelectedTerm(id, term);
          render(); // re-render to update pricing display
        });
      });

      // Downpayment rate change
      root.querySelectorAll("select[data-downpayment]").forEach((el) => {
        el.addEventListener("change", () => {
          const sel = el as HTMLSelectElement;
          const id = sel.dataset.downpayment!;
          const rate = Number(sel.value);
          setSelectedDownpaymentRate(id, rate);
          render(); // re-render to update pricing display
        });
      });

      // Request button
      root.querySelectorAll("button[data-request]").forEach((el) => {
        el.addEventListener("click", async () => {
          const btn = el as HTMLButtonElement;
          const id = btn.dataset.request!;
          const product = products.find((x) => x.id === id);
          if (!product) return;

          const msgEl = root.querySelector(`[data-msg="${id}"]`) as HTMLElement | null;

          const user = auth.currentUser;
          if (!user) {
            if (msgEl) {
              msgEl.style.color = "red";
              msgEl.textContent = "Please sign in to request this item.";
            }
            return;
          }

          const term = getSelectedTerm(id) as 3 | 6 | 9 | 12;
          const downpaymentRate = getSelectedDownpaymentRate(id);

          // 🪪 Require an admin-approved identity verification before a
          // purchase request can even be submitted.
          if (!(await isUserIdentityVerified(user.uid))) {
            if (msgEl) {
              msgEl.style.color = "red";
              msgEl.textContent = "⚠️ Please complete your Identity Verification in Edit Profile (and wait for admin approval) before requesting this item.";
            }
            return;
          }

          btn.disabled = true;
          btn.textContent = "Submitting...";

          try {
            // Pull role from user profile doc (keeps shop.ts simple)
            const profileSnap = await getDoc(doc(db, "users", user.uid));
            const role = (profileSnap.data()?.role ?? "member") as "member" | "borrower";

            const referralInputEl = root.querySelector("#pa-swipe-referral-code") as HTMLInputElement | null;
            const affiliateCode = referralInputEl?.value.trim() || getStoredReferralCode();

            // 🛡️ Security guarantor required over ₱10,000
            const srp = Number(product.srp ?? 0);
            let securityGuarantorInfo = undefined;

            if (requiresSecurityGuarantor(srp)) {
              const info = await promptForSecurityGuarantorInfo(user.email);
              if (!info) {
                // Cancelled — leave the button re-enabled, don't submit.
                btn.disabled = false;
                btn.textContent = "🧾 Request";
                return;
              }
              securityGuarantorInfo = info;
            }

            // 📄 Loan agreement — required proof of acceptance before any
            // MLF Easy Installment request is submitted.
            const pricingForAgreement = calcPaSwipePricing({
              srp,
              termMonths: term,
              downpaymentRate,
            });

            const agreementSummaryHtml = `
              <ul>
                <li><strong>Item:</strong> ${product.title}</li>
                <li><strong>SRP:</strong> ${peso(srp)}</li>
                <li><strong>Downpayment (${(pricingForAgreement.downpaymentRate * 100).toFixed(0)}%):</strong> ${peso(pricingForAgreement.downpayment)}</li>
                <li><strong>Interest Rate:</strong> ${(pricingForAgreement.interestRate * 100).toFixed(0)}%</li>
                <li><strong>Interest Amount:</strong> ${peso(pricingForAgreement.interest)}</li>
                <li><strong>Remaining Balance:</strong> ${peso(pricingForAgreement.remainingBalance)}</li>
                <li><strong>Semi-Monthly Installment:</strong> ${peso(pricingForAgreement.installmentAmount)} (${pricingForAgreement.installmentCount} payments)</li>
              </ul>
            `;

            const agreementAcceptance = await promptForAgreementAcceptance(
              "easyInstallment",
              "MLF Easy Installment Agreement",
              agreementSummaryHtml,
              {
                productTitle: product.title,
                srp,
                termMonths: term,
                downpaymentRate: pricingForAgreement.downpaymentRate,
                downpayment: pricingForAgreement.downpayment,
                interestRate: pricingForAgreement.interestRate,
                interestAmount: pricingForAgreement.interest,
                remainingBalance: pricingForAgreement.remainingBalance,
                installmentAmount: pricingForAgreement.installmentAmount,
                installmentCount: pricingForAgreement.installmentCount,
              }
            );

            if (!agreementAcceptance) {
              // Cancelled — leave the button re-enabled, don't submit.
              btn.disabled = false;
              btn.textContent = "🧾 Request";
              return;
            }

            const { securityGuarantorInviteId } = await createPaSwipeRequest({
              userId: user.uid,
              userRole: role,
              product: {
                id: product.id,
                title: product.title,
                category: product.category,
                imageUrl: product.imageUrl,
                srp,
                downpaymentRate,
              },
              termMonths: term,
              affiliateCode,
              securityGuarantorInfo,
              agreementAcceptance,
            });

            if (msgEl) {
              msgEl.style.color = "green";
              msgEl.textContent = securityGuarantorInviteId
                ? `✅ Request submitted. Share this link with your security guarantor so they can verify: ${buildGuarantorActivationLink(securityGuarantorInviteId)}`
                : "✅ Request submitted. Waiting for admin approval.";
            }
          } catch (err: any) {
            console.error(err);
            if (msgEl) {
              msgEl.style.color = "red";
              msgEl.textContent = err?.message || "Failed to submit request.";
            }
          } finally {
            btn.disabled = false;
            btn.textContent = "🧾 Request";
          }
        });
      });
    }

    render();
  });
}