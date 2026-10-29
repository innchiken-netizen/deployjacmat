/**
 * JACMAT STORE — Rate Limiting for Admin Login
 * In-memory sliding window rate limiter with auto-expiry.
 * Clean abstraction ready for Upstash / Redis plugin in production.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const MAX_TRACKED_IPS = 5000;

// In-memory store: IP -> { attempts: number, resetAt: number }
const attemptsMap = new Map();

/**
 * Prune expired entries and enforce bounded memory size
 */
function pruneAttemptsMap(now) {
  for (const [key, record] of attemptsMap.entries()) {
    if (now > record.resetAt) {
      attemptsMap.delete(key);
    }
  }
  // Evict oldest entries if map still exceeds capacity
  if (attemptsMap.size >= MAX_TRACKED_IPS) {
    const excess = attemptsMap.size - MAX_TRACKED_IPS + 1;
    let removed = 0;
    for (const key of attemptsMap.keys()) {
      attemptsMap.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }
}

/**
 * Get client IP from request headers (supporting Vercel / reverse proxies)
 * @param {object} req
 * @returns {string}
 */
export function getClientIp(req) {
  const headers = req.headers || {};
  const forwarded = headers["x-forwarded-for"] || (req.headers?.get && req.headers.get("x-forwarded-for"));
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  const realIp = headers["x-real-ip"] || (req.headers?.get && req.headers.get("x-real-ip"));
  if (realIp) return String(realIp).trim();
  return req.socket?.remoteAddress || "127.0.0.1";
}

/**
 * Check if the given IP is currently rate limited
 * @param {string} ip
 * @returns {{ limited: boolean, remainingAttempts: number, retryAfterSeconds: number }}
 */
export function checkRateLimit(ip) {
  const now = Date.now();
  const record = attemptsMap.get(ip);

  if (!record || now > record.resetAt) {
    return { limited: false, remainingAttempts: MAX_ATTEMPTS, retryAfterSeconds: 0 };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((record.resetAt - now) / 1000);
    return { limited: true, remainingAttempts: 0, retryAfterSeconds: retryAfter };
  }

  return { limited: false, remainingAttempts: MAX_ATTEMPTS - record.attempts, retryAfterSeconds: 0 };
}

/**
 * Record a failed login attempt for an IP
 * @param {string} ip
 */
export function recordFailedAttempt(ip) {
  const now = Date.now();
  if (attemptsMap.size > 100) {
    pruneAttemptsMap(now);
  }
  const record = attemptsMap.get(ip);

  if (!record || now > record.resetAt) {
    attemptsMap.set(ip, { attempts: 1, resetAt: now + WINDOW_MS });
  } else {
    record.attempts += 1;
  }
}

/**
 * Reset failed attempts on successful login
 * @param {string} ip
 */
export function resetAttempts(ip) {
  attemptsMap.delete(ip);
}
