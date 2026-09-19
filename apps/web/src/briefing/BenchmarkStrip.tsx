/**
 * The benchmark strip (PROMPT §9.7, §9.9-2): the district modal as the largest object on the
 * screen, then the seven-day movement as a hand-drawn 1px sparkline (no chart library), the MSP
 * floor as a drawn rule, the change in the semantic colour, and the seasonal position. Used on
 * home now and wherever a number is named later (sell, offers, the sauda slip).
 */
import type { Benchmark, CropBundle, TrendPoint } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { day, rupees, shortDay, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';

const W = 168;
const H = 44;

/** A 1px line through the traded days; a closed market is a gap, never interpolated. */
export function Sparkline({ locale, trend, msp }: { locale: Locale; trend: TrendPoint[]; msp: number | null }) {
  const values = trend.map((p) => p.modal).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // Draw the MSP rule inside the chart only when it is close enough not to flatten the trend.
  const mspInside = msp !== null && msp >= lo - (hi - lo) * 1.5 && msp <= hi + (hi - lo) * 1.5;
  if (mspInside && msp !== null) {
    lo = Math.min(lo, msp);
    hi = Math.max(hi, msp);
  }
  const pad = (hi - lo) * 0.12 || hi * 0.02 || 1;
  lo -= pad;
  hi += pad;
  const x = (i: number) => 2 + (i * (W - 4)) / (trend.length - 1);
  const y = (v: number) => H - 2 - ((v - lo) * (H - 4)) / (hi - lo);

  const segments: string[] = [];
  let current = '';
  trend.forEach((p, i) => {
    if (p.modal === null) {
      if (current !== '') segments.push(current);
      current = '';
      return;
    }
    current += `${current === '' ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.modal).toFixed(1)}`;
  });
  if (current !== '') segments.push(current);
  const lastIndex = trend.map((p) => p.modal !== null).lastIndexOf(true);
  const last = trend[lastIndex];
  const first = trend.find((p) => p.modal !== null);

  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${t(locale, 'brief.trendLabel')}: ${first ? shortDay(locale, first.date) : ''} → ${last ? shortDay(locale, last.date) : ''}`}>
      {mspInside && msp !== null && <line className="sparkline__msp" x1="0" x2={W} y1={y(msp)} y2={y(msp)} />}
      {segments.map((d) => (
        <path key={d} className="sparkline__line" d={d} />
      ))}
      {trend.map((p, i) =>
        p.modal === null ? <line key={p.date} className="sparkline__gap" x1={x(i)} x2={x(i)} y1={H - 6} y2={H - 2} /> : null,
      )}
      {last?.modal !== null && last !== undefined && <rect className="sparkline__end" x={x(lastIndex) - 2} y={y(last.modal ?? 0) - 2} width="4" height="4" />}
    </svg>
  );
}

export function BenchmarkStrip({
  locale,
  cropName,
  districtName,
  benchmark,
  bundle,
}: {
  locale: Locale;
  cropName: string;
  districtName: string;
  benchmark: Benchmark;
  bundle: CropBundle;
}) {
  const change = benchmark.trendChange;
  const delta = change === null ? null : Math.round(change.amount.amount);
  const season = bundle.seasonal?.position ?? null;
  const vsMsp = benchmark.vsMsp;
  return (
    <section className="benchmark" aria-labelledby={`bench-${benchmark.crop}`} data-testid="benchmark">
      <p className="label benchmark__head" id={`bench-${benchmark.crop}`}>
        {t(locale, 'brief.head', { crop: cropName, district: districtName })}
      </p>
      <p className="label">{t(locale, 'brief.today')}</p>
      <p className="benchmark__figure">
        <strong className="figure" data-testid={`modal-${benchmark.crop}`} data-value={benchmark.modal.amount}>
          {rupees(locale, benchmark.modal.amount)}
        </strong>
        <span className="benchmark__unit">/ {t(locale, 'home.perQtl')}</span>
      </p>
      <div className="benchmark__row">
        <Sparkline locale={locale} trend={benchmark.trend7} msp={benchmark.mspFloor?.price.amount ?? null} />
        <div className="benchmark__facts">
          <p className={`benchmark__delta ${delta === null || delta === 0 ? '' : delta > 0 ? 'is-up' : 'is-down'}`} data-testid="bench-delta">
            {delta === null ? (
              t(locale, 'brief.noTrend')
            ) : delta === 0 ? (
              t(locale, 'brief.flat')
            ) : (
              <Tx locale={locale} k="brief.change" values={{ delta: `${delta > 0 ? '+' : '−'}${rupees(locale, Math.abs(delta))}` }} />
            )}
          </p>
          <p className="muted">
            <Tx locale={locale} k="home.range" values={{ min: rupees(locale, benchmark.min.amount), max: rupees(locale, benchmark.max.amount) }} />
          </p>
        </div>
      </div>
      <p className="benchmark__msp" data-testid="bench-msp">
        <Glyph name="msp" />
        {benchmark.mspFloor === null ? (
          <span className="muted">{t(locale, 'brief.noMsp')}</span>
        ) : (
          <span>
            <Tx locale={locale} k="brief.msp" values={{ amount: rupees(locale, benchmark.mspFloor.price.amount), season: benchmark.mspFloor.season }} />
            {vsMsp !== null && (
              <span className="muted">
                {' · '}
                {vsMsp.position === 'at'
                  ? t(locale, 'brief.vsMsp.at')
                  : <Tx locale={locale} k={vsMsp.position === 'above' ? 'brief.vsMsp.above' : 'brief.vsMsp.below'} values={{ amount: rupees(locale, Math.abs(vsMsp.delta.amount)) }} />}
              </span>
            )}
          </span>
        )}
      </p>
      <p className="muted benchmark__season">
        {season === null ? t(locale, 'brief.season.none') : t(locale, `brief.season.${season}`)}
        {bundle.arrivalsRatio !== null && (
          <>
            {' · '}
            {t(locale, 'brief.arrivals', { pct: `${Math.round(bundle.arrivalsRatio * 100)}%` })}
          </>
        )}
        {' · '}
        <span className="num">{t(locale, 'home.asOf', { date: day(locale, benchmark.asOf) })}</span>
      </p>
    </section>
  );
}
