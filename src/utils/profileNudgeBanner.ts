// src/utils/profileNudgeBanner.ts
//
// Shown on Member/Borrower dashboards whenever a user's profile is missing
// their Emergency Contact and/or Identity Verification (selfie + gov ID).
// Non-blocking — it's a dismiss-free nudge banner with a button that sends
// them straight to Edit Profile, not a hard login gate.

import type { UserProfile } from "../type";

export interface ProfileCompletenessResult {
  missingEmergencyContact: boolean;
  missingIdentityVerification: boolean;
  isIncomplete: boolean;
}

export function checkProfileCompleteness(
  profile: UserProfile
): ProfileCompletenessResult {
  const ec = profile.emergencyContact;
  const missingEmergencyContact =
    !ec || !ec.name?.trim() || !ec.phone?.trim();

  const ivStatus = profile.identityVerification?.status;
  const missingIdentityVerification =
    !ivStatus || ivStatus === "not_started" || ivStatus === "rejected";

  return {
    missingEmergencyContact,
    missingIdentityVerification,
    isIncomplete: missingEmergencyContact || missingIdentityVerification,
  };
}

const BANNER_ID = "profile-completion-nudge-banner";

/**
 * Renders (or removes) the nudge banner, inserted immediately after
 * `anchorAfterEl` (typically the dashboard's `.dp-header`).
 */
export function renderProfileCompletionBanner(
  anchorAfterEl: HTMLElement | null,
  profile: UserProfile,
  onGoToProfile: () => void
) {
  const existing = document.getElementById(BANNER_ID);

  const { isIncomplete, missingEmergencyContact, missingIdentityVerification } =
    checkProfileCompleteness(profile);

  if (!isIncomplete) {
    existing?.remove();
    return;
  }

  if (existing) {
    // Already showing — just keep the click handler fresh.
    const btn = existing.querySelector("button");
    if (btn) (btn as HTMLButtonElement).onclick = onGoToProfile;
    return;
  }

  if (!anchorAfterEl) return;

  const missingParts: string[] = [];
  if (missingEmergencyContact) missingParts.push("emergency contact info");
  if (missingIdentityVerification) missingParts.push("ID verification (selfie + government ID)");

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    "background:#fff3cd;border:1px solid #ffe58f;border-radius:12px;" +
    "padding:14px 16px;margin:0 0 16px 0;display:flex;align-items:center;" +
    "justify-content:space-between;gap:12px;flex-wrap:wrap;";

  const textWrap = document.createElement("div");
  textWrap.style.cssText = "flex:1;min-width:200px;";
  textWrap.innerHTML = `
    <strong style="color:#7a5b00;">⚠️ Please complete your profile</strong>
    <p style="margin:4px 0 0 0;color:#7a5b00;font-size:13px;">
      We're missing your ${missingParts.join(" and ")}. Loans, MLF Easy Installment,
      Marimar's Credit Cart, and Pa-benta requests all require this before they can be approved.
    </p>
  `;

  const btn = document.createElement("button");
  btn.textContent = "Update Profile";
  btn.type = "button";
  btn.className = "request-loan-btn";
  btn.style.flexShrink = "0";
  btn.onclick = onGoToProfile;

  banner.appendChild(textWrap);
  banner.appendChild(btn);

  anchorAfterEl.insertAdjacentElement("afterend", banner);
}
