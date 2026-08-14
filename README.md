# urpay Winner Wheel

A full-screen spin-the-wheel for picking prize winners at a live promotional
event, backed by a winner-selection process that is **cryptographically random,
atomic, and decided entirely server-side**.

The wheel is theatre. The database is the referee.

<!-- Run `npm run shots` to regenerate artifacts/ -->

---

## What this MVP covers

This is the **spin-the-wheel stage**: the part you put on a projector. It runs
against seeded demo data and exercises the real selection logic end to end.

The admin portal (Excel import, customer management, campaign/prize CRUD,
winner history, exports, reports, certificates) is **deliberately not built
yet** — see [Deferred](#deferred).

## Quick start

Requires Node 22+ and a local PostgreSQL 16 (already present in the dev
container; `scripts/pg-up.sh` starts it).

```bash
npm install
npm run db:reset     # start postgres, apply migrations, seed demo data
npm run dev          # http://127.0.0.1:5173
```

Passcode for the demo campaign: **`URPAY2026`**

```bash
npm run db:test      # the proofs below (27 checks)
npm run shots        # end-to-end browser verification + screenshots
```

**Stage keys:** `Space` spin · `F` fullscreen · `M` mute

---

## How the fairness guarantee actually works

Everything security-critical lives in one SQL function, `spin_campaign()`, in
`supabase/migrations/0005_rpc_spin.sql`. The React app never decides anything.

```
click SPIN
   -> spin_campaign() runs in ONE transaction:
        advisory lock  ->  guards  ->  pick prize  ->  count pool
        ->  CSPRNG draw  ->  write winner  ->  audit
   -> the winner is now committed and immutable
   -> only THEN does the wheel start animating
   -> wheel stops on the segment carrying the prize that was won
   -> reveal_winner() returns the name
```

Four things make this hold up:

**The lock comes before the count.** `pg_advisory_xact_lock` is taken on the
campaign *before* the eligible pool is counted. The draw is count-then-offset,
so two transactions that counted the same pool could otherwise pick the same
offset and resolve the same customer. Locking first removes that race entirely.
It is an `_xact_` lock, so it releases on commit, rollback *or* client
disconnect — a laptop dying mid-spin cannot wedge the campaign.

**The randomness is not `random()`.** Postgres's `random()` is a PRNG and is as
unsuitable here as `Math.random()`. The draw uses pgcrypto's `gen_random_bytes`
with **rejection sampling** — values in the ragged tail above the largest
multiple of the pool size are discarded and redrawn, which removes modulo bias
completely rather than merely making it small.

**"One win per campaign" is a database constraint, not a code path.** A partial
unique index (`winners_one_per_campaign`) covers exactly the rows drawn under
no-repeat rules. If the function logic ever regressed, Postgres itself would
still refuse the duplicate. Same story for prize counts: a
`CHECK (remaining_quantity >= 0)` plus a guarded `UPDATE ... WHERE
remaining_quantity > 0` makes over-award structurally impossible.

**The browser has no table privileges at all.** Every table has RLS enabled with
no `anon` policy — deny-all. `anon` holds `EXECUTE` on exactly five functions
and nothing else. Customer data has no path to the client except through
`SECURITY DEFINER` functions that return masked, aggregate, or post-hoc values.
Mobile numbers are masked *in SQL* (`+966 5*****467`), so an unmasked number
cannot reach the browser even by accident.

> Note: Postgres grants `EXECUTE` to `PUBLIC` on every new function by default.
> `0007_rls_and_grants.sql` revokes that and sets `ALTER DEFAULT PRIVILEGES`, so
> functions added later are not silently exposed. This is the most common
> Supabase RLS bypass in the wild.

### What is proven, not just claimed

`npm run db:test` — 27 checks, all connecting as a role that assumes `anon`
exactly as PostgREST does (connecting as a superuser would bypass RLS and prove
nothing):

| | Result |
|---|---|
| 30 simultaneous spins at 18 available prizes | exactly 18 winners, **18 distinct customers**, gapless `spin_seq` 1..18, all quantities drained to 0, 12 clean rejections |
| 5000 draws over 100 customers | all 100 drawn, **chi-square ≈ 80** against an expected ~99 |
| 5000 test-mode spins | **zero** rows persisted |
| `anon` reading customers / winners / audit logs | permission denied |
| a real spin's response payload | contains no winner identity and no unmasked mobile |
| direct duplicate insert bypassing the function | rejected by the unique index |
| rate limit at 5/min | 10 attempts award only 5 prizes |

`npm run shots` — drives a real browser and asserts the **wheel's final angle
lands on the segment the server chose**, on every spin, in both languages. That
is the client-side half of the fairness guarantee, and it is checked mechanically
rather than eyeballed.

---

## Architecture

One source of truth for selection logic, two transports:

```
              supabase/migrations/*.sql
                        |
        +---------------+---------------+
   Supabase RPC                  local dev bridge
   supabase.rpc(...)             POST /api/rpc/* -> node-postgres
        +---------------+---------------+
                        |
                 src/lib/api/index.ts
```

`VITE_SUPABASE_URL` set → Supabase adapter. Unset → the dev bridge in
`server/devRpcPlugin.ts`, a `serve`-only Vite plugin (nothing reaches the
production bundle). Both call the identical SQL function, so local verification
is meaningful rather than theatrical.

### Deploying to Supabase

The layout is already Supabase-CLI native:

```bash
supabase link --project-ref <ref>
supabase db push          # applies supabase/migrations/*
psql "$DB_URL" -f supabase/seed.sql   # optional demo data
```

Then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and rebuild. No code
changes.

### i18n and RTL

English/Arabic with full RTL. Two details worth knowing:

- **The wheel must not mirror.** Its container is pinned `dir="ltr"`, geometry
  is computed in SVG user units, and rotation stays clockwise in both
  languages. Only the surrounding chrome flips. Segment labels set `direction`
  per `<text>` element, so Arabic reads correctly without touching geometry.
- **Numbers are wrapped in `<bdi>`.** An Arabic name next to a Latin-digit phone
  number gets reordered into nonsense without bidi isolation.

Amounts use Western digits even in Arabic, matching Saudi fintech convention.

---

## Known limitations — read before a real event

1. **The passcode is not authentication.** It is a shared secret on an event
   laptop that stops a leaked anon key from burning prizes. It is right-sized
   for a demo and a controlled stage; it is **not** acceptable once real
   customer PII is in the project. Migration is small and pre-planned: add
   Supabase Auth plus a `campaign_operators` table and replace the `crypt()`
   check with `auth.uid()`. Everything else stays as-is.

2. **The operator's browser holds the result ~6.5s before the audience sees
   it.** This is structural to client-side animation. The two-phase design
   limits it — a real spin returns only `winner_index`, and the name arrives
   from `reveal_winner()` after the wheel stops — but the prize is knowable
   early. Eliminating it entirely needs a server-rendered reveal or a
   time-locked payload. Document it rather than claim a property this does not
   have.

3. **Failed spins are not audited.** A rejected spin rolls back its own audit
   row along with everything else. Genuine gap against spec §27; the cheap fix
   is a `log_spin_failure()` RPC called by the client on error.

4. **`SPINNING` is never written server-side.** The campaign goes
   `ACTIVE -> WINNER_SELECTED` in one transaction. A campaign stuck in
   `SPINNING` because a laptop lost Wi-Fi mid-spin — on stage, in front of an
   audience — is an unrecoverable live failure with no compensating benefit.
   This is a deliberate deviation from spec §29.

5. **`has_won` is denormalized.** Hand-deleting a `winners` row in the Supabase
   table editor would desync it from `remaining_quantity`. Build a
   `void_winner()` RPC before granting anyone table-editor access.

6. **The demo campaign allows 60 spins/minute** for a brisk event pace. The
   limiter itself is verified at 5/min in the test suite.

## Deferred

Admin portal in full: login/auth UI, dashboard, Excel import + validation +
preview, customer management, campaign and prize CRUD, winner history, Excel
export, reports, winner certificates, public `/winner/{reference}` page, admin
user management, emergency controls.

Two of these are load-bearing and should come first:

- **Auth on `spin_campaign`** (limitation 1 above).
- **Excel import.** Without it there is no way to load real customers except
  SQL. If a real event is on the calendar, the import path — not the wheel — is
  the critical path. Note the npm `xlsx` package is stalled at 0.18.5 with open
  advisories; evaluate `exceljs` or SheetJS's own registry rather than
  defaulting to it.
