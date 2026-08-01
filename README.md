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

## Roadmap (next phases)

1. **Assignments** — admin-side assignment of submissions to reviewers,
   wired into Submission Bin.
2. **Settings** — password change, profile photo upload.
3. **Accounts** — admin account/role creation, org membership + tagging.
