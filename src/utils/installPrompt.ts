// src/utils/installPrompt.ts
//
// "Add to Home Screen" nudge banner — so members/borrowers can get a
// native-app-like shortcut on their phone without Rodel walking each
// person through the browser menu one by one.
//
// Two very different platforms, two very different levels of certainty
// about whether it worked:
//
// - Android / Chrome / Edge: the browser fires `beforeinstallprompt`
//   ONLY when it has determined the app is not currently installed —
//   that's Chrome's own eligibility check, not ours. So that event is
//   treated as the live source of truth: whenever it fires, any stale
//   "already installed" flag from a previous session is cleared and the
//   banner is shown again. This is what makes uninstall → reinstall work
//   without any explicit "uninstalled" signal existing (there isn't
//   one on any platform). `appinstalled` still marks it done the moment
//   install actually succeeds.
// - iOS Safari: Apple exposes NO install API and NO "was it added" (or
//   "was it removed") signal at all, ever. We can only show manual
//   instructions and rely on the person confirming ("I already added
//   it") or on detecting they're running from the home-screen shortcut
//   next time (`navigator.standalone`). If they later remove the
//   shortcut, there's no way for the page to find out — the banner
//   stays hidden until they clear their browser site data. That's a
//   real platform limitation, not a bug.

const SNOOZE_KEY = "weelend_pwa_prompt_snooze_until"; // "Maybe Later" — respected on every platform
const IOS_DISMISSED_KEY = "weelend_pwa_ios_dismissed"; // iOS-only permanent ack — see note above
const INSTALLED_KEY = "weelend_pwa_installed"; // Android/Chrome — always re-checked against beforeinstallprompt
const SNOOZE_DAYS = 7;

const BANNER_ID = "pwa-install-banner";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-browsing / storage-blocked — banner just won't remember
    // the dismissal across reloads, which is an acceptable fallback.
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as any).standalone === true // iOS Safari's own flag
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

function isLikelyMobile(): boolean {
  return (
    /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
    window.matchMedia?.("(max-width: 820px)").matches === true
  );
}

function isSnoozed(): boolean {
  const until = Number(safeGet(SNOOZE_KEY) ?? 0);
  return Date.now() < until;
}

function removeBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

// The member/borrower shell has its own fixed bottom-nav (64px tall) plus
// a floating .shop-fab circle centered above it (spans roughly 32–96px
// from the bottom). Sitting the banner at the default 12px puts it right
// under the shop-fab, so its buttons become unclickable. When that shell
// is present and visible, push the banner up above both; otherwise (e.g.
// the login page, or admin-mode where both are hidden) keep it at 12px.
function getBannerBottomOffset(): number {
  // Member and borrower each have their own #member-bottom-nav /
  // #borrower-bottom-nav (both class="bottom-nav") — only one is ever
  // visible at a time, so all matches must be checked, not just the
  // first (querySelector alone could pick the hidden one).
  const navs = document.querySelectorAll<HTMLElement>(".bottom-nav");
  const anyNavVisible = Array.from(navs).some(
    (nav) => getComputedStyle(nav).display !== "none"
  );
  return anyNavVisible ? 108 : 12;
}

