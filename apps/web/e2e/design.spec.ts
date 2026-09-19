/**
 * P9 gate · §9.3 · §9.10 — visual snapshots of the design system in both themes, at the design
 * origin (360×800) and desktop (1440×900). The clock is fixed so prices, dates and the
 * guardrail's verdicts are the same on every run; the few readouts that show wall-clock time
 * are masked. A snapshot that changes fails the run, so a design change is always deliberate
 * (`pnpm e2e -- --update-snapshots`).
 *
 * One sign-in covers every screen, because the one-time-code endpoint is rate-limited per device.
 */
import { expect, test, type Page } from '@playwright/test';

const NOW = new Date('2026-09-19T08:30:00+05:30');
const VIEWPORTS = [
  { name: '360', width: 360, height: 800 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const masks = (page: Page) => [page.getByTestId('strip-last-sync'), page.getByTestId('computed-at'), page.getByTestId('dev-code')];

async function setTheme(page: Page, theme: 'night' | 'field') {
  const current = await page.evaluate(() => document.documentElement.dataset['theme']);
  if (current !== theme) await page.getByTestId('spine-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function shoot(page: Page, screen: string) {
  for (const theme of ['night', 'field'] as const) {
    await setTheme(page, theme);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${screen}-${theme}-${viewport.name}.png`, { fullPage: true, mask: masks(page), animations: 'disabled', maxDiffPixelRatio: 0.01 });
    }
  }
}

test('P9 · the design system in both themes, phone and desktop', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await expect(page.getByTestId('screen')).toHaveAttribute('data-session', 'signed-out');
  await expect(page.getByTestId('theme-offer')).toBeVisible(); // FIELD is offered on first run
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await expect(page.getByTestId('theme-offer')).toBeHidden();
  await shoot(page, 'landing');

  // Everything the Latin display type does, in English too.
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await setTheme(page, 'night');
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page).toHaveScreenshot('landing-en-night-360.png', { fullPage: true, mask: masks(page), animations: 'disabled', maxDiffPixelRatio: 0.01 });
  await page.getByRole('button', { name: 'मराठी', exact: true }).click();

  await page.locator('input[name="phone"]').fill('+91 98220 20001');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('सुनील भोसले');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await expect(page.locator('input[name="pmkisan"]')).toBeVisible();
  await shoot(page, 'verify');

  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-11427');
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('crop-onion')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
  await shoot(page, 'home');
});
