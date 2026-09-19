/**
 * Gate I · Gate H · FR-10 · P1-02 · P1-03 · P1-04 — selling, end to end, against the real API.
 *
 * Gate I, "the ₹2500 test": an unmarked price cannot pass silently. The card asks what ₹2,500 is
 * for, "List for sale" stays disabled until it is answered, a per-kilo answer 70× today's rate is
 * flagged, and the listing reaches the server with the basis the farmer chose.
 *
 * Offline: a listing composed with no network is saved on the phone and waits, and the mic
 * becomes a recorder that says so. When the network returns the listing arrives.
 *
 * Gate H, signed in: switching language changes the actual interface (headings, questions,
 * units, the speech locales), not only speech.
 */
import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 40004');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('सुनीता पवार');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2311-05519'); // Rahuri, Ahilyanagar: each registry number binds to one account
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

test('Gate I · Gate H · selling in three languages, online and off', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-09-19T08:30:00+05:30')); // the review dates and prices are the same on every run
  await signIn(page);
  await page.getByTestId('nav-sell').click();
  await expect(page.getByTestId('sell')).toBeVisible();

  // ── Gate I: the ₹2500 test ──────────────────────────────────────────────────────────────
  await page.getByTestId('sell-text').fill('kanda 20 quintal 2500');
  await expect(page.getByTestId('confirm-crop')).toContainText('कांदा');
  await expect(page.getByTestId('confirm-quantity')).toContainText('20');
  await expect(page.getByTestId('confirm-quantity')).toContainText('क्विंटल'); // the farmer's own unit
  await expect(page.getByTestId('price-unit-question')).toContainText('2,500');
  await expect(page.getByTestId('list-for-sale')).toBeDisabled(); // it cannot pass silently
  await expect(page.getByTestId('review-blocked')).toBeVisible();

  await page.getByTestId('price-unit-kg').click();
  await expect(page.getByTestId('price-implausible')).toBeVisible(); // ₹2,500/kg is ₹2,50,000/qtl
  await page.getByTestId('price-unit-change').click();
  await page.getByTestId('price-unit-quintal').click();
  await expect(page.getByTestId('price-implausible')).toBeHidden();
  await expect(page.getByTestId('confirm-benchmark')).toBeVisible(); // the benchmark stays in view
  await expect(page.getByTestId('confirm-place')).toContainText('अहिल्यानगर'); // P1-04: the verified district
  await expect(page.getByTestId('list-for-sale')).toBeEnabled();
  await page.getByTestId('list-for-sale').click();

  await expect(page.getByTestId('listings')).toBeVisible();
  const first = page.getByTestId('listing').first();
  await expect(first.getByTestId('listing-price')).toHaveAttribute('data-unit', 'quintal');
  await expect(first.getByTestId('listing-price')).toHaveAttribute('data-amount', '2500');
  await expect(first).toHaveAttribute('data-state', 'sent', { timeout: 30_000 }); // the server has it

  // ── offline: a listing waits on the phone, the mic becomes a recorder ─────────────────────
  await context.setOffline(true);
  await page.getByTestId('nav-sell').click();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await expect(page.getByTestId('mic')).toHaveAttribute('data-mode', 'record');
  await expect(page.getByTestId('mic-offline')).toBeVisible();
  await page.getByTestId('sell-text').fill('मला ५ क्विंटल कांदा विकायचा आहे');
  await expect(page.getByTestId('confirm')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('list-for-sale').click();
  // The listing made offline is the one with no price named (the clock is fixed, so both share a time).
  const offline = page.getByTestId('listing').filter({ hasNot: page.getByTestId('listing-price') });
  await expect(offline).toHaveCount(1);
  await expect(offline).toHaveAttribute('data-state', /^(saved-here|waiting)$/);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(offline).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });

  // ── Gate H, signed in: the whole interface changes with the language ───────────────────────
  const seen: Record<string, { heading: string; question: string; mic: string | null; text: string }> = {};
  for (const [locale, label] of [['mr', 'मराठी'], ['hi', 'हिन्दी'], ['en', 'English']] as const) {
    while ((await page.locator('html').getAttribute('lang')) !== locale) await page.getByTestId('spine-language').click();
    await page.getByTestId('nav-sell').click();
    await page.getByTestId('sell-text').fill('');
    seen[locale] = {
      heading: (await page.locator('h1').first().textContent()) ?? '',
      question: (await page.getByTestId('confirm-crop').textContent()) ?? '',
      mic: await page.getByTestId('mic').getAttribute('data-lang'),
      text: (await page.locator('main').innerText()).slice(0, 2000),
    };
    await expect(page).toHaveScreenshot(`sell-${locale}.png`, { fullPage: true, mask: [page.getByTestId('strip-last-sync')], animations: 'disabled', maxDiffPixelRatio: 0.01 });
    expect(label.length).toBeGreaterThan(0);
  }
  expect(new Set(Object.values(seen).map((s) => s.heading)).size).toBe(3);
  expect(new Set(Object.values(seen).map((s) => s.question)).size).toBe(3);
  expect(Object.values(seen).map((s) => s.mic)).toEqual(['mr-IN', 'hi-IN', 'en-IN']); // speech recognition follows
  expect(seen['hi']?.text).toContain('हमने यह समझा');
  expect(seen['en']?.text).toContain("Here's what we understood");
  expect(seen['mr']?.text).toContain('आम्हाला हे समजलं');
});
