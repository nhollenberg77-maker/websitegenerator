# Agent Team — ontwerp & architectuur

Dit document is de bron-van-waarheid voor de omzetting van de sequentiële
lead-pijplijn naar een **team van autonome agents** dat samenwerkt op een
gedeeld werkbord, leert van resultaten, en 24/7 in de cloud draait.

Brand: **Strona dla Twojej Firmy** (Poolse lead-gen voor lokale bedrijven).

---

## 1. De omslag

**Vandaag** (`dashboard/lib/agent.ts`): één functie `runAgentCycle()` draait
alle stappen sequentieel — discovery → qualify → email-scrape → enrich →
foto-curatie → site-gen → screenshot → deploy → mail. Aangestuurd door
`node-cron` _binnen_ het Next.js-proces. De "intelligentie" zit in 3 kleine
AI-calls (foto-curator, mail-personalizer, mail-reviewer).

**Straks**: een **team van agents** dat elk redeneert, werk doorgeeft via een
gedeeld werkbord (de SQLite-DB), onderling berichten stuurt, en van uitkomsten
leert. Een **Manager**-agent stuurt het team aan en stelt hun strategie bij.

De bestaande Python-scripts (`discovery.py`, `qualify.py`, `enrich.py`) en de
TypeScript site-generator/mailer worden **niet weggegooid** — ze worden
*gereedschap* dat de agents aanroepen. De agents voegen het redeneren, de
coördinatie en het lerend vermogen toe.

---

## 2. Het team

| Agent | Rol | Tools |
|-------|-----|-------|
| 🧭 **Manager** | Bepaalt doelen, verdeelt werk, beoordeelt kwaliteit, geeft feedback, stelt strategie van de anderen bij | LLM tool-use loop: stats lezen, feedback lezen, runs/messages lezen, taken aanmaken, `agent_config` aanpassen, doelen openen/sluiten, berichten posten |
| 🔍 **Scout** | Vindt *goede* leads; redeneert over welke steden/categorieën kansrijk zijn; beoordeelt lead-kwaliteit | `discovery.py`, `qualify.py`, e-mail-scrape, LLM-redenering over targets |
| 🏗️ **Builder** | Maakt concept-site per bedrijf; kijkt naar eigen screenshot (vision) en verbetert tot kwaliteitsdrempel | `enrich.py`, foto-curatie, `site-generator`, screenshot, LLM vision-kritiek |
| ✍️ **Writer** | Schrijft outreach-mail, controleert op spam/Pools/kwaliteit, zet klaar voor goedkeuring | mail-personalizer, mail-template, mail-reviewer, LLM-redactie |

Verzenden gebeurt **alleen na menselijke goedkeuring** (goedkeur-poort), met
respect voor `config/sending_schedule.yml` (warming, throttle, circuit breakers).

---

## 3. Samenwerking & leren — concreet

Geen zware message-bus. Drie mechanismen, alle op de SQLite-DB:

1. **Gedeeld werkbord** — de `tasks`-tabel is de werkwachtrij. Een agent rondt
   een taak af en zet downstream-taken klaar (discover→qualify klaar →
   `build_site`-taak per nieuwe qualified lead → site klaar → `write_email`-taak).
2. **Onderlinge berichten** — `agent_messages`. Agents posten handoffs/feedback/
   alerts. De Manager leest die en stuurt bij. Het dashboard rendert dit als een
   **team-chat / activiteitenfeed** zodat je het team ziet samenwerken.
3. **Leerlus** — elke mail-uitkomst (open/reply/bounce/uitschrijving) en elke
   kwaliteitsbeoordeling gaat naar `feedback`. De Manager bekijkt geaggregeerde
   feedback en **herschrijft de strategie** (`agent_config.strategy`) van elke
   agent. Voorbeeld: "dakdekkers met >50 reviews antwoorden 3× vaker → Scout,
   prioriteer die." Meetbaar en zichtbaar in het dashboard.

---

## 4. Datamodel (uitbreiding van `leads.db`)

Bestaande tabellen `leads` en `rejected_leads` blijven. Nieuw:

