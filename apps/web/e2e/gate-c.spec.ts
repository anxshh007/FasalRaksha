/**
 * Gate C · FR-10 · FR-11 · CAM-01 … CAM-14 — the fourteen failure paths, walked in a real browser against the
 * real API, with the real grader (ONNX Runtime Web) and the real upload pipeline.
 *
 * The camera is a script, not hardware: `getUserMedia` returns a canvas stream playing the
 * rendered scenes in data/fixtures/camera (a lot of onions, a dark shed, a wall, a face…), and can
 * be told to refuse the way a real phone refuses: denied, dismissed, busy, over-constrained, no
 * camera, or out of memory. Everything downstream of `getUserMedia` is the production code.
 */
import { expect, test, type Page } from '@playwright/test';

import { allStopped, calls, fakeCamera, photoFile, scene, set } from './support/camera';


async function signIn(page: Page, phone: string, pmkisan: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'गडदच ठेवा' }).click();
  await page.locator('input[name="phone"]').fill(phone);
  await page.getByRole('button', { name: 'कोड पाठवा' }).click();
  const code = await page.getByTestId('dev-code').getAttribute('data-code');
  await page.locator('input[name="code"]').fill(code ?? '');
  await page.locator('input[name="name"]').fill('प्रकाश गायकवाड');
  await page.getByRole('button', { name: 'पुढे' }).click();
  await page.locator('input[name="pmkisan"]').fill(pmkisan);
  await page.getByRole('button', { name: 'नोंद तपासा' }).click();
  await expect(page.getByTestId('briefing')).toBeVisible();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'live');
}

async function openCamera(page: Page, said = 'kanda 20 quintal') {
  await page.getByTestId('nav-sell').click();
  await page.getByTestId('sell-text').fill(said);
  await page.getByTestId('photo-add').click();
  await expect(page.getByTestId('camera')).toBeVisible();
}

async function closeCamera(page: Page) {
  await page.getByTestId('camera-close').click();
  await expect(page.getByTestId('camera')).toBeHidden();
}


test('Gate C · the whole pipeline: guidance, the gate, five views, a proposal, the farmer decides, the photo arrives', async ({ page }) => {
  test.setTimeout(300_000); // the longest walk in the suite: two listings, two captures, a retake
  await fakeCamera(page);
  await signIn(page, '+91 98220 50005', 'PMK-MH-2106-08872'); // Narayangaon, Pune
  await set(page, { scene: 'onion-dark' });
  await openCamera(page);

  // CAM-06: the attributes iOS Safari needs, on a stream opened from the farmer's tap.
  const video = page.getByTestId('viewfinder');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('muted', '');
  await expect(video).toHaveAttribute('autoplay', '');

  // §7.1: one message at a time, in the farmer's words, and no shutter until it is right.
  const guidance = page.getByTestId('guidance');
  const shutter = page.getByTestId('shutter');
  await expect(guidance).toHaveAttribute('data-problem', 'too-dark');
  await expect(guidance).toContainText('खूप अंधार');
  await expect(shutter).toBeDisabled();
  await set(page, { scene: 'onion-far' });
  await expect(guidance).toHaveAttribute('data-problem', 'move-closer');
  await set(page, { scene: 'wall' });
  await expect(guidance).toHaveAttribute('data-problem', 'no-crop');
  await expect(shutter).toBeDisabled();
  await set(page, { scene: 'onion-lot', shake: true });
  await expect(guidance).toHaveAttribute('data-problem', 'hold-steady');
  await expect(shutter).toBeDisabled();
  await set(page, { shake: false });
  await expect(guidance).toHaveAttribute('data-problem', 'ready');
  await expect(shutter).toBeEnabled();
  await expect(page.getByTestId('camera')).not.toContainText('%'); // never "Image Quality 82%"
  await expect(page.getByTestId('grader-absent')).toHaveCount(0); // the grader loaded

  // §7.4: one press, five views, a grade and a band; §7.5: the farmer confirms.
  await shutter.click();
  const review = page.getByTestId('camera-review');
  await expect(review).toHaveAttribute('data-outcome', 'proposed', { timeout: 30_000 });
  const proposal = page.getByTestId('proposal');
  await expect(proposal).toHaveAttribute('data-grade', /^[ABC]$/);
  await expect(proposal).toHaveAttribute('data-band', /^(high|moderate|low)$/);
  expect(Number(await proposal.getAttribute('data-views'))).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('camera-still')).toBeVisible();
  await expect(review).not.toContainText('%');
  expect(await allStopped(page)).toBe(true); // the light is off while the farmer decides
  const grade = await proposal.getAttribute('data-grade');
  await page.getByTestId('grade-confirm').click();

  await expect(page.getByTestId('photo-panel')).toHaveAttribute('data-attached', 'true');
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-provenance', 'farmer-declared-ai-assisted');
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-grade', grade ?? '');
  await page.getByTestId('list-for-sale').click();

  // The listing carries the farmer's grade and how it was reached; the photo follows it (CAM-13).
  const listing = page.getByTestId('listing').first();
  await expect(listing.getByTestId('listing-grade')).toHaveAttribute('data-provenance', 'farmer-declared-ai-assisted');
  await expect(listing).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });
  await expect(listing.getByTestId('listing-photo')).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });

  // CHANGE: the farmer overrides the proposal; the grade is theirs alone.
  await openCamera(page, 'kanda 5 quintal');
  await expect(page.getByTestId('guidance')).toHaveAttribute('data-problem', 'ready');
  await page.getByTestId('shutter').click();
  await expect(page.getByTestId('proposal')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('grade-change').click();
  await page.getByTestId('grade-option-A').click();
  await page.getByTestId('grade-use').click();
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-provenance', 'farmer-declared');
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-grade', 'A');

  // CAM-06: backgrounded, the camera is let go; back in front, it is taken again.
  await page.getByTestId('photo-retake').click();
  await expect(page.getByTestId('guidance')).toBeVisible();
  const before = await calls(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => allStopped(page)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => calls(page)).toBe(before + 1);
  await expect(page.getByTestId('guidance')).toBeVisible();

  // Every way out turns the camera off: the back button here.
  await page.goBack();
  await expect(page.getByTestId('camera')).toBeHidden();
  await expect(page.getByTestId('sell')).toBeVisible();
  await expect.poll(() => allStopped(page)).toBe(true);
});

