import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(rootDir, "data");
const localStorePath = path.resolve(dataDir, "store.json");
const originalProductsPath = path.resolve(rootDir, "products.json");
const tmpStorePath = path.resolve(os.tmpdir(), "jacmat_store.json");

// In-memory store cache for active serverless/lambda instance
let memoryStore = globalThis.__JACMAT_STORE__ || null;

/**
 * Slugify a string helper
 */
export function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Infer category from name
 */
function inferCategory(name) {
  const n = String(name || "").toLowerCase();
  if (/(cap|bonnet|slide|slipper|sock|jic)/.test(n)) return "accessories";
  if (/(hoodie|pull|blazer|winter|crew)/.test(n)) return "outerwear";
  return "tops";
}

/**
 * Automatically generate a clean, readable SKU for streetwear products
 * e.g., JAC-TOP-492, JAC-OUT-812, JAC-ACC-105, JAC-BON-391
 */
export function generateSku(category, name) {
  const cat = String(category || "").toLowerCase().trim();
  let catPrefix = "ART";

  if (cat.includes("top") || cat.includes("t-shirt") || cat.includes("tee")) {
    catPrefix = "TOP";
  } else if (cat.includes("outer") || cat.includes("sweat") || cat.includes("hoodie") || cat.includes("pull") || cat.includes("veste")) {
    catPrefix = "OUT";
  } else if (cat.includes("access") || cat.includes("casquette") || cat.includes("cap")) {
    catPrefix = "ACC";
  } else if (cat.includes("bonnet") || cat.includes("beanie")) {
    catPrefix = "BON";
  } else if (cat.includes("pant") || cat.includes("jean") || cat.includes("cargo")) {
    catPrefix = "PAN";
  } else if (cat.includes("short")) {
    catPrefix = "SHO";
  } else if (cat.length >= 3) {
    catPrefix = cat.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, "X");
  }

  const rand = Math.floor(100 + Math.random() * 900);
  return `JAC-${catPrefix}-${rand}`;
}

/**
 * Default categories for Jacmat Store
 */
export const DEFAULT_CATEGORIES = [
  { id: "tops", name: "Tops & T-Shirts", slug: "tops", description: "T-shirts, maillots et hauts Jacmat" },
  { id: "outerwear", name: "Outerwear & Sweats", slug: "outerwear", description: "Sweats à capuche, pulls et vestes" },
  { id: "accessories", name: "Accessoires & Casquettes", slug: "accessories", description: "Casquettes, bonnets, claquettes et accessoires" }
];

export const DEFAULT_SETTINGS = {
  storeName: "JACMAT STORE",
  slogan: "BE YOU & WEAR US",
  whatsappPhone: "243823207915",
  contactEmail: "contact@jacmat.store",
  currency: "$",
  maintenanceMode: false
};

// Postgres pool singleton (if DATABASE_URL, POSTGRES_URL or POSTGRES_PRISMA_URL is set)
let pgPool = null;
let pgInitialized = false;

function getPgPool() {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  if (!dbUrl) return null;
  if (!pgPool) {
    const isLocal = dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1");
    pgPool = new pg.Pool({
      connectionString: dbUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
  }
  return pgPool;
}

/**
 * Sanitize and validate a single image URL server-side
 */
export function sanitizeImageUrlServer(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Allow valid base64 raster image data URLs (max ~4MB base64 length)
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/i.test(trimmed)) {
    if (trimmed.length > 5.5 * 1024 * 1024) {
      throw new Error("L'image téléversée dépasse la taille maximale autorisée (4 Mo).");
    }
    return trimmed;
  }

  // Block dangerous schemes (javascript:, vbscript:, data:, file:, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return trimmed;
      }
    } catch {
      return null;
    }
    return null;
  }

  // Relative path normalization (prevent protocol-relative // and path traversal ..)
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized.startsWith("//") || normalized.includes("..")) return null;
  return normalized;
}

/**
 * Sanitize variants object against prototype pollution and malformed structures
 */
export function sanitizeVariants(rawVariants) {
  if (!rawVariants || typeof rawVariants !== "object" || Array.isArray(rawVariants)) {
    return { Taille: ["S", "M", "L", "XL"] };
  }
  const clean = Object.create(null);
  const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
  for (const [key, val] of Object.entries(rawVariants)) {
    const cleanKey = String(key || "").trim().slice(0, 50);
    if (!cleanKey || forbiddenKeys.has(cleanKey)) continue;
    if (Array.isArray(val)) {
      const cleanVals = val
        .map((v) => String(v || "").trim().slice(0, 80))
        .filter(Boolean);
      if (cleanVals.length > 0) {
        clean[cleanKey] = cleanVals;
      }
    }
  }
  return Object.keys(clean).length > 0 ? { ...clean } : { Taille: ["Unique"] };
}

