#!/usr/bin/env node
/**
 * `node tools/screenshots.mjs` — the screenshots in the README, taken from the running app.
 *
 * Start the prototype first (`pnpm demo`), then run this. It signs in as a demonstration farmer,
 * walks the screens the README shows, and writes them to `docs/screens/`. Nothing is composed,
 * retouched or mocked up: every image is a real page of the running product, which is the only
 * kind of screenshot worth putting in front of a judge.
 *
 *   --url      where the app is (default http://127.0.0.1:4173)
 *   --id       the demonstration registry record to sign in with. A record belongs to one
 *              account, so a rerun against the same database needs one nobody has claimed.
 *   --phone    the number to sign in with; any unused one works, the code is shown on screen
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Playwright comes with the web workspace; this script is run from anywhere in the repo.
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};

const URL = arg('url', 'http://127.0.0.1:4173');
const REGISTRY_ID = arg('id', 'PMK-MH-2003-11562'); // Lasalgaon, Nashik — the onion market
const PHONE = arg('phone', `+91 98220 ${String(Math.floor(Math.random() * 89999) + 10000)}`);
const OUT = resolve(import.meta.dirname, '..', 'docs', 'screens');
const PHONE_VIEWPORT = { width: 390, height: 844 }; // §9.10's second priority size
const WIDE_VIEWPORT = { width: 1280, height: 900 };

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env['E2E_BROWSER_CHANNEL'] ?? 'msedge' });
const context = await browser.newContext({ viewport: PHONE_VIEWPORT, deviceScaleFactor: 2 });
const page = await context.newPage();
const shots = [];

async function shot(name, options = {}) {
  await page.waitForTimeout(400); // let the last render settle
  await page.screenshot({ path: resolve(OUT, `${name}.png`), animations: 'disabled', ...options });
  shots.push(name);
  process.stdout.write(`  ${name}.png\n`);
}

try {
  // ── sign in as a demonstration farmer ────────────────────────────────────────────────────
  await page.goto(URL);
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await shot('01-landing');

  await page.locator('input[name="phone"]').fill(PHONE);
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  // A number that has signed in before is asked for no name: the account already has one.
  const name = page.locator('input[name="name"]');
  if (await name.count()) await name.fill('सुनील भोसले');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.getByTestId('registry-samples').waitFor({ timeout: 30_000 });
  await shot('02-verify');

  await page.locator('input[name="pmkisan"]').fill(REGISTRY_ID);
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await page.getByTestId('briefing').waitFor({ timeout: 30_000 }).catch(() => {
    throw new Error(`${REGISTRY_ID} did not verify — most likely another account on this database already holds it. Pass --id with a record nobody has claimed.`);
  });

  // ── the morning briefing ─────────────────────────────────────────────────────────────────
  await shot('03-briefing');
  await page.getByTestId('why').click();
  await page.getByTestId('evidence').waitFor();
  await page.getByTestId('evidence').scrollIntoViewIfNeeded();
  await shot('04-evidence');

  // ── selling, and the price-unit question ─────────────────────────────────────────────────
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill('मला ५ क्विंटल कांदा विकायचा आहे २५०० ला');
  await page.getByTestId('price-unit-question').waitFor({ timeout: 15_000 });
  await shot('05-price-unit');
  await page.getByTestId('price-unit-quintal').click();
  await shot('06-confirm');
  await page.getByTestId('list-for-sale').click();
  await page.getByTestId('listing').first().waitFor({ timeout: 30_000 });

  // ── the buyers, ranked by what reaches the farmer ────────────────────────────────────────
  await page.getByTestId('listing').first().getByTestId('listing-buyers').click();
  await page.getByTestId('shortlist').waitFor({ timeout: 30_000 });
  await shot('07-buyers');

  // ── an offer, taken, and the sauda slip it becomes ───────────────────────────────────────
  await page.getByTestId('nav-deals').click();
  const offer = page.getByTestId('offer').first();
  await offer.waitFor({ timeout: 30_000 });
  await shot('08-offers');
  const dealId = await offer.getAttribute('data-deal');
  const deal = page.locator(`[data-testid="offer"][data-deal="${dealId}"]`);
  await deal.getByTestId('offer-accept').click();
  await deal.getByTestId('offer-slip').waitFor({ timeout: 30_000 });
  await deal.getByTestId('offer-slip').click();
  await page.getByTestId('sauda-slip').waitFor();
  await page.getByTestId('sauda-slip').scrollIntoViewIfNeeded();
  await shot('09-sauda-slip', { clip: await page.getByTestId('sauda-slip').boundingBox() });

  // ── the network gone: the same numbers, computed on the phone ────────────────────────────
  await context.setOffline(true);
  await page.reload();
  await page.getByTestId('field-strip').waitFor({ timeout: 30_000 });
  await page.getByTestId('nav-home').click();
  await page.getByTestId('benchmark').waitFor();
  await shot('10-offline');
  await context.setOffline(false);

  // ── the bright theme, for standing in the sun ────────────────────────────────────────────
  await page.reload();
  await page.getByTestId('nav-home').click(); // a reload lands where the farmer was standing
  await page.getByTestId('briefing').waitFor({ timeout: 30_000 });
  await page.getByTestId('spine-theme').click();
  await shot('11-field-theme');
  await page.getByTestId('spine-theme').click();

  // ── the diagnostics, on a wide screen ────────────────────────────────────────────────────
  await page.setViewportSize(WIDE_VIEWPORT);
  await page.goto(`${URL}/#/_judge`);
  await page.getByTestId('judge-validation').waitFor({ timeout: 30_000 });
  await shot('12-judge', { fullPage: false });
} finally {
  await browser.close();
}

process.stdout.write(`\n${shots.length} screenshots written to docs/screens\n`);
