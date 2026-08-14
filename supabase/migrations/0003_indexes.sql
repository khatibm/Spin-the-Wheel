-- ---------------------------------------------------------------------------
-- Indexes and the declarative "one win per customer" guarantee.
-- ---------------------------------------------------------------------------

-- Spec section 18, enforced by the DATABASE rather than by application logic.
--
-- spin_campaign() writes unique_guard = (not is_test) and (not allow_previous_winners).
-- Because this index is PARTIAL it covers only rows drawn under "no repeats"
-- rules, so turning allow_previous_winners ON later writes unguarded rows that
-- do not collide, and turning it back OFF resumes enforcement against the
-- originally guarded rows.
--
-- This means that even if the advisory lock in spin_campaign() were removed,
-- Postgres itself would still refuse to record a duplicate winner.
create unique index if not exists winners_one_per_campaign
  on winners (campaign_id, customer_id) where unique_guard;

-- The two hot paths for the draw. spin_campaign() branches on
-- allow_previous_winners, so each branch gets a matching partial index.
create index if not exists cc_pool_norepeat_idx on campaign_customers (campaign_id, id)
  where is_eligible and not has_won;
create index if not exists cc_pool_repeat_idx on campaign_customers (campaign_id, id)
  where is_eligible;

create index if not exists prizes_available_idx on prizes (campaign_id, tier, sort_order)
  where remaining_quantity > 0;

create index if not exists winners_campaign_idx on winners (campaign_id, selected_at desc);
create index if not exists winners_campaign_real_idx on winners (campaign_id, spin_seq)
  where not is_test;
create index if not exists cc_customer_idx on campaign_customers (customer_id);
create index if not exists audit_campaign_idx on audit_logs (campaign_id, created_at desc);
create index if not exists audit_action_recent_idx
  on audit_logs (campaign_id, action, created_at desc);
