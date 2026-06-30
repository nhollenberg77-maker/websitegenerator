// Google Places API (New) als TypeScript-tool — vervangt discovery.py + enrich.py.
// Levert ruwe data; het oordeel (kwalificatie) ligt bij de Scout-agent.

const PLACES_API_BASE = "https://places.googleapis.com/v1";

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.websiteUri",
  "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.rating",
  "places.userRatingCount", "places.types", "places.primaryType", "places.businessStatus",
  "places.location", "places.photos",
].join(",");

const DETAIL_FIELD_MASK = "reviews,editorialSummary";

export const CITIES: Record<string, { lat: number; lng: number; name: string; voivodeship: string }> = {
  krakow: { lat: 50.0647, lng: 19.945, name: "Kraków", voivodeship: "Małopolskie" },
  warszawa: { lat: 52.2297, lng: 21.0122, name: "Warszawa", voivodeship: "Mazowieckie" },
  wroclaw: { lat: 51.1079, lng: 17.0385, name: "Wrocław", voivodeship: "Dolnośląskie" },
  poznan: { lat: 52.4064, lng: 16.9252, name: "Poznań", voivodeship: "Wielkopolskie" },
  gdansk: { lat: 54.352, lng: 18.6466, name: "Gdańsk", voivodeship: "Pomorskie" },
  lodz: { lat: 51.7592, lng: 19.456, name: "Łódź", voivodeship: "Łódzkie" },
  katowice: { lat: 50.2649, lng: 19.0238, name: "Katowice", voivodeship: "Śląskie" },
  lublin: { lat: 51.2465, lng: 22.5684, name: "Lublin", voivodeship: "Lubelskie" },
  bydgoszcz: { lat: 53.1235, lng: 18.0084, name: "Bydgoszcz", voivodeship: "Kujawsko-pomorskie" },
  szczecin: { lat: 53.4285, lng: 14.5528, name: "Szczecin", voivodeship: "Zachodniopomorskie" },
  wieliczka: { lat: 49.987, lng: 20.0644, name: "Wieliczka", voivodeship: "Małopolskie" },
  niepolomice: { lat: 50.0289, lng: 20.2218, name: "Niepołomice", voivodeship: "Małopolskie" },
};

export interface RawPlace {
  place_id: string;
  name: string;
  address: string | null;
  website: string | null;
  phone_national: string | null;
  phone_intl: string | null;
  rating: number | null;
  rating_count: number;
  primary_type: string | null;
  types: string[];
  business_status: string | null;
  photo_count: number;
  photo_refs: string[];
  latitude: number | null;
  longitude: number | null;
}

function apiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY ontbreekt in .env");
  return k;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePlace(raw: any): RawPlace {
  const loc = raw.location ?? {};
  const photos = (raw.photos ?? []) as { name?: string }[];
  const dn = raw.displayName;
  return {
    place_id: raw.id ?? "",
    name: typeof dn === "object" ? (dn?.text ?? "") : (dn ?? ""),
    address: raw.formattedAddress ?? null,
    website: raw.websiteUri ?? null,
    phone_national: raw.nationalPhoneNumber ?? null,
    phone_intl: raw.internationalPhoneNumber ?? null,
    rating: raw.rating ?? null,
    rating_count: raw.userRatingCount ?? 0,
    primary_type: raw.primaryType ?? null,
    types: raw.types ?? [],
    business_status: raw.businessStatus ?? null,
    photo_count: photos.length,
    photo_refs: photos.map((p) => p.name ?? "").filter(Boolean),
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
  };
}

async function searchNearbyOnce(lat: number, lng: number, radiusM: number, category: string, limit: number): Promise<RawPlace[]> {
  const res = await fetch(`${PLACES_API_BASE}/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: [category],
      maxResultCount: Math.min(limit, 20),
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      languageCode: "pl",
      regionCode: "PL",
    }),
  });
  if (!res.ok) throw new Error(`Places searchNearby ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.places ?? []) as any[]).map(parsePlace);
}

// 5-tile kruis rond het centrum. De tiles overlappen ~50% (tileRadius = 0.75×
// radius, offset = 0.5×radius), dus de 4 hoektegels voegden weinig unieks toe
// maar verdubbelden bijna de Places-kosten (9 → 5 = ~45% goedkoper per zoek).
const TILE_OFFSETS: [number, number][] = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
];

export async function searchNearby(opts: {
  city?: string;
  lat?: number;
  lng?: number;
  category: string;
  radiusM?: number;
  limit?: number;
}): Promise<RawPlace[]> {
  const radiusM = opts.radiusM ?? 30000;
  const limit = opts.limit ?? 20;
  let lat = opts.lat, lng = opts.lng;
  if ((lat == null || lng == null) && opts.city) {
    const c = CITIES[opts.city.toLowerCase()];
    if (c) { lat = c.lat; lng = c.lng; }
  }
  if (lat == null || lng == null) throw new Error(`Onbekende stad '${opts.city}' en geen lat/lng opgegeven`);

  const metersPerLat = 111_320;
  const metersPerLng = 111_320 * Math.cos((lat * Math.PI) / 180);
  const offsetM = radiusM * 0.5;
  const dLat = offsetM / metersPerLat;
  const dLng = offsetM / metersPerLng;
  const tileRadius = Math.round(radiusM * 0.75);

  const seen = new Set<string>();
  const union: RawPlace[] = [];
  for (const [kx, ky] of TILE_OFFSETS) {
    try {
      const sub = await searchNearbyOnce(lat + kx * dLat, lng + ky * dLng, tileRadius, opts.category, limit);
      for (const p of sub) {
        if (p.place_id && !seen.has(p.place_id) && p.business_status !== "CLOSED_PERMANENTLY") {
          seen.add(p.place_id);
          union.push(p);
        }
      }
    } catch { /* tile-fout overslaan */ }
  }
  return union;
}

export interface PlaceDetails {
  reviews: { author: string; rating: number | null; text: string; time: string }[];
  description: string;
  photo_urls: string[]; // proxy-paden /api/photo?ref=...
}

export async function placeDetails(placeId: string): Promise<PlaceDetails | null> {
  const url = `${PLACES_API_BASE}/places/${placeId}?languageCode=pl&regionCode=PL`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": DETAIL_FIELD_MASK } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reviews = ((data.reviews ?? []) as any[]).slice(0, 5).map((rev) => ({
    author: rev.authorAttribution?.displayName ?? "Klient",
    rating: rev.rating ?? null,
    text: (typeof rev.text === "object" ? rev.text?.text : rev.text) ?? "",
    time: rev.relativePublishTimeDescription ?? "",
  }));
  const editorial = data.editorialSummary;
  const description = (typeof editorial === "object" ? editorial?.text : "") ?? "";
  return { reviews, description, photo_urls: [] };
}

// Bouw proxy-foto-URL's uit photo refs (key blijft server-side, zoals enrich.py).
export function photoProxyUrls(photoRefs: string[], maxWidth = 1200): string[] {
  return photoRefs.slice(0, 10).map((ref) => `/api/photo?ref=${encodeURIComponent(ref)}&w=${maxWidth}`);
}
