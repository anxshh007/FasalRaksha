/**
 * Phase 1's `.mic-button`, kept exactly: inline with the field label, a pill, the `listening`
 * state with `mic-pulse` (PROMPT §10.2). What it gains:
 *
 *   recognition in the selected language (mr-IN, hi-IN, en-IN), as §10.1 requires;
 *   an honest offline state. Speech recognition needs a network, so the button becomes RECORD,
 *   keeps the audio on the phone, and says the words will be written down when the network
 *   returns. The farmer carries on with the structured fields meanwhile.
 */
import { useEffect, useRef, useState } from 'react';

import { t, type Locale } from '../i18n/strings';

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

export const SPEECH_LOCALE: Record<Locale, string> = { mr: 'mr-IN', hi: 'hi-IN', en: 'en-IN' };

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function MicButton({
  locale,
  online,
  onText,
  onRecording,
}: {
  locale: Locale;
  online: boolean;
  onText: (text: string) => void;
  onRecording: (blob: Blob) => void;
}) {
  const [state, setState] = useState<'idle' | 'listening' | 'recording'>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      recognition.current?.stop();
      if (recorder.current?.state === 'recording') recorder.current.stop();
    },
    [],
  );

  const canRecognise = online && recognitionCtor() !== null;
  const canRecord = typeof window.MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined;
  const mode = canRecognise ? 'speak' : canRecord ? 'record' : 'none';

  const start = async () => {
    setNotice(null);
    if (state !== 'idle') {
      recognition.current?.stop();
      if (recorder.current?.state === 'recording') recorder.current.stop();
      return;
    }
    if (mode === 'speak') {
      const Ctor = recognitionCtor();
      if (Ctor === null) return;
      const r = new Ctor();
      r.lang = SPEECH_LOCALE[locale];
      r.interimResults = true;
      r.continuous = false;
      let heard = '';
      r.onresult = (event) => {
        heard = Array.from({ length: event.results.length }, (_, i) => event.results[i]?.[0]?.transcript ?? '').join(' ');
        onText(heard.trim());
      };
      r.onerror = (event) => setNotice(event.error === 'not-allowed' ? t(locale, 'mic.denied') : null);
      r.onend = () => setState('idle');
      recognition.current = r;
      setState('listening');
      r.start();
      return;
    }
    if (mode === 'record') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: Blob[] = [];
        const rec = new MediaRecorder(stream);
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = () => {
          stream.getTracks().forEach((track) => track.stop());
          setState('idle');
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          if (blob.size > 0) {
            onRecording(blob);
            setNotice(t(locale, 'mic.saved'));
          }
        };
        recorder.current = rec;
        rec.start();
        setState('recording');
      } catch {
        setNotice(t(locale, 'mic.denied'));
      }
      return;
    }
    setNotice(t(locale, 'mic.unsupported'));
  };

  const label = state === 'listening' ? 'mic.listening' : state === 'recording' ? 'mic.recording' : mode === 'record' ? 'mic.record' : 'mic.speak';
  return (
    <>
      <button type="button" className={`mic-button ${state !== 'idle' ? 'listening' : ''}`} onClick={() => void start()} aria-pressed={state !== 'idle'} data-testid="mic" data-mode={mode} data-lang={SPEECH_LOCALE[locale]}>
        <span className="mic-dot" aria-hidden="true" />
        {t(locale, label)}
      </button>
      {mode === 'record' && !online && <p className="field__hint" data-testid="mic-offline">{t(locale, 'mic.offlineNote')}</p>}
      {notice !== null && <p className="field__hint" role="status">{notice}</p>}
    </>
  );
}
