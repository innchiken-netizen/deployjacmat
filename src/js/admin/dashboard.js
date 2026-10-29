/**
 * JACMAT STORE — Admin Dashboard Controller
 */

import { initAdminLayout, showAdminToast } from "./admin-layout.js";
import { saveStatusOverride, applyLocalStoreSync } from "../store-sync.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

document.addEventListener("DOMContentLoaded", async () => {
  const isAuthorized = await initAdminLayout("dashboard");
  if (!isAuthorized) return;

  const statTotal = document.getElementById("stat-total-products");
  const statPublished = document.getElementById("stat-published-products");
  const statDraft = document.getElementById("stat-draft-products");
  const statOutOfStock = document.getElementById("stat-outofstock-products");
  const statCategories = document.getElementById("stat-categories-count");
  const recentTableBody = document.getElementById("recent-products-table-body");

  // Load Real Stats
  try {
    const statsRes = await fetch("/api/admin/stats");
    if (statsRes.ok) {
      const stats = await statsRes.json();
      statTotal.textContent = stats.totalProducts;
      statPublished.textContent = stats.publishedProducts;
      statDraft.textContent = stats.draftProducts;
      statOutOfStock.textContent = stats.outOfStockProducts;
      statCategories.textContent = stats.categoriesCount;
    }
  } catch (err) {
    console.error("Failed to load store stats:", err);
  }

  // Load Recent Products
  try {
    const prodRes = await fetch("/api/admin/products");
    if (prodRes.ok) {
      const fetched = await prodRes.json();
      const products = applyLocalStoreSync(fetched);
      const recent = products.slice(0, 6);

      if (recent.length === 0) {
        recentTableBody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; padding: 40px; color: var(--admin-text-muted);">
              Aucun produit dans le catalogue. <a href="/admin/products/new">Créer un premier produit</a>
            </td>
          </tr>
        `;
        return;
      }

      recentTableBody.innerHTML = recent
        .map((p) => {
          const imgUrl = sanitizeImageUrl(p.images && p.images[0] ? p.images[0] : "/placeholder.png");
          const isPublished = p.status === "published";
          const isSoldOut = Boolean(p.soldOut);
          const safeName = escapeHtml(p.name);
          const safeSlug = escapeHtml(p.slug);
          const safeCategory = escapeHtml(p.category || "Tops");
          const safeId = escapeHtml(p.id);
          const safeStatus = escapeHtml(p.status);

          return `
            <tr>
              <td>
                <img src="${imgUrl}" alt="${safeName}" class="admin-product-thumb" loading="lazy">
              </td>
              <td>
                <strong style="color: var(--admin-text-main);">${safeName}</strong>
                <div style="font-size: 11.5px; color: var(--admin-text-muted);">${safeSlug}</div>
              </td>
              <td>
                <span style="text-transform: capitalize; font-weight: 500;">${safeCategory}</span>
              </td>
              <td>
                <strong>${Number(p.price).toFixed(2).replace(/\.?0+$/, "")}$</strong>
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
                <div style="display: inline-flex; gap: 8px;">
                  <a href="/admin/products/edit?id=${encodeURIComponent(p.id)}" class="admin-btn admin-btn-secondary admin-btn-sm">
                    Modifier
                  </a>
                  <button type="button" class="admin-btn admin-btn-secondary admin-btn-sm toggle-status-btn" data-id="${safeId}" data-current="${safeStatus}">
                    ${isPublished ? "Masquer" : "Publier"}
                  </button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("");

      // Attach status toggle listeners
      recentTableBody.querySelectorAll(".toggle-status-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.dataset.id;
          const current = btn.dataset.current;
          const newStatus = current === "published" ? "draft" : "published";
          const item = products.find((p) => p.id === id || p.slug === id);

          saveStatusOverride(id, newStatus);
          if (item && item.slug) saveStatusOverride(item.slug, newStatus);

          try {
            const updateRes = await fetch("/api/admin/products", {
              method: "PUT",
              keepalive: true,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...(item || {}), id, status: newStatus })
            });

            if (updateRes.ok) {
              showAdminToast(`Produit ${newStatus === "published" ? "publié" : "passé en brouillon"}`);
              setTimeout(() => window.location.reload(), 500);
            } else {
              showAdminToast("Échec de la mise à jour", "error");
            }
          } catch {
            showAdminToast("Erreur réseau", "error");
          }
        });
      });
    }
  } catch (err) {
    console.error("Failed to load recent products:", err);
  }
});
