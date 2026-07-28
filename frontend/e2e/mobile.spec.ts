/**
 * Mobile layout checks at a real phone viewport.
 *
 * Every mobile bug reported so far was found by a human looking at a phone, and
 * none would have been caught by a jsdom test — jsdom has no layout engine, so
 * it cannot tell you something is off-screen, clipped, or wider than the window.
 * Playwright can: it lays out for real, at a real viewport, with touch enabled.
 *
 * These assertions are the bugs that actually happened, written down:
 *
 *  - a desktop column width leaked to mobile and left a dead band beside the
 *    content (inline pixel width outranking `w-full`);
 *  - the trace summary was crushed to a one-line sliver by a sibling that
 *    refused to shrink, with no way to scroll to it;
 *  - long unbreakable URLs made the message list wider than the screen, so
 *    vertical scrolls drifted sideways.
 *
 * Run against a live instance:
 *   BASE_URL=https://teamwork.your-tailnet.ts.net npx playwright test e2e/mobile.spec.ts
 *
 * The KEYBOARD is more testable than it first appears. Playwright cannot summon
 * one, so `visualViewport` never shrinks — but a keyboard only ever appears
 * BECAUSE a field took focus, and focus is fully driveable. So the chain
 *
 *     field focused  ->  html.keyboard-open  ->  tab bar hidden, padding released
 *
 * can be verified link by link here. What remains device-only is narrow: whether
 * the visual viewport lands exactly where we expect once the keyboard is up.
 * (An Android emulator would close even that, but this build machine has no
 * /dev/kvm and no vmx/svm flags, so an AVD would run in software at ~10-50x
 * slowdown — too slow to be a test loop.)
 */
import { devices, expect, test, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.use({ ...devices['iPhone 13'], baseURL: BASE });

/** Widest element that overflows the viewport, if any — for a useful failure. */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const guilty: { tag: string; cls: string; width: number }[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && r.width > 0) {
        guilty.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          width: Math.round(r.width),
        });
      }
    });
    return { viewport: vw, scrollWidth: document.documentElement.scrollWidth, guilty: guilty.slice(0, 5) };
  });
}

/** Open the first project's workspace.
 *
 * The card is a clickable div, not a link — my first version looked for an
 * `href` and silently stayed on the projects page, so four "passing" checks
 * were measuring a page with almost nothing on it. The screenshot said so
 * immediately, which is the argument for taking them.
 */
async function openWorkspace(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('text=My Projects').first()).toBeVisible({ timeout: 15_000 });
  const card = page.locator('div[class*="cursor-pointer"]').first();
  await expect(card).toBeVisible({ timeout: 5_000 });
  await card.click();
  await page.waitForLoadState('networkidle');
  // The tab bar only exists inside a workspace; wait for it rather than a
  // fixed timeout, so a slow load fails as a timeout and not as a wrong answer.
  await expect(page.locator('.mobile-tab-bar')).toBeVisible({ timeout: 15_000 });
}

test.describe('mobile layout', () => {
  test('nothing is wider than the screen', async ({ page }) => {
    await openWorkspace(page);
    const result = await horizontalOverflow(page);
    expect(
      result.guilty,
      `elements wider than the ${result.viewport}px viewport — a desktop width `
        + 'has leaked to mobile, or unbreakable text is not wrapping',
    ).toEqual([]);
  });

  test('the page itself does not scroll sideways', async ({ page }) => {
    await openWorkspace(page);
    const { scrollWidth, viewport } = await horizontalOverflow(page);
    expect(scrollWidth, 'the document scrolls horizontally').toBeLessThanOrEqual(viewport + 1);
  });

  test('the bottom tab bar is present and reachable', async ({ page }) => {
    await openWorkspace(page);
    const bar = page.locator('.mobile-tab-bar');
    await expect(bar).toBeVisible();

    // Touch targets: anything under ~40px is a miss waiting to happen.
    const buttons = bar.locator('button');
    const n = await buttons.count();
    expect(n, 'the tab bar should have five slots').toBeGreaterThanOrEqual(4);
    for (let i = 0; i < n; i++) {
      const box = await buttons.nth(i).boundingBox();
      expect(box!.height, `tab ${i} is only ${box!.height}px tall`).toBeGreaterThanOrEqual(40);
    }
  });

  test('a long unbreakable URL does not widen the layout', async ({ page }) => {
    await openWorkspace(page);
    // Inject the exact shape that caused the sideways drift.
    await page.evaluate(() => {
      const host = document.querySelector('.message-text') || document.body;
      const p = document.createElement('p');
      p.className = 'message-text';
      p.textContent = 'https://x.com/someone/status/2081762065392541951?s=46&extra=' + 'a'.repeat(120);
      host.appendChild(p);
    });
    const result = await horizontalOverflow(page);
    expect(result.guilty, 'a long URL made something wider than the screen').toEqual([]);
  });

  test('every scrollable pane can actually scroll to its end', async ({ page }) => {
    await openWorkspace(page);
    const clipped = await page.evaluate(() => {
      const bad: { cls: string; scrollH: number; clientH: number }[] = [];
      document.querySelectorAll('.overflow-hidden').forEach((el) => {
        const e = el as HTMLElement;
        // Content taller than the box, with no scroller of its own and none
        // among its children, is content nobody can reach.
        if (e.scrollHeight > e.clientHeight + 4) {
          const hasScroller = e.querySelector('.overflow-y-auto, .overflow-auto');
          if (!hasScroller) {
            bad.push({
              cls: e.className.toString().slice(0, 90),
              scrollH: e.scrollHeight,
              clientH: e.clientHeight,
            });
          }
        }
      });
      return bad.slice(0, 5);
    });
    expect(clipped, 'content is clipped with no way to scroll to it').toEqual([]);
  });
});

test.describe('keyboard', () => {
  test('focusing a text field hides the tab bar and releases its padding', async ({ page }) => {
    await openWorkspace(page);

    const bar = page.locator('.mobile-tab-bar');
    await expect(bar, 'the bar should be visible before typing').toBeVisible();

    // The composer lives in Chat; a fresh context can land on another tab.
    await page.locator('.mobile-tab-bar button', { hasText: 'Chat' }).click();
    const field = page.locator('textarea, input[type="text"]').first();
    await expect(field, 'no composer found in Chat').toBeVisible({ timeout: 15_000 });
    await field.focus();

    // The class the CSS hangs on.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains('keyboard-open')),
            { message: 'focusing a field did not mark the document' })
      .toBe(true);

    // And what it is FOR: the bar that was covering the composer.
    await expect(bar, 'the tab bar still covers the composer while typing').toBeHidden();

    // Panes reserve room for the bar; they must give it back at the same
    // moment or a strip of dead space sits where it was.
    const padding = await page.evaluate(() => {
      const el = document.querySelector('.pb-mobile-nav') as HTMLElement | null;
      return el ? getComputedStyle(el).paddingBottom : null;
    });
    if (padding !== null) {
      expect(padding, 'the reserved strip was not reclaimed').toBe('0px');
    }
  });

  test('blurring brings the tab bar back', async ({ page }) => {
    await openWorkspace(page);
    await page.locator('.mobile-tab-bar button', { hasText: 'Chat' }).click();
    const field = page.locator('textarea, input[type="text"]').first();
    await expect(field).toBeVisible({ timeout: 15_000 });
    await field.focus();
    await expect(page.locator('.mobile-tab-bar')).toBeHidden();

    await field.blur();
    await expect(
      page.locator('.mobile-tab-bar'),
      'navigation must come back when you stop typing',
    ).toBeVisible();
  });
});
