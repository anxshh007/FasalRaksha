/**
 * Speech synthesis, the other half of voice (PROMPT §10.2): reads the benchmark and the answer
 * aloud in the chosen language, for a farmer who speaks comfortably but reads with difficulty.
 * Offline too: synthesis runs on the phone. Hidden where the browser has no voice at all.
 */
import { useEffect, useState } from 'react';

import { Glyph } from '../design/Glyph';
import { t, type Locale } from '../i18n/strings';
import { SPEECH_LOCALE } from './MicButton';

export function SpeakButton({ locale, text }: { locale: Locale; text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  useEffect(() => () => void (supported ? window.speechSynthesis.cancel() : undefined), [supported]);
  if (!supported) return null;
  const toggle = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LOCALE[locale];
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang === SPEECH_LOCALE[locale]);
    if (voice !== undefined) utterance.voice = voice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };
  return (
    <button type="button" className="mic-button" onClick={toggle} aria-pressed={speaking} data-testid="speak" data-lang={SPEECH_LOCALE[locale]}>
      <Glyph name={speaking ? 'refuse' : 'language'} size={16} />
      {t(locale, speaking ? 'speak.stop' : 'speak.read')}
    </button>
  );
}
