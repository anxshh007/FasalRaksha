/**
 * My listings (FR-10): every listing composed on this phone, each echoing the farmer's own unit
 * and price basis, and each showing where it is on its way to the server. "Saved on this phone"
 * and "Waiting to send" are honest states, not errors, and a listing is never shown as received
 * until the server has confirmed it. Offers and deals join this screen in P15.
 */
import { Glyph } from '../design/Glyph';
import { day, number, rupees, t } from '../i18n/strings';
import type { Device } from '../state/useDevice';

export function ListingsScreen({ device, onSell }: { device: Device; onSell: () => void }) {
  const { locale, listings, briefing } = device;
  const cropName = (id: string) => briefing?.dictionary?.crops.find((c) => c.id === id)?.names[locale] ?? id;
  return (
    <section className="stack" aria-labelledby="listings-title" data-testid="listings">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 id="listings-title" className="display sell__title">
          {t(locale, 'listings.title')}
        </h1>
        <button type="button" className="btn btn--secondary" onClick={onSell}>
          <Glyph name="sell" />
          {t(locale, 'listings.new')}
        </button>
      </div>
      {listings.length === 0 ? (
        <p className="empty-state">{t(locale, 'listings.empty')}</p>
      ) : (
        <ul className="listing-list">
          {listings.map(({ listing, state, error }) => {
            const d = listing.draft;
            return (
              <li key={listing.clientId} className="listing-item" data-testid="listing" data-state={state} data-client-id={listing.clientId}>
                <div className="listing-item__head">
                  <strong>{cropName(d.crop)}</strong>
                  <span className={`listing-item__state listing-item__state--${state}`}>
                    <Glyph name={state === 'sent' ? 'seal' : state === 'rejected' ? 'caution' : 'field'} size={16} />
                    {state === 'rejected' ? t(locale, 'listings.state.rejected', { reason: error ?? '' }) : t(locale, `listings.state.${state}`)}
                  </span>
                </div>
                <p className="listing-item__facts">
                  <span className="figure">{number(locale, d.quantity.value)}</span> {t(locale, `unit.q.${d.quantity.unit}`)}
                  {' · '}
                  {d.askingPrice === null ? (
                    <span className="muted">{t(locale, 'confirm.noPrice')}</span>
                  ) : (
                    <span data-testid="listing-price" data-amount={d.askingPrice.amount} data-unit={d.askingPrice.unit}>
                      <span className="figure">{rupees(locale, d.askingPrice.amount)}</span> {t(locale, `unit.per.${d.askingPrice.unit}`)}
                    </span>
                  )}
                </p>
                <p className="muted listing-item__dates num">{t(locale, 'listings.available', { from: day(locale, d.availableFrom), until: day(locale, d.availableUntil) })}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
