-- ---------------------------------------------------------------------------
-- Row Level Security and least-privilege grants.
--
-- The security model in one line: the browser role gets ZERO table privileges
-- and exactly five function grants. Every table has RLS on with no `anon`
-- policy, so even if a grant were added by accident, RLS still denies.
-- ---------------------------------------------------------------------------

alter table users              enable row level security;
alter table campaigns          enable row level security;
alter table customers          enable row level security;
alter table campaign_customers enable row level security;
alter table prizes             enable row level security;
alter table winners            enable row level security;
alter table imports            enable row level security;
alter table audit_logs         enable row level security;

-- FORCE so even the table owner is subject to policies. SECURITY DEFINER
-- functions still see everything (they run as the definer, bypassing RLS by
-- design) -- this is purely a defence against a stray owner-context query.
alter table customers force row level security;
alter table winners   force row level security;

-- Policies exist ONLY for authenticated staff -- i.e. the deferred admin
-- portal. `anon` intentionally has no policy anywhere, which means deny-all.
drop policy if exists users_self on users;
create policy users_self on users
  for select to authenticated using (id = auth.uid());

drop policy if exists campaigns_staff on campaigns;
create policy campaigns_staff on campaigns
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists customers_staff on customers;
create policy customers_staff on customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists campaign_customers_staff on campaign_customers;
create policy campaign_customers_staff on campaign_customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists prizes_staff on prizes;
create policy prizes_staff on prizes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists winners_staff on winners;
create policy winners_staff on winners
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists imports_staff on imports;
create policy imports_staff on imports
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Audit log is append-only from the app's perspective: staff may read it,
-- nobody may edit it through the API.
drop policy if exists audit_read_staff on audit_logs;
create policy audit_read_staff on audit_logs
  for select to authenticated using (public.is_staff());


-- ---------------------------------------------------------------------------
-- GRANTS
--
-- Postgres grants EXECUTE to PUBLIC on every newly created function by
-- default. Without the revokes below, `anon` could call every function that
-- ever gets added to this schema -- this is the single most common Supabase
-- RLS bypass in the wild. The `alter default privileges` lines make it stick
-- for functions created later.
-- ---------------------------------------------------------------------------
revoke all on schema public from public;
grant usage on schema public to anon, authenticated;

revoke all on all tables    in schema public from public, anon;
revoke all on all sequences in schema public from public, anon;
revoke all on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables    from public, anon;
alter default privileges in schema public revoke all on functions from public, anon;

-- Staff get table access; RLS above is what actually gates it.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The browser's entire API surface.
grant execute on function public.resolve_campaign(text)                          to anon, authenticated;
grant execute on function public.campaign_stage_info(uuid, text)                 to anon, authenticated;
grant execute on function public.recent_winners(uuid, text, int)                 to anon, authenticated;
grant execute on function public.spin_campaign(uuid, text, uuid, boolean, text)  to anon, authenticated;
grant execute on function public.reveal_winner(uuid, text)                       to anon, authenticated;
