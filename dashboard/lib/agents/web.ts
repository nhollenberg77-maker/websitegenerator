// Website-fetch als tool: haalt HTML op en levert tekst + signalen waarop de
// Scout-agent zélf kan oordelen of een site zwak/ontbrekend is (geen vaste
// bad_site_score-regels meer).

export interface SiteSignals {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  https: boolean;
  title: string | null;
  hasViewport: boolean;
  hasFavicon: boolean;
  hasOgTags: boolean;
  hasSchemaOrg: boolean;
  textLength: number;
  excerpt: string;
  emails: string[];
  isSocialOrListing: boolean;
  note?: string;
}

const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "linkedin.com", "tiktok.com", "youtube.com"];
const LISTING_HOSTS = ["oferia.pl", "fixly.pl", "panoramafirm.pl", "pkt.pl", "aleo.com", "gowork.pl"];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchWebsite(rawUrl: string): Promise<SiteSignals> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();

  const base: SiteSignals = {
    url, ok: false, status: null, finalUrl: null, https: url.startsWith("https://"),
    title: null, hasViewport: false, hasFavicon: false, hasOgTags: false, hasSchemaOrg: false,
    textLength: 0, excerpt: "", emails: [],
    isSocialOrListing: SOCIAL_HOSTS.some((h) => host.endsWith(h)) || LISTING_HOSTS.some((h) => host.endsWith(h)),
  };
  if (base.isSocialOrListing) {
    base.note = "URL is een social-media- of listing-pagina, geen eigen website.";
    return base;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadScout/1.0)" },
    });
    base.status = res.status;
    base.finalUrl = res.url;
    base.https = res.url.startsWith("https://");
    if (!res.ok) { base.note = `HTTP ${res.status}`; return base; }
    const html = (await res.text()).slice(0, 400_000);
    base.ok = true;
    base.title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim().slice(0, 200) || null;
    base.hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    base.hasFavicon = /<link[^>]+rel=["'][^"']*icon/i.test(html);
    base.hasOgTags = /<meta[^>]+property=["']og:/i.test(html);
    base.hasSchemaOrg = /schema\.org/i.test(html) || /application\/ld\+json/i.test(html);
    const text = stripHtml(html);
    base.textLength = text.length;
    base.excerpt = text.slice(0, 600);
    base.emails = Array.from(new Set((html.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
      .filter((e) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(e)))).slice(0, 5);
    return base;
  } catch (err) {
    base.note = err instanceof Error && err.name === "AbortError" ? "timeout" : "fetch mislukt";
    return base;
  } finally {
    clearTimeout(timer);
  }
}
