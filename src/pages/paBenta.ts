// src/pages/paBenta.ts
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { createShop, getMyShop, updateShop, closeShop, reopenShop, type PaBentaShop } from "../services/paBentaShopService";
import { createListing, getMyListings, uploadListingImage, deleteListing, type PaBentaListing } from "../services/paBentaListingService";
import { subscribeToApprovedFeed, incrementListingView, type FeedListing } from "../services/paBentaFeedService";
import { subscribeToMyWishlistIds, toggleWishlist } from "../services/paBentaWishlistService";
import { isUserIdentityVerified } from "../services/userService";

let unsubscribeFeed: (() => void) | null = null;
let unsubscribeWishlistIds: (() => void) | null = null;
let currentWishlistIds: Set<string> = new Set();

const CATEGORY_LABELS: Record<string, string> = {
  food: "Food & Beverage",
  apparel: "Apparel",
  home: "Home & Living",
  electronics: "Electronics",
  services: "Services",
  other: "Other",
};

function peso(n: number) {
  return `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function loadPaBentaPage() {
  const container = document.getElementById("marketplace-content") as HTMLElement | null;
  if (!container) return;

  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = `<p>Please sign in.</p>`;
    return;
  }

  container.innerHTML = `<p>Loading...</p>`;

  const profileSnap = await getDoc(doc(db, "users", user.uid));
  const role = profileSnap.data()?.role ?? "borrower";

  if (role === "borrower") {
    renderPageShell(container, null, user.uid, "feed");
    return;
  }

  // members (and admin) can create/manage a shop
  const shop = await getMyShop(user.uid);
  renderPageShell(container, shop, user.uid, "myshop");
}

/**
 * Shared shell with tab switching (My Shop / Browse Marketplace).
 * Borrowers only ever see the feed tab (no "My Shop" tab rendered).
 */
function renderPageShell(container: HTMLElement, shop: PaBentaShop | null, userId: string, initialTab: "myshop" | "feed") {
  const canHaveShop = shop !== null || initialTab === "myshop";

  container.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
      ${canHaveShop ? `<button id="pb-tab-myshop" class="tab-button" style="flex:1;">🏪 My Shop</button>` : ""}
      <button id="pb-tab-feed" class="tab-button" style="flex:1;">🛍️ Browse Marketplace</button>
      <button id="pb-tab-wishlist" class="tab-button" style="flex:1;">❤️ Wishlist</button>
    </div>
    <div id="pb-tab-content"></div>
  `;

  const contentEl = document.getElementById("pb-tab-content") as HTMLElement;
  const myShopBtn = document.getElementById("pb-tab-myshop");
  const feedBtn = document.getElementById("pb-tab-feed");
  const wishlistBtn = document.getElementById("pb-tab-wishlist");

  if (unsubscribeWishlistIds) { unsubscribeWishlistIds(); unsubscribeWishlistIds = null; }
  currentWishlistIds = new Set(); // ✅ hard reset before subscribing, prevents any stale cross-user data
  unsubscribeWishlistIds = subscribeToMyWishlistIds(userId, (ids) => {
    currentWishlistIds = new Set(ids);
  });

  function setActiveTab(tab: "myshop" | "feed" | "wishlist") {
    myShopBtn?.classList.toggle("active", tab === "myshop");
    feedBtn?.classList.toggle("active", tab === "feed");
    wishlistBtn?.classList.toggle("active", tab === "wishlist");

    if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; }

    if (tab === "myshop") {
      renderShopState(contentEl, shop, userId);
    } else if (tab === "feed") {
      renderMarketplaceFeed(contentEl, userId);
    } else {
      renderWishlistTab(contentEl, userId);
    }
  }

  myShopBtn?.addEventListener("click", () => setActiveTab("myshop"));
  feedBtn?.addEventListener("click", () => setActiveTab("feed"));
  wishlistBtn?.addEventListener("click", () => setActiveTab("wishlist"));

  setActiveTab(canHaveShop ? initialTab : "feed");
}

