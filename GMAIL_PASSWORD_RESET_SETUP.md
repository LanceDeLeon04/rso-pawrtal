# Gmail OTP Password Reset — Setup

Every account can now reset its own password from the Sign-in screen by
receiving a 6-digit code on the Gmail address it has on file, instead of
waiting for an SDAO Admin to do it from Accounts.

## How it works
1. **Every account must have a `recovery_email` on file.** New/first-time
   sign-ins are forced through `/add-recovery-email` (see
   `ProtectedRoute.jsx`) before reaching any other page. Anyone can also
   add or change it later from **Settings → Recovery Gmail**.
2. On the Sign-in screen, **Forgot password?** goes to
   `/forgot-password`, which:
   - asks for the username, then calls the `send-password-reset-otp`
     Edge Function, which emails a 6-digit code (10-minute expiry) to
     that account's `recovery_email` via the same Gmail SMTP sender
     already used for status-update emails.
   - asks for the code + a new password, then calls
     `verify-password-reset-otp`, which checks the code and sets the
     new password via the Supabase Auth admin API.
3. Accounts with **no Gmail on file** are flagged with a "No Gmail on
   file" notice in both account tables under **Accounts**, so an SDAO
   Admin knows to still use the manual **Reset Password** button for
   them (existing flow, unchanged) until the person adds one.

Both responses from `send-password-reset-otp` are intentionally generic
("if that account has a Gmail on file, we've sent a code") so an
unauthenticated caller can't use this to check whether a username
exists.

## One-time setup

### 1. Apply the migration
```
supabase db push
```
This adds `profiles.recovery_email` and the `password_reset_otps` table
(migration `069`).

### 2. Deploy the Edge Functions
```
supabase functions deploy send-password-reset-otp --no-verify-jwt
supabase functions deploy verify-password-reset-otp --no-verify-jwt
```
(`config.toml` already sets `verify_jwt = false` for both — they're
called by someone who, by definition, isn't logged in.)

### 3. Secrets
These reuse the **same** secrets as `notify-status-email` — if that's
already set up, there's nothing new to configure:
```
supabase secrets set GMAIL_USER=youraddress@gmail.com
supabase secrets set GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx
```

## Existing accounts
Accounts created before this feature will have `recovery_email = null`.
They'll be prompted to add one the next time they sign in (mandatory),
and admins will see "No Gmail on file" for them in Accounts until then.
