/**
 * P16 · FR-14 · §8.9 · §16.3 steps 16–18 — the rest of a deal, in the browser: the lot goes, the
 * money arrives, and each side says how the other did.
 *
 * The point of this walk is the last assertion. A reputation in this product is not a profile
 * field anybody can edit: it is what falls out of completed transactions. So the buyer's record
 * is read before the deal and after it, and the difference is one more completed deal and a
 * rating with the number of people behind it — written by pressing the same buttons a farmer
 * presses, not by a seed.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12318');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('विलास गिते');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12318'); // Chandwad, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('P16 · delivery, payment and the rating that is the only thing reputation is written by', async ({ page }) => {
  await signIn(page);

  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal');
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first()).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });

  const offers = page.getByTestId('offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  const dealId = (await offers.first().getAttribute('data-deal')) ?? '';
  const deal = page.locator(`[data-testid="offer"][data-deal="${dealId}"]`);
  const dealsBefore = Number(await deal.getByTestId('offer-record').getAttribute('data-deals'));

  await deal.getByTestId('offer-accept').click();
  await expect(deal).toHaveAttribute('data-state', 'SAUDA_SLIP', { timeout: 30_000 });

  // The lot goes. The farmer confirms their own side; the buyer confirms theirs (§8.9).
  const progress = deal.getByTestId('deal-progress');
  await expect(progress).toHaveAttribute('data-stage', 'delivery');
  await progress.getByTestId('delivery-confirm').click();
  await expect(deal).toHaveAttribute('data-state', 'DELIVERY_CONFIRMED', { timeout: 30_000 });
  await expect(progress.getByTestId('delivery-done')).toBeVisible();

  // Delivered is not paid: the deal is not complete until the farmer says the money arrived.
  await expect(progress).toHaveAttribute('data-stage', 'payment');
  await expect(progress.getByTestId('payment-amount')).not.toHaveValue(''); // the slip's total, offered back
  await progress.getByTestId('payment-confirm').click();
  await expect(deal).toHaveAttribute('data-state', 'PAYMENT_CONFIRMED', { timeout: 30_000 });
  await expect(progress.getByTestId('payment-done')).toHaveAttribute('data-days', '0');

  // And only now can either side rate the other.
  await expect(progress).toHaveAttribute('data-stage', 'rating');
  await progress.getByTestId('rate-paymentTimeliness-5').check();
  await progress.getByTestId('rate-weighmentFairness-4').check();
  await progress.getByTestId('rate-pickupReliability-5').check();
  await progress.getByTestId('rating-send').click();
  await expect(deal).toHaveAttribute('data-state', 'MUTUALLY_RATED', { timeout: 30_000 });
  await expect(progress.getByTestId('rating-done')).toBeVisible();

  // The buyer's record has moved, by one completed deal and one rating — with its count shown.
  const rating = deal.getByTestId('offer-rating');
  await expect(rating).not.toHaveAttribute('data-count', '0');
  await expect(rating).toContainText('५'); // out of five, in the farmer's own numerals
  const dealsAfter = Number(await deal.getByTestId('offer-record').getAttribute('data-deals'));
  expect(dealsAfter).toBe(dealsBefore + 1);
  await expect(deal).not.toContainText('%');
});
