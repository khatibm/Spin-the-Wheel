import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { api, RpcError, type CampaignRef } from '@/lib/api';
import { applyLanguage } from '@/i18n';

export function PasscodeGate({ onUnlock }: { onUnlock: (c: CampaignRef, passcode: string) => void }) {
  const { t, i18n } = useTranslation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onUnlock(await api.resolveCampaign(code), code);
    } catch (err) {
      setError(err instanceof RpcError ? err.code : 'GENERIC');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_20%,rgba(34,89,255,0.45),transparent_62%)]" />

      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-ink-800/80 w-full max-w-md rounded-3xl border border-white/10 p-9 text-center backdrop-blur"
      >
        <img src="/urpay-logo.svg" alt="urpay" className="mx-auto h-7 w-auto" />
        <h1 className="mt-4 text-3xl font-extrabold text-white">{t('gate.title')}</h1>
        <p className="text-brand-300 mt-2 text-sm">{t('gate.subtitle')}</p>

        <label className="sr-only" htmlFor="passcode">{t('gate.passcode')}</label>
        <input
          id="passcode"
          data-testid="passcode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t('gate.passcode')}
          autoFocus
          dir="ltr"
          className="focus:border-brand-400 mt-7 w-full rounded-2xl border border-white/15 bg-black/30 px-5 py-4 text-center text-lg tracking-[0.2em] text-white outline-none"
        />

        {error && (
          <p data-testid="gate-error" className="mt-4 text-sm font-semibold text-red-300">
            {t(`errors.${error}`, { defaultValue: t('errors.GENERIC') })}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !code}
          data-testid="unlock"
          className="bg-brand-600 hover:bg-brand-500 mt-6 w-full rounded-2xl py-4 text-lg font-bold text-white transition disabled:opacity-40"
        >
          {t('gate.enter')}
        </button>

        <p className="text-brand-300/50 mt-5 text-xs">{t('gate.hint')}</p>

        <button
          type="button"
          onClick={() => applyLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
          className="text-brand-300/70 mt-4 text-xs underline underline-offset-4 hover:text-white"
        >
          {t('a11y.language')}
        </button>
      </motion.form>
    </div>
  );
}
