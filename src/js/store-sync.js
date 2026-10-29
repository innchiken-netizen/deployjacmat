/**
 * JACMAT STORE — Live Catalog & Version Sync Manager
 * Ensures real-time consistency between Admin and Storefront:
 * - Version checking & auto-refresh
 * - Instant status overrides (masks drafts immediately)
 * - Newly added product propagation
 * - Cache busting & stale cookie cleanup
 */

export const JACMAT_VERSION = "2.2.0";

const STORAGE_KEY_OVERRIDES = "jacmat_status_overrides_v2";
const STORAGE_KEY_NEW_PRODS = "jacmat_created_products_v2";
const STORAGE_KEY_DELETED = "jacmat_deleted_products_v2";
const STORAGE_KEY_VERSION = "jacmat_catalog_version_v2";

export function getStatusOverrides() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OVERRIDES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStatusOverride(idOrSlug, status) {
  try {
    const overrides = getStatusOverrides();
    overrides[idOrSlug] = status;
    localStorage.setItem(STORAGE_KEY_OVERRIDES, JSON.stringify(overrides));
    localStorage.setItem(STORAGE_KEY_VERSION, String(Date.now()));
    window.dispatchEvent(new CustomEvent("jacmat:catalog-changed", { detail: { id: idOrSlug, status } }));
  } catch (e) {
    console.warn("Failed to save status override:", e);
  }
}

export function getCreatedProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_NEW_PRODS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCreatedProduct(product) {
  try {
    const list = getCreatedProducts();
    const id = product.id || product.slug || `prod_${Date.now()}`;
    product.id = id;
    const existingIdx = list.findIndex((p) => p.id === id || p.slug === product.slug);
    if (existingIdx >= 0) {
      list[existingIdx] = product;
    } else {
      list.unshift(product);
    }
    localStorage.setItem(STORAGE_KEY_NEW_PRODS, JSON.stringify(list));
    localStorage.setItem(STORAGE_KEY_VERSION, String(Date.now()));
    window.dispatchEvent(new CustomEvent("jacmat:catalog-changed", { detail: { product } }));
  } catch (e) {
    console.warn("Failed to save created product:", e);
  }
}

export function getDeletedProductIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DELETED);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDeletedProductId(idOrSlug) {
  try {
    const list = getDeletedProductIds();
    if (!list.includes(idOrSlug)) {
      list.push(idOrSlug);
    }
    localStorage.setItem(STORAGE_KEY_DELETED, JSON.stringify(list));

    // Also remove from created products if it was there
    const created = getCreatedProducts().filter((p) => p.id !== idOrSlug && p.slug !== idOrSlug);
    localStorage.setItem(STORAGE_KEY_NEW_PRODS, JSON.stringify(created));

    localStorage.setItem(STORAGE_KEY_VERSION, String(Date.now()));
    window.dispatchEvent(new CustomEvent("jacmat:catalog-changed", { detail: { deletedId: idOrSlug } }));
  } catch (e) {
    console.warn("Failed to save deleted product id:", e);
  }
}

/**
 * Apply all overrides to an array of products
 */
export function applyLocalStoreSync(rawProducts = []) {
  const overrides = getStatusOverrides();
  const created = getCreatedProducts();
  const deleted = new Set(getDeletedProductIds());

  // 1. Filter out deleted
  let list = rawProducts
    .filter((p) => {
      const id = p.id || p.slug || p.name;
      return !deleted.has(id) && !deleted.has(p.id) && !deleted.has(p.slug);
    })
    .map((p) => ({ ...p }));

  // 2. Reconcile created / edited products with list
  const createdById = new Map();
  created.forEach((cp) => {
    if (!cp || typeof cp !== "object") return;
    const id = cp.id || cp.slug;
    if (id && !deleted.has(id) && !deleted.has(cp.slug)) {
      createdById.set(id, cp);
      if (cp.slug) createdById.set(cp.slug, cp);
    }
  });

  const matchedCreatedIds = new Set();
  list = list.map((p) => {
    const id = p.id || p.slug;
    const localEdit = createdById.get(id) || (p.slug ? createdById.get(p.slug) : null);
    if (localEdit) {
      matchedCreatedIds.add(localEdit.id || localEdit.slug);
      if (localEdit.slug) matchedCreatedIds.add(localEdit.slug);
      const serverTs = new Date(p.updatedAt || p.createdAt || 0).getTime();
      const localTs = new Date(localEdit.updatedAt || localEdit.createdAt || 0).getTime();
      if (!serverTs || localTs >= serverTs) {
        return { ...p, ...localEdit };
      }
    }
    return p;
  });

  // 3. Prepend newly created products not yet in server list
  created.forEach((cp) => {
    const id = cp.id || cp.slug;
    if (id && !matchedCreatedIds.has(id) && !matchedCreatedIds.has(cp.slug) && !deleted.has(id)) {
      matchedCreatedIds.add(id);
      list.unshift({ ...cp });
    }
  });

  // 4. Apply explicit status overrides last
  list.forEach((p) => {
    const id = p.id || p.slug;
    const nameKey = p.name;
    if (id && overrides[id] !== undefined) {
      p.status = overrides[id];
    } else if (p.slug && overrides[p.slug] !== undefined) {
      p.status = overrides[p.slug];
    } else if (nameKey && overrides[nameKey] !== undefined) {
      p.status = overrides[nameKey];
    }
  });

  return list;
}

/**
 * Clear local sync overrides (e.g. after full backup restore)
 */
export function clearLocalStoreSync() {
  try {
    localStorage.removeItem(STORAGE_KEY_OVERRIDES);
    localStorage.removeItem(STORAGE_KEY_NEW_PRODS);
    localStorage.removeItem(STORAGE_KEY_DELETED);
    localStorage.setItem(STORAGE_KEY_VERSION, String(Date.now()));
  } catch {}
}

/**
 * Real-time Version & Cache Checker
 * Automatically detects new deployments and updates without stale cache
 */
export async function initVersionCheck() {
  const CURRENT_BUILD = JACMAT_VERSION;
  const storedVersion = localStorage.getItem("jacmat_app_build_version");

  if (storedVersion && storedVersion !== CURRENT_BUILD) {
    console.log(`[JACMAT] New version detected (${storedVersion} -> ${CURRENT_BUILD}). Clearing stale caches.`);
    localStorage.setItem("jacmat_app_build_version", CURRENT_BUILD);
    // Force clean old cache keys
    localStorage.removeItem("jacmat_store_cache");
    localStorage.removeItem("jacmat_admin_store_v2");
  } else if (!storedVersion) {
    localStorage.setItem("jacmat_app_build_version", CURRENT_BUILD);
  }

  // Periodic background version poll (every 30s or when tab becomes visible)
  async function checkServerVersion() {
    try {
      const res = await fetch(`/api/version?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const info = await res.json();
        const lastCatalog = localStorage.getItem(STORAGE_KEY_VERSION);
        if (info.catalogVersion && lastCatalog && Number(info.catalogVersion) > Number(lastCatalog)) {
          localStorage.setItem(STORAGE_KEY_VERSION, String(info.catalogVersion));
          window.dispatchEvent(new CustomEvent("jacmat:catalog-changed", { detail: info }));
        }
      }
    } catch {}
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkServerVersion();
    }
  });
}
