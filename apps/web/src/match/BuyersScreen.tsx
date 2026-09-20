/**
 * BUYERS (PROMPT §6.5, §9.7): the explained shortlist for one of the farmer's lots, computed on
 * the phone from the district's verified demand, so it renders, freshly computed, with the API
 * gone (Gate A). Ordered by what reaches the farmer; never a percentage (Gate F).
 *
 * When no buyer beats the farmer's nearest mandi, nothing is manufactured: the screen says so and
 * lists what the farmer can do instead (§6.5 "honest emptiness beats fake recommendations").
 */
import type { ExclusionReason } from '@fasal/shared';
import { useMemo, useState } from 'react';

import { Glyph } from '../design/Glyph';
import { clock, number, rupees, shortDay, t } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import { todayInIndia } from '../offline/compute';
import type { Device } from '../state/useDevice';
import { BuyerCard } from './BuyerCard';
import { shortlistFor, type LotSpec, type MarketRef } from './shortlist';

export function BuyersScreen({ device, listingClientId, onHome }: { device: Device; listingClientId: string | null; onHome: () => void }) {
  const { locale, briefing, listings, context, selectedCrop } = device;
  const [chosen, setChosen] = useState<string | null>(listingClientId);

  const lots = useMemo(() => {
    const out: { key: string; spec: LotSpec; label: string }[] = [];
    if (briefing === null) return out;
    const cropName = (id: string) => briefing.dictionary?.crops.find((c) => c.id === id)?.names[locale] ?? id;
    const homeCrop = selectedCrop !== null && briefing.crops.some((c) => c.crop === selectedCrop) ? selectedCrop : (briefing.crops[0]?.crop ?? null);
    const today = todayInIndia(briefing.computedAt);
    if (homeCrop !== null) {
      out.push({
        key: 'home',
        spec: { crop: homeCrop, quantity: { value: context.quantityQtl, unit: 'quintal' }, grade: null, availableFrom: today, availableUntil: today, listingClientId: null },
        label: t(locale, 'buyers.homeLot', { crop: cropName(homeCrop), qty: number(locale, context.quantityQtl) }),
      });
    }
    for (const { listing, state } of listings) {
      if (state === 'rejected') continue;
      const d = listing.draft;
      out.push({
        key: listing.clientId,
        spec: { crop: d.crop, quantity: d.quantity, grade: d.grade, availableFrom: d.availableFrom, availableUntil: d.availableUntil, listingClientId: listing.clientId },
        label: t(locale, 'buyers.listingLot', { crop: cropName(d.crop), qty: number(locale, d.quantity.value), unit: t(locale, `unit.q.${d.quantity.unit}`) }),
      });
    }
    return out;
  }, [briefing, listings, context.quantityQtl, selectedCrop, locale]);

  const active = lots.find((l) => l.key === chosen) ?? lots.find((l) => l.key === listingClientId) ?? lots[0] ?? null;
  const shortlist = useMemo(() => (briefing === null || active === null ? null : shortlistFor(briefing, active.spec, context)), [briefing, active, context]);

  if (briefing === null || active === null || shortlist === null) {
    return (
      <p className="empty-state" data-testid="buyers-empty">
        {t(locale, briefing === null ? 'home.empty' : 'buyers.noLots')}
      </p>
    );
  }

  const marketLabel = (m: MarketRef | null) => (m === null ? '' : locale === 'en' ? m.names.en : m.names.mr);

  return (
    <section className="stack" aria-labelledby="buyers-title" data-testid="buyers">
      <h1 id="buyers-title" className="display sell__title">
        {t(locale, 'buyers.title')}
      </h1>

      {lots.length > 1 && (
        <div className="field">
          <span className="label">{t(locale, 'buyers.pickLot')}</span>
          <div className="lot-picker" role="group" aria-label={t(locale, 'buyers.pickLot')}>
            {lots.map((l) => (
              <button key={l.key} type="button" className="lot-picker__option" aria-pressed={l.key === active.key} onClick={() => setChosen(l.key)} data-testid={`lot-${l.key}`}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {shortlist.kind === 'no-demand' && <p className="notice" data-testid="buyers-no-demand">{t(locale, 'buyers.noDemand')}</p>}
      {shortlist.kind === 'no-price' && (
        <p className="notice notice--caution" data-testid="buyers-no-price">
          <Glyph name="caution" />
          <span>{t(locale, 'buyers.noPrice')}</span>
        </p>
      )}

      {shortlist.kind === 'ranked' && (
        <>
          <p className="buyers__rate" data-testid="buyers-rate">
            <Tx
              locale={locale}
              k="buyers.rate"
              values={{ market: marketLabel(shortlist.benchmark.market), price: rupees(locale, shortlist.benchmark.modalPerQtl), date: shortDay(locale, shortlist.benchmark.asOf) }}
              words={['market']}
            />
          </p>
          <p className="muted">{t(locale, 'buyers.order')}</p>
          <p className="muted">{t(locale, 'buyers.checked')}</p>
          {shortlist.demonstration && (
            <p className="notice" data-testid="buyers-demonstration">
              {t(locale, 'buyers.demonstration')}
            </p>
          )}

          {shortlist.result.matches.length > 0 ? (
            <ol className="buyer-list" data-testid="shortlist" data-count={shortlist.result.matches.length}>
              {shortlist.result.matches.map((match, i) => (
                <BuyerCard
                  key={match.requirementId}
                  locale={locale}
                  match={match}
                  rank={i + 1}
                  marketName={marketLabel(shortlist.benchmark.market)}
                  below={shortlist.below.get(match.requirementId) ?? null}
                  rating={shortlist.ratings.get(match.buyerId) ?? null}
                />
              ))}
            </ol>
          ) : (
            <section className="panel" data-testid="no-good-match" aria-labelledby="no-match-title">
              <h2 id="no-match-title" className="panel__title">
                {t(locale, 'empty.title')}
              </h2>
              <ul className="alternatives">
                {shortlist.nearestMandi !== null && shortlist.result.walkAwayPerQtl !== null && (
                  <li data-testid="alt-mandi">
                    <Tx
                      locale={locale}
                      k="empty.mandi"
                      values={{ market: marketLabel(shortlist.nearestMandi.market), km: number(locale, Math.round(shortlist.nearestMandi.roadKm)), amount: rupees(locale, Math.round(shortlist.result.walkAwayPerQtl)) }}
                      words={['market']}
                    />
                  </li>
                )}
                <li data-testid="alt-rate">
                  <Tx
                    locale={locale}
                    k="buyers.rate"
                    values={{ market: marketLabel(shortlist.benchmark.market), price: rupees(locale, shortlist.benchmark.modalPerQtl), date: shortDay(locale, shortlist.benchmark.asOf) }}
                    words={['market']}
                  />
                </li>
                {shortlist.result.alternatives.poolCandidates.length > 0 && (
                  <li data-testid="alt-pool">
                    <Tx locale={locale} k="empty.pool" values={{ n: number(locale, shortlist.result.alternatives.poolCandidates.length) }} />
                  </li>
                )}
                <li data-testid="alt-alert">
                  <button type="button" className="btn btn--quiet" onClick={onHome}>
                    {t(locale, 'empty.alert')}
                  </button>
                </li>
                <li className="muted">{t(locale, 'empty.watch')}</li>
              </ul>
            </section>
          )}

          {shortlist.result.excluded.length > 0 && <Excluded locale={locale} reasons={shortlist.result.excluded.map((e) => e.reason)} />}

          <p className="computed" data-testid="buyers-computed-at" data-computed-at={shortlist.computedAt}>
            <Tx locale={locale} k="home.computed" values={{ time: clock(locale, shortlist.computedAt) }} />
          </p>
        </>
      )}
    </section>
  );
}

function Excluded({ locale, reasons }: { locale: Parameters<typeof t>[0]; reasons: ExclusionReason[] }) {
  const counts = new Map<ExclusionReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return (
    <details className="excluded" data-testid="excluded">
      <summary>{t(locale, 'excluded.title')}</summary>
      <ul>
        {[...counts.entries()].map(([reason, n]) => (
          <li key={reason} data-testid={`excluded-${reason}`} data-count={n}>
            <Tx locale={locale} k="excluded.line" values={{ reason: t(locale, `excluded.${reason}`), n: number(locale, n) }} words={['reason']} />
          </li>
        ))}
      </ul>
    </details>
  );
}
