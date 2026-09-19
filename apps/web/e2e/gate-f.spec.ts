/**
 * Gate F · FR-09 · P1-01 · P1-05 · P1-06 — buyer matching, end to end against the real API: the
 * §16 demonstration buyers seeded into the real tables, the district's demand verified onto the
 * phone, and the shortlist ranked there.
 *
 *   §16.3 step 3   home names the best buyer for the farmer's lot
 *   step 11        the three §16.2 buyers, in order A · C · B, with no percentage anywhere
 *   step 12        why B, offering the most, is last: "…offered, but higher payment-delay risk"
 *   P1-05          a cotton buyer and an unverified buyer never appear, and the screen says why
 *   P1-01          a crop nobody is buying today: no manufactured list, real alternatives
 *   FR-09          a listed lot opens its own shortlist from My listings
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12004');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('रेखा पवार');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12004'); // Niphad, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('Gate F · the §16.2 scenario: ranked by what reaches the farmer, explained, never a percentage', async ({ page }) => {
  await signIn(page);

  // Step 3: home names the best buyer for the farmer's 5 quintals of onion.
  const best = page.getByTestId('best-buyer');
  await expect(best).toContainText('Godavari Agro Traders', { timeout: 30_000 });
  await expect(best).not.toContainText('%');

  // Steps 11–12: the shortlist.
  await page.getByTestId('home-all-buyers').click();
  await expect(page.getByTestId('buyers')).toBeVisible();
  const names = page.getByTestId('buyer-name');
  await expect(names).toHaveText(['Godavari Agro Traders', 'Niphad Traders', 'Deccan Exports']);
  const cards = page.getByTestId('buyer-card');
  const offer = async (i: number) => Number(await cards.nth(i).getByTestId('buyer-price').getAttribute('data-amount'));
  expect(await offer(2)).toBeGreaterThan(await offer(0)); // B offers the most…
  const why = cards.nth(2).getByTestId('buyer-why');
  await expect(why).toHaveAttribute('data-decisive', 'payment-risk'); // …and says why it is last
  await expect(why).toContainText('धोका जास्त');
  await expect(cards.nth(2).getByTestId('buyer-risk')).toBeVisible();
  await expect(cards.nth(0).getByTestId('buyer-why')).toHaveCount(0);
  await expect(cards.nth(0).getByTestId('buyer-quantity')).toHaveAttribute('data-full', 'true');
  await expect(cards.nth(0).getByTestId('buyer-record')).toHaveAttribute('data-deals', '23');
  // The headline figure is what reaches the farmer after freight, less than the gross.
  const afterFreight = Number(await cards.nth(0).getByTestId('buyer-after-freight').getAttribute('data-amount'));
  expect(afterFreight).toBeLessThan((await offer(0)) * 5);
  await expect(page.getByTestId('buyers-demonstration')).toBeVisible();

  // Gate F's grep: no percentage anywhere on the screen.
  await expect(page.getByTestId('buyers')).not.toContainText('%');

  // P1-05: the cotton buyer and the unverified buyer are left out, and the screen says why.
  await expect(names).not.toContainText(['Yeola Cotton Ginning']);
  await expect(page.getByText('Manmad Fresh Buyers')).toHaveCount(0);
  await page.getByTestId('excluded').locator('summary').click();
  await expect(page.getByTestId('excluded-crop-mismatch')).toBeVisible();
  await expect(page.getByTestId('excluded-unverified-buyer')).toBeVisible();

  // The same in English: the explanation is words, not a score.
  while ((await page.locator('html').getAttribute('lang')) !== 'en') await page.getByTestId('spine-language').click();
  await expect(cards.nth(2).getByTestId('buyer-why')).toContainText('but higher payment-delay risk');
  await expect(cards.nth(0)).toContainText('estimated after freight');
  await expect(page.getByTestId('buyers')).not.toContainText('%');
  while ((await page.locator('html').getAttribute('lang')) !== 'mr') await page.getByTestId('spine-language').click();

  // FR-09: a listed lot opens its own shortlist.
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal');
  await page.getByTestId('list-for-sale').click();
  await page.getByTestId('listing').first().getByTestId('listing-buyers').click();
  await expect(page.getByTestId('buyers')).toBeVisible();
  await expect(page.locator('.lot-picker__option[aria-pressed="true"]')).toContainText('5');
  await expect(names.first()).toHaveText('Godavari Agro Traders');

  // P1-01: grapes, which nobody is buying today. No manufactured shortlist; real alternatives.
  await page.getByTestId('nav-home').click();
  await page.getByTestId('crop-grapes').getByRole('button').click();
  await page.getByTestId('nav-buyers').click();
  await page.getByTestId('lot-home').click();
  await expect(page.getByTestId('shortlist')).toHaveCount(0);
  const empty = page.getByTestId('no-good-match');
  await expect(empty).toBeVisible();
  await expect(empty.getByTestId('alt-mandi')).toBeVisible();
  await expect(empty.getByTestId('alt-rate')).toBeVisible();
  await expect(empty.getByTestId('alt-alert')).toBeVisible();
  await expect(page.getByTestId('buyers')).not.toContainText('%');
});
