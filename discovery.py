"""
Discovery module — vindt Poolse aannemers/installateurs via Google Maps Places API (New).

Gebruik:
    python discovery.py --city krakow
    python discovery.py --city warszawa --categories general_contractor roofing_contractor
    python discovery.py --city krakow --radius 30000 --limit 50

Output:
    - SQLite database (leads.db) met alle gevonden bedrijven
    - CSV bestand (leads-{city}-{timestamp}.csv) ter inspectie
    - Console-overzicht
"""
import os
import sys
import csv
import json
import math
import sqlite3
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone
from dataclasses import dataclass, asdict, field
from typing import Optional

import requests
from dotenv import load_dotenv


# ===== Setup =====
load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s · %(levelname)-7s · %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("discovery")


# ===== Configuratie =====

API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
DB_PATH = Path(os.getenv("DB_PATH", "leads.db"))
PLACES_API_BASE = "https://places.googleapis.com/v1"

# Veld-mask: alleen wat we daadwerkelijk nodig hebben (bespaart API-kosten)
FIELD_MASK = ",".join([
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.websiteUri",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.rating",
    "places.userRatingCount",
    "places.types",
    "places.primaryType",
    "places.businessStatus",
    "places.regularOpeningHours",
    "places.location",
    "places.photos",
])

# Poolse steden — coords van het stadscentrum
CITIES = {
    "krakow":     {"lat": 50.0647, "lng": 19.9450, "name": "Kraków",     "voivodeship": "Małopolskie"},
    "warszawa":   {"lat": 52.2297, "lng": 21.0122, "name": "Warszawa",   "voivodeship": "Mazowieckie"},
    "wroclaw":    {"lat": 51.1079, "lng": 17.0385, "name": "Wrocław",    "voivodeship": "Dolnośląskie"},
    "poznan":     {"lat": 52.4064, "lng": 16.9252, "name": "Poznań",     "voivodeship": "Wielkopolskie"},
    "gdansk":     {"lat": 54.3520, "lng": 18.6466, "name": "Gdańsk",     "voivodeship": "Pomorskie"},
    "lodz":       {"lat": 51.7592, "lng": 19.4560, "name": "Łódź",       "voivodeship": "Łódzkie"},
    "katowice":   {"lat": 50.2649, "lng": 19.0238, "name": "Katowice",   "voivodeship": "Śląskie"},
    "lublin":     {"lat": 51.2465, "lng": 22.5684, "name": "Lublin",     "voivodeship": "Lubelskie"},
    "bydgoszcz":  {"lat": 53.1235, "lng": 18.0084, "name": "Bydgoszcz",  "voivodeship": "Kujawsko-pomorskie"},
    "szczecin":   {"lat": 53.4285, "lng": 14.5528, "name": "Szczecin",   "voivodeship": "Zachodniopomorskie"},
    "wieliczka":  {"lat": 49.9870, "lng": 20.0644, "name": "Wieliczka",  "voivodeship": "Małopolskie"},
    "niepolomice":{"lat": 50.0289, "lng": 20.2218, "name": "Niepołomice","voivodeship": "Małopolskie"},
}

# Bouw-gerelateerde categorieën — gebruikt door Google Places (Nieuwe) API
# Bron: https://developers.google.com/maps/documentation/places/web-service/place-types
CATEGORIES_BOUW = [
    "general_contractor",
    "roofing_contractor",
    "electrician",
    "plumber",
    "painter",
]


# ===== Datamodel =====

@dataclass
class RawLead:
    """Een 'rauwe' lead direct uit de Places API — voor qualification."""
    place_id: str
    name: str
    address: Optional[str] = None
    website: Optional[str] = None
    phone_national: Optional[str] = None
    phone_intl: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None
    primary_type: Optional[str] = None
    types: list = field(default_factory=list)
    business_status: Optional[str] = None
    photo_count: int = 0
    photo_refs: list = field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    city_query: str = ""
    voivodeship: str = ""
    category_query: str = ""
    discovered_at: str = ""


# ===== Google Maps Places API client =====

