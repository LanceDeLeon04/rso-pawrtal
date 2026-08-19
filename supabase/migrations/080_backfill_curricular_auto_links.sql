-- ============================================================
-- 080: Backfill — auto-generate Dean/SDG Representative approval
-- links for curricular activities that were submitted BEFORE
-- migration 079 (still sitting in dean_review with no link yet).
-- Safe to re-run: `on conflict (activity_id, role) do nothing` skips
-- anything already generated (manually or by 079 itself).
-- ============================================================

do $$
declare
  v_activity record;
  v_dean external_approvers;
  v_sdg external_approvers;
begin 
  for v_activity in
    select * from curricular_activities where status = 'dean_review'
  loop
    if v_activity.department is not null then
      select * into v_dean from external_approvers
        where role = 'dean' and school = v_activity.department and is_active
        limit 1;
      if v_dean is not null then
        insert into curricular_approvals (activity_id, role, token, person_name, status, expires_at, created_by)
        values (
          v_activity.id, 'dean',
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          v_dean.person_name, 'pending', now() + interval '7 days', null
        )
        on conflict (activity_id, role) do nothing;
      end if;
    end if;

    if v_activity.sdg_rep_id is not null then
      select * into v_sdg from external_approvers
        where id = v_activity.sdg_rep_id and role = 'sdg_rep' and is_active;
      if v_sdg is not null then
        insert into curricular_approvals (activity_id, role, token, person_name, status, expires_at, created_by)
        values (
          v_activity.id, 'sdg_rep',
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          v_sdg.person_name, 'pending', now() + interval '7 days', null
        )
        on conflict (activity_id, role) do nothing;
      end if;
    end if;
  end loop;
end $$;
