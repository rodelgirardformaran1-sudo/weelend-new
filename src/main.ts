console.log("✅ main.ts is executing");
console.log("🔍 REAL PATH:", import.meta.url);


import "./style.css";
import { register, login, logout, listenToAuthChanges } from "./services/authService";
import { initAdminDashboard } from "./pages/adminDashboard"; // <--- Import the new function
import { initMemberDashboard } from "./pages/memberDashboard"; // <--- Add this import
import { initBorrowerDashboard } from "./pages/borrowerDashboard"; // <--- Add this import

import { getUserProfile } from "./services/userService";
import type { User } from "firebase/auth";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "./firebaseConfig";
import { initTheme } from "./services/themeService";
import { hasAcceptedShopTerms, acceptShopTerms } from "./services/shopConsentService";
import { initShopPage } from "./pages/shop";
import { initLightbox } from "./utils/lightbox";

console.log("🔥 main.ts loaded");

// ==========================
// 🛍️ Floating Shop Button
// ==========================
const shopFab = document.getElementById("shop-fab") as HTMLButtonElement | null;
let allowShopFab = false; // ✅ only true for approved member/borrower
let currentUid: string | null = null;

const shopModal = document.getElementById("shop-coming-soon-modal");
const shopCloseBtn = document.getElementById("shop-coming-soon-close");
const shopOkBtn = document.getElementById("shop-coming-soon-ok");

// ==========================
// 🛍️ Shop Terms Modal (Marimar's Bazaar)
// ==========================
const shopTermsModal = document.getElementById("shop-terms-modal");
const shopTermsClose = document.getElementById("shop-terms-close");
const shopTermsCancel = document.getElementById("shop-terms-cancel");
const shopTermsCheckbox = document.getElementById("shop-terms-checkbox") as HTMLInputElement | null;
const shopTermsContinue = document.getElementById("shop-terms-continue") as HTMLButtonElement | null;

function openShopTermsModal() {
  shopTermsModal?.classList.add("active");
  if (shopTermsCheckbox) shopTermsCheckbox.checked = false;
  if (shopTermsContinue) shopTermsContinue.disabled = true;
  syncFabWithModals();
}

function closeShopTermsModal() {
  shopTermsModal?.classList.remove("active");
  syncFabWithModals();
}

shopTermsClose?.addEventListener("click", closeShopTermsModal);
shopTermsCancel?.addEventListener("click", closeShopTermsModal);

shopTermsCheckbox?.addEventListener("change", () => {
  if (shopTermsContinue) shopTermsContinue.disabled = !shopTermsCheckbox.checked;
});

shopTermsContinue?.addEventListener("click", async () => {
  if (!currentUid) return;
  if (!shopTermsCheckbox?.checked) return;

  await acceptShopTerms(currentUid);
  closeShopTermsModal();
  showPage("page-shop");
});

shopFab?.addEventListener("click", async () => {
  if (!currentUid) return;

  const accepted = await hasAcceptedShopTerms(currentUid);
if (accepted) {
  showPage("page-shop");
  return;
}

  openShopTermsModal();
});

shopCloseBtn?.addEventListener("click", () => {
  shopModal?.classList.remove("active");
  syncFabWithModals();
});

shopOkBtn?.addEventListener("click", () => {
  shopModal?.classList.remove("active");
  syncFabWithModals();
});

// ==========================
// 🧠 Auto Hide Shop FAB When Any Modal Is Open
// ==========================

function setShopFabVisible(visible: boolean) {
  if (!shopFab) return;

  // ✅ hard gate: never show unless allowed by auth + role
  if (!allowShopFab) {
    shopFab.style.display = "none";
    return;
  }

  shopFab.style.display = visible ? "flex" : "none";
}

function syncFabWithModals() {
  const anyModalOpen = !!document.querySelector(".modal.active");
  setShopFabVisible(!anyModalOpen);
}


// Observe class changes across the document
const modalObserver = new MutationObserver(syncFabWithModals);
modalObserver.observe(document.body, {
  attributes: true,
  subtree: true,
  attributeFilter: ["class"]
});

// Run once initially
syncFabWithModals();

// ==========================
// ☰ Role-based Sidebar Toggle
// Admin = #admin-sidebar (existing)
// Member/Borrower = #app-sidebar + overlay
// ==========================

const appSidebar = document.getElementById("app-sidebar");
const appOverlay = document.getElementById("sidebar-overlay");
const globalToggleBtn = document.getElementById("global-toggle-sidebar-btn");


