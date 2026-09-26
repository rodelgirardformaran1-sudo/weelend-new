// src/utils/updateNudge.ts
//
// "Update available" banner — solves the iOS "Add to Home Screen" PWA
// caching problem where a home-screen-installed app can silently keep
// running yesterday's build well after a redeploy (confirmed earlier:
// this project has no service worker, so it's pure iOS/WebKit shell
// caching, not an app bug). Instead of the person just not seeing new
// features, this polls a small version.json (written fresh on every
// `npm run build` — see vite.config.ts) and shows a "tap to refresh"
// banner the moment it detects the running build is stale.
//
// No service worker needed: version.json is a plain static file, fetched
// with cache:'no-store' + a cache-busting query param, so even a fully
// iOS-cached app shell can still successfully notice a newer build exists
// the next time this code runs (on load, on an interval, or when the
// person switches back into the app).

declare const __APP_BUILD_ID__: string;

const BANNER_ID = "app-update-banner";
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const VERSION_URL = "/version.json";

let currentBuildId: string | null = null;
let checking = false;

function showBanner() {
  if (document.getElementById(BANNER_ID)) return;

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:100000;" +
    "background:#4B0082;color:#fff;padding:10px 16px;" +
    "display:flex;align-items:center;justify-content:center;gap:12px;" +
    "flex-wrap:wrap;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.25);";

  banner.innerHTML = `
    <span>🔄 A new version of WeeLend is available.</span>
  `;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Refresh Now";
  btn.style.cssText =
    "background:#fff;color:#4B0082;border:none;border-radius:8px;" +
    "padding:6px 14px;font-weight:600;cursor:pointer;";
  btn.onclick = () => {
    window.location.reload();
  };

  banner.appendChild(btn);
  document.body.appendChild(banner);
}

async function checkForUpdate() {
  if (checking || currentBuildId === null) return;
  checking = true;
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.buildId && data.buildId !== currentBuildId) {
      showBanner();
    }
  } catch {
    // Offline or blocked — silently skip, try again on the next tick.
  } finally {
    checking = false;
  }
}

/**
 * Call once, unconditionally, at app startup (auth state doesn't matter —
 * this should catch a stale login page too).
 */
export function initUpdateNudge() {
  // __APP_BUILD_ID__ doesn't exist in `npm run dev` unless Vite's define
  // is active, but it always is per vite.config.ts, so this is just a
  // defensive guard in case that ever changes.
  try {
    currentBuildId = __APP_BUILD_ID__;
  } catch {
    return;
  }
  if (!currentBuildId) return;

  checkForUpdate();
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);

  // 📱 The scenario this actually exists for: someone backgrounds the
  // installed PWA for hours/days, then switches back into it — that's
  // exactly when a stale build is most likely and most worth catching.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  window.addEventListener("focus", checkForUpdate);
}
