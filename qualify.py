"""
Qualification engine — scoort leads uit leads.db op twee criteria:

1. GBP-kwaliteit (uit bestaande data in DB)
2. Slechte-website-score (live website-bezoek)

Een lead "qualifies" wanneer beide criteria de drempel halen.

Gebruik:
    python3 qualify.py                # qualify alle nog-niet-gechecked leads
    python3 qualify.py --limit 10     # alleen eerste 10 (voor testen)
    python3 qualify.py --dry-run      # check alles, schrijf niets naar DB
    python3 qualify.py --reset        # reset alle qualification velden
    python3 qualify.py --show         # toon top qualified leads, geen check
"""
import os
import re
import sys
import sqlite3
import logging
import argparse
import warnings
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import requests
import urllib3
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Setup
load_dotenv()
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings("ignore")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s · %(levelname)-7s · %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("qualify")


# ===== Configuratie =====

DB_PATH = Path(os.getenv("DB_PATH", "leads.db"))

# Types waarvoor we geen offerte willen sturen (winkels, groothandel, niet-aannemers)
SKIP_TYPES = {
    "building_materials_store",
    "hardware_store",
    "home_improvement_store",
    "furniture_store",
    "store",
    "wholesaler",
    "supermarket",
    "car_repair",
}

# Social/listing platforms die we niet als "echte" website beschouwen
SOCIAL_OR_LISTING_DOMAINS = {
    "facebook.com", "www.facebook.com", "m.facebook.com",
    "instagram.com", "www.instagram.com",
    "linkedin.com", "www.linkedin.com",
    "twitter.com", "x.com",
    "youtube.com", "www.youtube.com",
    "tiktok.com", "www.tiktok.com",
    "pinterest.com", "www.pinterest.com",
    "pkt.pl", "www.pkt.pl",
    "panoramafirm.pl", "www.panoramafirm.pl",
    "aleo.com", "www.aleo.com",
    "oferia.pl", "www.oferia.pl",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/16.6 Safari/605.1.15"
)

# Drempels
GBP_PASS_THRESHOLD = 5     # uit 7 criteria
BAD_SITE_THRESHOLD = 3     # minimaal 3 "slecht" signalen

CURRENT_YEAR = datetime.now().year


# ===== GBP Scoring =====

def score_gbp(lead: dict) -> tuple[int, list[str]]:
    """Scoor GBP-kwaliteit. Returns (score 0-7, reden-regels)."""
    score = 0
    reasons = []

    rc = lead.get("rating_count") or 0
    if rc >= 10:
        score += 1
        reasons.append(f"  ✓ {rc} reviews")
    else:
        reasons.append(f"  ✗ slechts {rc} reviews")

    rt = lead.get("rating") or 0
    if rt >= 4.0:
        score += 1
        reasons.append(f"  ✓ rating {rt}")
    else:
        reasons.append(f"  ✗ rating {rt}")

    pc = lead.get("photo_count") or 0
    if pc >= 5:
        score += 1
        reasons.append(f"  ✓ {pc} foto's")
    else:
        reasons.append(f"  ✗ slechts {pc} foto's")

    if lead.get("phone_national"):
        score += 1
        reasons.append("  ✓ telefoon aanwezig")
    else:
        reasons.append("  ✗ geen telefoon")

    primary_type = (lead.get("primary_type") or "").lower()
    if primary_type and primary_type not in SKIP_TYPES:
        score += 1
        reasons.append(f"  ✓ type: {primary_type}")
    else:
        reasons.append(f"  ✗ winkel/onbruikbaar type: {primary_type}")

    website = lead.get("website")
    if website:
        domain = urlparse(website).netloc.lower()
        if domain and domain not in SOCIAL_OR_LISTING_DOMAINS:
            score += 1
            reasons.append(f"  ✓ eigen domein: {domain}")
        else:
            reasons.append(f"  ✗ social/listing URL: {domain}")
    else:
        reasons.append("  ✗ geen website")

    if lead.get("business_status") == "OPERATIONAL":
        score += 1
        reasons.append("  ✓ operational")
    else:
        reasons.append(f"  ✗ status: {lead.get('business_status')}")

    return score, reasons


