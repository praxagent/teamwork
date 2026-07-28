/**
 * Structural guards for the mobile layout traps in this codebase.
 *
 * Three bugs shipped from the same two mistakes, and each was reported as
 * "mobile is broken" rather than as anything a unit test would have caught:
 *
 *  - an inline pixel width applies at EVERY breakpoint and outranks Tailwind,
 *    so a desktop resizer's value became the phone's column width — content
 *    wider than the screen, with a dead band beside it;
 *  - a flex child defaults to `min-height: auto`, so `flex-col overflow-hidden`
 *    without `min-h-0` refuses to shrink and CLIPS its content instead of
 *    letting the inner scroller work.
 *
 * These assert against the source because both are properties of the markup, and
 * jsdom has no layout engine — it cannot tell you something is off-screen. A
 * grep-shaped test is a weak test in general, but here it encodes exactly the
 * mistake a future edit would repeat.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') && !full.includes('.test.') ? [full] : [];
  });
}

describe('mobile layout', () => {
  it('never sets a pixel width inline (it would outrank w-full on phones)', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Percentages are fine — progress bars scale with their parent.
        // Pixel values and bare numbers are the danger.
        if (/style=\{\{\s*\[?['"]?(width|minWidth)/.test(line) && !line.includes('%')) {
          offenders.push(`${file.replace(SRC, '')}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      'pass the value as a CSS variable and consume it with a md: class, so '
        + 'mobile keeps w-full',
    ).toEqual([]);
  });

  it('gives every clipping flex column a min-h-0 so it can scroll', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const isFlexCol = /flex-col/.test(line);
        const clips = /overflow-hidden/.test(line);
        const grows = /flex-1/.test(line);
        if (isFlexCol && clips && grows && !/min-h-0/.test(line)) {
          offenders.push(`${file.replace(SRC, '')}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      'a flex child will not shrink below its content without min-h-0, so '
        + 'overflow-hidden clips instead of scrolling',
    ).toEqual([]);
  });
});
