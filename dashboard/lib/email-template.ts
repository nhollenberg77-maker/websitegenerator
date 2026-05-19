import type { Lead } from "./types";
import type { SmtpSettings } from "./settings";

const NISZA_PL: Record<string, string> = {
  roofing_contractor: "pokryciach dachowych",
  electrician: "instalacjach elektrycznych",
  plumber: "instalacjach hydraulicznych",
  painter: "wykończeniach malarskich",
  general_contractor: "kompleksowych usługach budowlanych",
};

const BRANZA_PL: Record<string, string> = {
  roofing_contractor: "dekarskich",
  electrician: "elektrycznych",
  plumber: "hydraulicznych",
  painter: "malarskich",
  general_contractor: "budowlanych",
};

const REPLY_TO = "tomek@stronadlatwojejfirmy.com.pl";
const FALLBACK_DOMAIN = "stronadlatwojejfirmy.com.pl";

// Absolute basis-URL waar het dashboard reachable is — gebruikt om
// relatieve proxy-paths (/api/photo, /unsubscribe) absoluut te maken
// voor links in mails. Default: same domain als FALLBACK_DOMAIN.
function dashboardBaseUrl(): string {
  const fromEnv = process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `https://app.${FALLBACK_DOMAIN}`;
}

// Maakt een (eventueel relatieve) /api/photo URL absoluut. Gebruikt in
// mail-templates omdat mailclients geen relatieve <img src> kunnen laden.
function absolutize(url: string | null | undefined): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return dashboardBaseUrl() + url;
  return url;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortName(name: string): string {
  // Strip rechtsvorm-suffixen (Sp. z o.o., S.A., FHU, etc.) en pak hooguit 2 woorden
  const cleaned = name
    .replace(/\b(Sp\.?\s*z\s*o\.?o\.?|S\.?A\.?|Sp\.?\s*k\.?|F\.?H\.?U\.?|P\.?P\.?H\.?U\.?)\b.*$/i, "")
    .replace(/[,.]+\s*$/, "")
    .trim();
  const words = cleaned.split(/\s+/).slice(0, 2).join(" ");
  return words.length > 28 ? words.slice(0, 25).trimEnd() + "…" : words || name;
}

function domainFromSiteUrl(siteUrl: string | undefined, slug: string | null): string {
  if (siteUrl) {
    try {
      const u = new URL(siteUrl);
      return u.host;
    } catch {
      // fall through
    }
  }
  if (slug) return `${slug}.${FALLBACK_DOMAIN}`;
  return FALLBACK_DOMAIN;
}

function previewUrl(siteUrl: string | undefined, slug: string | null): string {
  if (siteUrl) return siteUrl;
  if (slug) return `https://${slug}.${FALLBACK_DOMAIN}/`;
  return `https://${FALLBACK_DOMAIN}/`;
}

export function generateEmailSubject(lead: Lead): string {
  return `Strona dla ${lead.name} — bezpłatny szkic`;
}

interface AiEmailData {
  branza_pl?: string;
  nisza_pl?: string;
  hero_title?: string;
  hero_sub?: string;
  hero_cta?: string;
  firma_krotka?: string;
}

function parseAiEmail(lead: Lead): AiEmailData {
  if (!lead.ai_email) return {};
  try {
    return JSON.parse(lead.ai_email) as AiEmailData;
  } catch {
    return {};
  }
}

/**
 * Bouwt unieke unsubscribe-URL voor een lead. Komt overeen met /unsubscribe
 * route op het dashboard; query params bevatten de place_id + een token
 * (hier: simpele HMAC-loze obfuscation). Voor productie aanbevolen:
 * vervang door HMAC-getekende token om guessing te voorkomen.
 */
function unsubscribeUrl(lead: Lead): string {
  const base = (process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || `https://app.${FALLBACK_DOMAIN}`).replace(/\/$/, "");
  return `${base}/unsubscribe?pid=${encodeURIComponent(lead.place_id)}`;
}

