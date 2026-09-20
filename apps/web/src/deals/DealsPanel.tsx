/**
 * The offers on one lot, and the deal that comes of them (PROMPT §8.9; Gate G).
 *
 *   OFFERS ON THIS LOT
 *   GODAVARI AGRO TRADERS · Lasalgaon
 *   ₹3,720 per quintal · ₹212 above today's district rate
 *   ₹18,600 for the whole lot
 *   23 completed deals · pays in ~4 days
 *   [ Accept this price ]  [ Ask a different price ]  [ No, thank you ]
 *
 * Three things are deliberate here. The price is always shown with its basis and beside the
 * district rate, so "good price" is something the farmer can check rather than take on trust.
 * The farmer's own counter is a price they name, not a slider. And with no network the offers
 * are all still here to read, while the three buttons are not: agreeing a deal is the server's,
 * and the screen says why instead of queueing something it cannot honour.
 */
import { useState } from 'react';

import { Glyph } from '../design/Glyph';
import { number, rupees, t } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import type { Device } from '../state/useDevice';
import { acceptOffer, counterOffer, declineOffer, overallOf, type DealView } from './deals';
import { DealProgress } from './DealProgress';
import { DisputePanel } from './DisputePanel';
import { SaudaSlip } from './SaudaSlip';

const STRUCK: readonly string[] = ['ACCEPTED', 'SAUDA_SLIP', 'DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED', 'MUTUALLY_RATED'];
/** A complaint is possible once both sides agree the lot changed hands, and not before (SEC-11). */
const DISPUTABLE: readonly string[] = ['DELIVERY_CONFIRMED', 'PAYMENT_CONFIRMED', 'MUTUALLY_RATED'];

