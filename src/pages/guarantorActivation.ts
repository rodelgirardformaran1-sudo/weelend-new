// src/pages/guarantorActivation.ts
//
// Landing page for a security guarantor invite link
// (?guarantorInvite=<inviteId>). Two steps, both on the same page:
//   1) Create their own account (name/phone come from what the borrower
//      entered; they only choose a password) — skipped if they're
//      already logged in and linked to this invite.
//   2) Complete identity verification (selfie, selfie-holding-ID, gov ID
//      upload) the same way a member does on their own profile, but the
//      photos are attached to the INVITE, not a UserProfile.
//
// Call initGuarantorEntryPoint() once at app startup (main.ts) to detect
// the ?guarantorInvite= URL param. main.ts's auth-state routing should
// check hasPendingGuarantorInvite() / getPendingGuarantorInviteId() and
// route to this page instead of the normal login/dashboard flow whenever
// one is present.

import { auth } from "../firebaseConfig";
import { showPage } from "../main";
import { logout } from "../services/authService";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { registerSecurityGuarantor } from "../services/authService";
import {
  getGuarantorInvite,
  claimGuarantorInvite,
  submitGuarantorVerification,
  getInvitesLinkedToGuarantor,
  describeGuarantorStatus,
} from "../services/securityGuarantorService";
import {
  captureLivePhoto,
  CameraCaptureCancelledError,
  CameraUnavailableError,
} from "../utils/cameraCapture";
import type { SecurityGuarantorInvite } from "../type";
import type { User } from "firebase/auth";

const storage = getStorage();
let pendingInviteId: string | null = null;

// =======================================================
// 🔗 URL ENTRY POINT
// =======================================================
export function initGuarantorEntryPoint() {
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get("guarantorInvite");
  pendingInviteId = inviteId && inviteId.trim().length > 0 ? inviteId.trim() : null;
}

export function hasPendingGuarantorInvite(): boolean {
  return !!pendingInviteId;
}

export function getPendingGuarantorInviteId(): string | null {
  return pendingInviteId;
}

/** Clears the pending invite once fully handled (so a later normal login isn't re-routed here). */
export function clearPendingGuarantorInvite() {
  pendingInviteId = null;
}

// =======================================================
// 🪪 PAGE LOGIC
// =======================================================
export async function initGuarantorActivationPage(user: User | null) {
  const container = document.getElementById("guarantor-activate-root");
  if (!container || !pendingInviteId) return;

  showPage("page-guarantor-activate");
  container.innerHTML = `<p>Loading invite...</p>`;

  const invite = await getGuarantorInvite(pendingInviteId);

  if (!invite) {
    container.innerHTML = `<p>❌ This invite link is invalid or has expired.</p>`;
    return;
  }

  if (invite.status === "verified") {
    container.innerHTML = `
      <p>✅ You're already verified as the security guarantor for this request.</p>
      <p>You can close this page.</p>
    `;
    return;
  }

  // Already logged in and linked to this invite -> skip straight to verification.
  if (user && invite.linkedUid === user.uid) {
    renderVerificationStep(container, invite);
    return;
  }

  // Someone is logged in, but it's not this invite's guarantor.
  if (user && invite.linkedUid && invite.linkedUid !== user.uid) {
    container.innerHTML = `
      <p>⚠️ You're signed in as a different account than this invite is for.</p>
      <p>Please log out and open this link again, or ask for a new invite.</p>
    `;
    return;
  }

  renderAccountStep(container, invite);
}

