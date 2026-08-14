-- ---------------------------------------------------------------------------
-- Helper functions.
--
-- Masking happens IN SQL so the client is never sent a full mobile number.
-- The browser is structurally incapable of obtaining one: there is no grant
-- that would let it read the customers table (spec sections 23 and 39).
-- ---------------------------------------------------------------------------

-- '+966501234567' -> '+966 5*****567'   (spec section 23)
create or replace function public.mask_mobile(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when p is null or length(p) < 9 then '*****'
    -- International form: keep the +966 country code and the leading 5.
    when left(p, 1) = '+' then
      left(p, 4) || ' ' || substr(p, 5, 1)
      || repeat('*', length(p) - 8) || right(p, 3)
    -- Local 05XXXXXXXX form.
    else left(p, 2) || repeat('*', length(p) - 5) || right(p, 3)
  end;
$$;

-- 'Mohammed Al-Ghamdi' -> 'Mohammed A.'
create or replace function public.mask_name(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when p is null then ''
    when position(' ' in btrim(p)) = 0 then btrim(p)
    else split_part(btrim(p), ' ', 1) || ' '
         || left(split_part(btrim(p), ' ',
                 array_length(string_to_array(btrim(p), ' '), 1)), 1) || '.'
  end;
$$;

-- The wheel face. Prize tiers are cycled around the wheel so a 4-prize
-- campaign still renders a full 12-wedge wheel (spec section 16).
--
-- Shared by campaign_stage_info() (to draw the wheel at rest) and by
-- spin_campaign() (to pick which wedge the pointer lands on), so the idle
-- wheel and the spin result can never disagree about the layout.
create or replace function public.wheel_segments(p_campaign_id uuid, p_n int)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_agg(seg order by idx)
    from (
      select s.idx,
             jsonb_build_object(
               'index',    s.idx,
               'prize_id', p.id,
               'name',     p.name,
               'name_ar',  p.name_ar,
               'value',    p.value_amount,
               'currency', p.currency,
               'color',    p.color) as seg
        from generate_series(0, p_n - 1) as s(idx)
        join (
          select id, name, name_ar, value_amount, currency, color,
                 (row_number() over (order by tier, sort_order, id) - 1)::int as rn,
                 (count(*) over ())::int as cnt
            from prizes where campaign_id = p_campaign_id
        ) p on p.rn = s.idx % p.cnt
    ) t;
$$;

-- For the FUTURE admin portal's RLS policies.
-- SECURITY DEFINER + STABLE is mandatory here: a plain query against `users`
-- from inside a policy ON `users` causes infinite RLS recursion.
create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users
     where id = auth.uid() and is_active and role in ('admin', 'operator')
  );
$$;
