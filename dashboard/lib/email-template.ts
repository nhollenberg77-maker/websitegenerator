import type { Lead } from "./types";

const CATEGORY_PL: Record<string, string> = {
  roofing_contractor: "dekarstwo",
  electrician: "usługi elektryczne",
  plumber: "usługi hydrauliczne",
  painter: "usługi malarskie",
  general_contractor: "usługi budowlane",
};

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getCategoryPl(lead: Lead): string {
  return CATEGORY_PL[lead.category_query || ""] || "usługi budowlane";
}

export function generateEmailSubject(lead: Lead): string {
  return `${lead.name} — nowa strona internetowa dla Twojej firmy`;
}

export function generateEmailHtml(lead: Lead, siteUrl?: string): string {
  const category = getCategoryPl(lead);
  const city = lead.city_query || "Twojego miasta";
  const firstName = lead.name.split(" ")[0];

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nowa strona dla ${lead.name}</title>
</head>
<body style="margin:0;padding:0;background-color:#FAFAF7;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1A;line-height:1.6;">

<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Header -->
<tr><td style="background-color:#1A2B4A;padding:32px 40px;border-radius:12px 12px 0 0;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">
    Strona dla Twojej Firmy
  </h1>
  <p style="margin:4px 0 0;color:rgba(255,255,255,0.6);font-size:14px;font-style:italic;">
    Profesjonalna obecność online od 149 zł/mies.
  </p>
</td></tr>

<!-- Body -->
<tr><td style="background-color:#ffffff;padding:40px;border-left:1px solid #E5E2DC;border-right:1px solid #E5E2DC;">

  <p style="margin:0 0 20px;font-size:16px;">
    Dzień dobry,
  </p>

  <p style="margin:0 0 20px;font-size:15px;color:#333;">
    Znaleźliśmy <strong>${lead.name}</strong> w ${city} i widzimy, że Wasza firma świadczy usługi z zakresu <strong>${category}</strong>.
  </p>

  <p style="margin:0 0 20px;font-size:15px;color:#333;">
    Przygotowaliśmy propozycję nowej, nowoczesnej strony internetowej, która pomoże Wam pozyskać więcej klientów.
    Wasza obecna strona nie jest zoptymalizowana pod urządzenia mobilne i brakuje jej nowoczesnych rozwiązań,
    które dzisiaj są standardem.
  </p>

  ${siteUrl ? `<!-- Site preview CTA -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background: linear-gradient(135deg, #1A2B4A 0%, #2A3B5A 100%);border-radius:12px;">
  <tr><td style="padding:28px 32px;text-align:center;">
    <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:1px;font-weight:600;">Specjalnie dla ${escapeHtmlAttr(lead.name)}</p>
    <p style="margin:0 0 20px;font-size:22px;font-weight:700;color:#ffffff;">Przygotowaliśmy Waszą nową stronę</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr><td style="background-color:#ffffff;border-radius:8px;padding:16px 36px;">
      <a href="${escapeHtmlAttr(siteUrl)}" style="color:#1A2B4A;text-decoration:none;font-size:16px;font-weight:700;">
        Zobacz przykładową stronę →
      </a>
    </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">Kliknij aby zobaczyć pełną wersję strony</p>
  </td></tr>
  </table>
  ` : ""}<!-- Preview box -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background-color:#F2F0EA;border-radius:8px;border:1px solid #E5E2DC;">
  <tr><td style="padding:24px;">
    <h3 style="margin:0 0 8px;font-size:16px;color:#1A2B4A;">Co oferujemy:</h3>
    <table cellpadding="0" cellspacing="0"><tbody>
      <tr><td style="padding:4px 0;font-size:14px;color:#333;">✓ Nowoczesny, responsywny design</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#333;">✓ Optymalizacja SEO dla ${city}</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#333;">✓ Formularz kontaktowy i integracja z Google Maps</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#333;">✓ Hosting i certyfikat SSL w cenie</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#333;">✓ Gotowa w 5 dni roboczych</td></tr>
    </tbody></table>
  </td></tr>
  </table>

  <!-- Pricing -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border-radius:8px;border:2px solid #1A2B4A;">
  <tr><td style="padding:20px 24px;text-align:center;">
    <p style="margin:0 0 4px;font-size:13px;color:#5A5A55;text-transform:uppercase;letter-spacing:1px;">Miesięczny abonament</p>
    <p style="margin:0;font-size:32px;font-weight:700;color:#1A2B4A;">149 zł<span style="font-size:14px;font-weight:400;color:#5A5A55;">/mies.</span></p>
    <p style="margin:8px 0 0;font-size:13px;color:#5A5A55;">+ jednorazowa opłata startowa 499 zł</p>
  </td></tr>
  </table>

  <p style="margin:0 0 24px;font-size:15px;color:#333;">
    Chętnie pokażemy Wam, jak mogłaby wyglądać nowa strona <strong>${firstName}</strong>.
    Wystarczy odpowiedzieć na tego maila lub zadzwonić — przygotujemy bezpłatną wizualizację.
  </p>

  <!-- CTA -->
  <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr><td style="background-color:#1A2B4A;border-radius:8px;padding:14px 32px;">
    <a href="mailto:kontakt@werkflows.nl?subject=Zainteresowanie%20-%20${encodeURIComponent(lead.name)}" style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
      Jestem zainteresowany — odezwijcie się
    </a>
  </td></tr>
  </table>

</td></tr>

<!-- Footer -->
<tr><td style="background-color:#F2F0EA;padding:24px 40px;border-radius:0 0 12px 12px;border:1px solid #E5E2DC;border-top:none;">
  <p style="margin:0;font-size:12px;color:#5A5A55;text-align:center;">
    Werkflows · Profesjonalne strony internetowe dla firm budowlanych w Polsce
  </p>
  <p style="margin:8px 0 0;font-size:11px;color:#999;text-align:center;">
    Jeśli nie chcesz otrzymywać takich wiadomości, po prostu zignoruj tego maila.
  </p>
</td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}
