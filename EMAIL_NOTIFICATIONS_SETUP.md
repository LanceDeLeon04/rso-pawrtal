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
