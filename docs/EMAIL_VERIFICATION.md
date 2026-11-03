# NYEOCARE email verification and account identity

## Product contract

- Authentication remains powered by Supabase Auth, but users interact with NYEOCARE-branded pages and messages.
- Normal email addresses are global identities: one normalized email can belong to only one NYEOCARE organization at a time.
- Email verification is required before creating a personal organization or accepting an organization invitation.
- Verification links return to the NYEOCARE app, exchange the one-time Supabase token hash, then complete the intended action.
- Invitations preserve their invitation destination. A person verifying an invitation signup is joined to the invited organization; they are not silently given a personal workspace.
- Deleting an organization deletes its linked Supabase Auth identities as well as its organization-scoped application records (the `public.users.organization_id` relationship already cascades). This releases the addresses for future registration. A restricted global deletion audit retains the organization name, identifier, timestamp, and number of Auth identities deleted, but no email addresses or passwords.

## User-facing flows

### Standalone signup

1. The signup request sets `emailRedirectTo` to `/auth/verify?next=%2Fauth%2Fcomplete-signup`.
2. The confirmation email opens the NYEOCARE verification route with `token_hash` and `type=signup`.
3. The verifier exchanges the token hash, requires a real session, and calls the explicit organization-creation endpoint.
4. The endpoint checks `email_confirmed_at` again on the server before provisioning.

### Invitation signup

1. Invitation signup sets `emailRedirectTo` to `/auth/verify?next=%2Fjoin%2F<token>`.
2. The branded email link verifies the address on the NYEOCARE domain.
3. The verifier accepts the invitation with the verified bearer token.
4. The join endpoint re-validates the invitation, email, organization, and account state in a transaction. It never creates a personal organization as a side effect.

### Resending

The login and invitation screens call Supabase Auth's `resend({ type: 'signup' })` with the same NYEOCARE redirect destination. The UI uses NYEOCARE language and does not expose Supabase.

## Database identity enforcement

Migration `20261102120000_global_email_identity_and_org_auth_cleanup.sql` creates a unique index over `lower(public.users.email)`. The server also serializes assignment using an advisory lock scoped to the normalized email and returns a conflict rather than creating a second tenant membership.

The migration installs a `BEFORE DELETE` trigger on `public.organizations`. It snapshots the tenant's linked Auth IDs, deletes those identities from `auth.users` (which also removes their Auth identities and sessions), and writes a minimal restricted audit row. The organization delete then cascades through the tenant-owned application data and operator rows. If Auth deletion fails, the transaction fails and the organization is not deleted.

Do not bypass the organization deletion trigger or directly delete `public.users` rows as a substitute for deleting a tenant. If a single operator is removed from an active organization, use the dedicated operator-removal workflow and explicitly decide whether to revoke or retain that person's global NYEOCARE Auth identity.

## Supabase Auth configuration still required for branded delivery

The application code cannot create a legitimate sending identity without a domain the NYEOCARE owner controls and an authenticated email delivery provider. Configure these once the sender domain and provider credentials are available:

1. Choose a domain owned by NYEOCARE and use a dedicated authentication subdomain such as `auth.<owned-domain>`. Do not use a domain that NYEOCARE does not control, such as `vercel.app`.
2. Set up a transactional mail provider (Resend is a straightforward SMTP option) and publish its SPF, DKIM, and DMARC DNS records.
3. In Supabase Dashboard → Authentication → SMTP Settings, enable custom SMTP and set:
   - Sender name: `NYEOCARE`
   - Sender address: `no-reply@auth.<owned-domain>`
   - SMTP host, port, username and password supplied by the provider
4. In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to the production NYEOCARE app URL and allow the production `/auth/verify` destination plus the required local-development URLs.
5. In Authentication → Email Templates, use the confirmation template below. The Supabase token hash is exchanged by NYEOCARE; the user never lands on a Supabase-hosted verification page.
6. Add the matching branded magic-link template if passwordless sign-in is enabled.
7. Send test emails to external addresses and verify the From identity, delivered headers, SPF, DKIM, DMARC, link destination, expired-link behavior, and resend rate limiting before announcing verification as live.

