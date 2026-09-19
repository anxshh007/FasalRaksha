/**
 * Sign in with a phone number and a one-time code, then (P1-09) verify the farmer record that
 * fixes district and village. Farmer verification establishes identity; it is not a barrier to
 * seeing prices. P9–P11 give these screens their final design and copy.
 */
import { useState, type FormEvent } from 'react';

import { t } from '../i18n/strings';
import { identity, type Device } from '../state/useDevice';

function reasonOf(result: { kind: string; message?: string; code?: string }, fallback: string): string {
  return result.message !== undefined && result.message !== '' ? result.message : (result.code ?? fallback);
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
      <h2 id="signin-title">{t(locale, 'signin.title')}</h2>
      {step === 'phone' ? (
        <form onSubmit={(e) => void sendCode(e)}>
          <label>
            {t(locale, 'signin.phone')}
            <input name="phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button type="submit" disabled={pending}>
            {t(locale, 'signin.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)}>
          {devCode !== null && (
            <p className="note" data-testid="dev-code" data-code={devCode}>
              {t(locale, 'signin.devCode', { code: devCode })}
            </p>
          )}
          <label>
            {t(locale, 'signin.code')}
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <label>
            {t(locale, 'signin.name')}
            <input name="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="submit" disabled={pending}>
            {t(locale, 'signin.continue')}
          </button>
        </form>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
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
    <section className="panel" aria-labelledby="verify-title">
      <h2 id="verify-title">{t(locale, 'verify.title')}</h2>
      <p>{t(locale, 'verify.explain')}</p>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          {t(locale, 'verify.id')}
          <input name="pmkisan" required value={id} onChange={(e) => setId(e.target.value)} autoCapitalize="characters" />
        </label>
        <button type="submit" disabled={pending || reach?.reachable === false}>
          {t(locale, 'verify.submit')}
        </button>
      </form>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
