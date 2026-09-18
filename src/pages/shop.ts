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
import { calcPaSwipePricing, TERM_OPTIONS, DEFAULT_DOWNPAYMENT_RATE } from "../utils/paSwipeCalc";
import { createPaSwipeRequest } from "../services/paSwipeRequestService";

let unsubscribePaSwipe: (() => void) | null = null;

export function initShopPage() {
  const paSwipe = document.getElementById("shop-card-pa-swipe");
  const paBenta = document.getElementById("shop-card-pa-benta");
  const grocery = document.getElementById("shop-card-grocery");
  const backBtn = document.getElementById("shop-back-btn");

  paSwipe?.addEventListener("click", () => {
    showPage("page-pa-swipe");
    loadPaSwipeProducts();
  });
  paBenta?.addEventListener("click", () => showPage("page-marketplace"));
  grocery?.addEventListener("click", () => showPage("page-grocery"));

  backBtn?.addEventListener("click", () => {
    showPage("page-dashboard-member"); // we'll make role-aware later
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

  const root = container;

  // Persist term selection per product while this page is open
  const termById: Record<string, number> = {};

  function getSelectedTerm(id: string) {
    return termById[id] ?? 12;
  }
  function setSelectedTerm(id: string, term: number) {
    termById[id] = term;
  }

  const q = query(
    collection(db, "paSwipeProducts"),
    where("isActive", "==", true),
    where("stockStatus", "==", "in_stock"),
    orderBy("createdAt", "desc")
  );

  if (unsubscribePaSwipe) unsubscribePaSwipe();

  let searchTerm = "";

  unsubscribePaSwipe = onSnapshot(q, (snap) => {
    if (snap.empty) {
      root.innerHTML = `<p style="opacity:.8;">No items available right now.</p>`;
      return;
    }

    const products = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    function render() {
      const filtered = searchTerm
        ? products.filter((p) => (p.title || "").toLowerCase().includes(searchTerm))
        : products;

      const searchBarHtml = `
        <input id="pa-swipe-search" type="text" placeholder="🔍 Search items..." value="${searchTerm}" style="margin-bottom:14px;" />
      `;

      if (filtered.length === 0) {
        root.innerHTML = searchBarHtml + `<p style="opacity:.8;">No items match your search.</p>`;
        bindSearchInput();
        return;
      }

      root.innerHTML = searchBarHtml + filtered
        .map((p) => {
          const srp = Number(p.srp ?? 0);
          const term = getSelectedTerm(p.id);
          const downpaymentRate = Number(p.downpaymentRate ?? DEFAULT_DOWNPAYMENT_RATE);

          const pricing = calcPaSwipePricing({ srp, termMonths: term, downpaymentRate });

          return `
            <div class="card" style="margin-bottom:12px;">
              <div style="display:flex; gap:12px; align-items:center;">
                <img class="lightbox-img" src="${p.imageUrl}" style="width:84px; height:84px; object-fit:cover; border-radius:12px;" />
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

                  <div style="display:flex; gap:10px; align-items:center; margin-top:10px;">
                    <select data-term="${p.id}" style="padding:8px; border-radius:10px;">
                      ${TERM_OPTIONS.map(
                        (t) =>
                          `<option value="${t}" ${
                            Number(t) === Number(term) ? "selected" : ""
                          }>${t} months</option>`
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

      bindSearchInput();

      // Term change
      root.querySelectorAll("select[data-term]").forEach((el) => {
        el.addEventListener("change", () => {
          const sel = el as HTMLSelectElement;
          const id = sel.dataset.term!;
          const term = Number(sel.value);
          setSelectedTerm(id, term);
          render();
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

          btn.disabled = true;
          btn.textContent = "Submitting...";

          try {
            const profileSnap = await getDoc(doc(db, "users", user.uid));
            const role = (profileSnap.data()?.role ?? "member") as "member" | "borrower";

            await createPaSwipeRequest({
              userId: user.uid,
              userRole: role,
              product: {
                id: product.id,
                title: product.title,
                category: product.category,
                imageUrl: product.imageUrl,
                srp: Number(product.srp ?? 0),
                downpaymentRate: Number(product.downpaymentRate ?? DEFAULT_DOWNPAYMENT_RATE),
              },
              termMonths: term,
            });

            if (msgEl) {
              msgEl.style.color = "green";
              msgEl.textContent = "✅ Request submitted. Waiting for admin approval.";
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

    function bindSearchInput() {
      const searchInput = root.querySelector("#pa-swipe-search") as HTMLInputElement | null;
      if (!searchInput) return;

      searchInput.addEventListener("input", () => {
        searchTerm = searchInput.value.trim().toLowerCase();
        const cursorPos = searchInput.selectionStart;
        render();
        // restore focus + cursor position after re-render
        const newInput = root.querySelector("#pa-swipe-search") as HTMLInputElement | null;
        newInput?.focus();
        newInput?.setSelectionRange(cursorPos, cursorPos);
      });
    }

    render();
  });
}