// =======================================================
// SECURITY GUARANTOR INFO MODAL
// =======================================================
// Reusable prompt for collecting a security guarantor's info wherever a
// request crosses the ₱10,000 threshold (coop loans already have their
// own inline form on the loan request modal; this is for flows like
// MLF Easy Installment / Pa-benta where a per-item inline form isn't
// practical). Builds its own modal DOM on demand, like cameraCapture.ts.

import type { AddressInfo } from "../type";
import type { GuarantorInfoInput } from "../services/securityGuarantorService";

/**
 * Shows a modal asking for the security guarantor's details. Resolves
 * with the filled-in info, or null if the person cancels.
 *
 * @param currentUserEmail The requester's own email — used to block them
 * from naming themselves as their own security guarantor.
 */
export function promptForSecurityGuarantorInfo(
  currentUserEmail?: string | null
): Promise<GuarantorInfoInput | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal active";
    overlay.style.zIndex = "10500";
    overlay.innerHTML = `
      <div class="modal-content">
        <h3>🛡️ Security Guarantor Required</h3>
        <p class="verification-note">This request is over ₱10,000. Please provide a family member the coop can contact if it can't be repaid — ⚠️ must be a different person than yourself. They'll get a link to create their own account and verify their identity.</p>

        <div class="modal-form-group">
          <label>Full Name</label>
          <input type="text" id="gim-name" placeholder="Full Name" />
        </div>
        <div class="modal-form-group">
          <label>Relationship</label>
          <input type="text" id="gim-relationship" placeholder="e.g. Sibling, Parent" />
        </div>
        <div class="modal-form-group">
          <label>Mobile Number</label>
          <input type="tel" id="gim-phone" placeholder="Mobile Number" />
        </div>
        <div class="modal-form-group">
          <label>Email</label>
          <input type="email" id="gim-email" placeholder="Email" />
        </div>
        <div class="modal-form-group">
          <label>House/Unit No., Street, Purok/Sitio</label>
          <input type="text" id="gim-street" placeholder="Street" />
        </div>
        <div class="modal-form-group">
          <label>Barangay</label>
          <input type="text" id="gim-barangay" placeholder="Barangay" />
        </div>
        <div class="modal-form-group">
          <label>City / Municipality</label>
          <input type="text" id="gim-city" placeholder="City / Municipality" />
        </div>
        <div class="modal-form-group">
          <label>Province</label>
          <input type="text" id="gim-province" placeholder="Province" />
        </div>
        <div class="modal-form-group">
          <label>ZIP Code</label>
          <input type="text" id="gim-zip" placeholder="ZIP Code" inputmode="numeric" />
        </div>

        <p id="gim-error" style="color:#ff6b6b; display:none;"></p>

        <div class="camera-capture-actions">
          <button type="button" id="gim-cancel-btn">Cancel</button>
          <button type="button" id="gim-continue-btn">Continue</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const field = (id: string) => overlay.querySelector(`#${id}`) as HTMLInputElement;
    const errorEl = overlay.querySelector("#gim-error") as HTMLElement;

    function cleanup() {
      overlay.remove();
    }

    overlay.querySelector("#gim-cancel-btn")?.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });

    overlay.querySelector("#gim-continue-btn")?.addEventListener("click", () => {
      const name = field("gim-name").value.trim();
      const relationship = field("gim-relationship").value.trim();
      const phone = field("gim-phone").value.trim();
      const email = field("gim-email").value.trim();
      const street = field("gim-street").value.trim();
      const barangay = field("gim-barangay").value.trim();
      const city = field("gim-city").value.trim();
      const province = field("gim-province").value.trim();
      const zip = field("gim-zip").value.trim();

      if (!name || !relationship || !phone || !email || !street || !barangay || !city || !province || !zip) {
        errorEl.textContent = "⚠️ Please fill in all fields.";
        errorEl.style.display = "block";
        return;
      }

      if (currentUserEmail && email.toLowerCase() === currentUserEmail.toLowerCase()) {
        errorEl.textContent = "⚠️ The security guarantor must be a different person than yourself — a family member the coop can contact.";
        errorEl.style.display = "block";
        return;
      }

      const homeAddress: AddressInfo = { street, barangay, city, province, zip };
      cleanup();
      resolve({ name, relationship, phone, email, homeAddress });
    });
  });
}
