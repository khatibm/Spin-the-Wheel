/**
 * WebAudio-synthesised effects. No binary assets: the tick, whoosh and fanfare
 * are generated, so there is nothing to license, source or commit.
 *
 * The AudioContext must be created inside a user gesture (browser autoplay
 * policy), so `unlock()` is called from the first SPIN / mute interaction.
 */
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('ww_muted') === '1';

export const isMuted = () => muted;

export function setMuted(v: boolean) {
  muted = v;
  localStorage.setItem('ww_muted', v ? '1' : '0');
}

export function unlock() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  }
  void ctx?.resume();
}

function env(node: AudioNode, peak: number, attack: number, decay: number) {
  if (!ctx) return null;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  node.connect(g);
  g.connect(ctx.destination);
  return g;
}

/** Pin passing the pointer. `speed` in [0,1] raises pitch and volume. */
export function tick(speed = 1) {
  if (muted || !ctx) return;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 900 + speed * 700;
  env(o, 0.05 + speed * 0.06, 0.001, 0.045);
  o.start();
  o.stop(ctx.currentTime + 0.06);
}

export function whoosh() {
  if (muted || !ctx) return;
  const dur = 1.2;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(300, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + dur);
  src.connect(f);
  env(f, 0.14, 0.15, dur);
  src.start();
}

export function fanfare() {
  if (muted || !ctx) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const o = ctx!.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx!.createGain();
    const t = ctx!.currentTime + i * 0.11;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(g);
    g.connect(ctx!.destination);
    o.start(t);
    o.stop(t + 0.9);
  });
}
