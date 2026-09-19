/**
 * Sign in with a phone number and a one-time code, then verify the farmer record that fixes
 * district and village (P1-09: farmer verification establishes identity; it is not a barrier to
 * seeing prices). Phase 1's auth panel and verification round-trip, on the design system: the
 * honest test-build sentence is kept, the padlock and shield chips are not (P1-07).
 */
import { useState, type FormEvent } from 'react';

import { Glyph } from '../design/Glyph';
import { t } from '../i18n/strings';
import { identity, type Device } from '../state/useDevice';

function reasonOf(result: { kind: string; message?: string; code?: string }, fallback: string): string {
  return result.message !== undefined && result.message !== '' ? result.message : (result.code ?? fallback);
}

function Problem({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className="notice notice--error" role="alert">
      <Glyph name="caution" />
      <span>{message}</span>
    </p>
  );
}

export function SignIn({ device }: { device: Device }) {
  const { locale } = device;
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await identity.requestCode(phone);
    setPending(false);
    if (result.kind === 'unreachable') return setError(t(locale, 'signin.offline'));
    if (result.kind !== 'ok') return setError(t(locale, 'error.generic', { reason: reasonOf(result, result.kind) }));
    setDevCode(result.body.devCode ?? null);
    setStep('code');
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await identity.verifyCode(phone, code, name.trim() || '—', locale);
    if (result.kind === 'unreachable') {
      setPending(false);
      return setError(t(locale, 'signin.offline'));
    }
    if (result.kind !== 'ok') {
      setPending(false);
      return setError(t(locale, 'error.generic', { reason: reasonOf(result, result.kind) }));
    }
    await device.adopt(result.body.accessToken);
    setPending(false);
  };

  return (
    <section className="panel" aria-labelledby="signin-title">
      <h2 id="signin-title" className="panel__title">
        {t(locale, 'signin.title')}
      </h2>
      {step === 'phone' ? (
        <form onSubmit={(e) => void sendCode(e)}>
          <label className="field">
            <span className="field__label-row">
              <span className="label">{t(locale, 'signin.phone')}</span>
            </span>
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--block" disabled={pending}>
            {pending && <span className="spinner" aria-hidden="true" />}
            {t(locale, 'signin.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)}>
          {devCode !== null && (
            <p className="notice" data-testid="dev-code" data-code={devCode}>
              <span className="figure">{t(locale, 'signin.devCode', { code: devCode })}</span>
            </p>
          )}
          <label className="field">
            <span className="field__label-row">
              <span className="label">{t(locale, 'signin.code')}</span>
            </span>
            <input name="code" className="figure" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label-row">
              <span className="label">{t(locale, 'signin.name')}</span>
            </span>
            <input name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={pending}>
              {pending && <span className="spinner" aria-hidden="true" />}
              {t(locale, 'signin.continue')}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setStep('phone')}>
              {t(locale, 'signin.back')}
            </button>
          </div>
        </form>
      )}
      <Problem message={error} />
    </section>
  );
}

export function VerifyFarmer({ device }: { device: Device }) {
  const { locale, reach } = device;
  const [id, setId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await identity.verifyFarmer(id.trim());
    if (result.kind === 'ok') {
      await device.reloadProfile();
    } else {
      setError(result.kind === 'unreachable' ? t(locale, 'signin.offline') : t(locale, 'error.generic', { reason: reasonOf(result, result.kind) }));
    }
    setPending(false);
  };

  return (
    <section className="panel" aria-labelledby="verify-title" style={{ maxWidth: 560 }}>
      <h2 id="verify-title" className="panel__title">
        {t(locale, 'verify.title')}
      </h2>
      <p className="muted">{t(locale, 'verify.explain')}</p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label-row">
            <span className="label">{t(locale, 'verify.id')}</span>
          </span>
          <input name="pmkisan" className="figure" required value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="characters" spellCheck={false} />
        </label>
        <button type="submit" className="btn btn--block" disabled={pending || reach?.reachable === false}>
          {pending && <span className="spinner" aria-hidden="true" />}
          <Glyph name="seal" />
          {t(locale, 'verify.submit')}
        </button>
      </form>
      <p className="field__hint">{t(locale, 'signin.verifyNote')}</p>
      <Problem message={error} />
    </section>
  );
}
