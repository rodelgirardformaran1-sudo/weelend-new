import { auth } from "../firebaseConfig";
import { getUserProfile } from "../services/userService";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { saveTheme } from "../services/themeService";
import {
  captureLivePhoto,
  CameraCaptureCancelledError,
  CameraUnavailableError,
} from "../utils/cameraCapture";
import type { IdentityVerification, VerificationStatus } from "../type";
import type { User } from "firebase/auth";

const storage = getStorage();

export async function initEditProfile(role: "member" | "borrower") {
  const user = auth.currentUser;
  if (!user) return;

  const isMember = role === "member";

  // ----------------------------
  // SELECTORS
  // ----------------------------
  const img = document.getElementById(
    isMember ? "member-profile-img" : "borrower-profile-img"
  ) as HTMLImageElement;

  const fileInput = document.getElementById(
    isMember ? "member-profile-image-input" : "borrower-profile-image-input"
  ) as HTMLInputElement;

  const nameInput = document.getElementById(
    isMember ? "member-profile-fullname" : "borrower-profile-fullname"
  ) as HTMLInputElement;

  const emailInput = document.getElementById(
    isMember ? "member-profile-email" : "borrower-profile-email"
  ) as HTMLInputElement;

  const phoneInput = document.getElementById(
    isMember ? "member-profile-contact" : "borrower-profile-contact"
  ) as HTMLInputElement;

  // 🏠 Home Address (editable)
  const homeStreetInput = document.getElementById(
    isMember ? "member-profile-home-street" : "borrower-profile-home-street"
  ) as HTMLInputElement | null;
  const homeBarangayInput = document.getElementById(
    isMember ? "member-profile-home-barangay" : "borrower-profile-home-barangay"
  ) as HTMLInputElement | null;
  const homeCityInput = document.getElementById(
    isMember ? "member-profile-home-city" : "borrower-profile-home-city"
  ) as HTMLInputElement | null;
  const homeProvinceInput = document.getElementById(
    isMember ? "member-profile-home-province" : "borrower-profile-home-province"
  ) as HTMLInputElement | null;
  const homeZipInput = document.getElementById(
    isMember ? "member-profile-home-zip" : "borrower-profile-home-zip"
  ) as HTMLInputElement | null;

  // 🚨 Emergency Contact (editable)
  const emergencyNameInput = document.getElementById(
    isMember ? "member-profile-emergency-name" : "borrower-profile-emergency-name"
  ) as HTMLInputElement | null;
  const emergencyRelationshipInput = document.getElementById(
    isMember
      ? "member-profile-emergency-relationship"
      : "borrower-profile-emergency-relationship"
  ) as HTMLInputElement | null;
  const emergencyPhoneInput = document.getElementById(
    isMember ? "member-profile-emergency-phone" : "borrower-profile-emergency-phone"
  ) as HTMLInputElement | null;

  const saveBtn = document.getElementById(
    isMember ? "member-profile-save-btn" : "borrower-profile-save-btn"
  ) as HTMLButtonElement;

  const msg = document.getElementById(
    isMember ? "member-profile-message" : "borrower-profile-message"
  ) as HTMLElement;

  // Password elements
  const currentPassInput = document.getElementById(
    isMember ? "member-current-password" : "borrower-current-password"
  ) as HTMLInputElement;

  const newPassInput = document.getElementById(
    isMember ? "member-new-password" : "borrower-new-password"
  ) as HTMLInputElement;

  const changePassBtn = document.getElementById(
    isMember ? "member-change-password-btn" : "borrower-change-password-btn"
  ) as HTMLButtonElement;

  const passMsg = document.getElementById(
    isMember ? "member-password-message" : "borrower-password-message"
  ) as HTMLElement;

  const toggleCurrentBtn = document.getElementById(
    isMember
      ? "toggle-member-current-password"
      : "toggle-borrower-current-password"
  );

  const toggleNewBtn = document.getElementById(
    isMember ? "toggle-member-new-password" : "toggle-borrower-new-password"
  );

  if (!img || !fileInput || !saveBtn || !msg) return;

  // ----------------------------
  // LOAD PROFILE
  // ----------------------------
  const profile = await getUserProfile(user.uid);
  if (!profile) return;

  if (profile.theme) {
  document.documentElement.setAttribute("data-theme", profile.theme);
}

  nameInput.value = `${profile.firstName ?? ""} ${profile.middleName ? profile.middleName + " " : ""}${profile.lastName ?? ""}`.trim();
  emailInput.value = user.email || "";
  phoneInput.value = profile.phoneNumber || "";
  img.src = profile.photoURL || "/default-avatar.png";

  // 🏠 Home Address (editable, pre-filled from Firestore if present)
  const home = profile.homeAddress;
  if (homeStreetInput) homeStreetInput.value = home?.street || "";
  if (homeBarangayInput) homeBarangayInput.value = home?.barangay || "";
  if (homeCityInput) homeCityInput.value = home?.city || "";
  if (homeProvinceInput) homeProvinceInput.value = home?.province || "";
  if (homeZipInput) homeZipInput.value = home?.zip || "";

  // 🚨 Emergency Contact (editable, pre-filled from Firestore if present)
  const ec = profile.emergencyContact;
  if (emergencyNameInput) emergencyNameInput.value = ec?.name || "";
  if (emergencyRelationshipInput) emergencyRelationshipInput.value = ec?.relationship || "";
  if (emergencyPhoneInput) emergencyPhoneInput.value = ec?.phone || "";

  // ----------------------------
  // IMAGE UPLOAD
  // ----------------------------
  let selectedFile: File | null = null;

  img.onclick = () => fileInput.click();

  fileInput.onchange = () => {
    selectedFile = fileInput.files?.[0] || null;
  };

  // ----------------------------
  // SAVE PROFILE
  // ----------------------------
  saveBtn.onclick = async () => {
    msg.textContent = "Saving...";
    saveBtn.disabled = true;

    try {
      let photoURL = profile.photoURL || null;

      if (selectedFile) {
        const imgRef = ref(storage, `profilePictures/${user.uid}.jpg`);
        await uploadBytes(imgRef, selectedFile);
        photoURL = await getDownloadURL(imgRef);
      }

      await updateDoc(doc(db, "users", user.uid), {
        phoneNumber: phoneInput.value,
        photoURL,
        homeAddress: {
          street: homeStreetInput?.value.trim() || "",
          barangay: homeBarangayInput?.value.trim() || "",
          city: homeCityInput?.value.trim() || "",
          province: homeProvinceInput?.value.trim() || "",
          zip: homeZipInput?.value.trim() || "",
        },
        emergencyContact: {
          name: emergencyNameInput?.value.trim() || "",
          relationship: emergencyRelationshipInput?.value.trim() || "",
          phone: emergencyPhoneInput?.value.trim() || "",
        },
      });

      msg.textContent = "Profile updated successfully!";
      msg.style.color = "green";
    } catch (err: any) {
      console.error(err);
      msg.textContent = err.message || "Update failed";
      msg.style.color = "red";
    } finally {
      saveBtn.disabled = false;
    }
  };

  // ----------------------------
  // CHANGE PASSWORD
  // ----------------------------
  changePassBtn?.addEventListener("click", async () => {
    if (!currentPassInput.value || !newPassInput.value) {
      passMsg.textContent = "Please fill both password fields.";
      passMsg.style.color = "red";
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(
        user.email!,
        currentPassInput.value
      );

      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassInput.value);

      passMsg.textContent = "Password changed successfully!";
      passMsg.style.color = "green";
      currentPassInput.value = "";
      newPassInput.value = "";
    } catch (err: any) {
      console.error(err);
      passMsg.textContent = err.message || "Password change failed.";
      passMsg.style.color = "red";
    }
  });



  // ----------------------------
  // 👁 TOGGLE VISIBILITY
  // ----------------------------
  const attachToggle = (btn: HTMLElement | null, input: HTMLInputElement) => {
    if (!btn) return;
    btn.onclick = () => {
      input.type = input.type === "password" ? "text" : "password";
    };
  };

  attachToggle(toggleCurrentBtn as HTMLElement, currentPassInput);
  attachToggle(toggleNewBtn as HTMLElement, newPassInput);
    // ✅ Initialize theme settings when profile page loads
  requestAnimationFrame(() => {
  initThemeSettings(user.uid, role);
});

  // ✅ Initialize identity verification section
  initIdentityVerification(user, role, profile.identityVerification);
}