```sql
-- Hoog-niveau doelen die de Manager nastreeft
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  metric TEXT,                 -- bv. 'qualified_leads'
  target_value INTEGER,
  current_value INTEGER DEFAULT 0,
  params TEXT,                 -- JSON: {cities, categories, ...}
  status TEXT DEFAULT 'active',-- active | done | paused
  created_by TEXT DEFAULT 'human',
  created_at TEXT, updated_at TEXT
);

-- Werkwachtrij (het werkbord)
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,          -- discover|qualify|enrich|build_site|write_email|manage
  status TEXT DEFAULT 'pending',-- pending|running|done|failed|blocked
  priority INTEGER DEFAULT 5,  -- lager = eerder
  payload TEXT,                -- JSON
  lead_place_id TEXT,
  goal_id INTEGER,
  assigned_agent TEXT,
  attempts INTEGER DEFAULT 0,
  result TEXT, error TEXT,
  created_at TEXT, started_at TEXT, finished_at TEXT
);

-- Log van elke agent-uitvoering (met redenering, voor de UI)
CREATE TABLE agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  task_id INTEGER,
  status TEXT,                 -- ok|error
  summary TEXT,                -- 1-regel resultaat
  reasoning TEXT,              -- agent's redenering (zichtbaar in UI)
  model TEXT, tokens INTEGER,
  started_at TEXT, finished_at TEXT
);

-- Onderlinge berichten / activiteitenfeed
CREATE TABLE agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_agent TEXT NOT NULL,
  to_agent TEXT,               -- NULL = broadcast
  kind TEXT DEFAULT 'info',    -- info|handoff|feedback|request|alert
  body TEXT NOT NULL,
  lead_place_id TEXT, task_id INTEGER,
  created_at TEXT
);

-- Uitkomsten + lessen voor de leerlus
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- email_outcome|quality_review|manager_insight
  lead_place_id TEXT,
  metric TEXT, value TEXT,     -- JSON
  note TEXT,
  applied INTEGER DEFAULT 0,
  created_at TEXT
);

-- Instelbare missie/strategie per agent (door Manager bijgesteld)
CREATE TABLE agent_config (
  agent TEXT PRIMARY KEY,      -- manager|scout|builder|writer
  mission TEXT,                -- stabiel: wie ben je
  strategy TEXT,               -- dynamisch: door Manager bijgesteld o.b.v. feedback
  model TEXT,
  enabled INTEGER DEFAULT 1,
  updated_by TEXT, updated_at TEXT
);
```

Nieuwe kolommen op `leads`:

```
site_quality_score INTEGER   -- Builder vision-kritiek (0-10)
site_critique      TEXT       -- JSON: wat goed/slecht is
email_quality_score INTEGER  -- Writer self-review (0-10)
email_subject      TEXT       -- klaargezette mail
email_body_html    TEXT
approval_status    TEXT       -- none|pending|approved|rejected|sent
approval_note      TEXT
approved_at        TEXT
```

---

## 5. Runtime — long-running worker (cloud 24/7)

`node-cron` binnen Next.js werkt niet op serverless en niet als de laptop uit
staat. Daarom een **aparte, langlopende worker**:

- `dashboard/worker.ts` — start een lus die elke paar seconden `orchestrator.tick()`
  draait. `npm run worker`.
- `dashboard/lib/agents/orchestrator.ts` — `tick()`:
  1. Haal pending taken (op prioriteit, met concurrency-limiet).
  2. Dispatch elke taak naar de juiste agent-handler.
  3. Bij afronding: enqueue downstream-taken.
  4. Periodiek (elke N ticks of bij stagnatie): draai de **Manager**.
  5. Verstuur **goedgekeurde** mails (approval_status=approved) binnen het
     sending-schedule.

De Next.js-dashboard (op Vercel of dezelfde box) leest/schrijft dezelfde DB.

**Cloud-opzet (aanbevolen):** één kleine always-on box (Railway / Fly.io / VPS)
draait zowel `npm run worker` als `npm run start` (Next.js), met de SQLite-DB op
een persistent volume. Zie §8.

---

## 6. Agent-implementatie — agent-native (v2)

**Alle vier de agents zijn nu echte tool-use loops** (geen scripts met een AI-sausje
meer). Eén runner (`lib/agents/runner.ts`) draait elke agent als een multi-step
loop op de Messages API met een eigen toolkit + tokenbudget; vision loopt via
**image-tool-results** (de Builder bekijkt zijn eigen screenshot ín de loop).

De Python-pijplijn (`discovery/qualify/enrich.py`) is **uit de hot path**: Google
Places is geport naar TS (`lib/agents/places.ts`) en de kwalificatie is nu
**agent-oordeel** i.p.v. `bad_site_score`-regels. De agent bekijkt de site
(`fetch_website`) en beslist zelf.

- **Tool-registry** (`lib/agents/tools/`): per agent een subset (onderzoek,
  lead-data, bouw, schrijf, coördinatie). `lib/agents/registry.ts` koppelt
  agent → model/toolkit/budget.
- **Lean**: workers op Haiku, Manager op Sonnet; strakke `maxIterations` +
  `budgetTokens`; de runner stopt bij het plafond. Volledig token-/kostenverbruik
  wordt gemeten (`agent_runs.input/output_tokens` + `pricing.ts`).
- Geverifieerd: Scout-dry-run deed 9 iteraties / 27 tool-calls, zocht via Places,
  beoordeelde sites en kwalificeerde met oordeel.

Bestanden onder `dashboard/lib/agents/`:

