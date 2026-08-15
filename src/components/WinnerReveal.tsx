import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { formatAmount } from '@/lib/utils';

export type RevealData = {
  fullName: string;
  maskedMobile: string;
  prizeName: string;
  prizeValue: number | null;
  currency: string;
  reference?: string;
  spinSeq?: number;
  isTest: boolean;
};

export function WinnerReveal({ data, onAgain }: { data: RevealData; onAgain: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [carLoaded, setCarLoaded] = useState(true);

  return (
    <motion.div
      data-testid="winner-reveal"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center px-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      {/* Two layers: a near-opaque wash to kill the wheel underneath, then the
          brand glow on top. A translucent overlay let the wheel's labels show
          through and fight the winner's name -- unreadable on a projector. */}
      <div className="absolute inset-0 -z-10 bg-ink-900/95 backdrop-blur-xl" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_45%,rgba(34,89,255,0.45),transparent_60%)]" />

      <motion.div
        initial={{ scale: 0.85, opacity: 0, filter: 'blur(12px)' }}
        animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 140, damping: 16, delay: 0.1 }}
        className="flex flex-col items-center gap-5"
      >
        <p className="text-gold-400 text-[clamp(1rem,2.4vw,1.9rem)] font-bold tracking-[0.18em]">
          🎉 {t('reveal.heading')} 🎉
        </p>

        <p className="text-brand-200 text-[clamp(0.95rem,1.8vw,1.4rem)]">{t('reveal.congrats')}</p>

        <h1
          data-testid="winner-name"
          className="max-w-[16ch] text-[clamp(2.6rem,8.5vw,8rem)] leading-[0.95] font-extrabold text-white"
        >
          {data.fullName}
        </h1>

        {/* bdi isolates the Latin-digit number inside an RTL paragraph --
            without it the browser reorders the phone number into garbage. */}
        <bdi className="tnum text-brand-200 text-[clamp(1rem,2.2vw,1.7rem)] font-semibold tracking-wide">
          {data.maskedMobile}
        </bdi>

        {carLoaded && (
          <motion.img
            src="/jaecoo-j5.png"
            alt={data.prizeName}
            onError={() => setCarLoaded(false)}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 14, delay: 0.3 }}
            className="mt-2 max-h-[28vh] w-auto max-w-[min(90vw,640px)] object-contain drop-shadow-[0_20px_50px_rgba(34,89,255,0.4)]"
          />
        )}

        <div className="border-gold-400/40 bg-gold-500/10 mt-3 rounded-2xl border px-8 py-5">
          <p className="text-gold-300 text-[clamp(0.7rem,1.1vw,0.9rem)] tracking-[0.22em] uppercase">
            {t('reveal.prize')}
          </p>
          <p className="text-gold-300 mt-1 text-[clamp(1.8rem,4.6vw,3.6rem)] font-extrabold">
            🚗 <bdi>{formatAmount(data.prizeValue, data.currency, lang) || data.prizeName}</bdi>
          </p>
          <p className="text-gold-300/80 mt-1 text-[clamp(0.8rem,1.3vw,1rem)] font-semibold">
            {t('reveal.luckyWinner')}
          </p>
        </div>

        {data.isTest ? (
          <p className="mt-2 rounded-full bg-amber-400/15 px-4 py-2 text-sm font-semibold text-amber-300">
            {t('reveal.testNotice')}
          </p>
        ) : (
          data.reference && (
            <p className="text-brand-300/70 tnum mt-2 text-sm">
              {t('reveal.reference')} <bdi className="font-semibold">{data.reference}</bdi>
            </p>
          )
        )}

        <button
          onClick={onAgain}
          className="bg-brand-600 hover:bg-brand-500 mt-6 rounded-full px-10 py-4 text-lg font-bold text-white transition"
        >
          {t('reveal.spinAgain')}
        </button>
      </motion.div>
    </motion.div>
  );
}
