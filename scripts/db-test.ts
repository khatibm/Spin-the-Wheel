/**
 * Proofs for the claims the product actually makes.
 *
 *   A. Concurrency  -- no duplicate winners, no over-award, gapless spin_seq
 *   B. Uniformity   -- the CSPRNG draw is unbiased
 *   C. Privileges   -- the browser role cannot read customer data
 *   D. Repeat rules -- allow_previous_winners behaves, and the DB enforces it
 *   E. Rate limit   -- a stolen anon key cannot drain a campaign
 *
 * Every RPC call goes through a connection that assumes the `anon` role, which
 * is what PostgREST does on Supabase. Running these as a superuser would
 * silently bypass RLS and prove nothing.
 */
import { Client, Pool } from 'pg';
import { execFileSync } from 'node:child_process';

const ADMIN = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/winner_wheel';
const ANON = process.env.DEV_RPC_DATABASE_URL ?? 'postgres://wheel_anon:wheel_anon@127.0.0.1:5432/winner_wheel';

const CAMPAIGN = '00000000-0000-0000-0000-0000000000c1';
const PASSCODE = 'URPAY2026';

let failures = 0;
const ok = (name: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  \x1b[32mPASS\x1b[0m' : '  \x1b[31mFAIL\x1b[0m'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
};

const admin = new Pool({ connectionString: ADMIN });

/** One RPC call in its own transaction, as the anon role. */
async function rpc(client: Client, sql: string, params: unknown[]) {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    const r = await client.query(sql, params);
    await client.query('commit');
    return r.rows[0];
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

async function anonClient() {
  const c = new Client({ connectionString: ANON });
  await c.connect();
  return c;
}

function resetDb() {
  execFileSync('bash', [`${import.meta.dirname}/db-reset.sh`], { stdio: 'pipe' });
}

/** The rate limit exists to stop key theft; it would otherwise mask the
 *  results of the bulk tests below, so it is relaxed here and tested on its
 *  own in section E. */
const relaxRateLimit = (n: number) =>
  admin.query('update campaigns set max_spins_per_minute = $1 where id = $2', [n, CAMPAIGN]);

// ---------------------------------------------------------------------------
async function testConcurrency() {
  console.log('\nA. Concurrency: 30 simultaneous spins at 18 available prizes');
  resetDb();
  await relaxRateLimit(100000);

  const clients = await Promise.all(Array.from({ length: 30 }, anonClient));
  const results = await Promise.allSettled(
    clients.map((c) =>
      rpc(c, 'select spin_campaign($1,$2,null,false,$3) as r', [CAMPAIGN, PASSCODE, 'concurrency-test'])
    )
  );
  await Promise.all(clients.map((c) => c.end()));

  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  const reasons = [...new Set(rejected.map((r) => String(r.reason?.message).split('\n')[0]))];
  const expectedErr = rejected.every((r) =>
    /NO_PRIZES_REMAINING|PRIZE_EXHAUSTED/.test(String(r.reason?.message))
  );

  const q = async (sql: string) => (await admin.query(sql)).rows[0];
  const w = await q(`select count(*)::int total,
                            count(distinct customer_id)::int distinct_customers
                       from winners where not is_test`);
  const seq = await q(`select coalesce(array_agg(spin_seq order by spin_seq),'{}') s from winners where not is_test`);
  const p = await q(`select sum(remaining_quantity)::int total, min(remaining_quantity)::int lo from prizes`);
  const cc = await q(`select count(*)::int n from campaign_customers where has_won`);
  const al = await q(`select count(*)::int n from audit_logs where action='SPIN_EXECUTED'`);

  ok('18 spins succeed, 12 rejected', fulfilled === 18 && rejected.length === 12, `got ${fulfilled}/${rejected.length}`);
  ok('every rejection is a clean prize-exhausted error', expectedErr, expectedErr ? '' : `\n        reasons: ${JSON.stringify(reasons)}`);
  ok('exactly 18 winner rows', w.total === 18, `got ${w.total}`);
  ok('18 DISTINCT customers won  <-- no duplicate winners', w.distinct_customers === 18, `got ${w.distinct_customers}`);
  ok('all prize quantities drained to 0, none negative', p.total === 0 && p.lo === 0);
  ok('18 customers flagged has_won', cc.n === 18, `got ${cc.n}`);
  ok('spin_seq is gapless 1..18  <-- read-modify-write was serialized',
    JSON.stringify(seq.s) === JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)));
  ok('18 audit rows written', al.n === 18, `got ${al.n}`);
}

// ---------------------------------------------------------------------------
async function testUniformity() {
  console.log('\nB. Uniformity: 5000 test-mode draws over 100 customers');
  resetDb();
  await relaxRateLimit(100000);

  // The seed must give every customer a distinct identity, or this test would
  // measure the seed rather than the RNG.
  const seedShape = (await admin.query(
    `select count(*)::int n,
            count(distinct full_name)::int names,
            count(distinct mobile)::int mobiles from customers`)).rows[0];
  ok('seed has 100 customers with distinct names and mobiles',
    seedShape.n === 100 && seedShape.names === 100 && seedShape.mobiles === 100,
    `n=${seedShape.n} names=${seedShape.names} mobiles=${seedShape.mobiles}`);

  // Test spins persist nothing, so the pool stays at 100 throughout.
  // Tally on masked_mobile: it is unique per customer by construction here,
  // and it is the only stable identifier a test spin returns.
  const c = await anonClient();
  await c.query('begin');
  await c.query('set local role anon');
  const r = await c.query(
    `select spin_campaign($1,$2,null,true,'uniformity')->'test_winner'->>'masked_mobile' as n
       from generate_series(1,5000)`,
    [CAMPAIGN, PASSCODE]
  );
  await c.query('rollback');
  await c.end();

  const tally = new Map<string, number>();
  for (const row of r.rows) tally.set(row.n, (tally.get(row.n) ?? 0) + 1);

  const expected = 5000 / 100;
  let chi2 = 0;
  for (const [, n] of tally) chi2 += (n - expected) ** 2 / expected;

  const persisted = (await admin.query('select count(*)::int n from winners')).rows[0].n;

  ok('all 100 customers were drawn at least once', tally.size === 100, `got ${tally.size}`);
  // df=99. A working CSPRNG lands near 99; a broken one lands in the thousands.
  // Bound is deliberately loose so this cannot flake on an unlucky run.
  ok('chi-square within bounds for a uniform draw', chi2 < 180, `chi2=${chi2.toFixed(1)} (expect ~99)`);
  ok('5000 test spins persisted ZERO winners', persisted === 0, `got ${persisted}`);
}

// ---------------------------------------------------------------------------
async function testPrivileges() {
  console.log('\nC. Privileges: what the browser role can and cannot reach');
  resetDb();
  await relaxRateLimit(100000);
  const c = await anonClient();

  const denied = async (sql: string) => {
    try {
      await rpc(c, sql, []);
      return false;
    } catch (e) {
      return /permission denied/i.test(String((e as Error).message));
    }
  };

  ok('anon cannot select customers', await denied('select * from customers limit 1'));
  ok('anon cannot select winners', await denied('select * from winners limit 1'));
  ok('anon cannot select campaign_customers', await denied('select * from campaign_customers limit 1'));
  ok('anon cannot select audit_logs', await denied('select * from audit_logs limit 1'));
  ok('anon cannot insert into winners', await denied(`insert into winners default values`));

  const priv = (await admin.query(`
    select has_table_privilege('anon','public.customers','SELECT') tbl,
           has_function_privilege('anon','public.spin_campaign(uuid,text,uuid,boolean,text)','EXECUTE') fn
  `)).rows[0];
  ok('has_table_privilege(anon, customers, SELECT) is false', priv.tbl === false);
  ok('has_function_privilege(anon, spin_campaign) is true', priv.fn === true);

  let unauthorized = false;
  try {
    await rpc(c, 'select spin_campaign($1,$2,null,true,null)', [CAMPAIGN, 'wrong-passcode']);
  } catch (e) {
    unauthorized = /UNAUTHORIZED/.test(String((e as Error).message));
  }
  ok('wrong passcode is rejected', unauthorized);

  // Nothing the client receives may contain a full mobile number.
  const spin = await rpc(c, 'select spin_campaign($1,$2,null,true,null)::text as r', [CAMPAIGN, PASSCODE]);
  const payload = String(spin.r);
  ok('spin payload contains no unmasked mobile', !/\+9665\d{8}/.test(payload));
  ok('spin payload masks as +966 5*****NNN', /\+966 5\*{5}\d{3}/.test(payload));

  // A real spin must not leak the winner's identity before the wheel stops.
  const real = await rpc(c, 'select spin_campaign($1,$2,null,false,null)::text as r', [CAMPAIGN, PASSCODE]);
  const realPayload = JSON.parse(String(real.r));
  ok('real spin response carries NO winner identity', realPayload.test_winner === null);
  ok('real spin response does carry a spin_id for later reveal', typeof realPayload.spin_id === 'string');

  const rev = await rpc(c, 'select reveal_winner($1,$2)::text as r', [realPayload.spin_id, PASSCODE]);
  const revealed = JSON.parse(String(rev.r));
  ok('reveal_winner returns the name after the spin', typeof revealed.full_name === 'string');
  ok('reveal_winner still masks the mobile', /\+966 5\*{5}\d{3}/.test(revealed.masked_mobile));

  await c.end();
}

// ---------------------------------------------------------------------------
async function testRepeatRules() {
  console.log('\nD. Repeat rules: allow_previous_winners, and the DB-level guard');
  resetDb();
  await relaxRateLimit(100000);
  const c = await anonClient();

  // Shrink the pool to 1 so a second spin MUST attempt a repeat.
  await admin.query(`
    delete from campaign_customers
     where campaign_id = $1
       and id <> (select id from campaign_customers where campaign_id = $1 order by id limit 1)`,
    [CAMPAIGN]);

  await rpc(c, 'select spin_campaign($1,$2,null,false,null)', [CAMPAIGN, PASSCODE]);

  let exhausted = false;
  try {
    await rpc(c, 'select spin_campaign($1,$2,null,false,null)', [CAMPAIGN, PASSCODE]);
  } catch (e) {
    exhausted = /NO_ELIGIBLE_CUSTOMERS/.test(String((e as Error).message));
  }
  ok('a 1-customer pool refuses a second spin when repeats are OFF', exhausted);

  await admin.query('update campaigns set allow_previous_winners = true where id = $1', [CAMPAIGN]);
  let repeated = false;
  try {
    await rpc(c, 'select spin_campaign($1,$2,null,false,null)', [CAMPAIGN, PASSCODE]);
    repeated = true;
  } catch { /* ignore */ }
  ok('the same customer CAN win again once repeats are ON', repeated);

  const guard = (await admin.query(
    `select count(*) filter (where unique_guard)::int guarded,
            count(*) filter (where not unique_guard)::int unguarded
       from winners where campaign_id = $1`, [CAMPAIGN])).rows[0];
  ok('repeat wins are recorded with unique_guard = false', guard.guarded === 1 && guard.unguarded >= 1,
    `guarded=${guard.guarded} unguarded=${guard.unguarded}`);

  // The partial unique index must reject a duplicate even on a direct insert,
  // i.e. Sec 18 survives a bug in the function.
  const dup = await admin.query(`select customer_id, prize_id from winners where unique_guard limit 1`);
  let indexBlocked = false;
  try {
    await admin.query(
      `insert into winners (campaign_id, customer_id, prize_id, spin_seq, reference_number,
                            unique_guard, pool_size, draw_offset)
       values ($1,$2,$3,999,'WIN-TEST-DUP',true,1,0)`,
      [CAMPAIGN, dup.rows[0].customer_id, dup.rows[0].prize_id]);
  } catch (e) {
    indexBlocked = /winners_one_per_campaign/.test(String((e as Error).message));
  }
  ok('the DB itself rejects a duplicate guarded winner  <-- Sec 18 is declarative', indexBlocked);

  await c.end();
}

// ---------------------------------------------------------------------------
async function testRateLimit() {
  console.log('\nE. Rate limit: a stolen anon key cannot drain the campaign');
  resetDb();
  await admin.query('update campaigns set max_spins_per_minute = 5 where id = $1', [CAMPAIGN]);
  const c = await anonClient();

  let limited = 0;
  for (let i = 0; i < 10; i++) {
    try {
      await rpc(c, 'select spin_campaign($1,$2,null,false,null)', [CAMPAIGN, PASSCODE]);
    } catch (e) {
      if (/RATE_LIMITED/.test(String((e as Error).message))) limited++;
    }
  }
  const won = (await admin.query('select count(*)::int n from winners where not is_test')).rows[0].n;
  ok('spins beyond the per-minute cap are refused', limited === 5, `refused ${limited}`);
  ok('only 5 prizes were awarded despite 10 attempts', won === 5, `awarded ${won}`);

  await c.end();
}

// ---------------------------------------------------------------------------
(async () => {
  try {
    await testConcurrency();
    await testUniformity();
    await testPrivileges();
    await testRepeatRules();
    await testRateLimit();
  } catch (e) {
    console.error('\nunexpected error:', e);
    failures++;
  } finally {
    await admin.end();
  }
  console.log(failures === 0 ? '\n\x1b[32mall checks passed\x1b[0m\n' : `\n\x1b[31m${failures} check(s) failed\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
