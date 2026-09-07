/**
 * The internal-key session client: the global fetch wrapper and the store
 * behind it.
 *
 * Two properties matter and pull in opposite directions. A backend that
 * refuses a request with `401 {"error":"internal_key_required"}` must lock the
 * app, hold the refused call, and replay it after a login — the caller sees
 * only the eventual answer. And a backend with no key configured must see no
 * difference at all: the same Response object back, no extra requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installInternalKeyFetchInterceptor,
  useInternalKeyStore,
} from './useInternalKey';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const REFUSED = { error: 'internal_key_required' };

/** Lets queued microtasks (the wrapper's awaits) run without resolving timers. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Mock = ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;

let native: Mock;
let uninstall: () => void;
const originalFetch = globalThis.fetch;

/** The URLs the (mocked) server has seen, in order. */
const seen = () => native.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  useInternalKeyStore.setState({ locked: false, error: null, submitting: false });
  native = vi.fn();
  globalThis.fetch = native;
  uninstall = installInternalKeyFetchInterceptor();
});

afterEach(() => {
  uninstall();
  globalThis.fetch = originalFetch;
});

describe('a deployment with no key configured', () => {
  it('hands the very same Response back and makes no request of its own', async () => {
    const ok = json(200, { projects: [] });
    native.mockResolvedValueOnce(ok);

    const got = await fetch('/api/projects');

    expect(got).toBe(ok);
    expect(seen()).toEqual(['/api/projects']);
    expect(useInternalKeyStore.getState().locked).toBe(false);
    // The body is untouched for the caller.
    expect(await got.json()).toEqual({ projects: [] });
  });

  it('leaves a 401 that is not the session refusal alone', async () => {
    // A proxied Prax endpoint can 401 for its own reasons. Only the backend's
    // exact refusal may lock the app, or a stray 401 would hold the UI hostage.
    const other = json(401, { detail: 'bad bearer' });
    native.mockResolvedValueOnce(other);

    const got = await fetch('/api/prax/thing');

    expect(got).toBe(other);
    expect(useInternalKeyStore.getState().locked).toBe(false);
    expect(seen()).toEqual(['/api/prax/thing']);
  });

  it('leaves a 401 with no JSON body alone', async () => {
    const other = new Response('nope', { status: 401 });
    native.mockResolvedValueOnce(other);
    expect(await fetch('/api/x')).toBe(other);
    expect(useInternalKeyStore.getState().locked).toBe(false);
  });

  it('does not look at requests outside same-origin /api at all', async () => {
    const refused = json(401, REFUSED);
    native.mockResolvedValue(refused);

    expect(await fetch('https://example.com/api/other')).toBe(refused);
    expect(await fetch('/apiary')).toBe(refused);
    expect(await fetch('/ws-info')).toBe(refused);
    expect(useInternalKeyStore.getState().locked).toBe(false);
  });
});

