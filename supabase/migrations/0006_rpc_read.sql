-- ---------------------------------------------------------------------------
-- Read RPCs. These return aggregates and prize metadata only -- never a
-- customer row. The client has no table privileges at all, so these three
-- functions plus spin_campaign/reveal_winner are its entire surface.
-- ---------------------------------------------------------------------------

-- Doubles as the campaign picker: one passcode unlocks exactly one campaign,
-- so nothing is leaked by trying. Raises UNAUTHORIZED on a miss.
create or replace function public.resolve_campaign(p_passcode text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_c campaigns%rowtype;
begin
  select * into v_c from campaigns
   where operator_passcode_hash is not null
     and status in ('DRAFT', 'ACTIVE', 'WINNER_SELECTED', 'COMPLETED')
     and crypt(coalesce(p_passcode, ''), operator_passcode_hash) = operator_passcode_hash
   limit 1;

  if not found then
    perform pg_sleep(0.25);
    raise exception 'UNAUTHORIZED';
  end if;

  return jsonb_build_object(
    'id', v_c.id, 'name', v_c.name, 'name_ar', v_c.name_ar,
    'tagline', v_c.tagline, 'tagline_ar', v_c.tagline_ar,
    'status', v_c.status);
end $$;


create or replace function public.campaign_stage_info(p_campaign_id uuid, p_passcode text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_c        campaigns%rowtype;
  v_total    int;
  v_eligible int;
  v_won      int;
  v_prizes   jsonb;
begin
  select * into v_c from campaigns where id = p_campaign_id;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  if v_c.operator_passcode_hash is null
     or crypt(coalesce(p_passcode, ''), v_c.operator_passcode_hash)
        <> v_c.operator_passcode_hash then
    perform pg_sleep(0.25);
    raise exception 'UNAUTHORIZED';
  end if;

  select count(*) filter (where is_eligible),
         count(*) filter (where is_eligible and not has_won),
         count(*) filter (where has_won)
    into v_total, v_eligible, v_won
    from campaign_customers where campaign_id = p_campaign_id;

  select jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'name_ar', name_ar,
           'value', value_amount, 'currency', currency, 'tier', tier,
           'color', color, 'total', total_quantity,
           'remaining', remaining_quantity) order by tier, sort_order, id)
    into v_prizes
    from prizes where campaign_id = p_campaign_id;

  return jsonb_build_object(
    'campaign', jsonb_build_object(
      'id', v_c.id, 'name', v_c.name, 'name_ar', v_c.name_ar,
      'tagline', v_c.tagline, 'tagline_ar', v_c.tagline_ar,
      'status', v_c.status,
      'allow_previous_winners', v_c.allow_previous_winners,
      'segment_count', v_c.segment_count),
    'counts', jsonb_build_object(
      'total_customers', v_total,
      'eligible',        case when v_c.allow_previous_winners then v_total else v_eligible end,
      'winners',         v_won),
    'prizes',   coalesce(v_prizes, '[]'::jsonb),
    'segments', coalesce(wheel_segments(p_campaign_id, v_c.segment_count), '[]'::jsonb));
end $$;


-- Recent winners ticker. Masked names and masked mobiles only.
create or replace function public.recent_winners(p_campaign_id uuid, p_passcode text,
                                                 p_limit int default 10)
returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp
as $$
declare v_c campaigns%rowtype; v_r jsonb;
begin
  select * into v_c from campaigns where id = p_campaign_id;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;
  if v_c.operator_passcode_hash is null
     or crypt(coalesce(p_passcode, ''), v_c.operator_passcode_hash)
        <> v_c.operator_passcode_hash then
    raise exception 'UNAUTHORIZED';
  end if;

  select jsonb_agg(jsonb_build_object(
           'spin_seq',      w.spin_seq,
           'reference',     w.reference_number,
           'name',          mask_name(c.full_name),
           'masked_mobile', mask_mobile(c.mobile),
           'prize',         p.name,
           'selected_at',   w.selected_at)
         order by w.spin_seq desc)
    into v_r
    from winners w
    join customers c on c.id = w.customer_id
    join prizes p on p.id = w.prize_id
   where w.campaign_id = p_campaign_id and not w.is_test
     and w.spin_seq > (select coalesce(max(spin_seq), 0) - p_limit
                         from winners where campaign_id = p_campaign_id and not is_test);

  return coalesce(v_r, '[]'::jsonb);
end $$;