// =======================================================
// 🪪 IDENTITY VERIFICATION (one-time, reused everywhere)
// =======================================================

const STATUS_LABELS: Record<VerificationStatus, string> = {
  not_started: "⬜ Not started",
  pending_review: "⏳ Pending review",
  approved: "✅ Verified",
  rejected: "❌ Rejected — please resubmit",
};

function initIdentityVerification(
  user: User,
  role: "member" | "borrower",
  existing: IdentityVerification | undefined
) {
  const prefix = role === "member" ? "member" : "borrower";

  const statusEl = document.getElementById(`${prefix}-verification-status`);
  const noteEl = document.getElementById(`${prefix}-verification-note`);
  const formEl = document.getElementById(`${prefix}-verification-form`);
  const submitBtn = document.getElementById(
    `${prefix}-verify-submit-btn`
  ) as HTMLButtonElement | null;
  const msgEl = document.getElementById(`${prefix}-verify-message`);

  const selfieBtn = document.getElementById(
    `${prefix}-verify-selfie-btn`
  ) as HTMLButtonElement | null;
  const selfieThumb = document.getElementById(
    `${prefix}-verify-selfie-thumb`
  ) as HTMLImageElement | null;

  const selfieIdBtn = document.getElementById(
    `${prefix}-verify-selfie-id-btn`
  ) as HTMLButtonElement | null;
  const selfieIdThumb = document.getElementById(
    `${prefix}-verify-selfie-id-thumb`
  ) as HTMLImageElement | null;

  const govIdInput = document.getElementById(
    `${prefix}-verify-govid-input`
  ) as HTMLInputElement | null;
  const govIdThumb = document.getElementById(
    `${prefix}-verify-govid-thumb`
  ) as HTMLImageElement | null;

  if (
    !statusEl || !noteEl || !formEl || !submitBtn || !msgEl ||
    !selfieBtn || !selfieThumb || !selfieIdBtn || !selfieIdThumb ||
    !govIdInput || !govIdThumb
  ) {
    console.warn(`⚠️ Verification UI elements missing for role: ${role}`);
    return;
  }

  let selfieFile: File | null = null;
  let selfieIdFile: File | null = null;
  let govIdFile: File | null = null;

  function renderStatus(v: IdentityVerification | undefined) {
    const status: VerificationStatus = v?.status ?? "not_started";
    statusEl!.textContent = STATUS_LABELS[status];
    statusEl!.setAttribute("data-status", status);

    if (status === "approved") {
      noteEl!.textContent =
        "Your identity is verified. This is reused automatically for loans, Easy Installment, and Pa-benta.";
      formEl!.style.display = "none";
      submitBtn!.style.display = "none";
    } else {
      formEl!.style.display = "flex";
      submitBtn!.style.display = "block";
      if (status === "rejected" && v?.rejectionReason) {
        noteEl!.textContent = `Reason: ${v.rejectionReason}. Please retake all three and resubmit.`;
      } else if (status === "pending_review") {
        noteEl!.textContent =
          "Submitted — waiting for admin review. You can resubmit below if you made a mistake.";
      } else {
        noteEl!.textContent =
          "Complete this once — it's reused for loans, Easy Installment, and Pa-benta seller applications.";
      }
    }
  }

  renderStatus(existing);

  selfieBtn.addEventListener("click", async () => {
    try {
      const file = await captureLivePhoto({
        title: "Take a selfie",
        instructions: "Look straight at the camera in good lighting.",
        fileNamePrefix: "selfie",
      });
      selfieFile = file;
      selfieThumb.src = URL.createObjectURL(file);
      selfieThumb.style.display = "block";
      selfieBtn.textContent = "🔁 Retake Selfie";
    } catch (err) {
      if (!(err instanceof CameraCaptureCancelledError)) {
        console.error(err);
        msgEl!.textContent =
          err instanceof CameraUnavailableError
            ? err.message
            : "❌ Couldn't capture selfie.";
        msgEl!.style.color = "red";
      }
    }
  });

  selfieIdBtn.addEventListener("click", async () => {
    try {
      const file = await captureLivePhoto({
        title: "Selfie holding your ID",
        instructions: "Hold your government ID next to your face, both clearly visible.",
        fileNamePrefix: "selfie_with_id",
      });
      selfieIdFile = file;
      selfieIdThumb.src = URL.createObjectURL(file);
      selfieIdThumb.style.display = "block";
      selfieIdBtn.textContent = "🔁 Retake";
    } catch (err) {
      if (!(err instanceof CameraCaptureCancelledError)) {
        console.error(err);
        msgEl!.textContent =
          err instanceof CameraUnavailableError
            ? err.message
            : "❌ Couldn't capture selfie-with-ID.";
        msgEl!.style.color = "red";
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
      msgEl!.textContent = "⚠️ Please complete all three steps: selfie, selfie holding ID, and gov ID upload.";
      msgEl!.style.color = "red";
      return;
    }

    submitBtn.disabled = true;
    msgEl!.textContent = "⏳ Uploading verification photos...";
    msgEl!.style.color = "";

    try {
      const stamp = Date.now();

      const selfieRef = ref(storage, `identityVerification/${user.uid}/selfie_${stamp}.jpg`);
      await uploadBytes(selfieRef, selfieFile);
      const selfieUrl = await getDownloadURL(selfieRef);

      const selfieIdRef = ref(storage, `identityVerification/${user.uid}/selfie_with_id_${stamp}.jpg`);
      await uploadBytes(selfieIdRef, selfieIdFile);
      const selfieWithIdUrl = await getDownloadURL(selfieIdRef);

      const govIdRef = ref(
        storage,
        `identityVerification/${user.uid}/gov_id_${stamp}_${govIdFile.name}`
      );
      await uploadBytes(govIdRef, govIdFile);
      const govIdFrontUrl = await getDownloadURL(govIdRef);

      const newVerification: any = {
        status: "pending_review",
        selfieUrl,
        selfieWithIdUrl,
        govIdFrontUrl,
        submittedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "users", user.uid), {
        identityVerification: newVerification,
      });

      msgEl!.textContent = "✅ Verification submitted. Waiting for admin review.";
      msgEl!.style.color = "green";
      renderStatus({ ...newVerification, status: "pending_review" });
    } catch (err: any) {
      console.error(err);
      msgEl!.textContent = err.message || "❌ Failed to submit verification.";
      msgEl!.style.color = "red";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ================================
// 🎨 THEME SETTINGS
// ================================

function initThemeSettings(
  userId: string,
  role: "member" | "borrower"
) {
  const page = document.getElementById(
    role === "member"
      ? "page-member-profile"
      : "page-borrower-profile"
  );

  if (!page) {
    console.warn("Profile page not found");
    return;
  }

  const openBtn = page.querySelector<HTMLButtonElement>(
    role === "member"
      ? "#member-theme-settings-btn"
      : "#borrower-theme-settings-btn"
  );

  const modal = document.getElementById("theme-modal");
  const closeBtn = document.getElementById("close-theme-modal");
  const themeButtons = modal?.querySelectorAll<HTMLButtonElement>(
    "button[data-theme]"
  );

  console.log("Theme debug:", { page, openBtn, modal });

  if (!openBtn || !modal || !closeBtn || !themeButtons) {
    console.warn("Theme elements missing");
    return;
  }
  console.log("✅ Theme elements found. Binding listeners...");

openBtn.addEventListener("click", () => {
  console.log("🎨 Theme button clicked");
  modal.classList.add("active");
});

  closeBtn.onclick = () => {
    modal.classList.remove("active");
  };

  themeButtons.forEach(btn => {
    btn.onclick = async () => {
      console.log("🎨 Theme selected:", btn.dataset.theme);
      const theme = btn.dataset.theme!;
      document.documentElement.setAttribute("data-theme", theme);

      await saveTheme(userId, theme);

      modal.classList.remove("active");
    };
  });
}