"""
Enrichment module — haalt Google Places reviews, editorial summary en foto-URLs op
voor leads die al in de database staan.

Gebruik:
    python3 enrich.py                  # enrich alle leads zonder reviews
    python3 enrich.py --limit 5        # alleen eerste 5 (voor testen)
    python3 enrich.py --force           # enrich ook leads die al verrijkt zijn

Output:
    - Updated leads.db met reviews_json, description, photo_urls kolommen
"""
import os
import sys
import json
import sqlite3
import logging
import argparse
import random
import time
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv


load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s · %(levelname)-7s · %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("enrich")


API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
DB_PATH = Path(os.getenv("DB_PATH", "leads.db"))
PLACES_API_BASE = "https://places.googleapis.com/v1"

# Photo-URLs worden via een dashboard-proxy geserveerd zodat de API-key niet
# in gegenereerde sites of mails terechtkomt. enrich.py schrijft alleen
# relatieve paden naar de DB; de dashboard / mailer prefixen waar nodig
# met de absolute host (bijv. https://app.stronadlatwojejfirmy.com.pl).
DETAIL_FIELD_MASK = ",".join([
    "reviews",
    "editorialSummary",
])

PHOTO_MAX_WIDTH = 1200
MAX_REVIEWS = 5            # E7: Places API levert max 5 reviews per call
MAX_RETRIES = 3            # E4: aantal pogingen voor transient errors
RETRY_BACKOFF_BASE = 1.0   # E4: exp backoff start in seconden
INTER_LEAD_SLEEP_MIN = 0.2 # E5: jitter ondergrens tussen leads
INTER_LEAD_SLEEP_MAX = 0.5
BATCH_COMMIT_EVERY = 25    # E8: commit per N leads ipv per lead


def ensure_columns(conn):
    """Add enrichment columns if they don't exist."""
    cur = conn.cursor()
    columns = [row[1] for row in cur.execute("PRAGMA table_info(leads)").fetchall()]

    migrations = {
        "reviews_json": "ALTER TABLE leads ADD COLUMN reviews_json TEXT DEFAULT NULL",
        "description": "ALTER TABLE leads ADD COLUMN description TEXT DEFAULT NULL",
        "photo_urls": "ALTER TABLE leads ADD COLUMN photo_urls TEXT DEFAULT NULL",
        "enriched_at": "ALTER TABLE leads ADD COLUMN enriched_at TEXT DEFAULT NULL",
        "photo_refs": "ALTER TABLE leads ADD COLUMN photo_refs TEXT DEFAULT NULL",
        # Diagnostic columns: track failed enrichment attempts so they get retried
        "enrich_failed_at": "ALTER TABLE leads ADD COLUMN enrich_failed_at TEXT DEFAULT NULL",
        "enrich_failed_count": "ALTER TABLE leads ADD COLUMN enrich_failed_count INTEGER DEFAULT 0",
    }
    for col, sql in migrations.items():
        if col not in columns:
            cur.execute(sql)
            log.info(f"Kolom '{col}' toegevoegd aan leads-tabel")

    conn.commit()


def get_unenriched_leads(conn, force=False, qualified_only=False):
    """Get leads to enrich. force=True includes already-enriched leads.

    E6: permanent-closed leads worden uitgesloten — detail-calls zouden alleen
    credits kosten omdat qualify ze toch hard-rejecten zou.
    """
    where_parts = ["(business_status IS NULL OR business_status != 'CLOSED_PERMANENTLY')"]
    if not force:
        where_parts.append("enriched_at IS NULL")
    if qualified_only:
        where_parts.append("qualified = 1")
    where = "WHERE " + " AND ".join(where_parts)
    return [dict(row) for row in conn.execute(
        f"SELECT * FROM leads {where} ORDER BY COALESCE(rating_count, 0) DESC"
    ).fetchall()]


def fetch_place_details(place_id: str) -> Optional[dict]:
    """Fetch reviews and editorial summary from Places API (Polish locale).
    Returns None on failure so the caller can distinguish 'really empty' from 'request failed'.

    E4/E5: retries op transient errors (network, 5xx, 429) met exp backoff
    + jitter. 429 respecteert Retry-After header indien aanwezig.
    """
    url = f"{PLACES_API_BASE}/places/{place_id}?languageCode=pl&regionCode=PL"
    headers = {
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": DETAIL_FIELD_MASK,
    }
    for attempt in range(MAX_RETRIES):
        last_attempt = attempt == MAX_RETRIES - 1
        try:
            r = requests.get(url, headers=headers, timeout=15)
        except requests.exceptions.RequestException as e:
            if last_attempt:
                log.error(f"Netwerkfout voor {place_id} (na {MAX_RETRIES} pogingen): {str(e)[:200]}")
                return None
            time.sleep(RETRY_BACKOFF_BASE * (2 ** attempt) + random.random() * 0.5)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            if last_attempt:
                log.error(f"API fout {r.status_code} voor {place_id} (na {MAX_RETRIES} pogingen)")
                return None
            wait = RETRY_BACKOFF_BASE * (2 ** attempt) + random.random() * 0.5
            if r.status_code == 429:
                retry_after = r.headers.get("Retry-After")
                if retry_after:
                    try:
                        wait = max(wait, float(retry_after))
                    except ValueError:
                        pass
            time.sleep(wait)
            continue
        # Niet-retryable: 4xx (behalve 429) — direct stoppen
        log.error(f"API fout {r.status_code} voor {place_id}: {r.text[:200]}")
        return None
    return None