# ===== Website Scoring =====

def fetch_website(url: str, timeout: int = 15):
    """Fetch site. Returns (response, error_message_or_None)."""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "pl,en;q=0.5",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        r = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        return r, None
    except requests.exceptions.SSLError as e:
        # Probeer alsnog zonder SSL-verificatie
        try:
            r = requests.get(url, headers=headers, timeout=timeout,
                             allow_redirects=True, verify=False)
            return r, f"ssl-error (fetched anyway)"
        except Exception as e2:
            return None, f"ssl-error en fallback faalde: {str(e2)[:80]}"
    except requests.exceptions.Timeout:
        return None, "timeout"
    except requests.exceptions.ConnectionError as e:
        return None, f"connection error: {str(e)[:80]}"
    except Exception as e:
        return None, f"onbekende fout: {str(e)[:80]}"


def score_website(url: str) -> tuple[int, list[str], dict]:
    """
    Scoor hoe 'slecht' een website is. Hogere score = slechter = meer behoefte aan nieuwe site.
    Returns (bad_score, reasons, info_dict).
    """
    bad_score = 0
    reasons = []
    info = {}

    response, error = fetch_website(url)
    if not response:
        # Site onbereikbaar — sterk signaal, maar we kunnen er ook niet doorop scrapen
        return 99, [f"  ⚠ onbereikbaar: {error}"], {"reachable": False}

    info["reachable"] = True
    info["final_url"] = response.url
    info["status_code"] = response.status_code

    # 1. HTTPS
    if not response.url.startswith("https://"):
        bad_score += 1
        reasons.append("  ✗ geen HTTPS")
    else:
        reasons.append("  ✓ HTTPS")

    # 2. SSL probleem
    if error and "ssl" in error.lower():
        bad_score += 1
        reasons.append("  ✗ SSL-certificaat-probleem")

    # 3. Status code
    if response.status_code != 200:
        bad_score += 1
        reasons.append(f"  ✗ HTTP status {response.status_code}")

    # 4. Pagina-grootte
    size_bytes = len(response.content)
    info["page_size_kb"] = size_bytes // 1024
    if size_bytes > 5 * 1024 * 1024:
        bad_score += 1
        reasons.append(f"  ✗ erg groot ({size_bytes//1024}KB)")
    elif size_bytes < 3 * 1024:
        bad_score += 1
        reasons.append(f"  ✗ verdacht klein ({size_bytes//1024}KB) — placeholder?")

    # Parse HTML
    try:
        soup = BeautifulSoup(response.text, "html.parser")
    except Exception as e:
        return bad_score + 2, reasons + [f"  ✗ HTML niet parsebaar"], info

    # 5. Viewport meta (mobiel-responsief signaal) — zwaarder gewogen
    viewport = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.I)})
    if not viewport:
        bad_score += 2
        reasons.append("  ✗ geen viewport meta tag (niet mobiel)")
    else:
        reasons.append("  ✓ viewport meta")

    # 6. Doctype
    raw_start = response.text[:200].lower().strip()
    if not raw_start.startswith("<!doctype html>"):
        bad_score += 1
        reasons.append("  ✗ geen modern <!doctype html>")

    # 7. Open Graph tags
    og_tags = soup.find_all("meta", attrs={"property": re.compile(r"^og:", re.I)})
    if not og_tags:
        bad_score += 1
        reasons.append("  ✗ geen Open Graph tags")

    # 8. Schema.org
    has_jsonld = bool(soup.find("script", attrs={"type": "application/ld+json"}))
    has_microdata = bool(soup.find(attrs={"itemtype": re.compile(r"schema\.org", re.I)}))
    if not (has_jsonld or has_microdata):
        bad_score += 1
        reasons.append("  ✗ geen Schema.org markup")

    # 9. Copyright-jaartal
    page_text = soup.get_text(" ", strip=True)
    cr_matches = re.findall(r"(?:©|&copy;|copyright)\s*\.?\s*(\d{4})", page_text, re.I)
    valid_years = [int(y) for y in cr_matches if 2000 <= int(y) <= CURRENT_YEAR + 1]
    if valid_years:
        latest = max(valid_years)
        info["copyright_year"] = latest
        if latest <= CURRENT_YEAR - 3:
            bad_score += 1
            reasons.append(f"  ✗ copyright {latest} (≥3 jr oud)")
        else:
            reasons.append(f"  • copyright {latest}")

    # 10. Last-Modified header
    lm = response.headers.get("Last-Modified")
    if lm:
        try:
            lm_dt = parsedate_to_datetime(lm)
            age_days = (datetime.now(timezone.utc) - lm_dt).days
            info["last_modified_days"] = age_days
            if age_days > 365 * 2:
                bad_score += 1
                reasons.append(f"  ✗ Last-Modified {age_days}d oud")
        except Exception:
            pass

    # 11. Deprecated tags (sterk signaal van oude site)
    if soup.find("table", attrs={"border": True}) or soup.find("font"):
        bad_score += 2
        reasons.append("  ✗ deprecated tags (table layout / <font>)")

    # 12. Generator meta
    gen = soup.find("meta", attrs={"name": re.compile(r"^generator$", re.I)})
    if gen:
        gen_content = gen.get("content", "")
        info["generator"] = gen_content[:60]
        # Oude WordPress versies
        wp = re.match(r"WordPress\s+(\d+)\.(\d+)", gen_content)
        if wp and int(wp.group(1)) < 6:
            bad_score += 1
            reasons.append(f"  ✗ oude {gen_content[:40]}")

    # 13. jQuery versie
    for s in soup.find_all("script", src=True):
        src = s.get("src", "")
        jq = re.search(r"jquery[/-](\d+)\.(\d+)", src, re.I)
        if jq:
            if int(jq.group(1)) < 3:
                bad_score += 1
                reasons.append(f"  ✗ oude jQuery {jq.group(1)}.{jq.group(2)}")
            break

    return bad_score, reasons, info


