/**
 * My listings (FR-10): every listing composed on this phone, each echoing the farmer's own unit
 * and price basis, and each showing where it is on its way to the server. "Saved on this phone"
 * and "Waiting to send" are honest states, not errors, and a listing is never shown as received
 * until the server has confirmed it. A listing's photograph has its own journey, shown beside it
 * (CAM-13), and never holds the listing back. A lot offered for group sale shows the consignment
 * it can join, or is in (§6.6), and the offers a lot has drawn, with the sauda slip once one
 * is struck (§8.9).
 */
import { Glyph } from '../design/Glyph';
import { day, number, rupees, t } from '../i18n/strings';
import type { Device, ListingState } from '../state/useDevice';
import { gradeLine, useObjectUrl } from './PhotoPanel';
import { DealsPanel } from '../deals/DealsPanel';
import { ConsignmentPanel } from '../pools/ConsignmentPanel';

function ListingPhoto({ device, photo }: { device: Device; photo: NonNullable<ListingState['photo']> }) {
  const { locale } = device;
  const url = useObjectUrl(photo.stored.blob);
  const tone = photo.state === 'sent' ? 'sent' : photo.state === 'rejected' ? 'rejected' : 'waiting';
  return (
    <div className="listing-item__photo" data-testid="listing-photo" data-state={photo.state}>
      {url !== null && <img className="listing-item__thumb" src={url} alt={t(locale, 'photo.title')} width={photo.stored.width} height={photo.stored.height} />}
      <span className={`listing-item__state listing-item__state--${tone}`}>
        <Glyph name={photo.state === 'sent' ? 'seal' : photo.state === 'rejected' ? 'caution' : 'camera'} size={16} />
        {photo.state === 'rejected' ? t(locale, 'photo.state.rejected', { reason: photo.error ?? '' }) : t(locale, `photo.state.${photo.state}`)}
      </span>
    </div>
  );
}

export function ListingsScreen({ device, onSell, onBuyers }: { device: Device; onSell: () => void; onBuyers: (clientId: string) => void }) {
  const { locale, listings, briefing } = device;
  const cropName = (id: string) => briefing?.dictionary?.crops.find((c) => c.id === id)?.names[locale] ?? id;
  // The farmer's own district, named in their language: where a complaint goes (§8.9).
  const districtName = briefing?.registry?.districts.find((d) => d.id === briefing.district)?.names[locale] ?? briefing?.district ?? '';
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
          {listings.map(({ listing, state, error, photo }) => {
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
                {d.grade !== null && (
                  <p className="listing-item__grade" data-testid="listing-grade" data-grade={d.grade} data-provenance={d.gradeProvenance ?? ''}>
                    {gradeLine(locale, d.grade, d.gradeProvenance)}
                  </p>
                )}
                {photo !== null && <ListingPhoto device={device} photo={photo} />}
                <button type="button" className="btn btn--quiet listing-item__buyers" onClick={() => onBuyers(listing.clientId)} data-testid="listing-buyers">
                  <Glyph name="buyers" size={16} />
                  {t(locale, 'listings.buyers')}
                </button>
                <ConsignmentPanel device={device} listingClientId={listing.clientId} optedIn={d.poolOptIn} listed={state === 'sent'} />
                <DealsPanel device={device} listingClientId={listing.clientId} cropName={cropName(d.crop)} district={districtName} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
