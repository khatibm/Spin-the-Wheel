import { useTranslation } from 'react-i18next';
import { Maximize2, Volume2, VolumeX, Languages, FlaskConical } from 'lucide-react';
import type { Prize } from '@/lib/api';
import { applyLanguage } from '@/i18n';
import { cn } from '@/lib/utils';

type Props = {
  prizes: Prize[];
  prizeId: string | null;
  onPrizeId: (v: string | null) => void;
  testMode: boolean;
  onTestMode: (v: boolean) => void;
  muted: boolean;
  onMuted: (v: boolean) => void;
  disabled: boolean;
};

export function OperatorBar({
  prizes, prizeId, onPrizeId, testMode, onTestMode, muted, onMuted, disabled,
}: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  const btn = 'rounded-xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 hover:text-white';

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <select
        value={prizeId ?? ''}
        disabled={disabled}
        onChange={(e) => onPrizeId(e.target.value || null)}
        className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90 disabled:opacity-40"
      >
        <option value="">{t('stage.autoPrize')}</option>
        {prizes.map((p) => (
          <option key={p.id} value={p.id} disabled={p.remaining === 0}>
            {(lang === 'ar' && p.name_ar ? p.name_ar : p.name)} · {t('stage.left', { n: p.remaining })}
          </option>
        ))}
      </select>

      <button
        onClick={() => onTestMode(!testMode)}
        disabled={disabled}
        aria-pressed={testMode}
        data-testid="test-toggle"
        className={cn(
          btn,
          'flex items-center gap-2 px-4 text-sm font-semibold disabled:opacity-40',
          testMode && 'border-amber-400/50 bg-amber-400/15 text-amber-200'
        )}
      >
        <FlaskConical size={18} />
        {t('stage.testSpin')}
      </button>

      <button onClick={() => onMuted(!muted)} className={btn} aria-label={muted ? t('a11y.unmute') : t('a11y.mute')}>
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      <button
        onClick={() => applyLanguage(lang === 'ar' ? 'en' : 'ar')}
        className={cn(btn, 'flex items-center gap-2 px-4 text-sm font-semibold')}
        data-testid="lang-toggle"
      >
        <Languages size={18} />
        {t('a11y.language')}
      </button>

      <button onClick={toggleFullscreen} className={btn} aria-label={t('a11y.fullscreen')}>
        <Maximize2 size={18} />
      </button>
    </div>
  );
}
