### Free-tier notes
- The reference data is roughly **42 MB**, well under the 500 MB database limit.
- Free Supabase projects **pause after about a week of inactivity**. Open the dashboard and confirm the project is running before a demo.

---

## Getting started

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Create the tables:** open the SQL editor and run `db/schema_postgres.sql`.
3. **Configure email/password auth** in Authentication → Providers → Email. Enable email/password sign-up and, preferably, email confirmation. The app requires passwords of at least 8 characters. In Authentication → URL Configuration, add `http://localhost:5173/**` to the redirect URLs; password recovery returns to `/reset-password`.
4. **Seed the reference data** from PowerShell (run from the repository root):
   ```powershell
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   py -m pip install "psycopg[binary]>=3.1"
   $env:DATABASE_URL = "postgresql://postgres:<password>@<host>:5432/postgres"
   py scripts\seed_pokedex.py --dry-run   # check row counts first
   py scripts\seed_pokedex.py             # load into the empty database
   ```
   Use the connection string from Supabase's Connect dialog. If your network has no IPv6, use the Session pooler string. Keep this database password private; it is only for the seed script and must never go in a `VITE_` variable.
5. **Configure and run the frontend:**
   ```powershell
   Copy-Item .env.example .env.local
   # Edit .env.local and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
   npm install
   npm run dev
   npm test
   ```
   Use Node.js 20.19+ or 22.12+. Use the project's URL and anon/publishable key from Supabase's API settings. Never put the `service_role` key in the frontend. The seed can also be previewed without a database URL using `py scripts\seed_pokedex.py --dry-run`.

   Supabase's built-in email service has tight limits and is intended for testing. For confirmation and password-reset emails to regular users, configure a custom SMTP provider.

   Users who already created an account with the previous email-link flow can use **Forgot password?** to set an initial password; their account ID and saved teams remain the same.

Re-seeding with `--reset` wipes the reference tables and also deletes any saved teams, so only use it before real users arrive.

The app provides `/` for email/password sign-in and account creation, `/forgot-password` and `/reset-password` for account recovery, `/home` for navigation, `/pokedex` for searching and browsing default Pokémon forms, and `/team-builder` for creating teams and adding Pokémon. The team builder writes to the user-owned tables protected by the schema's RLS policies.

### Deploy to GitHub Pages

The repository includes a GitHub Actions workflow that builds and deploys the app when changes are pushed to `main`.

1. In GitHub, open **Settings → Pages** and set the build source to **GitHub Actions**.
2. Under **Settings → Secrets and variables → Actions → Variables**, add:
   - `VITE_SUPABASE_URL`: your Supabase project URL.
   - `VITE_SUPABASE_ANON_KEY`: your Supabase anon/publishable key. This key is designed to be public; never use the `service_role` key here.
3. In Supabase, set the Auth **Site URL** to `https://zonkeyzebra.github.io/pokedex-team-builder/` and add `https://zonkeyzebra.github.io/pokedex-team-builder/**` to the allowed redirect URLs. Keep `http://localhost:5173/**` there for local development.
4. Push to `main` or run the workflow manually from GitHub Actions. The deployed site will be at `https://zonkeyzebra.github.io/pokedex-team-builder/`.

The build uses the repository subpath as its Vite base, configures React Router for that base, and emits a `404.html` fallback so refreshing a nested route (such as a Pokémon detail page) still loads the app. No database password or seed connection string belongs in GitHub Actions; the seed runs locally.

### Seed data notes
- Names are stored as PokeAPI identifiers (`mr-mime`, `thunder-punch`); the frontend formats them for display.
- Default forms use the plain species name. Mega, Gigantamax, and regional forms are separate rows with `is_default = false`.
- Learnsets exclude Let's Go, Legends: Arceus, and Legends: Z-A so spin-off movepools do not appear in mainline learnsets.
- Only held items are loaded, since those are what the team builder needs.