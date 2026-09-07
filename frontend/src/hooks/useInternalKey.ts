/**
 * Client side of TeamWork's INTERNAL_API_KEY session.
 *
 * When the backend is started with INTERNAL_API_KEY set, every /api request
 * that carries no session is refused with `401 {"error":"internal_key_required"}`
 * and every WebSocket is closed with code 4401 before it is accepted.
 * `POST /api/session/login {"key": ...}` sets an HttpOnly cookie the browser
 * then sends by itself on fetch and WebSocket alike; `POST /api/session/logout`
 * clears it.
 *
 * Nothing here does anything until the backend actually refuses a request.
 * With no key configured the interceptor hands every response back untouched
 * and never issues a request of its own, so a keyless deployment behaves
 * exactly as it did before this file existed.
 *
 * Requests in this app are scattered — the `fetchJson` helper in useApi.ts plus
 * some twenty-five bare `fetch('/api/...')` calls in panels — so the 401 is
 * caught in one place, a wrapper around the global `fetch`, rather than at
 * every call site. A call that is refused parks until the gate reports a
 * login, then goes again; its caller sees only the eventual response.
 */
import { create } from 'zustand';

/** The `error` value the backend sends with its 401 when a session is required. */
export const INTERNAL_KEY_REQUIRED = 'internal_key_required';

interface InternalKeyState {
  /**
   * The backend refused a request for want of a session and no login has
   * succeeded since. This is what shows the gate and parks new requests.
   */
  locked: boolean;
  /** Why the last login attempt failed, for the gate to show. */
  error: string | null;
  /** A login request is in flight. */
  submitting: boolean;
  lock: () => void;
  /** Exchanges the key for a session cookie. Resolves true on success. */
  login: (key: string) => Promise<boolean>;
  /** Clears the session cookie, then reloads so the backend decides what is next. */
  logout: () => Promise<void>;
}

// Requests parked while locked. All of them are released the moment the store
// goes locked -> unlocked (a successful login) — that release is what turns
// "locked" into "retry".
let waiters: Array<() => void> = [];

/** Resolves once the app is unlocked; immediately if it already is. */
export function waitForUnlock(): Promise<void> {
  if (!useInternalKeyStore.getState().locked) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

export const useInternalKeyStore = create<InternalKeyState>((set, get) => ({
  locked: false,
  error: null,
  submitting: false,

  lock: () => {
    if (!get().locked) set({ locked: true });
  },

  login: async (key) => {
    set({ submitting: true, error: null });
    try {
      // /api/session/* is exempt from the interceptor below, so this request
      // is never parked behind the very gate it is meant to open.
      const resp = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (resp.status === 401) {
        set({ submitting: false, error: 'That key was not accepted.' });
        return false;
      }
      if (resp.status === 429) {
        // The backend backs off per client after failed attempts and says how
        // long; without that number the user would only see a bare HTTP code.
        const body = await resp.json().catch(() => ({}));
        const wait = typeof body?.retry_after === 'number' ? ` Try again in ${Math.ceil(body.retry_after)}s.` : '';
        set({ submitting: false, error: `Too many attempts.${wait}` });
        return false;
      }
      if (!resp.ok) {
        set({ submitting: false, error: `Login failed (HTTP ${resp.status}).` });
        return false;
      }
      set({ submitting: false, locked: false, error: null });
      return true;
    } catch (e) {
      set({ submitting: false, error: `Could not reach the server: ${(e as Error).message}` });
      return false;
    }
  },

  logout: async () => {
    const resp = await fetch('/api/session/logout', { method: 'POST' });
    if (!resp.ok) throw new Error(`Logout failed (HTTP ${resp.status})`);
    // Reload rather than flip `locked` here. The client cannot tell a
    // deployment that requires a key from one that does not without a probe
    // request, and the first thing the reloaded page does tells it: with a key
    // configured the next request 401s and the gate appears; without one the
    // page simply comes back.
    window.location.reload();
  },
}));

useInternalKeyStore.subscribe((state, prev) => {
  if (prev.locked && !state.locked) {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
  }
});

/** Read-side hook for components: the gate, the Settings logout item. */
export function useInternalKey() {
  const locked = useInternalKeyStore((s) => s.locked);
  const error = useInternalKeyStore((s) => s.error);
  const submitting = useInternalKeyStore((s) => s.submitting);
  const login = useInternalKeyStore((s) => s.login);
  const logout = useInternalKeyStore((s) => s.logout);
  return { locked, error, submitting, login, logout };
}

// ---------------------------------------------------------------------------
// Global fetch interceptor
// ---------------------------------------------------------------------------

/**
 * The path of a same-origin /api request, or null for anything else. Only
 * same-origin /api calls can carry (or lack) the session cookie, so only those
 * are looked at; everything else — Prax proxies via /api are still /api, but a
 * direct call to a third-party host is not — goes straight through.
 */
function apiPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let url: URL;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return null;
  return url.pathname;
}

/** Login and logout must never be parked behind the gate they operate. */
function isSessionPath(pathname: string): boolean {
  return pathname.startsWith('/api/session/');
}

/**
 * Whether a response is the backend's "no session" refusal. Only a 401 has its
 * body inspected, and on a clone, so the caller still reads the original
 * exactly as it would have without the interceptor.
 */
async function refusedForWantOfSession(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = await response.clone().json();
    return !!body && body.error === INTERNAL_KEY_REQUIRED;
  } catch {
    return false;
  }
}

const INSTALLED = Symbol.for('teamwork.internalKeyFetchInterceptor');

/**
 * Wraps the global `fetch` so a same-origin /api call that the backend refuses
 * with `internal_key_required` locks the app, waits for a login, and is then
 * retried once. Idempotent. Returns a function that restores the native fetch.
 */
export function installInternalKeyFetchInterceptor(): () => void {
  const current = globalThis.fetch as typeof fetch & { [INSTALLED]?: true };
  if (current[INSTALLED]) return () => {};
  const native = current.bind(globalThis);

  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = apiPath(input);
    if (path === null || isSessionPath(path)) return native(input, init);

    const store = useInternalKeyStore.getState;
    // Already locked: do not spend a round-trip on a request that is going to
    // be refused; send it once the gate reports a login.
    if (store().locked) await waitForUnlock();

    // A Request's body can be read only once, so keep a clone for the retry.
    const retryInput = input instanceof Request ? input.clone() : input;
    const response = await native(input, init);
    if (!(await refusedForWantOfSession(response))) return response;

    store().lock();
    await waitForUnlock();
    const retried = await native(retryInput, init);
    if (await refusedForWantOfSession(retried)) {
      // Login said yes, the next request said no — the cookie did not stick
      // (a Secure cookie over plain http, say). Show the gate again, but hand
      // the caller this response rather than park it a second time: an error
      // it can see beats a promise that never settles.
      store().lock();
    }
    return retried;
  }) as typeof fetch & { [INSTALLED]?: true };
  wrapped[INSTALLED] = true;

  globalThis.fetch = wrapped;
  return () => {
    globalThis.fetch = current;
  };
}
