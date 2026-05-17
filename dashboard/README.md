# Dashboard — Strona dla Twojej Firmy

Lokaal Next.js dashboard voor het beheren van lead-generatie voor Poolse aannemers/installateurs.

## Setup

### 1. Dependencies installeren

```bash
cd dashboard
npm install
```

### 2. Environment configureren

Maak `.env.local` aan (als die nog niet bestaat):

```
DB_PATH=../leads.db
PYTHON_BIN=python3
DISCOVERY_SCRIPT=../discovery.py
QUALIFY_SCRIPT=../qualify.py
```

De paden zijn relatief ten opzichte van de `dashboard/` map.

### 3. Starten

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Hoe het werkt

- **Database**: Het dashboard leest direct uit `leads.db` via `better-sqlite3` (geen ORM).
- **Discovery/Qualification**: Het dashboard spawnt de bestaande Python scripts (`discovery.py`, `qualify.py`) via `child_process.spawn` en streamt hun output live via Server-Sent Events naar de browser.
- **Geen authenticatie**: Draait alleen lokaal.

## Pagina's

| Route | Functie |
|---|---|
| `/` | Overzicht: stat-cards, leads per stad, qualified per categorie |
| `/leads` | Lead-tabel met filters, sortering, paginatie, en detail-sheet |
| `/discovery` | Start nieuwe discovery runs per stad/categorie |
| `/qualification` | Qualify pending leads of reset qualifications |

## Tech stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4
- shadcn/ui
- better-sqlite3
- Lucide React
