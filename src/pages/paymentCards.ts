// src/pages/paymentCards.ts

import { getPaymentMethods, type PaymentMethod } from "../services/paymentSettingsService";

export async function renderPaymentCards(container: HTMLElement) {
  const methods: PaymentMethod[] = await getPaymentMethods();

  if (!methods.length) {
    container.innerHTML += `<p>No payment methods configured.</p>`;
    return;
  }

  let html = `
    <h3>💳 Payment Options</h3>
    <div class="payment-cards-grid">
  `;

  methods.forEach((m, index) => {
function getLogo(method: any) {
  if (method.type === "gcash") return "/payment-logos/gcash.png";

  const bank = (method.bankName || "").toLowerCase();

  if (bank.includes("bdo")) return "/payment-logos/bdo.png";
  if (bank.includes("metro")) return "/payment-logos/metrobank.png";

  return "/payment-logos/bank.png"; // fallback
}

    html += `
      <div class="payment-card" data-index="${index}">
        <div class="payment-icon"><img src="${getLogo(m)}" alt="${m.label}" /></div>
        <div class="payment-label">${m.label}</div>
        <div class="payment-name">${m.name}</div>
        <div class="payment-number">${m.number}</div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML += html;

  // Click handler
  container.querySelectorAll(".payment-card").forEach((card) => {
    card.addEventListener("click", () => {
      const index = Number(card.getAttribute("data-index"));
      const method = methods[index];

      if (method.qrUrl) {
        window.open(method.qrUrl, "_blank");
      } else {
        alert(
          `Payment Info:\n\n${method.label}\n${method.name}\n${method.number}`
        );
      }
    });
  });
}
