// Server-side proxy voor Google Places photo-URLs.
//
// Waarom dit nodig is: voorheen werd `&key=GOOGLE_MAPS_API_KEY` direct in de
// foto-URL gezet, waardoor de API-key in elke gegenereerde aannemer-site en
// in elke verzonden cold-email te zien was. Nu houdt enrich.py alleen de
// "photo resource name" (places/CHIJ.../photos/AUf...) bij; deze route doet
// de upstream-fetch server-side met de key in een header en streamt de bytes
// terug.
//
// Aanroep: /api/photo?ref=places%2FCHIJ...%2Fphotos%2FAUf...&w=1200

import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const UPSTREAM = "https://places.googleapis.com/v1";
const DEFAULT_WIDTH = 1200;
const MAX_WIDTH = 4800;

// Voorkomt dat iemand willekeurige URLs door deze proxy haalt.
const REF_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return new NextResponse("GOOGLE_MAPS_API_KEY niet geconfigureerd", { status: 500 });
  }

  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref || !REF_RE.test(ref)) {
    return new NextResponse("Bad ref", { status: 400 });
  }

  const wRaw = req.nextUrl.searchParams.get("w");
  let w = DEFAULT_WIDTH;
  if (wRaw) {
    const parsed = parseInt(wRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      w = Math.min(parsed, MAX_WIDTH);
    }
  }

  const upstreamUrl = `${UPSTREAM}/${ref}/media?maxWidthPx=${w}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      headers: { "X-Goog-Api-Key": API_KEY },
      // Vercel-vriendelijk: tijdens build niet vol-cachen
      cache: "no-store",
    });
  } catch (err) {
    return new NextResponse(
      `Upstream fetch failed: ${err instanceof Error ? err.message : "unknown"}`,
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return new NextResponse(`Upstream ${upstream.status}`, { status: upstream.status });
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
      // 1 dag in browser, 7 dagen op de CDN edge — foto's wijzigen zelden
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