/**
 * Initialize Postgres schema if needed
 */
async function initPgSchema(pool) {
  if (pgInitialized) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(100) PRIMARY KEY,
        sku VARCHAR(100),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        price NUMERIC(10,2) NOT NULL,
        sale_price NUMERIC(10,2),
        category VARCHAR(100) NOT NULL,
        images JSONB NOT NULL DEFAULT '[]'::jsonb,
        variants JSONB NOT NULL DEFAULT '{}'::jsonb,
        sold_out BOOLEAN NOT NULL DEFAULT false,
        pre_order BOOLEAN NOT NULL DEFAULT false,
        status VARCHAR(20) NOT NULL DEFAULT 'published',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100);

      CREATE INDEX IF NOT EXISTS idx_products_status_created ON products (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

      CREATE TABLE IF NOT EXISTS store_settings (
        key VARCHAR(100) PRIMARY KEY,
        value JSONB NOT NULL
      );
    `);

    // Check if products exist, seed if empty within a transaction
    const { rows } = await client.query("SELECT COUNT(*) as count FROM products");
    if (parseInt(rows[0].count, 10) === 0) {
      console.log("[DB] Seeding PostgreSQL database with initial Jacmat products...");
      const initial = getInitialProductsFromDisk();
      await client.query("BEGIN");
      try {
        for (const cat of DEFAULT_CATEGORIES) {
          await client.query(
            "INSERT INTO categories (id, name, slug, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
            [cat.id, cat.name, cat.slug, cat.description]
          );
        }
        for (const p of initial) {
          await client.query(
            `INSERT INTO products (id, sku, name, slug, description, price, sale_price, category, images, variants, sold_out, pre_order, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO NOTHING`,
            [
              p.id,
              p.sku || generateSku(p.category, p.name),
              p.name,
              p.slug,
              p.description || "",
              p.price,
              p.salePrice || null,
              p.category,
              JSON.stringify(p.images),
              JSON.stringify(p.variants || {}),
              p.soldOut || false,
              p.preOrder || false,
              p.status || "published"
            ]
          );
        }
        await client.query("COMMIT");
      } catch (seedErr) {
        await client.query("ROLLBACK");
        throw seedErr;
      }
    }
    pgInitialized = true;
  } finally {
    client.release();
  }
}

/**
 * Read original products from products.json
 */
function getInitialProductsFromDisk() {
  try {
    if (!fs.existsSync(originalProductsPath)) return [];
    const raw = fs.readFileSync(originalProductsPath, "utf-8");
    const list = JSON.parse(raw);
    return list.map((item, idx) => {
      const slug = slugify(item.name) || `piece-${idx + 1}`;
      const imgs = Array.isArray(item.images)
        ? item.images.map((img) => (img.startsWith("/") || img.startsWith("http") ? img : `/${img}`))
        : [];
      const cat = inferCategory(item.name);
      return {
        id: `prod_${slug}`,
        sku: generateSku(cat, item.name),
        name: item.name,
        slug: slug,
        description: `Pièce exclusive Jacmat Store. Coupe streetwear soignée, finitions haut de gamme et confection résistante.`,
        price: Number(item.price) || 0,
        salePrice: null,
        category: cat,
        images: imgs,
        variants: item.variants || { Taille: ["S", "M", "L", "XL", "2XL"] },
        soldOut: Boolean(item.soldOut),
        preOrder: Boolean(item.preOrder),
        status: "published",
        createdAt: new Date(Date.now() - (list.length - idx) * 3600000).toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  } catch (err) {
    console.error("Error reading original products.json:", err);
    return [];
  }
}

function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const defaultRepo =
    process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : "innchiken-netizen/deployjacmat";
  const repo = process.env.GITHUB_REPO || defaultRepo;
  const branch = process.env.GITHUB_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || "main";
  const filePath = "data/store.json";
  return { token, repo, branch, filePath };
}

let lastGitHubFetchAt = 0;

/**
 * Fetch latest data/store.json from GitHub API when GITHUB_TOKEN is configured.
 * Ensures all Vercel serverless lambda instances stay synchronized across devices.
 */
async function fetchFromGitHubIfConfigured() {
  const { token, repo, branch, filePath } = getGitHubConfig();
  if (!token) return null;

  // Avoid redundant calls within 1.5s on the same warm lambda
  if (memoryStore && Date.now() - lastGitHubFetchAt < 1500) {
    return memoryStore;
  }

  try {
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Jacmat-Store",
        "Cache-Control": "no-cache"
      }
    });

    if (getRes.ok) {
      const fileData = await getRes.json();
      if (fileData && fileData.content) {
        const raw = Buffer.from(fileData.content, "base64").toString("utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.products)) {
          lastGitHubFetchAt = Date.now();
          memoryStore = parsed;
          globalThis.__JACMAT_STORE__ = parsed;
          try {
            fs.writeFileSync(tmpStorePath, JSON.stringify(parsed, null, 2), "utf-8");
          } catch {}
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn("[STORAGE] GitHub read notice:", err.message);
  }
  return null;
}

/**
 * Optional GitHub repository sync if GITHUB_TOKEN or GH_TOKEN is provided.
 * Commits data/store.json back to GitHub so changes persist across all Vercel serverless instances.
 */
async function syncToGitHubIfConfigured(data) {
  const { token, repo, branch, filePath } = getGitHubConfig();
  if (!token) return;

  try {
    const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Jacmat-Store",
        "Cache-Control": "no-cache"
      }
    });

    let sha = null;
    if (getRes.ok) {
      const fileData = await getRes.json();
      sha = fileData.sha;
    }

    const jsonString = JSON.stringify(data, null, 2);
    const contentBase64 = Buffer.from(jsonString, "utf-8").toString("base64");

    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "Jacmat-Store"
      },
      body: JSON.stringify({
        message: "chore(store): update store.json from Jacmat admin dashboard [skip ci]",
        content: contentBase64,
        sha: sha || undefined,
        branch
      })
    });

    if (putRes.ok) {
      lastGitHubFetchAt = Date.now();
      console.log("[STORAGE] Successfully synced data/store.json to GitHub repository!");
    } else {
      const errText = await putRes.text();
      console.warn("[STORAGE] GitHub sync error response:", putRes.status, errText);
    }
  } catch (err) {
    console.error("[STORAGE] GitHub sync exception:", err.message);
  }
}

/**
 * Local & Serverless JSON Store Handler
 * Guaranteed zero-crash: reads from GitHub / tmp / cache / bundle, writes safely to /tmp, local, and GitHub.
 */
async function readLocalStore() {
  // 0. If GITHUB_TOKEN is configured, fetch latest committed store.json from GitHub API
  const remoteData = await fetchFromGitHubIfConfigured();
  if (remoteData) {
    return remoteData;
  }

  // 1. Try reading from tmpStorePath first (contains the latest runtime updates on Vercel / serverless)
  try {
    if (fs.existsSync(tmpStorePath)) {
      const raw = fs.readFileSync(tmpStorePath, "utf-8");
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.products)) {
        memoryStore = data;
        globalThis.__JACMAT_STORE__ = memoryStore;
        return memoryStore;
      }
    }
  } catch (err) {
    console.warn("[STORE] Failed reading from tmpStorePath:", err.message);
  }

  // 2. If memoryStore is already loaded in memory, return it
  if (memoryStore && Array.isArray(memoryStore.products)) {
    return memoryStore;
  }

  // 3. Try reading from localStorePath (bundled with deployment bundle)
  try {
    if (fs.existsSync(localStorePath)) {
      const raw = fs.readFileSync(localStorePath, "utf-8");
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.products)) {
        memoryStore = data;
        globalThis.__JACMAT_STORE__ = memoryStore;
        return memoryStore;
      }
    }
  } catch (err) {
    console.warn("[STORE] Failed reading from localStorePath:", err.message);
  }

  // 4. Fallback: seed from initial products
  const initialProducts = getInitialProductsFromDisk();
  const fallbackData = {
    products: initialProducts,
    categories: DEFAULT_CATEGORIES,
    settings: DEFAULT_SETTINGS
  };
  memoryStore = fallbackData;
  globalThis.__JACMAT_STORE__ = memoryStore;
  return memoryStore;
}

async function writeLocalStore(data) {
  memoryStore = data;
  globalThis.__JACMAT_STORE__ = data;
  lastGitHubFetchAt = Date.now();

  const content = JSON.stringify(data, null, 2);

  // 1. Attempt writing to localStorePath (works in local dev)
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(localStorePath, content, "utf-8");
  } catch (err) {
    // Expected on Vercel EROFS read-only deployment filesystem
    console.warn("[STORE] localStorePath is read-only (EROFS). Writing to /tmp storage instead.");
  }

  // 2. Always write to tmpStorePath (writable on Vercel, AWS Lambda, Linux, Windows)
  try {
    fs.writeFileSync(tmpStorePath, content, "utf-8");
  } catch (err) {
    console.error("[STORE] Failed to write to tmpStorePath:", err.message);
  }

  // 3. Await sync to GitHub repository if GITHUB_TOKEN is present (must be awaited on Vercel serverless!)
  try {
    await syncToGitHubIfConfigured(data);
  } catch (err) {
    console.warn("[STORE] GitHub sync notice:", err.message);
  }
}

/* ==========================================================================
   PUBLIC & ADMIN DATA ACCESS LAYER METHODS
   ========================================================================== */

/**
 * Get all published products (for storefront)
 */
export async function getPublishedProducts() {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE status = 'published' ORDER BY created_at DESC"
    );
    return rows.map(mapPgProduct);
  }

  const store = await readLocalStore();
  return store.products
    .filter((p) => p.status === "published")
    .map((p) => ({ ...p, sku: p.sku || generateSku(p.category, p.name) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get all products (admin view, includes drafts)
 */
export async function getAllProducts() {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query("SELECT * FROM products ORDER BY created_at DESC");
    return rows.map(mapPgProduct);
  }

  const store = await readLocalStore();
  return store.products
    .map((p) => ({ ...p, sku: p.sku || generateSku(p.category, p.name) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get a single product by ID or Slug
 */
export async function getProductByIdOrSlug(idOrSlug) {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE id = $1 OR slug = $1 LIMIT 1",
      [idOrSlug]
    );
    return rows.length > 0 ? mapPgProduct(rows[0]) : null;
  }

  const store = await readLocalStore();
  const prod = store.products.find((p) => p.id === idOrSlug || p.slug === idOrSlug);
  if (!prod) return null;
  return { ...prod, sku: prod.sku || generateSku(prod.category, prod.name) };
}

/**
 * Create a new product
 */
export async function createProduct(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Données de produit invalides.");
  }

  const name = String(data.name || "").trim().slice(0, 200);
  if (!name) throw new Error("Le nom du produit est requis.");

  let slug = slugify(data.slug || name);
  if (!slug) slug = `produit-${Date.now()}`;

  const price = Number(data.price);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    throw new Error("Le prix doit être un nombre positif valide.");
  }

  const rawSalePrice = data.salePrice !== null && data.salePrice !== undefined && data.salePrice !== ""
    ? Number(data.salePrice)
    : null;
  if (rawSalePrice !== null && (!Number.isFinite(rawSalePrice) || rawSalePrice < 0 || rawSalePrice > 1000000)) {
    throw new Error("Le prix promotionnel doit être un nombre positif valide.");
  }
  const salePrice = rawSalePrice;

  const category = slugify(data.category || "tops") || "tops";
  const sku = data.sku && String(data.sku).trim()
    ? String(data.sku).trim().toUpperCase().slice(0, 60)
    : generateSku(category, name);

  const validImages = Array.isArray(data.images)
    ? data.images.map(sanitizeImageUrlServer).filter(Boolean)
    : [];
  const images = validImages.length > 0 ? validImages : ["/logo.png"];

  const variants = sanitizeVariants(data.variants);

  const soldOut = Boolean(data.soldOut);
  const preOrder = Boolean(data.preOrder);
  const status = data.status === "draft" ? "draft" : "published";
  const description = String(data.description || "").trim().slice(0, 5000);

  const id = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newProduct = {
    id,
    sku,
    name,
    slug,
    description,
    price,
    salePrice,
    category,
    images,
    variants,
    soldOut,
    preOrder,
    status,
    createdAt: now,
    updatedAt: now
  };

  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    // Check slug uniqueness
    const slugCheck = await pool.query("SELECT id FROM products WHERE slug = $1", [slug]);
    if (slugCheck.rows.length > 0) {
      newProduct.slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    await pool.query(
      `INSERT INTO products (id, sku, name, slug, description, price, sale_price, category, images, variants, sold_out, pre_order, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        newProduct.id,
        newProduct.sku,
        newProduct.name,
        newProduct.slug,
        newProduct.description,
        newProduct.price,
        newProduct.salePrice,
        newProduct.category,
        JSON.stringify(newProduct.images),
        JSON.stringify(newProduct.variants),
        newProduct.soldOut,
        newProduct.preOrder,
        newProduct.status,
        newProduct.createdAt,
        newProduct.updatedAt
      ]
    );
    return newProduct;
  }

  const store = await readLocalStore();
  // Ensure unique slug
  if (store.products.some((p) => p.slug === slug)) {
    newProduct.slug = `${slug}-${Date.now().toString().slice(-4)}`;
  }
  store.products.unshift(newProduct);
  await writeLocalStore(store);
  return newProduct;
}

