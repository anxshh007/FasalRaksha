/**
 * A complaint, in the farmer's own words, with a code behind it (PROMPT §8.9; FR-15).
 *
 *   Did something go wrong with this deal?
 *   ○ The weight came up short   ● They disputed the quality   ○ The money has not come
 *   [ In your own words … ]        ☑ Send the photograph of the lot with it
 *   [ Send the complaint ]   → Sent to the Nashik district agriculture officer.
 *
 * The farmer chooses from five plain sentences; what is sent is a reason code, so a district
 * officer can be told "eleven grade disputes in Niphad this month" without anybody reading
 * eleven paragraphs. The note is where the words go, and the photograph already taken of the lot
 * goes with it — attached by reference, never uploaded twice.
 *
 * It appears only from the moment both sides agree the lot changed hands, because before that
 * there is nothing to complain about that declining the offer does not already cover.
 */
import { useState } from 'react';

import { Glyph } from '../design/Glyph';
import { day, t } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import type { Device } from '../state/useDevice';
import { DISPUTE_REASONS, raiseDispute, type DealView, type DisputeReason } from './deals';

export function DisputePanel({ device, deal, district }: { device: Device; deal: DealView; district: string }) {
  const { locale, reach } = device;
  const online = reach?.reachable === true;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DisputeReason>('GRADE_DISPUTE');
  const [note, setNote] = useState('');
  const [withPhoto, setWithPhoto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const existing = deal.dispute;
  if (existing !== null) {
    return (
      <section className="dispute" data-testid="dispute" data-state={existing.state} data-reason={existing.reason}>
        <p className="dispute__state">
          <Glyph name="flag" size={16} />
          {t(locale, `dispute.state.${existing.state}`)} · {t(locale, `dispute.reason.${existing.reason}`)}
        </p>
        <p className="muted">
          <Tx locale={locale} k="dispute.sent" values={{ district }} words={['district']} />
        </p>
        <p className="muted num">{day(locale, existing.openedAt.slice(0, 10))}</p>
        {existing.outcome !== null && (
          <p data-testid="dispute-outcome" data-outcome={existing.outcome}>
            {t(locale, `dispute.outcome.${existing.outcome}`)}
          </p>
        )}
      </section>
    );
  }

  const send = async () => {
    setBusy(true);
    setProblem(null);
    const answer = await raiseDispute(deal.id, { reason, note, evidencePhotoId: withPhoto ? deal.photoId : null });
    if (answer.kind === 'ok') {
      setOpen(false);
      await device.reloadDeals();
    } else {
      setProblem(answer.kind === 'rejected' ? answer.message : t(locale, 'deal.needsNetwork'));
    }
    setBusy(false);
  };

  return (
    <section className="dispute" data-testid="dispute-invite">
      {!open ? (
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(true)} data-testid="dispute-open">
          <Glyph name="flag" size={16} />
          {t(locale, 'dispute.open')}
        </button>
      ) : (
        <form
          className="dispute__form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <p className="dispute__title">{t(locale, 'dispute.title')}</p>
          <div className="choices">
            {DISPUTE_REASONS.map((code) => (
              <button key={code} type="button" className="choice" aria-pressed={reason === code} onClick={() => setReason(code)} data-testid={`dispute-reason-${code}`}>
                {t(locale, `dispute.reason.${code}`)}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field__label-row">{t(locale, 'dispute.note')}</span>
            <textarea name="note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="dispute-note" />
          </label>
          {deal.photoId !== null && (
            <label className="check">
              <input type="checkbox" name="evidence" checked={withPhoto} onChange={(e) => setWithPhoto(e.target.checked)} data-testid="dispute-photo" />
              <span>{t(locale, 'dispute.photo')}</span>
            </label>
          )}
          {problem !== null && (
            <p className="notice notice--caution" data-testid="dispute-problem">
              <Glyph name="caution" />
              <span>{problem}</span>
            </p>
          )}
          {!online && <p className="muted">{t(locale, 'deal.needsNetwork')}</p>}
          <div className="row">
            <button type="submit" className="btn" disabled={!online || busy || note.trim().length === 0} data-testid="dispute-send">
              {t(locale, 'dispute.send')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
              {t(locale, 'deal.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
