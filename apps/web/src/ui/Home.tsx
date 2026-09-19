/**
 * Home on the design system (P9). Every figure is computed on this phone from verified bundles
 * at the moment of rendering, and the line under the list says when. P10 turns this into the
 * morning field briefing (§9.7): the benchmark strip with its sparkline and MSP rule, the RAKSHA
 * instrument with its band, and the evidence panel. Until then the price is the largest object
 * on the screen, and a refusal already reads as a considered answer, not an error.
 */
import { useState, type FormEvent } from 'react';

import { Glyph } from '../design/Glyph';
import { clock, day, headlineKey, number, refusalKey, rupees, t, type Locale } from '../i18n/strings';
import { DEFAULT_CONTEXT, type CropBriefing } from '../offline/compute';
import type { Device } from '../state/useDevice';

function CropCard({ locale, item, quantity }: { locale: Locale; item: CropBriefing; quantity: number }) {
  const { benchmark, evaluation } = item;
  const name = locale === 'mr' ? item.names.mr : item.names.en;
  return (
    <article className="crop" data-testid={`crop-${item.crop}`} aria-labelledby={`crop-${item.crop}-name`}>
      <header className="crop__head">
        <h3 id={`crop-${item.crop}-name`}>{name}</h3>
        <span className="label">{t(locale, 'home.asOf', { date: day(locale, benchmark.asOf) })}</span>
      </header>
      <p className="crop__rate">
        <span className="visually-hidden">{t(locale, 'home.rate')}</span>
        <strong className="figure" data-testid={`modal-${item.crop}`} data-value={benchmark.modal.amount}>
          {rupees(locale, benchmark.modal.amount)}
        </strong>
        <span className="muted">/ {t(locale, 'home.perQtl')}</span>
      </p>
      <p className="crop__range">
        <span className="figure">{t(locale, 'home.range', { min: rupees(locale, benchmark.min.amount), max: rupees(locale, benchmark.max.amount) })}</span>
        {benchmark.mspFloor !== null && (
          <>
            {' · '}
            <span className="figure">{t(locale, 'home.msp', { amount: rupees(locale, benchmark.mspFloor.price.amount), season: benchmark.mspFloor.season })}</span>
          </>
        )}
      </p>
      {evaluation.suppressed ? (
        <div className="refusal" data-testid={`verdict-${item.crop}`} data-verdict="suppressed">
          <p className="refusal__sentence">{t(locale, 'home.stale')}</p>
        </div>
      ) : evaluation.verdict === 'refuse' ? (
        <div className="refusal" data-testid={`verdict-${item.crop}`} data-verdict={evaluation.verdict}>
          <p className="refusal__sentence">{t(locale, headlineKey(evaluation.headline))}</p>
          {evaluation.failedConditions.map((c) => (
            <p key={c} className="refusal__condition">
              {t(locale, refusalKey(c))}
            </p>
          ))}
          <p className="refusal__condition">{t(locale, 'home.lot', { qty: number(locale, quantity) })}</p>
        </div>
      ) : (
        <div className={`verdict verdict--${evaluation.verdict}`} data-testid={`verdict-${item.crop}`} data-verdict={evaluation.verdict}>
          <p className="verdict__headline">{t(locale, headlineKey(evaluation.headline))}</p>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--size-small)' }}>
            {t(locale, 'home.lot', { qty: number(locale, quantity) })}
          </p>
        </div>
      )}
    </article>
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
  const cropName = selected === undefined ? '' : locale === 'mr' ? selected.names.mr : selected.names.en;
  return (
    <section className="panel" aria-labelledby="alert-title">
      <h2 id="alert-title" className="panel__title">
        {t(locale, 'alert.title')}
      </h2>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label-row">
            <span className="label">{t(locale, 'alert.crop')}</span>
          </span>
          <select name="crop" value={crop} onChange={(e) => setCrop(e.target.value)}>
            {crops.map((c) => (
              <option key={c.crop} value={c.crop}>
                {locale === 'mr' ? c.names.mr : c.names.en}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label-row">
            <span className="label">{t(locale, 'alert.explain', { crop: cropName })}</span>
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

export function Home({ device }: { device: Device }) {
  const { locale, briefing } = device;
  if (briefing === null) return null;
  const quantity = DEFAULT_CONTEXT.quantityQtl;
  const district = briefing.districtNames === null ? briefing.district : locale === 'mr' ? briefing.districtNames.mr : briefing.districtNames.en;
  return (
    <div className="stack">
      <section aria-labelledby="home-title" className="stack">
        <h1 id="home-title" className="display" style={{ fontSize: 'var(--size-h2)' }}>
          {t(locale, 'home.title', { district })}
        </h1>
        {briefing.crops.length === 0 ? (
          <p className="empty-state" data-testid="home-empty">
            {t(locale, 'home.empty')}
          </p>
        ) : (
          <div className="crops">
            {briefing.crops.map((item) => (
              <CropCard key={item.crop} locale={locale} item={item} quantity={quantity} />
            ))}
          </div>
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
      </section>
      {briefing.crops.length > 0 && <PriceAlert device={device} crops={briefing.crops} />}
    </div>
  );
}