test('Gate C · CAM-01 … CAM-05: no camera, denied, dismissed, busy, and the constraint ladder', async ({ page }) => {
  await fakeCamera(page);
  await signIn(page, '+91 98220 60006', 'PMK-MH-2211-07314'); // Ausa, Latur

  // CAM-02: denied. Say why the camera was wanted, offer the file input, never ask in a loop.
  await set(page, { errors: [{ name: 'NotAllowedError', message: 'Permission denied' }], permission: 'denied' });
  await openCamera(page);
  const failure = page.getByTestId('camera-failure');
  await expect(failure).toHaveAttribute('data-failure', 'denied');
  await expect(failure).toContainText('फक्त खरेदीदारांसाठी'); // "only to photograph your crop for buyers"
  await expect(page.getByTestId('camera-ask-again')).toHaveCount(0);
  const denied = await calls(page);
  await page.waitForTimeout(1500);
  expect(await calls(page)).toBe(denied); // no re-prompt loop
  // …and the file input takes the identical pipeline downstream.
  await page.getByTestId('camera-file').setInputFiles(photoFile('onion-lot'));
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'proposed', { timeout: 30_000 });
  await closeCamera(page);

  // CAM-03: dismissed is not denied: different words, and one more try, once.
  await set(page, { errors: [{ name: 'NotAllowedError', message: 'Permission dismissed' }, { name: 'NotAllowedError', message: 'Permission dismissed' }], permission: 'prompt' });
  await page.getByTestId('photo-add').click();
  await expect(failure).toHaveAttribute('data-failure', 'dismissed');
  await expect(failure).toContainText('उत्तर न देता');
  await page.getByTestId('camera-ask-again').click();
  await expect(failure).toHaveAttribute('data-failure', 'dismissed');
  await expect(page.getByTestId('camera-ask-again')).toHaveCount(0); // a single retry
  await closeCamera(page);

  // CAM-04: busy. Named, with a retry that works once the other app lets go.
  await set(page, { errors: [{ name: 'NotReadableError', message: 'Could not start video source' }], permission: 'granted' });
  await page.getByTestId('photo-add').click();
  await expect(failure).toHaveAttribute('data-failure', 'busy');
  await expect(failure).toContainText('दुसरे ॲप');
  await page.getByTestId('camera-retry').click();
  await expect(page.getByTestId('guidance')).toBeVisible();
  await closeCamera(page);

  // CAM-05: the ladder. Rear camera at 1920 refused, rear camera refused, any camera accepted.
  await page.evaluate(() => (window.__camera.calls = []));
  await set(page, { errors: [{ name: 'OverconstrainedError', message: 'width' }, { name: 'OverconstrainedError', message: 'facingMode' }] });
  await page.getByTestId('photo-add').click();
  await expect(page.getByTestId('guidance')).toBeVisible();
  expect(await page.evaluate(() => window.__camera.calls)).toEqual([
    { audio: false, video: { facingMode: 'environment', width: 1920 } },
    { audio: false, video: { facingMode: 'environment' } },
    { audio: false, video: true },
  ]);
  await closeCamera(page);

  // CAM-01: no camera at all. The file input, and the same pipeline.
  await set(page, { errors: [{ name: 'NotFoundError', message: 'Requested device not found' }] });
  await page.getByTestId('photo-add').click();
  await expect(failure).toHaveAttribute('data-failure', 'no-camera');
  await page.getByTestId('camera-file').setInputFiles(photoFile('onion-lot'));
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'proposed', { timeout: 30_000 });
  await page.getByTestId('grade-skip').click();
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-grade', '');
});

