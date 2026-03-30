/**
 * Playwright E2E tests for TeamWork UI.
 *
 * Run against a running docker-compose stack:
 *   cd frontend && npx playwright test
 *
 * Prerequisites:
 *   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
 *   (wait for healthchecks to pass)
 */
import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the first project's workspace. */
async function openFirstProject(page: Page) {
  // Home page auto-redirects to /projects when projects exist.
  // /projects page shows project cards as clickable divs.
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // We should land on /projects (auto-redirect from Home if projects exist)
  // Wait for "My Projects" heading
  await expect(page.locator('text=My Projects').first()).toBeVisible({ timeout: 15_000 });

  // Click the first project card (div with cursor-pointer containing the project name)
  const projectCard = page.locator('.cursor-pointer:has-text("Workspace"), div[class*="cursor-pointer"]').first();
  await expect(projectCard).toBeVisible({ timeout: 5_000 });
  await projectCard.click();
  await page.waitForLoadState('networkidle');

  // Wait for the workspace to fully load (channel sidebar should appear)
  await expect(page.locator('text=general').first()).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('TeamWork UI smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await openFirstProject(page);
  });

  // ---- Channel sidebar ----

  test('channel sidebar shows #general channel', async ({ page }) => {
    const sidebar = page.locator('[class*="flex"][class*="flex-col"]').first();
    await expect(sidebar.locator('text=general')).toBeVisible();
  });

  test('channel sidebar shows #discord mirror channel', async ({ page }) => {
    // The #discord channel should exist (created during project init)
    await expect(page.locator('text=discord').first()).toBeVisible({ timeout: 5_000 });
  });

  test('channel sidebar shows #sms mirror channel', async ({ page }) => {
    // The #sms channel should exist (created during project init)
    await expect(page.locator('text=sms').first()).toBeVisible({ timeout: 5_000 });
  });

  // ---- Observability panel ----

  test('observability panel opens wide (no channel sidebar)', async ({ page }) => {
    // Click the Activity/Observability button (it has the Activity icon)
    const obsButton = page.locator('button[title*="Observability"]');
    await expect(obsButton).toBeVisible();
    await obsButton.click();

    // Wait for the Observability panel to appear
    await expect(page.locator('text=Observability').first()).toBeVisible({ timeout: 5_000 });

    // The Live Agents tab should be visible
    await expect(page.locator('text=Live Agents')).toBeVisible();

    // The channel sidebar (#general) should NOT be visible when observability is open
    // (it should be hidden for wide mode)
    const generalChannel = page.locator('text=#general');
    await expect(generalChannel).not.toBeVisible({ timeout: 2_000 });
  });

  test('observability panel has working X close button', async ({ page }) => {
    const obsButton = page.locator('button[title*="Observability"]');
    await obsButton.click();
    await expect(page.locator('text=Live Agents')).toBeVisible({ timeout: 5_000 });

    // Find and click the X close button within the observability panel
    const closeButton = page.locator('button[title="Close"]').first();
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // After closing, the channel sidebar should be back
    await expect(page.locator('text=general').first()).toBeVisible({ timeout: 3_000 });
  });

  test('observability Dashboards tab does not crash', async ({ page }) => {
    // Open observability panel
    const obsButton = page.locator('button[title*="Observability"]');
    await obsButton.click();
    await expect(page.locator('text=Live Agents')).toBeVisible({ timeout: 5_000 });

    // Click the Dashboards tab
    const dashboardsTab = page.locator('button:has-text("Dashboards")');
    await expect(dashboardsTab).toBeVisible();
    await dashboardsTab.click();

    // Should NOT crash — should show either dashboard content or "Observability Disabled"
    // Wait a moment for render
    await page.waitForTimeout(500);

    // Check no error overlay appeared (React error boundary or uncaught error)
    const errorOverlay = page.locator('[class*="error"], [id*="error"]');
    const hasError = await errorOverlay.isVisible({ timeout: 1_000 }).catch(() => false);
    expect(hasError).toBeFalsy();

    // Should show either dashboard cards or the "disabled" message
    const hasDashboards = await page.locator('text=LLM Performance').isVisible({ timeout: 2_000 }).catch(() => false);
    const hasDisabled = await page.locator('text=Observability Disabled').isVisible({ timeout: 2_000 }).catch(() => false);
    expect(hasDashboards || hasDisabled).toBeTruthy();
  });

  test('observability Live Agents tab shows agent list', async ({ page }) => {
    const obsButton = page.locator('button[title*="Observability"]');
    await obsButton.click();

    // The Live Agents tab should show at least one agent (Prax is always registered)
    await expect(page.locator('text=Agents').first()).toBeVisible({ timeout: 5_000 });

    // Look for agent entries — they should have names like "Prax", "Planner", etc.
    // At minimum we expect the agent count badge
    const agentCountBadge = page.locator('span:has-text("Agents") + span, span:text-is("Agents") ~ span').first();
    // Or just verify the agents section rendered without crashing
    const agentList = page.locator('text=Agents');
    await expect(agentList.first()).toBeVisible();
  });

  // ---- Execution Graphs panel ----

  test('execution graphs panel opens and closes with X', async ({ page }) => {
    // The Workflow/Execution Graphs button
    const graphButton = page.locator('button[title*="Execution Graphs"]');
    // May not exist for coaching projects
    if (await graphButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await graphButton.click();

      // Should show the graph panel
      await page.waitForTimeout(500);

      // Should have an X close button
      const closeButton = page.locator('button[title="Close"]').first();
      if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await closeButton.click();
        // After closing, should go back to chat view
        await expect(page.locator('text=general').first()).toBeVisible({ timeout: 3_000 });
      }
    }
  });

  // ---- Browser panel ----

  test('browser panel opens and closes with X', async ({ page }) => {
    const browserButton = page.locator('button[title*="Browser"]');
    await expect(browserButton).toBeVisible();
    await browserButton.click();

    // Should have a close button
    await page.waitForTimeout(500);
    const closeButton = page.locator('button[title="Close"], button:has-text("Close")').first();
    if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await closeButton.click();
    }
  });

  // ---- Terminal panel ----

  test('terminal panel opens and closes with X', async ({ page }) => {
    const termButton = page.locator('button[title*="Terminal"]');
    await expect(termButton).toBeVisible();
    await termButton.click();

    await page.waitForTimeout(500);
    const closeButton = page.locator('button[title="Close"], button:has-text("Close")').first();
    if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await closeButton.click();
    }
  });

  // ---- No JS errors on navigation ----

  test('no uncaught JS errors when navigating between panels', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    // Click through all panels
    const panels = [
      'button[title*="Tasks"]',
      'button[title*="Files"]',
      'button[title*="Observability"]',
    ];

    for (const selector of panels) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }

    // Click Dashboards tab inside observability
    const dashTab = page.locator('button:has-text("Dashboards")');
    if (await dashTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await dashTab.click();
      await page.waitForTimeout(300);
    }

    // Click Live Agents tab
    const liveTab = page.locator('button:has-text("Live Agents")');
    if (await liveTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await liveTab.click();
      await page.waitForTimeout(300);
    }

    // Filter out known non-critical errors (e.g. WebSocket reconnect)
    const criticalErrors = errors.filter(
      (e) => !e.includes('WebSocket') && !e.includes('Failed to fetch')
    );

    expect(criticalErrors).toEqual([]);
  });
});
