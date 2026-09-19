/**
 * Sell: speak or type (PROMPT §6.1, §9.9-3, §10.2). The farmer says it their way ("मला ५ क्विंटल
 * कांदा विकायचा आहे", "kanda 20 quintal 1840"), the shared parser reads it on the phone as they
 * type or speak, and the confirm card shows what was understood and asks about anything it could
 * not settle. With no words at all, the card's questions are the structured form, so a listing
 * never waits on voice or on the network.
 *
 * The benchmark stays in view whenever a price is named (§9.7). A listing is saved on the phone
 * and sent through the outbox; nothing here needs a network.
 *
 * A photograph of the lot is optional and never holds the listing up (PART VII, CAM-12). The
 * camera, its worker and the grading runtime are a separate chunk, loaded only when the farmer
 * taps to take a photo.
 */
import { addDays, buildLexicon, computeBenchmark, parseListingIntent, type CropProfile } from '@fasal/shared';
import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';

import type { AttachedPhoto } from '../camera/CameraSheet';

import { Glyph } from '../design/Glyph';
import { t } from '../i18n/strings';
import { todayInIndia } from '../offline/compute';
import { effectiveType } from '../offline/reach';
import { useCameraRoute } from '../state/route';
import type { Device } from '../state/useDevice';
import { ConfirmCard } from './ConfirmCard';
import { resolve, toListingDraft, type Answers } from './draft';
import { MicButton } from './MicButton';
import { PhotoPanel } from './PhotoPanel';

const CameraSheet = lazy(() => import('../camera/CameraSheet').then((m) => ({ default: m.CameraSheet })));

export function SellScreen({ device, onListed }: { device: Device; onListed: () => void }) {
  const { locale, briefing, reach, session } = device;
  const [text, setText] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const today = todayInIndia(Date.now());
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState(addDays(today, 7));
  const [pool, setPool] = useState(false);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useCameraRoute();

  const dictionary = briefing?.dictionary ?? null;
  const registry = briefing?.registry ?? null;
  const lexicon = useMemo(() => (dictionary !== null && registry !== null ? buildLexicon(dictionary, registry) : null), [dictionary, registry]);
  const farmerDistrict = session !== null && session.status !== 'signed-out' ? session.profile.district : null;

  if (briefing === null || lexicon === null || dictionary === null || registry === null || farmerDistrict === null) {
    return (
      <p className="empty-state" data-testid="sell-unavailable">
        {t(locale, 'home.empty')}
      </p>
    );
  }

  const parsed = parseListingIntent(text, locale, { farmerDistrict, dictionary, districts: registry }, lexicon);
  const resolved = resolve(parsed, answers, farmerDistrict);
  const cropName = (id: string) => {
    const profile = dictionary.crops.find((c) => c.id === id);
    return profile === undefined ? id : profile.names[locale];
  };
  const district = registry.districts.find((d) => d.id === resolved.district);
  const districtName = district === undefined ? resolved.district : district.names[locale];
  const districtCrops: CropProfile[] = briefing.crops.map((c) => dictionary.crops.find((p) => p.id === c.crop)).filter((p): p is CropProfile => p !== undefined);
  const lead = resolved.crop === null ? null : (briefing.crops.find((c) => c.crop === resolved.crop && resolved.district === briefing.district) ?? null);
  const benchmark = lead === null ? null : computeBenchmark(lead.bundle, today);
  const market = lead === null ? null : district?.markets.find((m) => m.id === lead.bundle.market);
  const marketName = market === undefined || market === null ? districtName : locale === 'en' ? market.names.en : market.names.mr;
  const profile = resolved.crop === null ? null : (dictionary.crops.find((c) => c.id === resolved.crop) ?? null);
  const online = reach?.reachable === true;

  if (cameraOpen) {
    return (
      <Suspense fallback={<p className="muted">{t(locale, 'camera.starting')}</p>}>
        <CameraSheet
          locale={locale}
          crop={profile}
          effectiveType={effectiveType()}
          onUse={(attached) => {
            setPhoto(attached);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      </Suspense>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!resolved.ready) return;
    setPending(true);
    const draft = toListingDraft(resolved, { clientId: `listing-${crypto.randomUUID()}`.slice(0, 64), availableFrom: from, availableUntil: until < from ? from : until, poolOptIn: pool, note });
    // The grade is the farmer's, as they settled it on the camera screen (§7.5); never the model's alone.
    if (photo !== null && photo.grade !== null && photo.provenance !== null) {
      draft.grade = photo.grade;
      draft.gradeProvenance = photo.provenance;
    }
    await device.createListing(draft, text, recordingId, photo);
    setPhoto(null);
    setPending(false);
    onListed();
  };

  return (
    <form className="sell stack" onSubmit={(e) => void submit(e)} data-testid="sell">
      <h1 className="display sell__title">{t(locale, 'sell.title')}</h1>

      <div className="field">
        <div className="field__label-row">
          <label className="label" htmlFor="sell-text">
            {t(locale, 'sell.prompt')}
          </label>
          <MicButton
            locale={locale}
            online={online}
            onText={(heard) => setText(heard)}
            onRecording={(blob) => void device.keepRecording(blob).then((id) => setRecordingId(id))}
          />
        </div>
        <textarea id="sell-text" name="said" rows={3} lang={locale} placeholder={t(locale, 'sell.placeholder')} value={text} onChange={(e) => setText(e.target.value)} data-testid="sell-text" />
      </div>

      <ConfirmCard
        locale={locale}
        resolved={resolved}
        answers={answers}
        onAnswer={setAnswers}
        crops={districtCrops}
        allCrops={dictionary.crops}
        cropName={cropName}
        districtName={districtName}
        benchmark={benchmark}
        marketName={marketName}
        profile={profile}
      />

      <PhotoPanel locale={locale} photo={photo} onOpen={() => setCameraOpen(true)} onRemove={() => setPhoto(null)} />

      <section className="panel" aria-labelledby="review-title">
        <h2 id="review-title" className="panel__title">
          {t(locale, 'review.title')}
        </h2>
        <div className="row review__dates">
          <label className="field">
            <span className="label">{t(locale, 'review.from')}</span>
            <input type="date" name="from" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">{t(locale, 'review.until')}</span>
            <input type="date" name="until" value={until} min={from} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" name="pool" checked={pool} onChange={(e) => setPool(e.target.checked)} />
          <span>{t(locale, 'review.pool')}</span>
        </label>
        <label className="field">
          <span className="label">{t(locale, 'review.note')}</span>
          <input name="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!resolved.ready && (
          <p className="notice notice--caution" data-testid="review-blocked">
            <Glyph name="caution" />
            <span>{t(locale, resolved.questions.includes('price-unit') ? 'confirm.priceUnitNeeded' : 'review.blocked')}</span>
          </p>
        )}
        <button type="submit" className="btn btn--block" disabled={!resolved.ready || pending} data-testid="list-for-sale">
          <Glyph name="sell" />
          {t(locale, 'review.submit')}
        </button>
      </section>
    </form>
  );
}