// =======================================================
// 🛍️ PUBLIC MARKETPLACE FEED (both roles)
// =======================================================
function renderMarketplaceFeed(container: HTMLElement, userId: string) {
  container.innerHTML = `
    <div class="card">
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <input id="pb-feed-search" type="text" placeholder="🔍 Search products..." style="flex:2; min-width:180px;" />
        <select id="pb-feed-category" style="flex:1; min-width:140px;">
          <option value="">All Categories</option>
          ${Object.entries(CATEGORY_LABELS).map(([val, label]) => `<option value="${val}">${label}</option>`).join("")}
        </select>
      </div>
    </div>
    <div id="pb-feed-list"><p>Loading listings...</p></div>
  `;

  const searchEl = document.getElementById("pb-feed-search") as HTMLInputElement;
  const categoryEl = document.getElementById("pb-feed-category") as HTMLSelectElement;
  const listEl = document.getElementById("pb-feed-list") as HTMLElement;

  let allListings: FeedListing[] = [];

  function renderFiltered() {
    const term = searchEl.value.trim().toLowerCase();
    const category = categoryEl.value;

    const filtered = allListings.filter((l) => {
      const matchesTerm = !term || l.productName.toLowerCase().includes(term);
      const matchesCategory = !category || l.category === category;
      return matchesTerm && matchesCategory;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = `<p style="opacity:.75; margin-top:12px;">No products found.</p>`;
      return;
    }

    listEl.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:12px; margin-top:12px;">
        ${filtered.map((l) => `
          <div class="card pb-feed-card" data-id="${l.id}" style="cursor:pointer; padding:10px; position:relative;">
            <button class="pb-heart-btn" data-id="${l.id}" style="position:absolute; top:14px; right:14px; background:rgba(255,255,255,0.9); border-radius:50%; width:32px; height:32px; padding:0; font-size:16px; line-height:1;">
              ${currentWishlistIds.has(l.id) ? "❤️" : "🤍"}
            </button>
            ${l.imageUrls?.[0] ? `<img src="${l.imageUrls[0]}" style="width:100%; height:120px; object-fit:cover; border-radius:10px;" />` : ""}
            <div style="font-weight:700; margin-top:8px; font-size:14px;">${l.productName}</div>
            <div style="font-size:13px; color:#555;">${peso(l.price)}</div>
            <div style="font-size:12px; opacity:.7;">${l.shopName}</div>
          </div>
        `).join("")}
      </div>
    `;

    listEl.querySelectorAll(".pb-feed-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".pb-heart-btn")) return;
        const id = (card as HTMLElement).dataset.id!;
        const listing = allListings.find((l) => l.id === id);
        if (listing) openListingDetail(listing, userId);
      });
    });

listEl.querySelectorAll(".pb-heart-btn").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const id = (btn as HTMLElement).dataset.id!;
    const wasSaved = currentWishlistIds.has(id);
    const nowSaved = await toggleWishlist(userId, id, wasSaved);
    btn.textContent = nowSaved ? "❤️" : "🤍";
  });
});
  }

  searchEl.addEventListener("input", renderFiltered);
  categoryEl.addEventListener("change", renderFiltered);

  unsubscribeFeed = subscribeToApprovedFeed((listings) => {
    allListings = listings;
    renderFiltered();
  });
}

function openListingDetail(listing: FeedListing, userId: string) {
  incrementListingView(listing.id).catch((err) => console.warn("View count update failed:", err));

  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  const conditionLabel = listing.condition === "brand_new" ? "Brand New" : listing.condition === "like_new" ? "Like New" : "Used";
  const stockLabel = listing.stockStatus.replace(/_/g, " ");
  const isSaved = currentWishlistIds.has(listing.id);

  modal.innerHTML = `
    <div class="repayment-modal" style="max-width:420px;">
      ${listing.imageUrls?.[0] ? `<img src="${listing.imageUrls[0]}" style="width:100%; max-height:240px; object-fit:cover; border-radius:12px;" />` : ""}
      <h3 style="margin-top:12px;">${listing.productName}</h3>
      <p style="font-size:20px; font-weight:700; color:var(--secondary-purple);">${peso(listing.price)}</p>
      <p style="font-size:13px; opacity:.8;">Sold by <strong>${listing.shopName}</strong></p>

      ${listing.description ? `<p>${listing.description}</p>` : ""}

      <p style="font-size:13px;">
        <strong>Category:</strong> ${CATEGORY_LABELS[listing.category] || listing.category} •
        <strong>Condition:</strong> ${conditionLabel} •
        <strong>Stock:</strong> ${stockLabel}
      </p>
      ${listing.location ? `<p style="font-size:13px;"><strong>Location:</strong> ${listing.location}</p>` : ""}

      <hr/>

      <p><strong>Contact Seller</strong></p>
      <p style="font-size:14px;">
        📞 ${listing.contactNumber} (preferred: ${listing.preferredContactMethod})
      </p>
      ${listing.socialLinks?.facebook ? `<p><a href="${listing.socialLinks.facebook}" target="_blank" rel="noopener">Facebook Profile ↗</a></p>` : ""}

      <div class="modal-actions">
        <button id="pb-detail-wishlist" class="btn-cancel">${isSaved ? "❤️ Saved" : "🤍 Save for Later"}</button>
        <button id="pb-detail-close" class="btn-confirm">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById("pb-detail-close")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });

document.getElementById("pb-detail-wishlist")?.addEventListener("click", async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const wasSaved = currentWishlistIds.has(listing.id);
  const nowSaved = await toggleWishlist(userId, listing.id, wasSaved);
  btn.textContent = nowSaved ? "❤️ Saved" : "🤍 Save for Later";
});
}

