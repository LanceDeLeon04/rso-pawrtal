# RSO PAWrtal — NU Laguna SDAO

React (Vite) + Supabase portal for managing Recognized Student Organizations.

## What's built (Phase 1)

- `supabase/schema.sql` — full data model: organizations, profiles/roles,
  org memberships (doubles as cross-org tagging, e.g. "all Treasurers"),
  admin viewer-scopes, venues, events, templates, submissions +
  attachments + status-history audit trail, assignments, and clearance —
  with RLS policies enforcing the account-creation and clearance-gate rules.
- Auth: `AuthContext` (sign in/out, profile + role loading, forced
  password-change flag), `ProtectedRoute` for role gating.
- Pages: **Login** (branded split layout, NU gold/blue, paw-print signature
  motif), **Change Password** (shown automatically on first login), and a
  **Dashboard** placeholder.

## Setup

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

Run `supabase/schema.sql` against your Supabase project (SQL editor or CLI)
to create the tables and policies.

### Assets to add

Drop these into `/public`:
- `portal.png` — the RSO PAWrtal logo (wordmark baked into the PNG)
- `nu-bg.jpg` — NU campus background photo for the login branding panel

The login/change-password screens already reference both paths, so once
they're in `/public` they'll appear with no code changes.

### First admin account

Since only admin-tier roles can create accounts, seed one `system_admin`
directly in Supabase after signup (via SQL or the dashboard) to bootstrap
everyone else:

```sql
update profiles set role = 'system_admin', must_change_password = false
where email = 'your-admin-email@nu-laguna.edu.ph';
```

## What's built (Phase 2)

- **Dashboard** — role-scoped metrics (upcoming activities, submissions in
  the pipeline, active orgs / clearance status) and alerts.
- **Calendar of Activities** — month grid, venue filter, pencil-book vs
  reserved vs cancelled chips, admin full-detail modal vs officer
  title+org-only view, quick manual booking.
- **Submission Bin** — event application form (name, contact person, venue,
  date, time, medium, ACP Form / Attachments Template uploads) and report
  submission (PARF / Liquidation / Narrative / Evaluation, tied to a
  specific past activity). Status tracker stepper through SDAO Assistant →
  SDAO Supervisor → Academic Director, with Return/Reject + reason,
  full audit history, and template quick-links. **Approving an event
  application auto-creates the calendar entry (reserved) and opens the
  clearance obligation; approving a report auto-clears it.**

- **Templates** — admins upload/replace/delete official documents (ACP
  Form, Attachments Template, PARF, Liquidation/Narrative/Evaluation
  Report, or custom ones), grouped by category with version + last-updated
  info; every role can browse and download. These are the same templates
  linked as quick-download shortcuts inside the Submission Bin's attachment
  fields.

- **Clearance** — every approved event application automatically opens a
  clearance obligation due 7 days after the event date (already wired in
  Submission Bin). This page surfaces it: status summary cards (Pending /
  Extended / Overdue / Cleared), a self-healing check that flips a row to
  Overdue once its deadline passes, admin deadline extension, and a manual
  "Mark Cleared" override alongside the automatic clear-on-report-approval
  flow. Officers see their org's own obligations with a shortcut into
  Submission Bin to file the report.

### Extra setup for Submission Bin

1. In the Supabase dashboard, go to **Storage → New bucket** and create one
   named exactly `submission-attachments` (private is fine).
2. If this is a fresh project, `supabase/schema.sql` already includes
   everything needed. If you already ran the original schema, run
   `supabase/migrations/002_submission_bin.sql` instead to patch it in
   place (adds the new submission fields, fixes the clearance gate so it
   no longer blocks the report that would clear it, and adds several RLS
   policies that were missing for the approval chain).

### Extra setup for Templates

In the Supabase dashboard, go to **Storage → New bucket** and create one
named exactly `templates` (public is fine — every logged-in role can
download these). If you already ran schema.sql before this phase, run
`supabase/migrations/003_templates.sql` to add the storage policies.

- **Assignments** — admins create tasks/deliverables targeting a specific
  user, a cross-org position tag ("all Treasurers"), or a whole org.
  Optionally linked to a submission (blocks the SDAO Assistant from
  forwarding that submission until the task is Approved) and/or an event
  (informational tag only). Assignees upload a deliverable; admins Approve
  or Return it with a reason. If the Assistant needs to move things along
  anyway, **Conditional Approve** lets them forward the submission while
  setting a new deadline on the still-open task. Post-activity report
  obligations are auto-created here too the moment an event application is
  approved — clicking one routes straight into Submission Bin's report
  form, and submitting that report auto-completes the assignment.