/**
 * Update an existing product (strictly whitelisted fields, no mass-assignment)
 */
export async function updateProduct(id, data) {
  if (!id || !data || typeof data !== "object") {
    throw new Error("Paramètres de mise à jour invalides.");
  }

  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const existing = await getProductByIdOrSlug(id);
    if (!existing) throw new Error("Produit introuvable.");

    const name = data.name !== undefined ? String(data.name).trim().slice(0, 200) : existing.name;
    if (!name) throw new Error("Le nom du produit ne peut pas être vide.");

    let slug = data.slug !== undefined ? slugify(data.slug) : existing.slug;
    if (!slug) slug = existing.slug;

    // Check slug uniqueness if changed
    if (slug !== existing.slug) {
      const slugCheck = await pool.query("SELECT id FROM products WHERE slug = $1 AND id != $2", [slug, existing.id]);
      if (slugCheck.rows.length > 0) {
        slug = `${slug}-${Date.now().toString().slice(-4)}`;
      }
    }

    const price = data.price !== undefined ? Number(data.price) : existing.price;
    if (!Number.isFinite(price) || price < 0 || price > 1000000) {
      throw new Error("Le prix doit être un nombre positif valide.");
    }

    const salePrice = data.salePrice !== undefined
      ? (data.salePrice === null || data.salePrice === "" ? null : Number(data.salePrice))
      : existing.salePrice;
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > 1000000)) {
      throw new Error("Le prix promotionnel doit être un nombre positif valide.");
    }

    const category = data.category !== undefined ? (slugify(data.category) || existing.category) : existing.category;
    const sku = data.sku !== undefined && String(data.sku).trim()
      ? String(data.sku).trim().toUpperCase().slice(0, 60)
      : (existing.sku || generateSku(category, name));

    let images = existing.images;
    if (Array.isArray(data.images)) {
      const validImgs = data.images.map(sanitizeImageUrlServer).filter(Boolean);
      images = validImgs.length > 0 ? validImgs : ["/logo.png"];
    }

    const variants = data.variants !== undefined ? sanitizeVariants(data.variants) : existing.variants;
    const soldOut = data.soldOut !== undefined ? Boolean(data.soldOut) : existing.soldOut;
    const preOrder = data.preOrder !== undefined ? Boolean(data.preOrder) : existing.preOrder;
    const status = data.status !== undefined ? (data.status === "draft" ? "draft" : "published") : existing.status;
    const description = data.description !== undefined ? String(data.description).trim().slice(0, 5000) : existing.description;
    const updatedAt = new Date().toISOString();

    await pool.query(
      `UPDATE products
       SET name = $1, slug = $2, description = $3, price = $4, sale_price = $5, category = $6,
           images = $7, variants = $8, sold_out = $9, pre_order = $10, status = $11, updated_at = $12, sku = $13
       WHERE id = $14`,
      [
        name,
        slug,
        description,
        price,
        salePrice,
        category,
        JSON.stringify(images),
        JSON.stringify(variants),
        soldOut,
        preOrder,
        status,
        updatedAt,
        sku,
        existing.id
      ]
    );

    return {
      id: existing.id,
      sku,
      name,
      slug,
      description,
      price,
      salePrice,
      category,
      images,
      variants,
      soldOut,
      preOrder,
      status,
      createdAt: existing.createdAt,
      updatedAt
    };
  }

  const store = await readLocalStore();
  let index = store.products.findIndex((p) => p.id === id || p.slug === id);
  if (index === -1 && data.name) {
    // Upsert if product was created on another lambda instance and full data is provided
    const upserted = {
      id: String(id).slice(0, 100),
      sku: data.sku ? String(data.sku).trim().toUpperCase().slice(0, 60) : generateSku(data.category, data.name),
      name: String(data.name).trim().slice(0, 200),
      slug: slugify(data.slug || data.name) || `produit-${Date.now()}`,
      description: String(data.description || "").trim().slice(0, 5000),
      price: Number.isFinite(Number(data.price)) && Number(data.price) >= 0 ? Number(data.price) : 0,
      salePrice: data.salePrice !== null && data.salePrice !== undefined && data.salePrice !== "" ? Number(data.salePrice) : null,
      category: slugify(data.category || "tops") || "tops",
      images: Array.isArray(data.images) ? data.images.map(sanitizeImageUrlServer).filter(Boolean) : ["/logo.png"],
      variants: sanitizeVariants(data.variants),
      soldOut: Boolean(data.soldOut),
      preOrder: Boolean(data.preOrder),
      status: data.status === "draft" ? "draft" : "published",
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.products.unshift(upserted);
    await writeLocalStore(store);
    return upserted;
  }
  if (index === -1) throw new Error("Produit introuvable.");

  const current = store.products[index];
  const name = data.name !== undefined ? String(data.name).trim().slice(0, 200) : current.name;
  if (!name) throw new Error("Le nom du produit ne peut pas être vide.");

  let slug = data.slug !== undefined ? slugify(data.slug) : current.slug;
  if (!slug) slug = current.slug;
  if (slug !== current.slug && store.products.some((p, i) => i !== index && p.slug === slug)) {
    slug = `${slug}-${Date.now().toString().slice(-4)}`;
  }

  const price = data.price !== undefined ? Number(data.price) : current.price;
  if (!Number.isFinite(price) || price < 0 || price > 1000000) {
    throw new Error("Le prix doit être un nombre positif valide.");
  }

  const salePrice = data.salePrice !== undefined
    ? (data.salePrice === null || data.salePrice === "" ? null : Number(data.salePrice))
    : current.salePrice;
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice > 1000000)) {
    throw new Error("Le prix promotionnel doit être un nombre positif valide.");
  }

  const category = data.category !== undefined ? (slugify(data.category) || current.category) : current.category;
  const sku = data.sku !== undefined && String(data.sku).trim()
    ? String(data.sku).trim().toUpperCase().slice(0, 60)
    : (current.sku || generateSku(category, name));

  let images = current.images;
  if (Array.isArray(data.images)) {
    const validImgs = data.images.map(sanitizeImageUrlServer).filter(Boolean);
    images = validImgs.length > 0 ? validImgs : ["/logo.png"];
  }

  const variants = data.variants !== undefined ? sanitizeVariants(data.variants) : current.variants;
  const soldOut = data.soldOut !== undefined ? Boolean(data.soldOut) : Boolean(current.soldOut);
  const preOrder = data.preOrder !== undefined ? Boolean(data.preOrder) : Boolean(current.preOrder);
  const status = data.status !== undefined ? (data.status === "draft" ? "draft" : "published") : (current.status || "published");
  const description = data.description !== undefined ? String(data.description).trim().slice(0, 5000) : (current.description || "");

  const updated = {
    id: current.id,
    sku,
    name,
    slug,
    description,
    price,
    salePrice,
    category,
    images,
    variants,
    soldOut,
    preOrder,
    status,
    createdAt: current.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  store.products[index] = updated;
  await writeLocalStore(store);
  return updated;
}

