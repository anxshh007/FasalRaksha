/**
 * The photograph on the sell screen (PROMPT PART VII): before, an invitation and why it matters;
 * after, the photo, the grade the farmer settled on and how, and a way to retake or remove it.
 * The grade line names who decided: the farmer, alone or checking against the photo (§7.5). The
 * object URL for the thumbnail is released when the photo changes or the panel goes.
 */
import { useEffect, useState } from 'react';

import type { AttachedPhoto } from '../camera/CameraSheet';
import { Glyph } from '../design/Glyph';
import { t, type Locale } from '../i18n/strings';

export function gradeLine(locale: Locale, grade: string | null, provenance: string | null): string {
  if (grade === null) return t(locale, 'photo.noGrade');
  return t(locale, provenance === 'farmer-declared-ai-assisted' ? 'photo.gradeChecked' : 'photo.gradeMine', { grade });
}

export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (blob === null) {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function PhotoPanel({ locale, photo, onOpen, onRemove }: { locale: Locale; photo: AttachedPhoto | null; onOpen: () => void; onRemove: () => void }) {
  const url = useObjectUrl(photo?.blob ?? null);
  return (
    <section className="panel photo-panel" aria-labelledby="photo-title" data-testid="photo-panel" data-attached={String(photo !== null)}>
      <h2 id="photo-title" className="panel__title">
        {t(locale, 'photo.title')}
      </h2>
      {photo === null ? (
        <>
          <p className="muted">{t(locale, 'photo.why')}</p>
          <button type="button" className="btn btn--secondary" onClick={onOpen} data-testid="photo-add">
            <Glyph name="camera" />
            {t(locale, 'photo.add')}
          </button>
        </>
      ) : (
        <div className="photo-panel__attached">
          {url !== null && <img className="photo-panel__thumb" src={url} alt={t(locale, 'photo.title')} width={photo.width} height={photo.height} />}
          <div className="stack">
            <p data-testid="photo-grade" data-grade={photo.grade ?? ''} data-provenance={photo.provenance ?? ''}>
              {gradeLine(locale, photo.grade, photo.provenance)}
            </p>
            <p className="muted">{t(locale, 'photo.attached')}</p>
            <div className="row">
              <button type="button" className="btn btn--secondary" onClick={onOpen} data-testid="photo-retake">
                {t(locale, 'photo.retake')}
              </button>
              <button type="button" className="btn btn--quiet" onClick={onRemove} data-testid="photo-remove">
                {t(locale, 'photo.remove')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