async function renderWishlistTab(container: HTMLElement, userId: string) {
  container.innerHTML = `<div id="pb-wishlist-list"><p>Loading your wishlist...</p></div>`;
  const listEl = document.getElementById("pb-wishlist-list") as HTMLElement;

  async function refresh() {
    const ids = [...currentWishlistIds];

    if (ids.length === 0) {
      listEl.innerHTML = `<p style="opacity:.75;">You haven't saved anything yet. Tap the heart on any product to save it here.</p>`;
      return;
    }

    const listings = (
      await Promise.all(
        ids.map(async (id) => {
          const snap = await getDoc(doc(db, "paBentaListings", id));
          if (!snap.exists()) return null;
          return { id: snap.id, ...(snap.data() as any) } as PaBentaListing;
        })
      )
    ).filter((l): l is PaBentaListing => l !== null);

    if (listings.length === 0) {
      listEl.innerHTML = `<p style="opacity:.75;">Your saved items are no longer available.</p>`;
      return;
    }

    listEl.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:12px;">
        ${listings.map((l) => `
          <div class="card" style="padding:10px; position:relative;">
            <button class="pb-wishlist-remove-btn" data-id="${l.id}" style="position:absolute; top:14px; right:14px; background:rgba(255,255,255,0.9); border-radius:50%; width:32px; height:32px; padding:0; font-size:16px; line-height:1;">
              ❤️
            </button>
            ${l.imageUrls?.[0] ? `<img src="${l.imageUrls[0]}" style="width:100%; height:120px; object-fit:cover; border-radius:10px;" />` : ""}
            <div style="font-weight:700; margin-top:8px; font-size:14px;">${l.productName}</div>
            <div style="font-size:13px; color:#555;">${peso(l.price)}</div>
          </div>
        `).join("")}
      </div>
    `;

listEl.querySelectorAll(".pb-wishlist-remove-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = (btn as HTMLElement).dataset.id!;
    await toggleWishlist(userId, id, true);
  });
});
  }

  if (unsubscribeWishlistIds) { unsubscribeWishlistIds(); }
  unsubscribeWishlistIds = subscribeToMyWishlistIds(userId, (ids) => {
    currentWishlistIds = new Set(ids);
    refresh();
  });

  refresh();
}

// =======================================================
// 🏪 MY SHOP MANAGEMENT (members/admin only)
// =======================================================
async function renderShopState(container: HTMLElement, shop: PaBentaShop | null, userId: string) {
  if (!shop) {
    renderCreateShopForm(container, userId);
    return;
  }

  if (shop.status === "pending") {
    container.innerHTML = `
      <div class="card">
        <h3>🏪 ${shop.shopName}</h3>
        <p><span class="loan-badge" style="background:#ffc107; color:#333;">⏳ Pending Review</span></p>
        <p style="opacity:.8;">Your shop is waiting for admin approval. This usually doesn't take long.</p>
      </div>
    `;
    return;
  }

  if (shop.status === "rejected") {
    container.innerHTML = `
      <div class="card">
        <h3>🏪 ${shop.shopName}</h3>
        <p><span class="loan-badge" style="background:#dc3545; color:white;">❌ Rejected</span></p>
        <p><strong>Reason:</strong> ${shop.rejectionReason || "Not specified"}</p>
        <p style="opacity:.8;">Please update your shop details and resubmit.</p>
        <button id="pabenta-resubmit-btn" class="request-loan-btn">Edit & Resubmit</button>
      </div>
    `;

    document.getElementById("pabenta-resubmit-btn")?.addEventListener("click", () => {
      renderCreateShopForm(container, userId, {
        shopName: shop.shopName,
        shopDescription: shop.shopDescription,
      });
    });
    return;
  }

  if (shop.status === "suspended") {
    container.innerHTML = `
      <div class="card">
        <h3>🏪 ${shop.shopName}</h3>
        <p><span class="loan-badge" style="background:#dc3545; color:white;">⛔ Suspended</span></p>
        <p style="opacity:.8;">Your shop has been suspended by an admin. Please contact them for details.</p>
      </div>
    `;
    return;
  }

  if (shop.status === "closed") {
    container.innerHTML = `
      <div class="card">
        <h3>🏪 ${shop.shopName}</h3>
        <p><span class="loan-badge" style="background:#6c757d; color:white;">🔒 Closed</span></p>
        ${shop.shopDescription ? `<p>${shop.shopDescription}</p>` : ""}
        <p style="opacity:.8;">Your shop is closed and hidden from the marketplace. You can reopen it anytime.</p>
        <button id="pabenta-reopen-shop-btn" class="request-loan-btn" style="margin-top:10px;">🔓 Reopen Shop</button>
      </div>
    `;

    document.getElementById("pabenta-reopen-shop-btn")?.addEventListener("click", async () => {
      try {
        await reopenShop(shop.id);
        await loadPaBentaPage();
      } catch (err: any) {
        alert(err?.message || "Failed to reopen shop.");
      }
    });
    return;
  }

  // ✅ approved
  container.innerHTML = `
    <div class="card">
      <h3>🏪 ${shop.shopName}</h3>
      <p><span class="loan-badge active">✅ Live</span></p>
      ${shop.shopDescription ? `<p>${shop.shopDescription}</p>` : ""}
      <p style="opacity:.8; font-size:13px;">Listings: ${shop.totalListings} • Views: ${shop.totalViews}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button id="pabenta-add-listing-btn" class="request-loan-btn" style="flex:1;">+ Add Product</button>
        <button id="pabenta-edit-shop-btn" class="btn-cancel" style="flex:1;">✏️ Edit Shop</button>
        <button id="pabenta-close-shop-btn" style="flex:1; background:#dc3545;">🔒 Close Shop</button>
      </div>
    </div>

    <div id="pabenta-edit-shop-form"></div>
    <div id="pabenta-add-listing-form"></div>

    <h3 style="margin-top:20px;">📦 My Listings</h3>
    <div id="pabenta-my-listings"><p>Loading...</p></div>
  `;

  document.getElementById("pabenta-add-listing-btn")?.addEventListener("click", () => {
    renderAddListingForm(shop.id);
  });

  document.getElementById("pabenta-edit-shop-btn")?.addEventListener("click", () => {
    renderEditShopForm(shop);
  });

  document.getElementById("pabenta-close-shop-btn")?.addEventListener("click", async () => {
    if (!confirm(`Close "${shop.shopName}"? Your shop and its live listings will be hidden from the marketplace. You can reopen it later.`)) return;
    try {
      await closeShop(shop.id);
      await loadPaBentaPage();
    } catch (err: any) {
      alert(err?.message || "Failed to close shop.");
    }
  });

  await renderMyListings(shop.id, userId);
}

function renderEditShopForm(shop: PaBentaShop) {
  const formEl = document.getElementById("pabenta-edit-shop-form");
  if (!formEl) return;

  formEl.innerHTML = `
    <div class="card">
      <h4>✏️ Edit Shop Details</h4>
      <div class="modal-form-group">
        <label>Shop Name</label>
        <input id="edit-shop-name" type="text" value="${shop.shopName}" />
      </div>
      <div class="modal-form-group">
        <label>Description (optional)</label>
        <textarea id="edit-shop-desc">${shop.shopDescription || ""}</textarea>
      </div>
      <div style="display:flex; gap:8px;">
        <button id="edit-shop-save-btn" class="request-loan-btn" style="flex:1;">Save Changes</button>
        <button id="edit-shop-cancel-btn" class="btn-cancel" style="flex:1;">Cancel</button>
      </div>
      <p id="edit-shop-msg" style="margin-top:10px;"></p>
    </div>
  `;

  document.getElementById("edit-shop-cancel-btn")?.addEventListener("click", () => {
    formEl.innerHTML = "";
  });

  document.getElementById("edit-shop-save-btn")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("edit-shop-msg") as HTMLElement;
    const shopName = (document.getElementById("edit-shop-name") as HTMLInputElement).value.trim();
    const shopDescription = (document.getElementById("edit-shop-desc") as HTMLTextAreaElement).value.trim();

    if (!shopName) {
      msgEl.style.color = "red";
      msgEl.textContent = "Shop name is required.";
      return;
    }

    try {
      await updateShop(shop.id, { shopName, shopDescription });
      msgEl.style.color = "green";
      msgEl.textContent = "✅ Shop updated!";
      setTimeout(() => loadPaBentaPage(), 800);
    } catch (err: any) {
      msgEl.style.color = "red";
      msgEl.textContent = err?.message || "Failed to update shop.";
    }
  });
}

function renderCreateShopForm(container: HTMLElement, userId: string, prefill?: { shopName?: string; shopDescription?: string }) {
  container.innerHTML = `
    <div class="card">
      <h3>🏪 Create Your Shop</h3>
      <p style="opacity:.8;">Set up your storefront on Pa-benta Marketplace.</p>

      <div class="modal-form-group">
        <label>Shop Name</label>
        <input id="pabenta-shop-name" type="text" placeholder="e.g., Marimar's Treats" value="${prefill?.shopName || ""}" />
      </div>

      <div class="modal-form-group">
        <label>Description (optional)</label>
        <textarea id="pabenta-shop-desc" placeholder="Tell buyers what you sell...">${prefill?.shopDescription || ""}</textarea>
      </div>

      <button id="pabenta-create-btn" class="request-loan-btn">Submit for Approval</button>
      <p id="pabenta-create-msg" style="margin-top:10px;"></p>
    </div>
  `;

  document.getElementById("pabenta-create-btn")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("pabenta-create-msg") as HTMLElement;
    const shopName = (document.getElementById("pabenta-shop-name") as HTMLInputElement).value.trim();
    const shopDescription = (document.getElementById("pabenta-shop-desc") as HTMLTextAreaElement).value.trim();

    if (!shopName) {
      msgEl.style.color = "red";
      msgEl.textContent = "Shop name is required.";
      return;
    }

    // 🪪 Require an admin-approved identity verification before a seller
    // application can even be submitted.
    if (!(await isUserIdentityVerified(userId))) {
      msgEl.style.color = "red";
      msgEl.textContent = "⚠️ Please complete your Identity Verification in Edit Profile (and wait for admin approval) before applying for a shop.";
      return;
    }

    const profileSnap = await getDoc(doc(db, "users", userId));
    const profile = profileSnap.data();
    const ownerName = profile?.fullName || profile?.email || userId;

    try {
      await createShop({ ownerId: userId, ownerName, shopName, shopDescription });
      msgEl.style.color = "green";
      msgEl.textContent = "✅ Submitted! Waiting for admin approval.";
      setTimeout(() => loadPaBentaPage(), 1200);
    } catch (err: any) {
      msgEl.style.color = "red";
      msgEl.textContent = err?.message || "Failed to submit.";
    }
  });
}

function renderAddListingForm(shopId: string) {
  const formContainer = document.getElementById("pabenta-add-listing-form");
  if (!formContainer) return;

  formContainer.innerHTML = `
    <div class="card">
      <h4>Add a Product</h4>

      <div class="modal-form-group">
        <label>Product Name</label>
        <input id="pl-name" type="text" placeholder="e.g., Homemade Ube Jam" />
      </div>

      <div class="modal-form-group">
        <label>Description (optional)</label>
        <textarea id="pl-description" placeholder="Describe your product..."></textarea>
      </div>

      <div class="modal-form-group">
        <label>Photo</label>
        <input id="pl-photo" type="file" accept="image/*" />
      </div>

      <div class="modal-form-group">
        <label>Price (₱)</label>
        <input id="pl-price" type="number" min="0" step="1" placeholder="e.g., 250" />
      </div>

      <div class="modal-form-group">
        <label>Category</label>
        <select id="pl-category">
          ${Object.entries(CATEGORY_LABELS).map(([val, label]) => `<option value="${val}">${label}</option>`).join("")}
        </select>
      </div>

      <div class="modal-form-group">
        <label>Condition</label>
        <select id="pl-condition">
          <option value="brand_new">Brand New</option>
          <option value="like_new">Like New</option>
          <option value="used">Used</option>
        </select>
      </div>

      <div class="modal-form-group">
        <label>Stock Status</label>
        <select id="pl-stock">
          <option value="in_stock">In Stock</option>
          <option value="low_stock">Low Stock</option>
          <option value="out_of_stock">Out of Stock</option>
          <option value="made_to_order">Made to Order</option>
        </select>
      </div>

      <div class="modal-form-group">
        <label>Location / Pickup Point (optional)</label>
        <input id="pl-location" type="text" placeholder="e.g., Antipolo City" />
      </div>

      <div class="modal-form-group">
        <label>Contact Number</label>
        <input id="pl-contact" type="text" placeholder="e.g., 09171234567" />
      </div>

      <div class="modal-form-group">
        <label>Preferred Contact Method</label>
        <select id="pl-contact-method">
          <option value="call">Call</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="viber">Viber</option>
          <option value="messenger">Facebook Messenger</option>
        </select>
      </div>

      <div class="modal-form-group">
        <label>Facebook Link (optional)</label>
        <input id="pl-fb" type="text" placeholder="https://facebook.com/..." />
      </div>

      <button id="pl-submit-btn" class="request-loan-btn">Submit for Approval</button>
      <p id="pl-msg" style="margin-top:10px;"></p>
    </div>
  `;

  document.getElementById("pl-submit-btn")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("pl-msg") as HTMLElement;
    const user = auth.currentUser;
    if (!user) return;

    const productName = (document.getElementById("pl-name") as HTMLInputElement).value.trim();
    const description = (document.getElementById("pl-description") as HTMLTextAreaElement).value.trim();
    const photoFile = (document.getElementById("pl-photo") as HTMLInputElement).files?.[0];
    const price = Number((document.getElementById("pl-price") as HTMLInputElement).value);
    const category = (document.getElementById("pl-category") as HTMLSelectElement).value as any;
    const condition = (document.getElementById("pl-condition") as HTMLSelectElement).value as any;
    const stockStatus = (document.getElementById("pl-stock") as HTMLSelectElement).value as any;
    const location = (document.getElementById("pl-location") as HTMLInputElement).value.trim();
    const contactNumber = (document.getElementById("pl-contact") as HTMLInputElement).value.trim();
    const preferredContactMethod = (document.getElementById("pl-contact-method") as HTMLSelectElement).value as any;
    const facebook = (document.getElementById("pl-fb") as HTMLInputElement).value.trim();

    if (!productName) { msgEl.style.color = "red"; msgEl.textContent = "Product name is required."; return; }
    if (!price || price <= 0) { msgEl.style.color = "red"; msgEl.textContent = "Please enter a valid price."; return; }
    if (!photoFile) { msgEl.style.color = "red"; msgEl.textContent = "Please upload a photo."; return; }
    if (!contactNumber) { msgEl.style.color = "red"; msgEl.textContent = "Contact number is required."; return; }

    msgEl.style.color = "blue";
    msgEl.textContent = "Uploading...";

    try {
      const imageUrl = await uploadListingImage(photoFile, shopId);

      await createListing({
        shopId,
        ownerId: user.uid,
        productName,
        description,
        imageUrls: [imageUrl],
        price,
        category,
        condition,
        stockStatus,
        location,
        contactNumber,
        preferredContactMethod,
        socialLinks: facebook ? { facebook } : {},
      });

      msgEl.style.color = "green";
      msgEl.textContent = "✅ Submitted! Waiting for admin approval.";
      setTimeout(() => loadPaBentaPage(), 1200);
    } catch (err: any) {
      msgEl.style.color = "red";
      msgEl.textContent = err?.message || "Failed to submit.";
    }
  });
}

async function renderMyListings(shopId: string, ownerId: string) {
  const el = document.getElementById("pabenta-my-listings");
  if (!el) return;

  let listings: PaBentaListing[] = [];
  try {
    listings = await getMyListings(shopId, ownerId);
  } catch (err: any) {
    console.error("Failed to load listings:", err);
    el.innerHTML = `<p style="color:red;">Failed to load your listings. Please refresh.</p>`;
    return;
  }

  if (listings.length === 0) {
    el.innerHTML = `<p style="opacity:.75;">You haven't listed any products yet.</p>`;
    return;
  }

  const statusBadge = (status: PaBentaListing["status"]) => {
    if (status === "approved") return `<span class="loan-badge active">Live</span>`;
    if (status === "pending") return `<span class="loan-badge" style="background:#ffc107; color:#333;">Pending</span>`;
    if (status === "rejected") return `<span class="loan-badge" style="background:#dc3545; color:white;">Rejected</span>`;
    return `<span class="loan-badge">Archived</span>`;
  };

  el.innerHTML = listings.map((l) => `
    <div class="card">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center;">
        ${l.imageUrls?.[0] ? `<img class="lightbox-img" src="${l.imageUrls[0]}" style="width:64px;height:64px;object-fit:cover;border-radius:10px; flex-shrink:0;" />` : ""}
        <div style="flex:1; min-width:120px;">
          <strong>${l.productName}</strong> ${statusBadge(l.status)}
          <div style="font-size:13px; opacity:.8;">₱${l.price.toLocaleString()} • ${l.stockStatus} • 👁 ${l.viewCount || 0} views</div>
          ${l.status === "rejected" ? `<p style="color:#c0392b; font-size:13px; margin-top:4px;"><strong>Reason:</strong> ${l.rejectionReason}</p>` : ""}
        </div>
        <button class="pb-delete-listing-btn" data-id="${l.id}" style="background:#dc3545; padding:0.5em; font-size:0.85em; width:100%; margin:0;">
          🗑 Delete Listing
        </button>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".pb-delete-listing-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = (btn as HTMLElement).dataset.id!;
      const listing = listings.find((l) => l.id === id);
      if (!listing) return;

      if (!confirm(`Delete "${listing.productName}"? This cannot be undone.`)) return;

      (btn as HTMLButtonElement).disabled = true;
      btn.textContent = "Deleting...";

      try {
        await deleteListing(id, shopId);
        await renderMyListings(shopId, ownerId);
      } catch (err: any) {
        console.error("Failed to delete listing:", err);
        alert(err?.message || "Failed to delete listing.");
        (btn as HTMLButtonElement).disabled = false;
        btn.textContent = "🗑 Delete";
      }
    });
  });
}