-- ============================================================
-- Migration 035 — Organization bank details
-- ============================================================
-- Bank account info is financial/sensitive, so it does NOT live on
-- `organizations` (whose select policy is `using (true)` — readable
-- by every logged-in user, since name/logo/category are meant to be
-- public within the app). Instead it's a separate table with its own
-- tight RLS: only admin-tier staff and that org's own members can
-- read it, and only admin-tier staff can write it (bank details are
-- managed the same place orgs themselves are added, on the
-- admin-only Accounts page).

create table if not exists organization_bank_details (
  org_id uuid primary key references organizations(id) on delete cascade,
  bank_name text,
  account_name text,
  account_number text,
  updated_at timestamptz not null default now()
);

alter table organization_bank_details enable row level security;

drop policy if exists org_bank_details_select on organization_bank_details;
create policy org_bank_details_select on organization_bank_details for select
  using (
    is_admin_tier()
    or org_id in (select org_id from org_memberships where profile_id = auth.uid())
  );

drop policy if exists org_bank_details_write on organization_bank_details;
create policy org_bank_details_write on organization_bank_details for all
  using (is_admin_tier())
  with check (is_admin_tier());

-- Keep updated_at current on every edit.
create or replace function touch_org_bank_details_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists org_bank_details_touch on organization_bank_details;
create trigger org_bank_details_touch
  before update on organization_bank_details
  for each row execute function touch_org_bank_details_updated_at();