# ===== Main loop =====

def get_unqualified(conn) -> list[dict]:
    cur = conn.cursor()
    cur.execute("""
        SELECT * FROM leads
        WHERE qualified IS NULL
        ORDER BY COALESCE(rating_count, 0) DESC
    """)
    return [dict(row) for row in cur.fetchall()]


def update_qualification(conn, place_id, qualified, gbp_score, bad_site_score):
    conn.execute("""
        UPDATE leads
        SET qualified = ?, good_gbp_score = ?, bad_site_score = ?, qualified_at = ?
        WHERE place_id = ?
    """, (
        qualified, gbp_score, bad_site_score,
        datetime.utcnow().isoformat() + "Z",
        place_id,
    ))
    conn.commit()


def show_qualified(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT name, website, phone_national, rating_count, rating, photo_count,
               good_gbp_score, bad_site_score, city_query
        FROM leads
        WHERE qualified = 1
        ORDER BY bad_site_score DESC, rating_count DESC
    """)
    rows = cur.fetchall()
    conn.close()

    if not rows:
        log.info("Nog geen qualified leads in de database.")
        return

    log.info("─" * 80)
    log.info(f"QUALIFIED LEADS ({len(rows)})")
    log.info("─" * 80)
    for r in rows:
        log.info(
            f"  {r['name'][:40]:<40}  "
            f"GBP:{r['good_gbp_score']}/7  Slecht:{r['bad_site_score']:>2}  "
            f"{r['rating_count']}rev  {r['website']}"
        )
    log.info("─" * 80)


def qualify_all(db_path: Path, limit: int = None, dry_run: bool = False):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    leads = get_unqualified(conn)
    if limit:
        leads = leads[:limit]

    if not leads:
        log.info("Geen leads om te qualificeren (alle zijn al verwerkt).")
        log.info("Gebruik --reset om opnieuw te beginnen, of --show om resultaten te zien.")
        return

    log.info(f"Start qualification van {len(leads)} leads "
             f"({'dry-run' if dry_run else 'live'})...")
    log.info("=" * 70)

    qualified = 0
    rejected_gbp = 0
    rejected_site_unreachable = 0
    rejected_site_modern = 0

    for i, lead in enumerate(leads, 1):
        name = lead["name"][:50]
        log.info(f"\n[{i}/{len(leads)}] {name}")

        # GBP score
        gbp_score, gbp_reasons = score_gbp(lead)
        log.info(f"  GBP-score: {gbp_score}/7")
        for r in gbp_reasons:
            log.info(r)

        if gbp_score < GBP_PASS_THRESHOLD:
            log.info(f"  ❌ AFGEWEZEN — GBP te zwak ({gbp_score}/{GBP_PASS_THRESHOLD})")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 0, gbp_score, None)
            rejected_gbp += 1
            continue

        # GBP OK, nu de site
        if not lead.get("website"):
            log.info(f"  ❌ AFGEWEZEN — geen website")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 0, gbp_score, None)
            rejected_gbp += 1
            continue

        domain = urlparse(lead["website"]).netloc.lower()
        if domain in SOCIAL_OR_LISTING_DOMAINS:
            log.info(f"  ❌ AFGEWEZEN — social/listing URL")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 0, gbp_score, None)
            rejected_gbp += 1
            continue

        log.info(f"  → check site: {lead['website']}")
        bad_score, site_reasons, info = score_website(lead["website"])
        log.info(f"  Slechte-site-score: {bad_score}")
        for r in site_reasons[:8]:
            log.info(r)

        # Beslissing
        if not info.get("reachable"):
            log.info(f"  ❌ AFGEWEZEN — site onbereikbaar")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 0, gbp_score, bad_score)
            rejected_site_unreachable += 1
            continue

        if bad_score >= BAD_SITE_THRESHOLD:
            log.info(f"  ✅ QUALIFIED — GBP:{gbp_score}/7  Slecht:{bad_score}")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 1, gbp_score, bad_score)
            qualified += 1
        else:
            log.info(f"  ❌ AFGEWEZEN — site te modern ({bad_score}/{BAD_SITE_THRESHOLD})")
            if not dry_run:
                update_qualification(conn, lead["place_id"], 0, gbp_score, bad_score)
            rejected_site_modern += 1

    # Samenvatting
    total = len(leads)
    log.info("\n" + "=" * 70)
    log.info(f"VERWERKT: {total} leads")
    log.info(f"  ✅ Qualified                  : {qualified} ({100*qualified/total:.0f}%)")
    log.info(f"  ❌ Afgewezen — GBP/winkel    : {rejected_gbp}")
    log.info(f"  ❌ Afgewezen — site onbereik : {rejected_site_unreachable}")
    log.info(f"  ❌ Afgewezen — site te modern: {rejected_site_modern}")
    log.info("=" * 70)

    conn.close()

    # Toon de qualified leads
    if not dry_run and qualified > 0:
        show_qualified(db_path)


def main():
    parser = argparse.ArgumentParser(description="Qualification engine")
    parser.add_argument("--db", default=str(DB_PATH), help="Pad naar leads.db")
    parser.add_argument("--limit", type=int, help="Max N leads (voor testen)")
    parser.add_argument("--dry-run", action="store_true", help="Test zonder DB-updates")
    parser.add_argument("--reset", action="store_true", help="Reset alle qualification-velden")
    parser.add_argument("--show", action="store_true", help="Toon huidige qualified leads")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        log.error(f"Database niet gevonden: {db_path}. Draai eerst discovery.py.")
        sys.exit(1)

    if args.reset:
        conn = sqlite3.connect(db_path)
        n = conn.execute(
            "UPDATE leads SET qualified=NULL, good_gbp_score=NULL, "
            "bad_site_score=NULL, qualified_at=NULL"
        ).rowcount
        conn.commit()
        conn.close()
        log.info(f"Gereset: {n} leads. Draai opnieuw zonder --reset om te qualificeren.")
        return

    if args.show:
        show_qualified(db_path)
        return

    qualify_all(db_path, limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