/**
 * Delete a product by ID
 */
export async function deleteProduct(id) {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const res = await pool.query("DELETE FROM products WHERE id = $1 OR slug = $1 RETURNING id", [id]);
    if (res.rowCount === 0) throw new Error("Produit introuvable.");
    return { success: true, id };
  }

  const store = await readLocalStore();
  const initialLen = store.products.length;
  store.products = store.products.filter((p) => p.id !== id && p.slug !== id);
  if (store.products.length === initialLen) throw new Error("Produit introuvable.");
  await writeLocalStore(store);
  return { success: true, id };
}

/**
 * Get all categories
 */
export async function getCategories() {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query("SELECT * FROM categories ORDER BY name ASC");
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, description: r.description }));
  }

  const store = await readLocalStore();
  return store.categories && store.categories.length > 0 ? store.categories : DEFAULT_CATEGORIES;
}

/**
 * Create a new category
 */
export async function createCategory(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Données de catégorie invalides.");
  }
  const name = String(data.name || "").trim().slice(0, 120);
  if (!name) throw new Error("Le nom de la catégorie est requis.");
  const slug = slugify(data.slug || name);
  if (!slug) throw new Error("Nom de catégorie invalide.");
  const id = slug;
  const description = String(data.description || "").trim().slice(0, 500);

  const newCat = { id, name, slug, description };

  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    await pool.query(
      "INSERT INTO categories (id, name, slug, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = $2, description = $4",
      [id, name, slug, description]
    );
    return newCat;
  }

  const store = await readLocalStore();
  if (!store.categories) store.categories = [...DEFAULT_CATEGORIES];
  const existingIndex = store.categories.findIndex((c) => c.id === id || c.slug === slug);
  if (existingIndex >= 0) {
    store.categories[existingIndex] = { ...store.categories[existingIndex], name, description };
  } else {
    store.categories.push(newCat);
  }
  await writeLocalStore(store);
  return newCat;
}

