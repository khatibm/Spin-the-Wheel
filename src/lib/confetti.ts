import confetti from 'canvas-confetti';

const COLORS = ['#8B5CF6', '#6D28D9', '#F59E0B', '#FDE68A', '#FFFFFF', '#C4B5FD'];

/** Two side cannons plus a centre burst, in three waves over ~2.5s. */
export function celebrate() {
  const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 90 };

  confetti({ ...base, particleCount: 140, spread: 90, startVelocity: 55, origin: { x: 0.5, y: 0.55 } });

  const waves = [0, 450, 950];
  for (const delay of waves) {
    setTimeout(() => {
      confetti({ ...base, particleCount: 70, angle: 60, spread: 70, origin: { x: 0, y: 0.7 } });
      confetti({ ...base, particleCount: 70, angle: 120, spread: 70, origin: { x: 1, y: 0.7 } });
    }, delay);
  }

  setTimeout(() => {
    confetti({ ...base, particleCount: 90, spread: 120, startVelocity: 40, scalar: 1.2, origin: { x: 0.5, y: 0.4 } });
  }, 1500);
}
