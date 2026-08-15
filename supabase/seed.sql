-- ---------------------------------------------------------------------------
-- Demo seed: 1 campaign, 100 Saudi customers, 4 prize tiers (18 awardable).
-- Deterministic -- generated from curated arrays so reruns are reproducible.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

truncate audit_logs, winners, campaign_customers, imports, prizes,
         customers, campaigns, users restart identity cascade;
alter sequence winner_reference_seq restart with 1;

insert into users (id, email, full_name, role)
values ('00000000-0000-0000-0000-0000000000a1',
        'ops@urpay.example', 'Campaign Operator', 'admin');

insert into campaigns (
  id, name, name_ar, tagline, tagline_ar, status,
  allow_previous_winners, segment_count, max_spins_per_minute,
  operator_passcode_hash, starts_at, ends_at, created_by)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'Win a Jaecoo J5',
  'اربح جيكو J5',
  'One lucky winner. One amazing car.',
  'فائز واحد محظوظ. سيارة رائعة واحدة.',
  'ACTIVE',
  false,
  12,
  -- Headroom for a brisk live event. The passcode is the real gate; this is a
  -- secondary damper against a stolen anon key.
  60,
  crypt('URPAY2026', gen_salt('bf', 10)),
  now() - interval '1 day',
  now() + interval '90 days',
  '00000000-0000-0000-0000-0000000000a1');

insert into imports (campaign_id, filename, status, total_rows, valid_rows,
                     duplicate_rows, invalid_rows, imported_by, completed_at)
values ('00000000-0000-0000-0000-0000000000c1', 'summer_2026_customers.xlsx',
        'COMPLETED', 100, 100, 0, 0,
        '00000000-0000-0000-0000-0000000000a1', now());

-- Prizes: single grand prize, 1 awardable winner. No price shown --
-- value_amount is left null and the UI falls back to the prize name.
insert into prizes (campaign_id, name, name_ar, value_amount, tier,
                    total_quantity, remaining_quantity, sort_order, color)
values
  ('00000000-0000-0000-0000-0000000000c1', 'Jaecoo J5 2026', 'جيكو J5 2026', null, 1, 1, 1, 1, '#F9A72D');

-- 100 customers built from curated bilingual name arrays and real KSA mobile
-- prefixes, so the Arabic reveal is genuinely Arabic rather than transliterated.
with names as (
  select
    array['Mohammed','Abdullah','Ahmed','Faisal','Khalid','Omar','Saud','Turki',
          'Nasser','Bandar','Majed','Yazeed','Sultan','Fahad','Rayan','Ziyad',
          'Sara','Noura','Reem','Lama','Haya','Aljohara','Maha','Dana',
          'Ghada','Shatha','Amal','Wjdan']::text[] as given_en,
    array['محمد','عبدالله','أحمد','فيصل','خالد','عمر','سعود','تركي',
          'ناصر','بندر','ماجد','يزيد','سلطان','فهد','ريان','زياد',
          'سارة','نورة','ريم','لمى','هيا','الجوهرة','مها','دانة',
          'غادة','شذى','أمل','وجدان']::text[] as given_ar,
    array['Al-Ghamdi','Al-Otaibi','Al-Qahtani','Al-Harbi','Al-Zahrani','Al-Dosari',
          'Al-Shehri','Al-Anazi','Al-Mutairi','Al-Subaie','Al-Balawi','Al-Juhani',
          'Al-Rashid','Al-Amri','Al-Malki']::text[] as family_en,
    array['الغامدي','العتيبي','القحطاني','الحربي','الزهراني','الدوسري',
          'الشهري','العنزي','المطيري','السبيعي','البلوي','الجهني',
          'الرشيد','العمري','المالكي']::text[] as family_ar,
    array['Riyadh','Jeddah','Dammam','Khobar','Makkah','Madinah','Abha','Tabuk']::text[] as cities,
    array['0','3','5','6','8','9']::text[] as prefixes
),
rows as (
  -- Every multiplier must be COPRIME to its array length, or the sequence
  -- collapses onto a fraction of the array. (g*7 % 28 yields only 4 distinct
  -- values because gcd(7,28)=7.) With 13/28 and 11/15 the (given, family) pair
  -- has period lcm(28,15)=420, so all 100 customers get a distinct name.
  select
    g,
    n.given_en [1 + (g * 13) % array_length(n.given_en, 1)]  as gen_en,
    n.given_ar [1 + (g * 13) % array_length(n.given_ar, 1)]  as gen_ar,
    n.family_en[1 + (g * 11) % array_length(n.family_en, 1)] as fam_en,
    n.family_ar[1 + (g * 11) % array_length(n.family_ar, 1)] as fam_ar,
    n.cities   [1 + (g * 3)  % array_length(n.cities, 1)]    as city,
    n.prefixes [1 + (g * 5)  % array_length(n.prefixes, 1)]  as prefix
  from generate_series(0, 99) as g, names n
)
insert into customers (full_name, full_name_ar, mobile, city)
select
  gen_en || ' ' || fam_en,
  gen_ar || ' ' || fam_ar,
  -- Normalized international form, unique by construction.
  '+9665' || prefix || lpad((((1000000 + g * 7919) % 10000000))::text, 7, '0'),
  city
from rows;

insert into campaign_customers (campaign_id, customer_id, import_id, is_eligible)
select '00000000-0000-0000-0000-0000000000c1', c.id,
       (select id from imports limit 1), true
from customers c;