function Offer({ device, deal, cropName, lotSold, district }: { device: Device; deal: DealView; cropName: string; lotSold: boolean; district: string }) {
  const { locale, reach } = device;
  const online = reach?.reachable === true;
  const [asking, setAsking] = useState(false);
  const [price, setPrice] = useState(String(Math.round(deal.terms.price.amount)));
  const [busy, setBusy] = useState<null | 'accept' | 'counter' | 'decline'>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showSlip, setShowSlip] = useState(false);

  const mine = deal.lastPriceBy === 'seller';
  const struck = STRUCK.includes(deal.state);
  const delta = deal.benchmarkAtOffer === null ? null : Math.round(deal.terms.price.amount - deal.benchmarkAtOffer.modalPerQtl);
  const rating = overallOf(deal.counterpartyRating);
  const gross = deal.terms.price.unit === 'quintal' ? Math.round(deal.terms.price.amount * deal.terms.quantity.value) : null;

  const act = async (what: 'accept' | 'counter' | 'decline') => {
    setBusy(what);
    setProblem(null);
    const answer =
      what === 'accept'
        ? await acceptOffer(deal.id)
        : what === 'decline'
          ? await declineOffer(deal.id)
          : await counterOffer(deal.id, { amount: Number(price), unit: 'quintal' }, deal.terms.quantity);
    if (answer.kind === 'ok') {
      setAsking(false);
      await device.reloadDeals();
    } else {
      setProblem(answer.kind === 'rejected' ? answer.message : t(locale, 'deal.needsNetwork'));
    }
    setBusy(null);
  };

  return (
    <li className="offer" data-testid="offer" data-deal={deal.id} data-state={deal.state} data-buyer={deal.buyer.id}>
      <header className="offer__head">
        <strong className="offer__name">{deal.buyer.name}</strong>
        <span className="muted"> · {deal.buyer.place}</span>
        <span className="offer__state" data-testid="offer-state">
          {t(locale, `deal.state.${deal.state}`)}
        </span>
      </header>

      <p className="offer__price">
        <span className="figure" data-testid="offer-price" data-amount={deal.terms.price.amount}>
          {rupees(locale, deal.terms.price.amount)}
        </span>{' '}
        {t(locale, `unit.per.${deal.terms.price.unit}`)}
      </p>
      {delta !== null && (
        <p className="muted" data-testid="offer-vs-rate">
          <Tx locale={locale} k={delta > 0 ? 'deal.vsRate.above' : delta < 0 ? 'deal.vsRate.below' : 'deal.vsRate.at'} values={{ amount: rupees(locale, Math.abs(delta)) }} />
        </p>
      )}
      {gross !== null && (
        <p className="offer__gross" data-testid="offer-gross" data-amount={gross}>
          <Tx locale={locale} k="deal.gross" values={{ amount: rupees(locale, gross) }} />
        </p>
      )}
      <p className="muted offer__record" data-testid="offer-record" data-deals={deal.paymentRecord.completedDeals}>
        {deal.paymentRecord.typicalDays === null ? (
          t(locale, 'card.newBuyer')
        ) : (
          <Tx locale={locale} k="card.record" values={{ n: number(locale, deal.paymentRecord.completedDeals), days: number(locale, deal.paymentRecord.typicalDays) }} />
        )}
      </p>
      {/* A rating is never shown without the number of people behind it (§8.9) — and never shown
          as clean while a complaint against this buyer is open, which is what gives one teeth. */}
      {deal.paymentRecord.openDisputes > 0 ? (
        <p className="offer__flag" data-testid="offer-under-dispute" data-open={deal.paymentRecord.openDisputes}>
          <Glyph name="flag" size={16} />
          <Tx locale={locale} k="dispute.against" values={{ n: number(locale, deal.paymentRecord.openDisputes) }} />
        </p>
      ) : (
        <p className="muted offer__rating" data-testid="offer-rating" data-count={deal.counterpartyRating?.count ?? 0}>
          {rating === null ? (
            t(locale, 'deal.rating.none')
          ) : (
            <Tx locale={locale} k="deal.rating" values={{ rating: number(locale, rating), n: number(locale, deal.counterpartyRating?.count ?? 0) }} />
          )}
        </p>
      )}

      {deal.state === 'DECLINED' && (
        <p className="muted" data-testid="offer-declined">
          {t(locale, lotSold ? 'deal.soldElsewhere' : 'deal.declined')}
        </p>
      )}
      {mine && !struck && deal.state !== 'DECLINED' && <p className="muted" data-testid="offer-waiting">{t(locale, 'deal.yourPrice')}</p>}

      {struck && deal.slip !== null && (
        <>
          <button type="button" className="btn btn--quiet" onClick={() => setShowSlip((open) => !open)} data-testid="offer-slip">
            <Glyph name="slip" size={16} />
            {t(locale, showSlip ? 'slip.close' : 'slip.open')}
          </button>
          {showSlip && <SaudaSlip locale={locale} slip={deal.slip} cropName={cropName} />}
        </>
      )}
      {struck && deal.slip === null && (
        <p className="muted" data-testid="offer-pending">
          {t(locale, 'deal.pending')}
        </p>
      )}
      {struck && <DealProgress device={device} deal={deal} />}
      {DISPUTABLE.includes(deal.state) && <DisputePanel device={device} deal={deal} district={district} />}

      {problem !== null && (
        <p className="notice notice--caution" data-testid="offer-problem">
          <Glyph name="caution" />
          <span>{problem}</span>
        </p>
      )}

      {!struck && deal.state !== 'DECLINED' && !online && (
        <p className="muted" data-testid="offer-offline">
          {t(locale, 'deal.needsNetwork')}
        </p>
      )}

      {!struck && deal.state !== 'DECLINED' && !mine && (
        <div className="offer__actions">
          <button type="button" className="btn" disabled={!online || busy !== null} onClick={() => void act('accept')} data-testid="offer-accept">
            <Glyph name="seal" size={16} />
            {t(locale, 'deal.accept')}
          </button>
          <button type="button" className="btn btn--secondary" disabled={!online || busy !== null} onClick={() => setAsking(true)} data-testid="offer-counter">
            {t(locale, 'deal.counter')}
          </button>
          <button type="button" className="btn btn--quiet" disabled={!online || busy !== null} onClick={() => void act('decline')} data-testid="offer-decline">
            {t(locale, 'deal.decline')}
          </button>
        </div>
      )}

      {asking && (
        <form
          className="offer__ask"
          onSubmit={(event) => {
            event.preventDefault();
            void act('counter');
          }}
        >
          <label className="field">
            <span className="field__label-row">{t(locale, 'deal.counterPrice')}</span>
            <input name="counter" type="number" inputMode="numeric" min="1" step="1" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="offer-counter-price" />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy !== null || !(Number(price) > 0)} data-testid="offer-counter-send">
              {t(locale, 'deal.counterSend')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setAsking(false)}>
              {t(locale, 'deal.cancel')}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

export function DealsPanel({ device, listingClientId, cropName, district }: { device: Device; listingClientId: string; cropName: string; district: string }) {
  const mine = device.deals.filter((deal) => deal.listingClientId === listingClientId);
  if (mine.length === 0) return null;
  // Once one offer is taken the database declines the rest (migration 0011); those cards say the
  // lot went elsewhere rather than implying the farmer turned each of them down.
  const lotSold = mine.some((deal) => STRUCK.includes(deal.state));
  return (
    <section className="offers" data-testid="offers" data-count={mine.length}>
      <p className="label">{t(device.locale, 'deal.title')}</p>
      <ul className="offer-list">
        {mine.map((deal) => (
          <Offer key={deal.id} device={device} deal={deal} cropName={cropName} lotSold={lotSold} district={district} />
        ))}
      </ul>
      {mine.some((deal) => deal.buyer.demonstration) && <p className="muted offers__note">{t(device.locale, 'buyers.demonstration')}</p>}
    </section>
  );
}