/**
 * Delete category with safety check
 */
export async function deleteCategory(id) {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM products WHERE category = $1", [id]);
    const count = parseInt(rows[0].count, 10);
    if (count > 0) {
      throw new Error(`Impossible de supprimer cette catégorie : ${count} produit(s) y sont actuellement associés.`);
    }
    await pool.query("DELETE FROM categories WHERE id = $1", [id]);
    return { success: true, id };
  }

  const store = await readLocalStore();
  const linkedProducts = (store.products || []).filter((p) => p.category === id);
  if (linkedProducts.length > 0) {
    throw new Error(`Impossible de supprimer cette catégorie : ${linkedProducts.length} produit(s) y sont actuellement associés.`);
  }

  store.categories = (store.categories || []).filter((c) => c.id !== id);
  await writeLocalStore(store);
  return { success: true, id };
}

/**
 * Get store metrics for dashboard
 */
export async function getStoreStats() {
  const products = await getAllProducts();
  const categories = await getCategories();

  const total = products.length;
  const published = products.filter((p) => p.status === "published").length;
  const draft = products.filter((p) => p.status === "draft").length;
  const outOfStock = products.filter((p) => p.soldOut).length;

  return {
    totalProducts: total,
    publishedProducts: published,
    draftProducts: draft,
    outOfStockProducts: outOfStock,
    categoriesCount: categories.length
  };
}

