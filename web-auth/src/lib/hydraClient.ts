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

export function acceptConsent(challenge: string, grantScopes: string[]): Promise<RedirectResponse> {
  return hydraFetch(`/admin/oauth2/auth/requests/consent/accept?consent_challenge=${challenge}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_scope: grantScopes,
      grant_access_token_audience: [],
      session: { id_token: {}, access_token: {} },
      remember: false,
      remember_for: 0,
    }),
  });
}