### Confirmation email template

Subject: `Verify your NYEOCARE email`

```html
<div style="margin:0;padding:40px 16px;background:#080d18;font-family:Arial,sans-serif;color:#f3f4f6">
  <div style="max-width:520px;margin:0 auto;padding:36px 28px;border:1px solid #202b3e;border-radius:20px;background:#101727">
    <div style="font-size:20px;font-weight:700;letter-spacing:3px;color:#fff">NYEOCARE</div>
    <div style="width:42px;height:2px;margin:12px 0 30px;background:#e6b93f"></div>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.35;color:#fff">Verify your email address</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:1.7;color:#b7c0cf">Confirm this email address to secure your NYEOCARE account and continue.</p>
    <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=signup" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#e6b93f;color:#080d18;text-decoration:none;font-size:14px;font-weight:700">Verify email</a>
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#8390a4">This link can only be used once. If you did not request this, you can ignore this email.</p>
  </div>
</div>
```

### Magic-link email template (only if passwordless sign-in remains enabled)

Subject: `Your NYEOCARE sign-in link`

```html
<div style="margin:0;padding:40px 16px;background:#080d18;font-family:Arial,sans-serif;color:#f3f4f6">
  <div style="max-width:520px;margin:0 auto;padding:36px 28px;border:1px solid #202b3e;border-radius:20px;background:#101727">
    <div style="font-size:20px;font-weight:700;letter-spacing:3px;color:#fff">NYEOCARE</div>
    <div style="width:42px;height:2px;margin:12px 0 30px;background:#e6b93f"></div>
    <h1 style="margin:0 0 14px;font-size:22px;color:#fff">Sign in securely</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:1.7;color:#b7c0cf">Use this one-time link to sign in to NYEOCARE.</p>
    <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=magiclink" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#e6b93f;color:#080d18;text-decoration:none;font-size:14px;font-weight:700">Sign in to NYEOCARE</a>
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#8390a4">If you did not request this link, you can ignore this email.</p>
  </div>
</div>
```

## Current production activation gate

The Vercel project currently has only the `nyeocare.vercel.app` application domain. It does not own a sending domain, and no custom SMTP credentials are configured in the production environment. The app's callback and email flows can be deployed, but the sender name/address and actual delivery cannot honestly be called fully branded or production-ready until the domain and SMTP provider are configured.

## Password recovery — NYEOCARE-branded flow

### User journey

1. The sign-in screen links to `/forgot-password`.
2. The user enters an email address. The page calls Supabase Auth's recovery endpoint with a redirect to `/auth/verify?next=%2Freset-password`.
3. The response shown is identical whether the address exists or not. Do not add a public account-existence lookup.
4. The recovery email carries a one-time token hash to the NYEOCARE verification route. The route exchanges it with `verifyOtp({ token_hash, type: 'recovery' })`, then sends the user to the NYEOCARE password form.
5. The reset page requires a verified recovery session and enforces the same 12-character password policy as signup.
6. After a successful update, NYEOCARE revokes the user's sessions and returns them to sign in.

Supabase Auth's built-in per-user recovery request interval defaults to 60 seconds. The NYEOCARE page also displays a 60-second cooldown to prevent accidental repeated submissions in the same browser. The project-level Auth rate limit remains the authoritative enforcement; the browser timer is not a security boundary.

### Recovery email template

In Supabase Dashboard → Authentication → Email Templates → Reset Password:

Subject: `Reset your NYEOCARE password`

