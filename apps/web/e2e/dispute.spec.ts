/**
 * P17 · FR-15 · §8.9 · §16.3 step 19 — a complaint, with the lot's own photograph attached, and
 * a buyer's clean record visibly ceasing to be clean.
 *
 * The farmer photographs the lot (the camera is absent in this browser, so the same pipeline is
 * fed through the file input — CAM-01's path, walked properly in gate-c), sells it, takes it to
 * delivery, and then says the grade was disputed at the yard. What is sent is a reason code, a
 * note in their own words and the photograph already on file. What comes back is the sentence
 * naming the district officer it went to — and, on the offer card, the buyer's rating replaced by
 * an open complaint, which is the only thing that gives the mechanism teeth.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

const FIXTURES = resolve(import.meta.dirname, '../../../data/fixtures/camera');
const onionLot = { name: 'IMG_onion-lot.jpg', mimeType: 'image/jpeg', buffer: readFileSync(join(FIXTURES, 'onion-lot.jpg')) };

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12427');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('मंगल जाधव');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12427'); // Dindori, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('P17 · a grade dispute, with the photograph, and the buyer stops looking clean', async ({ page }) => {
  test.setTimeout(240_000); // a photograph goes up the resumable pipeline before the deal begins
  await signIn(page);

  // A lot with a photograph on it: this browser has no camera, so the file input takes the same
  // pipeline (CAM-01), and the photograph is what the complaint will carry.
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal');
  await page.getByTestId('photo-add').click();
  await page.getByTestId('camera-file').setInputFiles(onionLot);
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'proposed', { timeout: 60_000 });
  await page.getByTestId('grade-confirm').click();
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-provenance', 'farmer-declared-ai-assisted');
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first()).toHaveAttribute('data-state', 'sent', { timeout: 60_000 });
  await expect(page.getByTestId('listing-photo').first()).toHaveAttribute('data-state', 'sent', { timeout: 120_000 });

  // Sold, and delivered.
  const offers = page.getByTestId('offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  const dealId = (await offers.first().getAttribute('data-deal')) ?? '';
  const deal = page.locator(`[data-testid="offer"][data-deal="${dealId}"]`);
  await deal.getByTestId('offer-accept').click();
  await expect(deal).toHaveAttribute('data-state', 'SAUDA_SLIP', { timeout: 30_000 });
  await deal.getByTestId('deal-progress').getByTestId('delivery-confirm').click();
  await expect(deal).toHaveAttribute('data-state', 'DELIVERY_CONFIRMED', { timeout: 30_000 });

  // Only now is there something to complain about.
  await deal.getByTestId('dispute-open').click();
  await deal.getByTestId('dispute-reason-GRADE_DISPUTE').click();
  await deal.getByTestId('dispute-note').fill('यार्डवर माल C ठरवला; फोटोत तो B होता.');
  await expect(deal.getByTestId('dispute-photo')).toBeChecked(); // the lot's own photograph goes with it
  await deal.getByTestId('dispute-send').click();

  const dispute = deal.getByTestId('dispute');
  await expect(dispute).toBeVisible({ timeout: 30_000 });
  await expect(dispute).toHaveAttribute('data-state', 'DISPUTE_OPEN');
  await expect(dispute).toHaveAttribute('data-reason', 'GRADE_DISPUTE');
  await expect(dispute).toContainText('नाशिक'); // routed to the district's own agriculture officer

  // And the buyer's clean presentation is gone: an open complaint stands where the rating was.
  await expect(deal.getByTestId('offer-under-dispute')).toBeVisible();
  await expect(deal.getByTestId('offer-rating')).toHaveCount(0);

  // It survives the network going away, like every other record on this phone.
  await page.reload();
  await page.getByTestId('nav-deals').click();
  await expect(deal.getByTestId('dispute')).toHaveAttribute('data-state', 'DISPUTE_OPEN');
});
