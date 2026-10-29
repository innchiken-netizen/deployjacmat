/**
 * JACMAT STORE — Settings Controller
 */

import { initAdminLayout, showAdminToast } from "./admin-layout.js";
import { clearLocalStoreSync } from "../store-sync.js";

document.addEventListener("DOMContentLoaded", async () => {
  const isAuthorized = await initAdminLayout("settings");
  if (!isAuthorized) return;

  const form = document.getElementById("settings-form");
  const storeNameInput = document.getElementById("set-store-name");
  const sloganInput = document.getElementById("set-slogan");
  const whatsappInput = document.getElementById("set-whatsapp");
  const emailInput = document.getElementById("set-email");
  const saveBtn = document.getElementById("save-settings-btn");
  const restoreInput = document.getElementById("restore-backup-input");

  // Load current settings
  try {
    const res = await fetch("/api/admin/settings");
    if (res.ok) {
      const settings = await res.json();
      storeNameInput.value = settings.storeName || "JACMAT STORE";
      sloganInput.value = settings.slogan || "BE YOU & WEAR US";
      whatsappInput.value = settings.whatsappPhone || "243823207915";
      emailInput.value = settings.contactEmail || "contact@jacmat.store";
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }

  // Save settings
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      storeName: storeNameInput.value.trim(),
      slogan: sloganInput.value.trim(),
      whatsappPhone: whatsappInput.value.trim().replace(/[^0-9]/g, ""),
      contactEmail: emailInput.value.trim()
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement...";

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showAdminToast("Paramètres enregistrés avec succès !");
      } else {
        showAdminToast("Erreur lors de l'enregistrement.", "error");
      }
    } catch {
      showAdminToast("Erreur réseau.", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer les paramètres";
    }
  });

  // Restore backup JSON
  if (restoreInput) {
    restoreInput.addEventListener("change", async () => {
      const file = restoreInput.files && restoreInput.files[0];
      if (!file) return;

      if (!confirm(`Restaurer la sauvegarde « ${file.name} » ? Cela mettra à jour le catalogue avec les données du fichier.`)) {
        restoreInput.value = "";
        return;
      }

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const res = await fetch("/api/admin/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          clearLocalStoreSync();
          showAdminToast(`Sauvegarde restaurée (${data.productsCount} produits) !`);
        } else {
          showAdminToast(data.error || "Fichier de sauvegarde invalide.", "error");
        }
      } catch {
        showAdminToast("Impossible de lire le fichier JSON.", "error");
      } finally {
        restoreInput.value = "";
      }
    });
  }
});
