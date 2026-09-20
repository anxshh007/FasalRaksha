/**
 * §9.10 — the phone is the design origin, not the collapse target.
 *
 * Every screen is measured at 360×800, the smallest size the specification names, and the two
 * things that actually break a product held in one hand outdoors are asserted rather than
 * reviewed: nothing makes the page scroll sideways, and nothing a finger has to hit is smaller
 * than 44×44.
 *
 * The screens are visited in their *loaded* states, not their empty ones — a lot with a
 * photograph on it, offers on that lot, a sauda slip open, the complaint form open, the
 * consignment panel, and Judge Mode with its tables of figures — because an empty screen fits on
 * anything. `design.spec.ts` covers what they look like; this covers whether they fit.
 */
import { expect, test, type Page } from '@playwright/test';

const PHONE = { width: 360, height: 800 }; // §9.10's design origin

interface Probe {
  overflowPx: number;
  wide: string[];
  small: string[];
}

/** What a phone would suffer: sideways scroll, and targets a thumb cannot hit. */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const describe = (el: Element) => {
      const box = el.getBoundingClientRect();
      const id = el.getAttribute('data-testid') ?? (typeof el.className === 'string' ? el.className.split(' ')[0] : '') ?? '';
      return `${el.tagName.toLowerCase()}[${id}] ${Math.round(box.width)}×${Math.round(box.height)}`;
    };
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    /** Wider than the phone is fine inside a box that scrolls; it is not fine on the page. */
    const insideScroller = (el: Element) => {
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return node.getBoundingClientRect().width <= width + 1;
      }
      return false;
    };
    return {
      overflowPx: doc.scrollWidth - width,
      wide: [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().width > width + 1 && !insideScroller(el))
        .map(describe)
        .slice(0, 8),
      small: [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')]
        .filter((el) => {
          if (!visible(el)) return false;
          const box = el.getBoundingClientRect();
          if (box.height >= 44 && box.width >= 44) return false;
          // A control inside its own label is hit by the whole label: measure that instead.
          const label = el.closest('label');
          if (label !== null) {
            const row = label.getBoundingClientRect();
            if (row.height >= 44 && row.width >= 44) return false;
          }
          return true;
        })
        .map(describe)
        .slice(0, 8),
    };
  });
}

async function fits(page: Page, where: string) {
  const result = await probe(page);
  expect(result.wide, `${where}: nothing may be wider than the phone`).toEqual([]);
  expect(result.overflowPx, `${where}: no horizontal page scroll`).toBeLessThanOrEqual(0);
  expect(result.small, `${where}: every target is at least 44×44`).toEqual([]);
}

test('§9.10 · every screen fits a 360px phone, in both themes, loaded rather than empty', async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.setViewportSize(PHONE);

  // ── the screens before a session ─────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'मराठी' })).toBeVisible();
  await fits(page, 'landing');

  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill('+91 98220 13306');
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await fits(page, 'sign-in, one-time code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('कविता पाटील');
  await page.getByRole('button', { name: 'पुढे' }).click();

  // The verification screen carries the demonstration registry's twenty-odd names.
  await expect(page.getByTestId('registry-samples')).toBeVisible({ timeout: 30_000 });
  await fits(page, 'verify, with the demonstration registry');
  await page.locator('input[name="pmkisan"]').fill('PMK-MH-2003-13215'); // Niphad, Nashik
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();

  // ── home, with everything on it ──────────────────────────────────────────────────────────
  await expect(page.getByTestId('briefing')).toBeVisible({ timeout: 30_000 });
  await fits(page, 'home');
  await page.getByTestId('why').click();
  await expect(page.getByTestId('evidence')).toBeVisible();
  await page.getByTestId('technical-toggle').click();
  await fits(page, 'home, evidence panel open with the technical detail');

  // ── selling: the parse-confirm card, the price-unit question, the lot ────────────────────
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('kanda 5 quintal 2500');
  await expect(page.getByTestId('price-unit-question')).toBeVisible();
  await fits(page, 'sell, parse confirmation with the price-unit question');
  await page.getByTestId('price-unit-quintal').click();
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first()).toHaveAttribute('data-state', 'sent', { timeout: 60_000 });

  // ── the shortlist ────────────────────────────────────────────────────────────────────────
  await page.getByTestId('listing').first().getByTestId('listing-buyers').click();
  await expect(page.getByTestId('shortlist')).toBeVisible({ timeout: 30_000 });
  await fits(page, 'buyers, ranked shortlist');

  // ── my deals: offers, the slip, the progress, the complaint form ─────────────────────────
  await page.getByTestId('nav-deals').click();
  const offers = page.getByTestId('offer');
  await expect(offers.first()).toBeVisible({ timeout: 30_000 });
  await fits(page, 'my deals, with offers');

  const dealId = (await offers.first().getAttribute('data-deal')) ?? '';
  const deal = page.locator(`[data-testid="offer"][data-deal="${dealId}"]`);
  await deal.getByTestId('offer-counter').click();
  await fits(page, 'my deals, naming a different price');
  await deal.getByTestId('offer-accept').click();
  await expect(deal).toHaveAttribute('data-state', 'SAUDA_SLIP', { timeout: 30_000 });
  await deal.getByTestId('offer-slip').click();
  await expect(page.getByTestId('sauda-slip')).toBeVisible();
  await fits(page, 'my deals, sauda slip open');

  await deal.getByTestId('deal-progress').getByTestId('delivery-confirm').click();
  await expect(deal).toHaveAttribute('data-state', 'DELIVERY_CONFIRMED', { timeout: 30_000 });
  await fits(page, 'my deals, delivery confirmed and payment asked for');
  await deal.getByTestId('dispute-open').click();
  await expect(deal.getByTestId('dispute-note')).toBeVisible();
  await fits(page, 'my deals, the complaint form with its five reasons');

  // ── Judge Mode: wide tables of figures, which must scroll in their own box ───────────────
  await page.goto('/#/_judge');
  await expect(page.getByTestId('judge')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('judge-validation')).toBeVisible();
  await fits(page, 'Judge Mode');

  // ── and the whole of it again in FIELD, the theme for standing in the sun ────────────────
  await page.goto('/');
  await page.getByTestId('spine-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'field');
  await fits(page, 'home · FIELD');
  await page.getByTestId('nav-deals').click();
  await expect(page.getByTestId('offer').first()).toBeVisible({ timeout: 30_000 });
  await fits(page, 'my deals · FIELD');

  // ── offline, where the field-mode strip and the notices come in ──────────────────────────
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await fits(page, 'my deals · offline');
  await page.getByTestId('nav-home').click();
  await expect(page.getByTestId('benchmark')).toBeVisible();
  await fits(page, 'home · offline');
});
