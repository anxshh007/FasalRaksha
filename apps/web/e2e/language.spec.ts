/**
 * Gate H · §10.1 — language is chosen before sign-in and changes the actual interface in all
 * three locales: `lang`, every visible string, number and date formatting, not only speech.
 * Snapshots of the landing in Marathi, Hindi and English are compared on every run.
 */
import { expect, test } from '@playwright/test';

test('Gate H · the landing in Marathi, Hindi and English', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-19T08:30:00+05:30'));
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();

  const texts: Record<string, string> = {};
  for (const [locale, name] of [['mr', 'मराठी'], ['hi', 'हिन्दी'], ['en', 'English']] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    texts[locale] = await page.locator('main').innerText();
    await expect(page).toHaveScreenshot(`landing-${locale}.png`, { fullPage: true, mask: [page.getByTestId('strip-last-sync')], animations: 'disabled', maxDiffPixelRatio: 0.01 });
  }
  expect(texts['mr']).toContain('आधी आजचा दर');
  expect(texts['hi']).toContain('पहले आज का भाव');
  expect(texts['en']).toContain("Today's rate first");
  // Not a label swap: nearly every line differs between each pair of languages.
  for (const [a, b] of [['mr', 'hi'], ['mr', 'en'], ['hi', 'en']] as const) {
    const linesA = (texts[a] ?? '').split('\n').filter((l) => l.trim() !== '');
    const linesB = new Set((texts[b] ?? '').split('\n').filter((l) => l.trim() !== ''));
    const shared = linesA.filter((l) => linesB.has(l) && !['मराठी', 'हिन्दी', 'English'].includes(l));
    expect(shared.length, `${a} vs ${b}: ${shared.join(' | ')}`).toBeLessThanOrEqual(1);
  }
  // The choice survives a reload: it is stored on the phone.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