```
types.ts        — Task, AgentRun, AgentMessage, Feedback, Goal, AgentConfig
store.ts        — alle DB-toegang (better-sqlite3, zelfde patroon als db.ts)
runtime.ts      — recordRun(), postMessage(), getAgentConfig(), runToolLoop()
scout.ts        — handelt discover/qualify-taken
builder.ts      — handelt build_site-taken (+ vision-kritiek)
writer.ts       — handelt write_email-taken (→ approval pending)
manager.ts      — LLM tool-use loop: plant, beoordeelt, stelt bij
orchestrator.ts — tick(), downstream-enqueue, manager-scheduling, mail-sender
seed.ts         — default agent_config + eerste goal
```

---

## 7. Dashboard — "Agent Swarm" (Team HQ)

Nieuwe pagina `/team` — een donker, agent-gericht ops-dashboard (los van de
lichte cockpit/leads/sites/settings):

- **Swarm-activiteit** — SVG-area-grafiek van uitgevoerde agent-taken, met
  bereik-toggle 24u / Week / Maand (`agent_runs.finished_at` in buckets).
- **Tokenkosten** — totaal in USD + tokens, uitgesplitst per model. Berekend uit
  `agent_runs.input_tokens/output_tokens` × modelprijs (`lib/agents/pricing.ts`).
- **Snelacties** — nieuw doel, naar goedkeur-wachtrij, mini-stats.
- **Agents** — per agent: status, voltooide taken, succesratio, tokens, kosten,
  doorvoer-balk (taken/uur), laatste resultaat.
- **Recente taken** — tabel (agent · resultaat · tokens · kosten · status).
- **Doelen** — voortgangsbalken + "nieuw doel".
- **Goedkeur-wachtrij** — klaargezette mails met preview + Goedkeuren/Afwijzen.
- **Team-chat** — live `agent_messages`-stream.
- **Wat het team leerde** — `feedback` van kind=manager_insight.

Kosten/tokens: elke agent-run logt input/output-tokens; de Manager (Sonnet) is
de grootste kostenpost en wordt volledig geteld. De goedkope Haiku-helpers
(foto-curator/personalizer/reviewer) worden deels geteld — kosten zijn dus een
ondergrens, geen exacte factuur.

Modelprijzen (USD/1M tokens): Opus 4.8 $5/$25 · Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5.

API-routes: `/api/team?range=` (agents+runs+kosten+activiteit), `/api/approvals`
(GET/POST), `/api/goals` (GET/POST).

---

## 8. Cloud-deploy (24/7)

1. **Box**: Railway/Fly.io/VPS met persistent volume voor `leads.db`.
2. **Processen**: `npm run start` (Next.js dashboard) + `npm run worker`
   (agent-runtime) — bv. via een procesmanager (pm2) of twee services.
3. **Env**: `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `DB_PATH`,
   `VERCEL_TOKEN` (voor domains), SMTP via `settings.json`.
4. **Python**: `python3` + deps voor discovery/qualify/enrich op de box.
5. **Git push** voor sites blijft werken (worker commit + push → Vercel build).

Alternatief (simpeler): dashboard op Vercel, alleen de worker op de box.

---

## 9. Bouwfasen

- **Fase 0** — DB-tabellen + `store.ts` + `types.ts` + seed.
- **Fase 1** — runtime + Manager + Scout.
- **Fase 2** — Builder (vision-kritiek).
- **Fase 3** — Writer + goedkeur-poort.
- **Fase 4** — orchestrator + worker + Team HQ dashboard + leerlus.
- **Fase 5** (later) — volledige autonomie-schakelaar, reply-afhandeling.

De oude `runAgentCycle` blijft voorlopig bestaan als fallback; de nieuwe runtime
draait ernaast tot het team stabiel is.

---

## 10. Quickstart

**Lokaal uitproberen** (vanuit `dashboard/`):

```bash
npm install
npm run dev          # dashboard op http://localhost:3000 → tab "Team HQ"
# in een 2e terminal:
npm run worker       # de agent-runtime (Manager + Scout + Builder + Writer)
# of één losse ronde zonder lus:
npm run worker:once
```

De DB-migratie (nieuwe tabellen/kolommen) draait automatisch bij de eerste
worker- of dashboard-call. De seed maakt 4 agent-configs + 1 startdoel aan.

**Cloud 24/7** (Railway / Fly.io / VPS met persistent volume voor `leads.db`):

```bash
npm ci && npm run build
npx pm2 start ecosystem.config.cjs   # start dashboard + agent-worker
npx pm2 save                         # overleeft reboots
```

Zorg dat op de box staan: `node`, `python3` (+ deps voor discovery/qualify/
enrich) en een `.env` met `ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `DB_PATH`,
`VERCEL_TOKEN`. SMTP staat in `settings.json`.

**Goedkeur-poort:** de Writer zet mails op `approval_status='pending'`. Niets
gaat de deur uit tot je in **Team HQ → Goedkeur-wachtrij** op *Keur goed* drukt.
Pas daarna verstuurt de worker ze (na deploy van site + screenshot), met respect
voor `config/sending_schedule.yml`.

**Smoke-test** (migratie + seed, geen scrape/LLM): `npx tsx --env-file=.env scripts/agent-smoke.mjs`