function snooze() {
  safeSet(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  removeBanner();
}

function markIosDismissed() {
  safeSet(IOS_DISMISSED_KEY, "true");
  removeBanner();
}

function markInstalled() {
  safeSet(INSTALLED_KEY, "true");
  removeBanner();
}

function renderBanner(opts: {
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  showAlreadyAdded: boolean;
}) {
  if (document.getElementById(BANNER_ID)) return; // already showing

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.style.cssText =
    `position:fixed;left:12px;right:12px;bottom:${getBannerBottomOffset()}px;z-index:9999;` +
    "background:#4B0082;color:#fff;border-radius:14px;padding:14px 16px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;" +
    "gap:12px;flex-wrap:wrap;font-size:14px;";

  const textWrap = document.createElement("div");
  textWrap.style.cssText = "flex:1;min-width:180px;";
  textWrap.innerHTML = `
    <strong style="display:block;margin-bottom:2px;">📲 Get the WeeLend app shortcut</strong>
    <span style="opacity:.9;">${opts.message}</span>
  `;

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;";

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.textContent = opts.primaryLabel;
  primaryBtn.style.cssText =
    "background:#fff;color:#4B0082;border:none;border-radius:8px;" +
    "padding:8px 14px;font-weight:700;cursor:pointer;";
  primaryBtn.onclick = opts.onPrimary;

  const laterBtn = document.createElement("button");
  laterBtn.type = "button";
  laterBtn.textContent = "Maybe Later";
  laterBtn.style.cssText =
    "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);" +
    "border-radius:8px;padding:8px 14px;cursor:pointer;";
  laterBtn.onclick = snooze;

  btnRow.appendChild(primaryBtn);

  if (opts.showAlreadyAdded) {
    const alreadyBtn = document.createElement("button");
    alreadyBtn.type = "button";
    alreadyBtn.textContent = "I already added it";
    alreadyBtn.style.cssText =
      "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);" +
      "border-radius:8px;padding:8px 14px;cursor:pointer;";
    alreadyBtn.onclick = markIosDismissed;
    btnRow.appendChild(alreadyBtn);
  }

  btnRow.appendChild(laterBtn);

  banner.appendChild(textWrap);
  banner.appendChild(btnRow);
  document.body.appendChild(banner);

  // The banner can be created before login (no bottom-nav/shop-fab
  // visible yet) and then outlive the login → dashboard transition,
  // where both appear. Keep its position in sync so it never ends up
  // parked back under the shop-fab after that transition.
  const repositionInterval = window.setInterval(() => {
    const el = document.getElementById(BANNER_ID);
    if (!el) {
      window.clearInterval(repositionInterval);
      return;
    }
    el.style.bottom = `${getBannerBottomOffset()}px`;
  }, 1500);
}

/** Call once on app load. */
export function initInstallPrompt() {
  // Already running as the installed app — nothing to do, and this also
  // self-heals a stale snooze/dismissal from before it was installed.
  if (isStandalone()) {
    markInstalled();
    return;
  }

  if (!isLikelyMobile()) return; // this is a phone-shortcut nudge, not a desktop one
  if (isSnoozed()) return; // "Maybe Later" is respected on every platform, always

  if (isIos()) {
    // No install/uninstall API on iOS Safari at all — the only signals
    // we get are the person's own confirmation, or actually detecting
    // standalone mode (handled above). This one genuinely can't
    // self-heal after an uninstall.
    if (safeGet(IOS_DISMISSED_KEY) === "true") return;

    renderBanner({
      message:
        "Tap the Share icon, then \"Add to Home Screen\" — it'll open like a normal app, no browser bar.",
      primaryLabel: "Got it",
      onPrimary: snooze,
      showAlreadyAdded: true,
    });
    return;
  }

  // Android / Chrome / Edge — wait for the browser's own install signal.
  // Deliberately NOT gated behind the stored "installed" flag: Chrome
  // only fires beforeinstallprompt when IT has determined the app isn't
  // currently installed, which is exactly the live signal needed to
  // recover from an uninstall the stored flag can't know about on its
  // own.
  let deferredPrompt: any = null;

  window.addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault();
    deferredPrompt = e;

    // Chrome just told us, definitively, that it's not installed right
    // now — any earlier "installed" flag is stale.
    safeRemove(INSTALLED_KEY);

    renderBanner({
      message: "Install it once and open it straight from your home screen, like a native app.",
      primaryLabel: "Install",
      onPrimary: async () => {
        removeBanner();
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      },
      showAlreadyAdded: false,
    });
  });

  // The one fully-reliable signal we get: fires the moment install
  // actually succeeds, however it was triggered.
  window.addEventListener("appinstalled", () => {
    markInstalled();
  });
}