class PlacesAPI:
    def __init__(self, api_key: str):
        if not api_key:
            raise RuntimeError(
                "GOOGLE_MAPS_API_KEY ontbreekt. Zet hem in .env (zie .env.example)."
            )
        self.api_key = api_key

    def search_nearby(
        self,
        lat: float,
        lng: float,
        radius_m: int,
        included_types: list[str],
        max_results: int = 20,
    ) -> list[dict]:
        """Search Nearby — vindt plekken binnen een straal."""
        url = f"{PLACES_API_BASE}/places:searchNearby"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": self.api_key,
            "X-Goog-FieldMask": FIELD_MASK,
        }
        body = {
            "includedTypes": included_types,
            "maxResultCount": min(max_results, 20),  # API limiet is 20
            "locationRestriction": {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": float(radius_m),
                }
            },
            "languageCode": "pl",
            "regionCode": "PL",
        }
        log.debug(f"POST {url} included_types={included_types} radius={radius_m}")
        r = requests.post(url, headers=headers, json=body, timeout=20)
        if r.status_code != 200:
            log.error(f"API fout {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
        data = r.json()
        return data.get("places", [])


# ===== Parsing =====

def parse_place(raw: dict, city_key: str, category: str) -> RawLead:
    """Converteer een Places API resultaat naar een RawLead."""
    city_info = CITIES.get(city_key, {})
    loc = raw.get("location", {})
    return RawLead(
        place_id=raw.get("id", ""),
        name=raw.get("displayName", {}).get("text", "")
            if isinstance(raw.get("displayName"), dict)
            else (raw.get("displayName") or ""),
        address=raw.get("formattedAddress"),
        website=raw.get("websiteUri"),
        phone_national=raw.get("nationalPhoneNumber"),
        phone_intl=raw.get("internationalPhoneNumber"),
        rating=raw.get("rating"),
        rating_count=raw.get("userRatingCount", 0) or 0,
        primary_type=raw.get("primaryType"),
        types=raw.get("types", []),
        business_status=raw.get("businessStatus"),
        photo_count=len(raw.get("photos", []) or []),
        photo_refs=[p.get("name", "") for p in (raw.get("photos", []) or []) if p.get("name")],
        latitude=loc.get("latitude"),
        longitude=loc.get("longitude"),
        city_query=city_info.get("name", city_key),
        voivodeship=city_info.get("voivodeship", ""),
        category_query=category,
        discovered_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )


# ===== Database =====

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
    place_id        TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    address         TEXT,
    website         TEXT,
    phone_national  TEXT,
    phone_intl      TEXT,
    rating          REAL,
    rating_count    INTEGER,
    primary_type    TEXT,
    types           TEXT,
    business_status TEXT,
    photo_count     INTEGER DEFAULT 0,
    photo_refs      TEXT,
    latitude        REAL,
    longitude       REAL,
    city_query      TEXT,
    voivodeship     TEXT,
    category_query  TEXT,
    discovered_at   TEXT,
    -- Velden die later toegevoegd worden door qualification
    qualified       INTEGER DEFAULT NULL,  -- NULL=nog niet bekeken, 0=afgewezen, 1=goedgekeurd
    bad_site_score  INTEGER DEFAULT NULL,
    good_gbp_score  INTEGER DEFAULT NULL,
    qualified_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_qualified ON leads(qualified);
CREATE INDEX IF NOT EXISTS idx_city ON leads(city_query);
"""


def init_db(db_path: Path):
    """Maak de database aan als hij nog niet bestaat."""
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def save_leads(leads: list[RawLead], db_path: Path) -> tuple[int, int]:
    """Sla leads op. Retourneert (nieuw_toegevoegd, al_bestaand).

    Volatiele velden (rating, photo_count, business_status, etc.) worden bij
    bestaande leads ververst zodat herhaalde discovery-runs de dataset
    actueel houden. Onveranderlijke velden blijven zoals ze waren.
    """
    if not leads:
        return 0, 0

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Welke place_ids bestaan al? Eén query ipv N.
    placeholders = ",".join(["?"] * len(leads))
    cur.execute(
        f"SELECT place_id FROM leads WHERE place_id IN ({placeholders})",
        [lead.place_id for lead in leads],
    )
    existing_ids = {row[0] for row in cur.fetchall()}

    rows = [
        (
            lead.place_id, lead.name, lead.address, lead.website,
            lead.phone_national, lead.phone_intl,
            lead.rating, lead.rating_count,
            lead.primary_type, json.dumps(lead.types), lead.business_status, lead.photo_count,
            json.dumps(lead.photo_refs) if lead.photo_refs else None,
            lead.latitude, lead.longitude,
            lead.city_query, lead.voivodeship, lead.category_query, lead.discovered_at,
        )
        for lead in leads
    ]

    cur.executemany(
        """
        INSERT INTO leads (
            place_id, name, address, website,
            phone_national, phone_intl,
            rating, rating_count,
            primary_type, types, business_status, photo_count, photo_refs,
            latitude, longitude,
            city_query, voivodeship, category_query, discovered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(place_id) DO UPDATE SET
            rating          = excluded.rating,
            rating_count    = excluded.rating_count,
            photo_count     = excluded.photo_count,
            photo_refs      = excluded.photo_refs,
            business_status = excluded.business_status,
            website         = COALESCE(excluded.website, website),
            phone_national  = COALESCE(excluded.phone_national, phone_national),
            phone_intl      = COALESCE(excluded.phone_intl, phone_intl)
        """,
        rows,
    )

    conn.commit()
    conn.close()
    added = sum(1 for lead in leads if lead.place_id not in existing_ids)
    existed = len(leads) - added
    return added, existed


# ===== CSV export =====

def export_csv(leads: list[RawLead], filepath: Path):
    """Exporteer leads naar CSV ter handmatige inspectie."""
    if not leads:
        return
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(leads[0]).keys()))
        writer.writeheader()
        for lead in leads:
            row = asdict(lead)
            row["types"] = ",".join(row["types"]) if row["types"] else ""
            writer.writerow(row)
    log.info(f"CSV opgeslagen: {filepath}")


# ===== Main flow =====

def discover_city(
    city_key: str,
    categories: list[str],
    radius_m: int,
    limit_per_category: int,
) -> list[RawLead]:
    """Voer discovery uit voor één stad over meerdere categorieën."""
    if city_key not in CITIES:
        log.error(f"Onbekende stad: {city_key}. Beschikbaar: {', '.join(CITIES.keys())}")
        return []

    city = CITIES[city_key]
    api = PlacesAPI(API_KEY)
    all_leads: list[RawLead] = []
    seen_place_ids = set()

    log.info(f"Discovery voor {city['name']} ({city['voivodeship']}), radius {radius_m/1000:.0f}km")

    for cat in categories:
        log.info(f"  → Categorie: {cat}")
        try:
            results = tiled_search_nearby(
                api=api,
                center_lat=city["lat"],
                center_lng=city["lng"],
                radius_m=radius_m,
                category=cat,
                limit_per_tile=limit_per_category,
            )
        except requests.HTTPError as e:
            log.error(f"     API faalt voor {cat}: {e}")
            continue

        parsed = [parse_place(r, city_key, cat) for r in results]

        # D9: filter permanent-closed leads vóór dedup/save — bespaart credits
        # en houdt de DB schoon (qualify zou ze toch hard-rejecten).
        before_closed = len(parsed)
        parsed = [p for p in parsed if p.business_status != "CLOSED_PERMANENTLY"]
        if before_closed != len(parsed):
            log.info(f"     {before_closed - len(parsed)} permanent gesloten leads gefilterd")

        # Dedup binnen deze city-run
        new_in_run = [p for p in parsed if p.place_id not in seen_place_ids]
        for p in new_in_run:
            seen_place_ids.add(p.place_id)

        all_leads.extend(new_in_run)
        log.info(f"     {len(parsed)} unieke resultaten over tiles, {len(new_in_run)} nieuw in deze run")

    return all_leads


# 9 tile-offsets: centrum + 4 cardinaal + 4 diagonaal — geeft 9 verschillende
# "top-20 dichtstbij" sets per categorie, ipv altijd dezelfde top-20 vanaf het stadscentrum.
TILE_OFFSETS = [
    (0, 0),
    (1, 0), (-1, 0), (0, 1), (0, -1),
    (1, 1), (1, -1), (-1, 1), (-1, -1),
]


def tiled_search_nearby(
    api: "PlacesAPI",
    center_lat: float,
    center_lng: float,
    radius_m: int,
    category: str,
    limit_per_tile: int,
) -> list[dict]:
    """Doe searchNearby vanuit meerdere offset-centra rond de stad. Google
    rankt op afstand vanaf het zoekpunt — een ander punt = andere top-N.
    Dedup over alle tiles, retourneer unieke union."""
    # 1° lat ≈ 111 320 m; 1° lng ≈ 111 320 × cos(lat) m
    meters_per_lat = 111_320.0
    meters_per_lng = 111_320.0 * math.cos(math.radians(center_lat))
    offset_m = radius_m * 0.5
    d_lat = offset_m / meters_per_lat
    d_lng = offset_m / meters_per_lng

    # Iets kleinere tile-radius dan origineel → minder overlap, snellere convergentie
    tile_radius = int(radius_m * 0.75)

    seen: set[str] = set()
    union: list[dict] = []

    for i, (kx, ky) in enumerate(TILE_OFFSETS):
        tile_lat = center_lat + kx * d_lat
        tile_lng = center_lng + ky * d_lng
        try:
            sub = api.search_nearby(
                lat=tile_lat,
                lng=tile_lng,
                radius_m=tile_radius,
                included_types=[category],
                max_results=limit_per_tile,
            )
        except requests.HTTPError as e:
            log.warning(f"     Tile {i+1}/{len(TILE_OFFSETS)} fout: {e}")
            continue

        new_in_tile = 0
        for r in sub:
            pid = r.get("id")
            if pid and pid not in seen:
                seen.add(pid)
                union.append(r)
                new_in_tile += 1
        log.debug(f"     Tile {i+1}/{len(TILE_OFFSETS)} ({tile_lat:.4f},{tile_lng:.4f}): "
                  f"{len(sub)} resultaten, {new_in_tile} nieuw")

    return union


def main():
    parser = argparse.ArgumentParser(description="Discovery — vind Poolse aannemers via Google Maps")
    parser.add_argument(
        "--city",
        required=True,
        choices=list(CITIES.keys()),
        help=f"Stad. Opties: {', '.join(CITIES.keys())}",
    )
    parser.add_argument(
        "--categories",
        nargs="+",
        default=CATEGORIES_BOUW,
        help=f"Categorieën. Default: alle bouw-categorieën ({', '.join(CATEGORIES_BOUW)})",
    )
    parser.add_argument(
        "--radius",
        type=int,
        default=30000,
        help="Zoekradius in meters (default: 30000 = 30km)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Max resultaten per categorie (API limit is 20)",
    )
    parser.add_argument(
        "--db",
        default=str(DB_PATH),
        help=f"Pad naar SQLite DB (default: {DB_PATH})",
    )

    args = parser.parse_args()

    if not API_KEY:
        log.error("GOOGLE_MAPS_API_KEY ontbreekt. Zet hem in .env (zie .env.example).")
        sys.exit(1)

    db_path = Path(args.db)
    init_db(db_path)

    leads = discover_city(
        city_key=args.city,
        categories=args.categories,
        radius_m=args.radius,
        limit_per_category=args.limit,
    )

    if not leads:
        log.warning("Geen leads gevonden.")
        sys.exit(0)

    # Database
    added, existed = save_leads(leads, db_path)

    # CSV export
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    csv_path = Path(f"leads-{args.city}-{timestamp}.csv")
    export_csv(leads, csv_path)

    # Samenvatting
    log.info("─" * 60)
    log.info(f"Totaal gevonden       : {len(leads)} leads")
    log.info(f"Nieuw in database     : {added}")
    log.info(f"Al aanwezig (skipped) : {existed}")
    log.info(f"Met website           : {sum(1 for l in leads if l.website)}")
    log.info(f"Met telefoonnummer    : {sum(1 for l in leads if l.phone_national)}")
    log.info(f"Met ≥10 reviews       : {sum(1 for l in leads if (l.rating_count or 0) >= 10)}")
    log.info(f"Met foto's            : {sum(1 for l in leads if l.photo_count > 0)}")
    log.info(f"Gem. rating           : {sum(l.rating or 0 for l in leads) / max(1, sum(1 for l in leads if l.rating)):.2f}")
    log.info("─" * 60)
    log.info(f"Database : {db_path.absolute()}")
    log.info(f"CSV      : {csv_path.absolute()}")


if __name__ == "__main__":
    main()
