/**
 * JACMAT STORE — Products List Controller
 */

import { initAdminLayout, showAdminToast } from "./admin-layout.js";
import { saveStatusOverride, saveDeletedProductId, applyLocalStoreSync } from "../store-sync.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

document.addEventListener("DOMContentLoaded", async () => {
  const isAuthorized = await initAdminLayout("products");
  if (!isAuthorized) return;

  const tableBody = document.getElementById("products-table-body");
  const mobileCards = document.getElementById("products-mobile-cards");
  const searchInput = document.getElementById("product-search-input");
  const categoryFilter = document.getElementById("category-filter");
  const statusFilter = document.getElementById("status-filter");

  // Modal elements
  const deleteModal = document.getElementById("delete-modal");
  const deleteProductName = document.getElementById("delete-product-name");
  const cancelDeleteBtn = document.getElementById("cancel-delete-btn");
  const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

  let allProducts = [];
  let productToDelete = null;

  // 1. Fetch categories for filter dropdown
  try {
    const catRes = await fetch("/api/admin/categories");
    if (catRes.ok) {
      const categories = await catRes.json();
      categories.forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat.id || cat.slug;
        opt.textContent = cat.name;
        categoryFilter.appendChild(opt);
      });
    }
  } catch (err) {
    console.error("Failed to load categories:", err);
  }

  // 2. Load all products
  async function loadProducts() {
    try {
      const res = await fetch("/api/admin/products?v=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur de chargement");
      const fetched = await res.json();
      allProducts = applyLocalStoreSync(fetched);
      renderFilteredProducts();
    } catch (err) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: #dc2626;">
            Impossible de charger la liste des produits.
          </td>
        </tr>
      `;
    }
  }

  // 3. Filter & Render
  function renderFilteredProducts() {
    const query = (searchInput.value || "").toLowerCase().trim();
    const catVal = categoryFilter.value;
    const statusVal = statusFilter.value;

    const filtered = allProducts.filter((p) => {
      // Search
      const matchSearch =
        !query ||
        p.name.toLowerCase().includes(query) ||
        (p.slug && p.slug.toLowerCase().includes(query)) ||
        (p.sku && p.sku.toLowerCase().includes(query));

      // Category
      const matchCat = catVal === "all" || p.category === catVal;

      // Status
      let matchStatus = true;
      if (statusVal === "published") matchStatus = p.status === "published";
      else if (statusVal === "draft") matchStatus = p.status === "draft";
      else if (statusVal === "soldout") matchStatus = Boolean(p.soldOut);

      return matchSearch && matchCat && matchStatus;
    });

    if (filtered.length === 0) {
      const emptyRow = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: var(--admin-text-muted);">
            Aucun produit ne correspond à vos critères de recherche.
          </td>
        </tr>
      `;
      tableBody.innerHTML = emptyRow;
      mobileCards.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--admin-text-muted);">Aucun produit trouvé.</div>`;
      return;
    }

    // Render Desktop Rows
    tableBody.innerHTML = filtered
      .map((p) => {
        const imgUrl = sanitizeImageUrl(p.images && p.images[0] ? p.images[0] : "/placeholder.png");
        const isPublished = p.status === "published";
        const isSoldOut = Boolean(p.soldOut);
        const priceDisplay = Number(p.price).toFixed(2).replace(/\.?0+$/, "");
        const safeName = escapeHtml(p.name);
        const safeSlug = escapeHtml(p.slug);
        const safeSku = escapeHtml(p.sku);
        const safeCategory = escapeHtml(p.category || "Tops");
        const safeId = escapeHtml(p.id);
        const safeStatus = escapeHtml(p.status);
        const skuBadge = p.sku
          ? `<span style="display: inline-block; font-family: monospace; font-size: 11px; background: #f4f4f5; color: #18181b; padding: 2px 6px; border-radius: 4px; font-weight: 700; margin-right: 6px;">${safeSku}</span>`
          : "";

        return `
          <tr>
            <td>
              <img src="${imgUrl}" alt="${safeName}" class="admin-product-thumb" loading="lazy">
            </td>
            <td>
              <strong style="color: var(--admin-text-main); font-size: 14px;">${safeName}</strong>
              <div style="font-size: 11.5px; color: var(--admin-text-muted); margin-top: 2px;">
                ${skuBadge}${safeSlug}
              </div>
            </td>
            <td>
              <span style="text-transform: capitalize; font-weight: 500;">${safeCategory}</span>
            </td>
            <td>
              <strong>${priceDisplay}$</strong>
            </td>
            <td>
              <span class="admin-badge ${isPublished ? "admin-badge-published" : "admin-badge-draft"}">
                ${isPublished ? "Publié" : "Brouillon"}
              </span>
            </td>
            <td>
              ${isSoldOut
                ? '<span class="admin-badge admin-badge-soldout">Épuisé</span>'
                : '<span style="color: #16a34a; font-weight: 600; font-size: 12px;">En stock</span>'
              }
            </td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm toggle-status-btn" data-id="${safeId}" data-current="${safeStatus}">
                  ${isPublished ? "Masquer" : "Publier"}
                </button>
                <a href="/admin/products/edit?id=${encodeURIComponent(p.id)}" class="admin-btn admin-btn-secondary admin-btn-sm">
                  Modifier
                </a>
                <button type="button" class="admin-btn admin-btn-danger admin-btn-sm delete-product-btn" data-id="${safeId}" data-name="${safeName}">
                  Supprimer
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    // Render Mobile Cards
    mobileCards.innerHTML = filtered
      .map((p) => {
        const imgUrl = sanitizeImageUrl(p.images && p.images[0] ? p.images[0] : "/placeholder.png");
        const isPublished = p.status === "published";
        const priceDisplay = Number(p.price).toFixed(2).replace(/\.?0+$/, "");
        const safeName = escapeHtml(p.name);
        const safeSku = escapeHtml(p.sku);
        const safeCategory = escapeHtml(p.category || "Tops");
        const safeId = escapeHtml(p.id);
        const safeStatus = escapeHtml(p.status);
        const skuBadge = p.sku
          ? `<span style="font-family: monospace; font-size: 11px; font-weight: 700; background: #f4f4f5; padding: 1px 5px; border-radius: 3px; color: #18181b;">${safeSku}</span> • `
          : "";

        return `
          <div class="admin-mobile-product-card">
            <img src="${imgUrl}" alt="${safeName}">
            <div class="admin-mobile-product-details">
              <div class="admin-mobile-product-title">${safeName}</div>
              <div class="admin-mobile-product-meta">
                ${skuBadge}${priceDisplay}$ • ${safeCategory} •
                <span class="admin-badge ${isPublished ? "admin-badge-published" : "admin-badge-draft"}" style="padding: 1px 6px;">
                  ${isPublished ? "Publié" : "Brouillon"}
                </span>
              </div>
              <div class="admin-mobile-actions">
                <a href="/admin/products/edit?id=${encodeURIComponent(p.id)}" class="admin-btn admin-btn-secondary admin-btn-sm" style="flex: 1;">
                  Modifier
                </a>
                <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm toggle-status-btn" data-id="${safeId}" data-current="${safeStatus}">
                  ${isPublished ? "Masquer" : "Publier"}
                </button>
                <button type="button" class="admin-btn admin-btn-danger admin-btn-sm delete-product-btn" data-id="${safeId}" data-name="${safeName}">
                  Suppr.
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    attachActionListeners();
  }

  // 4. Attach Action Listeners
  function attachActionListeners() {
    // Quick Status Toggle
    document.querySelectorAll(".toggle-status-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const current = btn.dataset.current;
        const newStatus = current === "published" ? "draft" : "published";

        saveStatusOverride(id, newStatus);
        const item = allProducts.find((p) => p.id === id || p.slug === id);
        if (item) item.status = newStatus;
        renderFilteredProducts();
        showAdminToast(`Produit ${newStatus === "published" ? "publié" : "passé en brouillon"}`);

        fetch("/api/admin/products", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status: newStatus })
        }).catch(() => {});
      });
    });

    // Delete Buttons (trigger confirmation dialog)
    document.querySelectorAll(".delete-product-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        productToDelete = {
          id: btn.dataset.id,
          name: btn.dataset.name
        };
        deleteProductName.textContent = `« ${productToDelete.name} »`;
        deleteModal.classList.add("is-open");
      });
    });
  }

  // Modal Cancel
  const closeDeleteModal = () => {
    deleteModal.classList.remove("is-open");
    productToDelete = null;
  };
  cancelDeleteBtn.addEventListener("click", closeDeleteModal);
  deleteModal.addEventListener("click", (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && deleteModal.classList.contains("is-open")) {
      closeDeleteModal();
    }
  });

  // Modal Confirm Delete
  confirmDeleteBtn.addEventListener("click", async () => {
    if (!productToDelete) return;

    confirmDeleteBtn.disabled = true;
    confirmDeleteBtn.textContent = "Suppression...";

    saveDeletedProductId(productToDelete.id);
    allProducts = allProducts.filter((p) => p.id !== productToDelete.id && p.slug !== productToDelete.id);
    deleteModal.classList.remove("is-open");
    renderFilteredProducts();
    showAdminToast(`Le produit « ${productToDelete.name} » a été supprimé`);

    fetch(`/api/admin/products?id=${encodeURIComponent(productToDelete.id)}`, {
      method: "DELETE"
    }).catch(() => {});

    confirmDeleteBtn.disabled = false;
    confirmDeleteBtn.textContent = "Supprimer définitivement";
    productToDelete = null;
  });

  // Filter events
  searchInput.addEventListener("input", renderFilteredProducts);
  categoryFilter.addEventListener("change", renderFilteredProducts);
  statusFilter.addEventListener("change", renderFilteredProducts);

  // Initial Load
  loadProducts();
});
