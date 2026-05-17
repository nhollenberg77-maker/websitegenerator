# Strona dla Twojej Firmy — Polish Lead Pipeline

Geautomatiseerde lead-pipeline voor Poolse aannemers:
**Discovery → Qualify → Enrich → Site generation → Email**

- `discovery.py` — Google Places search per stad + categorie
- `qualify.py` — scoring op slechte/oude websites + sterke GBP
- `enrich.py` — Google Places details (foto's, reviews, beschrijving)
- `dashboard/` — Next.js dashboard met cockpit, leads, sites, instellingen

## Lokaal draaien

```bash
# Python pipeline
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # vul GOOGLE_MAPS_API_KEY in

# Dashboard
cd dashboard
cp .env.example .env
cp settings.example.json settings.json  # vul SMTP in
npm install   # of bun install
npm run dev   # → http://localhost:3000
```

## Architectuur

```
┌─────────────────┐   spawns   ┌──────────────────┐
│  Dashboard      │───────────▶│  Python scripts  │
│  (Next.js +     │            │  discovery.py    │
│   node-cron)    │            │  qualify.py      │
│                 │            │  enrich.py       │
└────────┬────────┘            └────────┬─────────┘
         │                              │
         │  read/write                  │  read/write
         ▼                              ▼
    ┌─────────────────────────────────────┐
    │       leads.db (SQLite)             │
    └─────────────────────────────────────┘
         │
         │  site-generator.ts writes HTML
         ▼
    dashboard/public/sites/{place_id}/index.html
```

## Vercel deploy

**Wat werkt op Vercel out-of-the-box:**
- ✅ Publieke serving van `dashboard/public/sites/{place_id}/index.html` (de email-links)
- ✅ Dashboard UI rendert
- ✅ Read-only DB-queries (als `leads.db` mee-gecommit is)

**Wat NIET werkt op Vercel zonder refactor:**
- ❌ "Start cyclus" knop — geen Python runtime, geen `spawn('python3')`
- ❌ Site (re)generatie via dashboard API — Vercel filesystem is read-only
- ❌ Settings opslaan — schrijft naar `settings.json`
- ❌ `node-cron` agent — Vercel functions zijn serverless, geen long-running proces

**Aanbevolen workflow:**

1. **Pipeline lokaal draaien** op je eigen machine (zoals nu)
2. Na een run: `cd dashboard && git add public/sites && git commit -m "update sites" && git push`
3. Vercel deploy is automatisch → de sites staan op `https://{vercel-url}/sites/{place_id}/index.html`
4. Email-templates linken naar die URL

**Vercel-import stappen:**

1. Ga naar https://vercel.com/new
2. Import deze repo
3. **Root Directory: `dashboard`** (belangrijk — onze Next.js zit in een submap)
4. Framework: Next.js (auto)
5. Build command: `next build` (auto)
6. Deploy

Geen env-vars nodig op Vercel zelf (de DB is statisch read-only, sites zijn statisch).

## Volledig Vercel-native maken (later)

Als je het dashboard ook vol-functioneel op Vercel wilt:
- DB → Vercel Postgres / Neon / Turso
- Site HTML → Vercel Blob (i.p.v. filesystem)
- Python scripts → externe runner (GitHub Actions, Render, Fly.io) of port naar TypeScript
- Cron → Vercel Cron (max 2 jobs op free tier)

Geschat ~4–8 uur refactor. Voor nu is de lokaal-draaien + Vercel-CDN aanpak prima.
