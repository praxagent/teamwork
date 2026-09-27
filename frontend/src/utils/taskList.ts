/**
 * Markdown task lists (`- [ ] item`) that a person can tick in place.
 *
 * The renderer knows which line of the (preprocessed) markdown a checkbox came
 * from; the source to rewrite is the original text. Both are walked the same
 * way — the Nth task marker outside code fences — so the Nth checkbox on
 * screen always toggles the Nth marker in the source, even where preprocessing
 * shifted lines (it can collapse blank lines and rewrites "•" bullets to "-").
 */

// A list marker, then "[ ]" / "[x]". "•"-style bullets are accepted because
// MarkdownContent rewrites them to "- " before rendering.
const MARKER = /^(\s*(?:[-*+]\s+|\d+[.)]\s+|[•◦▪▸►●○‣⁃]\s*)\[)([ xX])(\])/;

function taskLines(source: string): number[] {
  const out: number[] = [];
  let fenced = false;
  source.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      return;
    }
    if (!fenced && MARKER.test(line)) out.push(i);
  });
  return out;
}

/** Which task (0-based) sits on 1-based `line` of `rendered`, or -1. */
export function taskOrdinalAtLine(rendered: string, line: number): number {
  return taskLines(rendered).indexOf(line - 1);
}

/** `source` with its `ordinal`-th task set to `checked`; unchanged if absent. */
export function setTaskChecked(source: string, ordinal: number, checked: boolean): string {
  const at = taskLines(source)[ordinal];
  if (at === undefined) return source;
  const lines = source.split('\n');
  lines[at] = lines[at].replace(MARKER, `$1${checked ? 'x' : ' '}$3`);
  return lines.join('\n');
}
