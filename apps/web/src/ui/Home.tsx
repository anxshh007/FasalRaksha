/**
 * Home is a morning field briefing, not a dashboard (PROMPT §9.7). Before the farmer is asked to
 * type anything they see what their crop is worth: the benchmark first and largest, then the
 * RAKSHA answer with its band, then their own lot and the best buyer for it (§16.3 step 3). The
 * evidence sits beside it on a wide screen and below it on a phone. The district's other crops
 * follow in compact rows.
 *
 * Every figure is computed on this phone from verified bundles at the moment of rendering. The
 * line under the briefing says when, and a reload recomputes it (Gate A).
 */
import { useRef, useState, type FormEvent } from 'react';

import { BenchmarkStrip } from '../briefing/BenchmarkStrip';
import { EvidencePanel } from '../briefing/EvidencePanel';
import { LotControl } from '../briefing/LotControl';
import { RakshaCard } from '../briefing/RakshaCard';
import { Glyph } from '../design/Glyph';
import { clock, headlineKey, number, rupees, t, type Locale } from '../i18n/strings';
import { Tx } from '../i18n/Tx';
import { shortlistFor } from '../match/shortlist';
import { SpeakButton } from '../sell/SpeakButton';
import { todayInIndia, type CropBriefing, type DecisionContext, type HomeBriefing } from '../offline/compute';
import type { Device } from '../state/useDevice';

const cropName = (locale: Locale, item: CropBriefing) => (locale === 'en' ? item.names.en : locale === 'hi' ? (item.names.hi ?? item.names.mr) : item.names.mr);

function OtherCrop({ locale, item, onChoose }: { locale: Locale; item: CropBriefing; onChoose: () => void }) {
  const verdict = item.evaluation.suppressed ? 'suppressed' : item.evaluation.verdict;
  return (
    <li className="other" data-testid={`crop-${item.crop}`}>
      <button type="button" className="other__button" onClick={onChoose}>
        <span className="other__name">{cropName(locale, item)}</span>
        <strong className="figure" data-testid={`modal-${item.crop}`} data-value={item.benchmark.modal.amount}>
          {rupees(locale, item.benchmark.modal.amount)}
        </strong>
        <span className={`other__verdict other__verdict--${verdict}`} data-testid={`verdict-${item.crop}`} data-verdict={verdict}>
          {item.evaluation.suppressed ? t(locale, 'home.stale') : t(locale, headlineKey(item.evaluation.headline))}
        </span>
      </button>
    </li>
  );
}

