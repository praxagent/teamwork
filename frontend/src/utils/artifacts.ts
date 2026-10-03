/**
 * Artifacts: pages the agent makes and keeps updating.
 *
 * TeamWork only displays them, and never on its own origin: the origin holds
 * the session and can call /api/*, and an artifact may have been written while
 * the agent was reading untrusted content. So a page is rendered as `srcdoc`
 * in an iframe with `sandbox="allow-scripts"` and NO `allow-same-origin`:
 * scripts run, in an opaque origin, with a Content-Security-Policy that
 * allows no network. Idea credit: Telepath's Television.
 */

/** No network, no forms, no navigation of the parent; inline code only. */
export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Posts the page's height to the parent so the frame can size itself; the
 * parent only accepts it from that frame's own window (see ArtifactFrame).
 */
const RESIZE_SCRIPT =
  '<script>(function(){function h(){parent.postMessage({tvArtifactHeight:' +
  'Math.ceil(document.documentElement.scrollHeight)},"*")}' +
  'addEventListener("load",h);new ResizeObserver(h).observe(document.documentElement)})();</script>';

const META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;

/**
 * The page as the frame should load it: the CSP meta first in <head> (so the
 * page's own tags cannot loosen it — every policy applies, the strictest
 * wins), plus the resize reporter.
 */
export function prepareArtifactDocument(html: string): string {
  const inject = META + RESIZE_SCRIPT;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${inject}</head>` + html.slice(at);
  }
  return `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`;
}

export type ContentSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'artifact'; id: string };

const MARKER = /^\s*\[artifact:([a-z0-9][a-z0-9-]{0,63})\]\s*$/;

/**
 * Split message or note content on lines that are exactly `[artifact:<id>]`,
 * which the agent writes to show an artifact. A marker inside a code block is
 * left as text.
 */
export function splitArtifactMarkers(content: string): ContentSegment[] {
  const out: ContentSegment[] = [];
  let buffer: string[] = [];
  let inFence = false;
  const flush = () => {
    if (buffer.length) {
      const text = buffer.join('\n');
      if (text.trim()) out.push({ kind: 'markdown', text });
      buffer = [];
    }
  };
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : MARKER.exec(line);
    if (m) {
      flush();
      out.push({ kind: 'artifact', id: m[1] });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out;
}
