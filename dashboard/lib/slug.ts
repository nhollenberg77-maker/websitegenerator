// Polish → ASCII transliteration + URL-safe slug generation.
// Used for subdomain routing: "Gaz-Serwis. FHU." → "gaz-serwis"

const POLISH_MAP: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "a", Ć: "c", Ę: "e", Ł: "l", Ń: "n", Ó: "o", Ś: "s", Ź: "z", Ż: "z",
};

// Polish corporate suffixes that add noise to slugs.
// "Sp. z o.o.", "S.A.", "S.C.", "Sp. k.", trailing "Sp", "FHU", etc.
const POLISH_CORP_SUFFIX = /\b(sp\.?\s*z\s*o\.?\s*o\.?(\s*sp\.?\s*k\.?)?|sp\.?\s*[kjp]\.?|s\.?a\.?|s\.?c\.?|fhu|sp\.?)\b\.?/gi;

export function slugify(name: string): string {
  if (!name) return "lead";

  // 1. Split on real separators: comma, semicolon, pipe, em-dash, " - ", ". " (period+space)
  //    NOT on bare "." inside abbreviations like "S.C" or "Sp.".
  const firstPart = name.split(/[,;|—–]|\s-\s|\.\s/)[0].trim();

  // 2. Remove Polish corporate suffixes that don't add brand value
  let cleaned = firstPart.replace(POLISH_CORP_SUFFIX, " ").trim();
  if (!cleaned) cleaned = firstPart; // fallback if suffix removal emptied it

  // 3. Polish-specific transliteration
  let result = cleaned
    .split("")
    .map((c) => POLISH_MAP[c] ?? c)
    .join("");

  result = result
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip any remaining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  // Reject pure-digit slugs (subdomains beginning with a digit are valid
  // but feel weird) and pad if empty.
  if (!result || /^\d+$/.test(result)) return `firma-${result || "x"}`;

  return result;
}

// Reserved subdomains we never assign to a lead (would shadow internal routes
// or confuse customers).
const RESERVED = new Set([
  "www", "api", "app", "admin", "dashboard", "mail", "ftp", "blog",
  "shop", "store", "help", "support", "static", "cdn", "assets",
  "local-only", "sites", "sub", "vercel",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug);
}
