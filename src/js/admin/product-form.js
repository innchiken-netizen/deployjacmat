/**
 * JACMAT STORE — Product Form Controller (Create & Edit)
 * Foolproof admin for non-technical users:
 * - Automatic SKU generation (JAC-CAT-XXX)
 * - Quick category creation modal (+ instant select)
 * - Automatic client-side canvas image optimization (zero EROFS, zero payload limit issues)
 */

import { initAdminLayout, showAdminToast } from "./admin-layout.js";
import { saveCreatedProduct, saveStatusOverride } from "../store-sync.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

document.addEventListener("DOMContentLoaded", async () => {
  const isAuthorized = await initAdminLayout("products");
  if (!isAuthorized) return;

  const urlParams = new URLSearchParams(window.location.search);
  const productId = urlParams.get("id") || urlParams.get("p");
  const isEditMode = Boolean(productId);

  const form = document.getElementById("product-form");
  const heading = document.getElementById("page-heading");
  const nameInput = document.getElementById("prod-name");
  const skuInput = document.getElementById("prod-sku");
  const generateSkuBtn = document.getElementById("generate-sku-btn");
  const slugInput = document.getElementById("prod-slug");
  const descInput = document.getElementById("prod-desc");
  const priceInput = document.getElementById("prod-price");
  const salePriceInput = document.getElementById("prod-saleprice");
  const categorySelect = document.getElementById("prod-category");
  const statusSelect = document.getElementById("prod-status");
  const soldOutCheck = document.getElementById("prod-soldout");
  const preOrderCheck = document.getElementById("prod-preorder");
  const customVariantsInput = document.getElementById("custom-variants-input");

  // Quick category modal elements
  const btnOpenQuickCat = document.getElementById("btn-open-quick-cat");
  const quickCatModal = document.getElementById("quick-category-modal");
  const closeQuickCatModal = document.getElementById("close-quick-cat-modal");
  const cancelQuickCatBtn = document.getElementById("cancel-quick-cat-btn");
  const confirmQuickCatBtn = document.getElementById("confirm-quick-cat-btn");
  const quickCatNameInput = document.getElementById("quick-cat-name-input");

  const imageUrlInput = document.getElementById("image-url-input");
  const addImageUrlBtn = document.getElementById("add-image-url-btn");
  const imageFileInput = document.getElementById("image-file-input");
  const galleryGrid = document.getElementById("gallery-preview-grid");

  const saveTopBtn = document.getElementById("save-product-top-btn");
  const saveMainBtn = document.getElementById("save-product-main-btn");

  let galleryImages = [];
  let userEditedSlug = false;
  let userEditedSku = false;

  // Helper: Client-side clean SKU generator
  function generateClientSku(categoryVal = "", prodName = "") {
    let catCode = "ART";
    if (categoryVal) {
      catCode = categoryVal
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 3)
        .toUpperCase();
    }
    if (!catCode || catCode.length < 2) catCode = "JAC";
    const num = Math.floor(100 + Math.random() * 900);
    return `JAC-${catCode}-${num}`;
  }

  // 1. Fetch Categories for select
  async function loadCategories(selectedId = null) {
    try {
      const catRes = await fetch("/api/admin/categories");
      if (catRes.ok) {
        const categories = await catRes.json();
        categorySelect.innerHTML = categories
          .map((c) => `<option value="${escapeHtml(c.id || c.slug)}">${escapeHtml(c.name)}</option>`)
          .join("");
        if (selectedId) {
          categorySelect.value = selectedId;
        }
      }
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
  }
  await loadCategories();

  // 2. Slug & SKU Auto-generation
  nameInput.addEventListener("input", () => {
    const val = nameInput.value.trim();
    if (!userEditedSlug) {
      slugInput.value = val
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    if (skuInput && (!skuInput.value.trim() || !userEditedSku)) {
      if (val) {
        skuInput.value = generateClientSku(categorySelect.value, val);
      }
    }
  });

  slugInput.addEventListener("input", () => {
    userEditedSlug = Boolean(slugInput.value.trim());
  });

  if (skuInput) {
    skuInput.addEventListener("input", () => {
      userEditedSku = Boolean(skuInput.value.trim());
    });
  }

  // Generate SKU Button
  if (generateSkuBtn) {
    generateSkuBtn.addEventListener("click", async () => {
      const cat = categorySelect ? categorySelect.value : "";
      const name = nameInput ? nameInput.value : "";
      try {
        const res = await fetch(`/api/admin/sku/generate?category=${encodeURIComponent(cat)}&name=${encodeURIComponent(name)}`);
        if (res.ok) {
          const d = await res.json();
          if (d.sku) {
            skuInput.value = d.sku;
            userEditedSku = true;
            showAdminToast(`SKU généré : ${d.sku}`);
            return;
          }
        }
      } catch {}
      const fallbackSku = generateClientSku(cat, name);
      skuInput.value = fallbackSku;
      userEditedSku = true;
      showAdminToast(`SKU généré : ${fallbackSku}`);
    });
  }

  // Update SKU when category changes if user hasn't manually entered a custom SKU
  categorySelect.addEventListener("change", () => {
    if (skuInput && (!skuInput.value.trim() || !userEditedSku)) {
      skuInput.value = generateClientSku(categorySelect.value, nameInput.value);
    }
  });

  // 3. Quick Category Modal Setup
  function openCatModal() {
    if (!quickCatModal) return;
    quickCatModal.style.display = "flex";
    if (quickCatNameInput) {
      quickCatNameInput.value = "";
      setTimeout(() => quickCatNameInput.focus(), 50);
    }
  }

  function closeCatModal() {
    if (!quickCatModal) return;
    quickCatModal.style.display = "none";
  }

  if (btnOpenQuickCat) btnOpenQuickCat.addEventListener("click", openCatModal);
  if (closeQuickCatModal) closeQuickCatModal.addEventListener("click", closeCatModal);
  if (cancelQuickCatBtn) cancelQuickCatBtn.addEventListener("click", closeCatModal);

  if (quickCatModal) {
    quickCatModal.addEventListener("click", (e) => {
      if (e.target === quickCatModal) closeCatModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && quickCatModal.style.display === "flex") {
        closeCatModal();
      }
    });
  }

  if (confirmQuickCatBtn) {
    confirmQuickCatBtn.addEventListener("click", async () => {
      const newName = quickCatNameInput ? quickCatNameInput.value.trim() : "";
      if (!newName) {
        showAdminToast("Veuillez saisir un nom de catégorie.", "error");
        if (quickCatNameInput) quickCatNameInput.focus();
        return;
      }

      confirmQuickCatBtn.disabled = true;
      confirmQuickCatBtn.textContent = "Création...";

      try {
        const res = await fetch("/api/admin/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName })
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success) {
          const newCat = data.category;
          await loadCategories(newCat.id || newCat.slug);
          closeCatModal();
          showAdminToast(`Catégorie "${newCat.name}" créée et sélectionnée !`);

          // Update SKU with the new category
          if (skuInput && (!userEditedSku || !skuInput.value.trim())) {
            skuInput.value = generateClientSku(newCat.name, nameInput.value);
          }
        } else {
          showAdminToast(data.error || "Impossible de créer la catégorie.", "error");
        }
      } catch (err) {
        showAdminToast("Erreur de connexion lors de la création de la catégorie.", "error");
      } finally {
        confirmQuickCatBtn.disabled = false;
        confirmQuickCatBtn.textContent = "Créer la catégorie";
      }
    });

    if (quickCatNameInput) {
      quickCatNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          confirmQuickCatBtn.click();
        }
      });
    }
  }

  // 4. Variant Sizes Chips Toggle
  const sizeChips = document.querySelectorAll(".admin-size-chip");
  sizeChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("is-active");
    });
  });

  // 5. Image Gallery Management & Client-side Canvas Compression
  function renderGallery() {
    galleryGrid.innerHTML = galleryImages
      .map((img, idx) => `
        <div class="admin-gallery-thumb-box">
          <img src="${sanitizeImageUrl(img)}" alt="Aperçu ${idx + 1}">
          <button type="button" class="admin-gallery-thumb-delete" data-index="${idx}" aria-label="Supprimer photo">✕</button>
          ${idx === 0 ? '<span style="position: absolute; bottom: 4px; left: 4px; background: #000; color: #fff; font-size: 9px; padding: 1px 4px; border-radius: 2px;">Principale</span>' : ""}
        </div>
      `)
      .join("");

    galleryGrid.querySelectorAll(".admin-gallery-thumb-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.index);
        galleryImages.splice(idx, 1);
        renderGallery();
      });
    });
  }

  addImageUrlBtn.addEventListener("click", () => {
    const raw = imageUrlInput.value.trim();
    if (!raw) return;
    const candidate = raw.startsWith("/") || raw.startsWith("http") || raw.startsWith("data:image/") ? raw : `/${raw}`;
    const safeUrl = sanitizeImageUrl(candidate, "");
    if (!safeUrl) {
      showAdminToast("URL d'image invalide ou non autorisée.", "error");
      return;
    }
    galleryImages.push(safeUrl);
    imageUrlInput.value = "";
    renderGallery();
  });

  /**
   * Browser Canvas Resizer:
   * Keeps resolution crisp (up to 1600px) while compressing file to ~100-200KB,
   * completely avoiding Vercel 4.5MB payload limits and guaranteeing smooth uploads.
   */
  function compressImageFile(file, maxWidth = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => reject(new Error("Format d'image non supporté"));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("Erreur de lecture du fichier"));
      reader.readAsDataURL(file);
    });
  }

  imageFileInput.addEventListener("change", async () => {
    const file = imageFileInput.files[0];
    if (!file) return;

    showAdminToast("Optimisation de l'image en cours...");

    try {
      const compressedDataUrl = await compressImageFile(file, 1600, 0.85);

      const uploadRes = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: compressedDataUrl, filename: file.name })
      });

      if (uploadRes.ok) {
        const resData = await uploadRes.json();
        galleryImages.push(resData.url);
        renderGallery();
        showAdminToast("Photo ajoutée avec succès !");
      } else {
        const errData = await uploadRes.json().catch(() => ({}));
        showAdminToast(errData.error || "Erreur lors du téléversement.", "error");
      }
    } catch (err) {
      console.error("Upload error:", err);
      showAdminToast("Impossible de traiter cette image.", "error");
    } finally {
      imageFileInput.value = "";
    }
  });

  // 6. Pre-fill if Edit Mode
  if (isEditMode) {
    if (heading) heading.textContent = "Modifier le produit";
    userEditedSlug = true;
    userEditedSku = true;

    try {
      const res = await fetch(`/api/admin/products?id=${encodeURIComponent(productId)}`);
      if (!res.ok) {
        showAdminToast("Produit introuvable", "error");
        setTimeout(() => window.location.replace("/admin/products"), 1500);
        return;
      }
      const prod = await res.json();

      nameInput.value = prod.name || "";
      if (skuInput && prod.sku) skuInput.value = prod.sku;
      slugInput.value = prod.slug || "";
      descInput.value = prod.description || "";
      priceInput.value = prod.price;
      if (prod.salePrice) salePriceInput.value = prod.salePrice;

      if (prod.category) categorySelect.value = prod.category;
      if (prod.status) statusSelect.value = prod.status;
      soldOutCheck.checked = Boolean(prod.soldOut);
      preOrderCheck.checked = Boolean(prod.preOrder);

      // Pre-fill variants
      if (prod.variants && prod.variants.Taille) {
        const activeSizes = prod.variants.Taille;
        sizeChips.forEach((chip) => {
          if (activeSizes.includes(chip.dataset.size)) {
            chip.classList.add("is-active");
          } else {
            chip.classList.remove("is-active");
          }
        });
      }

      // Pre-fill images
      if (Array.isArray(prod.images)) {
        galleryImages = [...prod.images];
        renderGallery();
      }
    } catch (err) {
      console.error("Failed to load product for editing:", err);
    }
  }

  // 7. Save Product Handler
  async function handleSave(e) {
    if (e) e.preventDefault();

    const name = nameInput.value.trim();
    const slug = slugInput.value.trim();
    const sku = skuInput ? skuInput.value.trim() : undefined;
    const price = Number(priceInput.value);

    if (!name) {
      showAdminToast("Le nom du produit est requis.", "error");
      nameInput.focus();
      return;
    }

    if (isNaN(price) || price < 0) {
      showAdminToast("Le prix doit être un nombre positif.", "error");
      priceInput.focus();
      return;
    }

    // Selected sizes
    const selectedSizes = [];
    document.querySelectorAll(".admin-size-chip.is-active").forEach((chip) => {
      selectedSizes.push(chip.dataset.size);
    });

    const customVarVal = customVariantsInput ? customVariantsInput.value.trim() : "";
    if (customVarVal) {
      customVarVal.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => {
        if (!selectedSizes.includes(s)) selectedSizes.push(s);
      });
    }

    const payload = {
      name,
      sku: sku || undefined,
      slug: slug || undefined,
      description: descInput.value.trim(),
      price,
      salePrice: salePriceInput.value ? Number(salePriceInput.value) : null,
      category: categorySelect.value,
      status: statusSelect.value,
      soldOut: soldOutCheck.checked,
      preOrder: preOrderCheck.checked,
      variants: { Taille: selectedSizes.length > 0 ? selectedSizes : ["Unique"] },
      images: galleryImages.length > 0 ? galleryImages : ["/placeholder.png"]
    };

    const method = isEditMode ? "PUT" : "POST";
    if (isEditMode) payload.id = productId;

    // Loading state
    saveTopBtn.disabled = true;
    saveMainBtn.disabled = true;
    saveMainBtn.textContent = "Enregistrement en cours...";

    try {
      const saveRes = await fetch("/api/admin/products", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const resData = await saveRes.json().catch(() => ({}));

      if (saveRes.ok && resData.success) {
        showAdminToast(isEditMode ? "Produit mis à jour avec succès !" : "Nouveau produit créé avec succès !");
        const savedProduct = resData.product || payload;
        if (!savedProduct.id) {
          savedProduct.id = productId || `prod_${savedProduct.slug || Date.now()}`;
        }
        saveCreatedProduct(savedProduct);
        if (savedProduct.status) {
          saveStatusOverride(savedProduct.id, savedProduct.status);
          if (savedProduct.slug) saveStatusOverride(savedProduct.slug, savedProduct.status);
        }
        setTimeout(() => {
          window.location.replace("/admin/products");
        }, 600);
      } else {
        showAdminToast(resData.error || "Erreur lors de l'enregistrement.", "error");
        saveTopBtn.disabled = false;
        saveMainBtn.disabled = false;
        saveMainBtn.textContent = isEditMode ? "Enregistrer les modifications" : "Enregistrer le produit";
      }
    } catch (err) {
      showAdminToast("Erreur réseau. Vérifiez votre connexion.", "error");
      saveTopBtn.disabled = false;
      saveMainBtn.disabled = false;
      saveMainBtn.textContent = isEditMode ? "Enregistrer les modifications" : "Enregistrer le produit";
    }
  }

  form.addEventListener("submit", handleSave);
  saveTopBtn.addEventListener("click", () => handleSave());
});
