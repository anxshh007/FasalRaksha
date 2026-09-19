/**
 * The camera, as a product inside the product (PROMPT PART VII):
 *
 *   OPEN CAMERA → FRAME GUIDANCE → QUALITY GATE → OOD REJECTION → STABLE CAPTURE →
 *   MULTI-FRAME AGGREGATION → PROPOSAL → CONFIDENCE BAND → FARMER CONFIRMATION → PROVENANCE
 *
 * The viewfinder says one thing at a time, in the farmer's words, and never a percentage. The
 * shutter wakes after 500 ms of all-green frames. One press takes five views; the proposal is a
 * grade and a band, which the farmer confirms, changes or skips: the model proposes, the farmer
 * decides, and only the farmer's decision reaches the listing (§7.5).
 *
 * Every way the camera can fail has its own words and a way forward (CAM-01 … CAM-14). The
 * camera light goes out on every way out of this screen: close, back button, another route, a
 * hidden tab, a closed tab. The grader is fetched only when this screen opens.
 */
import type { CropProfile, Grade, GradeProvenance, GuidanceProblem, PhotoProposal } from '@fasal/shared';
import { GUIDANCE_TIMING, INITIAL_GUIDANCE, shutterReady, stepGuidance, type GuidanceState } from '@fasal/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Glyph } from '../design/Glyph';
import { t, type Locale, type StringKey } from '../i18n/strings';
import { capture, type BurstDeps, type CaptureOutcome } from './capture';
import { contentHash, openPhotoFile } from './file';
import { browserCameraEnv, openCamera, stopStream, type CameraFailure } from './media';
import { VisionClient, WorkerFault, type Encoded, type GraderStatus } from './protocol';
import { modelFor } from './runtime';

export interface AttachedPhoto {
  blob: Blob;
  width: number;
  height: number;
  contentHash: string;
  grade: Grade | null;
  provenance: GradeProvenance | null;
  proposal: PhotoProposal | null;
}

type Phase =
  | { name: 'starting' }
  | { name: 'live' }
  | { name: 'capturing'; source: 'camera' | 'file' }
  | { name: 'failed'; failure: CameraFailure }
  | { name: 'file-error'; reason: 'heic' | 'not-a-photo' | 'unreadable' }
  | { name: 'review'; outcome: CaptureOutcome; hash: string | null; url: string | null; graderWas: GraderStatus['status'] };

const UPLOAD_EDGE = 1280;
/**
 * How long a press waits for a grader still downloading. The photograph matters more than the grade:
 * past this, the photo is taken ungraded and the screen says grading was not ready yet. A chosen
 * file, with no hand to hold still, can wait longer.
 */
const GRADER_WAIT_CAMERA_MS = 4_000;
const GRADER_WAIT_FILE_MS = 20_000;
const STILL_EDGE = 800;
const GRADES: readonly Grade[] = ['A', 'B', 'C'];

const FAILURE_COPY: Record<CameraFailure, StringKey> = {
  unsupported: 'camera.unsupported',
  'no-camera': 'camera.noCamera',
  denied: 'camera.denied',
  dismissed: 'camera.dismissed',
  busy: 'camera.busy',
  constraints: 'camera.constraints',
};

const FILE_COPY = { heic: 'file.heic', 'not-a-photo': 'file.notPhoto', unreadable: 'file.unreadable' } as const satisfies Record<string, StringKey>;

function graderLine(status: GraderStatus): StringKey | null {
  if (status.status !== 'absent') return null;
  if (status.reason === 'no-model') return 'grader.no-model';
  if (status.reason === 'no-simd') return 'grader.no-simd';
  if (status.reason === 'slow-network') return 'grader.slow-network';
  return 'grader.unavailable';
}

function scaled(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A burst frame, at most 1280 px on its long edge. */
function grabFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
  const size = scaled(video.videoWidth, video.videoHeight, UPLOAD_EDGE);
  return createImageBitmap(video, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
}

/** The last rung (CAM-08): a small still straight from the video, never analysed. */
function stillFrame(source: HTMLVideoElement | ImageBitmap): Promise<Encoded | null> {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const size = scaled(w, h, STILL_EDGE);
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (context === null) return resolve(null);
      context.drawImage(source, 0, 0, size.width, size.height);
      canvas.toBlob((blob) => resolve(blob === null ? null : { blob, width: size.width, height: size.height }), 'image/jpeg', 0.82);
    } catch {
      resolve(null);
    }
  });
}

