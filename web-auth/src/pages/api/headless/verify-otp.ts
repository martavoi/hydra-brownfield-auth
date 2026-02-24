import type { APIRoute } from 'astro';
import { get as httpGet, type RequestOptions } from 'node:http';
import { profileClient } from '../../../lib/grpcClient';
import { acceptLogin, acceptConsent, getConsentRequest } from '../../../lib/hydraClient';
import { getSession, deleteSession } from '../../../lib/sessionStore';

// URLS_SELF_ISSUER in docker-compose is http://localhost:4444, but from inside
// the Docker network we must reach Hydra via its service hostname.
const HYDRA_PUBLIC_URL = process.env.HYDRA_PUBLIC_URL ?? 'http://hydra:4444';
const HEADLESS_CLIENT_SECRET = process.env.HEADLESS_CLIENT_SECRET ?? 'test-secret';
const HEADLESS_REDIRECT_URI = process.env.HEADLESS_REDIRECT_URI ?? 'http://localhost:9010/callback';

// Rewrite host/port of Hydra redirect_to URLs so they're reachable inside Docker
// (Hydra uses URLS_SELF_ISSUER=http://localhost:4444 in those URLs).
function toInternalUrl(redirectTo: string): string {
  const target = new URL(redirectTo);
  const internal = new URL(HYDRA_PUBLIC_URL);
  target.protocol = internal.protocol;
  target.hostname = internal.hostname;
  target.port = internal.port;
  return target.toString();
}

// Make one HTTP GET (no auto-redirect), sending any accumulated Hydra session cookies.
// Returns the Location header and any new Set-Cookie headers from the response.
function followRedirect(
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

function extractParam(urlStr: string, param: string): string | null {
  try {
    return new URL(urlStr).searchParams.get(param);
  } catch {
    return new URLSearchParams(urlStr.split('?')[1] ?? '').get(param);
  }
}

export const POST: APIRoute = async ({ request }) => {
  let body: { session_id?: string; otp?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sessionId = body.session_id ?? '';
  const otp = body.otp?.trim() ?? '';

  if (!sessionId || !otp) {
    return new Response(JSON.stringify({ error: 'missing_fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'session_not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Verify OTP via profile-srv
  let verifyResult: { valid: boolean; profile_id: string };
  try {
    verifyResult = await profileClient.verifyOtp(session.phone, otp);
  } catch (err) {
    console.error('VerifyOtp gRPC error:', err);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!verifyResult.valid) {
    return new Response(JSON.stringify({ error: 'invalid_otp' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Accept login → redirect_to = http://localhost:4444/oauth2/auth?login_verifier=xxx
  let loginAccept: { redirect_to: string };
  try {
    loginAccept = await acceptLogin(session.loginChallenge, verifyResult.profile_id);
  } catch (err) {
    console.error('acceptLogin error:', err);
    return new Response(JSON.stringify({ error: 'hydra_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Follow login_verifier through Hydra (with session cookies) → consent URL
  let loginVerifierResult: { location: string; newCookies: string[] };
  try {
    loginVerifierResult = await followRedirect(
      toInternalUrl(loginAccept.redirect_to),
      session.hydraCookies,
    );
  } catch (err) {
    console.error('login_verifier redirect error:', err);
    return new Response(
      JSON.stringify({ error: 'hydra_error', detail: 'login_verifier follow failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log('[headless] login_verifier → Location:', loginVerifierResult.location);

  const consentChallenge = extractParam(loginVerifierResult.location, 'consent_challenge');
  if (!consentChallenge) {
    console.error('No consent_challenge in redirect URL:', loginVerifierResult.location);
    return new Response(
      JSON.stringify({
        error: 'hydra_error',
        detail: 'no consent_challenge',
        redirect_url: loginVerifierResult.location,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Merge original cookies with any new ones from the login_verifier hop
  const allCookies = [...session.hydraCookies, ...loginVerifierResult.newCookies];

  // 4. Accept consent → redirect_to = http://localhost:4444/oauth2/auth?consent_verifier=zzz
  let consentAccept: { redirect_to: string };
  try {
    const consentReq = await getConsentRequest(consentChallenge);
    consentAccept = await acceptConsent(consentChallenge, consentReq.requested_scope);
  } catch (err) {
    console.error('acceptConsent error:', err);
    return new Response(JSON.stringify({ error: 'hydra_error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 5. Follow consent_verifier through Hydra → callback URL with code
  let consentVerifierResult: { location: string; newCookies: string[] };
  try {
    consentVerifierResult = await followRedirect(
      toInternalUrl(consentAccept.redirect_to),
      allCookies,
    );
  } catch (err) {
    console.error('consent_verifier redirect error:', err);
    return new Response(
      JSON.stringify({ error: 'hydra_error', detail: 'consent_verifier follow failed' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log('[headless] consent_verifier → Location:', consentVerifierResult.location);

  const code = extractParam(consentVerifierResult.location, 'code');
  if (!code) {
    console.error('No code in callback URL:', consentVerifierResult.location);
    return new Response(
      JSON.stringify({
        error: 'hydra_error',
        detail: 'no code',
        redirect_url: consentVerifierResult.location,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 6. Exchange code + PKCE verifier for tokens
  let tokens: Record<string, unknown>;
  try {
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: HEADLESS_REDIRECT_URI,
      client_id: session.clientId,
      client_secret: HEADLESS_CLIENT_SECRET,
      code_verifier: session.pkceVerifier,
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

    tokens = await res.json();
  } catch (err) {
    console.error('Token exchange error:', err);
    return new Response(JSON.stringify({ error: 'token_exchange_failed' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  deleteSession(sessionId);

  return new Response(
    JSON.stringify({
      access_token: tokens.access_token,
      id_token: tokens.id_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
};
