import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebaseConfig";
import {
  calcPaSwipePricing,
  TERM_OPTIONS,
  DEFAULT_DOWNPAYMENT_RATE,
} from "../utils/paSwipeCalc";

const PRODUCTS_COL = "paSwipeProducts";

function peso(n: number) {
  return `₱${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function initPaSwipeManager(container?: HTMLElement) {
  const target = container ?? document.getElementById("admin-section-content");
  if (!target) return;

  target.innerHTML = `
    <div class="card">
      <h3>🟦 Pa-Swipe Manager</h3>
      <p style="margin-top:6px; opacity:.85;">
        Add Pa-Swipe items (tier-based terms: 3/6/9/12 months).
      </p>

      <div class="modal-form-group">
        <label>Item Name</label>
        <input id="ps-title" type="text" placeholder="e.g., iPhone 13 128GB" />
      </div>

      <div class="modal-form-group">
        <label>Category</label>
        <select id="ps-category">
          <option value="phones">Phones</option>
          <option value="appliances">Appliances</option>
          <option value="others">Others</option>
        </select>
      </div>

      <div class="modal-form-group">
        <label>SRP (₱)</label>
        <input id="ps-srp" type="number" min="0" step="1" placeholder="e.g., 45000" />
      </div>

      <div class="modal-form-group">
        <label>Preview Term</label>
        <select id="ps-preview-term">
          ${TERM_OPTIONS.map(t => `<option value="${t}">${t} months</option>`).join("")}
        </select>
        <small style="opacity:.7;">Interest is computed automatically by term tier (10/20/30/40%).</small>
      </div>

      <div class="modal-form-group">
        <label>Photo</label>
        <input id="ps-photo" type="file" accept="image/*" />
        <small style="opacity:.7;">Required for new items. Optional on edit (keeps old photo if none).</small>
      </div>

      <div class="card" style="background:#f7f7f7; margin-top:10px;">
        <h4 style="margin:0 0 8px 0;">Live Preview (20% downpayment)</h4>
        <div id="ps-preview" style="line-height:1.7; color:#222;">
          <div>SRP: <strong>-</strong></div>
          <div>Downpayment: <strong>-</strong></div>
          <div>Interest Rate: <strong>-</strong></div>
          <div>Interest Amount: <strong>-</strong></div>
          <div>Remaining Balance: <strong>-</strong></div>
          <div>Semi-Monthly Installment: <strong>-</strong></div>
        </div>
      </div>

      <button id="ps-save" class="request-loan-btn" style="margin-top:10px;">✅ Save Item</button>
      <p id="ps-msg" style="margin-top:10px;"></p>
    </div>

    <div class="card">
      <h3>Existing Items</h3>
      <div id="ps-items"></div>
    </div>
  `;

  const titleEl = document.getElementById("ps-title") as HTMLInputElement;
  const categoryEl = document.getElementById("ps-category") as HTMLSelectElement;
  const srpEl = document.getElementById("ps-srp") as HTMLInputElement;
  const previewTermEl = document.getElementById("ps-preview-term") as HTMLSelectElement;
  const photoEl = document.getElementById("ps-photo") as HTMLInputElement;
  const previewEl = document.getElementById("ps-preview") as HTMLElement;
  const msgEl = document.getElementById("ps-msg") as HTMLElement;
  const saveBtn = document.getElementById("ps-save") as HTMLButtonElement;
  const itemsEl = document.getElementById("ps-items") as HTMLElement;

  function refreshPreview() {
    const srp = Number(srpEl.value || 0);
    const term = Number(previewTermEl.value || 12);

    const pricing = calcPaSwipePricing({
      srp,
      termMonths: term,
      downpaymentRate: DEFAULT_DOWNPAYMENT_RATE,
    });

    previewEl.innerHTML = `
      <div>SRP: <strong>${srp ? peso(srp) : "-"}</strong></div>
      <div>Downpayment: <strong>${srp ? peso(pricing.downpayment) : "-"}</strong></div>
      <div>Interest Rate: <strong>${srp ? `${(pricing.interestRate * 100).toFixed(0)}%` : "-"}</strong></div>
      <div>Interest Amount: <strong>${srp ? peso(pricing.interest) : "-"}</strong></div>
      <div>Remaining Balance: <strong>${srp ? peso(pricing.remainingBalance) : "-"}</strong></div>
      <div>Semi-Monthly Installment (${pricing.termMonths} months, ${pricing.installmentCount} payments): <strong>${srp ? peso(pricing.installmentAmount) : "-"}</strong></div>
    `;
  }

  srpEl.addEventListener("input", refreshPreview);
  previewTermEl.addEventListener("change", refreshPreview);
  refreshPreview();

  saveBtn.addEventListener("click", async () => {
    msgEl.textContent = "";
    msgEl.style.color = "red";

    const title = titleEl.value.trim();
    const category = categoryEl.value;
    const srp = Number(srpEl.value);

    if (!title) return (msgEl.textContent = "Item name is required.");
    if (!srp || srp <= 0) return (msgEl.textContent = "SRP must be greater than 0.");

    try {
      saveBtn.disabled = true;

      const editingId = saveBtn.dataset.editingId;
      let imageUrl: string | undefined;

      const file = photoEl.files?.[0];

      // ✅ New item requires image; edit can keep existing image if none uploaded
      if (!editingId && !file) {
        msgEl.textContent = "Please upload a photo.";
        saveBtn.disabled = false;
        return;
      }

      if (file) {
        const path = `paSwipeProducts/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        imageUrl = await getDownloadURL(storageRef);
      }

      if (editingId) {
        const docRef = doc(db, PRODUCTS_COL, editingId);

        const updatePayload: any = {
          title,
          category,
          srp,
          updatedAt: serverTimestamp(),
        };

        if (imageUrl) updatePayload.imageUrl = imageUrl;

        await updateDoc(docRef, updatePayload);

        delete saveBtn.dataset.editingId;
        msgEl.style.color = "green";
        msgEl.textContent = "✅ Item updated.";
      } else {
        await addDoc(collection(db, PRODUCTS_COL), {
          title,
          category,
          srp,
          imageUrl,
          isActive: true,
          stockStatus: "in_stock",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        msgEl.style.color = "green";
        msgEl.textContent = "✅ Item saved.";
      }

      // reset form
      titleEl.value = "";
      srpEl.value = "";
      previewTermEl.value = "12";
      photoEl.value = "";
      refreshPreview();
    } catch (err: any) {
      console.error(err);
      msgEl.textContent = err?.message || "Failed to save item.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  // List existing products
  const q = query(collection(db, PRODUCTS_COL), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    if (snap.empty) {
      itemsEl.innerHTML = `<p style="opacity:.8;">No Pa-Swipe items yet.</p>`;
      return;
    }

    itemsEl.innerHTML = snap.docs
      .map((d) => {
        const p = d.data() as any;

        const pricing12 = calcPaSwipePricing({
          srp: p.srp || 0,
          termMonths: 12,
          downpaymentRate: DEFAULT_DOWNPAYMENT_RATE,
        });

        const tierLines = TERM_OPTIONS.map((t) => {
          const pr = calcPaSwipePricing({
            srp: p.srp || 0,
            termMonths: t,
            downpaymentRate: DEFAULT_DOWNPAYMENT_RATE,
          });
          return `<div style="font-size:12px; opacity:.85;">${t} mos: <strong>${peso(
            pr.installmentAmount
          )}</strong>/installment</div>`;
        }).join("");

        return `
          <div class="card" style="margin-bottom:12px;">
            <div style="display:flex; gap:12px; align-items:center;">
              <img src="${p.imageUrl}" style="width:72px; height:72px; object-fit:cover; border-radius:12px;" />
              <div style="flex:1;">
                <div style="font-weight:700;">${p.title}</div>
                <div style="opacity:.8; font-size:13px;">Category: ${p.category}</div>

                <div style="margin-top:6px; line-height:1.55;">
                  <div>SRP: <strong>${peso(p.srp || 0)}</strong></div>
                  <div>Interest Rate (12 mo): <strong>${(pricing12.interestRate * 100).toFixed(0)}%</strong></div>
                  <div>Interest (12 mo): <strong>${peso(pricing12.interest)}</strong></div>
                  <div>Remaining Balance (12 mo): <strong>${peso(pricing12.remainingBalance)}</strong></div>
                  <div style="margin-top:6px;">
                    <div style="font-weight:600; font-size:13px;">Semi-Monthly Installment by Term (20% downpayment)</div>
                    ${tierLines}
                  </div>
                </div>
              </div>

              <div style="display:flex; flex-direction:column; gap:8px;">
                <button data-edit="${d.id}">Edit</button>

                <button data-stock="${d.id}">
                  ${p.stockStatus === "out_of_stock" ? "Mark In Stock" : "Mark Out of Stock"}
                </button>

                <button data-toggle="${d.id}">
                  ${p.isActive ? "Disable" : "Enable"}
                </button>

                <button data-delete="${d.id}" style="background:#dc3545;">
                  Delete
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // ✅ Edit button
    itemsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLButtonElement).dataset.edit!;
        const current = snap.docs.find((x) => x.id === id)?.data() as any;
        if (!current) return;

        titleEl.value = current.title ?? "";
        categoryEl.value = current.category ?? "phones";
        srpEl.value = String(current.srp ?? "");
        previewTermEl.value = "12";
        photoEl.value = "";

        refreshPreview();

        saveBtn.dataset.editingId = id;

        if (!current.imageUrl) {
          msgEl.style.color = "orange";
          msgEl.textContent =
            "⚠️ This item currently has NO photo. Please upload one before saving.";
        } else {
          msgEl.style.color = "blue";
          msgEl.textContent = "✏️ Editing item — update fields then click Save. (Photo optional)";
        }
      });
    });

    // ✅ Stock toggle
    itemsEl.querySelectorAll("button[data-stock]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLButtonElement).dataset.stock!;
        const docRef = doc(db, PRODUCTS_COL, id);
        const current = snap.docs.find((x) => x.id === id)?.data() as any;
        if (!current) return;

        const nextStatus =
          current.stockStatus === "out_of_stock" ? "in_stock" : "out_of_stock";

        await updateDoc(docRef, {
          stockStatus: nextStatus,
          updatedAt: serverTimestamp(),
        });
      });
    });

    // ✅ Active toggle
    itemsEl.querySelectorAll("button[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLButtonElement).dataset.toggle!;
        const docRef = doc(db, PRODUCTS_COL, id);
        const current = snap.docs.find((x) => x.id === id)?.data() as any;
        await updateDoc(docRef, {
          isActive: !current.isActive,
          updatedAt: serverTimestamp(),
        });
      });
    });

    // ✅ Delete
    itemsEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = (btn as HTMLButtonElement).dataset.delete!;
        if (!confirm("Delete this Pa-Swipe item?")) return;
        await deleteDoc(doc(db, PRODUCTS_COL, id));
      });
    });
  });
}