export function generateEmailHtml(
  lead: Lead,
  siteUrl?: string,
  screenshotUrl?: string | null,
  smtp?: Partial<SmtpSettings>,
): string {
  const ai = parseAiEmail(lead);

  // Sign/reply uit settings — fallback op de oude hardcoded waardes voor
  // backward-compat. Zo blijft mailen werken als settings nog niet bijgewerkt.
  const signatureName = smtp?.signatureName || smtp?.fromName || "Tomek Paszowski";
  const replyToEmail = smtp?.replyToEmail || smtp?.fromEmail || REPLY_TO;

  const firma = esc(lead.name);
  const firmaKrotka = esc(ai.firma_krotka || shortName(lead.name));
  const miasto = esc(lead.city_query || "Państwa miasta");
  const nisza = ai.nisza_pl || NISZA_PL[lead.category_query || ""] || "usługach budowlanych";
  const branza = ai.branza_pl || BRANZA_PL[lead.category_query || ""] || "budowlanych";

  const linkDomena = esc(domainFromSiteUrl(siteUrl, lead.slug));
  const linkPodglad = esc(previewUrl(siteUrl, lead.slug));

  const heroTitle = esc(ai.hero_title || `Profesjonalne ${nisza} w ${lead.city_query || "Polsce"}`);
  const heroSub = esc(ai.hero_sub || `${lead.name} — jakość, na której można polegać`);
  const heroCta = esc(ai.hero_cta || "Zobacz ofertę");
  const niszaEsc = esc(nisza);
  const branzaEsc = esc(branza);

  const replyMailto = `mailto:${replyToEmail}?subject=${encodeURIComponent(`Zainteresowanie — ${lead.name}`)}`;
  const unsubUrl = unsubscribeUrl(lead);

  const preheader = `Przygotowaliśmy bezpłatny szkic strony dla ${lead.name} — wystarczy spojrzeć, bez zobowiązań.`;

  // Preview-block: als we een echte screenshot hebben, embedden we die.
  // Anders fallback naar de tekst-gebaseerde faux-browser preview.
  const previewBlock = screenshotUrl
    ? `<tr>
                <td style="background:#f7f5ef;padding:8px 12px;border-bottom:1px solid #efece4;font-size:0;line-height:0;">
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;margin-right:4px;">&nbsp;</span>
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;margin-right:4px;">&nbsp;</span>
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;">&nbsp;</span>
                </td>
              </tr>
              <tr>
                <td style="padding:0;background:#ffffff;">
                  <a href="${linkPodglad}" style="display:block;line-height:0;text-decoration:none;">
                    <img src="${esc(screenshotUrl)}" alt="Voorbeeld van strona ${firma}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
                  </a>
                </td>
              </tr>`
    : `<tr>
                <td style="background:#f7f5ef;padding:8px 12px;border-bottom:1px solid #efece4;font-size:0;line-height:0;">
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;margin-right:4px;">&nbsp;</span>
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;margin-right:4px;">&nbsp;</span>
                  <span style="display:inline-block;width:7px;height:7px;background:#d9d3c5;border-radius:50%;">&nbsp;</span>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 22px;background:linear-gradient(180deg,#f3efe7 0%,#e7e1d4 100%);">
                  <div style="font-size:10px;letter-spacing:0.08em;font-weight:600;color:#1c1d1a;text-transform:uppercase;">${firmaKrotka}</div>
                  <div style="margin-top:14px;font-size:22px;line-height:1.15;font-weight:600;letter-spacing:-0.02em;color:#1c1d1a;max-width:80%;">
                    ${heroTitle}
                  </div>
                  <div style="margin-top:8px;font-size:11px;line-height:1.5;color:#4a4b46;max-width:70%;">
                    ${heroSub}
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                    <tr>
                      <td style="background:#2a2a2a;color:#ffffff;font-size:10px;font-weight:600;letter-spacing:0.04em;padding:6px 10px;border-radius:4px;">
                        ${heroCta} →
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strona dla ${firma}</title>
<!--[if mso]>
<style>
  table, td { border-collapse: collapse; }
  .px-fallback { font-family: Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#ece8e1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1c1d1a;">

<!-- preheader (hidden) -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ece8e1;">
  ${esc(preheader)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ece8e1;">
  <tr>
    <td align="center" style="padding:32px 16px 56px 16px;">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fbfaf7;border:1px solid #e6e2d8;border-radius:14px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td style="padding:40px 48px 28px 48px;border-bottom:1px solid #efece4;">
            <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:600;font-size:34px;line-height:1.1;letter-spacing:-0.025em;color:#1c1d1a;">
              Nowa strona dla ${firma} — gotowa do pokazania.
            </h1>
            <p style="margin:14px 0 0 0;font-size:15px;line-height:1.55;color:#4a4b46;max-width:440px;">
              Przygotowaliśmy bezpłatny szkic strony specjalnie dla Państwa firmy. Bez zobowiązań — wystarczy spojrzeć.
            </p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px 48px 40px 48px;font-size:15px;line-height:1.65;color:#1c1d1a;">

            <p style="margin:0 0 18px 0;font-weight:500;">Dzień dobry,</p>

            <p style="margin:0 0 18px 0;">
              Trafiliśmy na <strong style="font-weight:600;">${firma}</strong> podczas przeglądania firm ${branzaEsc} w ${miasto}.
              Zwróciła naszą uwagę Wasza specjalizacja w ${niszaEsc} — to obszar, w którym
              liczy się precyzja i zaufanie klientów. Pomyśleliśmy, że dobrze zaprojektowana
              strona może to zaufanie pokazać już od pierwszej wizyty.
            </p>

            <p style="margin:0 0 18px 0;">
              Zamiast pisać ogólnie, przygotowaliśmy konkretny szkic — taki, jak mogłaby wyglądać
              Wasza strona za kilka dni.
            </p>

            <!-- PREVIEW CARD -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 28px 0;border:1px solid #e6e2d8;border-radius:10px;background:#ffffff;overflow:hidden;">
              ${previewBlock}
              <tr>
                <td style="padding:14px 18px;background:#ffffff;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="font-size:11px;color:#7d7e78;letter-spacing:0.04em;text-transform:uppercase;padding-bottom:2px;">Podgląd strony</td>
                      <td align="right" rowspan="2" style="vertical-align:middle;white-space:nowrap;">
                        <a href="${linkPodglad}" style="display:inline-block;color:#2a2a2a;font-weight:600;font-size:13px;text-decoration:none;padding:8px 12px;border:1px solid #2a2a2a;border-radius:6px;background:#ffffff;white-space:nowrap;">
                          Zobacz na żywo →
                        </a>
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:14px;color:#1c1d1a;font-weight:600;">${linkDomena}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 18px 0;">
              W cenie miesięcznego abonamentu otrzymują Państwo wszystko, co potrzebne, żeby strona
              pracowała na firmę bez Waszej uwagi:
            </p>

            <!-- FEATURES -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px 0;">
              <tr>
                <td width="50%" style="vertical-align:top;padding:7px 14px 7px 0;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Nowoczesny, responsywny design
                </td>
                <td width="50%" style="vertical-align:top;padding:7px 0 7px 14px;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Optymalizacja SEO dla ${miasto}
                </td>
              </tr>
              <tr>
                <td width="50%" style="vertical-align:top;padding:7px 14px 7px 0;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Formularz kontaktowy + Google Maps
                </td>
                <td width="50%" style="vertical-align:top;padding:7px 0 7px 14px;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Hosting i certyfikat SSL w cenie
                </td>
              </tr>
              <tr>
                <td width="50%" style="vertical-align:top;padding:7px 14px 7px 0;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Aktualizacje treści bez dodatkowych opłat
                </td>
                <td width="50%" style="vertical-align:top;padding:7px 0 7px 14px;font-size:14px;line-height:1.45;color:#1c1d1a;">
                  <span style="color:#2a2a2a;font-weight:700;">✓</span>&nbsp;&nbsp;Gotowa w 5 dni roboczych
                </td>
              </tr>
            </table>

            <!-- PRICE -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px 0;border:1px solid #e6e2d8;border-radius:10px;background:#ffffff;">
              <tr>
                <td align="center" style="padding:26px 24px 26px 24px;">
                  <div style="font-size:11px;color:#7d7e78;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;margin-bottom:8px;">
                    Miesięczny abonament
                  </div>
                  <div style="white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1d1a;">
                    <span style="font-size:14px;color:#7d7e78;font-weight:500;">od&nbsp;</span><span style="font-size:44px;font-weight:600;letter-spacing:-0.025em;line-height:1;">149&nbsp;zł</span><span style="font-size:14px;color:#7d7e78;">&nbsp;/miesiąc</span>
                  </div>
                  <div style="margin-top:10px;font-size:13px;line-height:1.5;color:#4a4b46;">
                    jednorazowa opłata startowa <strong style="color:#1c1d1a;font-weight:600;">499 zł</strong> · umowa miesięczna, bez ukrytych kosztów
                  </div>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 24px 0;">
              Jeśli szkic Wam się spodoba, wystarczy odpowiedzieć na tego maila.
              Jeśli nie — żadnego problemu, po prostu zignorujcie tę wiadomość.
            </p>

            <!-- CTA -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px 0;">
              <tr>
                <td align="center">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:#2a2a2a;border-radius:8px;">
                        <a href="${replyMailto}" style="display:inline-block;color:#ffffff;font-weight:600;font-size:14.5px;text-decoration:none;padding:14px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                          Tak, chcę zobaczyć szkic →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- SIGNATURE -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
              <tr>
                <td style="padding-top:24px;border-top:1px solid #efece4;font-size:14.5px;line-height:1.5;">
                  <div style="color:#4a4b46;">Pozdrawiam,</div>
                  <div style="font-weight:600;color:#1c1d1a;">${esc(signatureName)}</div>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- LEGAL FOOTER (RODO / handelsregister) -->
        <tr>
          <td style="padding:24px 48px 28px 48px;background:#f3efe7;border-top:1px solid #e6e2d8;font-size:11.5px;line-height:1.55;color:#7d7e78;">
            <div style="margin-bottom:8px;">
              Wiadomość wysłana na podstawie publicznie dostępnych danych firmowych (Google Business Profile).
              Jeśli nie życzą sobie Państwo otrzymywać takich propozycji, prosimy
              <a href="${esc(unsubUrl)}" style="color:#7d7e78;text-decoration:underline;">kliknąć tutaj</a>
              lub po prostu odpowiedzieć słowem <strong style="color:#4a4b46;">STOP</strong> — usuniemy adres natychmiast.
            </div>
            ${smtp?.companyName ? `<div style="margin-top:10px;color:#9a9b95;">
              ${esc(smtp.companyName)}${smtp.companyAddress ? ` · ${esc(smtp.companyAddress)}` : ""}${smtp.companyNip ? ` · NIP ${esc(smtp.companyNip)}` : ""}${smtp.companyRegon ? ` · REGON ${esc(smtp.companyRegon)}` : ""}
            </div>` : ""}
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;
}

/**
 * Headers die `nodemailer` moet meesturen voor de cold-emails.
 * - List-Unsubscribe + List-Unsubscribe-Post = 1-click unsubscribe via Gmail/Outlook
 * - Reply-To = juiste antwoordadres als from-email gespoofd is voor branding
 */
export function buildEmailHeaders(lead: Lead, smtp?: Partial<SmtpSettings>): Record<string, string> {
  const base = (process.env.DASHBOARD_URL || process.env.NEXT_PUBLIC_DASHBOARD_URL || `https://app.${FALLBACK_DOMAIN}`).replace(/\/$/, "");
  // List-Unsubscribe wijst naar /api/unsubscribe — die accepteert RFC 8058 1-click POST.
  // De link in de mail-body (zie unsubscribeUrl) gaat naar /unsubscribe (HTML-bevestiging).
  const unsubApi = `${base}/api/unsubscribe?pid=${encodeURIComponent(lead.place_id)}`;
  const replyTo = smtp?.replyToEmail || smtp?.fromEmail || REPLY_TO;
  const unsubMailto = `mailto:${replyTo}?subject=${encodeURIComponent("STOP")}&body=${encodeURIComponent("STOP")}`;
  return {
    "List-Unsubscribe": `<${unsubApi}>, <${unsubMailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