export function CameraSheet({ locale, crop, effectiveType, onUse, onClose }: { locale: Locale; crop: CropProfile | null; effectiveType: string | null; onUse: (photo: AttachedPhoto) => void; onClose: () => void }) {
  const family = crop?.visionFamily ?? null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<VisionClient | null>(null);
  const urlRef = useRef<string | null>(null);
  const askedAgain = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const [phase, setPhase] = useState<Phase>({ name: 'starting' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [grader, setGrader] = useState<GraderStatus>({ status: 'loading', reason: null, version: null });
  const graderRef = useRef(grader);
  graderRef.current = grader;
  const [guidance, setGuidance] = useState<GuidanceState>(INITIAL_GUIDANCE);
  const [ready, setReady] = useState(false);
  const [photoOnly, setPhotoOnly] = useState(false);
  const [choosing, setChoosing] = useState<Grade | null | 'open'>(null);
  const [preparing, setPreparing] = useState(false);

  const release = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  // The worker, and the grader it loads lazily for this crop's family (§7.3).
  useEffect(() => {
    let client: VisionClient | null = null;
    try {
      client = VisionClient.start();
    } catch {
      setPhotoOnly(true);
    }
    if (client === null) {
      setGrader({ status: 'absent', reason: 'runtime', version: null });
      return undefined;
    }
    client.onGrader(setGrader);
    client.configure({ family, grading: modelFor(family) !== null, runtime: { path: __ORT_WASM__.path, sha256: __ORT_WASM__.sha256 }, effectiveType });
    clientRef.current = client;
    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, [family, effectiveType]);

  const start = useCallback(async () => {
    const mine = ++generation.current;
    setPhase({ name: 'starting' });
    setReady(false);
    const result = await openCamera(browserCameraEnv());
    // Closed, or asked again, while the browser was deciding: a late stream is stopped at once.
    if (!alive.current || mine !== generation.current) {
      if (result.ok) stopStream(result.stream);
      return;
    }
    if (!result.ok) {
      setPhase({ name: 'failed', failure: result.failure });
      return;
    }
    release();
    streamRef.current = result.stream;
    const video = videoRef.current;
    if (video !== null) {
      video.muted = true;
      video.srcObject = result.stream;
      await video.play().catch(() => undefined);
    }
    setGuidance(INITIAL_GUIDANCE);
    setPhase({ name: 'live' });
  }, [release]);

  // Open on mount (the farmer's tap got us here); the light goes out on every way out.
  useEffect(() => {
    alive.current = true;
    void start();
    const onVisibility = () => {
      // CAM-06: a backgrounded camera comes back black on some phones. Let it go, then take it again.
      if (document.visibilityState === 'hidden') {
        generation.current++; // a stream still being granted is not wanted either
        release();
      }
      else if (phaseRef.current.name === 'live' || phaseRef.current.name === 'starting') void start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', release);
    return () => {
      alive.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', release);
      release();
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    };
  }, [start, release]);

  useEffect(() => {
    videoRef.current?.setAttribute('muted', ''); // iOS reads the attribute, not only the property
  }, []);

  // The viewfinder loop: ~11 fps, one frame in flight, the analysis in the worker (§7.1).
  useEffect(() => {
    if (phase.name !== 'live' || photoOnly) return undefined;
    let raf = 0;
    let last = Number.NEGATIVE_INFINITY;
    let busy = false;
    let failures = 0;
    let stopped = false;
    let state = INITIAL_GUIDANCE;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      const client = clientRef.current;
      if (busy || video === null || client === null || video.readyState < 2 || now - last < GUIDANCE_TIMING.frameIntervalMs) return;
      last = now;
      busy = true;
      createImageBitmap(video)
        .then((bitmap) => client.guide(bitmap))
        .then((problem) => {
          if (stopped) return;
          failures = 0;
          const at = performance.now();
          state = stepGuidance(state, problem, at);
          setGuidance(state);
          setReady(shutterReady(state, at));
        })
        .catch(() => {
          // A phone that cannot even analyse the viewfinder still takes a photograph (CAM-08).
          if (++failures >= 8) setPhotoOnly(true);
        })
        .finally(() => {
          busy = false;
        });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [phase.name, photoOnly]);

  const graderSettled = async (timeoutMs: number) => {
    if (graderRef.current.status !== 'loading') return;
    setPreparing(true);
    await new Promise<void>((resolve) => {
      const started = Date.now();
      const check = () => (graderRef.current.status !== 'loading' || Date.now() - started > timeoutMs ? resolve() : setTimeout(check, 100));
      check();
    });
    setPreparing(false);
  };

  const review = async (outcome: CaptureOutcome) => {
    release();
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    const url = outcome.photo === null ? null : URL.createObjectURL(outcome.photo.blob);
    urlRef.current = url;
    const hash = outcome.photo === null ? null : await contentHash(outcome.photo.blob);
    setChoosing(null);
    setPhase({ name: 'review', outcome, hash, url, graderWas: graderRef.current.status });
  };

  const depsFor = (grab: () => Promise<ImageBitmap>, still: () => Promise<Encoded | null>): BurstDeps => ({
    grab,
    view: (bitmap) => {
      const client = clientRef.current;
      if (client === null) {
        bitmap.close();
        return Promise.reject(new WorkerFault('memory', 'no worker'));
      }
      return client.view(bitmap);
    },
    encode: (id) => clientRef.current?.encode(id) ?? Promise.reject(new WorkerFault('failed', 'no worker')),
    still,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    gradingAvailable: () => graderRef.current.status === 'ready',
  });

  const shoot = async () => {
    const video = videoRef.current;
    if (video === null) return;
    setPhase({ name: 'capturing', source: 'camera' });
    if (photoOnly || clientRef.current === null) {
      const photo = await stillFrame(video);
      await review({ proposal: { kind: 'ungraded', views: photo === null ? 0 : 1, best: 0 }, photo, degraded: 'photo-only', modelVersion: null });
      return;
    }
    await graderSettled(GRADER_WAIT_CAMERA_MS);
    try {
      await review(await capture(depsFor(() => grabFrame(video), () => stillFrame(video))));
    } catch {
      const photo = await stillFrame(video);
      await review({ proposal: { kind: 'ungraded', views: photo === null ? 0 : 1, best: 0 }, photo, degraded: 'photo-only', modelVersion: null });
    }
  };

  const chooseFile = async (file: File) => {
    release();
    setPhase({ name: 'capturing', source: 'file' });
    const opened = await openPhotoFile(file);
    if (!opened.ok) {
      setPhase({ name: 'file-error', reason: opened.reason });
      return;
    }
    await graderSettled(GRADER_WAIT_FILE_MS);
    const bitmap = opened.bitmap;
    try {
      let used = false;
      const grab = () => {
        if (used) return Promise.reject(new RangeError('one frame only'));
        used = true;
        return Promise.resolve(bitmap);
      };
      await review(await capture(depsFor(grab, () => stillFrame(bitmap)), 1));
    } catch {
      setPhase({ name: 'file-error', reason: 'unreadable' });
    }
  };

  const use = (grade: Grade | null, provenance: GradeProvenance | null) => {
    if (phase.name !== 'review' || phase.outcome.photo === null || phase.hash === null) return;
    const p = phase.outcome.proposal;
    const proposal: PhotoProposal | null = p.kind === 'proposed' && phase.outcome.modelVersion !== null ? { grade: p.grade, band: p.band, views: p.views, modelVersion: phase.outcome.modelVersion } : null;
    onUse({ blob: phase.outcome.photo.blob, width: phase.outcome.photo.width, height: phase.outcome.photo.height, contentHash: phase.hash, grade, provenance, proposal });
  };

  const retake = () => {
    clientRef.current?.discard();
    void start();
  };

  const looksAt = family === null ? null : (modelFor(family) === null ? null : lookList(locale, family));
  const moisture = crop?.moistureRelevant === true;
  const graderKey = graderLine(grader);
  const shown = guidance.shown;
  const live = phase.name === 'live';

  const gradePicker = (confirmLabel: StringKey, provenance: GradeProvenance | null) => (
    <div className="grade-picker" data-testid="grade-picker">
      <p className="label">{t(locale, 'grade.choose')}</p>
      <div className="grade-picker__options" role="group" aria-label={t(locale, 'grade.choose')}>
        {GRADES.map((g) => (
          <button key={g} type="button" className="grade-picker__option" aria-pressed={choosing === g} onClick={() => setChoosing(g)} data-testid={`grade-option-${g}`}>
            {g}
          </button>
        ))}
      </div>
      {moisture && <p className="muted camera__moisture">{t(locale, 'grade.moisture')}</p>}
      <button type="button" className="btn btn--block" disabled={choosing === null || choosing === 'open'} onClick={() => use(choosing === 'open' ? null : choosing, provenance)} data-testid="grade-use">
        {t(locale, confirmLabel)}
      </button>
    </div>
  );

  return (
    <section className="camera" aria-labelledby="camera-title" data-testid="camera" data-phase={phase.name}>
      <header className="camera__head">
        <h2 id="camera-title" className="panel__title">
          {t(locale, 'photo.title')}
        </h2>
        <button type="button" className="btn btn--quiet" onClick={onClose} data-testid="camera-close">
          {t(locale, 'photo.close')}
        </button>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="camera-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file !== undefined) void chooseFile(file);
        }}
      />

      <div className="camera__viewfinder" hidden={!(live || phase.name === 'starting' || (phase.name === 'capturing' && phase.source === 'camera'))}>
        <video ref={videoRef} className="camera__video" playsInline muted autoPlay data-testid="viewfinder" />
        <div className="camera__frame" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>

      {phase.name === 'starting' && <p className="muted" data-testid="camera-starting">{t(locale, 'camera.starting')}</p>}

      {live && (
        <>
          <p className="camera__guidance" role="status" aria-live="polite" data-testid="guidance" data-problem={shown === undefined ? 'none' : (shown ?? 'ready')}>
            {photoOnly ? t(locale, 'camera.photoOnly') : shown === undefined ? t(locale, 'camera.frame') : shown === null ? t(locale, 'camera.ready') : t(locale, `guidance.${shown satisfies GuidanceProblem}`)}
          </p>
          {grader.status === 'loading' && modelFor(family) !== null && <p className="muted camera__grader">{t(locale, 'grader.loading')}</p>}
          {graderKey !== null && (
            <p className="muted camera__grader" data-testid="grader-absent" data-reason={grader.reason ?? ''}>
              {t(locale, graderKey)}
            </p>
          )}
          <button type="button" className="btn btn--block camera__shutter" disabled={!(ready || photoOnly)} onClick={() => void shoot()} data-testid="shutter" data-ready={String(ready || photoOnly)}>
            <Glyph name="camera" />
            {t(locale, 'camera.shutter')}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => fileRef.current?.click()} data-testid="camera-choose-file">
            {t(locale, 'photo.chooseFile')}
          </button>
        </>
      )}

      {phase.name === 'capturing' && (
        <p className="camera__guidance" role="status" data-testid="capturing">
          <span className="spinner" aria-hidden="true" />
          {t(locale, preparing ? 'grader.loading' : phase.source === 'camera' ? 'camera.holdStill' : 'camera.preparing')}
        </p>
      )}

      {phase.name === 'failed' && (
        <div className="camera__failure stack" data-testid="camera-failure" data-failure={phase.failure}>
          <p className="notice notice--caution">
            <Glyph name="caution" />
            <span>{t(locale, FAILURE_COPY[phase.failure])}</span>
          </p>
          {phase.failure === 'dismissed' && !askedAgain.current && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                askedAgain.current = true; // one retry, never a loop (CAM-03)
                void start();
              }}
              data-testid="camera-ask-again"
            >
              {t(locale, 'camera.askAgain')}
            </button>
          )}
          {phase.failure === 'busy' && (
            <button type="button" className="btn btn--secondary" onClick={() => void start()} data-testid="camera-retry">
              {t(locale, 'camera.retry')}
            </button>
          )}
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} data-testid="camera-choose-file">
            {t(locale, 'photo.chooseFile')}
          </button>
        </div>
      )}

      {phase.name === 'file-error' && (
        <div className="camera__failure stack" data-testid="file-error" data-reason={phase.reason}>
          <p className="notice notice--caution">
            <Glyph name="caution" />
            <span>{t(locale, FILE_COPY[phase.reason])}</span>
          </p>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} data-testid="camera-choose-file">
            {t(locale, 'photo.chooseFile')}
          </button>
          <button type="button" className="btn btn--secondary" onClick={retake} data-testid="camera-retake">
            {t(locale, 'photo.retake')}
          </button>
        </div>
      )}

      {phase.name === 'review' && (
        <div className="camera__review stack" data-testid="camera-review" data-outcome={phase.outcome.proposal.kind} data-degraded={phase.outcome.degraded ?? 'none'}>
          {phase.url !== null && <img className="camera__still" src={phase.url} alt={t(locale, 'photo.title')} data-testid="camera-still" width={phase.outcome.photo?.width} height={phase.outcome.photo?.height} />}

          {phase.outcome.proposal.kind === 'proposed' && choosing === null && (
            <section className="proposal" data-testid="proposal" data-grade={phase.outcome.proposal.grade} data-band={phase.outcome.proposal.band} data-views={phase.outcome.proposal.views}>
              <p className="label">{t(locale, 'grade.proposed')}</p>
              <p className="proposal__grade display">{t(locale, 'grade.value', { grade: phase.outcome.proposal.grade })}</p>
              <dl className="proposal__facts">
                <dt>{t(locale, 'grade.band')}</dt>
                <dd data-testid="proposal-band">{t(locale, `grade.band.${phase.outcome.proposal.band}`)}</dd>
              </dl>
              <p className="muted" data-testid="proposal-views">
                {phase.outcome.proposal.views === 1 ? t(locale, 'grade.view') : t(locale, 'grade.views', { n: phase.outcome.proposal.views })}
              </p>
              {looksAt !== null && <p className="muted">{t(locale, 'grade.looksAt', { list: looksAt })}</p>}
              {moisture && (
                <p className="notice notice--caution" data-testid="moisture">
                  <Glyph name="caution" />
                  <span>{t(locale, 'grade.moisture')}</span>
                </p>
              )}
              <p className="proposal__question">{t(locale, 'grade.question')}</p>
              <div className="proposal__actions">
                <button type="button" className="btn" onClick={() => phase.outcome.proposal.kind === 'proposed' && use(phase.outcome.proposal.grade, 'farmer-declared-ai-assisted')} data-testid="grade-confirm">
                  {t(locale, 'grade.confirm')}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => setChoosing('open')} data-testid="grade-change">
                  {t(locale, 'grade.change')}
                </button>
                <button type="button" className="btn btn--secondary" onClick={() => use(null, null)} data-testid="grade-skip">
                  {t(locale, 'grade.skip')}
                </button>
              </div>
            </section>
          )}
          {phase.outcome.proposal.kind === 'proposed' && choosing !== null && gradePicker('grade.use', 'farmer-declared')}

          {phase.outcome.proposal.kind === 'ungraded' && phase.outcome.photo !== null && (
            <section className="stack" data-testid="ungraded">
              <p className="muted" data-testid="ungraded-why">
                {t(locale, phase.outcome.degraded === 'photo-only' ? 'grader.memory' : phase.graderWas === 'loading' ? 'grader.notReady' : (graderKey ?? 'grader.unavailable'))}
              </p>
              <p className="label">{t(locale, 'grade.yourOwn')}</p>
              {gradePicker('grade.use', 'farmer-declared')}
              <button type="button" className="btn btn--secondary btn--block" onClick={() => use(null, null)} data-testid="photo-use">
                {t(locale, 'outcome.usePhoto')}
              </button>
            </section>
          )}

          {phase.outcome.proposal.kind === 'out-of-distribution' && (
            <p className="notice notice--caution" data-testid="outcome-ood">
              <Glyph name="caution" />
              <span>{t(locale, 'outcome.ood')}</span>
            </p>
          )}

          {phase.outcome.proposal.kind === 'no-usable-view' && (
            <section className="stack" data-testid="outcome-no-usable" data-problem={phase.outcome.proposal.problem}>
              <p className="notice notice--caution">
                <Glyph name="caution" />
                <span>{t(locale, 'outcome.noUsable', { problem: t(locale, `problem.${phase.outcome.proposal.problem}`) })}</span>
              </p>
              <button type="button" className="btn btn--secondary btn--block" onClick={() => use(null, null)} data-testid="photo-use-anyway">
                {t(locale, 'outcome.useAnyway')}
              </button>
            </section>
          )}

          <div className="camera__again">
            <button type="button" className="btn btn--secondary" onClick={retake} data-testid="camera-retake">
              {t(locale, 'photo.retake')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => fileRef.current?.click()} data-testid="camera-choose-file">
              {t(locale, 'photo.chooseFile')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function lookList(locale: Locale, family: NonNullable<CropProfile['visionFamily']>): string {
  const keys: Record<NonNullable<CropProfile['visionFamily']>, StringKey[]> = {
    tuber_bulb: ['look.rot', 'look.sprouting', 'look.greening', 'look.surface-damage'],
    solanaceous_fruit: ['look.ripeness', 'look.cracks', 'look.spots'],
    tropical_fruit: ['look.ripeness', 'look.spots', 'look.bruising'],
    grain_lot: ['look.foreign-matter', 'look.chaff', 'look.mould', 'look.pest-damage'],
    legume_lot: ['look.foreign-matter', 'look.split-grains', 'look.pest-damage', 'look.discolouration'],
    oilseed_lot: ['look.foreign-matter', 'look.seed-stain', 'look.split-seeds', 'look.discolouration'],
    fibre_lot: ['look.trash', 'look.yellowing', 'look.stains'],
  };
  return keys[family].map((k) => t(locale, k)).join(', ');
}
