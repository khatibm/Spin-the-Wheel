-- ---------------------------------------------------------------------------
-- Tables (spec section 37).
-- ---------------------------------------------------------------------------

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),  -- on Supabase: = auth.users.id
  email       text not null unique,
  full_name   text,
  role        text not null default 'operator'
                check (role in ('admin', 'operator', 'viewer')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists campaigns (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  name_ar                text,
  tagline                text,
  tagline_ar             text,
  status                 campaign_status not null default 'DRAFT',

  -- Spec section 18: default OFF. One customer wins at most once per campaign.
  allow_previous_winners boolean not null default false,

  starts_at              timestamptz,
  ends_at                timestamptz,

  -- How many wedges the wheel draws. Prize tiers are cycled around the wheel
  -- so a 4-prize campaign still renders a full, rich-looking wheel.
  segment_count          int not null default 12 check (segment_count between 4 and 24),

  -- Shared operator secret (bcrypt). This is NOT authentication -- see README.
  -- It exists so that merely holding the public anon key cannot burn prizes.
  operator_passcode_hash text,
  max_spins_per_minute   int not null default 12,

  created_by             uuid references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists customers (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null,
  full_name_ar text,
  -- Normalized to +9665XXXXXXXX on import (spec section 10).
  mobile       text not null unique,
  city         text,
  created_at   timestamptz not null default now()
);

create table if not exists imports (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid references campaigns(id) on delete cascade,
  filename       text,
  status         text not null default 'PENDING'
                   check (status in ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  total_rows     int not null default 0,
  valid_rows     int not null default 0,
  duplicate_rows int not null default 0,
  invalid_rows   int not null default 0,
  error_report   jsonb,
  imported_by    uuid references users(id),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create table if not exists campaign_customers (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  import_id   uuid references imports(id) on delete set null,
  is_eligible boolean not null default true,   -- admin-side exclusion
  has_won     boolean not null default false,  -- denormalized fast path for section 18
  won_at      timestamptz,
  created_at  timestamptz not null default now(),
  unique (campaign_id, customer_id)
);

create table if not exists prizes (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references campaigns(id) on delete cascade,
  name               text not null,
  name_ar            text,
  value_amount       numeric(12, 2),
  currency           text not null default 'SAR',
  tier               int not null default 1,          -- 1 = most valuable
  total_quantity     int not null check (total_quantity >= 0),
  -- A database-level guarantee that over-award is impossible even if the
  -- application logic regresses.
  remaining_quantity int not null check (remaining_quantity >= 0),
  sort_order         int not null default 0,
  color              text,
  created_at         timestamptz not null default now(),
  check (remaining_quantity <= total_quantity)
);

create table if not exists winners (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references campaigns(id) on delete cascade,
  customer_id      uuid not null references customers(id),
  prize_id         uuid not null references prizes(id),
  spin_seq         int not null,                  -- 1..n per campaign, human-facing
  reference_number text not null unique,          -- WIN-2026-000125
  is_test          boolean not null default false,

  -- Backs the partial unique index below. See 0003_indexes.sql for why.
  unique_guard     boolean not null default true,

  -- Audit evidence of the draw itself (spec section 40).
  selection_method text not null default 'csprng_pgcrypto_v1',
  pool_size        int not null,
  draw_offset      bigint not null,

  selected_by      uuid references users(id),
  selected_at      timestamptz not null default now()
);

create table if not exists audit_logs (
  id          bigserial primary key,
  campaign_id uuid,
  actor_id    uuid,
  actor_label text,   -- device/operator label while unauthenticated
  action      text not null,
  entity_type text,
  entity_id   uuid,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Human-facing winner reference numbers: WIN-<year>-<6 digits>.
create sequence if not exists winner_reference_seq start 1;
