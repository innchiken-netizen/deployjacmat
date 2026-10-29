/**
 * JACMAT STORE — Security Sanitization & Output Encoding Utilities
 * Prevents DOM-based and Stored Cross-Site Scripting (XSS) across Storefront and Admin UI.
 */

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

/**
 * Escape untrusted string for safe interpolation inside HTML elements and attributes
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Sanitize an image or media URL to prevent javascript: / data:text/html URI injection
 * @param {unknown} rawUrl
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeImageUrl(rawUrl, fallback = "/logo.png") {
  if (!rawUrl || typeof rawUrl !== "string") return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallback;

  // Allow safe base64 raster image data URLs
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,[a-zA-Z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }

  // Block dangerous schemes (javascript:, vbscript:, data:, file:, blob: from untrusted storage)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return escapeHtml(trimmed);
      }
    } catch {
      return fallback;
    }
    return fallback;
  }

  // Relative path normalization
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // Prevent protocol-relative URLs (//evil.com)
  if (normalized.startsWith("//")) return fallback;
  return escapeHtml(normalized);
}
