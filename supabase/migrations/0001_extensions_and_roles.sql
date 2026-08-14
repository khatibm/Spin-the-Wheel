-- ---------------------------------------------------------------------------
-- Extensions, roles and enums.
--
-- This file is written to run BYTE-IDENTICALLY on a real Supabase project and
-- on a bare local Postgres 16 cluster. Everything Supabase already provides is
-- created defensively with existence guards.
-- ---------------------------------------------------------------------------

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Supabase ships `anon` and `authenticated`; a bare cluster does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  -- LOCAL ONLY: a *login* role that assumes `anon`, mirroring what PostgREST
  -- does on Supabase. The dev RPC middleware connects as this role so that
  -- local runs are subject to the exact same grants and RLS as production.
  if not exists (select 1 from pg_roles where rolname = 'wheel_anon') then
    create role wheel_anon login password 'wheel_anon';
  end if;
end $$;

grant anon to wheel_anon;

-- Supabase exposes auth.uid(); locally we stub it so the RLS policies below
-- (which target the deferred admin portal) parse and run in both environments.
create schema if not exists auth;
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $fn$
      create function auth.uid() returns uuid
      language sql stable as 'select null::uuid'
    $fn$;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'campaign_status') then
    create type campaign_status as enum
      ('DRAFT', 'ACTIVE', 'SPINNING', 'WINNER_SELECTED', 'COMPLETED', 'CANCELLED');
  end if;
end $$;
