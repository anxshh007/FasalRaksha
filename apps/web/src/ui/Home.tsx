/**
 * Home, functional form (P8). Every figure is computed on this phone from verified bundles at the
 * moment of rendering; the line under the list says when, and a reload recomputes it. P10 turns
 * this into the morning field briefing (§9.7), with the benchmark visually dominant, the RAKSHA
 * instrument and the evidence panel.
 */
import { useState, type FormEvent } from 'react';

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
        <span className="crop__asof">{t(locale, 'home.asOf', { date: day(locale, benchmark.asOf) })}</span>
      </header>
      <p className="crop__rate">
        <span className="label">{t(locale, 'home.rate')}</span>
        <strong data-testid={`modal-${item.crop}`} data-value={benchmark.modal.amount}>
          {rupees(locale, benchmark.modal.amount)}
        </strong>
        <span className="unit">{t(locale, 'home.perQtl')}</span>
      </p>
      <p className="crop__range">
        {t(locale, 'home.range', { min: rupees(locale, benchmark.min.amount), max: rupees(locale, benchmark.max.amount) })}
        {benchmark.mspFloor !== null && <> · {t(locale, 'home.msp', { amount: rupees(locale, benchmark.mspFloor.price.amount), season: benchmark.mspFloor.season })}</>}
      </p>
      {evaluation.suppressed ? (
        <p className="crop__stale" data-testid={`verdict-${item.crop}`} data-verdict="suppressed">
          {t(locale, 'home.stale')}
        </p>
      ) : (
        <div className={`verdict verdict--${evaluation.verdict}`} data-testid={`verdict-${item.crop}`} data-verdict={evaluation.verdict}>
          <p className="verdict__headline">{t(locale, headlineKey(evaluation.headline))}</p>
          <p className="verdict__lot">{t(locale, 'home.lot', { qty: number(locale, quantity) })}</p>
          {evaluation.primaryRefusal !== null && (
            <details>
              <summary>{t(locale, 'home.why')}</summary>
              <ul>
                {evaluation.failedConditions.map((c) => (
                  <li key={c}>{t(locale, refusalKey(c))}</li>
                ))}
              </ul>
            </details>
          )}
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
      <h2 id="alert-title">{t(locale, 'alert.title')}</h2>
      <form onSubmit={(e) => void submit(e)} className="alert-form">
        <select name="crop" value={crop} onChange={(e) => setCrop(e.target.value)} aria-label={t(locale, 'alert.title')}>
          {crops.map((c) => (
            <option key={c.crop} value={c.crop}>
              {locale === 'mr' ? c.names.mr : c.names.en}
            </option>
          ))}
        </select>
        <label>
          {t(locale, 'alert.explain', { crop: cropName })}
          <input name="threshold" inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button type="submit">{t(locale, 'alert.set')}</button>
      </form>
      {saved && queue !== null && (
        <p className="note" data-testid="alert-status" data-waiting={queue.waiting} data-sent={queue.sent}>
          {queue.waiting > 0 ? t(locale, 'alert.queued') : t(locale, 'alert.sent')}
        </p>
      )}
      {queue?.rejected.map((r) => (
        <p key={r.id} className="error">
          {t(locale, 'alert.rejected', { reason: r.lastError ?? '' })}
        </p>
      ))}
    </section>
  );
}

export function Home({ device }: { device: Device }) {
  const { locale, briefing } = device;
  if (briefing === null) return null;
  const quantity = DEFAULT_CONTEXT.quantityQtl;
  return (
    <>
      <section aria-labelledby="home-title">
        <h2 id="home-title">{t(locale, 'home.title', { district: briefing.districtNames === null ? briefing.district : locale === 'mr' ? briefing.districtNames.mr : briefing.districtNames.en })}</h2>
        {briefing.crops.length === 0 ? (
          <p className="note" data-testid="home-empty">
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
        {briefing.dataSource === 'synthetic' && <p className="note">{t(locale, 'home.synthetic')}</p>}
      </section>
      {briefing.crops.length > 0 && <PriceAlert device={device} crops={briefing.crops} />}
    </>
  );
}
