/**
 * The sauda slip (PROMPT §9.9.4) — the record of a struck deal, in the shape of the slip a trader
 * has always written out by hand.
 *
 *   ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
 *   │ SAUDA SLIP        SR-NAS-20260920-0007
 *   │ Farmer   Ganesh Shinde, Niphad
 *   │ Buyer    Godavari Agro Traders ✓
 *   │ Onion · 5 quintal · Grade B (farmer-declared, from a photograph)
 *   │ Market rate that day  ₹3,508 / qtl, Lasalgaon
 *   │ Agreed price          ₹3,720 / qtl
 *   │ Total                 ₹18,600
 *   └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
 *
 * Every figure on it was frozen by the server at the moment of acceptance and is read straight
 * out of that record — nothing here recomputes anything. It prints at A5 in the FIELD theme,
 * because a slip that cannot be printed and handed over is not a slip.
 */
import { Glyph } from '../design/Glyph';
import { day, number, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import { gradeLine } from '../sell/PhotoPanel';
import type { SaudaSlipView } from './deals';

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="slip__row" {...(testId === undefined ? {} : { 'data-testid': testId })}>
      <dt className="label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function SaudaSlip({ locale, slip, cropName }: { locale: Locale; slip: SaudaSlipView; cropName: string }) {
  const unit = t(locale, `unit.q.${slip.quantity.unit}`);
  return (
    <article className="slip" data-testid="sauda-slip" data-slip-no={slip.slipNo} data-deal={slip.dealId}>
      <header className="slip__head">
        <p className="label slip__title">{t(locale, 'slip.title')}</p>
        <p className="figure slip__no">{slip.slipNo}</p>
      </header>

      <dl className="slip__rows">
        <Row label={t(locale, 'slip.seller')}>
          {slip.seller.name}
          {slip.seller.kind === 'fpo' && ' · FPO'}
        </Row>
        <Row label={t(locale, 'slip.buyer')} testId="slip-buyer">
          {slip.buyer.name} · {slip.buyer.place}
        </Row>
        <Row label={t(locale, 'slip.crop')}>
          {cropName} · <span className="figure">{number(locale, slip.quantity.value)}</span> {unit}
        </Row>
        {slip.grade !== null && (
          <Row label={t(locale, 'slip.grade')} testId="slip-grade">
            {gradeLine(locale, slip.grade.grade, slip.grade.provenance)}
          </Row>
        )}
        {slip.benchmark !== null && (
          <Row label={t(locale, 'slip.benchmark')} testId="slip-benchmark">
            <span className="figure">{rupees(locale, slip.benchmark.modalPerQtl)}</span> {t(locale, 'unit.per.quintal')} · {slip.benchmark.market} · {day(locale, slip.benchmark.asOf)}
          </Row>
        )}
        <Row label={t(locale, 'slip.price')} testId="slip-price">
          <span className="figure slip__price" data-testid="slip-price-amount" data-amount={slip.price.amount}>{rupees(locale, slip.price.amount)}</span> {t(locale, `unit.per.${slip.price.unit}`)}
        </Row>
        {slip.grossValue !== null && (
          <Row label={t(locale, 'slip.gross')} testId="slip-gross">
            <span className="figure slip__gross">{rupees(locale, slip.grossValue)}</span>
          </Row>
        )}
        {slip.freight !== null && (
          <Row label={t(locale, 'slip.freight')}>
            <span className="figure">{rupees(locale, slip.freight.total)}</span>{' '}
            <span className="muted">
              <Tx locale={locale} k="slip.trips" values={{ vehicle: slip.freight.vehicleClass, km: number(locale, slip.freight.roadKm) }} words={['vehicle']} />
            </span>
          </Row>
        )}
        <Row label={t(locale, 'slip.payment')}>
          {slip.paymentRecord.typicalDays === null ? (
            t(locale, 'card.newBuyer')
          ) : (
            <Tx locale={locale} k="card.record" values={{ n: number(locale, slip.paymentRecord.completedDeals), days: number(locale, slip.paymentRecord.typicalDays) }} />
          )}
        </Row>
        <Row label={t(locale, 'slip.pickup')}>{t(locale, 'slip.pickupNote')}</Row>
        <Row label={t(locale, 'slip.issued')}>{day(locale, slip.issuedAt.slice(0, 10))}</Row>
      </dl>

      {slip.split !== null && (
        <section className="slip__split" data-testid="slip-split">
          <p className="label">{t(locale, 'slip.split')}</p>
          <ul>
            {slip.split.shares.map((share, i) => (
              <li key={i} className="num">
                <Tx
                  locale={locale}
                  k="slip.splitRow"
                  values={{ kg: number(locale, share.contributedKg), amount: share.amount === null ? '—' : rupees(locale, share.amount) }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="slip__foot">
        <p className="muted">{t(locale, 'slip.dispute')}</p>
        {slip.buyer.demonstration && <p className="muted">{t(locale, 'buyers.demonstration')}</p>}
        <button type="button" className="btn btn--secondary slip__print" onClick={() => window.print()} data-testid="slip-print">
          <Glyph name="slip" size={16} />
          {t(locale, 'slip.print')}
        </button>
      </footer>
    </article>
  );
}
