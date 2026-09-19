// src/pages/paBenta.ts
import { auth, db } from "../firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { createShop, getMyShop, type PaBentaShop } from "../services/paBentaShopService";
import { createListing, getMyListings, uploadListingImage, type PaBentaListing } from "../services/paBentaListingService";

export async function loadPaBentaPage() {
  const container = document.getElementById("marketplace-content") as HTMLElement | null;
  if (!container) return;

  const user = auth.currentUser;
  if (!user) {
    container.innerHTML = `<p>Please sign in.</p>`;
    return;
  }

  container.innerHTML = `<p>Loading...</p>`;

  const shop = await getMyShop(user.uid);
  await renderShopState(container, shop, user.uid);
}

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

  // ✅ approved
  container.innerHTML = `
    <div class="card">
      <h3>🏪 ${shop.shopName}</h3>
      <p><span class="loan-badge active">✅ Live</span></p>
      ${shop.shopDescription ? `<p>${shop.shopDescription}</p>` : ""}
      <p style="opacity:.8; font-size:13px;">Listings: ${shop.totalListings} • Views: ${shop.totalViews}</p>
      <button id="pabenta-add-listing-btn" class="request-loan-btn" style="margin-top:10px;">+ Add Product</button>
    </div>

    <div id="pabenta-add-listing-form"></div>

    <h3 style="margin-top:20px;">📦 My Listings</h3>
    <div id="pabenta-my-listings"><p>Loading...</p></div>
  `;

  document.getElementById("pabenta-add-listing-btn")?.addEventListener("click", () => {
    renderAddListingForm(shop.id);
  });

  await renderMyListings(shop.id);
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
          <option value="food">Food & Beverage</option>
          <option value="apparel">Apparel</option>
          <option value="home">Home & Living</option>
          <option value="electronics">Electronics</option>
          <option value="services">Services</option>
          <option value="other">Other</option>
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

async function renderMyListings(shopId: string) {
  const el = document.getElementById("pabenta-my-listings");
  if (!el) return;

  const listings = await getMyListings(shopId);

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
      <div style="display:flex; gap:12px; align-items:center;">
        ${l.imageUrls?.[0] ? `<img class="lightbox-img" src="${l.imageUrls[0]}" style="width:64px;height:64px;object-fit:cover;border-radius:10px;" />` : ""}
        <div style="flex:1;">
          <strong>${l.productName}</strong> ${statusBadge(l.status)}
          <div style="font-size:13px; opacity:.8;">₱${l.price.toLocaleString()} • ${l.stockStatus}</div>
          ${l.status === "rejected" ? `<p style="color:#c0392b; font-size:13px; margin-top:4px;"><strong>Reason:</strong> ${l.rejectionReason}</p>` : ""}
        </div>
      </div>
    </div>
  `).join("");
}