/**
 * Get and update store settings
 */
export async function getStoreSettings() {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const { rows } = await pool.query("SELECT value FROM store_settings WHERE key = 'general' LIMIT 1");
    return rows.length > 0 ? rows[0].value : DEFAULT_SETTINGS;
  }
  const store = await readLocalStore();
  return store.settings || DEFAULT_SETTINGS;
}

function sanitizeSettings(current, incoming) {
  if (!incoming || typeof incoming !== "object") return current;
  return {
    storeName: incoming.storeName !== undefined ? String(incoming.storeName).trim().slice(0, 120) || DEFAULT_SETTINGS.storeName : current.storeName,
    slogan: incoming.slogan !== undefined ? String(incoming.slogan).trim().slice(0, 200) : current.slogan,
    whatsappPhone: incoming.whatsappPhone !== undefined ? String(incoming.whatsappPhone).replace(/[^0-9]/g, "").slice(0, 20) || DEFAULT_SETTINGS.whatsappPhone : current.whatsappPhone,
    contactEmail: incoming.contactEmail !== undefined ? String(incoming.contactEmail).trim().slice(0, 150) : current.contactEmail,
    currency: incoming.currency !== undefined ? String(incoming.currency).trim().slice(0, 10) || "$" : (current.currency || "$"),
    maintenanceMode: incoming.maintenanceMode !== undefined ? Boolean(incoming.maintenanceMode) : Boolean(current.maintenanceMode)
  };
}

