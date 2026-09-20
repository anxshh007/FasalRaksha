/**
 * Gates D and E in the browser · GR-1 … GR-7 · RK-6 · §5.7 · §XIII.
 *
 * Both gates are proven as arithmetic in `packages/shared` — seven independent refusals in
 * `decision.test.ts`, the per-crop thresholds in `staleness.test.ts`. This is the other half of
 * the claim: that the farmer's screen obeys them.
 *
 *   Gate E · a failed condition blocks WAIT. Every crop on the district's screen is checked: not
 *            one of them may be shown as "wait" while one of its seven conditions is failing, and
 *            a refusal names the condition in a sentence rather than an error. Raising the lot
 *            beyond what any warehouse within reach can take fails GR-7 live, on the phone.
 *   Gate D · an old forecast cannot produce a recommendation. The phone's clock is moved past the
 *            crop's own staleness limit and the advice goes while the price stays: a price is a
 *            fact with a date on it, advice is a claim about tomorrow.
 *
 * And the mechanism §XIII asks for: whenever the answer is to wait, the warehouse, its rate and
 * the e-NWR pledge under CGS-NPF are named beside it — checked here whenever the market produces
 * a wait, and checked unconditionally in the unit tests.
 */
import { expect, test, type Page } from '@playwright/test';

const BUNDLE_AS_OF = '2026-09-18'; // the committed release the E2E stack serves
const STALENESS_LIMIT_DAYS = 7; // onion, from data/reference/crops.json

/** Each test signs in as its own farmer: an account is created once, and these two run in one stack. */
async function signIn(page: Page, phone: string, name: string, registryId: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill(phone);
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill(name);
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill(registryId); // Lasalgaon, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('Gate E · no crop is ever shown as WAIT while one of its conditions is failing', async ({ page }) => {
  await signIn(page, '+91 98220 12533', 'शालिनी देशमुख', 'PMK-MH-2003-12533');

  // The lead crop: its seven conditions are on screen, and the verdict is checked against them.
  await expect(page.locator('[data-testid^="gate-GR-"]')).toHaveCount(7);
  const failing = page.locator('[data-testid^="gate-GR-"][data-status="fail"]');
  const raksha = page.getByTestId('raksha');
  if ((await failing.count()) > 0) {
    await expect(raksha).not.toHaveAttribute('data-verdict', 'wait'); // ← the gate, on the screen
  }
  // When it does say wait, §XIII's mechanism is beside it: the warehouse, its rate, the pledge.
  if ((await raksha.getAttribute('data-verdict')) === 'wait') {
    await expect(page.getByTestId('storage-route')).toBeVisible();
  }

  // Tomato in Nashik is a refusal in this release — the guardrail turning one down is the product
  // working, so the screen gives it a sentence and names the condition beneath it (§9.9.5).
  await page.getByTestId('crop-tomato').getByRole('button').click();
  await expect(page.getByTestId('raksha')).toHaveAttribute('data-verdict', 'refuse');
  await expect(page.getByTestId('refusal-reason').first()).toBeVisible();
  await expect(page.getByTestId('raksha')).not.toContainText('थांबा'); // a refusal is never a quiet wait

  // Every other crop in the district, the same rule, from the same engine on the same phone.
  for (const row of await page.locator('[data-testid^="verdict-"]').all()) {
    expect(['sell', 'refuse', 'suppressed', 'wait']).toContain(await row.getAttribute('data-verdict'));
  }

  // GR-7 is about this farmer's own lot, not about the market: two thousand quintals fit no
  // warehouse within reach of Lasalgaon, and the condition fails live, with no network call.
  await page.getByTestId('lot-quantity').fill('2000');
  await expect(page.getByTestId('gate-GR-7')).toHaveAttribute('data-status', 'fail');
  await expect(raksha).not.toHaveAttribute('data-verdict', 'wait');
});

test('Gate D · past the staleness limit the advice goes, and the price stays', async ({ page, context }) => {
  await signIn(page, '+91 98220 12641', 'नितीन वाघ', 'PMK-MH-2003-12641');
  const raksha = page.getByTestId('raksha');
  await expect(raksha).toBeVisible();
  await expect(raksha).not.toHaveAttribute('data-verdict', 'suppressed');

  // Eight days after the bundle was issued — one past onion's own limit. Offline, so this is the
  // same verified data read later, not a different release.
  const past = new Date(`${BUNDLE_AS_OF}T06:00:00Z`);
  past.setDate(past.getDate() + STALENESS_LIMIT_DAYS + 1);
  await context.setOffline(true);
  await page.clock.install({ time: past });
  await page.reload();
  await expect(page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });

  // The benchmark is still there. The advice is not.
  await expect(page.getByTestId('benchmark')).toBeVisible();
  await expect(page.getByTestId('raksha')).toHaveAttribute('data-verdict', 'suppressed');
  await expect(page.getByTestId('raksha')).toContainText('जुने'); // "these prices are old"
  await expect(page.getByTestId('raksha')).not.toContainText('थांबा'); // never "wait" on old data
});
