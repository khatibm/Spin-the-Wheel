import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useMotionValueEvent, animate, type AnimationPlaybackControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { Segment } from '@/lib/api';
import { segmentPath, segmentMidAngle } from '@/lib/wheelMath';
import { tick } from '@/lib/sound';

const R_OUTER = 460;
const R_INNER = 132;
const LED_COUNT = 60;

type Props = {
  segments: Segment[];
  /** Absolute rotation to animate to. Null means sit still. */
  target: number | null;
  /** Shown on the hub -- the prize this spin is playing for. */
  hubLabel?: string | null;
  durationSec?: number;
  onSettled?: () => void;
};

export function Wheel({ segments, target, hubLabel, durationSec = 6.5, onSettled }: Props) {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const n = Math.max(segments.length, 1);
  const rotation = useMotionValue(0);
  const lastSeg = useRef(0);
  const controls = useRef<AnimationPlaybackControls | null>(null);

  // Tick as each pin passes the pointer, quieter as the wheel slows.
  useMotionValueEvent(rotation, 'change', (v) => {
    const idx = Math.floor(v / (360 / n));
    if (idx !== lastSeg.current) {
      const speed = controls.current ? Math.max(0, Math.min(1, (rotation.getVelocity() ?? 0) / 1800)) : 0;
      tick(speed);
      lastSeg.current = idx;
    }
  });

  useEffect(() => {
    if (target == null) return;
    // A single accelerate-then-decelerate curve. Never a spring: an overshoot
    // that crossed a segment boundary would visibly land on the wrong prize.
    controls.current = animate(rotation, target, {
      duration: durationSec,
      ease: [0.12, 0.72, 0.12, 1],
      onComplete: () => onSettled?.(),
    });
    return () => controls.current?.stop();
  }, [target, durationSec, onSettled, rotation]);

  return (
    // dir is pinned LTR: the wheel must not mirror in Arabic. Only the chrome
    // around it flips. Geometry is computed in SVG user units, so CSS
    // direction cannot reach it -- this attribute guards the layout box.
    <div dir="ltr" className="relative aspect-square w-full max-w-[min(58vh,54vw,520px)]">
      <svg viewBox="-500 -500 1000 1000" className="h-full w-full drop-shadow-[0_0_60px_rgba(34,89,255,0.35)]">
        <defs>
          <radialGradient id="hub" cx="50%" cy="35%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#b8cbff" stopOpacity="0.85" />
          </radialGradient>
          <filter id="soft">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#000" floodOpacity="0.45" />
          </filter>
        </defs>

        {/* Static rim + LED pins */}
        <circle r={R_OUTER + 26} fill="#0d1530" stroke="#1638a3" strokeWidth="3" />
        {Array.from({ length: LED_COUNT }, (_, i) => {
          const a = (i / LED_COUNT) * Math.PI * 2 - Math.PI / 2;
          return (
            <circle
              key={i}
              cx={Math.cos(a) * (R_OUTER + 13)}
              cy={Math.sin(a) * (R_OUTER + 13)}
              r={5}
              fill={i % 2 ? '#f9a72d' : '#8fabff'}
              opacity={0.85}
            />
          );
        })}

        {/* The rotating face. viewBox is centred on the origin, so this needs
            no transform-origin fiddling. */}
        <motion.g data-testid="wheel-rotor" style={{ rotate: rotation }}>
          {segments.map((s, i) => {
            const mid = segmentMidAngle(i, n);
            return (
              <g key={i}>
                <path
                  d={segmentPath(i, n, R_INNER, R_OUTER)}
                  fill={s.color ?? '#1c48d6'}
                  stroke="#060a1a"
                  strokeWidth="2.5"
                  opacity={i % 2 ? 0.92 : 1}
                />
                {/* Labels past 180deg would render upside-down, so they get an
                    extra half turn to stay readable on the left of the wheel. */}
                <g
                  transform={`rotate(${mid}) translate(0 ${-(R_INNER + (R_OUTER - R_INNER) * 0.6)}) rotate(${mid > 180 ? 90 : -90})`}
                >
                  <text
                    textAnchor="middle"
                    // Per-element direction: Arabic labels read correctly
                    // without touching the wheel's geometry.
                    direction={lang === 'ar' ? 'rtl' : 'ltr'}
                    fill="#ffffff"
                    fontSize="30"
                    fontWeight="700"
                    style={{ paintOrder: 'stroke', letterSpacing: '0.01em' }}
                  >
                    {lang === 'ar' && s.name_ar ? s.name_ar : s.name}
                  </text>
                </g>
              </g>
            );
          })}
        </motion.g>

        {/* Static hub */}
        <circle r={R_INNER} fill="url(#hub)" filter="url(#soft)" />
        <circle r={R_INNER - 12} fill="#ffffff" opacity="0.06" />
        <image href="/urpay-logo-blue.svg" x={-52} y={-30} width={104} height={25.4} />
        <text textAnchor="middle" y={30} fill="#1c48d6" fontSize="21" fontWeight="600" opacity="0.85">
          {hubLabel ?? ''}
        </text>

        {/* Pointer, outside the rotating group, at 12 o'clock */}
        <g filter="url(#soft)">
          <path d={`M 0 ${-(R_OUTER + 46)} L 34 ${-(R_OUTER - 16)} L -34 ${-(R_OUTER - 16)} Z`} fill="#f9a72d" />
          <path d={`M 0 ${-(R_OUTER + 30)} L 18 ${-(R_OUTER - 8)} L -18 ${-(R_OUTER - 8)} Z`} fill="#fff7ea" />
        </g>
      </svg>
    </div>
  );
}
