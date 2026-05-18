// Server-side e-mail extractor voor lead-websites.
// Probeert: mailto-links, plain-text emails, Cloudflare-decoded email-protection.
// Geeft het meest waarschijnlijke contact-adres terug.

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

const JUNK_PATTERNS = [
  /^noreply@/i,
  /^no-reply@/i,
  /^donotreply@/i,
  /^postmaster@/i,
  /^abuse@/i,
  /^webmaster@/i,
  /@example\./i,
  /@sentry\./i,
  /@wixpress\./i,
  /@mailerlite\./i,
  /@wordpress\./i,
  /@sentry-next\./i,
  /\.(png|jpe?g|gif|svg|webp|css|js|ico)$/i,
];

const PREFERRED_PREFIXES = ["info", "kontakt", "biuro", "office", "sekretariat", "firma", "kontakt.biuro"];

const CONTACT_PAGE_PATHS = ["/kontakt", "/contact", "/kontakt.html", "/contact.html", "/kontakt/", "/contact/", "/o-nas/kontakt"];

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; LeadsPoland-Bot/1.0; +https://stronadlatwojejfirmy.com.pl)";

function decodeCloudflareEmail(encoded: string): string | null {
  try {
    const r = parseInt(encoded.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < encoded.length; i += 2) {
      const c = parseInt(encoded.slice(i, i + 2), 16) ^ r;
      out += String.fromCharCode(c);
    }
    return /^[\w.+-]+@[\w.-]+\.[\w-]{2,}$/.test(out) ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractContactPageUrls(html: string, base: URL): string[] {
  const urls = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const hint = `${href} ${text}`;
    if (!/kontakt|contact/i.test(hint)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") === base.hostname.replace(/^www\./, "")) {
        u.hash = "";
        urls.add(u.toString());
      }
    } catch {
      // ignore malformed href
    }
  }
  return [...urls];
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  // Cloudflare-decoded emails: <a class="__cf_email__" data-cfemail="...">
  const cfMatches = html.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi);
  for (const m of cfMatches) {
    const decoded = decodeCloudflareEmail(m[1]);
    if (decoded) found.add(decoded);
  }

  // mailto: links
  const mailtoMatches = html.matchAll(/mailto:([^"'\s?&<>]+)/gi);
  for (const m of mailtoMatches) {
    found.add(decodeURIComponent(m[1]).toLowerCase());
  }

  // Plain text emails
  const plain = html.match(EMAIL_RE) || [];
  for (const e of plain) found.add(e.toLowerCase());

  return [...found].filter((e) => !JUNK_PATTERNS.some((p) => p.test(e)));
}

function scoreEmail(email: string, domain: string): number {
  const [local, host] = email.split("@");
  if (!host) return -1;
  let score = 0;
  // Same root domain match
  if (host === domain || host.endsWith("." + domain)) score += 100;
  // Preferred prefix
  const prefixIdx = PREFERRED_PREFIXES.indexOf(local);
  if (prefixIdx >= 0) score += 50 - prefixIdx;
  // Shorter is usually better
  score -= local.length * 0.5;
  return score;
}

export async function findContactEmail(websiteUrl: string): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`);
  } catch {
    return null;
  }
  const rootDomain = base.hostname.toLowerCase().replace(/^www\./, "");

  const collected = new Set<string>();
  const triedPages = new Set<string>();

  async function tryPage(url: string): Promise<void> {
    if (triedPages.has(url)) return;
    triedPages.add(url);
    const html = await fetchHtml(url);
    if (!html) return;
    for (const e of extractEmailsFromHtml(html)) collected.add(e);
    // Bij homepage: bewaar gevonden kontakt-links voor follow-up
    if (url === base.toString() && collected.size === 0) {
      for (const link of extractContactPageUrls(html, base)) {
        if (!triedPages.has(link)) candidatePages.push(link);
      }
    }
  }

  // Volgorde: homepage → kontakt-anchors gevonden op homepage → fixed paths
  const candidatePages: string[] = [];
  await tryPage(base.toString());

  // Geparsed kontakt-anchors uit homepage
  for (const url of candidatePages) {
    if (collected.size > 0) break;
    await tryPage(url);
  }

  // Fixed fallback paths
  if (collected.size === 0) {
    for (const path of CONTACT_PAGE_PATHS) {
      const url = new URL(path, base).toString();
      await tryPage(url);
      if (collected.size > 0) break;
    }
  }

  if (collected.size === 0) return null;

  const ranked = [...collected].sort((a, b) => scoreEmail(b, rootDomain) - scoreEmail(a, rootDomain));
  return ranked[0] || null;
}