// -------------------------------------------------------
// STEP 1 — Create account
// -------------------------------------------------------
function renderAccountStep(container: HTMLElement, invite: SecurityGuarantorInvite) {
  container.innerHTML = `
    <div class="profile-card">
      <h2>🛡️ Security Guarantor Invite</h2>
      <p>You've been named as a security guarantor by a WeeLend member/borrower.</p>

      <div class="modal-form-group">
        <label>Name</label>
        <input value="${invite.guarantorName}" disabled />
      </div>
      <div class="modal-form-group">
        <label>Email</label>
        <input value="${invite.guarantorEmail}" disabled />
      </div>
      <div class="modal-form-group">
        <label>Relationship to requester</label>
        <input value="${invite.guarantorRelationship}" disabled />
      </div>

      <p>Create a password to set up your account:</p>

      <div class="modal-form-group">
        <label>Password</label>
        <input type="password" id="guarantor-signup-password" />
      </div>
      <div class="modal-form-group">
        <label>Confirm Password</label>
        <input type="password" id="guarantor-signup-password-confirm" />
      </div>

      <button type="button" id="guarantor-signup-btn">Create Account & Continue</button>
      <p id="guarantor-signup-message"></p>
    </div>
  `;

  const passInput = document.getElementById("guarantor-signup-password") as HTMLInputElement;
  const confirmInput = document.getElementById("guarantor-signup-password-confirm") as HTMLInputElement;
  const btn = document.getElementById("guarantor-signup-btn") as HTMLButtonElement;
  const msg = document.getElementById("guarantor-signup-message") as HTMLElement;

  btn.addEventListener("click", async () => {
    const password = passInput.value;
    const confirm = confirmInput.value;

    if (password.length < 6) {
      msg.textContent = "⚠️ Password must be at least 6 characters.";
      msg.style.color = "red";
      return;
    }
    if (password !== confirm) {
      msg.textContent = "⚠️ Passwords don't match.";
      msg.style.color = "red";
      return;
    }

    btn.disabled = true;
    msg.textContent = "⏳ Creating your account...";
    msg.style.color = "";

    try {
      const user = await registerSecurityGuarantor(
        invite.guarantorEmail,
        password,
        invite.guarantorName,
        invite.guarantorPhone
      );
      await claimGuarantorInvite(invite.id, user.uid);

      const refreshed = await getGuarantorInvite(invite.id);
      renderVerificationStep(container, refreshed ?? { ...invite, linkedUid: user.uid, status: "account_created" });
    } catch (err: any) {
      console.error(err);
      msg.textContent = err.message || "❌ Couldn't create account.";
      msg.style.color = "red";
      btn.disabled = false;
    }
  });
}

