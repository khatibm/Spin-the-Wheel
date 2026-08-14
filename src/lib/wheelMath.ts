/**
 * Wheel geometry and the landing calculation.
 *
 * The animation NEVER decides anything. The server has already committed a
 * winner and told us which segment carries the prize that was won; everything
 * here just works out how far to rotate so the pointer ends up over it.
 */

/** Annular sector path for segment `i` of `n`, drawn in a viewBox centred on
 *  the origin so rotation about (0,0) is rotation about the wheel's centre. */
export function segmentPath(i: number, n: number, rInner: number, rOuter: number): string {
  const step = (Math.PI * 2) / n;
  // -90deg puts segment 0's leading edge at 12 o'clock, matching the pointer.
  const a0 = i * step - Math.PI / 2;
  const a1 = a0 + step;
  const large = step > Math.PI ? 1 : 0;

  const [x0o, y0o] = [Math.cos(a0) * rOuter, Math.sin(a0) * rOuter];
  const [x1o, y1o] = [Math.cos(a1) * rOuter, Math.sin(a1) * rOuter];
  const [x0i, y0i] = [Math.cos(a0) * rInner, Math.sin(a0) * rInner];
  const [x1i, y1i] = [Math.cos(a1) * rInner, Math.sin(a1) * rInner];

  return [
    `M ${x0o} ${y0o}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i}`,
    'Z',
  ].join(' ');
}

/** Mid-angle of segment `i` in degrees, clockwise from 12 o'clock. */
export const segmentMidAngle = (i: number, n: number) => (i + 0.5) * (360 / n);

/**
 * Absolute rotation that leaves segment `winnerIndex` under the pointer,
 * always at least `turns` further clockwise than where the wheel is now.
 *
 * Rotating the wheel by R moves a feature at angle A to A + R. The pointer sits
 * at 0, so we need midAngle + R = 0 (mod 360), i.e. R = -midAngle (mod 360).
 * Taking an absolute target rather than a delta means repeated spins cannot
 * accumulate drift.
 *
 * `jitter` stops it landing dead-centre every time, which looks fake. It is
 * hard-capped below half a segment so it can never cross a boundary -- it
 * changes how the spin looks, never which segment wins.
 */
export function targetRotation(current: number, winnerIndex: number, n: number, turns = 8): number {
  const seg = 360 / n;
  const mid = segmentMidAngle(winnerIndex, n);
  const jitter = (Math.random() - 0.5) * seg * 0.6; // |jitter| < 0.3 * seg
  const landing = (((360 - mid + jitter) % 360) + 360) % 360;
  return Math.ceil(current / 360) * 360 + turns * 360 + landing;
}

/** Which segment currently sits under the pointer, for a given rotation. */
export function segmentAtPointer(rotationDeg: number, n: number): number {
  const seg = 360 / n;
  const norm = ((-rotationDeg % 360) + 360) % 360;
  return Math.floor(norm / seg) % n;
}
