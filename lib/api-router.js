import "./load-env.js";
import bcrypt from "bcryptjs";
import { signAdminSession, verifyAdminSession, createSessionCookie, createLogoutCookie } from "./auth.js";
import { checkRateLimit, recordFailedAttempt, resetAttempts, getClientIp } from "./rate-limit.js";
import {
  getPublishedProducts,
  getAllProducts,
  getProductByIdOrSlug,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  createCategory,
  deleteCategory,
  getStoreStats,
  getStoreSettings,
  updateStoreSettings,
  exportStoreData,
  importStoreData,
  generateSku,
  sanitizeImageUrlServer
} from "./products-store.js";

/**
 * Helper to read JSON body from standard Node req
 */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      // Protection against massive payload (max 10MB)
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Helper to send JSON response with strict anti-cache & security headers
 */
export function sendJson(res, statusCode, data, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  Object.entries(headers).forEach(([key, val]) => {
    res.setHeader(key, val);
  });
  res.end(JSON.stringify(data));
}

/**
 * Verify Origin header matches Host header for state-changing requests (CSRF defense)
 */
function isOriginAllowed(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (!origin || !host) return true;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Main API request dispatcher
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export async function handleApiRequest(req, res) {
  const parsed = new URL(req.url, "http://localhost");
  let pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const query = Object.fromEntries(parsed.searchParams.entries());

  // Check if routed via Vercel rewrite with __route param, x-matched-path, or x-forwarded-url
  const routeParam = parsed.searchParams.get("__route") || (req.query && req.query.__route);
  const matchedPath = req.headers && (req.headers["x-matched-path"] || req.headers["x-forwarded-url"]);

  if (routeParam) {
    const cleanRoute = String(routeParam).split("?")[0].replace(/^\/+/, "").replace(/\/+$/, "");
    pathname = "/api/" + cleanRoute;
    delete query.__route;
  } else if (matchedPath && String(matchedPath).startsWith("/api")) {
    pathname = String(matchedPath).split("?")[0].replace(/\/+$/, "");
  } else if (!pathname.startsWith("/api")) {
    pathname = "/api" + (pathname.startsWith("/") ? pathname : "/" + pathname);
  }

  const method = req.method.toUpperCase();
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  try {
    /* --------------------------------------------------------------------------
       HEALTH CHECK / ROOT API ENDPOINT: GET /api or /api/index.js
       -------------------------------------------------------------------------- */
    if (pathname === "/api" || pathname === "/api/index.js" || pathname === "/api/") {
      return sendJson(res, 200, {
        status: "ok",
        service: "jacmat-api",
        version: "2.2.0"
      });
    }
    /* --------------------------------------------------------------------------
       PUBLIC ENDPOINT: GET /api/products
       -------------------------------------------------------------------------- */
    if (pathname === "/api/products") {
      if (method === "GET") {
        if (query.id || query.slug || query.p) {
          const identifier = query.id || query.slug || query.p;
          const product = await getProductByIdOrSlug(identifier);
          if (!product || product.status !== "published") {
            return sendJson(res, 404, { error: "Produit introuvable" });
          }
          return sendJson(res, 200, product);
        }
        const products = await getPublishedProducts();
        return sendJson(res, 200, products);
      }
      return sendJson(res, 405, { error: "Méthode non autorisée" });
    }

    /* --------------------------------------------------------------------------
       PUBLIC ENDPOINT: GET /api/categories
       -------------------------------------------------------------------------- */
    if (pathname === "/api/categories") {
      if (method === "GET") {
        const categories = await getCategories();
        return sendJson(res, 200, categories);
      }
      return sendJson(res, 405, { error: "Méthode non autorisée" });
    }

    /* --------------------------------------------------------------------------
       PUBLIC ENDPOINT: GET /api/version
       -------------------------------------------------------------------------- */
    if (pathname === "/api/version") {
      if (method === "GET") {
        const all = await getAllProducts();
        const published = all.filter((p) => p.status === "published");
        const latestUpdateMs = all.reduce((maxTs, p) => {
          const ts = new Date(p.updatedAt || p.createdAt || 0).getTime();
          return Number.isFinite(ts) && ts > maxTs ? ts : maxTs;
        }, 0);
        return sendJson(res, 200, {
          version: "2.2.0",
          catalogVersion: latestUpdateMs || 1,
          productsCount: all.length,
          publishedCount: published.length,
          timestamp: Date.now()
        });
      }
      return sendJson(res, 405, { error: "Méthode non autorisée" });
    }

    /* --------------------------------------------------------------------------
       ADMIN AUTH: POST /api/admin/login
       -------------------------------------------------------------------------- */
    if (pathname === "/api/admin/login") {
      if (method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée" });
      if (!isOriginAllowed(req)) return sendJson(res, 403, { error: "Origine de requête non autorisée." });

      const clientIp = getClientIp(req);
      const rateStatus = checkRateLimit(clientIp);
      if (rateStatus.limited) {
        return sendJson(
          res,
          429,
          {
            error: `Trop de tentatives de connexion échouées. Veuillez réessayer dans ${rateStatus.retryAfterSeconds} seconde(s).`
          },
          { "Retry-After": String(rateStatus.retryAfterSeconds) }
        );
      }

      const body = await readJsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      const configuredEmail = String(process.env.ADMIN_EMAIL || "admin@jacmat.store").trim().toLowerCase();
      const passwordHash = process.env.ADMIN_PASSWORD_HASH;

      if (!configuredEmail || !passwordHash) {
        return sendJson(res, 500, {
          error: "Configuration admin incomplète. Définissez ADMIN_EMAIL et ADMIN_PASSWORD_HASH."
        });
      }

      // Validate email matches & always run bcrypt.compare to prevent timing enumeration
      const isEmailValid = email === configuredEmail;
      let isPasswordValid = false;
      try {
        isPasswordValid = await bcrypt.compare(password || "invalid_empty_probe", passwordHash);
      } catch {
        isPasswordValid = false;
      }

      if (!isEmailValid || !password || !isPasswordValid) {
        recordFailedAttempt(clientIp);
        return sendJson(res, 401, { error: "Email ou mot de passe incorrect." });
      }

      // Successful login -> reset rate limit attempts
      resetAttempts(clientIp);

      // Create signed session token & cookie
      const token = await signAdminSession(email);
      const cookieHeader = createSessionCookie(token, isProduction);

      return sendJson(res, 200, { success: true, email }, { "Set-Cookie": cookieHeader });
    }

    /* --------------------------------------------------------------------------
       ADMIN AUTH: POST /api/admin/logout
       -------------------------------------------------------------------------- */
    if (pathname === "/api/admin/logout") {
      if (method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée" });
      const cookieHeader = createLogoutCookie(isProduction);
      return sendJson(res, 200, { success: true }, { "Set-Cookie": cookieHeader });
    }

    /* --------------------------------------------------------------------------
       ADMIN AUTH: GET /api/admin/me
       -------------------------------------------------------------------------- */
    if (pathname === "/api/admin/me") {
      if (method !== "GET") return sendJson(res, 405, { error: "Méthode non autorisée" });
      const session = await verifyAdminSession(req);
      if (!session.authenticated) {
        return sendJson(res, 401, { authenticated: false, error: "Non authentifié" });
      }
      return sendJson(res, 200, { authenticated: true, email: session.email });
    }

    /* --------------------------------------------------------------------------
       ALL SUBSEQUENT ADMIN ROUTES REQUIRE AUTHENTICATION
       -------------------------------------------------------------------------- */
    if (pathname.startsWith("/api/admin/")) {
      if (method !== "GET" && method !== "HEAD" && !isOriginAllowed(req)) {
        return sendJson(res, 403, { error: "Origine de requête non autorisée." });
      }

      const session = await verifyAdminSession(req);
      if (!session.authenticated) {
        return sendJson(res, 401, { error: "Accès refusé. Session administrateur requise." });
      }

      // GET /api/admin/stats
      if (pathname === "/api/admin/stats") {
        if (method !== "GET") return sendJson(res, 405, { error: "Méthode non autorisée" });
        const stats = await getStoreStats();
        return sendJson(res, 200, stats);
      }

      // /api/admin/products
      if (pathname === "/api/admin/products") {
        if (method === "GET") {
          if (query.id || query.slug) {
            const prod = await getProductByIdOrSlug(query.id || query.slug);
            if (!prod) return sendJson(res, 404, { error: "Produit introuvable" });
            return sendJson(res, 200, prod);
          }
          const products = await getAllProducts();
          return sendJson(res, 200, products);
        }

        if (method === "POST") {
          const body = await readJsonBody(req);
          const newProd = await createProduct(body);
          return sendJson(res, 201, { success: true, product: newProd });
        }

        if (method === "PUT" || method === "PATCH") {
          const body = await readJsonBody(req);
          const id = query.id || body.id;
          if (!id) return sendJson(res, 400, { error: "ID de produit requis" });
          const updated = await updateProduct(id, body);
          return sendJson(res, 200, { success: true, product: updated });
        }

        if (method === "DELETE") {
          const body = await readJsonBody(req).catch(() => ({}));
          const id = query.id || body.id;
          if (!id) return sendJson(res, 400, { error: "ID de produit requis" });
          await deleteProduct(id);
          return sendJson(res, 200, { success: true, id });
        }

        return sendJson(res, 405, { error: "Méthode non autorisée" });
      }

      // /api/admin/categories
      if (pathname === "/api/admin/categories") {
        if (method === "GET") {
          const categories = await getCategories();
          return sendJson(res, 200, categories);
        }

        if (method === "POST") {
          const body = await readJsonBody(req);
          const newCat = await createCategory(body);
          return sendJson(res, 201, { success: true, category: newCat });
        }

        if (method === "DELETE") {
          const body = await readJsonBody(req).catch(() => ({}));
          const id = query.id || body.id;
          if (!id) return sendJson(res, 400, { error: "ID de catégorie requis" });
          await deleteCategory(id);
          return sendJson(res, 200, { success: true, id });
        }

        return sendJson(res, 405, { error: "Méthode non autorisée" });
      }

      // /api/admin/settings
      if (pathname === "/api/admin/settings") {
        if (method === "GET") {
          const settings = await getStoreSettings();
          return sendJson(res, 200, settings);
        }

        if (method === "PUT" || method === "POST") {
          const body = await readJsonBody(req);
          const updated = await updateStoreSettings(body);
          return sendJson(res, 200, { success: true, settings: updated });
        }

        return sendJson(res, 405, { error: "Méthode non autorisée" });
      }

      // /api/admin/upload (Image upload handler)
      if (pathname === "/api/admin/upload") {
        if (method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée" });
        const body = await readJsonBody(req);

        // Support direct image URL (validated for safe schemes)
        if (body.imageUrl) {
          const cleanUrl = sanitizeImageUrlServer(body.imageUrl);
          if (!cleanUrl) {
            return sendJson(res, 400, { error: "URL d'image non valide ou protocole non autorisé." });
          }
          return sendJson(res, 200, { success: true, url: cleanUrl });
        }

        if (body.dataUrl) {
          const cleanDataUrl = sanitizeImageUrlServer(body.dataUrl);
          if (!cleanDataUrl || !cleanDataUrl.startsWith("data:image/")) {
            return sendJson(res, 400, { error: "Format d'image non supporté. Utilisez JPG, PNG ou WebP." });
          }

          // If Vercel Blob token is set, we could upload to Blob
          if (process.env.BLOB_READ_WRITE_TOKEN) {
            try {
              const { put } = await import("@vercel/blob");
              const base64Data = cleanDataUrl.split(",")[1];
              const buffer = Buffer.from(base64Data, "base64");
              const safeFilename = String(body.filename || "upload.jpg")
                .replace(/[^a-zA-Z0-9._-]/g, "_")
                .slice(0, 80);
              const filename = `jacmat-${Date.now()}-${safeFilename}`;
              const blob = await put(filename, buffer, { access: "public" });
              return sendJson(res, 200, { success: true, url: blob.url });
            } catch (err) {
              console.error("[UPLOAD] Blob upload error:", err);
            }
          }

          // Local / fallback: validated base64 image data URL
          return sendJson(res, 200, { success: true, url: cleanDataUrl });
        }

        return sendJson(res, 400, { error: "Aucune image fournie." });
      }

      // /api/admin/sku/generate (Generate clean SKU)
      if (pathname === "/api/admin/sku/generate") {
        if (method !== "GET") return sendJson(res, 405, { error: "Méthode non autorisée" });
        const sku = generateSku(query.category, query.name);
        return sendJson(res, 200, { sku });
      }

      // /api/admin/backup (Download JSON store backup)
      if (pathname === "/api/admin/backup") {
        if (method !== "GET") return sendJson(res, 405, { error: "Méthode non autorisée" });
        const backupData = await exportStoreData();
        const dateStr = new Date().toISOString().slice(0, 10);
        return sendJson(res, 200, backupData, {
          "Content-Disposition": `attachment; filename="jacmat-backup-${dateStr}.json"`
        });
      }

      // /api/admin/restore (Restore JSON store backup)
      if (pathname === "/api/admin/restore") {
        if (method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée" });
        const body = await readJsonBody(req);
        const result = await importStoreData(body);
        return sendJson(res, 200, { success: true, count: result.count });
      }
    }

    // Unmatched API route
    return sendJson(res, 404, { error: "Route API introuvable" });
  } catch (error) {
    console.error(`[API Error] ${method} ${pathname}:`, error);
    return sendJson(res, 500, { error: error.message || "Erreur interne du serveur" });
  }
}
