/**
 * A lot offered for group sale, and the consignment it can join or is in (PROMPT §6.6).
 *
 *   ONE CONSIGNMENT
 *   Kadwa Valley Farmer Producer Company, for Yeola Onion Export Terminal
 *   28 of 30 quintals · 6 lots · 2 quintals still needed
 *   [ Put my 5 quintals in ]
 *
 * Volumes are quintals, not shares of a percentage: the farmer's own lot is named in the units
 * they listed it in, beside the consignment's total. Joining needs a network and says so.
 */
import { useEffect, useState } from 'react';

import { Glyph } from '../design/Glyph';
import { number, shortDay, t } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import type { Device } from '../state/useDevice';
import { joinConsignment, leaveConsignment, openConsignments, type ConsignmentView } from './pools';

const qtl = (kg: number) => kg / 100;

export function ConsignmentPanel({ device, listingClientId, optedIn, listed }: { device: Device; listingClientId: string; optedIn: boolean; listed: boolean }) {
  const { locale, consignments, reach } = device;
  const online = reach?.reachable === true;
  const joined = consignments.find((c) => c.mine?.listingClientId === listingClientId);
  const [offers, setOffers] = useState<ConsignmentView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only once the server holds the lot: a consignment is other farmers' business too, so the
    // question "what could this lot join?" is the server's to answer, and it cannot answer it
    // about a lot it has not received yet. A lot written in the field asks the moment it lands.
    if (!optedIn || !listed || joined !== undefined || !online) {
      setOffers(null);
      return undefined;
    }
    void openConsignments(listingClientId).then((answer) => {
      if (!cancelled) setOffers(answer.kind === 'ok' ? answer.body.pools : []);
    });
    return () => {
      cancelled = true;
    };
  }, [optedIn, listed, joined, online, listingClientId]);

  if (!optedIn) return null;
  const offer = offers?.[0] ?? null;
  if (joined === undefined && offer === null) return null;
  const consignment = joined ?? offer!;
  const act = async (what: 'join' | 'leave') => {
    setBusy(true);
    setProblem(null);
    const answer = await (what === 'join' ? joinConsignment(consignment.id, listingClientId) : leaveConsignment(consignment.id, listingClientId));
    if (answer.kind === 'ok') await device.reloadConsignments();
    else setProblem(answer.kind === 'rejected' ? answer.message : t(locale, 'pool.needsNetwork'));
    setBusy(false);
  };

  return (
    <section className="consignment" data-testid="consignment" data-pool={consignment.id} data-status={consignment.status} data-mine={String(joined !== undefined)}>
      <p className="label">{t(locale, 'pool.title')}</p>
      <p className="consignment__who">
        <Tx locale={locale} k="pool.coordinated" values={{ coordinator: consignment.coordinator?.name ?? '', buyer: consignment.buyer.name }} words={['coordinator', 'buyer']} />
      </p>
      <p className="consignment__volume" data-testid="consignment-volume" data-total-kg={consignment.totalKg} data-need-kg={consignment.needKg}>
        <Tx locale={locale} k="pool.volume" values={{ total: number(locale, qtl(consignment.totalKg)), need: number(locale, qtl(consignment.needKg)), lots: number(locale, consignment.contributors) }} />
      </p>
      {consignment.status === 'cleared' ? (
        <p className="consignment__cleared" data-testid="consignment-cleared">
          <Glyph name="seal" size={16} />
          {t(locale, 'pool.cleared')}
        </p>
      ) : (
        <p className="muted">
          <Tx locale={locale} k="pool.stillNeeded" values={{ qty: number(locale, qtl(consignment.shortfallKg)) }} />
        </p>
      )}
      {joined !== undefined && joined.mine !== null && (
        <p data-testid="consignment-mine">
          <Tx locale={locale} k="pool.yours" values={{ mine: number(locale, qtl(joined.mine.contributedKg)), total: number(locale, qtl(joined.totalKg)) }} />
        </p>
      )}
      {consignment.window !== null && (
        <p className="muted">
          <Tx locale={locale} k="pool.window" values={{ from: shortDay(locale, consignment.window.from), until: shortDay(locale, consignment.window.until) }} />
        </p>
      )}
      {problem !== null && (
        <p className="notice notice--caution" data-testid="consignment-problem">
          <Glyph name="caution" />
          <span>{problem}</span>
        </p>
      )}
      {!online && <p className="muted" data-testid="consignment-offline">{t(locale, 'pool.needsNetwork')}</p>}
      {joined === undefined ? (
        <button type="button" className="btn" disabled={!online || busy} onClick={() => void act('join')} data-testid="consignment-join">
          <Glyph name="buyers" size={16} />
          {t(locale, 'pool.join')}
        </button>
      ) : (
        <button type="button" className="btn btn--quiet" disabled={!online || busy || consignment.status === 'dealt' || consignment.status === 'closed'} onClick={() => void act('leave')} data-testid="consignment-leave">
          {t(locale, 'pool.leave')}
        </button>
      )}
    </section>
  );
}