def build_photo_url(photo_ref: str, max_width: int = PHOTO_MAX_WIDTH) -> str:
    """Build the *proxy* photo URL for the dashboard.

    We intentionally do NOT include the API key here: the dashboard's
    /api/photo route fetches the upstream image server-side and adds the
    key in a header. enrich.py only stores the proxy path; the email-
    template prefixes it with the dashboard host when sending mail.
    """
    from urllib.parse import quote
    return f"/api/photo?ref={quote(photo_ref, safe='')}&w={max_width}"


def enrich_lead(conn, lead: dict):
    """Enrich a single lead with reviews, description, and photo URLs.
    Returns (n_reviews, n_photos). On API failure: marks the lead as failed
    (without setting enriched_at) so it will be retried on a future run.

    NB: deze functie commit niet langer per lead (E8) — de caller doet dat
    in batches (BATCH_COMMIT_EVERY).
    """
    place_id = lead["place_id"]
    name = lead["name"][:50]

    details = fetch_place_details(place_id)
    if details is None:
        conn.execute("""
            UPDATE leads SET
                enrich_failed_at = datetime('now'),
                enrich_failed_count = COALESCE(enrich_failed_count, 0) + 1
            WHERE place_id = ?
        """, (place_id,))
        log.warning(f"  ⏭ {name}: skip — API faalde, wordt later opnieuw geprobeerd")
        return 0, 0

    reviews_raw = details.get("reviews", [])
    reviews = []
    for rev in reviews_raw[:MAX_REVIEWS]:
        text_obj = rev.get("text") if isinstance(rev.get("text"), dict) else {}
        original_obj = rev.get("originalText") if isinstance(rev.get("originalText"), dict) else {}
        reviews.append({
            "author": rev.get("authorAttribution", {}).get("displayName", "Klient"),
            "rating": rev.get("rating"),  # E3: None ipv 5 als default — voorkomt misleidende defaults
            "text": text_obj.get("text", "") or (rev.get("text") or ""),
            "language": text_obj.get("languageCode", ""),
            "original_text": original_obj.get("text", ""),
            "original_language": original_obj.get("languageCode", ""),
            "time": rev.get("relativePublishTimeDescription", ""),
            "photo": rev.get("authorAttribution", {}).get("photoUri", ""),
        })

    editorial = details.get("editorialSummary", {})
    description = editorial.get("text", "") if isinstance(editorial, dict) else ""

    photo_refs_raw = lead.get("photo_refs")
    photo_refs = []
    if photo_refs_raw:
        try:
            photo_refs = json.loads(photo_refs_raw) if isinstance(photo_refs_raw, str) else photo_refs_raw
        except (json.JSONDecodeError, TypeError):
            pass

    photo_urls = [build_photo_url(ref) for ref in photo_refs[:10]]

    conn.execute("""
        UPDATE leads SET
            reviews_json = ?,
            description = ?,
            photo_urls = ?,
            enriched_at = datetime('now')
        WHERE place_id = ?
    """, (
        json.dumps(reviews, ensure_ascii=False) if reviews else None,
        description or None,
        json.dumps(photo_urls) if photo_urls else None,
        place_id,
    ))

    log.info(f"  ✓ {name}: {len(reviews)} reviews, {len(photo_urls)} foto's"
             + (f", beschrijving" if description else ""))

    return len(reviews), len(photo_urls)


def main():
    parser = argparse.ArgumentParser(description="Enrich leads met reviews en foto's")
    parser.add_argument("--db", default=str(DB_PATH), help="Pad naar leads.db")
    parser.add_argument("--limit", type=int, help="Max N leads")
    parser.add_argument("--force", action="store_true", help="Herverrijk ook al verrijkte leads")
    parser.add_argument("--qualified", action="store_true", help="Alleen qualified leads")
    args = parser.parse_args()

    if not API_KEY:
        log.error("GOOGLE_MAPS_API_KEY ontbreekt in .env")
        sys.exit(1)

    db_path = Path(args.db)
    if not db_path.exists():
        log.error(f"Database niet gevonden: {db_path}")
        sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    ensure_columns(conn)

    leads = get_unenriched_leads(conn, force=args.force, qualified_only=args.qualified)
    if args.limit:
        leads = leads[:args.limit]

    if not leads:
        log.info("Geen leads om te verrijken.")
        conn.close()
        return

    log.info(f"Verrijken van {len(leads)} leads...")
    log.info("=" * 60)

    total_reviews = 0
    total_photos = 0

    for i, lead in enumerate(leads, 1):
        log.info(f"[{i}/{len(leads)}] {lead['name'][:50]}")
        try:
            n_reviews, n_photos = enrich_lead(conn, lead)
            total_reviews += n_reviews
            total_photos += n_photos
        except Exception as e:
            log.error(f"  ✗ Fout: {str(e)[:100]}")

        # E8: batch commit ipv per lead
        if i % BATCH_COMMIT_EVERY == 0:
            conn.commit()

        # E5: jitter ipv vaste sleep — verkleint piek-burst kans op 429
        if i < len(leads):
            time.sleep(random.uniform(INTER_LEAD_SLEEP_MIN, INTER_LEAD_SLEEP_MAX))

    conn.commit()  # finale commit voor de laatste batch

    log.info("=" * 60)
    log.info(f"Klaar: {len(leads)} leads verrijkt")
    log.info(f"  Reviews opgehaald : {total_reviews}")
    log.info(f"  Foto-URLs gebouwd : {total_photos}")
    log.info("=" * 60)

    conn.close()


if __name__ == "__main__":
    main()