let currentRole: "admin" | "member" | "borrower" | null = null;
let contractsReturnPageId: "page-dashboard-member" | "page-dashboard-borrower" = "page-dashboard-member";

// --- app sidebar helpers ---
function updateGlobalToggleIcon() {
  if (!globalToggleBtn) return;

  // ADMIN: icon depends on admin sidebar collapsed state
  if (currentRole === "admin") {
    const sidebar = document.getElementById("admin-sidebar");
    const collapsed = sidebar?.classList.contains("collapsed") ?? true;
    globalToggleBtn.textContent = collapsed ? "☰" : "✖";
    return;
  }

  // MEMBER/BORROWER: icon depends on app sidebar active state
  const open = appSidebar?.classList.contains("active") ?? false;
  globalToggleBtn.textContent = open ? "✖" : "☰";
}

function openAppSidebar() {
  appSidebar?.classList.add("active");
  appOverlay?.classList.add("active");
  updateGlobalToggleIcon();
}

function closeAppSidebar() {
  appSidebar?.classList.remove("active");
  appOverlay?.classList.remove("active");
  updateGlobalToggleIcon();
}

function toggleAdminSidebar() {
  const sidebar = document.getElementById("admin-sidebar") as HTMLElement | null;
  const layout = document.getElementById("admin-dashboard-layout") as HTMLElement | null;

  console.log("🔧 toggleAdminSidebar()", { sidebarFound: !!sidebar, layoutFound: !!layout });

  if (!sidebar || !layout) return;

  // toggle collapsed state
  const nowCollapsed = sidebar.classList.toggle("collapsed");
  layout.classList.toggle("sidebar-collapsed", nowCollapsed);

  // ✅ HARD FORCE visual state (prevents CSS/inline conflicts)
  if (nowCollapsed) {
    sidebar.style.width = "0px";
    sidebar.style.flex = "0 0 0px";
    sidebar.style.padding = "0";
    sidebar.style.overflow = "hidden";
    sidebar.style.transform = "translateX(-100%)";
    sidebar.style.pointerEvents = "none";
  } else {
    sidebar.style.width = "250px";
    sidebar.style.flex = "0 0 250px";
    sidebar.style.padding = "20px 20px 20px 50px";
    sidebar.style.overflow = "auto";
    sidebar.style.transform = "translateX(0)";
    sidebar.style.pointerEvents = "auto";
  }

  // Debug: confirm computed width/transform after forcing
  const cs = getComputedStyle(sidebar);
  console.log("✅ ADMIN SIDEBAR AFTER TOGGLE", {
    nowCollapsed,
    classCollapsed: sidebar.classList.contains("collapsed"),
    layoutCollapsed: layout.classList.contains("sidebar-collapsed"),
    computedWidth: cs.width,
    computedTransform: cs.transform,
    display: cs.display,
  });

  updateGlobalToggleIcon();
}

if (globalToggleBtn && !(globalToggleBtn as any)._bound) {
  (globalToggleBtn as any)._bound = true;

  globalToggleBtn.addEventListener("click", () => {
    console.log("☰ GLOBAL TOGGLE CLICK", {
      currentRole,
      adminSidebarCollapsed: document.getElementById("admin-sidebar")?.classList.contains("collapsed"),
      adminSidebarDisplay: document.getElementById("admin-sidebar")
        ? getComputedStyle(document.getElementById("admin-sidebar")!).display
        : "N/A",
      adminSidebarWidth: document.getElementById("admin-sidebar")
        ? getComputedStyle(document.getElementById("admin-sidebar")!).width
        : "N/A",
    });

    if (currentRole === "admin") {
      toggleAdminSidebar();
      return;
    }

    if (appSidebar?.classList.contains("active")) closeAppSidebar();
    else openAppSidebar();
  });
}

// Tap outside closes member/borrower sidebar only
appOverlay?.addEventListener("click", closeAppSidebar);

// 🧾 Contracts button inside sidebar
document.getElementById("sidebar-contracts-btn")?.addEventListener("click", async () => {
  // ✅ remember where to go back
  contractsReturnPageId =
    currentRole === "borrower" ? "page-dashboard-borrower" : "page-dashboard-member";

  closeAppSidebar();
  showPage("page-pa-swipe-contracts");

  const mod = await import("./pages/paSwipeContracts");
  await mod.initPaSwipeContractsPage();
});

