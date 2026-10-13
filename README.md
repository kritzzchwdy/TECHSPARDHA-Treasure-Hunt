# TECHSPARDHA 2K26 — Treasure Hunt

A mobile-first, team-based treasure hunt web app scaffold using React + Vite + Supabase.
Includes four rounds, team/admin roles, server-authoritative attempt timing, answer checking,
qualification workflow, and QR code generation.

## Important design/security notes
- Timer timestamps and answer validation are database-side, not trusted from the browser.
- Teams can read only their own team/attempt data through RLS.
- Admin access is based on `profiles.role = 'admin'`; never allow users to self-assign this role.
- The initial admin must be promoted manually in Supabase SQL Editor after signing up.
- QR codes contain checkpoint IDs/URLs, not answer keys.
- "Back" does not reset a timer; the app resumes the saved active question.
- A QR code alone is not proof that a team is physically at a checkpoint. For stronger location control,
  use volunteers or a one-time checkpoint code displayed at the location.
- This is a deployable starter project; configure Supabase credentials and run the SQL before use.

## Stack
- React + Vite
- Supabase Auth, Postgres, Row Level Security, database RPC functions
- `qrcode.react` for QR generation
- Vercel free hosting option

## 1. Create Supabase project
1. Create a free project at https://supabase.com/
2. Open SQL Editor and run `supabase/schema.sql`.
3. In Authentication settings, enable email/password. For a controlled college event, admin can create team accounts or you can adapt registration to invite-only.
4. Create your own admin account through the app's sign-up form.
5. In SQL Editor, promote that user to admin (replace email):
   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
   ```
6. Add questions using the Admin page. The included seed file has medium-level example questions.

## 2. Run locally
```bash
npm install
cp .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
npm run dev
```

## 3. Deploy free
1. Push this folder to a GitHub repository.
2. Import the repository at https://vercel.com/
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables.
4. Deploy.
5. In Supabase Auth URL Configuration, set Site URL and Redirect URLs to your deployed domain.

## 4. Event setup
- Sign in as admin, create teams, and add questions in all four rounds.
- Publish each round only after checking questions and answer keys.
- Use Admin > QR Codes to generate/print the start QR and checkpoint QR codes.
- Team flow: login → scan/start → answer question → correct answer unlocks next question/checkpoint.
- For elimination, admin marks teams qualified after reviewing scores and completion times.
- Round 4 final standings are ranked by score, then elapsed time.

## Included default rules
- Round 1: top 15 qualify
- Round 2: top 10 qualify
- Round 3: top 3 qualify
- Round 4: winner based on published scoring rule
- Team count is configurable; the qualification counts can be adjusted to match actual attendance.

## Limitations to address before a live event
- This starter provides core app workflows, not a substitute for a full security audit.
- Use strong admin passwords and enable MFA on the admin account.
- Do not put answer keys in client-side code.
- Test simultaneous submissions, network loss, and mobile browsers before the event.
- If strict single-device use is needed, add device binding and a volunteer override process.
