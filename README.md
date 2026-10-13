# in2sight

A private dashboard that pulls Instagram insights (Meta API) for several accounts and analyses them: trends, content analysis, Stories, alerts, Excel/PDF reports. Next.js on Vercel, Supabase for data and login (with 2FA), installable as a PWA, English + 简体中文.

- **Design:** [docs/SPEC.md](docs/SPEC.md) · **Plans:** [docs/superpowers/plans/](docs/superpowers/plans/) · **Progress:** [docs/TODO.md](docs/TODO.md)
- **Visual reference:** [docs/mockups/](docs/mockups/README.md)
- **Setting up (owner):** start at [docs/SETUP.md](docs/SETUP.md) → [Supabase](docs/SETUP_SUPABASE.md) → [Meta / Instagram](docs/META_SETUP.md); copy `.env.example` to `.env.local` and run `npm run check:env`.

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # lint + typecheck + tests + build
```