// -------------------------------------------------------
// STEP 2 — Identity verification
// -------------------------------------------------------
function renderVerificationStep(container: HTMLElement, invite: SecurityGuarantorInvite) {
  const status = invite.identityVerification?.status ?? "not_started";

  if (status === "pending_review") {
    container.innerHTML = `
      <div class="profile-card">
        <h2>🛡️ Verification Submitted</h2>
        <p>⏳ Thanks — your verification is waiting for admin review. You can close this page.</p>
      </div>
    `;
    return;
  }

  const rejectionNote =
    status === "rejected" && invite.identityVerification?.rejectionReason
      ? `<p style="color:#ff6b6b;">Previous submission was rejected: ${invite.identityVerification.rejectionReason}. Please retake all three and resubmit.</p>`
      : "";

  container.innerHTML = `
    <div class="profile-card">
      <h2>🛡️ Identity Verification</h2>
      <p>As a security guarantor, please complete these three steps.</p>
      ${rejectionNote}

      <div id="guarantor-verify-form" class="verification-thumbs">
        <div class="verification-thumb-slot">
          <img id="guarantor-verify-selfie-thumb" class="verification-thumb" style="display:none;" />
          <button type="button" id="guarantor-verify-selfie-btn" class="verify-capture-btn">📸 Take Selfie</button>
        </div>
        <div class="verification-thumb-slot">
          <img id="guarantor-verify-selfie-id-thumb" class="verification-thumb" style="display:none;" />
          <button type="button" id="guarantor-verify-selfie-id-btn" class="verify-capture-btn">🪪 Selfie Holding ID</button>
        </div>
        <div class="verification-thumb-slot">
          <img id="guarantor-verify-govid-thumb" class="verification-thumb" style="display:none;" />
          <label for="guarantor-verify-govid-input" class="verify-capture-btn">🗂 Upload Gov ID</label>
          <input type="file" id="guarantor-verify-govid-input" accept="image/*,.pdf" hidden />
        </div>
      </div>

      <button type="button" id="guarantor-verify-submit-btn" class="verify-submit-btn">Submit for Verification</button>
      <p id="guarantor-verify-message"></p>
    </div>
  `;

  let selfieFile: File | null = null;
  let selfieIdFile: File | null = null;
  let govIdFile: File | null = null;

  const selfieBtn = document.getElementById("guarantor-verify-selfie-btn") as HTMLButtonElement;
  const selfieThumb = document.getElementById("guarantor-verify-selfie-thumb") as HTMLImageElement;
  const selfieIdBtn = document.getElementById("guarantor-verify-selfie-id-btn") as HTMLButtonElement;
  const selfieIdThumb = document.getElementById("guarantor-verify-selfie-id-thumb") as HTMLImageElement;
  const govIdInput = document.getElementById("guarantor-verify-govid-input") as HTMLInputElement;
  const govIdThumb = document.getElementById("guarantor-verify-govid-thumb") as HTMLImageElement;
  const submitBtn = document.getElementById("guarantor-verify-submit-btn") as HTMLButtonElement;
  const msg = document.getElementById("guarantor-verify-message") as HTMLElement;

  selfieBtn.addEventListener("click", async () => {
    try {
      const file = await captureLivePhoto({
        title: "Take a selfie",
        instructions: "Look straight at the camera in good lighting.",
        fileNamePrefix: "guarantor_selfie",
      });
      selfieFile = file;
      selfieThumb.src = URL.createObjectURL(file);
      selfieThumb.style.display = "block";
      selfieBtn.textContent = "🔁 Retake Selfie";
    } catch (err) {
      if (!(err instanceof CameraCaptureCancelledError)) {
        msg.textContent = err instanceof CameraUnavailableError ? err.message : "❌ Couldn't capture selfie.";
        msg.style.color = "red";
      }
    }
  });

  selfieIdBtn.addEventListener("click", async () => {
    try {
      const file = await captureLivePhoto({
        title: "Selfie holding your ID",
        instructions: "Hold your government ID next to your face, both clearly visible.",
        fileNamePrefix: "guarantor_selfie_with_id",
      });
      selfieIdFile = file;
      selfieIdThumb.src = URL.createObjectURL(file);
      selfieIdThumb.style.display = "block";
      selfieIdBtn.textContent = "🔁 Retake";
    } catch (err) {
      if (!(err instanceof CameraCaptureCancelledError)) {
        msg.textContent = err instanceof CameraUnavailableError ? err.message : "❌ Couldn't capture selfie-with-ID.";
        msg.style.color = "red";
      }
    }
  });

  govIdInput.addEventListener("change", () => {
    govIdFile = govIdInput.files?.[0] ?? null;
    if (govIdFile) {
      govIdThumb.src = URL.createObjectURL(govIdFile);
      govIdThumb.style.display = "block";
    }
  });

  submitBtn.addEventListener("click", async () => {
    if (!selfieFile || !selfieIdFile || !govIdFile) {
      msg.textContent = "⚠️ Please complete all three steps.";
      msg.style.color = "red";
      return;
    }

    submitBtn.disabled = true;
    msg.textContent = "⏳ Uploading...";
    msg.style.color = "";

    try {
      const uid = auth.currentUser!.uid;
      const stamp = Date.now();

      const selfieRef = ref(storage, `securityGuarantorVerification/${invite.id}/selfie_${stamp}.jpg`);
      await uploadBytes(selfieRef, selfieFile);
      const selfieUrl = await getDownloadURL(selfieRef);

      const selfieIdRef = ref(storage, `securityGuarantorVerification/${invite.id}/selfie_with_id_${stamp}.jpg`);
      await uploadBytes(selfieIdRef, selfieIdFile);
      const selfieWithIdUrl = await getDownloadURL(selfieIdRef);

      const govIdRef = ref(
        storage,
        `securityGuarantorVerification/${invite.id}/gov_id_${stamp}_${govIdFile.name}`
      );
      await uploadBytes(govIdRef, govIdFile);
      const govIdFrontUrl = await getDownloadURL(govIdRef);

      await submitGuarantorVerification(invite.id, { selfieUrl, selfieWithIdUrl, govIdFrontUrl });

      msg.textContent = "✅ Submitted! Waiting for admin review. You can close this page.";
      msg.style.color = "green";
      void uid;
    } catch (err: any) {
      console.error(err);
      msg.textContent = err.message || "❌ Failed to submit verification.";
      msg.style.color = "red";
      submitBtn.disabled = false;
    }
  });
}

