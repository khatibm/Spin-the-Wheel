/**
 * End-to-end verification of the stage.
 *
 * The important assertion is not "a screenshot rendered" -- it is that the
 * wheel's FINAL ANGLE lands on the segment the server chose. That is the whole
 * of spec sections 17/40 as far as the client is concerned, and it is checked
 * on every spin by reading the rotor's computed transform and deriving the
 * segment under the pointer.
 *
 * Uses playwright-core against the preinstalled Chromium. `playwright install`
 * is never run.
 */
import { chromium, type Browser, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EXE = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const OUT = 'artifacts';
const PASSCODE = 'URPAY2026';

let failures = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

/** Segment currently under the 12 o'clock pointer, from a rotation in degrees. */
const segmentAtPointer = (deg: number, n: number) => Math.floor(((((-deg % 360) + 360) % 360) / (360 / n))) % n;

async function rotorAngle(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="wheel-rotor"]') as SVGGElement | null;
    if (!el) return NaN;
    const cs = getComputedStyle(el as unknown as Element);
    if (cs.transform && cs.transform !== 'none') {
      const m = cs.transform.match(/matrix\(([^)]+)\)/);
      if (m) {
        const [a, b] = m[1].split(',').map(Number);
        return (Math.atan2(b, a) * 180) / Math.PI;
      }
    }
    const r = (cs as unknown as { rotate?: string }).rotate;
    if (r && r !== 'none') return parseFloat(r);
    return NaN;
  });
}

async function unlock(page: Page, lang: 'en' | 'ar') {
  await page.addInitScript((l) => localStorage.setItem('ww_lang', l), lang);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId('passcode').fill(PASSCODE);
  await page.getByTestId('unlock').click();
  await page.getByTestId('stage').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
}

/** One spin. Returns the server's winner_index and the wheel's final segment. */
async function spinOnce(page: Page) {
  let winnerIndex = -1;
  let segCount = 0;
  const onResponse = async (res: import('playwright-core').Response) => {
    if (res.url().includes('/api/rpc/spin_campaign') && res.ok()) {
      const j = await res.json().catch(() => null);
      if (j && typeof j.winner_index === 'number') {
        winnerIndex = j.winner_index;
        segCount = j.segment_count;
      }
    }
  };
  page.on('response', onResponse);

  await page.getByTestId('spin-button').click();
  await page.getByTestId('confirm-spin').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="stage"]')?.getAttribute('data-phase') === 'celebrating', undefined, { timeout: 25000 });
  await page.waitForTimeout(300);

  const angle = await rotorAngle(page);
  page.off('response', onResponse);
  return { winnerIndex, segCount, landed: segmentAtPointer(angle, segCount), angle };
}

async function run(browser: Browser) {
  mkdirSync(OUT, { recursive: true });

  // --- 1920x1080, English -------------------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01-gate.png` });

  await unlock(page, 'en');
  await page.screenshot({ path: `${OUT}/02-stage-idle.png` });

  // Mid-spin frame.
  const midShot = (async () => {
    await page.waitForFunction(() => document.querySelector('[data-testid="stage"]')?.getAttribute('data-phase') === 'spinning', undefined, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/03-spinning.png` });
  })();

  const first = await spinOnce(page);
  await midShot.catch(() => {});
  await page.screenshot({ path: `${OUT}/04-reveal.png` });

  ok('wheel lands on the segment the server chose',
    first.winnerIndex >= 0 && first.landed === first.winnerIndex,
    `server=${first.winnerIndex} landed=${first.landed}`);

  const revealedName = await page.getByTestId('winner-name').textContent();
  ok('winner name is revealed', Boolean(revealedName?.trim()), `"${revealedName?.trim()}"`);

  const bodyText = await page.locator('body').innerText();
  ok('no unmasked mobile number anywhere on the stage', !/\+9665\d{8}/.test(bodyText));
  ok('mobile is shown masked', /\+966 5\*{5}\d{3}/.test(bodyText));

  // --- repeat spins: the landing assertion is the real test ---------------
  let landedOk = 1;
  const rounds = 6;
  for (let i = 0; i < rounds; i++) {
    await page.getByRole('button', { name: /spin again|إدارة أخرى/i }).click();
    await page.waitForTimeout(400);
    const r = await spinOnce(page);
    if (r.winnerIndex >= 0 && r.landed === r.winnerIndex) landedOk++;
    else console.log(`      round ${i + 2}: server=${r.winnerIndex} landed=${r.landed} angle=${r.angle.toFixed(1)}`);
  }
  ok(`wheel landed correctly on all ${rounds + 1} spins`, landedOk === rounds + 1, `${landedOk}/${rounds + 1}`);

  // --- test mode ----------------------------------------------------------
  await page.getByRole('button', { name: /spin again|إدارة أخرى/i }).click();
  await page.waitForTimeout(300);
  await page.getByTestId('test-toggle').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/05-testmode.png` });
  const winnersBefore = await page.getByTestId('winners-count').textContent();
  await spinOnce(page);
  await page.waitForTimeout(400);
  const winnersAfter = await page.getByTestId('winners-count').textContent();
  ok('a test spin does not increase the winner count', winnersBefore === winnersAfter, `${winnersBefore} -> ${winnersAfter}`);
  await ctx.close();

  // --- Arabic / RTL -------------------------------------------------------
  const arCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const arPage = await arCtx.newPage();
  await unlock(arPage, 'ar');
  await arPage.screenshot({ path: `${OUT}/06-stage-ar.png` });

  const dir = await arPage.evaluate(() => document.documentElement.dir);
  ok('document direction flips to rtl in Arabic', dir === 'rtl', dir);

  // The wheel must NOT mirror: its container stays LTR.
  const wheelDir = await arPage.evaluate(() => {
    const rotor = document.querySelector('[data-testid="wheel-rotor"]');
    const box = rotor?.closest('div[dir]') as HTMLElement | null;
    return box?.getAttribute('dir') ?? 'unset';
  });
  ok('wheel container stays LTR so the wheel does not mirror', wheelDir === 'ltr', wheelDir);

  const arSpin = await spinOnce(arPage);
  ok('wheel lands correctly in Arabic too',
    arSpin.winnerIndex >= 0 && arSpin.landed === arSpin.winnerIndex,
    `server=${arSpin.winnerIndex} landed=${arSpin.landed}`);
  await arPage.screenshot({ path: `${OUT}/07-reveal-ar.png` });
  await arCtx.close();

  // --- mobile -------------------------------------------------------------
  const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mPage = await mCtx.newPage();
  await unlock(mPage, 'en');
  await mPage.screenshot({ path: `${OUT}/08-mobile.png` });
  const scrollX = await mPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('no horizontal overflow at 390px', scrollX <= 1, `overflow=${scrollX}px`);
  await mCtx.close();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    await run(browser);
  } catch (e) {
    console.error('\nunexpected error:', e);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? '\n\x1b[32mall checks passed\x1b[0m\n' : `\n\x1b[31m${failures} check(s) failed\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
