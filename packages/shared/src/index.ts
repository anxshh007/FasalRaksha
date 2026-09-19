/**
 * @fasal/shared — the one implementation of every Fasal Raksha domain rule.
 *
 * Imported by the PWA for on-device computation, by the API so that server responses mirror
 * the device, and by the WhatsApp / SMS / IVR channels; mirrored by the Python pipeline under
 * parity tests against golden vectors in `data/golden/`. Constitution §3: a WhatsApp reply and
 * an offline home screen must produce the identical number.
 *
 * Module map (PROMPT §VI): units · parser · benchmark · staleness · decision · matching ·
 * aggregation · dealstate · vision · bundle · constants · i18n.
 *
 * Purity is enforced by `purity.test.ts` (ARCH-01): zero runtime dependencies, no I/O, no
 * clock, no randomness, no framework imports. Anything time-dependent takes `now` as input.
 */
export {};
