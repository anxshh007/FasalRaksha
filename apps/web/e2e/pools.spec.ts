/**
 * P14 gate · FR-09 · §6.6 — a consignment clears a real minimum order quantity from real
 * listings, in the browser against the real API.
 *
 * Six demonstration members near the Kadwa Valley collection centre have put 28 quintals of onion
 * into a forming consignment for a bulk buyer who will not take less than 30. A farmer who offers
 * their five quintals for group sale is shown that consignment, joins it, and the consignment
 * clears. Taking the lot out again re-opens it. With no network, joining says why it cannot.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12115');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('गणेश शिंदे');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12115'); // Niphad, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('P14 · one more lot clears the consignment, and taking it out re-opens it', async ({ page, context }) => {
  await signIn(page);

  // A lot offered for group sale (§6.6 is opt-in: the checkbox is the farmer's consent).
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal');
  await page.locator('input[name="pool"]').check();
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first()).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });

  // The consignment two quintals short of the buyer's minimum.
  const consignment = page.getByTestId('consignment');
  await expect(consignment).toBeVisible({ timeout: 30_000 });
  await expect(consignment).toHaveAttribute('data-status', 'forming');
  await expect(consignment).toHaveAttribute('data-mine', 'false');
  await expect(consignment.getByTestId('consignment-volume')).toHaveAttribute('data-total-kg', '2800');
  await expect(consignment.getByTestId('consignment-volume')).toHaveAttribute('data-need-kg', '3000');
  await expect(consignment).toContainText('Kadwa Valley Farmer Producer Company');
  await expect(consignment).toContainText('Yeola Onion Export Terminal');

  // The gate: the farmer's own five quintals clear it.
  await consignment.getByTestId('consignment-join').click();
  await expect(consignment).toHaveAttribute('data-status', 'cleared', { timeout: 30_000 });
  await expect(consignment).toHaveAttribute('data-mine', 'true');
  await expect(consignment.getByTestId('consignment-volume')).toHaveAttribute('data-total-kg', '3300');
  await expect(consignment.getByTestId('consignment-cleared')).toBeVisible();
  await expect(consignment.getByTestId('consignment-mine')).toContainText('5'); // the farmer's own quintals
  await expect(consignment).not.toContainText('%'); // volumes, never a share as a percentage

  // With no network the consignment is still shown, and says why it cannot be changed.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await page.getByTestId('nav-deals').click();
  await expect(consignment).toHaveAttribute('data-status', 'cleared');
  await expect(consignment.getByTestId('consignment-offline')).toBeVisible();
  await expect(consignment.getByTestId('consignment-leave')).toBeDisabled();

  // Back online: taking the lot out drops the consignment below the minimum again.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
  await consignment.getByTestId('consignment-leave').click();
  await expect(consignment).toHaveAttribute('data-status', 'forming', { timeout: 30_000 });
  await expect(consignment.getByTestId('consignment-volume')).toHaveAttribute('data-total-kg', '2800');
  await expect(consignment.getByTestId('consignment-join')).toBeVisible();
});
