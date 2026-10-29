import { fetchProducts, formatPrice, getEffectivePrice, hasProductVariants, getProductCategory, getProductCategoryLabel, normalizeText, slugify } from "../api.js";
import { cartState } from "../state.js";
import { openVariantModal } from "../components/variant-modal.js";
import { showToast } from "../components/toast.js";
import { openCartDrawer } from "../components/cart-drawer.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

export async function initShopPage() {
  const container = document.getElementById("catalog-grid");
  const countLabel = document.getElementById("catalog-count");
  const searchInput = document.getElementById("shop-search-input");
  const sortSelect = document.getElementById("catalog-sort-select");

  const urlParams = new URLSearchParams(window.location.search);
  let activeSearch = urlParams.get("q") || "";
  let activeCategory = urlParams.get("category") || "all";
  let activeSort = "featured";

  if (searchInput) searchInput.value = activeSearch;

  const products = await fetchProducts();

  // Dynamically load categories
  let categories = [
    { id: "all", name: "Tous les articles" },
    { id: "tops", name: "Tops & T-Shirts" },
    { id: "outerwear", name: "Outerwear & Sweats" },
    { id: "accessories", name: "Accessoires" }
  ];

  try {
    const catRes = await fetch("/api/categories");
    if (catRes.ok) {
      const serverCats = await catRes.json();
      if (Array.isArray(serverCats) && serverCats.length > 0) {
        categories = [{ id: "all", name: "Tous les articles" }, ...serverCats];
      }
    }
  } catch {}

  // Also discover any extra category found on products
  const existingCatIds = new Set(categories.map((c) => c.id || c.slug));
  products.forEach((p) => {
    const cat = getProductCategory(p);
    if (cat && !existingCatIds.has(cat)) {
      existingCatIds.add(cat);
      categories.push({ id: cat, name: getProductCategoryLabel(p) });
    }
  });

  const chipsContainer = document.querySelector(".category-filter-chips");
  function renderCategoryChips() {
    if (!chipsContainer) return;
    chipsContainer.innerHTML = categories
      .map((c) => {
        const catId = c.id || c.slug || "";
        return `<button type="button" class="filter-chip ${catId === activeCategory ? "is-active" : ""}" data-category="${escapeHtml(catId)}">${escapeHtml(c.name)}</button>`;
      })
      .join("");

    chipsContainer.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        activeCategory = chip.dataset.category || "all";
        chipsContainer.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        applyFilters();
      });
    });
  }
  renderCategoryChips();

  function applyFilters() {
    if (!container) return;

    const query = normalizeText(activeSearch);

    let filtered = products.filter((product) => {
      // Exclude masked / draft items
      if (product.status && product.status === "draft") return false;

      const matchesCat = activeCategory === "all" || getProductCategory(product) === activeCategory;
      if (!query) return matchesCat;

      const variantText = product.variants
        ? Object.entries(product.variants).flatMap(([k, vals]) => [k, ...(Array.isArray(vals) ? vals : [])]).join(" ")
        : "";
      const searchTarget = normalizeText(`${product.name} ${getEffectivePrice(product)} ${variantText}`);
      return matchesCat && searchTarget.includes(query);
    });

    // Apply sorting
    if (activeSort === "price-asc") {
      filtered.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
    } else if (activeSort === "price-desc") {
      filtered.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
    } else if (activeSort === "name-asc") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Update count label
    if (countLabel) {
      countLabel.textContent = `${filtered.length} pièce${filtered.length > 1 ? "s" : ""} disponible${filtered.length > 1 ? "s" : ""}`;
    }

    if (filtered.length === 0) {
      const safeTerm = escapeHtml(activeSearch || activeCategory);
      container.innerHTML = `
        <div class="catalog-empty-state" style="grid-column: 1/-1;">
          <h3>Aucun produit trouvé</h3>
          <p>Aucune pièce ne correspond à votre recherche "${safeTerm}".</p>
          <button type="button" class="btn btn-secondary btn-sm" id="reset-filters-btn">Réinitialiser les filtres</button>
        </div>
      `;

      document.getElementById("reset-filters-btn")?.addEventListener("click", () => {
        activeSearch = "";
        activeCategory = "all";
        if (searchInput) searchInput.value = "";
        if (chipsContainer) {
          chipsContainer.querySelectorAll(".filter-chip").forEach((c) => c.classList.toggle("is-active", c.dataset.category === "all"));
        }
        applyFilters();
      });
      return;
    }

    container.innerHTML = filtered
      .map((product) => {
        const primaryImg = sanitizeImageUrl(product.images?.[0]);
        const secondaryImg = sanitizeImageUrl(product.images?.[1] || primaryImg);
        const hasSecondary = Array.isArray(product.images) && product.images.length > 1;
        const rawSlug = product.slug || slugify(product.name);
        const slug = escapeHtml(rawSlug);
        const safeName = escapeHtml(product.name);
        const safeCategory = escapeHtml(getProductCategoryLabel(product));
        const effectivePrice = getEffectivePrice(product);
        const hasSale = effectivePrice < Number(product.price);
        const needsVariantModal = hasProductVariants(product);

        let badgeHtml = "";
        if (product.soldOut) {
          badgeHtml = `<span class="badge badge-soldout">Sold Out</span>`;
        } else if (product.preOrder) {
          badgeHtml = `<span class="badge badge-preorder">Pre-Order</span>`;
        } else {
          badgeHtml = `<span class="badge badge-drop">Drop</span>`;
        }

        const priceHtml = hasSale
          ? `<span class="product-price"><del style="opacity:0.5;font-size:0.85em;margin-right:4px;">${formatPrice(product.price)}$</del>${formatPrice(effectivePrice)}$</span>`
          : `<span class="product-price">${formatPrice(effectivePrice)}$</span>`;

        return `
          <article class="product-card ${product.soldOut ? "is-sold-out" : ""}" data-product-id="${slug}">
            <div class="product-media">
              <div class="product-badges">${badgeHtml}</div>
              <a href="/product?p=${encodeURIComponent(rawSlug)}" aria-label="Voir ${safeName}">
                <img src="${primaryImg}" alt="${safeName}" class="product-img img-primary" loading="lazy">
                ${
                  hasSecondary
                    ? `<img src="${secondaryImg}" alt="${safeName} vue alternative" class="product-img img-secondary" loading="lazy">`
                    : `<img src="${primaryImg}" alt="${safeName}" class="product-img no-secondary" loading="lazy">`
                }
              </a>
            </div>
            <div class="product-content">
              <div>
                <div class="product-category-tag">${safeCategory}</div>
                <h3 class="product-title">
                  <a href="/product?p=${encodeURIComponent(rawSlug)}">${safeName}</a>
                </h3>
              </div>
              <div class="product-bottom-row">
                ${priceHtml}
                ${
                  product.soldOut
                    ? `<span class="badge badge-soldout">Épuisé</span>`
                    : `<button type="button" class="product-quick-btn quick-add-btn" data-product-id="${escapeHtml(product.id || rawSlug)}">
                        ${needsVariantModal ? "Options" : "Ajouter"}
                      </button>`
                }
              </div>
            </div>
          </article>
        `;
      })
      .join("");

    // Quick add event listeners
    container.querySelectorAll(".quick-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.productId;
        const product = products.find((p) => (p.id || p.slug || slugify(p.name)) === targetId || p.name === targetId);
        if (!product) return;

        if (hasProductVariants(product)) {
          openVariantModal(product);
        } else {
          cartState.addToCart(product);
          showToast(`Ajouté au panier : ${product.name}`);
          openCartDrawer();
        }
      });
    });
  }

  // Live search input
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      activeSearch = searchInput.value.trim();
      applyFilters();
    });
  }

  // Sort select
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      activeSort = sortSelect.value;
      applyFilters();
    });
  }

  // Initial display
  applyFilters();
}
