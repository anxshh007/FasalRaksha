/**
 * "Why this signal?" (PROMPT §9.9-1): the direct descendant of Phase 1's understanding card, a
 * bordered, tinted, deliberately separate surface that shows the reasoning back to the farmer.
 * A stacked ledger of the nine layers: a name, a plain meaning, and a hairline meter (a 1px rule
 * with a 3px tick, not a progress bar) at the layer's measured weight. The as-of date sits at
 * the foot. "Technical details", Phase 1's advanced toggle repurposed, carries the raw figures
 * for a judge, in plain words.
 */
import { useState } from 'react';

import type { CropBundle, WaitEvaluation } from '@fasal/shared';

import { Glyph } from '../design/Glyph';
import { day, number, rupees, t, type Locale } from '../i18n/strings';
import { evidenceLedger, type LedgerRow } from './evidence';

const pct = (locale: Locale, fraction: number) => `${number(locale, Math.round(fraction * 1000) / 10)}%`;

function Meter({ share }: { share: number }) {
  return (
    <span className="meter" aria-hidden="true">
      <span className="meter__tick" style={{ left: `calc(${(share * 100).toFixed(1)}% - 1.5px)` }} />
    </span>
  );
}

function Row({ locale, row }: { locale: Locale; row: LedgerRow }) {
  const name = t(locale, `evidence.${row.id}`);
  switch (row.kind) {
    case 'layer':
      return (
        <li className={`ledger__row ledger__row--${row.stance}`} data-testid={`layer-${row.id}`} data-stance={row.stance} data-weight={row.weight}>
          <span className="ledger__name">{name}</span>
          <span className="ledger__meaning">
            {row.stance !== 'silent' && row.direction !== null && <Glyph name={row.direction === 'up' ? 'up' : row.direction === 'down' ? 'down' : 'flat'} size={16} />}
            {t(locale, `evidence.${row.stance}`)}
          </span>
          <Meter share={row.share} />
        </li>
      );
    case 'downside':
      return (
        <li className={`ledger__row ledger__row--wide ledger__row--${row.status}`} data-testid="layer-RK-7" data-status={row.status}>
          <span className="ledger__name">{name}</span>
          <span className="ledger__meaning">
            {row.status === 'not-evaluated' || row.lotLoss === null || row.tolerable === null
              ? t(locale, 'evidence.downside.na')
              : t(locale, `evidence.downside.${row.status}`, { loss: rupees(locale, Math.round(row.lotLoss)), limit: rupees(locale, Math.round(row.tolerable)) })}
          </span>
        </li>
      );
    case 'agreement':
      return (
        <li className="ledger__row" data-testid="layer-RK-8" data-strength={row.strength ?? ''}>
          <span className="ledger__name">{name}</span>
          <span className="ledger__meaning">{row.strength === null ? t(locale, 'evidence.silent') : t(locale, `raksha.strength.${row.strength}`)}</span>
          {row.share !== null && <Meter share={Math.max(0, (row.share - 1 / 3) / (2 / 3))} />}
        </li>
      );
    case 'checks':
      return (
        <li className="ledger__row" data-testid="layer-RK-9" data-passed={row.passed}>
          <span className="ledger__name">{name}</span>
          <span className="ledger__meaning">{t(locale, 'evidence.checks', { n: row.passed })}</span>
        </li>
      );
  }
}

export function EvidencePanel({ locale, bundle, evaluation, open }: { locale: Locale; bundle: CropBundle; evaluation: WaitEvaluation; open?: boolean }) {
  const [technical, setTechnical] = useState(false);
  const rows = evidenceLedger(bundle, evaluation);
  const forecast = bundle.forecast === null ? null : evaluation.horizon === 7 ? bundle.forecast.h7 : bundle.forecast.h14;
  const gates = evaluation.conditions.filter((c) => c.id.startsWith('GR-'));
  const format = (value: number | null) => (value === null ? '—' : Math.abs(value) >= 100 ? rupees(locale, Math.round(value)) : number(locale, Math.round(value * 100) / 100));

  return (
    <section className={`evidence ${open ? 'is-open' : ''}`} aria-labelledby="evidence-title" data-testid="evidence" id="evidence">
      <h2 id="evidence-title" className="evidence__title" tabIndex={-1}>
        {t(locale, 'evidence.title')}
      </h2>
      <ol className="ledger">
        {rows.map((row) => (
          <Row key={row.id} locale={locale} row={row} />
        ))}
      </ol>
      <ul className="checks" aria-label={t(locale, 'evidence.RK-9')}>
        {gates.map((g) => (
          <li key={g.id} className={`checks__item checks__item--${g.status}`} data-testid={`gate-${g.id}`} data-status={g.status}>
            <Glyph name={g.status === 'pass' ? 'seal' : g.status === 'fail' ? 'refuse' : 'why'} size={16} />
            <span>{t(locale, `evidence.gate.${g.id as 'GR-1'}`)}</span>
            <span className="muted">{t(locale, `evidence.gate.${g.status}`)}</span>
          </li>
        ))}
      </ul>
      <p className="evidence__foot label num">{t(locale, 'evidence.foot', { date: day(locale, bundle.asOf) })}</p>
      <button type="button" className="tech-toggle" aria-expanded={technical} onClick={() => setTechnical((v) => !v)} data-testid="technical-toggle">
        {t(locale, 'tech.toggle')}
      </button>
      {technical && (
        <div className="technical figure" data-testid="technical">
          {rows.map((row) =>
            row.kind === 'layer' ? (
              <p key={row.id}>
                {t(locale, 'tech.layer', { id: row.id, direction: row.direction ?? '—', weight: row.weight.toFixed(4), value: row.value === null ? '—' : row.value.toFixed(4) })}
              </p>
            ) : null,
          )}
          {forecast !== null && (
            <>
              <p>{t(locale, 'tech.naive', { pct: pct(locale, forecast.skill) })}</p>
              <p>{t(locale, 'tech.seasonal', { pct: pct(locale, forecast.skillSeasonal) })}</p>
              <p>{t(locale, 'tech.coverage', { pct: pct(locale, forecast.coverage) })}</p>
              <p>{t(locale, 'tech.kappa', { pct: pct(locale, forecast.bandKappa) })}</p>
              <p>{t(locale, 'tech.agreement', { pct: pct(locale, forecast.agreement) })}</p>
            </>
          )}
          {evaluation.conditions.map((c) => (
            <p key={c.id}>{t(locale, 'tech.gate', { id: c.id, status: c.status, measured: format(c.measured), threshold: format(c.threshold) })}</p>
          ))}
          <p>{t(locale, 'tech.release', { version: bundle.version, source: t(locale, 'tech.synthetic') })}</p>
        </div>
      )}
    </section>
  );
}
