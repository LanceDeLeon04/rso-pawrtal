# Status Email Notifications — Setup

Every time a submission is checked / endorsed / returned / approved / rejected
/ deadline-extended (including external adviser, dean, SDG rep, and marketing
rep decisions, and reports — they all flow through the same
`submission_status_history` table), the system now emails the submitter's
**NU email** and **personal email (Gmail/Outlook)** automatically.

## How it works
1. Any status change inserts a row into `submission_status_history` (already happens today).
2. A new DB trigger (`trg_notify_submission_status_email`, migration `049`) fires on that insert and calls the `notify-status-email` Edge Function via `pg_net` — async, so it never blocks or fails the underlying approval action.
3. The Edge Function looks up the submission, builds a short status email, and sends it to both `submissions.email` (NU email) and `submissions.personal_email` via Gmail SMTP.

## One-time setup

### 1. Apply the migration
```
supabase db push
```
This adds `submissions.personal_email`, the `app_config` table, enables `pg_net`, and creates the trigger.

### 2. Deploy the Edge Function
```
supabase functions deploy notify-status-email
```

### 3. Set the Edge Function's secrets
```
supabase secrets set GMAIL_USER=youraddress@gmail.com
supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   # 16-char Gmail App Password, NOT your login password
supabase secrets set EMAIL_WEBHOOK_SECRET=<a long random string>
supabase secrets set SITE_URL=https://your-deployed-app-url
```
Generate a Gmail App Password at https://myaccount.google.com/apppasswords (requires 2-Step Verification enabled on that Gmail account).

### 4. Point the DB trigger at your deployed function
Run this once in the Supabase SQL editor (use the **same** random string as `EMAIL_WEBHOOK_SECRET` above):
```sql
update app_config set value = 'https://<your-project-ref>.functions.supabase.co'
  where key = 'functions_base_url';

update app_config set value = '<the same long random string>'
  where key = 'email_webhook_secret';
```

That's it — until both `app_config` rows are filled in, the trigger silently
skips sending (so nothing breaks if this isn't set up yet).

## What changed for submitters
The Event Application and Merchandise Proposal forms now ask for two emails
instead of one:
- **NU Email Address** — unchanged, still printed on the ACP/FRF forms.
- **Personal Email (Gmail/Outlook)** — new, used only for notifications.

Both fields are required. The form tells submitters both addresses will get
every status update, and that they can also check status anytime inside
Submission Bin.

## Approver notifications (who acts next)

Migration `061` adds the other direction: whoever's turn it is to act gets
emailed too, not just the submitter.

- **Internal reviewers** — when a submission lands on `assistant_review`,
  `supervisor_endorsement`, `director_approval`, or the SHS equivalents,
  every active account with the matching role (SDAO Assistant, SDAO
  Supervisor, Academic Director, SDAO-SHS, SHS Principal, Executive
  Director) gets an email pointing to Submission Bin.
- **External approvers** — when an Adviser/Dean/SDG Rep/Marketing
  Rep/Org President/Org Moderator link is generated or reissued,
  that person is emailed their `/approve/:token` link directly (no more
  relying on someone forwarding it manually).

Same one-time setup as above (`app_config.functions_base_url` /
`email_webhook_secret`) covers this too — just also run:
```
supabase functions deploy notify-approver-email
```
Same `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `EMAIL_WEBHOOK_SECRET` / `SITE_URL`
secrets are reused; no separate secrets needed. Delivery failures here are
swallowed the same way as `049` — a broken email pipeline never blocks an
approval, endorsement, return, or link generation.

## Push notifications (real desktop/phone popups, migration 061 -> 063)

Migration `063` adds actual browser push (Web Push) — an OS-level popup
that appears even if RSO Pawrtal isn't open, not just an in-app toast.
It rides alongside the emails above, it doesn't replace them.

**Scope:** anyone with an in-app account — submitters and internal
reviewers (SDAO Assistant/Supervisor, Academic Director, SDAO-SHS, SHS
Principal, Executive Director). External approvers (Adviser/Dean/SDG
Rep/Marketing Rep/Org President/Org Moderator) only ever get the
emailed link, since they have no account to subscribe from — that part
is unchanged.

### 1. Generate a VAPID keypair (one-time, per deployment)
```
npx web-push generate-vapid-keys
```
This prints a public and private key. Example shape:
```
Public Key:
BN8Ege5VxrYFHqbk5biwTahMsXP-JZFboIXw2ytvOYYmzhzbDJo1nA6CadAJfJ3iT2OlGsne47aZl4U_LFBVe7Q

Private Key:
R10z51aJVdbo4ReHHaqDCckSq3YSPNqGtAjocp6cSTQ
```
Generate your own — don't reuse the example above.

### 2. Apply the migration and deploy the function
```
supabase db push
supabase functions deploy send-push
```

### 3. Set the Edge Function secrets
```
supabase secrets set VAPID_PUBLIC_KEY=<public key from step 1>
supabase secrets set VAPID_PRIVATE_KEY=<private key from step 1>
supabase secrets set VAPID_SUBJECT=mailto:youraddress@gmail.com
```
`EMAIL_WEBHOOK_SECRET` is reused from the email setup above — no need
to set it again.

### 4. Give the frontend the public key
Add to `.env` (and to your host's environment variables if deployed):
```
VITE_VAPID_PUBLIC_KEY=<the same public key from step 1>
```
Then rebuild/redeploy the frontend.

### What changed for users
Settings now has a "Desktop & Phone Notifications" toggle. Each person
enables it per browser/device they want to be notified on (their
laptop, their phone's browser, etc.) — the browser will ask for
notification permission the first time. Nothing sends until they opt
in, and they can turn it off again anytime from the same toggle.

Same as the email pipeline: until `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` are set, push sends are skipped — nothing breaks,
it just silently doesn't fire.
