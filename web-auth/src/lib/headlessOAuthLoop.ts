/**
 * Shared machinery for the headless (BFF) OAuth2 flow.
 *
 * Used by:
 *  - token-exchange.ts  — exchanges a legacy token for Hydra tokens in one shot
 *
 * The existing headless/request-otp.ts and headless/verify-otp.ts are kept as-is;
 * they contain their own copies of the helpers below (pre-refactor state).
 */

import { createHash, randomBytes } from 'node:crypto';
import { get as httpGet, type RequestOptions } from 'node:http';
import { profileClient } from './grpcClient';
import { acceptLogin, acceptConsent, getConsentRequest, buildClaims } from './hydraClient';

const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL ?? 'http://hydra:4444';
const HEADLESS_CLIENT_SECRET = process.env.HEADLESS_CLIENT_SECRET ?? 'test-secret';
const HEADLESS_REDIRECT_URI = process.env.HEADLESS_REDIRECT_URI ?? 'http://localhost:9010/callback';

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Rewrite the host/port in a Hydra redirect_to URL so it's reachable inside
 * Docker. Hydra uses URLS_SELF_ISSUER=http://localhost:4444 in those URLs, but
 * inside the Docker network we must use its service hostname.
 */
export function toInternalUrl(redirectTo: string): string {
  const target = new URL(redirectTo);
  const internal = new URL(HYDRA_PUBLIC_URL);
  target.protocol = internal.protocol;
  target.hostname = internal.hostname;
  target.port = internal.port;
  return target.toString();
}

/**
 * Fire one HTTP GET without following redirects, replaying any accumulated
 * Hydra session cookies. Returns the Location header and any new Set-Cookie
 * headers so they can be merged for the next hop.
 */
export function followRedirect(
  url: string,
  cookies: string[],
): Promise<{ location: string; newCookies: string[] }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: RequestOptions = {
      hostname: parsed.hostname,
      port: parseInt(parsed.port || '80', 10),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: cookies.length > 0
        ? { Cookie: cookies.map(c => c.split(';')[0]).join('; ') }
        : {},
    };
    const req = httpGet(options, (res) => {
      res.resume();
      const location = res.headers.location;
      const newCookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
      if (!location) {
        reject(new Error(`Expected redirect from ${url}, got HTTP ${res.statusCode}`));
        return;
      }
      resolve({ location, newCookies });
    });
    req.on('error', reject);
  });
}

export function extractParam(urlStr: string, param: string): string | null {
  try {
    return new URL(urlStr).searchParams.get(param);
  } catch {
    return new URLSearchParams(urlStr.split('?')[1] ?? '').get(param);
  }
}

// ── Flow phases ───────────────────────────────────────────────────────────────

/**
 * Phase 1: Initiate an OAuth2 authorization request against Hydra.
 *
 * Generates a PKCE pair, fires GET /oauth2/auth (no auto-redirect), captures
 * the login_challenge from the redirect Location and the Hydra session cookies
 * from the Set-Cookie headers.
 */
export async function initiateHydraFlow(
  clientId: string,
  scope: string,
): Promise<{ pkceVerifier: string; loginChallenge: string; hydraCookies: string[] }> {
  const pkceVerifier = generateVerifier();
  const pkceChallenge = generateChallenge(pkceVerifier);
  const state = randomBytes(8).toString('hex');

  const authUrl =
    `${HYDRA_PUBLIC_URL}/oauth2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(HEADLESS_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}` +
    `&code_challenge=${pkceChallenge}` +
    `&code_challenge_method=S256`;

  const { location, cookies: hydraCookies } = await new Promise<{
    location: string;
    cookies: string[];
  }>((resolve, reject) => {
    const req = httpGet(authUrl, (res) => {
      res.resume();
      const location = res.headers.location;
      const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
      if (!location) {
        reject(new Error(`Expected redirect from Hydra /oauth2/auth, got HTTP ${res.statusCode}`));
        return;
      }
      resolve({ location, cookies });
    });
    req.on('error', reject);
  });

  const loginChallenge = extractParam(location, 'login_challenge');
  if (!loginChallenge) {
    throw new Error(`No login_challenge in Hydra redirect: ${location}`);
  }

  return { pkceVerifier, loginChallenge, hydraCookies };
}

/**
 * Phase 2: Complete the OAuth2 flow given an already-initiated login challenge.
 *
 * Sequence:
 *   acceptLogin(profileId) → follow login_verifier → acceptConsent →
 *   follow consent_verifier → extract code → POST /oauth2/token → tokens
 */
export async function completeFlow(params: {
  loginChallenge: string;
  hydraCookies: string[];
  pkceVerifier: string;
  profileId: string;
  clientId: string;
}): Promise<TokenSet> {
  const { loginChallenge, hydraCookies, pkceVerifier, profileId, clientId } = params;

  // 1. Accept login
  const loginAccept = await acceptLogin(loginChallenge, profileId);

  // 2. Follow login_verifier → consent_challenge
  const loginVerifierResult = await followRedirect(
    toInternalUrl(loginAccept.redirect_to),
    hydraCookies,
  );
  console.log('[headlessOAuthLoop] login_verifier → Location:', loginVerifierResult.location);

  const consentChallenge = extractParam(loginVerifierResult.location, 'consent_challenge');
  if (!consentChallenge) {
    throw new Error(`No consent_challenge in login_verifier redirect: ${loginVerifierResult.location}`);
  }

  const allCookies = [...hydraCookies, ...loginVerifierResult.newCookies];

  // 3. Accept consent
  const consentReq = await getConsentRequest(consentChallenge);
  const { profile } = await profileClient.getById(profileId);
  const session = buildClaims(profile, consentReq.requested_scope);
  const consentAccept = await acceptConsent(consentChallenge, consentReq.requested_scope, session);

  // 4. Follow consent_verifier → authorization code
  const consentVerifierResult = await followRedirect(
    toInternalUrl(consentAccept.redirect_to),
    allCookies,
  );
  console.log('[headlessOAuthLoop] consent_verifier → Location:', consentVerifierResult.location);

  const code = extractParam(consentVerifierResult.location, 'code');
  if (!code) {
    throw new Error(`No code in consent_verifier redirect: ${consentVerifierResult.location}`);
  }

  // 5. Exchange code + PKCE verifier for tokens
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: HEADLESS_REDIRECT_URI,
    client_id: clientId,
    client_secret: HEADLESS_CLIENT_SECRET,
    code_verifier: pkceVerifier,
  });

  const res = await fetch(`${HYDRA_PUBLIC_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token endpoint HTTP ${res.status}: ${text}`);
  }

  const tokens = await res.json() as Record<string, unknown>;

  return {
    access_token: tokens.access_token as string,
    refresh_token: tokens.refresh_token as string | undefined,
    id_token: tokens.id_token as string | undefined,
    expires_in: tokens.expires_in as number,
    token_type: tokens.token_type as string,
  };
}
