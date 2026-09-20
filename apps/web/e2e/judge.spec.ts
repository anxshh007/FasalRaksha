/**
 * P20 · §14.4 — Judge Mode in the browser: hidden, lazy, and live.
 *
 * Three claims are checked here, because all three are the point of it. A farmer never meets it:
 * no navigation entry, no link, and the chunk is not even downloaded until the route is typed.
 * What it shows is read at the moment it is shown, from the server's artefacts and from this
 * device's own IndexedDB. And it is the one place in the product where "skill", "coverage" and
 * "model" are allowed to appear, which the interface scan enforces everywhere else.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12750');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('अरुण साळुंखे');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12750'); // Yeola, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('§14.4 · Judge Mode is reachable only by typing it, and everything on it is live', async ({ page, request }) => {
  await signIn(page);

  // A farmer never meets it: it is in no navigation and behind no link on any screen.
  await expect(page.locator('[data-testid^="nav-"]')).toHaveCount(4);
  await expect(page.locator('a[href*="_judge"]')).toHaveCount(0);

  await page.goto('/#/_judge');
  const judge = page.getByTestId('judge');
  await expect(judge).toBeVisible({ timeout: 30_000 });

  // The release it names is the release the API says is loaded.
  const api = await (await request.get('http://127.0.0.1:8799/api/_judge/status')).json();
  await expect(judge.getByTestId('judge-release')).toContainText(String(api.release.version));
  await expect(judge.getByTestId('judge-data-source')).toHaveText(String(api.release.dataSource));

  // Adapters, one line each, in the mode they are actually running in.
  const adapters = judge.getByTestId('judge-adapters');
  await expect(adapters.locator('[data-adapter="market"]')).toHaveAttribute('data-mode', String(api.adapters.market));
  await expect(adapters.locator('li')).toHaveCount(Object.keys(api.adapters).length);

  // The nine layers and the seven conditions, for the crop this phone is showing.
  await expect(judge.getByTestId('judge-layers').locator('tbody tr')).toHaveCount(9);
  await expect(judge.getByTestId('judge-conditions').locator('tbody tr')).toHaveCount(8); // GR-1…GR-7 and RK-7

  // The pipeline's own validation table, and the grading numbers with their honesty attached.
  await expect(judge.getByTestId('judge-validation').locator('tbody tr').first()).toBeVisible();
  await expect(judge.getByTestId('judge-vision-note')).toContainText('field-validated: false');

  // And the device half: this phone's cache, read from IndexedDB, not from the server.
  await expect(judge.getByTestId('judge-device')).toContainText('nashik');
  await expect(judge.getByTestId('judge-requirements')).toContainText('done');
});

test('§14.4 · the diagnostics chunk is not downloaded by a farmer who never opens it', async ({ page }) => {
  const chunks: string[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('.js')) chunks.push(response.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'गडदच ठेवा' })).toBeVisible();
  await page.waitForTimeout(1500);
  const before = chunks.length;

  await page.goto('/#/_judge');
  await expect(page.getByTestId('judge')).toBeVisible({ timeout: 30_000 });
  expect(chunks.length).toBeGreaterThan(before); // the chunk arrives only when the route is opened
});
