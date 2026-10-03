/**
 * Keeps the remote desktop's clipboard in step with this computer's, so
 * Ctrl+V inside the desktop pastes what you copied here.
 *
 * The desktop page (desktop_vnc.html) runs inside an iframe, so keys pressed
 * in it never reach TeamWork's own paste handler, and noVNC sends Ctrl+V to
 * the desktop as a plain keystroke: the desktop pasted whatever its OWN
 * clipboard held. Now the local clipboard is pushed to the desktop whenever
 * it may be about to be used — the desktop gets focus, the window comes back
 * to the front, Ctrl (or Cmd) goes down — and a paste key pressed while that
 * push is still in flight is held until the desktop has the text.
 *
 * Talks to the sandbox's clipboard bridge over /api/desktop/clipboard:
 *   → {type: "set", text}         put text on the desktop clipboard
 *   ← {type: "set-ok"}            done (older bridges never answer: timeout)
 *   ← {type: "clipboard", text}   the desktop's clipboard changed
 *
 * Only where reading the clipboard needs no per-read prompt (Chromium, once
 * the site is allowed). Firefox and Safari show a "Paste" popup on every
 * read, so there the toolbar's push button stays the way to send it.
 */

/** X keysyms for the keys a paste is made of. */
const XK_v = 0x0076;
const XK_V = 0x0056;
const XK_Insert = 0xff63;

/**
 * The key to send to the desktop for a paste chord, or null.
 * Ctrl+V / Ctrl+Shift+V (GUI apps, xterm), Cmd+V on a Mac, Shift+Insert.
 */
export function pasteKey(e) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyV') {
    return e.shiftKey ? { keysym: XK_V, code: 'KeyV' } : { keysym: XK_v, code: 'KeyV' };
  }
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Insert') {
    return { keysym: XK_Insert, code: 'Insert' };
  }
  return null;
}

const XK_Control_L = 0xffe3;
const XK_Shift_L = 0xffe1;

/**
 * The key events that replay a held paste chord, as [keysym, code, down].
 *
 * The chord's modifiers went to the desktop through noVNC when they were
 * pressed. If they are still held (*held*: the event codes currently down),
 * only the paste key is needed. If one was let go while the paste waited for
 * the clipboard, the desktop has already seen it released, so press it again
 * around the paste key, or a fast Ctrl+V arrives as a plain "v".
 */
export function pasteKeystrokes(chord, held) {
  const key = pasteKey(chord);
  if (!key) return [];
  const press = [];
  // A Mac's Cmd+V means paste: send Ctrl+V, what the desktop understands.
  const wantCtrl = (chord.ctrlKey || chord.metaKey) && key.code === 'KeyV';
  if (wantCtrl && !held.has('ControlLeft') && !held.has('ControlRight')) {
    press.push([XK_Control_L, 'ControlLeft']);
  }
  if (chord.shiftKey && !held.has('ShiftLeft') && !held.has('ShiftRight')) {
    press.push([XK_Shift_L, 'ShiftLeft']);
  }
  return [
    ...press.map(([k, c]) => [k, c, true]),
    [key.keysym, key.code, true],
    [key.keysym, key.code, false],
    ...press.reverse().map(([k, c]) => [k, c, false]),
  ];
}

/** True when the clipboard can be read without a prompt on every read. */
export async function canReadSilently(nav = globalThis.navigator) {
  if (!nav?.clipboard?.readText || !nav.permissions?.query) return false;
  try {
    const status = await nav.permissions.query({ name: 'clipboard-read' });
    return status.state === 'granted' || status.state === 'prompt';
  } catch {
    return false;   // Firefox and Safari don't know this permission
  }
}

async function permissionDenied(nav = globalThis.navigator) {
  try {
    return (await nav.permissions.query({ name: 'clipboard-read' })).state === 'denied';
  } catch {
    return false;
  }
}

export class ClipboardSync {
  /**
   * @param {object} o
   * @param {() => Promise<string>} o.readText  reads this computer's clipboard
   * @param {(msg: object) => boolean} o.send   sends to the bridge; false if not connected
   * @param {number} [o.ackTimeoutMs]           how long to wait for "set-ok"
   * @param {() => void} [o.onBlocked]          the user denied clipboard access
   * @param {() => Promise<boolean>} [o.isDenied]  is clipboard-read denied?
   */
  constructor({ readText, send, ackTimeoutMs = 400, onBlocked = () => {}, isDenied = permissionDenied }) {
    this.readText = readText;
    this.send = send;
    this.ackTimeoutMs = ackTimeoutMs;
    this.onBlocked = onBlocked;
    this.isDenied = isDenied;
    this.lastText = null;
    this.blocked = false;
    this.pending = null;
    this._ack = null;
  }

  /** Push the local clipboard to the desktop if it changed. One at a time. */
  sync() {
    if (this.blocked) return Promise.resolve();
    if (!this.pending) {
      this.pending = this._sync().finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  async _sync() {
    let text;
    try {
      text = await this.readText();
    } catch (err) {
      // Chrome raises NotAllowedError both when the user denied access and
      // when the document just isn't focused (a background tab). Only the
      // first is final; the second clears up on the next focus.
      if (err && err.name === 'NotAllowedError' && await this.isDenied()) {
        this.blocked = true;
        this.onBlocked();
      }
      return;
    }
    if (!text || text === this.lastText) return;
    const acked = new Promise((resolve) => {
      const timer = setTimeout(resolve, this.ackTimeoutMs);
      this._ack = () => { clearTimeout(timer); resolve(); };
    });
    if (!this.send({ type: 'set', text })) {
      this._ack = null;
      return;
    }
    this.lastText = text;
    await acked;
    this._ack = null;
  }

  /** Feed every message from the bridge here. */
  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'set-ok') {
      if (this._ack) this._ack();
    } else if (msg.type === 'clipboard' && typeof msg.text === 'string') {
      // The desktop's clipboard changed (TeamWork copies it to this
      // computer's). Remember it so it isn't pushed straight back.
      this.lastText = msg.text;
    }
  }
}
