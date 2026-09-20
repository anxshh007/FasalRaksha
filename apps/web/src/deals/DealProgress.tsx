/**
 * What happens after the price is agreed (PROMPT §8.9; FR-14): the lot goes, the money arrives,
 * and each side says how the other did.
 *
 *   Has the lot gone to the buyer?      [ Yes, the lot has gone ]
 *   Your side is recorded. Waiting for the buyer to confirm theirs.
 *   Has the money arrived?              ₹18,600  [ Yes, the money arrived ]
 *   ₹18,600 received · the same day
 *   How was this buyer?   Paid on time ○○○●○   Fair weighment …   [ Record what I said ]
 *
 * Three rules hold this screen together. Each side confirms delivery only for itself — the
 * database refuses a confirmation made on the other's behalf. Only the farmer can say the money
 * arrived, because only they know. And a rating is possible only on a deal that completed, which
 * is what "reputation attaches to completed transactions only" means when you can press it.
 *
 * None of it can happen offline, for the same reason acceptance cannot: it is a fact about two
 * people, recorded once, on the server.
 */
import { useState } from 'react';

import { Glyph } from '../design/Glyph';
import { number, rupees, t } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import type { Device } from '../state/useDevice';
import { BUYER_RATING_DIMENSIONS, confirmDelivery, confirmPayment, rateDeal, type BuyerRatingDimension, type DealView } from './deals';

function Stars({ label, value, onChange, name }: { label: string; value: number; onChange: (next: number) => void; name: string }) {
  return (
    <fieldset className="rating__row">
      <legend className="rating__label">{label}</legend>
      <div className="rating__scale">
        {[1, 2, 3, 4, 5].map((score) => (
          <label key={score} className="rating__point">
            <input type="radio" name={name} value={score} checked={value === score} onChange={() => onChange(score)} data-testid={`rate-${name}-${score}`} />
            <span className="figure">{score}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function DealProgress({ device, deal }: { device: Device; deal: DealView }) {
  const { locale, reach } = device;
  const online = reach?.reachable === true;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(deal.slip?.grossValue ?? ''));
  const [scores, setScores] = useState<Partial<Record<BuyerRatingDimension, number>>>({});

  const run = async (work: () => Promise<{ kind: string; message?: string }>) => {
    setBusy(true);
    setProblem(null);
    const answer = await work();
    if (answer.kind === 'ok') await device.reloadDeals();
    else setProblem(answer.kind === 'rejected' ? (answer.message ?? '') : t(locale, 'deal.needsNetwork'));
    setBusy(false);
  };

  const rated = deal.rated.you;
  const stage =
    deal.state === 'SAUDA_SLIP' ? (deal.delivery.seller ? 'waiting-delivery' : 'delivery') : deal.state === 'DELIVERY_CONFIRMED' ? 'payment' : rated ? 'done' : 'rating';

  return (
    <section className="progress" data-testid="deal-progress" data-stage={stage}>
      {stage === 'delivery' && (
        <>
          <p className="progress__ask">{t(locale, 'deal.delivery.ask')}</p>
          <button type="button" className="btn" disabled={!online || busy} onClick={() => void run(() => confirmDelivery(deal.id))} data-testid="delivery-confirm">
            <Glyph name="truck" size={16} />
            {t(locale, 'deal.delivery.yes')}
          </button>
        </>
      )}
      {stage === 'waiting-delivery' && <p className="muted" data-testid="delivery-waiting">{t(locale, 'deal.delivery.waiting')}</p>}

      {(stage === 'payment' || stage === 'rating' || stage === 'done') && (
        <p className="muted" data-testid="delivery-done">
          <Glyph name="seal" size={16} />
          {t(locale, 'deal.delivery.done')}
        </p>
      )}

      {stage === 'payment' && (
        <>
          <p className="progress__ask">{t(locale, 'deal.payment.ask')}</p>
          <label className="field">
            <span className="field__label-row">{t(locale, 'deal.payment.amount')}</span>
            <input name="paid" type="number" inputMode="numeric" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount" />
          </label>
          <button
            type="button"
            className="btn"
            disabled={!online || busy || !(Number(amount) > 0)}
            onClick={() => void run(() => confirmPayment(deal.id, Number(amount)))}
            data-testid="payment-confirm"
          >
            {t(locale, 'deal.payment.yes')}
          </button>
        </>
      )}

      {deal.payment !== null && (
        <p className="progress__paid" data-testid="payment-done" data-amount={deal.payment.amount} data-days={deal.payment.daysAfterDelivery}>
          <Tx
            locale={locale}
            k={deal.payment.daysAfterDelivery === 0 ? 'deal.payment.sameDay' : 'deal.payment.done'}
            values={{ amount: rupees(locale, deal.payment.amount), days: number(locale, deal.payment.daysAfterDelivery) }}
          />
        </p>
      )}

      {stage === 'rating' && (
        <form
          className="rating"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => rateDeal(deal.id, scores));
          }}
          data-testid="rating-form"
        >
          <p className="progress__ask">{t(locale, 'deal.rate.ask')}</p>
          {BUYER_RATING_DIMENSIONS.map((dimension) => (
            <Stars
              key={dimension}
              name={dimension}
              label={t(locale, `deal.rate.${dimension}`)}
              value={scores[dimension] ?? 0}
              onChange={(next) => setScores((all) => ({ ...all, [dimension]: next }))}
            />
          ))}
          <button type="submit" className="btn" disabled={!online || busy || Object.keys(scores).length === 0} data-testid="rating-send">
            {t(locale, 'deal.rate.send')}
          </button>
        </form>
      )}
      {stage === 'done' && <p className="muted" data-testid="rating-done">{t(locale, 'deal.rate.done')}</p>}

      {problem !== null && (
        <p className="notice notice--caution" data-testid="progress-problem">
          <Glyph name="caution" />
          <span>{problem}</span>
        </p>
      )}
      {!online && stage !== 'done' && stage !== 'waiting-delivery' && (
        <p className="muted" data-testid="progress-offline">
          {t(locale, 'deal.needsNetwork')}
        </p>
      )}
    </section>
  );
}
