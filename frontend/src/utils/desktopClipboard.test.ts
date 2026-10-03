/**
 * The desktop page's clipboard sync (src/teamwork/desktop_clipboard.js,
 * served as /api/desktop/teamwork-clipboard.js): Ctrl+V inside the desktop
 * must paste what was copied on this computer.
 */
// @ts-expect-error — plain JS module served as-is by the backend, no types
import { ClipboardSync, canReadSilently, pasteKey, pasteKeystrokes } from '../../../src/teamwork/desktop_clipboard.js';

type Msg = { type: string; text?: string };

function setup(read: () => Promise<string>, { connected = true, ackTimeoutMs = 50, denied = true } = {}) {
  const sent: Msg[] = [];
  const blocked = vi.fn();
  const sync = new ClipboardSync({
    readText: read,
    send: (m: Msg) => {
      if (!connected) return false;
      sent.push(m);
      return true;
    },
    ackTimeoutMs,
    onBlocked: blocked,
    isDenied: async () => denied,
  });
  return { sync, sent, blocked };
}

describe('pasteKey', () => {
  const key = (init: KeyboardEventInit) => pasteKey(new KeyboardEvent('keydown', init));

  it('knows the paste chords and what to send for each', () => {
    expect(key({ ctrlKey: true, code: 'KeyV', key: 'v' })).toEqual({ keysym: 0x76, code: 'KeyV' });
    expect(key({ ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' })).toEqual({ keysym: 0x56, code: 'KeyV' });
    expect(key({ metaKey: true, code: 'KeyV', key: 'v' })).toEqual({ keysym: 0x76, code: 'KeyV' });
    expect(key({ shiftKey: true, code: 'Insert', key: 'Insert' })).toEqual({ keysym: 0xff63, code: 'Insert' });
  });

  it('leaves everything else alone', () => {
    expect(key({ code: 'KeyV', key: 'v' })).toBeNull();
    expect(key({ ctrlKey: true, code: 'KeyC', key: 'c' })).toBeNull();
    expect(key({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' })).toBeNull();
    expect(key({ ctrlKey: true, shiftKey: true, code: 'Insert', key: 'Insert' })).toBeNull();
  });
});

describe('pasteKeystrokes', () => {
  const chord = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);
  const CTRL = 0xffe3;
  const SHIFT = 0xffe1;

  it('sends only the paste key while the modifiers are still held', () => {
    expect(pasteKeystrokes(chord({ ctrlKey: true, code: 'KeyV' }), new Set(['ControlLeft'])))
      .toEqual([[0x76, 'KeyV', true], [0x76, 'KeyV', false]]);
  });

  it('presses Ctrl again if it was let go while the paste waited', () => {
    // Without this, a quick Ctrl+V reached the desktop as a plain "v".
    expect(pasteKeystrokes(chord({ ctrlKey: true, code: 'KeyV' }), new Set()))
      .toEqual([[CTRL, 'ControlLeft', true], [0x76, 'KeyV', true], [0x76, 'KeyV', false],
                [CTRL, 'ControlLeft', false]]);
  });

  it('restores Ctrl+Shift+V in the right order', () => {
    expect(pasteKeystrokes(chord({ ctrlKey: true, shiftKey: true, code: 'KeyV' }), new Set()))
      .toEqual([[CTRL, 'ControlLeft', true], [SHIFT, 'ShiftLeft', true],
                [0x56, 'KeyV', true], [0x56, 'KeyV', false],
                [SHIFT, 'ShiftLeft', false], [CTRL, 'ControlLeft', false]]);
  });

  it('turns a Mac Cmd+V into Ctrl+V and leaves Shift+Insert alone', () => {
    expect(pasteKeystrokes(chord({ metaKey: true, code: 'KeyV' }), new Set(['MetaLeft']))[0])
      .toEqual([CTRL, 'ControlLeft', true]);
    expect(pasteKeystrokes(chord({ shiftKey: true, code: 'Insert' }), new Set(['ShiftLeft'])))
      .toEqual([[0xff63, 'Insert', true], [0xff63, 'Insert', false]]);
  });

  it('is empty for anything that is not a paste', () => {
    expect(pasteKeystrokes(chord({ ctrlKey: true, code: 'KeyC' }), new Set())).toEqual([]);
  });
});

describe('ClipboardSync', () => {
  it('pushes new local text and waits for the desktop to confirm', async () => {
    const { sync, sent } = setup(async () => 'hello');
    let done = false;
    const p = sync.sync().then(() => { done = true; });
    await vi.waitFor(() => expect(sent).toEqual([{ type: 'set', text: 'hello' }]));
    expect(done).toBe(false);                      // held until the ack
    sync.handleMessage({ type: 'set-ok' });
    await p;
    expect(done).toBe(true);
  });

  it('gives up waiting for an ack from an older bridge', async () => {
    const { sync, sent } = setup(async () => 'hello', { ackTimeoutMs: 20 });
    await sync.sync();
    expect(sent).toHaveLength(1);
  });

  it('does not send the same text twice', async () => {
    const { sync, sent } = setup(async () => 'same', { ackTimeoutMs: 1 });
    await sync.sync();
    await sync.sync();
    expect(sent).toHaveLength(1);
  });

  it('does not echo the desktop its own clipboard back', async () => {
    const { sync, sent } = setup(async () => 'from the desktop');
    sync.handleMessage({ type: 'clipboard', text: 'from the desktop' });
    await sync.sync();
    expect(sent).toEqual([]);
  });

  it('runs one sync at a time, and exposes it while it runs', async () => {
    let reads = 0;
    const { sync } = setup(async () => { reads += 1; return 'x'; }, { ackTimeoutMs: 1 });
    const a = sync.sync();
    const b = sync.sync();
    expect(a).toBe(b);
    expect(sync.pending).toBe(a);
    await a;
    expect(reads).toBe(1);
    expect(sync.pending).toBeNull();
  });

  it('stops trying, and says so, when the browser refuses clipboard access', async () => {
    const read = vi.fn(async () => { throw new DOMException('no', 'NotAllowedError'); });
    const { sync, blocked } = setup(read);
    await sync.sync();
    await sync.sync();
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after a refusal that was only "not focused"', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('Document is not focused.', 'NotAllowedError');
      return 'now focused';
    };
    const { sync, sent, blocked } = setup(read, { denied: false });
    await sync.sync();
    await sync.sync();
    expect(blocked).not.toHaveBeenCalled();
    expect(sent).toEqual([{ type: 'set', text: 'now focused' }]);
  });

  it('remembers nothing it could not send, so it retries once connected', async () => {
    const { sync, sent } = setup(async () => 'later', { connected: false });
    await sync.sync();
    expect(sent).toEqual([]);
    expect(sync.lastText).toBeNull();
  });

  it('ignores an empty clipboard', async () => {
    const { sync, sent } = setup(async () => '');
    await sync.sync();
    expect(sent).toEqual([]);
  });
});

describe('canReadSilently', () => {
  const nav = (query: unknown) => ({ clipboard: { readText: async () => '' }, permissions: { query } });

  it('is true where clipboard-read is a permission (Chromium)', async () => {
    expect(await canReadSilently(nav(async () => ({ state: 'prompt' })))).toBe(true);
    expect(await canReadSilently(nav(async () => ({ state: 'granted' })))).toBe(true);
  });

  it('is false when denied, or where every read would prompt (Firefox, Safari)', async () => {
    expect(await canReadSilently(nav(async () => ({ state: 'denied' })))).toBe(false);
    expect(await canReadSilently(nav(async () => { throw new TypeError('unknown permission'); }))).toBe(false);
    expect(await canReadSilently({})).toBe(false);
  });
});