test('Gate C · CAM-07, CAM-10, CAM-11, CAM-14: what a chosen file can be, and what it becomes', async ({ page }) => {
  await fakeCamera(page);
  await signIn(page, '+91 98220 70007', 'PMK-MH-1911-04420'); // Raver, Jalgaon
  await openCamera(page);
  await expect(page.getByTestId('guidance')).toBeVisible();
  const file = page.getByTestId('camera-file');

  // CAM-07: HEIC by its bytes (named .jpg, typed image/jpeg): refused plainly, never uploaded.
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(64, 1)]);
  await file.setInputFiles({ name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: heic });
  await expect(page.getByTestId('file-error')).toHaveAttribute('data-reason', 'heic');
  await expect(page.getByTestId('file-error')).toContainText('HEIC');
  // …and a file that is not a photograph at all.
  await file.setInputFiles({ name: 'crop.png', mimeType: 'image/png', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') });
  await expect(page.getByTestId('file-error')).toHaveAttribute('data-reason', 'not-a-photo');

  // CAM-10: every view fails the gate: no grade, the best frame kept, and what was wrong.
  await file.setInputFiles(photoFile('onion-dark'));
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'no-usable-view', { timeout: 30_000 });
  await expect(page.getByTestId('outcome-no-usable')).toHaveAttribute('data-problem', 'too-dark');
  await expect(page.getByTestId('outcome-no-usable')).toContainText('अंधार');
  await expect(page.getByTestId('camera-still')).toBeVisible();
  await expect(page.getByTestId('proposal')).toHaveCount(0);

  // CAM-11: not the crop. A distinct path from low confidence: different words, no band, no photo.
  for (const other of ['wall', 'face', 'shoe']) {
    await file.setInputFiles(photoFile(other));
    await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'out-of-distribution', { timeout: 30_000 });
    await expect(page.getByTestId('outcome-ood')).toContainText('माल पुरेसा दिसत नाही');
    await expect(page.getByTestId('proposal-band')).toHaveCount(0);
    await expect(page.getByTestId('camera-still')).toHaveCount(0);
  }

  // CAM-14: a phone's photo, stored sideways with orientation 6 and GPS. Upright, and no EXIF left.
  await file.setInputFiles(photoFile('onion-lot-exif-gps'));
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'proposed', { timeout: 30_000 });
  await page.getByTestId('grade-confirm').click();
  await page.getByTestId('list-for-sale').click();
  await expect(page.getByTestId('listing').first().getByTestId('listing-photo')).toBeVisible();
  const prepared = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('fasal-raksha');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const photos = await new Promise<{ blob: Blob }[]>((resolve) => {
      const request = db.transaction('photos').objectStore('photos').getAll();
      request.onsuccess = () => resolve(request.result as { blob: Blob }[]);
    });
    const blob = photos[0]!.blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = Array.from(bytes.subarray(0, 4096), (b) => String.fromCharCode(b)).join('');
    const bitmap = await createImageBitmap(blob);
    return { type: blob.type, exif: text.includes('Exif'), width: bitmap.width, height: bitmap.height, jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 };
  });
  expect(prepared).toEqual({ type: 'image/jpeg', exif: false, width: 640, height: 480, jpeg: true });
  await expect(page.getByTestId('listing').first().getByTestId('listing-photo')).toHaveAttribute('data-state', 'sent', { timeout: 30_000 });
});

