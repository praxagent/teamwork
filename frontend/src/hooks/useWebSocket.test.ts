/**
 * The socket's half of the internal-key session.
 *
 * A backend with INTERNAL_API_KEY set closes an unauthenticated WebSocket with
 * code 4401 before accepting it. The manager's reconnect loop deliberately
 * never gives up — right for a server that is restarting, wrong here, where
 * every retry would be refused the same way. So 4401 must lock the app and
 * park the loop, and a login must connect it again exactly once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketManager, WS_CLOSE_INTERNAL_KEY_REQUIRED } from './useWebSocket';
import { useInternalKeyStore } from './useInternalKey';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  /** The server accepted us. */
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  /** The server closed us with the given code. */
  serverClose(code: number) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
let logSpy: ReturnType<typeof vi.spyOn>;

/** A login that the (mocked) backend accepts. */
async function loginOk() {
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
  expect(await useInternalKeyStore.getState().login('k')).toBe(true);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  useInternalKeyStore.setState({ locked: false, error: null, submitting: false });
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  globalThis.fetch = originalFetch;
  logSpy.mockRestore();
  vi.useRealTimers();
});

describe('WebSocketManager and the internal-key session', () => {
  it('still reconnects after an ordinary drop (the loop is not disabled wholesale)', () => {
    const manager = new WebSocketManager();
    manager.connect();
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].serverClose(1006);

    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(useInternalKeyStore.getState().locked).toBe(false);
    manager.disconnect();
  });

  it('a 4401 close locks the app and parks the reconnect loop', () => {
    const manager = new WebSocketManager();
    manager.connect();
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances[0].serverClose(WS_CLOSE_INTERNAL_KEY_REQUIRED);

    // Old code: locked never flips, and the backoff opens a second socket.
    expect(useInternalKeyStore.getState().locked).toBe(true);
    vi.advanceTimersByTime(5 * 60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    manager.disconnect();
  });

  it('connects exactly once after a login, then stays quiet', async () => {
    const manager = new WebSocketManager();
    manager.connect();
    FakeSocket.instances[0].serverClose(WS_CLOSE_INTERNAL_KEY_REQUIRED);
    expect(useInternalKeyStore.getState().locked).toBe(true);

    await loginOk();

    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].open();
    vi.advanceTimersByTime(5 * 60_000);
    expect(FakeSocket.instances).toHaveLength(2);

    // A later lock/unlock that this socket did not cause is none of its
    // business: it is connected, and must not open a duplicate.
    useInternalKeyStore.getState().lock();
    await loginOk();
    expect(FakeSocket.instances).toHaveLength(2);
    manager.disconnect();
  });

  it('a drop while the app is already locked parks too, whatever its code', async () => {
    // The backend refuses the handshake before accept; ASGI servers turn that
    // into an HTTP 403 and the browser reports 1006, never 4401. The fetch
    // side has locked the app by then, and that is the signal that counts.
    const manager = new WebSocketManager();
    manager.connect();
    useInternalKeyStore.getState().lock();
    FakeSocket.instances[0].serverClose(1006);

    vi.advanceTimersByTime(5 * 60_000);
    expect(FakeSocket.instances).toHaveLength(1);

    await loginOk();
    expect(FakeSocket.instances).toHaveLength(2);
    manager.disconnect();
  });

  it('connect() while locked opens nothing and waits for the login', async () => {
    useInternalKeyStore.getState().lock();
    const manager = new WebSocketManager();
    manager.connect();
    manager.connect();
    expect(FakeSocket.instances).toHaveLength(0);

    await loginOk();
    expect(FakeSocket.instances).toHaveLength(1);
    manager.disconnect();
  });

  it('disconnect() withdraws the pending connect', async () => {
    const manager = new WebSocketManager();
    manager.connect();
    FakeSocket.instances[0].serverClose(WS_CLOSE_INTERNAL_KEY_REQUIRED);
    manager.disconnect();

    await loginOk();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
