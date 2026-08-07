/**
 * Mobile layout survey — screenshots every workspace panel at a phone
 * viewport and fails on horizontal overflow.
 *
 * NOT part of CI: needs the local dev stack (vite:5173 + teamwork:8000) and a
 * real project id. Run it whenever touching panel layout:
 *
 *   PROJECT=<id> SHOTS=/tmp/shots npx playwright test e2e/mobile-survey.spec.ts
 *
 * This harness is how the 2026-08 mobile refactor found the desktop-layout
 * crush (fixed w-72 panes, stacked companion chats, 35svh chat bands) that
 * three earlier spot-fix passes missed. Screenshots are the ground truth —
 * grep found none of those problems.
 */
import { test, expect } from '@playwright/test';

const PROJECT = process.env.PROJECT ?? 'a98cd46a-952a-429b-b807-0967a9a18785';
const SHOTS = process.env.SHOTS ?? 'test-results/mobile-survey';
const VIEWS = ['chat', 'tasks', 'files', 'library', 'terminal', 'browser',
               'progress', 'observability', 'memory', 'scheduler', 'settings', 'desktop'];

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

for (const view of VIEWS) {
  test(`mobile ${view}`, async ({ page }) => {
    await page.addInitScript(([p, v]) => localStorage.setItem(`tw:view:${p}`, v), [PROJECT, view]);
    await page.goto(`http://localhost:5173/project/${PROJECT}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/${view}.png` });
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflowX, `${view} must not scroll horizontally`).toBe(false);
  });
}
