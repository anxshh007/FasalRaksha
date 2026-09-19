/**
 * P9 gate · P1-12 · §9.10 — the performance budget, measured and printed:
 *
 *   JS < 200 KB gzipped (the ONNX runtime, lazy and camera-only, arrives in P12 and is excluded)
 *   FCP from cache < 1.5 s on a throttled phone (4× CPU slowdown, 2G network)
 *   fonts self-hosted: no request leaves this origin
 *   zero blocking network requests to render: with the network gone, the page still paints
 *
 * Measured with Playwright and Chrome DevTools Protocol throttling in the installed Edge, not
 * with the Lighthouse CLI (CUTS C-05): the same four numbers, from the same engine, without a
 * second browser-automation stack in the repository.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

const DIST = resolve(import.meta.dirname, '../dist');

function sizes() {
  const assets = readdirSync(join(DIST, 'assets'));
  const sum = (filter: (f: string) => boolean, gzip: boolean) =>
    assets.filter(filter).reduce((n, f) => n + (gzip ? gzipSync(readFileSync(join(DIST, 'assets', f)), { level: 9 }).length : readFileSync(join(DIST, 'assets', f)).length), 0);
  return {
    jsGzip: sum((f) => f.endsWith('.js'), true),
    cssGzip: sum((f) => f.endsWith('.css'), true),
    fonts: sum((f) => f.endsWith('.woff2'), false),
    fontFiles: assets.filter((f) => f.endsWith('.woff2')).length,
  };
}

test('P9 · performance budget (§9.10)', async ({ page, context }) => {
  const size = sizes();
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4179/')) external.push(request.url());
  });

  // First visit installs the service worker; the second is controlled by it.
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // An entry-level phone on 2G: 4× CPU slowdown, ~250 kbit/s down, 400 ms latency.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 31_250, uploadThroughput: 31_250 });

  const fcp = async () => {
    await page.reload({ waitUntil: 'load' });
    return page.evaluate(
      () =>
        new Promise<number>((done) => {
          const read = () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
          const now = read();
          if (now !== undefined) return done(now);
          new PerformanceObserver(() => {
            const later = read();
            if (later !== undefined) done(later);
          }).observe({ type: 'paint', buffered: true });
        }),
    );
  };
  const runs = [await fcp(), await fcp(), await fcp()].sort((a, b) => a - b);
  const median = runs[1] ?? Infinity;

  // With no network at all the page still paints: nothing on the render path is a request.
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const offlineFcp = await fcp();
  await expect(page.getByTestId('screen')).toBeVisible();

  console.log(
    [
      'PERFORMANCE BUDGET (§9.10) — installed Edge, CDP throttling: 4× CPU, 2G network',
      `  JS (gzip)                ${(size.jsGzip / 1024).toFixed(1).padStart(7)} KB   budget < 200 KB   ${size.jsGzip < 200 * 1024 ? 'PASS' : 'FAIL'}`,
      `  CSS (gzip)               ${(size.cssGzip / 1024).toFixed(1).padStart(7)} KB`,
      `  fonts (woff2, ${size.fontFiles} files)   ${(size.fonts / 1024).toFixed(1).padStart(7)} KB   self-hosted, precached`,
      `  FCP from cache (median)  ${median.toFixed(0).padStart(7)} ms   budget < 1500 ms  ${median < 1500 ? 'PASS' : 'FAIL'}   runs ${runs.map((r) => r.toFixed(0)).join(' / ')} ms`,
      `  FCP with no network      ${offlineFcp.toFixed(0).padStart(7)} ms   renders: ${offlineFcp > 0 ? 'yes' : 'no'}`,
      `  requests to other origins ${String(external.length).padStart(6)}      budget 0          ${external.length === 0 ? 'PASS' : 'FAIL'}`,
    ].join('\n'),
  );

  expect(size.jsGzip).toBeLessThan(200 * 1024);
  expect(median).toBeLessThan(1500);
  expect(offlineFcp).toBeGreaterThan(0);
  expect(external).toEqual([]);
});
