-- ---------------------------------------------------------------------------
-- The core RPC: spin_campaign().
--
-- This function IS the product. Everything security-critical -- randomness,
-- eligibility, prize decrement, masking, audit -- happens here, inside one
-- transaction, behind SECURITY DEFINER. The React app is a display device: it
-- receives a decision that has already been committed and merely animates it.
-- ---------------------------------------------------------------------------

create or replace function public.spin_campaign(
  p_campaign_id uuid,
  p_passcode    text,
  p_prize_id    uuid    default null,
  p_is_test     boolean default false,
  p_actor_label text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_c        campaigns%rowtype;
  v_prize    prizes%rowtype;
  v_pool     bigint;
  v_limit    bigint;
  v_rand     bigint;
  v_offset   bigint;
  v_cust     record;
  v_winner   uuid;
  v_seq      int;
  v_ref      text;
  v_guard    boolean;
  v_n        int;
  v_pcount   int;
  v_prize_rn int;
  v_cands    int[];
  v_widx     int;
  v_segs     jsonb;
begin
  ---------------------------------------------------------------------------
  -- 0. Operator passcode. Not authentication -- it exists so that merely
  --    holding the public anon key cannot burn real prizes. See README.
  ---------------------------------------------------------------------------
  select * into v_c from campaigns where id = p_campaign_id;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  if v_c.operator_passcode_hash is null
     or crypt(coalesce(p_passcode, ''), v_c.operator_passcode_hash)
        <> v_c.operator_passcode_hash then
    perform pg_sleep(0.25);   -- crude brute-force damper
    raise exception 'UNAUTHORIZED';
  end if;

  ---------------------------------------------------------------------------
  -- 1. ATOMICITY. Serialize every spin for THIS campaign.
  --
  --    Taken BEFORE the pool is counted. That ordering is the whole point:
  --    the draw is count-then-offset, so two transactions that counted the
  --    same pool could otherwise draw the same offset and resolve the same
  --    customer. Locking first removes that entire class of race.
  --
  --    Advisory (not SELECT FOR UPDATE) because the invariant set is wider
  --    than one row -- prize quantity, spin_seq, has_won and the pool count
  --    must all move together. _xact_ so it releases on commit, rollback or
  --    client disconnect: no leaked locks if a laptop dies mid-spin.
  --    Different campaigns still spin concurrently (key derives from the id).
  ---------------------------------------------------------------------------
  perform pg_advisory_xact_lock(
    hashtextextended('winner_wheel:spin:' || p_campaign_id::text, 0));

  select * into v_c from campaigns where id = p_campaign_id;  -- re-read under lock

  ---------------------------------------------------------------------------
  -- 2. Lifecycle guards (spec section 29).
  ---------------------------------------------------------------------------
  if v_c.status not in ('ACTIVE', 'WINNER_SELECTED') then
    -- A campaign auto-completes when its last prize is awarded. Reporting that
    -- precisely ("No prizes are available") is far more useful to an operator
    -- mid-event than a generic lifecycle error (spec section 44).
    if v_c.status = 'COMPLETED'
       and not exists (select 1 from prizes
                        where campaign_id = p_campaign_id and remaining_quantity > 0) then
      raise exception 'NO_PRIZES_REMAINING';
    end if;
    raise exception 'CAMPAIGN_NOT_ACTIVE' using detail = v_c.status::text;
  end if;
  if v_c.starts_at is not null and now() < v_c.starts_at then
    raise exception 'CAMPAIGN_NOT_STARTED';
  end if;
  if v_c.ends_at is not null and now() > v_c.ends_at then
    raise exception 'CAMPAIGN_EXPIRED';
  end if;

  if (select count(*) from audit_logs
       where campaign_id = p_campaign_id
         and action in ('SPIN_EXECUTED', 'SPIN_TEST')
         and created_at > now() - interval '1 minute') >= v_c.max_spins_per_minute then
    raise exception 'RATE_LIMITED';
  end if;

  ---------------------------------------------------------------------------
  -- 3. Prize selection.
  ---------------------------------------------------------------------------
  if p_prize_id is not null then
    select * into v_prize from prizes
      where id = p_prize_id and campaign_id = p_campaign_id;
    if not found then
      raise exception 'PRIZE_NOT_FOUND';
    end if;
    if v_prize.remaining_quantity <= 0 then
      raise exception 'PRIZE_EXHAUSTED';
    end if;
  else
    select * into v_prize from prizes
      where campaign_id = p_campaign_id and remaining_quantity > 0
      order by tier asc, value_amount desc nulls last, sort_order asc, id asc
      limit 1;
    if not found then
      raise exception 'NO_PRIZES_REMAINING';
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 4. Eligible pool (spec section 18).
  ---------------------------------------------------------------------------
  if v_c.allow_previous_winners then
    select count(*) into v_pool from campaign_customers
      where campaign_id = p_campaign_id and is_eligible;
  else
    select count(*) into v_pool from campaign_customers
      where campaign_id = p_campaign_id and is_eligible and not has_won;
  end if;

  if v_pool = 0 then
    raise exception 'NO_ELIGIBLE_CUSTOMERS';
  end if;

  ---------------------------------------------------------------------------
  -- 5. The draw: CSPRNG with unbiased rejection sampling (spec section 19).
  --
  --    gen_random_bytes() is OpenSSL's CSPRNG. Postgres random() is a plain
  --    PRNG and is as unacceptable here as Math.random(). Rejecting the
  --    ragged tail block above the largest multiple of v_pool removes the
  --    modulo bias entirely rather than merely making it small.
  ---------------------------------------------------------------------------
  v_limit := (9223372036854775807 / v_pool) * v_pool;
  loop
    v_rand := (('x' || encode(gen_random_bytes(8), 'hex'))::bit(64)::bigint)
              & 9223372036854775807;          -- clear sign bit -> uniform in [0, 2^63)
    exit when v_rand < v_limit;
  end loop;
  v_offset := v_rand % v_pool;

  ---------------------------------------------------------------------------
  -- 6. Resolve the winner: deterministic order + secure random offset.
  ---------------------------------------------------------------------------
  if v_c.allow_previous_winners then
    select c.id, c.full_name, c.full_name_ar, c.mobile, c.city into v_cust
      from campaign_customers cc join customers c on c.id = cc.customer_id
     where cc.campaign_id = p_campaign_id and cc.is_eligible
     order by cc.id offset v_offset limit 1;
  else
    select c.id, c.full_name, c.full_name_ar, c.mobile, c.city into v_cust
      from campaign_customers cc join customers c on c.id = cc.customer_id
     where cc.campaign_id = p_campaign_id and cc.is_eligible and not cc.has_won
     order by cc.id offset v_offset limit 1;
  end if;

  if v_cust.id is null then
    raise exception 'POOL_RACE';   -- must never fire; the lock prevents it
  end if;

  ---------------------------------------------------------------------------
  -- 7. Commit the decision. Skipped entirely in test mode (spec section 31).
  ---------------------------------------------------------------------------
  if not p_is_test then
    update prizes set remaining_quantity = remaining_quantity - 1
      where id = v_prize.id and remaining_quantity > 0;
    if not found then
      raise exception 'PRIZE_EXHAUSTED';
    end if;

    if not v_c.allow_previous_winners then
      update campaign_customers set has_won = true, won_at = now()
        where campaign_id = p_campaign_id and customer_id = v_cust.id;
    end if;

    select coalesce(max(spin_seq), 0) + 1 into v_seq
      from winners where campaign_id = p_campaign_id and not is_test;

    v_ref := 'WIN-' || to_char(now(), 'YYYY') || '-'
             || lpad(nextval('winner_reference_seq')::text, 6, '0');
    v_guard := not v_c.allow_previous_winners;

    insert into winners (campaign_id, customer_id, prize_id, spin_seq,
                         reference_number, is_test, unique_guard,
                         pool_size, draw_offset)
    values (p_campaign_id, v_cust.id, v_prize.id, v_seq,
            v_ref, false, v_guard, v_pool, v_offset)
    returning id into v_winner;

    update campaigns set status = 'WINNER_SELECTED', updated_at = now()
      where id = p_campaign_id;

    if not exists (select 1 from prizes
                    where campaign_id = p_campaign_id and remaining_quantity > 0) then
      update campaigns set status = 'COMPLETED', updated_at = now()
        where id = p_campaign_id;
    end if;
  end if;

  ---------------------------------------------------------------------------
  -- 8. Audit (spec section 27).
  ---------------------------------------------------------------------------
  insert into audit_logs (campaign_id, actor_label, action, entity_type, entity_id, payload)
  values (p_campaign_id, p_actor_label,
          case when p_is_test then 'SPIN_TEST' else 'SPIN_EXECUTED' end,
          'winner', v_winner,
          jsonb_build_object(
            'prize_id',    v_prize.id,
            'pool_size',   v_pool,
            'draw_offset', v_offset,
            'customer_id', case when p_is_test then null else v_cust.id end,
            'method',      'csprng_pgcrypto_v1'));

  ---------------------------------------------------------------------------
  -- 9. Build the wheel face: PRIZE segments (spec section 16).
  --
  --    Prize tiers are cycled around the wheel so a 4-prize campaign still
  --    renders a full 12-wedge wheel. winner_index is then chosen at random
  --    among the segments carrying the prize that was actually won, so the
  --    pointer always lands on a truthful wedge.
  ---------------------------------------------------------------------------
  v_n := v_c.segment_count;

  select count(*) into v_pcount from prizes where campaign_id = p_campaign_id;

  select rn into v_prize_rn from (
    select id, (row_number() over (order by tier, sort_order, id) - 1)::int as rn
      from prizes where campaign_id = p_campaign_id
  ) q where q.id = v_prize.id;

  v_segs := wheel_segments(p_campaign_id, v_n);

  select array_agg(s.idx) into v_cands
    from generate_series(0, v_n - 1) as s(idx)
   where s.idx % v_pcount = v_prize_rn;

  v_widx := v_cands[1 + ((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::int
                          & 2147483647) % array_length(v_cands, 1))];

  ---------------------------------------------------------------------------
  -- 10. Return. In a real spin the winner's identity is deliberately NOT
  --     included: the client gets it from reveal_winner() only after the
  --     wheel stops, which shrinks the window in which the operator's browser
  --     holds the result (spec section 40). Test mode returns inline because
  --     nothing was persisted to look up.
  ---------------------------------------------------------------------------
  return jsonb_build_object(
    'spin_id',       v_winner,
    'is_test',       p_is_test,
    'spin_seq',      coalesce(v_seq, 0),
    'pool_size',     v_pool,
    'segment_count', v_n,
    'winner_index',  v_widx,
    'segments',      v_segs,
    'prize', jsonb_build_object(
      'id', v_prize.id, 'name', v_prize.name, 'name_ar', v_prize.name_ar,
      'value', v_prize.value_amount, 'currency', v_prize.currency,
      'color', v_prize.color),
    'test_winner', case when p_is_test then
        jsonb_build_object(
          'full_name',     v_cust.full_name,
          'full_name_ar',  v_cust.full_name_ar,
          'masked_mobile', mask_mobile(v_cust.mobile),
          'city',          v_cust.city)
      else null end);
end $$;


-- ---------------------------------------------------------------------------
-- Phase two: called only after the wheel has stopped.
-- Never returns a full mobile number (spec sections 23 and 39).
-- ---------------------------------------------------------------------------
create or replace function public.reveal_winner(p_spin_id uuid, p_passcode text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_w winners%rowtype;
  v_c campaigns%rowtype;
  v_r jsonb;
begin
  select * into v_w from winners where id = p_spin_id;
  if not found then
    raise exception 'SPIN_NOT_FOUND';
  end if;

  select * into v_c from campaigns where id = v_w.campaign_id;
  if v_c.operator_passcode_hash is null
     or crypt(coalesce(p_passcode, ''), v_c.operator_passcode_hash)
        <> v_c.operator_passcode_hash then
    raise exception 'UNAUTHORIZED';
  end if;

  select jsonb_build_object(
      'spin_id',       v_w.id,
      'spin_seq',      v_w.spin_seq,
      'reference',     v_w.reference_number,
      'full_name',     c.full_name,
      'full_name_ar',  c.full_name_ar,
      'masked_mobile', mask_mobile(c.mobile),
      'city',          c.city,
      'selected_at',   v_w.selected_at,
      'prize', jsonb_build_object(
        'name', p.name, 'name_ar', p.name_ar,
        'value', p.value_amount, 'currency', p.currency))
    into v_r
    from customers c, prizes p
   where c.id = v_w.customer_id and p.id = v_w.prize_id;

  return v_r;
end $$;
