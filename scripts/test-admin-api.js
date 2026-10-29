/**
 * JACMAT STORE — Comprehensive Admin, API & Security Verification Suite
 */

import fs from "fs";
import path from "path";
import { handleApiRequest } from "../lib/api-router.js";
import { escapeHtml, sanitizeImageUrl } from "../src/js/utils/sanitize.js";

const STORE_FILE = path.resolve(process.cwd(), "data", "store.json");
const originalStoreContent = fs.existsSync(STORE_FILE) ? fs.readFileSync(STORE_FILE, "utf-8") : null;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// Mock minimal request/response for direct testing of handleApiRequest
function mockRequest(method, url, headers = {}, body = null) {
  const req = {
    method,
    url,
    headers: { host: "localhost:3000", ...headers },
    on: (event, handler) => {
      if (event === "data" && body) {
        handler(typeof body === "string" ? body : JSON.stringify(body));
      }
      if (event === "end") {
        handler();
      }
    }
  };

  let statusCode = 200;
  const resHeaders = {};
  let bodyData = "";

  const res = {
    get statusCode() { return statusCode; },
    set statusCode(code) { statusCode = code; },
    setHeader: (k, v) => { resHeaders[k.toLowerCase()] = v; },
    getHeader: (k) => resHeaders[k.toLowerCase()],
    end: (chunk) => {
      if (chunk) bodyData += chunk;
    }
  };

  return {
    req,
    res,
    getResult: () => ({
      status: statusCode,
      headers: resHeaders,
      body: bodyData ? JSON.parse(bodyData) : null
    })
  };
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("  TESTING JACMAT STORE ADMIN SUITE & API SECURITY");
  console.log("=======================================================\n");

  let authCookie = "";
  let createdProductId = "";

  try {
    // Test 1: Public endpoint GET /api/products + Security Headers
    {
      const { req, res, getResult } = mockRequest("GET", "/api/products");
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 1: status should be 200");
      assert(Array.isArray(result.body), "Test 1: body should be an array");
      assert(result.headers["x-content-type-options"] === "nosniff", "Test 1: missing X-Content-Type-Options header");
      assert(result.headers["x-frame-options"] === "DENY", "Test 1: missing X-Frame-Options header");
      console.log(`[PASS] 1. Public /api/products returns ${result.body.length} published products with security headers`);
    }

    // Test 2: Unauthenticated GET /api/admin/products -> 401 Unauthorized
    {
      const { req, res, getResult } = mockRequest("GET", "/api/admin/products");
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 401, "Test 2: should return 401 Unauthorized");
      console.log(`[PASS] 2. Unauthenticated /api/admin/products is rejected (HTTP ${result.status})`);
    }

    // Test 3: Failed login with invalid password
    {
      const { req, res, getResult } = mockRequest(
        "POST",
        "/api/admin/login",
        {},
        { email: "admin@jacmat.store", password: "wrong_password_xyz" }
      );
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 401, "Test 3: wrong password should return 401");
      assert(result.body.error === "Email ou mot de passe incorrect.", "Test 3: wrong generic error");
      console.log(`[PASS] 3. Invalid credentials rejected with generic error: "${result.body.error}"`);
    }

    // Test 4: Successful login with correct credentials
    {
      const { req, res, getResult } = mockRequest(
        "POST",
        "/api/admin/login",
        {},
        { email: "admin@jacmat.store", password: "admin123456" }
      );
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 4: valid credentials should return 200");
      assert(Boolean(result.headers["set-cookie"]), "Test 4: missing Set-Cookie header");
      assert(result.headers["set-cookie"].includes("HttpOnly"), "Test 4: cookie must be HttpOnly");
      assert(result.headers["set-cookie"].includes("SameSite=Strict"), "Test 4: cookie must be SameSite=Strict");
      authCookie = result.headers["set-cookie"].split(";")[0];
      console.log(`[PASS] 4. Successful login returns signed HttpOnly SameSite=Strict session cookie`);
    }

    // Test 5: GET /api/admin/me with valid session cookie
    {
      const { req, res, getResult } = mockRequest("GET", "/api/admin/me", { cookie: authCookie });
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 5: should be 200");
      assert(result.body.authenticated === true, "Test 5: authenticated must be true");
      console.log(`[PASS] 5. Session verification /api/admin/me confirmed for: ${result.body.email}`);
    }

    // Test 6: GET /api/admin/stats
    {
      const { req, res, getResult } = mockRequest("GET", "/api/admin/stats", { cookie: authCookie });
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 6: stats should be 200");
      console.log(
        `[PASS] 6. Real stats calculated: ${result.body.totalProducts} total, ${result.body.publishedProducts} published, ${result.body.draftProducts} draft, ${result.body.categoriesCount} categories`
      );
    }

    // Test 7: Create a DRAFT product + verify XSS image URL & prototype pollution sanitization
    {
      const newProductPayload = {
        name: "Hoodie Test Jacmat V2",
        price: 85,
        salePrice: 69.99,
        category: "outerwear",
        status: "draft",
        description: "Pièce test en mode brouillon",
        images: ["javascript:alert(1)", "/images/SS80.jpg"],
        variants: JSON.parse('{"Taille":["M","L"],"__proto__":["polluted"]}')
      };
      const { req, res, getResult } = mockRequest("POST", "/api/admin/products", { cookie: authCookie }, newProductPayload);
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 201, "Test 7: creation should return 201");
      createdProductId = result.body.product.id;
      assert(
        result.body.product.images.length === 1 && result.body.product.images[0] === "/images/SS80.jpg",
        "Test 7: dangerous javascript: image URL must be stripped"
      );
      assert(
        !Object.prototype.hasOwnProperty.call(result.body.product.variants, "__proto__"),
        "Test 7: __proto__ variant key must be stripped"
      );
      console.log(
        `[PASS] 7. Created draft product "${result.body.product.name}" & sanitized dangerous image URLs / __proto__ keys`
      );

      // Verify it is NOT visible in public /api/products
      const pubCheck = mockRequest("GET", "/api/products");
      await handleApiRequest(pubCheck.req, pubCheck.res);
      const pubList = pubCheck.getResult().body;
      const isPublic = pubList.some((p) => p.id === createdProductId);
      assert(!isPublic, "Test 7b: Draft product should NOT appear in public catalog");
      console.log("[PASS] 7b. Verified draft product is strictly hidden from public store!");
    }

    // Test 8: Publish the product via PUT /api/admin/products & verify mass-assignment protection
    {
      const { req, res, getResult } = mockRequest(
        "PUT",
        "/api/admin/products",
        { cookie: authCookie },
        {
          id: createdProductId,
          status: "published",
          price: 79.99,
          isAdminHack: true,
          createdAt: "1999-01-01T00:00:00.000Z"
        }
      );
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 8: update should return 200");
      assert(result.body.product.isAdminHack === undefined, "Test 8: arbitrary mass-assigned fields must be ignored");
      assert(result.body.product.createdAt !== "1999-01-01T00:00:00.000Z", "Test 8: createdAt must not be overwritten");
      console.log(`[PASS] 8. Published product, updated price to ${result.body.product.price}$, and blocked mass-assignment`);

      // Verify it IS now visible in public /api/products
      const pubCheck = mockRequest("GET", "/api/products");
      await handleApiRequest(pubCheck.req, pubCheck.res);
      const pubList = pubCheck.getResult().body;
      const isPublic = pubList.some((p) => p.id === createdProductId);
      assert(isPublic, "Test 8b: Published product must now appear in public catalog");
      console.log("[PASS] 8b. Verified product is immediately visible on the public store!");
    }

    // Test 9: CSRF Origin Validation blocks cross-origin state-changing requests
    {
      const { req, res, getResult } = mockRequest(
        "DELETE",
        `/api/admin/products?id=${createdProductId}`,
        {
          cookie: authCookie,
          host: "jacmat.store",
          origin: "https://evil-attacker.example.com"
        }
      );
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 403, "Test 9: cross-origin state mutation must return 403 Forbidden");
      console.log("[PASS] 9. CSRF protection blocked cross-origin DELETE request (HTTP 403)");
    }

    // Test 10: Upload validation rejects non-image data URLs (e.g. data:text/html)
    {
      const { req, res, getResult } = mockRequest(
        "POST",
        "/api/admin/upload",
        { cookie: authCookie },
        {
          filename: "exploit.html",
          dataUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="
        }
      );
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 400, "Test 10: non-image dataUrl upload must be rejected with 400");
      console.log("[PASS] 10. Upload endpoint rejected non-image data:text/html payload (HTTP 400)");
    }

    // Test 11: Vercel rewrite query routing (?__route=...) & deterministic /api/version
    {
      const v1 = mockRequest("GET", "/api?__route=version");
      await handleApiRequest(v1.req, v1.res);
      const res1 = v1.getResult();
      assert(res1.status === 200 && typeof res1.body.catalogVersion === "number", "Test 11: /api?__route=version should return 200");

      const v2 = mockRequest("GET", "/api/version");
      await handleApiRequest(v2.req, v2.res);
      const res2 = v2.getResult();
      assert(
        res1.body.catalogVersion === res2.body.catalogVersion,
        "Test 11: catalogVersion must be deterministic when catalog has not changed"
      );
      console.log(`[PASS] 11. Vercel rewrite routing (?__route=version) & deterministic catalogVersion (${res1.body.catalogVersion}) verified`);
    }

    // Test 12: Delete the test product via DELETE /api/admin/products?id=...
    {
      const { req, res, getResult } = mockRequest("DELETE", `/api/admin/products?id=${createdProductId}`, { cookie: authCookie });
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 12: delete should return 200");
      console.log(`[PASS] 12. Deleted test product (ID: ${createdProductId})`);

      // Verify it is removed from public store
      const pubCheck = mockRequest("GET", "/api/products");
      await handleApiRequest(pubCheck.req, pubCheck.res);
      const pubList = pubCheck.getResult().body;
      const isPublic = pubList.some((p) => p.id === createdProductId);
      assert(!isPublic, "Test 12b: Deleted product must no longer appear in public catalog");
      console.log("[PASS] 12b. Verified deleted product is completely gone from store!");
    }

    // Test 13: Frontend HTML & Image URL Sanitizer unit checks
    {
      const maliciousHtml = `<img src=x onerror="alert('xss')">`;
      const escaped = escapeHtml(maliciousHtml);
      assert(!escaped.includes("<img") && escaped.includes("&lt;img"), "Test 13: escapeHtml must encode HTML tags");
      assert(sanitizeImageUrl("javascript:alert(1)") === "/logo.png", "Test 13: sanitizeImageUrl must block javascript: URLs");
      assert(sanitizeImageUrl("data:text/html;base64,abc") === "/logo.png", "Test 13: sanitizeImageUrl must block data:text/html");
      assert(sanitizeImageUrl("/images/SS80.jpg") === "/images/SS80.jpg", "Test 13: sanitizeImageUrl must allow relative paths");
      console.log("[PASS] 13. Frontend XSS & URL sanitization utilities verified");
    }

    // Test 14: Logout POST /api/admin/logout
    {
      const { req, res, getResult } = mockRequest("POST", "/api/admin/logout", { cookie: authCookie });
      await handleApiRequest(req, res);
      const result = getResult();
      assert(result.status === 200, "Test 14: logout should return 200");
      assert(result.headers["set-cookie"].includes("Max-Age=0"), "Test 14: Logout should clear cookie");
      console.log("[PASS] 14. Logout successfully invalidates and expires the session cookie");
    }

    console.log("\n=======================================================");
    console.log("  ALL 14 API, AUTH & SECURITY TESTS PASSED (100%)");
    console.log("=======================================================\n");
  } finally {
    if (originalStoreContent !== null) {
      fs.writeFileSync(STORE_FILE, originalStoreContent, "utf-8");
    }
  }
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
