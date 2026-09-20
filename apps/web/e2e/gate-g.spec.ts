/**
 * Gate G · FR-12 · §8.9 — an offline client cannot finalise a server-authoritative transition.
 *
 * The compile-time half of this gate is in `packages/shared/src/dealstate/outbox.test.ts`: the
 * `OutboxEntry` union has no deal transition in it, proven by `@ts-expect-error` lines that the
 * typechecker itself enforces. This is the runtime half, in a real browser against the real API.
 *
 * A farmer lists a lot, the traders answer it, and then the network goes away. The offers are all
 * still on the screen — read from the phone's own store, because knowing what you have been
 * offered does not need a server. What is not there is a way to agree to one: the buttons are
 * disabled, the screen says why in Marathi, and the outbox is inspected directly to prove that
 * nothing was queued. Back online, the acceptance goes through and the server issues the sauda
 * slip with the district benchmark of the day frozen onto it.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 12206');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('सुनिता काळे');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-12206'); // Ozar, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

/** Everything the phone has queued to send, read straight out of IndexedDB. */
async function queuedKinds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('fasal-raksha');
        open.onerror = () => reject(new Error('the device store did not open'));
        open.onsuccess = () => {
          const rows = open.result.transaction('outbox').objectStore('outbox').getAll();
          rows.onsuccess = () => resolve((rows.result as Array<{ entry: { kind: string } }>).map((row) => row.entry.kind));
          rows.onerror = () => reject(new Error('the outbox could not be read'));
        };
      }),
  );
}

test('Gate G · the offers survive the network going away; agreeing to one does not', async ({ page, context }) => {
  await signIn(page);

  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal');
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first()).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });

  // The traders answer: real offers on a real lot, each with its basis and its record.
  const offers = page.getByTestId('offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  expect(await offers.count()).toBeGreaterThanOrEqual(2);
  const first = offers.first();
  await expect(first).toHaveAttribute('data-state', 'OFFERED');
  await expect(first.getByTestId('offer-price')).toBeVisible();
  await expect(first.getByTestId('offer-gross')).toBeVisible();
  await expect(first.getByTestId('offer-vs-rate')).toBeVisible();
  await expect(page.getByTestId('offers')).not.toContainText('%'); // never a match percentage (Gate F)

  // Two of them, followed by id: the list re-orders as deals move, so a position is not a deal.
  const ids = await offers.evaluateAll((cards) => cards.map((c) => c.getAttribute('data-deal') ?? ''));
  const card = (id: string) => page.locator('[data-testid="offer"][data-deal="' + id + '"]');
  const taking = card(ids[0] ?? '');
  const asking = card(ids[1] ?? '');

  // The farmer names their own price on one of them: it is now the buyer's turn, not theirs.
  const offered = Number(await asking.getByTestId('offer-price').getAttribute('data-amount'));
  await asking.getByTestId('offer-counter').click();
  await asking.getByTestId('offer-counter-price').fill(String(Math.round(offered * 1.04)));
  await asking.getByTestId('offer-counter-send').click();
  await expect(asking).toHaveAttribute('data-state', 'COUNTERED', { timeout: 30_000 });
  await expect(asking.getByTestId('offer-waiting')).toBeVisible();
  await expect(asking.getByTestId('offer-accept')).toHaveCount(0); // you cannot accept your own price

  // ── the gate ──────────────────────────────────────────────────────────────────────────────
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await page.getByTestId('nav-deals').click();

  // What the farmer was offered is still all there, computed from the phone's own store.
  await expect(taking).toBeVisible();
  await expect(taking.getByTestId('offer-price')).toBeVisible();
  await expect(taking.getByTestId('offer-gross')).toBeVisible();
  await expect(asking).toHaveAttribute('data-state', 'COUNTERED'); // the counter stuck, and is readable

  // What is not there is a way to finalise anything, and the screen says why.
  await expect(taking.getByTestId('offer-accept')).toBeDisabled();
  await expect(taking.getByTestId('offer-counter')).toBeDisabled();
  await expect(taking.getByTestId('offer-decline')).toBeDisabled();
  await expect(taking.getByTestId('offer-offline')).toBeVisible();

  // And nothing was queued in its place: the outbox carries listings and photographs, never a
  // deal transition. This is the same claim the type-level proof makes, made against the device.
  const queued = await queuedKinds(page);
  expect(queued.length).toBeGreaterThan(0); // the listing itself is in there
  for (const kind of queued) expect(kind.startsWith('deal')).toBe(false);
  expect(queued.every((kind) => ['listing.create', 'listing.update', 'listing.renew', 'photo.upload', 'price-alert.create'].includes(kind))).toBe(true);

  // ── back on the network: the server agrees the deal and issues the slip ──────────────────
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });

  const price = Number(await taking.getByTestId('offer-price').getAttribute('data-amount'));
  await taking.getByTestId('offer-accept').click();
  await expect(taking).toHaveAttribute('data-state', 'SAUDA_SLIP', { timeout: 30_000 });

  await taking.getByTestId('offer-slip').click();
  const slip = page.getByTestId('sauda-slip');
  await expect(slip).toBeVisible();
  await expect(slip).toHaveAttribute('data-slip-no', /^SR-NAS-\d{8}-\d{4,}$/);
  await expect(slip.getByTestId('slip-price-amount')).toHaveAttribute('data-amount', String(price)); // the agreed price, frozen
  await expect(slip.getByTestId('slip-gross')).toBeVisible();
  await expect(slip.getByTestId('slip-benchmark')).toBeVisible(); // what the price can be judged against
  await expect(slip.getByTestId('slip-buyer')).toBeVisible();
  await expect(slip).not.toContainText('%');

  // The traders still bidding are told the lot has gone, rather than left holding a live offer.
  await expect(asking).toHaveAttribute('data-state', 'DECLINED', { timeout: 30_000 });
  await expect(asking.getByTestId('offer-declined')).toBeVisible();

  // The slip survives the network going away too: it is the record, not a page on a server.
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await page.getByTestId('nav-deals').click();
  await expect(taking).toHaveAttribute('data-state', 'SAUDA_SLIP');
  await taking.getByTestId('offer-slip').click();
  await expect(page.getByTestId('sauda-slip')).toBeVisible();
});
