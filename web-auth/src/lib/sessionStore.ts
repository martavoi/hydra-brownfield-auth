export interface Session {
  pkceVerifier: string;
  loginChallenge: string;
  phone: string;
  clientId: string;
  hydraCookies: string[]; // raw Set-Cookie values from the initial /oauth2/auth redirect
}

interface Entry {
  session: Session;
  timer: ReturnType<typeof setTimeout>;
}

const store = new Map<string, Entry>();

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createSession(session: Session): string {
  const id = crypto.randomUUID();
  const timer = setTimeout(() => store.delete(id), SESSION_TTL_MS);
  store.set(id, { session, timer });
  return id;
}

export function getSession(id: string): Session | undefined {
  return store.get(id)?.session;
}

export function deleteSession(id: string): void {
  const entry = store.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    store.delete(id);
  }
}
