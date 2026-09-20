/**
 * The farmer's own lot (RK-7's inputs, PROMPT §5.5). Lot size feeds the downside rule and the
 * storage fit; it is remembered on this phone and never leaves it (Constitution §4). The nearest
 * suitable warehouse is named, with how the distance was measured, so "within reach" (GR-7) is
 * never a hidden assumption.
 *
 * When the advice is to wait, the mechanism comes with it (§XIII): the warehouse, what it charges,
 * and — where the warehouse issues one — the e-NWR receipt that can be pledged for a loan under
 * the central CGS-NPF guarantee, with the rate that pledge actually carries. Advice to wait given
 * to a farmer who cannot afford to wait is not advice.
 */
import type { FarmerLocation, StorageChoice } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { number, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';

export function LotControl({
  locale,
  quantity,
  onQuantity,
  price,
  storage,
  location,
  marketName,
  waiting,
}: {
  locale: Locale;
  quantity: number;
  onQuantity: (q: number) => void;
  price: number;
  storage: StorageChoice | null;
  location: FarmerLocation | null;
  marketName: string | null;
  /** True when the answer on screen is to wait: the mechanism is shown beside it, not behind it. */
  waiting: boolean;
}) {
  return (
    <section className="lot" aria-labelledby="lot-title" data-testid="lot">
      <h2 id="lot-title" className="label">
        {t(locale, 'lot.title')}
      </h2>
      <div className="lot__row">
        <button type="button" className="lot__step" aria-label={t(locale, 'lot.less')} onClick={() => onQuantity(Math.max(1, quantity - 1))} disabled={quantity <= 1}>
          −
        </button>
        <label className="lot__qty">
          <span className="visually-hidden">{t(locale, 'lot.quantity')}</span>
          <input
            className="figure"
            name="quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (value > 0) onQuantity(value);
            }}
            data-testid="lot-quantity"
          />
        </label>
        <span className="lot__unit">{t(locale, 'lot.quantity')}</span>
        <button type="button" className="lot__step" aria-label={t(locale, 'lot.more')} onClick={() => onQuantity(quantity + 1)}>
          +
        </button>
        <Tx className="muted lot__value" locale={locale} k="lot.value" values={{ amount: rupees(locale, Math.round(price * quantity)) }} />
      </div>
      <p className="lot__storage">
        <Glyph name="warehouse" />
        <span>{storage === null ? t(locale, 'lot.noStorage') : t(locale, 'lot.storage', { name: storage.facility.name, km: number(locale, Math.round(storage.roadKm)) })}</span>
      </p>
      {waiting && (
        <div className="lot__mechanism" data-testid="storage-route" data-enwr={String(storage?.facility.eNwr === true)}>
          {storage === null ? (
            <p>{t(locale, 'lot.waitNeedsStorage')}</p>
          ) : (
            <>
              <p className="muted">{t(locale, 'lot.rate', { amount: rupees(locale, storage.facility.ratePerQtlMonth) })}</p>
              <p>
                {storage.facility.eNwr && storage.facility.pledgeRateAnnual !== null
                  ? t(locale, 'lot.enwr', { rate: number(locale, Math.round(storage.facility.pledgeRateAnnual * 100)) })
                  : t(locale, 'lot.noEnwr')}
              </p>
            </>
          )}
        </div>
      )}
      {location !== null && (
        <p className="muted lot__note">
          {location.source === 'market-town' && marketName !== null ? t(locale, 'lot.from.market', { place: marketName }) : t(locale, 'lot.from.centroid')}
          {' · '}
          {t(locale, 'lot.private')}
        </p>
      )}
    </section>
  );
}
