import { auth } from "../firebaseConfig";
import { getUserProfile } from "../services/userService";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebaseConfig";

import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { saveTheme } from "../services/themeService";

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

  const addressInput = document.getElementById(
    isMember ? "member-profile-address" : "borrower-profile-address"
  ) as HTMLTextAreaElement;

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

  nameInput.value = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim();
  emailInput.value = user.email || "";
  phoneInput.value = profile.phoneNumber || "";
  addressInput.value = profile.address || "";
  img.src = profile.photoURL || "/default-avatar.png";

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
        address: addressInput.value,
        photoURL,
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