// =======================================================
// 🏠 GUARANTOR HOME — landing page for a normal (non-invite-link) login
// =======================================================
// A security_guarantor account isn't a member or borrower, so it has no
// dashboard of its own — main.ts routes here instead whenever one of
// these accounts logs in directly (not via a ?guarantorInvite= link).
// Shows their verification status across every request they've been
// named on, plus a CTA to become a full coop member/borrower — since
// every guarantor is already a warm lead for the coop itself.
export async function initGuarantorHomePage(user: User) {
  const container = document.getElementById("guarantor-home-root");
  if (!container) return;

  showPage("page-guarantor-home");
  container.innerHTML = `<p>Loading your status...</p>`;

  const invites = await getInvitesLinkedToGuarantor(user.uid);

  const invitesHtml = invites.length
    ? invites
        .map(
          (inv) => `
        <div class="card" style="margin-bottom:10px;">
          <p style="margin:0 0 4px 0;"><strong>Request:</strong> ${
            inv.requestType === "loan"
              ? "Coop Loan"
              : inv.requestType === "creditCart"
              ? "Marimar's Credit Cart"
              : "MLF Easy Installment"
          }</p>
          <p style="margin:0;">${describeGuarantorStatus(inv)}</p>
        </div>
      `
        )
        .join("")
    : `<p style="opacity:.8;">You're not currently linked to any active security guarantor request.</p>`;

  container.innerHTML = `
    <div class="profile-card">
      <h2>🛡️ Welcome, ${user.email ?? "Guarantor"}</h2>
      <p style="opacity:.85;">You're signed in as a Security Guarantor — a lightweight account, separate from WeeLend membership.</p>

      <h3 style="margin-top:18px;">Your Guarantor Status</h3>
      ${invitesHtml}

      <div class="card" style="margin-top:20px; background:#f7f2ff;">
        <h3 style="margin:0 0 6px 0;">🌱 Want to join WeeLend yourself?</h3>
        <p style="margin:0 0 12px 0;opacity:.85;">
          As a cooperative member or borrower, you can build savings, access loans,
          and use MLF Easy Installment and Marimar's Credit Cart directly.
        </p>
        <button type="button" id="guarantor-become-member-btn" class="request-loan-btn">
          Sign Up as a Member / Borrower
        </button>
      </div>

      <button type="button" id="guarantor-home-logout-btn" style="margin-top:20px;">Log Out</button>
    </div>
  `;

  document
    .getElementById("guarantor-become-member-btn")
    ?.addEventListener("click", async () => {
      // A security_guarantor account can't just be "upgraded" in place —
      // membership signup needs its own full form (shares, home address,
      // emergency contact, ID verification). Simplest, safest path: sign
      // them out of this lightweight account and send them to the normal
      // signup page, where they can register as a member/borrower.
      //
      // ⏱️ main.ts's onAuthStateChanged listener also reacts to this same
      // logout and will route to page-login on its own — that fires
      // asynchronously and can land AFTER this handler's own navigation,
      // silently overriding it back to the login page. A short delay lets
      // that automatic redirect finish first, so our page-register call
      // is the one that sticks.
      await logout();
      setTimeout(() => showPage("page-register"), 400);
    });

  document
    .getElementById("guarantor-home-logout-btn")
    ?.addEventListener("click", async () => {
      // No explicit navigation needed here — logging out triggers
      // main.ts's auth listener, which already routes to page-login
      // on its own (same pattern as the global logout button).
      await logout();
    });
}
