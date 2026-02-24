import type { APIRoute } from 'astro';
import { createHash, randomBytes } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { profileClient } from '../../../lib/grpcClient';
import { createSession } from '../../../lib/sessionStore';

const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL ?? 'http://hydra:4444';
const HEADLESS_REDIRECT_URI = process.env.HEADLESS_REDIRECT_URI ?? 'http://localhost:9010/callback';

function generateVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// Uses Node http.get (no auto-redirect) to capture the 302 Location header and
// any Set-Cookie headers Hydra sets on the initial auth request.
function getHydraAuthRedirect(url: string): Promise<{ location: string; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      res.resume(); // discard body
      const location = res.headers.location;
      const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
      if (!location) {
        reject(new Error(`Expected redirect, got HTTP ${res.statusCode} with no Location`));
        return;
      }
      resolve({ location, cookies });
    });
    req.on('error', reject);
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: { phone?: string; client_id?: string; scope?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const phone = body.phone?.trim() ?? '';
  const clientId = body.client_id ?? 'test-client';
  const scope = body.scope ?? 'openid offline profile';

  if (!phone) {
    return new Response(JSON.stringify({ error: 'missing_phone' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = randomBytes(8).toString('hex');

  const authUrl =
    `${HYDRA_PUBLIC_URL}/oauth2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(HEADLESS_REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}` +
    `&code_challenge=${challenge}` +
    `&code_challenge_method=S256`;

  let authRedirect: { location: string; cookies: string[] };
  try {
    authRedirect = await getHydraAuthRedirect(authUrl);
  } catch (err) {
    console.error('Hydra auth redirect error:', err);
    return new Response(JSON.stringify({ error: 'hydra_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let loginChallenge: string | null;
  try {
    loginChallenge = new URL(authRedirect.location).searchParams.get('login_challenge');
  } catch {
    loginChallenge = new URLSearchParams(authRedirect.location.split('?')[1] ?? '').get('login_challenge');
  }

  if (!loginChallenge) {
    console.error('No login_challenge in Hydra redirect URL:', authRedirect.location);
    return new Response(JSON.stringify({ error: 'hydra_error', detail: 'no login_challenge' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await profileClient.requestOtp(phone);
  } catch (err) {
    console.error('RequestOtp error:', err);
    return new Response(JSON.stringify({ error: 'otp_send_failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = createSession({
    pkceVerifier: verifier,
    loginChallenge,
    phone,
    clientId,
    hydraCookies: authRedirect.cookies,
  });

  return new Response(JSON.stringify({ session_id: sessionId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
