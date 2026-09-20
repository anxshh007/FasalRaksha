/**
 * §16.1 · CUTS C-14 — signing in by choosing a farmer from the demonstration registry.
 *
 * A demonstration should not depend on somebody typing `PMK-MH-2003-11427` correctly from a
 * slide, so the verification screen lists the records the *mock* registry holds and one tap
 * verifies with that one. The list is the adapter's, not a flag's: a live registry implements no
 * `samples()`, hands out no list, and this screen falls back to the plain "type your number".
 *
 * What the test pins is that the list is honest about what it is, that a tap really verifies —
 * the same endpoint, the same record, the same district written by the server — and that the
 * typed path still works beside it.
 */
import { expect, test } from '@playwright/test';

test('§16.1 · a tap on a demonstration farmer signs in as that farmer', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 13084');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('देवयानी शेलार');
  await page.getByRole('button', { name: 'पुढे' }).click();

  // The list is there, and says what it is before it says who is in it.
  const list = page.getByTestId('registry-samples');
  await expect(list).toBeVisible({ timeout: 30_000 });
  await expect(list).toContainText('प्रात्यक्षिक'); // "a demonstration registry"
  const samples = page.getByTestId('registry-sample');
  expect(await samples.count()).toBeGreaterThanOrEqual(15);

  // Each row carries the name, where they farm, and the number that would otherwise be typed.
  const chosen = samples.filter({ hasText: 'Nanda Bhaskar Sonawane' });
  await expect(chosen).toHaveAttribute('data-id', 'PMK-MH-2003-13102');
  await expect(chosen).toHaveAttribute('data-district', 'nashik');
  await expect(chosen).toContainText('Lasalgaon');

  // One tap, and the district on the briefing is the one the registry holds — written by the
  // server from the record, never from anything the page said (P1-04).
  await chosen.click();
  await expect(page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('spine-district')).toContainText('नाशिक');
  await expect(page.getByTestId('benchmark')).toBeVisible();
});

test('§16.1 · the number can still be typed, and a number the registry does not know is refused', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 13195');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('रमेश बोरसे');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await expect(page.getByTestId('registry-samples')).toBeVisible({ timeout: 30_000 });

  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-00000'); // no such record
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toHaveCount(0);
  await expect(page.getByTestId('registry-samples')).toBeVisible(); // still here to choose from

  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2211-07903'); // Udgir, Latur
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('spine-district')).toContainText('लातूर');
});
