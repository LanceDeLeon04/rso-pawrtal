-- ============================================================
-- 040: Academic Year + Terms
-- ============================================================
-- Academic Director / SDAO (assistant, supervisor) and System Admin
-- can define academic years (just a start + end date — setting a new
-- "current" academic year IS how a new one gets created) and, within
-- the current academic year, define terms (start + end date each).
-- The gap between one term's end and the next term's start is a term
-- break — computed on the fly, never stored — and is advisory-only
-- for events, same treatment as a restricted period.

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null, -- e.g. "AY 2025–2026", derived from the dates
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint academic_years_date_check check (end_date > start_date)
);

-- Only one academic year can be "current" at a time.
create unique index idx_academic_years_one_current on academic_years (is_current) where is_current;
create index idx_academic_years_range on academic_years (start_date, end_date);

alter table academic_years enable row level security;

create policy "academic_years_select_all"
  on academic_years for select
  using (auth.role() = 'authenticated');

create policy "academic_years_insert_admin"
  on academic_years for insert
  with check (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "academic_years_update_admin"
  on academic_years for update
  using (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "academic_years_delete_admin"
  on academic_years for delete
  using (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

-- ---------- Terms ----------
create table academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  label text not null, -- e.g. "1st Term", "2nd Term"
  start_date date not null,
  end_date date not null,
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint academic_terms_date_check check (end_date > start_date)
);

create index idx_academic_terms_year on academic_terms(academic_year_id);
create index idx_academic_terms_range on academic_terms(start_date, end_date);

alter table academic_terms enable row level security;

create policy "academic_terms_select_all"
  on academic_terms for select
  using (auth.role() = 'authenticated');

create policy "academic_terms_insert_admin"
  on academic_terms for insert
  with check (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "academic_terms_update_admin"
  on academic_terms for update
  using (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

create policy "academic_terms_delete_admin"
  on academic_terms for delete
  using (current_role_name() in ('sdao_assistant', 'sdao_supervisor', 'academic_director', 'system_admin'));

-- ---------- Tag submissions + events to the current academic year ----------
alter table submissions add column if not exists academic_year_id uuid references academic_years(id);
alter table events add column if not exists academic_year_id uuid references academic_years(id);

create index if not exists idx_submissions_academic_year on submissions(academic_year_id);
create index if not exists idx_events_academic_year on events(academic_year_id);

-- Auto-tag on insert if the app didn't set it explicitly — this is the
-- enforcement point for "all applications must be tagged to the
-- current academic year" regardless of which code path inserts the
-- row (event application, merchandise proposal, report, or the
-- events row created when an application is approved).
create or replace function set_current_academic_year()
returns trigger as $$
begin
  if new.academic_year_id is null then
    select id into new.academic_year_id from academic_years where is_current limit 1;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_submissions_academic_year
  before insert on submissions
  for each row execute function set_current_academic_year();

create trigger trg_events_academic_year
  before insert on events
  for each row execute function set_current_academic_year();