document.getElementById("contracts-back-btn")?.addEventListener("click", () => {
  showPage(contractsReturnPageId);
});

// Function to show a specific page
export function showPage(pageId: string) {
  console.log("🧭 showPage CALLED WITH:", pageId);

  const pages = document.querySelectorAll("main > .page");
  pages.forEach(p => p.classList.remove("active"));

  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add("active");
    console.log("✅ Activated:", pageId);
  } else {
    console.warn("❌ Page NOT FOUND:", pageId);
  }
}

// Show login page by default
showPage("page-login");

// Initialize shop routing once
initShopPage();
initLightbox();

// ==========================
// SIGN UP
// ==========================
const signupBtn = document.getElementById("signup-btn");

signupBtn?.addEventListener("click", async () => {
  console.log("👉 Signup clicked");

  const fullNameInput = document.getElementById("signup-fullname") as HTMLInputElement;
  const emailInput = document.getElementById("signup-email") as HTMLInputElement;
  const passwordInput = document.getElementById("signup-password") as HTMLInputElement;
  const message = document.getElementById("signup-message") as HTMLElement;

  if (!fullNameInput.value || !emailInput.value || !passwordInput.value) {
    message.textContent = "Please fill in all fields";
    return;
  }

  try {
    const nameParts = fullNameInput.value.trim().split(" ");
const firstName = nameParts[0];
const lastName = nameParts.slice(1).join(" ") || "";
const requestedRoleInput = document.getElementById("signup-request-role") as HTMLSelectElement;

console.log("Selected role:", requestedRoleInput.value); // Debug log

await register(
  emailInput.value,
  passwordInput.value,
  firstName,
  lastName,
  requestedRoleInput.value   // NEW argument
);
    message.textContent = `Account created successfully!`;
    message.style.color = 'green';
  } catch (err: any) {
  console.error("Signup error:", err);
  message.textContent = err.code || err.message;
}
});

// ==========================
// LOGIN
// ==========================
const loginBtn = document.getElementById("login-btn");

loginBtn?.addEventListener("click", async () => {
  const emailInput = document.getElementById("login-email") as HTMLInputElement;
  const passwordInput = document.getElementById("login-password") as HTMLInputElement;
  const message = document.getElementById("login-message") as HTMLElement;

  if (!emailInput.value || !passwordInput.value) {
    message.textContent = "Please fill in all fields";
    return;
  }

  try {
    await login(emailInput.value, passwordInput.value);
    message.textContent = "Login successful!";
    message.style.color = 'green';
  } catch (err: any) {
    message.textContent = err.message || "Login failed";
  }
});

// ==========================
// 👁 TOGGLE LOGIN PASSWORD
// ==========================
const loginPasswordInput = document.getElementById("login-password") as HTMLInputElement | null;
const toggleLoginPasswordBtn = document.getElementById("toggle-login-password");

toggleLoginPasswordBtn?.addEventListener("click", () => {
  if (!loginPasswordInput) return;

  const isHidden = loginPasswordInput.type === "password";
  loginPasswordInput.type = isHidden ? "text" : "password";
});


// ==========================
// 🔐 FORGOT PASSWORD
// ==========================
const forgotPasswordLink = document.getElementById("forgot-password-link");

forgotPasswordLink?.addEventListener("click", async (e) => {
  e.preventDefault();

  const emailInput = document.getElementById("login-email") as HTMLInputElement | null;
  const message = document.getElementById("login-message") as HTMLElement | null;

  if (!emailInput || !emailInput.value) {
    if (message) {
      message.textContent = "Please enter your email first.";
      message.style.color = "red";
    }
    return;
  }

  try {
    await sendPasswordResetEmail(auth, emailInput.value);

    if (message) {
      message.textContent =
        "✅ Password reset email sent. Please check your inbox.";
      message.style.color = "green";
    }
  } catch (err: any) {
    console.error("Forgot password error:", err);
    if (message) {
      message.textContent = err.message || "Failed to send reset email.";
      message.style.color = "red";
    }
  }
});

// ==========================
// LOGOUT
// ==========================
const globalLogoutBtn = document.getElementById("global-logout-btn") as HTMLButtonElement;
globalLogoutBtn?.addEventListener("click", async () => {
  await logout();
});

// ==========================
// NAVIGATION
// ==========================
const goRegister = document.getElementById('go-register');
goRegister?.addEventListener('click', (e) => {
  e.preventDefault();
  showPage('page-register');
});