### Extra setup for Assignments

1. In the Supabase dashboard, go to **Storage → New bucket** and create one
   named exactly `assignment-deliverables` (private is fine).
2. If this is a fresh project, `supabase/schema.sql` already includes
   everything needed. If you already ran the earlier schema/migrations,
   run `supabase/migrations/004_assignments.sql` — it rebuilds the
   `assignments` table with the new targeting model (**this drops any
   existing assignment rows**, so export first if you have real data) and
   fixes a bug where `org_memberships` had RLS enabled with no policy at
   all, which was silently hiding every RSO officer's own org data
   (events, submissions, clearances) behind an empty result set.

- **Settings** — everyone can update their display name, upload a profile
  photo, and change their password. Admins additionally get a "Manage User
  Accounts" table listing every account (name, email, role, org) with
  inline name editing, plus an **Active/Inactive toggle** — deactivating
  an account immediately blocks that person from signing in (enforced in
  the auth layer, not just hidden in the UI), and signs out any of their
  existing sessions the next time the app checks. Admins can't deactivate
  their own account.

### Extra setup for Settings

1. In the Supabase dashboard, go to **Storage → New bucket** and create one
   named exactly `avatars` (public is fine — photos render in the topbar
   for everyone).
2. If you already ran the earlier schema/migrations, run
   `supabase/migrations/005_settings.sql` — it adds the admin
   profiles-update policy (profiles previously only allowed self-edits,
   which would have silently blocked admin name corrections) and the
   avatar storage policies.

- **Accounts** — admin-tier accounts (System Admin and other admins) can:
  create new logins (RSO Officer or admin-tier, with an org + position
  for officers and optional viewer-scope restriction for admins — shows a
  one-time temporary password to hand to the new user), add organizations,
  and manage org memberships/position tags for anyone (this is the same
  "all Treasurers across all orgs" tagging mechanism Assignments uses).

### Extra setup for Accounts

Creating another person's login requires Supabase's service-role key,
which must never reach the browser — so account creation runs through a
server-side **Edge Function** instead of a direct client call.

1. Install the Supabase CLI if you haven't: `npm install -g supabase`
2. From the project root: `supabase login`, then
   `supabase link --project-ref <your-project-ref>`
3. Deploy the function: `supabase functions deploy create-account`
   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided
   automatically by the platform — no manual secret-setting needed.)
   The repo's `supabase/config.toml` disables the platform's legacy
   JWT check for this function specifically, since it verifies the
   caller itself inside `index.ts`. If you see a CORS error in the
   browser console when creating an account, it almost always means
   either this deploy step was skipped/failed, or that setting got
   reverted — re-run the deploy command and confirm the function shows
   up under Edge Functions in the Supabase dashboard with a recent
   "last deployed" time and no errors in its logs tab.
4. If you already ran the earlier schema/migrations, also run
   `supabase/migrations/006_accounts.sql`. Besides the org_memberships
   write policy Accounts needs, it fixes three RLS gaps this phase
   surfaced: **`organizations` had RLS enabled with zero policies**,
   which means every org dropdown in the entire app (Calendar, Submission
   Bin, Assignments, Dashboard) has been silently empty for every role
   this whole time; and `venues` / `admin_viewer_scopes` / `profile_tags`
   never had RLS enabled at all, leaving them wide open to any
   authenticated user.

### Extra setup for the Submission Bin review workspace

The Submission Bin detail view is now a full review workspace: a file
viewer for the attached documents, a reviewer checklist ("Additional
Requirements"), paginated review comments (each optionally pinned to a
page number), and resubmission with extra attachments after a Return.

If you already ran the earlier schema/migrations, run
`supabase/migrations/012_review_checklist_comments.sql`. It adds the
`submission_checklist_items` and `submission_comments` tables (with RLS:
reviewers can create/toggle/comment, the owning org can read) and a
policy letting an org move its own `returned` submission back into the
queue (resubmit).

## Status

All pages from the original brief are now built: Login, Dashboard,
Calendar of Activities, Submission Bin, Templates, Clearance, Assignments,
Settings, and Accounts.
