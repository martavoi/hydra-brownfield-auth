import type { UserProfile } from './grpcClient';

const HYDRA_ADMIN_URL = process.env.HYDRA_ADMIN_URL ?? 'http://hydra:4445';

async function hydraFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${HYDRA_ADMIN_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Hydra ${options?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

export interface LoginRequest {
  skip: boolean;
  subject: string;
  client: { client_id: string };
  requested_scope: string[];
}

export interface ConsentRequest {
  skip: boolean;
  subject: string;
  requested_scope: string[];
  client: { client_id: string };
}

export interface RedirectResponse {
  redirect_to: string;
}

export function getLoginRequest(challenge: string): Promise<LoginRequest> {
  return hydraFetch(`/admin/oauth2/auth/requests/login?login_challenge=${challenge}`);
}

export function acceptLogin(challenge: string, subject: string): Promise<RedirectResponse> {
  return hydraFetch(`/admin/oauth2/auth/requests/login/accept?login_challenge=${challenge}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject,
      remember: false,
      remember_for: 0,
      context: {},
    }),
  });
}

export function getConsentRequest(challenge: string): Promise<ConsentRequest> {
  return hydraFetch(`/admin/oauth2/auth/requests/consent?consent_challenge=${challenge}`);
}

export function buildClaims(
  profile: UserProfile,
  grantedScopes: string[],
): { id_token: Record<string, unknown>; access_token: Record<string, unknown> } {
  const id_token: Record<string, unknown> = {};

  if (grantedScopes.includes('profile')) {
    const name = [profile.fname, profile.lname].filter(Boolean).join(' ');
    if (name)          id_token.name        = name;
    if (profile.fname) id_token.given_name  = profile.fname;
    if (profile.lname) id_token.family_name = profile.lname;
  }
  if (grantedScopes.includes('email') && profile.email)
    id_token.email = profile.email;
  if (grantedScopes.includes('phone') && profile.phone)
    id_token.phone_number = profile.phone;

  return { id_token, access_token: {} };
}

export function acceptConsent(
  challenge: string,
  grantScopes: string[],
  session = { id_token: {}, access_token: {} } as {
    id_token: Record<string, unknown>;
    access_token: Record<string, unknown>;
  },
): Promise<RedirectResponse> {
  return hydraFetch(`/admin/oauth2/auth/requests/consent/accept?consent_challenge=${challenge}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_scope: grantScopes,
      grant_access_token_audience: [],
      session,
      remember: false,
      remember_for: 0,
    }),
  });
}
