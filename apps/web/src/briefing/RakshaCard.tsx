/**
 * RAKSHA as a decision instrument (PROMPT §9.8, §9.9-5). The farmer sees one of three answers,
 * never a percentage and never a single predicted price:
 *
 *   SELL NOW / WAIT MAY BE POSSIBLE / NOT ENOUGH EVIDENCE TO WAIT
 *
 * Then the lean ("Market is leaning upward."), the outlook as a *band* with today marked against
 * it, and a quiet "Why?" that opens the evidence. The band is the one computed on this phone,
 * already widened for the age of the data. Anything ahead is rounded to ₹10: no fake precision.
 * A refusal is the product. It is drawn as a considered answer with its reasons named, never as
 * an error.
 */
import type { WaitEvaluation } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { day, headlineKey, number, refusalKey, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import { roundAhead } from './evidence';

const BAR_W = 320;
const BAR_H = 48;

/**
 * The expected range as a band on a price scale, with today's price and the middle marked. The
 * band stretches to the column; the "today" label is HTML so it never stretches with it.
 */
export function RangeBar({ locale, band, today }: { locale: Locale; band: { q10: number; q50: number; q90: number }; today: number }) {
  const lo = Math.min(band.q10, today);
  const hi = Math.max(band.q90, today);
  const pad = (hi - lo) * 0.08 || 1;
  const x = (v: number) => 8 + ((v - (lo - pad)) * (BAR_W - 16)) / (hi + pad - (lo - pad));
  const low = roundAhead(band.q10);
  const high = roundAhead(band.q90);
  const todayPct = (x(today) / BAR_W) * 100;
  return (
    <div className="rangebar-wrap">
      <span className="rangebar__label" style={{ left: `${todayPct.toFixed(1)}%` }} aria-hidden="true">
        {t(locale, 'raksha.today')}
      </span>
      <svg
        className="rangebar"
        viewBox={`0 0 ${BAR_W} ${BAR_H}`}
        width="100%"
        height={BAR_H}
        preserveAspectRatio="none"
        role="img"
        aria-label={t(locale, 'raksha.bandLabel', { low: rupees(locale, low), high: rupees(locale, high), today: rupees(locale, today) })}
        data-testid="rangebar"
      >
        <line className="rangebar__axis" x1="0" x2={BAR_W} y1="24" y2="24" />
        <rect className="rangebar__band" x={x(band.q10)} y="14" width={Math.max(2, x(band.q90) - x(band.q10))} height="20" />
        <line className="rangebar__mid" x1={x(band.q50)} x2={x(band.q50)} y1="11" y2="37" />
        <line className="rangebar__today" x1={x(today)} x2={x(today)} y1="2" y2="46" />
      </svg>
    </div>
  );
}

export function RakshaCard({ locale, evaluation, today, onWhy }: { locale: Locale; evaluation: WaitEvaluation; today: number; onWhy?: () => void }) {
  if (evaluation.suppressed) {
    return (
      <section className="refusal raksha" data-testid="raksha" data-verdict="suppressed">
        <p className="refusal__sentence">{t(locale, 'home.stale')}</p>
        <p className="refusal__condition">{t(locale, 'refusal.GR-1')}</p>
      </section>
    );
  }
  const band = evaluation.band;
  const lean = evaluation.lean;
  const outlook =
    band !== null && lean !== null ? (
      <div className="outlook" data-testid="outlook">
        <p className="label">{t(locale, 'raksha.outlook', { h: evaluation.horizon })}</p>
        <RangeBar locale={locale} band={band} today={today} />
        <dl className="outlook__facts">
          <div>
            <dt className="label">{t(locale, 'raksha.direction')}</dt>
            <dd className="outlook__direction">
              <Glyph name={lean === 'up' ? 'up' : lean === 'down' ? 'down' : 'flat'} />
              {t(locale, `raksha.dir.${lean}`)}
            </dd>
          </div>
          <div>
            <dt className="label">{t(locale, 'raksha.range')}</dt>
            <dd className="figure" data-testid="outlook-range">
              {t(locale, 'raksha.rangeValue', { low: rupees(locale, roundAhead(band.q10)), high: rupees(locale, roundAhead(band.q90)) })}
            </dd>
          </div>
          {evaluation.evidenceStrength !== null && (
            <div>
              <dt className="label">{t(locale, 'raksha.strength')}</dt>
              <dd>{t(locale, `raksha.strength.${evaluation.evidenceStrength}`)}</dd>
            </div>
          )}
          <div>
            <dt className="label">{t(locale, 'raksha.asOf')}</dt>
            <dd className="num">{day(locale, evaluation.asOf)}</dd>
          </div>
        </dl>
        {evaluation.ageDays > 0 && <p className="muted outlook__note">{t(locale, 'raksha.widened', { days: number(locale, evaluation.ageDays) })}</p>}
      </div>
    ) : null;

  const why =
    onWhy === undefined ? null : (
      <button type="button" className="tech-toggle" onClick={onWhy} data-testid="why">
        <Glyph name="why" />
        {t(locale, 'raksha.why')}
      </button>
    );

  if (evaluation.verdict === 'refuse') {
    return (
      <section className="raksha" data-testid="raksha" data-verdict="refuse">
        <div className="refusal">
          <p className="refusal__sentence">{t(locale, headlineKey(evaluation.headline))}</p>
          {evaluation.failedConditions.map((c) => (
            <p key={c} className="refusal__condition" data-testid="refusal-reason">
              {t(locale, refusalKey(c))}
            </p>
          ))}
        </div>
        {lean !== null && <p className="raksha__lean">{t(locale, `raksha.lean.${lean}`)}</p>}
        {outlook}
        {why}
      </section>
    );
  }

  const gain = evaluation.expectedGain;
  return (
    <section className={`raksha raksha--${evaluation.verdict}`} data-testid="raksha" data-verdict={evaluation.verdict}>
      <p className="raksha__headline">{t(locale, headlineKey(evaluation.headline))}</p>
      {lean !== null && <p className="raksha__lean">{t(locale, `raksha.lean.${lean}`)}</p>}
      {outlook}
      {gain !== null && (
        <p className="raksha__net">
          <Tx locale={locale} k="raksha.net" values={{ amount: `${gain.amount >= 0 ? '+' : '−'}${rupees(locale, Math.abs(roundAhead(gain.amount)))}` }} />
        </p>
      )}
      {why}
    </section>
  );
}