```html
<div style="margin:0;padding:40px 16px;background:#080d18;font-family:Arial,sans-serif;color:#f3f4f6">
  <div style="max-width:520px;margin:0 auto;padding:36px 28px;border:1px solid #202b3e;border-radius:20px;background:#101727">
    <div style="font-size:20px;font-weight:700;letter-spacing:3px;color:#fff">NYEOCARE</div>
    <div style="width:42px;height:2px;margin:12px 0 30px;background:#e6b93f"></div>
    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.35;color:#fff">Choose a new password</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:1.7;color:#b7c0cf">We received a request to reset your NYEOCARE password. Use the secure link below to choose a new one.</p>
    <a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#e6b93f;color:#080d18;text-decoration:none;font-size:14px;font-weight:700">Reset password</a>
    <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#8390a4">This link is single-use and expires after 30 minutes once the project expiry setting below is configured. If you did not request a reset, ignore this email.</p>
  </div>
</div>
```

The `RedirectTo` value is generated by NYEOCARE and points to the branded verification route. Do not replace it with `{{ .ConfirmationURL }}`, which would send the user through a Supabase-hosted verification URL.

### Password-changed notification template

In Authentication → Email Templates → Security Notifications, enable the **Password changed** notification.

Subject: `Your NYEOCARE password was changed`

```html
<div style="margin:0;padding:36px 16px;background:#080d18;font-family:Arial,sans-serif;color:#f3f4f6">
  <div style="max-width:520px;margin:0 auto;padding:32px 26px;border:1px solid #202b3e;border-radius:18px;background:#101727">
    <div style="font-size:20px;font-weight:700;letter-spacing:3px;color:#fff">NYEOCARE</div>
    <div style="width:42px;height:2px;margin:12px 0 26px;background:#e6b93f"></div>
    <h1 style="font-size:21px;color:#fff">Your password was changed</h1>
    <p style="font-size:14px;line-height:1.7;color:#b7c0cf">The password for your NYEOCARE account was recently changed.</p>
    <p style="font-size:13px;line-height:1.7;color:#b7c0cf">If you did not make this change, use the password recovery page immediately and contact your organization administrator.</p>
    <a href="{{ .SiteURL }}/login" style="display:inline-block;margin-top:10px;padding:12px 18px;border-radius:9px;background:#e6b93f;color:#080d18;text-decoration:none;font-weight:700">Open NYEOCARE</a>
  </div>
</div>
```

## Required production Auth settings

These are project settings, not application code. They must be explicitly checked in the live Supabase project:

1. **Email confirmation:** keep confirmation required/enabled. A confirmed email is required before NYEOCARE provisions an organization or accepts an invitation.
2. **OTP expiry:** set the project email OTP expiry to **1800 seconds (30 minutes)**. Confirm in the dashboard that this applies to signup confirmation and password recovery.
3. **Password security:** set minimum password length to **12** and require lowercase, uppercase, numeric, and symbol characters. Signup and reset pages now share this policy. Project-level password rules are required because browser checks can be bypassed by direct API requests.
4. **Rate limits:** keep the password-recovery per-user request interval at **60 seconds or higher**. The built-in default is 60 seconds; do not lower it.
5. **Redirect allow list:** allow the exact production `/auth/verify` callback URL and local development callback URL if used.
6. **Security notification:** enable the password-changed email notification and paste the template above.

## Branding and delivery boundary

NYEOCARE now owns the signup/recovery screens, callback route, user-facing copy, password rules, and email HTML templates. Supabase Auth still handles identity and one-time token verification behind the scenes. No Supabase dashboard or provider URL needs to appear in the user's journey when the templates and redirect configuration are activated.

However, the actual email sender cannot honestly be branded as NYEOCARE until a domain controlled by NYEOCARE and a custom SMTP provider are configured. The current shared Supabase mailer only sends to project-team addresses and is limited to 2 emails per hour. It is not an external-user delivery solution. Do not launch this flow to external active users until a verified sending domain, SMTP credentials, and sender DNS records (SPF, DKIM and DMARC) are in place.
