import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { api, RpcError, type CampaignRef, type SpinResult, type StageInfo } from '@/lib/api';
import { targetRotation } from '@/lib/wheelMath';
import { celebrate } from '@/lib/confetti';
import { fanfare, isMuted, setMuted, unlock, whoosh } from '@/lib/sound';
import { formatAmount } from '@/lib/utils';
import { Wheel } from './Wheel';
import { OperatorBar } from './OperatorBar';
import { WinnerReveal, type RevealData } from './WinnerReveal';

type Phase = 'idle' | 'confirming' | 'requesting' | 'spinning' | 'celebrating';

export function SpinStage({ campaign, passcode }: { campaign: CampaignRef; passcode: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const [info, setInfo] = useState<StageInfo | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<number | null>(null);
  const [reveal, setReveal] = useState<RevealData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prizeId, setPrizeId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);
  const [muted, setMutedState] = useState(isMuted());

  const rotationRef = useRef(0);
  const pending = useRef<SpinResult | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.stageInfo(campaign.id, passcode));
    } catch (e) {
      setError(errKey(e));
    }
  }, [campaign.id, passcode]);

  useEffect(() => { void load(); }, [load]);

  const nextPrize = info?.prizes.find((p) => (prizeId ? p.id === prizeId : p.remaining > 0)) ?? null;
  const canSpin = Boolean(info) && phase === 'idle' && (info?.counts.eligible ?? 0) > 0 && (nextPrize?.remaining ?? 0) > 0;

  async function runSpin() {
    setError(null);
    setPhase('requesting');
    unlock();
    try {
      // The winner is decided and committed HERE. Everything after this line
      // is presentation of a result that already exists in the database.
      const res = await api.spin({ campaignId: campaign.id, passcode, prizeId, isTest: testMode, actorLabel: 'stage' });
      pending.current = res;

      const next = targetRotation(rotationRef.current, res.winner_index, res.segment_count);
      rotationRef.current = next;
      whoosh();
      setPhase('spinning');
      setTarget(next);
    } catch (e) {
      setPhase('idle');
      setError(errKey(e));
    }
  }

  const onSettled = useCallback(async () => {
    const res = pending.current;
    if (!res) return;
    try {
      if (res.is_test && res.test_winner) {
        setReveal({
          fullName: lang === 'ar' && res.test_winner.full_name_ar ? res.test_winner.full_name_ar : res.test_winner.full_name,
          maskedMobile: res.test_winner.masked_mobile,
          prizeName: res.prize.name,
          prizeValue: res.prize.value,
          currency: res.prize.currency,
          isTest: true,
        });
      } else if (res.spin_id) {
        // Only now does the browser learn who won (spec section 40).
        const w = await api.reveal(res.spin_id, passcode);
        setReveal({
          fullName: lang === 'ar' && w.full_name_ar ? w.full_name_ar : w.full_name,
          maskedMobile: w.masked_mobile,
          prizeName: w.prize.name,
          prizeValue: w.prize.value,
          currency: w.prize.currency,
          reference: w.reference,
          spinSeq: w.spin_seq,
          isTest: false,
        });
      }
      setPhase('celebrating');
      fanfare();
      celebrate();
      void load();
    } catch (e) {
      setPhase('idle');
      setError(errKey(e));
    }
  }, [lang, passcode, load]);

  // Stage keyboard shortcuts.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Space' && phase === 'idle' && canSpin) { e.preventDefault(); setPhase('confirming'); }
      if (e.key.toLowerCase() === 'm') { const v = !muted; setMuted(v); setMutedState(v); }
      if (e.key.toLowerCase() === 'f') void document.documentElement.requestFullscreen?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, canSpin, muted]);

  const title = lang === 'ar' && campaign.name_ar ? campaign.name_ar : campaign.name;
  const tagline = lang === 'ar' && campaign.tagline_ar ? campaign.tagline_ar : campaign.tagline;

  return (
    <div
      data-phase={phase}
      data-testid="stage"
      className="relative flex h-full flex-col items-center justify-between overflow-hidden px-4 py-5"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(34,89,255,0.4),transparent_60%)]" />

      {testMode && (
        <div className="pointer-events-none absolute inset-0 z-40 border-[6px] border-amber-400/70">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 rounded-b-xl bg-amber-400 px-6 py-2 text-sm font-extrabold tracking-widest text-amber-950">
            {t('stage.testMode')}
          </div>
        </div>
      )}

      <header className="flex flex-col items-center gap-1 text-center">
        <img src="/urpay-logo.svg" alt="urpay" className="h-5 w-auto opacity-90" />
        <h1 className="mt-1 text-[clamp(1.3rem,3vw,2.4rem)] font-extrabold text-white">{title}</h1>
        {tagline && <p className="text-brand-300 text-[clamp(0.85rem,1.5vw,1.15rem)]">{tagline}</p>}
        <div className="text-brand-200/80 mt-2 flex items-center gap-6 text-sm">
          <Stat label={t('stage.eligible')} value={info?.counts.eligible ?? 0} testid="eligible-count" />
          <Stat label={t('stage.winners')} value={info?.counts.winners ?? 0} testid="winners-count" />
          <span className="text-brand-200/70">
            {t('stage.nextPrize')}:{' '}
            <bdi className="text-gold-300 font-bold">
              {nextPrize ? formatAmount(nextPrize.value, nextPrize.currency, lang) || nextPrize.name : '—'}
            </bdi>
          </span>
        </div>
      </header>

      <Wheel
        segments={info?.segments ?? []}
        target={target}
        hubLabel={nextPrize ? formatAmount(nextPrize.value, nextPrize.currency, lang) || nextPrize.name : null}
        onSettled={onSettled}
      />

      <footer className="flex w-full flex-col items-center gap-4">
        {error && (
          <p data-testid="stage-error" className="rounded-xl bg-red-500/15 px-5 py-3 text-sm font-semibold text-red-200">
            {t(`errors.${error}`, { defaultValue: t('errors.GENERIC') })}
          </p>
        )}

        <button
          data-testid="spin-button"
          disabled={!canSpin}
          onClick={() => setPhase('confirming')}
          className="from-brand-600 to-brand-800 shadow-brand-700/40 rounded-full bg-gradient-to-b px-16 py-5 text-2xl font-extrabold tracking-wide text-white shadow-2xl transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {phase === 'requesting' || phase === 'spinning' ? t('stage.selecting') : t('stage.spin')}
        </button>

        <OperatorBar
          prizes={info?.prizes ?? []}
          prizeId={prizeId}
          onPrizeId={setPrizeId}
          testMode={testMode}
          onTestMode={setTestMode}
          muted={muted}
          onMuted={(v) => { setMuted(v); setMutedState(v); unlock(); }}
          disabled={phase !== 'idle'}
        />
      </footer>

      <AnimatePresence>
        {phase === 'confirming' && nextPrize && (
          <motion.div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="bg-ink-800 w-full max-w-md rounded-3xl border border-white/10 p-8 text-center">
              <h2 className="text-2xl font-extrabold text-white">{t('stage.ready')}</h2>
              <p className="text-brand-200 mt-3">
                {t('stage.confirmBody', {
                  prize: formatAmount(nextPrize.value, nextPrize.currency, lang) || nextPrize.name,
                  count: info?.counts.eligible ?? 0,
                })}
              </p>
              {!testMode && <p className="mt-2 text-sm text-amber-300/90">{t('stage.confirmIrreversible')}</p>}
              <div className="mt-7 flex justify-center gap-3">
                <button
                  onClick={() => setPhase('idle')}
                  className="rounded-full border border-white/15 px-7 py-3 font-semibold text-white/80 hover:bg-white/5"
                >
                  {t('stage.cancel')}
                </button>
                <button
                  data-testid="confirm-spin"
                  onClick={() => void runSpin()}
                  className="bg-brand-600 hover:bg-brand-500 rounded-full px-8 py-3 font-bold text-white"
                >
                  {t('stage.spinNow')}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {phase === 'celebrating' && reveal && (
          <WinnerReveal
            data={reveal}
            onAgain={() => { setReveal(null); setTarget(null); setPhase('idle'); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-brand-300/70">{label}</span>
      <bdi data-testid={testid} className="tnum text-lg font-bold text-white">{value}</bdi>
    </span>
  );
}

function errKey(e: unknown) {
  return e instanceof RpcError ? e.code : 'GENERIC';
}