function PriceAlert({ device, crops }: { device: Device; crops: CropBriefing[] }) {
  const { locale, queue } = device;
  const [crop, setCrop] = useState(crops[0]?.crop ?? '');
  const [amount, setAmount] = useState('');
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!(value > 0) || crop === '') return;
    await device.queueAction({
      kind: 'price-alert.create',
      idempotencyKey: `alert-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      attempts: 0,
      crop,
      threshold: { amount: value, unit: 'quintal' },
    });
    setSaved(true);
    setAmount('');
  };

  const selected = crops.find((c) => c.crop === crop);
  return (
    <section className="panel" aria-labelledby="alert-title">
      <h2 id="alert-title" className="panel__title">
        {t(locale, 'alert.title')}
      </h2>
      <form onSubmit={(e) => void submit(e)} className="alert-form">
        <label className="field">
          <span className="field__label-row">
            <span className="label">{t(locale, 'alert.crop')}</span>
          </span>
          <select name="crop" value={crop} onChange={(e) => setCrop(e.target.value)}>
            {crops.map((c) => (
              <option key={c.crop} value={c.crop}>
                {cropName(locale, c)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label-row">
            <span className="label">{t(locale, 'alert.explain', { crop: selected === undefined ? '' : cropName(locale, selected) })}</span>
          </span>
          <input name="threshold" className="figure" inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="submit" className="btn">
          {t(locale, 'alert.set')}
        </button>
      </form>
      {saved && queue !== null && (
        <p className="notice" data-testid="alert-status" data-waiting={queue.waiting} data-sent={queue.sent} style={{ marginTop: 'var(--space-4)' }}>
          <Glyph name={queue.waiting > 0 ? 'field' : 'seal'} />
          <span>{queue.waiting > 0 ? t(locale, 'alert.queued') : t(locale, 'alert.sent')}</span>
        </p>
      )}
      {queue?.rejected.map((r) => (
        <p key={r.id} className="notice notice--error">
          <Glyph name="caution" />
          <span>{t(locale, 'alert.rejected', { reason: r.lastError ?? '' })}</span>
        </p>
      ))}
    </section>
  );
}

/** The best buyer for the lot on this screen, from the same shortlist BUYERS shows. */
function BestBuyer({ locale, briefing, crop, context, onBuyers }: { locale: Locale; briefing: HomeBriefing; crop: string; context: DecisionContext; onBuyers: () => void }) {
  const today = todayInIndia(briefing.computedAt);
  const shortlist = shortlistFor(briefing, { crop, quantity: { value: context.quantityQtl, unit: 'quintal' }, grade: null, availableFrom: today, availableUntil: today, listingClientId: null }, context);
  if (shortlist.kind !== 'ranked') return null;
  const best = shortlist.result.matches[0];
  return (
    <div className="best-buyer" data-testid="best-buyer" data-buyer={best?.buyerId ?? ''}>
      <p>
        {best === undefined ? (
          t(locale, 'home.noBuyer')
        ) : (
          <Tx
            locale={locale}
            k="home.bestBuyer"
            values={{ name: best.buyerName, place: best.buyerPlace, qty: number(locale, context.quantityQtl), amount: rupees(locale, Math.round(best.afterFreight)) }}
            words={['name', 'place']}
          />
        )}
      </p>
      <button type="button" className="btn btn--quiet" onClick={onBuyers} data-testid="home-all-buyers">
        <Glyph name="buyers" size={16} />
        {t(locale, 'home.allBuyers')}
      </button>
    </div>
  );
}

export function Home({ device, onBuyers }: { device: Device; onBuyers: () => void }) {
  const { locale, briefing, context } = device;
  const evidenceRef = useRef<HTMLDivElement>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  if (briefing === null) return null;
  const district = briefing.districtNames === null ? briefing.district : briefing.districtNames[locale];

  if (briefing.crops.length === 0) {
    return (
      <p className="empty-state" data-testid="home-empty">
        {t(locale, 'home.empty')}
      </p>
    );
  }

  const lead = briefing.crops.find((c) => c.crop === device.selectedCrop) ?? briefing.crops[0];
  if (lead === undefined) return null;
  const others = briefing.crops.filter((c) => c !== lead);
  const verdict = lead.evaluation.suppressed ? 'suppressed' : lead.evaluation.verdict;
  const why = () => {
    setEvidenceOpen(true);
    evidenceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    evidenceRef.current?.querySelector<HTMLElement>('h2')?.focus();
  };

  return (
    <div className="stack" data-testid="briefing">
      <div className="brief">
        <article className="brief__main" data-testid={`crop-${lead.crop}`} aria-label={cropName(locale, lead)}>
          <BenchmarkStrip locale={locale} cropName={cropName(locale, lead)} districtName={district} benchmark={lead.benchmark} bundle={lead.bundle} />
          <div>
            <SpeakButton
              locale={locale}
              text={t(locale, 'speak.summary', {
                crop: cropName(locale, lead),
                district,
                price: rupees(locale, lead.benchmark.modal.amount),
                answer: lead.evaluation.suppressed ? t(locale, 'home.stale') : t(locale, headlineKey(lead.evaluation.headline)),
              })}
            />
          </div>
          <div data-testid={`verdict-${lead.crop}`} data-verdict={verdict}>
            <RakshaCard locale={locale} evaluation={lead.evaluation} today={lead.benchmark.modal.amount} onWhy={why} />
          </div>
          <LotControl
            locale={locale}
            quantity={context.quantityQtl}
            onQuantity={device.setQuantity}
            price={lead.benchmark.modal.amount}
            storage={lead.storage}
            location={briefing.location}
            marketName={briefing.locationNames === null ? null : locale === 'en' ? briefing.locationNames.en : briefing.locationNames.mr}
          />
          <BestBuyer locale={locale} briefing={briefing} crop={lead.crop} context={context} onBuyers={onBuyers} />
        </article>
        <div className="brief__side" ref={evidenceRef}>
          <EvidencePanel locale={locale} bundle={lead.bundle} evaluation={lead.evaluation} open={evidenceOpen} />
        </div>
      </div>

      {others.length > 0 && (
        <section aria-labelledby="others-title">
          <h2 id="others-title" className="label">
            {t(locale, 'brief.otherCrops', { district })}
          </h2>
          <ul className="others">
            {others.map((item) => (
              <OtherCrop key={item.crop} locale={locale} item={item} onChoose={() => device.selectCrop(item.crop)} />
            ))}
          </ul>
        </section>
      )}

      <p className="computed" data-testid="computed-at" data-computed-at={briefing.computedAt} data-release={briefing.release ?? ''}>
        {t(locale, 'home.computed', { time: clock(locale, briefing.computedAt) })}
      </p>
      {briefing.dataSource === 'synthetic' && (
        <p className="notice notice--caution">
          <Glyph name="caution" />
          <span>{t(locale, 'home.synthetic')}</span>
        </p>
      )}
      <PriceAlert device={device} crops={briefing.crops} />
    </div>
  );
}
