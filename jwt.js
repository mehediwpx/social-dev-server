import crypto from "node:crypto";

/**
 * JWT verification for the Express API.
 *
 * Tokens are issued by better-auth's JWT plugin (running in the social-dev
 * Next.js app, default algorithm EdDSA/Ed25519, payload = the session user
 * including `email`, `sub` = user id). Verification here is local: it decodes
 * the JWT, downloads better-auth's public keys from the JWKS endpoint, and
 * checks signature, expiry, issuer and audience with node:crypto — no extra
 * npm dependency.
 *
 * Configuration (env, all optional):
 * - AUTH_JWKS_URL — better-auth JWKS endpoint. Defaults to
 *   http://localhost:3000/api/auth/jwks.
 * - JWT_ISSUER — expected `iss` of valid tokens. Defaults to the origin of
 *   AUTH_JWKS_URL (better-auth signs with the auth base URL as issuer AND
 *   audience).
 */

const JWKS_URL = process.env.AUTH_JWKS_URL || "http://localhost:3000/api/auth/jwks";
const ISSUER = process.env.JWT_ISSUER || new URL(JWKS_URL).origin;

const JWKS_TTL_MS = 5 * 60 * 1000;

let jwksCache = { keys: [], fetchedAt: 0 };
let jwksRefreshAt = 0; // cooldown between forced refreshes, anti-thundering-herd

async function fetchJwks(force = false) {
  const fresh = () => ({ keys: [], fetchedAt: 0 });
  if (!force && jwksCache.fetchedAt && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache;
  }
  try {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`JWKS ${res.status}`);
    const jwks = await res.json();
    if (!Array.isArray(jwks.keys)) throw new Error("Invalid JWKS payload");
    jwksCache = { keys: jwks.keys, fetchedAt: Date.now() };
  } catch (error) {
    console.error("JWT verification: failed to load JWKS:", error.message);
    if (!force && jwksCache.fetchedAt) {
      jwksCache = fresh();
    } else {
      jwksCache = jwksCache.fetchedAt ? jwksCache : fresh();
    }
  }
  return jwksCache;
}

function base64UrlToBuffer(segment) {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function findSigningKey(kid) {
  let jwks = await fetchJwks();
  let jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk && Date.now() - jwksRefreshAt > JWKS_TTL_MS) {
    // Key might have been rotated since the cache was filled — refresh once.
    jwksRefreshAt = Date.now();
    jwks = await fetchJwks(true);
    jwk = jwks.keys.find((key) => key.kid === kid);
  }
  if (!jwk) throw new Error("Unknown JWT signing key");
  if (jwk.alg !== "EdDSA" && jwk.alg !== "RS256" && jwk.alg !== "ES256") {
    throw new Error(`Unsupported key algorithm: ${jwk.alg}`);
  }
  return jwk;
}

/** Returns the verified JWT payload, or throws with a human-readable reason. */
export async function verifyJwtToken(token) {
  if (!token || typeof token !== "string" || token.split(".").length !== 3) {
    throw new Error("Malformed token");
  }

  const [headerPart, payloadPart, signaturePart] = token.split(".");
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlToBuffer(headerPart).toString("utf8"));
    payload = JSON.parse(base64UrlToBuffer(payloadPart).toString("utf8"));
  } catch {
    throw new Error("Malformed token");
  }

  const jwk = await findSigningKey(header.kid);
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });

  // ES256/EdDSA are verified one-shot (RSA uses PKCS#1 v1.5 with SHA-256).
  const ok = crypto.verify(null, base64UrlToBuffer(`${headerPart}.${payloadPart}`), publicKey, base64UrlToBuffer(signaturePart));
  if (!ok) throw new Error("Invalid signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");
  if (payload.iss && payload.iss !== ISSUER) throw new Error("Unexpected issuer");
  if (payload.aud) {
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(ISSUER)) throw new Error("Unexpected audience");
  }

  return payload;
}

/** Express middleware: 401s unauthenticated requests, attaches `req.user`. */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Missing bearer token" });
  }

  try {
    const payload = await verifyJwtToken(token);
    // better-auth signs the session user by default: `sub` = user id,
    // plus email/name/emailVerified — this is what ownership checks need.
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, message: `Unauthorized: ${error.message}` });
  }
}
