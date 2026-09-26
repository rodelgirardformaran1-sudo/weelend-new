// src/utils/lightbox.ts
// Any <img class="lightbox-img"> becomes clickable to view full-size.

let lightboxInitialized = false;

export function initLightbox() {
  if (lightboxInitialized) return;
  lightboxInitialized = true;

  const overlay = document.createElement("div");
  overlay.id = "global-lightbox-overlay";
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `
    <span class="lightbox-close">&times;</span>
    <img class="lightbox-full-img" src="" alt="Full size image" />
  `;
  document.body.appendChild(overlay);

  const imgEl = overlay.querySelector(".lightbox-full-img") as HTMLImageElement;

  function closeLightbox() {
    overlay.classList.remove("active");
    imgEl.src = "";
  }

  overlay.addEventListener("click", (e) => {
    if (e.target !== imgEl) closeLightbox();
  });

  // ✅ Event delegation — works even for images added dynamically later
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("lightbox-img")) return;

    const src = (target as HTMLImageElement).src;
    if (!src) return;

    imgEl.src = src;
    overlay.classList.add("active");
  });
}