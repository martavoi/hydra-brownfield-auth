/**
 * POST /api/auth/token-exchange
 *
 * Exchanges a legacy Bearer token for a set of Hydra OAuth2 tokens.
 *
 * Simulated legacy auth rule:
 *   Any token matching  custom_<userId>  is valid.
 *   The <userId> suffix becomes the OAuth `sub` (subject) claim.
 *
 * Examples of valid tokens:
 *   custom_alice          → sub = "alice"
 *   custom_legacy-user-42 → sub = "legacy-user-42"
 *   custom_+12125550001   → sub = "+12125550001"
 *
 * In a real migration this validation step calls your existing auth/verify
 * service instead of the prefix check.
 */

import type { APIRoute } from 'astro';
import { initiateHydraFlow, completeFlow } from '../../../lib/headlessOAuthLoop';

// ── Simulated legacy auth service ─────────────────────────────────────────────

function validateLegacyToken(token: string): { valid: boolean; subject: string } {
  const PREFIX = 'custom_';
  if (!token.startsWith(PREFIX)) return { valid: false, subject: '' };
  const subject = token.slice(PREFIX.length);
  if (!subject) return { valid: false, subject: '' };
  return { valid: true, subject };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  let body: { legacy_token?: string; client_id?: string; scope?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const legacyToken = (body.legacy_token ?? '').trim();
  const clientId = body.client_id ?? 'test-client';
  const scope = body.scope ?? 'openid offline profile';

  if (!legacyToken) {
    return json({ error: 'missing_fields', detail: 'legacy_token is required' }, 400);
  }

  // 1. Validate legacy token (replace this block with a real auth/verify call in production)
  const { valid, subject } = validateLegacyToken(legacyToken);
  if (!valid) {
    return json({ error: 'invalid_token', error_description: 'Token is not a valid legacy token' }, 401);
  }

  console.log(`[token-exchange] legacy token accepted — subject: ${subject}, client: ${clientId}`);

  // 2. Initiate OAuth2 authorization flow with Hydra
  let flow: Awaited<ReturnType<typeof initiateHydraFlow>>;
  try {
    flow = await initiateHydraFlow(clientId, scope);
  } catch (err) {
    console.error('[token-exchange] initiateHydraFlow error:', err);
    return json({ error: 'hydra_error', detail: 'Could not initiate OAuth2 flow' }, 502);
  }

  // 3. Complete the headless flow: acceptLogin(subject) → consent → code → tokens
  let tokens: Awaited<ReturnType<typeof completeFlow>>;
  try {
    tokens = await completeFlow({
      loginChallenge: flow.loginChallenge,
      hydraCookies: flow.hydraCookies,
      pkceVerifier: flow.pkceVerifier,
      profileId: subject,
      clientId,
    });
  } catch (err) {
    console.error('[token-exchange] completeFlow error:', err);
    return json({ error: 'hydra_error', detail: 'OAuth2 flow failed' }, 502);
  }

  console.log(`[token-exchange] issued OAuth tokens for subject: ${subject}`);

  return json({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    expires_in: tokens.expires_in,
    token_type: tokens.token_type,
    // Informational — remove in production
    issued_for_subject: subject,
  }, 200);
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