const goLogin = document.getElementById('go-login');
goLogin?.addEventListener('click', (e) => {
  e.preventDefault();
  showPage('page-login');
});

// ===============================
// INFO PAGE BACK BUTTONS
// ===============================

document.getElementById("member-info-back-btn")?.addEventListener("click", () => {
  showPage("page-dashboard-member");
});

document.getElementById("borrower-info-back-btn")?.addEventListener("click", () => {
  showPage("page-dashboard-borrower");
});


// ==========================
// AUTH STATE + PAGE SWITCHING
// ==========================
listenToAuthChanges(async (user: User | null) => {
  console.log("Auth state changed, user:", user ? user.email : null);
  const header = document.getElementById("app-header") as HTMLElement;
if (!user) {
  currentUid = null;
    // ✅ ROLE RESET (logout)
  currentRole = null;
  closeAppSidebar();
  updateGlobalToggleIcon();
  header.style.display = 'none';

  allowShopFab = false;
syncFabWithModals();

  // 🎨 Reset theme on logout
  document.documentElement.setAttribute("data-theme", "purple");

      const memberNav = document.getElementById("member-bottom-nav");
      if (memberNav) memberNav.style.display = "none";

      const borrowerNav = document.getElementById("borrower-bottom-nav");
if (borrowerNav) borrowerNav.style.display = "none";


    showPage('page-login');
    return;
  }

  header.style.display = 'flex';
  currentUid = user.uid;

  const memberNav = document.getElementById("member-bottom-nav");
if (memberNav) memberNav.style.display = "none";

const borrowerNav = document.getElementById("borrower-bottom-nav");
if (borrowerNav) borrowerNav.style.display = "none";


try {
const profile = await getUserProfile(user.uid);

console.log("User profile:", profile);

if (!profile) {
  allowShopFab = false;
  syncFabWithModals();

  header.style.display = "none";
  showPage("page-login");
  return;
}

// 🎨 Load saved theme globally (SAFE now)
await initTheme(user.uid);

  // 🔍 SAFE DEBUG LOGS (profile is guaranteed NOT null here)
console.log("🔐 ROLE CHECK:", profile.role);
console.log("🧾 FULL PROFILE:", profile);
currentRole = profile.role as any; // ✅ SET ROLE FOR TOGGLE LOGIC
updateGlobalToggleIcon(); // ✅ refresh icon for this role

  if (profile.status === "pending") {
    allowShopFab = false;
syncFabWithModals();
    showPage("page-pending");
    return;
  }

  if (profile.status === "approved") {

if (profile.role === "admin") {
  closeAppSidebar(); // ✅ prevent member sidebar overlay in admin
  allowShopFab = false;
syncFabWithModals();
  document.body.classList.add("admin-mode");
  showPage("page-dashboard-admin");
  initAdminDashboard();

  const memberNav = document.getElementById("member-bottom-nav");
  if (memberNav) memberNav.style.display = "none";

const borrowerNav = document.getElementById("borrower-bottom-nav");
if (borrowerNav) borrowerNav.style.display = "none";

  return;
}


    if (profile.role === "member") {
      document.getElementById("admin-sidebar")?.classList.remove("collapsed");
      document.getElementById("admin-dashboard-layout")?.classList.remove("sidebar-collapsed");
updateGlobalToggleIcon();
      allowShopFab = true;
syncFabWithModals();
      document.body.classList.remove("admin-mode");
      showPage("page-dashboard-member");
      initMemberDashboard(user); // Initialize the member dashboard AFTER showing the page

      if (memberNav) memberNav.style.display = "grid";

      return;
    }

if (profile.role === "borrower") {
  document.getElementById("admin-sidebar")?.classList.remove("collapsed");
  document.getElementById("admin-dashboard-layout")?.classList.remove("sidebar-collapsed");
updateGlobalToggleIcon();
  allowShopFab = true;
syncFabWithModals();
  document.body.classList.remove("admin-mode");
  showPage("page-dashboard-borrower");
  initBorrowerDashboard(user);

  const borrowerNav = document.getElementById("borrower-bottom-nav");
  if (borrowerNav) borrowerNav.style.display = "grid";

  return;
}
  }

  allowShopFab = false;
syncFabWithModals();

  header.style.display = 'none';
  showPage("page-login");

} catch (err) {
  allowShopFab = false;
syncFabWithModals();
  console.error("Error in auth state:", err);
  header.style.display = 'none';
  showPage('page-login');
}
});