/**
 * The parse-confirm card (PROMPT §9.9-3): Phase 1's understanding card, renamed and corrected.
 * "आम्हाला हे समजलं" / "Here's what we understood", a bordered, tinted, separate surface with
 * crop · quantity (in the farmer's own unit) · price (with its basis established) · place (from
 * the verified record). Anything the parser could not resolve is an inline question, never "Not
 * detected". The price-unit question lives here: one tap, in the farmer's language (§6.2).
 */
import type { Benchmark, CropProfile, PriceUnit, QuantityUnit } from '@fasal/shared';
import { compareWithBenchmark } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { number, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import { implausible, type Answers, type Resolved } from './draft';

const QUANTITY_UNITS: QuantityUnit[] = ['quintal', 'kg', 'tonne', 'crate', 'bag'];
const PRICE_UNITS: PriceUnit[] = ['quintal', 'kg', 'lot'];

export function ConfirmCard({
  locale,
  resolved,
  answers,
  onAnswer,
  crops,
  allCrops,
  cropName,
  districtName,
  benchmark,
  marketName,
  profile,
}: {
  locale: Locale;
  resolved: Resolved;
  answers: Answers;
  onAnswer: (answers: Answers) => void;
  /** The district's crops, offered first as buttons. */
  crops: CropProfile[];
  /** Every crop the dictionary knows, for anything else. */
  allCrops: CropProfile[];
  cropName: (id: string) => string;
  districtName: string;
  benchmark: Benchmark | null;
  marketName: string;
  profile: CropProfile | null;
}) {
  const price = resolved.price;
  const flag = implausible(price, benchmark, profile);
  const comparison =
    price !== null && price.unit !== null && benchmark !== null
      ? compareWithBenchmark({ amount: price.amount, unit: price.unit }, benchmark, { ...(profile?.crateKg === undefined ? {} : { crateKg: profile.crateKg }) })
      : null;

  return (
    <section className="confirm" aria-labelledby="confirm-title" data-testid="confirm" data-ready={resolved.ready}>
      <h2 id="confirm-title" className="confirm__title">
        {t(locale, 'confirm.title')}
      </h2>
      <dl className="confirm__grid">
        <div data-testid="confirm-crop">
          <dt className="label">{t(locale, 'confirm.crop')}</dt>
          {resolved.crop !== null && answers.crop === undefined ? (
            <dd className="confirm__value">{cropName(resolved.crop)}</dd>
          ) : (
            <dd>
              <span className="confirm__question">{t(locale, 'confirm.whichCrop')}</span>
              <span className="choices" role="group" aria-label={t(locale, 'confirm.whichCrop')}>
                {crops.map((c) => (
                  <button key={c.id} type="button" className="choice" aria-pressed={resolved.crop === c.id} onClick={() => onAnswer({ ...answers, crop: c.id })} data-testid={`crop-choice-${c.id}`}>
                    {cropName(c.id)}
                  </button>
                ))}
                <select
                  name="crop-other"
                  aria-label={t(locale, 'confirm.whichCrop')}
                  value={crops.some((c) => c.id === resolved.crop) ? '' : (resolved.crop ?? '')}
                  onChange={(e) => e.target.value !== '' && onAnswer({ ...answers, crop: e.target.value })}
                >
                  <option value="">…</option>
                  {allCrops
                    .filter((c) => !crops.some((d) => d.id === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {cropName(c.id)}
                      </option>
                    ))}
                </select>
              </span>
            </dd>
          )}
        </div>

        <div data-testid="confirm-quantity">
          <dt className="label">{t(locale, 'confirm.quantity')}</dt>
          {resolved.quantity !== null && answers.quantity === undefined ? (
            <dd className="confirm__value">
              <span className="figure">{number(locale, resolved.quantity.value)}</span> {t(locale, `unit.q.${resolved.quantity.unit}`)}
            </dd>
          ) : (
            <dd className="row">
              <span className="confirm__question">{t(locale, 'confirm.howMuch')}</span>
              <input
                className="figure confirm__number"
                name="quantity-answer"
                inputMode="decimal"
                aria-label={t(locale, 'confirm.howMuch')}
                value={answers.quantity?.value ?? ''}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  onAnswer({ ...answers, quantity: { value: value > 0 ? value : 0, unit: answers.quantity?.unit ?? 'quintal' } });
                }}
              />
              <select
                name="quantity-unit"
                aria-label={t(locale, 'confirm.quantity')}
                value={answers.quantity?.unit ?? 'quintal'}
                onChange={(e) => onAnswer({ ...answers, quantity: { value: answers.quantity?.value ?? 0, unit: e.target.value as QuantityUnit } })}
              >
                {QUANTITY_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(locale, `unit.q.${u}`)}
                  </option>
                ))}
              </select>
            </dd>
          )}
        </div>

        <div data-testid="confirm-price">
          <dt className="label">{t(locale, 'confirm.price')}</dt>
          {price === null ? (
            <dd className="muted">{t(locale, 'confirm.noPrice')}</dd>
          ) : price.unit === null ? (
            <dd>
              <span className="confirm__question" data-testid="price-unit-question">
                <Tx locale={locale} k="confirm.priceFor" values={{ amount: rupees(locale, price.amount) }} />
              </span>
              <span className="choices" role="radiogroup" aria-label={t(locale, 'confirm.priceUnitNeeded')}>
                {PRICE_UNITS.map((u) => (
                  <button key={u} type="button" className="choice" role="radio" aria-checked={false} onClick={() => onAnswer({ ...answers, priceUnit: u })} data-testid={`price-unit-${u}`}>
                    {t(locale, `unit.per.${u}`)}
                  </button>
                ))}
              </span>
            </dd>
          ) : (
            <dd className="confirm__value">
              <span className="figure">{rupees(locale, price.amount)}</span> {t(locale, `unit.per.${price.unit}`)}
              {answers.priceUnit !== undefined && (
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => {
                    const { priceUnit: _changed, ...rest } = answers;
                    onAnswer(rest);
                  }}
                  data-testid="price-unit-change"
                >
                  {t(locale, 'confirm.change')}
                </button>
              )}
            </dd>
          )}
        </div>

        <div data-testid="confirm-place">
          <dt className="label">{t(locale, 'confirm.place')}</dt>
          <dd className="confirm__value">
            {districtName} <span className="muted">· {t(locale, resolved.districtSource === 'registry' ? 'confirm.fromRecord' : 'confirm.fromMessage')}</span>
          </dd>
        </div>
      </dl>

      {comparison?.ok && (
        <p className="confirm__benchmark" data-testid="confirm-benchmark">
          <Glyph name="mandi" />
          {comparison.value.position === 'at' ? (
            t(locale, 'confirm.vsBenchmark.at', { market: marketName })
          ) : (
            <Tx locale={locale} k={comparison.value.position === 'above' ? 'confirm.vsBenchmark.above' : 'confirm.vsBenchmark.below'} values={{ amount: rupees(locale, Math.round(Math.abs(comparison.value.delta.amount))), market: marketName }} />
          )}
        </p>
      )}
      {flag !== null && price !== null && price.unit !== null && (
        <p className="notice notice--caution" data-testid="price-implausible">
          <Glyph name="caution" />
          <Tx
            locale={locale}
            k="confirm.implausible"
            values={{ price: `${rupees(locale, price.amount)} ${t(locale, `unit.per.${price.unit}`)}`, perQtl: rupees(locale, Math.round(flag.perQuintal)), times: number(locale, Math.round(flag.times)) }}
          />
        </p>
      )}
    </section>
  );
}