test('Gate C · CAM-08, CAM-09: short of memory, and no grader: photographs still work', async ({ page }) => {
  await fakeCamera(page);
  await signIn(page, '+91 98220 80008', 'PMK-MH-2505-03318'); // Katol, Nagpur

  // CAM-08: the burst cannot allocate: one frame instead…
  await openCamera(page);
  await expect(page.getByTestId('guidance')).toHaveAttribute('data-problem', 'ready');
  await set(page, { failResize: 1 });
  await page.getByTestId('shutter').click();
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-degraded', 'single-frame', { timeout: 30_000 });
  await expect(page.getByTestId('proposal')).toHaveAttribute('data-views', '1');
  await expect(page.getByTestId('proposal')).not.toHaveAttribute('data-band', 'high');
  // …and when even one frame cannot be allocated, a plain photograph, and it says why there is no grade.
  await page.getByTestId('camera-retake').click();
  await expect(page.getByTestId('guidance')).toHaveAttribute('data-problem', 'ready');
  await set(page, { failResize: 99 });
  await page.getByTestId('shutter').click();
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-degraded', 'photo-only', { timeout: 30_000 });
  await expect(page.getByTestId('ungraded-why')).toContainText('मेमरी');
  await expect(page.getByTestId('camera-still')).toBeVisible();
  await set(page, { failResize: 0 });
  await closeCamera(page);

  // CAM-09: the grading runtime cannot be fetched (a clean profile, so nothing is cached yet).
  await page.context().route('**/ort/*.wasm', (route) => route.abort('failed'));
  await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.deleteDatabase('fasal-vision'); r.onsuccess = r.onerror = r.onblocked = () => resolve(null); }));
  await page.getByTestId('photo-add').click();
  const absent = page.getByTestId('grader-absent');
  await expect(absent).toHaveAttribute('data-reason', 'network');
  await expect(absent).toContainText('फोटो तरीही सोबत जाईल'); // one honest line: the photo still goes
  await expect(page.getByTestId('guidance')).toHaveAttribute('data-problem', 'ready');
  await page.getByTestId('shutter').click();
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'ungraded', { timeout: 30_000 });
  await expect(page.getByTestId('camera-still')).toBeVisible();
  await closeCamera(page);

  // CAM-09: the bytes arrive but are not the pinned runtime: never run.
  await page.context().unroute('**/ort/*.wasm');
  await page.context().route('**/ort/*.wasm', (route) => route.fulfill({ status: 200, contentType: 'application/wasm', body: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) }));
  await page.getByTestId('photo-add').click();
  await expect(page.getByTestId('grader-absent')).toHaveAttribute('data-reason', 'integrity');
  await expect(page.getByTestId('guidance')).toHaveAttribute('data-problem', 'ready');
  await page.getByTestId('shutter').click();
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'ungraded', { timeout: 30_000 });
  await page.getByTestId('grade-option-B').click();
  await page.getByTestId('grade-use').click();
  await expect(page.getByTestId('photo-grade')).toHaveAttribute('data-provenance', 'farmer-declared'); // the farmer's own grade
  await page.context().unroute('**/ort/*.wasm');
});

test('Gate C · CAM-12, CAM-13: offline at capture, then a failing upload that retries and arrives once', async ({ page, context }) => {
  await fakeCamera(page);
  await signIn(page, '+91 98220 90009', 'PMK-MH-2211-07588'); // Nilanga, Latur

  // CAM-12: no network at all. The camera works, the listing is saved at once, the photo waits.
  await context.setOffline(true);
  await page.getByTestId('nav-sell').click();
  await expect(page.getByTestId('field-strip')).toHaveAttribute('data-state', 'field', { timeout: 30_000 });
  await page.getByTestId('sell-text').fill('soybean 12 quintal');
  await page.getByTestId('photo-add').click();
  await expect(page.getByTestId('guidance')).toBeVisible();
  await expect(page.getByTestId('grader-absent')).toHaveAttribute('data-reason', 'network', { timeout: 30_000 }); // nothing can download offline
  // A lot of grain, from the gallery: photographed, not graded, and moisture is never claimed.
  await page.getByTestId('camera-file').setInputFiles(photoFile('wheat-lot'));
  await expect(page.getByTestId('camera-review')).toHaveAttribute('data-outcome', 'ungraded', { timeout: 30_000 });
  await expect(page.getByTestId('camera-review')).toContainText('ओलावा मीटरने किंवा प्रयोगशाळेतच मोजता येतो');
  await page.getByTestId('photo-use').click();
  await page.getByTestId('list-for-sale').click();
  const listing = page.getByTestId('listing').first();
  await expect(listing).toHaveAttribute('data-state', /^(saved-here|waiting)$/);
  await expect(listing.getByTestId('listing-photo')).toHaveAttribute('data-state', /^(saved-here|waiting)$/);

  // CAM-13: the network returns, but the first two pieces of the photo fail on the server.
  let failures = 0;
  await context.route('**/api/photos/uploads/*', async (route) => {
    if (route.request().method() === 'PUT' && failures < 2) {
      failures++;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"SERVER_FAULT","message":"try later"}}' });
      return;
    }
    await route.continue();
  });
  await context.setOffline(false);
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    return listing.getAttribute('data-state');
  }, { timeout: 60_000, intervals: [2000] }).toBe('sent');
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    return listing.getByTestId('listing-photo').getAttribute('data-state');
  }, { timeout: 90_000, intervals: [2500] }).toBe('sent');
  expect(failures).toBe(2);
  await context.unroute('**/api/photos/uploads/*');
});
