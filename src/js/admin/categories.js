/**
 * JACMAT STORE — Categories Controller
 */

import { initAdminLayout, showAdminToast } from "./admin-layout.js";
import { escapeHtml } from "../utils/sanitize.js";

document.addEventListener("DOMContentLoaded", async () => {
  const isAuthorized = await initAdminLayout("categories");
  if (!isAuthorized) return;

  const tableBody = document.getElementById("categories-table-body");
  const addForm = document.getElementById("add-category-form");
  const catNameInput = document.getElementById("cat-name");
  const catSlugInput = document.getElementById("cat-slug");
  const catDescInput = document.getElementById("cat-desc");
  const addBtn = document.getElementById("add-category-btn");

  let categories = [];
  let products = [];

  // Auto slugify category name
  catNameInput.addEventListener("input", () => {
    catSlugInput.value = catNameInput.value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  });

  async function loadData() {
    try {
      const [catRes, prodRes] = await Promise.all([
        fetch("/api/admin/categories"),
        fetch("/api/admin/products")
      ]);

      categories = catRes.ok ? await catRes.json() : [];
      products = prodRes.ok ? await prodRes.json() : [];

      renderCategoriesTable();
    } catch (err) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 32px; color: #dc2626;">
            Impossible de charger les catégories.
          </td>
        </tr>
      `;
    }
  }

  function renderCategoriesTable() {
    if (categories.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 32px; color: var(--admin-text-muted);">
            Aucune catégorie configurée.
          </td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = categories
      .map((cat) => {
        const catId = cat.id || cat.slug;
        const linkedCount = products.filter((p) => p.category === catId || p.category === cat.slug).length;
        const safeName = escapeHtml(cat.name);
        const safeSlug = escapeHtml(cat.slug);
        const safeDesc = escapeHtml(cat.description || "—");
        const safeId = escapeHtml(catId);

        return `
          <tr>
            <td>
              <strong style="color: var(--admin-text-main); font-size: 14px;">${safeName}</strong>
            </td>
            <td>
              <code style="background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${safeSlug}</code>
            </td>
            <td style="color: var(--admin-text-muted); font-size: 13px;">
              ${safeDesc}
            </td>
            <td>
              <span class="admin-badge admin-badge-published">
                ${linkedCount} pièce${linkedCount > 1 ? "s" : ""}
              </span>
            </td>
            <td style="text-align: right;">
              <button type="button" class="admin-btn admin-btn-danger admin-btn-sm delete-cat-btn" data-id="${safeId}" data-count="${linkedCount}" data-name="${safeName}">
                Supprimer
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    // Attach delete listeners
    tableBody.querySelectorAll(".delete-cat-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const count = Number(btn.dataset.count);

        if (count > 0) {
          showAdminToast(`Action bloquée : ${count} produit(s) sont encore associés à « ${name} ».`, "error");
          return;
        }

        if (!confirm(`Confirmer la suppression de la catégorie « ${name} » ?`)) {
          return;
        }

        try {
          const res = await fetch(`/api/admin/categories?id=${encodeURIComponent(id)}`, {
            method: "DELETE"
          });
          const resData = await res.json().catch(() => ({}));

          if (res.ok) {
            showAdminToast(`Catégorie « ${name} » supprimée avec succès.`);
            loadData();
          } else {
            showAdminToast(resData.error || "Échec de la suppression.", "error");
          }
        } catch {
          showAdminToast("Erreur réseau.", "error");
        }
      });
    });
  }

  // Create category handler
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = catNameInput.value.trim();
    const slug = catSlugInput.value.trim();
    const description = catDescInput.value.trim();

    if (!name) {
      showAdminToast("Le nom de la catégorie est requis.", "error");
      catNameInput.focus();
      return;
    }

    addBtn.disabled = true;
    addBtn.textContent = "Création...";

    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, description })
      });

      const resData = await res.json().catch(() => ({}));

      if (res.ok) {
        showAdminToast(`Catégorie « ${name} » ajoutée avec succès !`);
        addForm.reset();
        loadData();
      } else {
        showAdminToast(resData.error || "Impossible de créer la catégorie.", "error");
      }
    } catch {
      showAdminToast("Erreur réseau.", "error");
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = "Créer la catégorie";
    }
  });

  loadData();
});