describe('a backend that requires the key', () => {
  it('locks on the refusal, holds the call, and replays it after login', async () => {
    let projectCalls = 0;
    native.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session/login') return json(200, { ok: true });
      if (url === '/api/projects') {
        projectCalls += 1;
        return projectCalls === 1 ? json(401, REFUSED) : json(200, { projects: ['p1'] });
      }
      throw new Error(`unexpected ${url}`);
    });

    let settled = false;
    const pending = fetch('/api/projects').then((r) => {
      settled = true;
      return r;
    });

    // Old code: no store, and this promise resolves straight to the 401.
    await vi.waitFor(() => expect(useInternalKeyStore.getState().locked).toBe(true));
    await flush();
    expect(settled).toBe(false);
    expect(seen()).toEqual(['/api/projects']);

    expect(await useInternalKeyStore.getState().login('the-key')).toBe(true);

    const [, init] = native.mock.calls.find(([u]) => String(u) === '/api/session/login')!;
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ key: 'the-key' });

    const got = await pending;
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ projects: ['p1'] });
    expect(seen()).toEqual(['/api/projects', '/api/session/login', '/api/projects']);
    expect(useInternalKeyStore.getState().locked).toBe(false);
    expect(useInternalKeyStore.getState().error).toBeNull();
  });

  it('a rejected key keeps the app locked, shows why, and replays nothing', async () => {
    native.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session/login') return json(401, { error: 'invalid_key' });
      return json(401, REFUSED);
    });

    let settled = false;
    void fetch('/api/tasks').then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(useInternalKeyStore.getState().locked).toBe(true));

    expect(await useInternalKeyStore.getState().login('wrong')).toBe(false);
    await flush();

    const state = useInternalKeyStore.getState();
    expect(state.locked).toBe(true);
    expect(state.error).toMatch(/not accepted/);
    expect(state.submitting).toBe(false);
    expect(settled).toBe(false);
    expect(seen()).toEqual(['/api/tasks', '/api/session/login']);
  });

  it('shows the backoff the backend asks for on a 429', async () => {
    native.mockResolvedValueOnce(json(429, { error: 'too_many_attempts', retry_after: 3.2 }));
    useInternalKeyStore.getState().lock();

    expect(await useInternalKeyStore.getState().login('k')).toBe(false);

    const state = useInternalKeyStore.getState();
    expect(state.locked).toBe(true);
    expect(state.error).toBe('Too many attempts. Try again in 4s.');
  });

  it('a call started while locked waits for the login before touching the server', async () => {
    native.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session/login') return json(200, { ok: true });
      return json(200, { fine: true });
    });
    useInternalKeyStore.getState().lock();

    const pending = fetch('/api/channels');
    await flush();
    // Nothing sent: the answer is known to be a 401 until someone logs in.
    expect(seen()).toEqual([]);

    // The login itself is exempt from the gate, or it could never open it.
    await useInternalKeyStore.getState().login('k');

    expect((await pending).status).toBe(200);
    expect(seen()).toEqual(['/api/session/login', '/api/channels']);
  });

  it('is released for every parked caller, not just the first', async () => {
    native.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session/login') return json(200, { ok: true });
      return json(200, { url });
    });
    useInternalKeyStore.getState().lock();

    const a = fetch('/api/a');
    const b = fetch('/api/b');
    await flush();
    expect(seen()).toEqual([]);

    await useInternalKeyStore.getState().login('k');
    expect(await (await a).json()).toEqual({ url: '/api/a' });
    expect(await (await b).json()).toEqual({ url: '/api/b' });
  });

  it('re-locks if the replay is refused too, but returns rather than hanging', async () => {
    // Login said yes, the next request said no: the cookie did not stick. The
    // gate must come back — and the caller must get an answer it can show.
    native.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/session/login') return json(200, { ok: true });
      return json(401, REFUSED);
    });

    const pending = fetch('/api/projects');
    await vi.waitFor(() => expect(useInternalKeyStore.getState().locked).toBe(true));
    await useInternalKeyStore.getState().login('k');

    const got = await pending;
    expect(got.status).toBe(401);
    expect(seen()).toEqual(['/api/projects', '/api/session/login', '/api/projects']);
    expect(useInternalKeyStore.getState().locked).toBe(true);
  });

  it('replays a Request object whose body was already read once', async () => {
    let calls = 0;
    native.mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/session/login')) return json(200, { ok: true });
      calls += 1;
      if (calls === 1) {
        // The server reads the body, which consumes it on this Request.
        if (input instanceof Request) await input.text();
        return json(401, REFUSED);
      }
      const body = input instanceof Request ? await input.text() : '';
      return json(200, { body });
    });

    // Node's Request wants an absolute URL; a browser would resolve the relative one.
    const req = new Request(`${window.location.origin}/api/tasks`, { method: 'POST', body: '{"title":"x"}' });
    const pending = fetch(req);
    await vi.waitFor(() => expect(useInternalKeyStore.getState().locked).toBe(true));
    await useInternalKeyStore.getState().login('k');

    expect(await (await pending).json()).toEqual({ body: '{"title":"x"}' });
  });
});

describe('install', () => {
  it('is idempotent: a second install does not wrap the wrapper', () => {
    const wrapped = globalThis.fetch;
    const undo = installInternalKeyFetchInterceptor();
    expect(globalThis.fetch).toBe(wrapped);
    undo();
    expect(globalThis.fetch).toBe(wrapped);
  });
});

describe('logout', () => {
  const realLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    // jsdom's reload prints "not implemented"; the interceptor still needs
    // href/origin from location to classify the logout URL.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: realLocation.href, origin: realLocation.origin, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('posts to /api/session/logout and reloads, even while locked', async () => {
    native.mockResolvedValueOnce(json(200, { ok: true }));
    // Locked must not park the logout: /api/session/* bypasses the gate.
    useInternalKeyStore.getState().lock();

    await useInternalKeyStore.getState().logout();

    expect(seen()).toEqual(['/api/session/logout']);
    expect(native.mock.calls[0][1]?.method).toBe('POST');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed logout instead of reloading into the same session', async () => {
    native.mockResolvedValueOnce(json(500, { detail: 'boom' }));
    await expect(useInternalKeyStore.getState().logout()).rejects.toThrow(/500/);
    expect(reload).not.toHaveBeenCalled();
  });
});
