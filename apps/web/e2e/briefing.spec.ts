/**
 * P10 gate · FR-07 · FR-08 · RK-8 · RK-9 — "benchmark dominates; evidence panel renders nine live
 * layers" (PROMPT §9.7–§9.9).
 *
 *   The benchmark is the largest text on the home screen and sits above the fold on a 360×800
 *   phone, before anything asks the farmer to type.
 *   The evidence panel shows RK-1…RK-9, and the six server layers carry exactly the measured
 *   weights in the bundle the API is serving right now.
 *   The outlook is a band, never a single price; "Why?" takes the farmer to the evidence;
 *   "Technical details" opens for a judge.
 *   The farmer's own lot size is joined to the market on the phone: changing it recomputes the
 *   downside (RK-7) and the storage check (GR-7) with no request.
 */
import { expect, test } from '@playwright/test';

const NOW = new Date('2026-09-19T08:30:00+05:30');

test('P10 · the morning briefing', async ({ page, request }) => {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 30003');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('दत्तात्रय जाधव');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-11873');
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();

  // ── the benchmark dominates ─────────────────────────────────────────────────────────────
  const figure = page.getByTestId('benchmark').getByTestId('modal-onion');
  await expect(figure).toBeVisible();
  const box = await figure.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 9999) + (box?.height ?? 0)).toBeLessThan(800); // above the fold on a phone
  const sizes = await page.evaluate(() => {
    const visible = [...document.querySelectorAll<HTMLElement>('main *')].filter((el) => el.childNodes.length > 0 && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '') && el.offsetParent !== null);
    const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    const modal = document.querySelector('[data-testid="benchmark"] [data-testid="modal-onion"]');
    return { modal: modal === null ? 0 : size(modal), largestOther: Math.max(...visible.filter((el) => el !== modal).map(size)) };
  });
  expect(sizes.modal).toBeGreaterThan(sizes.largestOther);

  // ── the outlook is a band ──────────────────────────────────────────────────────────────
  await expect(page.getByTestId('rangebar')).toBeVisible();
  await expect(page.getByTestId('outlook-range')).toHaveText(/₹[\d,]+0 — ₹[\d,]+0/); // to the nearest ₹10

  // ── nine live layers, with the weights the API is serving ───────────────────────────────
  const served = await (await request.get('/api/bundles/onion/nashik')).json() as { raksha: { layers: Record<string, { weight: number }> } };
  for (const id of ['RK-1', 'RK-2', 'RK-3', 'RK-4', 'RK-5', 'RK-6']) {
    const row = page.getByTestId(`layer-${id}`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-weight', String(served.raksha.layers[id]?.weight));
    await expect(row).toHaveAttribute('data-stance', /^(supporting|against|neutral|silent)$/);
  }
  for (const id of ['RK-7', 'RK-8', 'RK-9']) await expect(page.getByTestId(`layer-${id}`)).toBeVisible();
  await expect(page.locator('[data-testid^="gate-GR-"]')).toHaveCount(7);

  await page.getByTestId('why').click();
  await expect(page.getByTestId('evidence')).toBeInViewport();
  await page.getByTestId('technical-toggle').click();
  await expect(page.getByTestId('technical')).toContainText('RK-6');

  // ── the farmer's lot, joined on the phone ────────────────────────────────────────────────
  const downsideBefore = await page.getByTestId('layer-RK-7').textContent();
  let requestsDuringRecompute = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/') && !r.url().includes('/api/health')) requestsDuringRecompute++;
  });
  await page.getByTestId('lot-quantity').fill('4000');
  await expect(page.getByTestId('layer-RK-7')).not.toHaveText(downsideBefore ?? '');
  await expect(page.getByTestId('gate-GR-7')).toHaveAttribute('data-status', 'fail'); // no warehouse near Pimpalgaon takes 4,000 quintals
  expect(requestsDuringRecompute).toBe(0);
});