export async function updateStoreSettings(newSettings) {
  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const current = await getStoreSettings();
    const updated = sanitizeSettings(current, newSettings);
    await pool.query(
      "INSERT INTO store_settings (key, value) VALUES ('general', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(updated)]
    );
    return updated;
  }
  const store = await readLocalStore();
  store.settings = sanitizeSettings(store.settings || DEFAULT_SETTINGS, newSettings);
  await writeLocalStore(store);
  return store.settings;
}

/**
 * Export full store data for manual backup
 */
export async function exportStoreData() {
  const products = await getAllProducts();
  const categories = await getCategories();
  const settings = await getStoreSettings();
  return {
    exportedAt: new Date().toISOString(),
    storeName: "JACMAT STORE",
    products,
    categories,
    settings
  };
}

/**
 * Import store data to restore backup (validated & transactional)
 */
export async function importStoreData(imported) {
  if (!imported || !Array.isArray(imported.products)) {
    throw new Error("Format de sauvegarde invalide. Le fichier doit contenir une liste 'products'.");
  }

  const sanitizedProducts = imported.products
    .filter((p) => p && typeof p === "object" && String(p.name || "").trim())
    .map((p, idx) => {
      const name = String(p.name).trim().slice(0, 200);
      const slug = slugify(p.slug || name) || `piece-${idx + 1}`;
      const category = slugify(p.category || inferCategory(name)) || "tops";
      const price = Number.isFinite(Number(p.price)) && Number(p.price) >= 0 ? Number(p.price) : 0;
      const salePrice = p.salePrice !== null && p.salePrice !== undefined && p.salePrice !== "" && Number.isFinite(Number(p.salePrice)) && Number(p.salePrice) >= 0
        ? Number(p.salePrice)
        : null;
      const validImgs = Array.isArray(p.images) ? p.images.map(sanitizeImageUrlServer).filter(Boolean) : [];
      return {
        id: String(p.id || `prod_${slug}`).slice(0, 100),
        sku: p.sku ? String(p.sku).trim().toUpperCase().slice(0, 60) : generateSku(category, name),
        name,
        slug,
        description: String(p.description || "").trim().slice(0, 5000),
        price,
        salePrice,
        category,
        images: validImgs.length > 0 ? validImgs : ["/logo.png"],
        variants: sanitizeVariants(p.variants),
        soldOut: Boolean(p.soldOut),
        preOrder: Boolean(p.preOrder),
        status: p.status === "draft" ? "draft" : "published",
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });

  const sanitizedCategories = Array.isArray(imported.categories) && imported.categories.length > 0
    ? imported.categories
        .filter((c) => c && typeof c === "object" && String(c.name || "").trim())
        .map((c) => {
          const name = String(c.name).trim().slice(0, 120);
          const slug = slugify(c.slug || c.id || name);
          return {
            id: slug,
            name,
            slug,
            description: String(c.description || "").trim().slice(0, 500)
          };
        })
        .filter((c) => Boolean(c.slug))
    : DEFAULT_CATEGORIES;

  const pool = getPgPool();
  if (pool) {
    await initPgSchema(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const cat of sanitizedCategories) {
        await client.query(
          "INSERT INTO categories (id, name, slug, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = $2, description = $4",
          [cat.id, cat.name, cat.slug, cat.description]
        );
      }
      for (const p of sanitizedProducts) {
        await client.query(
          `INSERT INTO products (id, sku, name, slug, description, price, sale_price, category, images, variants, sold_out, pre_order, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (id) DO UPDATE SET
             sku = $2, name = $3, slug = $4, description = $5, price = $6, sale_price = $7,
             category = $8, images = $9, variants = $10, sold_out = $11, pre_order = $12, status = $13, updated_at = $15`,
          [
            p.id,
            p.sku,
            p.name,
            p.slug,
            p.description,
            p.price,
            p.salePrice,
            p.category,
            JSON.stringify(p.images),
            JSON.stringify(p.variants),
            p.soldOut,
            p.preOrder,
            p.status,
            p.createdAt,
            p.updatedAt
          ]
        );
      }
      if (imported.settings && typeof imported.settings === "object") {
        const currentSettings = await getStoreSettings();
        const updatedSettings = sanitizeSettings(currentSettings, imported.settings);
        await client.query(
          "INSERT INTO store_settings (key, value) VALUES ('general', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
          [JSON.stringify(updatedSettings)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return { success: true, count: sanitizedProducts.length };
  }

  const store = await readLocalStore();
  store.products = sanitizedProducts;
  store.categories = sanitizedCategories;
  if (imported.settings && typeof imported.settings === "object") {
    store.settings = sanitizeSettings(store.settings || DEFAULT_SETTINGS, imported.settings);
  }
  await writeLocalStore(store);
  return { success: true, count: store.products.length };
}

function mapPgProduct(row) {
  const cat = row.category || "tops";
  return {
    id: row.id,
    sku: row.sku || generateSku(cat, row.name),
    name: row.name,
    slug: row.slug,
    description: row.description,
    price: Number(row.price),
    salePrice: row.sale_price !== null ? Number(row.sale_price) : null,
    category: cat,
    images: typeof row.images === "string" ? JSON.parse(row.images) : row.images || [],
    variants: typeof row.variants === "string" ? JSON.parse(row.variants) : row.variants || {},
    soldOut: Boolean(row.sold_out),
    preOrder: Boolean(row.pre_order),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
