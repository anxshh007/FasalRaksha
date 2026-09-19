/**
 * Gate A · P1-11 · FR-10 — "the backend can be killed, and home, benchmark and RAKSHA still
 * render freshly computed values" (PROMPT §XI verify-by-destruction, §14.3).
 *
 * The journey: a Nashik farmer signs in with a one-time code, verifies a PM-KISAN record, and
 * sees home. Then the API process is killed, not mocked, and the page reloads. It must come back
 * from the service worker, restore the farmer without the identity endpoint, and recompute every
 * figure on the phone. Then the network goes entirely and it must still work. A price alert set
 * while offline waits in the outbox and reaches the server exactly once when the API returns.
 *
 * And the buyer shortlist (P13): with the API dead it is still ranked on the phone, from the
 * district's demand the phone verified while it could, and stamped with the moment it was computed.
 */
import { expect, test, type Page } from '@playwright/test';

const CONTROL = 'http://127.0.0.1:8798';

async function api(action: 'stop' | 'start'): Promise<void> {
  const response = await fetch(`${CONTROL}/api/${action}`, { method: 'POST' });
  expect(response.ok).toBe(true);
}

async function computedAt(page: Page): Promise<number> {
  return Number(await page.getByTestId('computed-at').getAttribute('data-computed-at'));
}

test.afterAll(async () => {
  await fetch(`${CONTROL}/api/start`, { method: 'POST' }).catch(() => undefined);
});

test('Gate A · kill the backend mid-session: home keeps rendering freshly computed values', async ({ page, context }) => {
  // ── online: sign in, verify, home ───────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByTestId('screen')).toHaveAttribute('data-session', 'signed-out');
  await page.locator('input[name="phone"]').fill('+91 98220 11562');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  expect(code).toMatch(/^\d{6}$/);
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('संगीता कदम');
  await page.getByRole('button', { name: 'पुढे' }).click();

  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-11562');
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();

  await expect(page.getByTestId('crop-onion')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
  const onlineModal = await page.getByTestId('modal-onion').getAttribute('data-value');
  expect(Number(onlineModal)).toBeGreaterThan(0);
  await expect(page.getByTestId('verdict-onion')).toHaveAttribute('data-verdict', /^(sell|wait|refuse)$/);
  const onlineVerdict = await page.getByTestId('verdict-onion').getAttribute('data-verdict');
  // The district's buyer demand has reached the phone: home names a best buyer.
  await expect(page.getByTestId('best-buyer')).toHaveAttribute('data-buyer', /.+/, { timeout: 30_000 });
  // The off-season crop is shown with its date and no advice.
  await expect(page.getByTestId('verdict-grapes')).toHaveAttribute('data-verdict', 'suppressed');

  // The service worker has installed the shell and controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // ── kill the API process ────────────────────────────────────────────────────────────────
  await api('stop');
  const killedAt = Date.now();
  await page.reload();

  await expect(page.getByTestId('screen')).toHaveAttribute('data-session', 'offline-restored');
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field');
  await expect(page.getByTestId('modal-onion')).toHaveAttribute('data-value', onlineModal ?? '');
  await expect(page.getByTestId('verdict-onion')).toHaveAttribute('data-verdict', onlineVerdict ?? '');
  expect(await computedAt(page)).toBeGreaterThanOrEqual(killedAt); // computed after the kill, not remembered

  // The buyer shortlist, with the API dead: ranked on the phone, now.
  await page.getByTestId('nav-buyers').click();
  await expect(page.getByTestId('shortlist')).toBeVisible();
  expect(await page.getByTestId('buyer-card').count()).toBeGreaterThanOrEqual(1);
  expect(Number(await page.getByTestId('buyers-computed-at').getAttribute('data-computed-at'))).toBeGreaterThanOrEqual(killedAt);
  await expect(page.getByTestId('buyers')).not.toContainText('%');
  await page.getByTestId('nav-home').click();

  // ── no network at all: the shell comes from the service worker ────────────────────────────
  await context.setOffline(true);
  const beforeOffline = Date.now();
  await page.reload();
  await expect(page.getByTestId('crop-onion')).toBeVisible();
  await expect(page.getByTestId('modal-onion')).toHaveAttribute('data-value', onlineModal ?? '');
  expect(await computedAt(page)).toBeGreaterThanOrEqual(beforeOffline);

  // ── an offline action waits in the outbox ─────────────────────────────────────────────────
  await page.locator('select[name="crop"]').selectOption('onion');
  await page.locator('input[name="threshold"]').fill('4200');
  await page.getByRole('button', { name: 'सूचना ठेवा' }).click();
  await expect(page.getByTestId('alert-status')).toHaveAttribute('data-waiting', '1');
  await expect(page.getByTestId('queue-waiting')).toBeVisible();

  // ── the network and the API come back: the queue drains exactly once ─────────────────────
  await context.setOffline(false);
  await api('start');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
  await expect(page.getByTestId('alert-status')).toHaveAttribute('data-sent', '1', { timeout: 30_000 });
  await expect(page.getByTestId('alert-status')).toHaveAttribute('data-waiting', '0');
  await expect(page.getByTestId('screen')).toHaveAttribute('data-session', 'signed-in');
});
