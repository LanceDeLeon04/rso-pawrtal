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
  Names" table listing every account (name, email, role, org) with inline
  editing, for correcting or updating any user's display name.

### Extra setup for Settings

1. In the Supabase dashboard, go to **Storage → New bucket** and create one
   named exactly `avatars` (public is fine — photos render in the topbar
   for everyone).
2. If you already ran the earlier schema/migrations, run
   `supabase/migrations/005_settings.sql` — it adds the admin
   profiles-update policy (profiles previously only allowed self-edits,
   which would have silently blocked admin name corrections) and the
   avatar storage policies.

## Roadmap (next phases)

1. **Accounts** — admin account/role creation, org membership + tagging.
