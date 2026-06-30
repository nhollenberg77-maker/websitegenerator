# Design

Visueel systeem voor de gegenereerde concept-sites (`dashboard/lib/site-generator.ts`).
Eén fundering, per branche afgestemd. Richting: **premium door rust** — verfijn het
bestaande, geen versiering om de versiering.

## Atmosphere

Rustig, hoogwaardig, met de hand gemaakt. Ruime witruivte, sterke typografische
hiërarchie, één foto die draagt, subtiele details. Warmte en karakter komen uit de
branche-tuning, niet uit drukte. Vermijd: sjabloon-gevoel, banners/pop-ups, zware
slagschaduwen, glimmende knoppen, gedateerde gradients.

## Color

OKLCH waar mogelijk; hou contrast op WCAG AA (ook tekst op hero-foto's via overlay).
Per archetype een eigen, ingetogen accent op een neutrale, iets warme basis:

- **Horeca (food)** — wijn `#8a3b32` op crème `#faf6ef`, inkt `#23201b`, lijn `#e7dfd2`.
- **Salon / verzorging** — mauve `#a8576b`, warm-neutrale bg `#faf5f3`.
- **Zorg (medical)** — kalm teal `#2c7a7b`, koel-neutrale bg `#f4f8f8`.
- **Retail** — groen `#3f6f52`, fris-neutrale bg `#f6f7f4`.
- **Neutraal/editorial & service** — donkere inkt + één merk-accent per variant.

Eén accentkleur per site; de rest is neutraal. Geen regenboog aan kleuren.

## Typography

- **Koppen:** Fraunces (serif, opsz) — karakter en hiërarchie. Strakke line-height (1.1).
- **Tekst:** Inter — rustig, leesbaar, 1.6 line-height.
- Grote, zelfverzekerde hero-koppen (clamp ~38–76px); duidelijke maatsprongen tussen
  h1/h2/h3/lopende tekst. Beperk regelbreedte (~48–60ch).

## Spacing & shape

- Container max ~1080px, generieuze sectie-padding (~60–72px).
- Consistent 4/8-px ritme; royale witruimte tussen secties.
- Radii zacht maar niet bubblegum (pillen voor knoppen/badges, ~10–14px voor cards).
- Eén lichte achtergrond-alternatie (wit ↔ neutrale bg), geen bonte blokken.

## Components

- **Topbar**: sticky, transparant-blur, merknaam links + één primaire CTA rechts.
- **Hero**: foto met donker-naar-onder overlay, eyebrow (branche · stad), grote kop,
  korte lead, primaire CTA + ghost-CTA. Geen foto → ingetogen kleurverloop in accent.
- **Aanbod**: horeca = menukaart (secties, prijzen rechts uitgelijnd met stippellijn);
  salon/zorg/retail = cennik/prijslijst; vakman = diensten + FAQ.
- **Reviews**: 3 echte Poolse citaten, sterren, naam. Geen verzonnen quotes.
- **Galerij**: alleen tonen bij ≥3 echte foto's, gelijke ratio's.
- **Contact**: adres, openingstijden, klikbare `tel:`-link, optioneel WhatsApp (alleen
  bij echt nummer). Demo-disclaimer-balk bovenaan + footer; `noindex`.

## Motion

Subtiel en met betekenis: zachte hover-overgangen op knoppen/links (~.2s), eventueel
een rustige reveal bij scrollen. Altijd `prefers-reduced-motion` respecteren. Geen
opvallende of trage animaties.

## Non-negotiables

Mobiel-eerst (geen horizontaal scrollen), snelle laadtijd, werkende `tel:`-links, géén
nep-contactgegevens, géén verzonnen claims/keurmerken, correct natuurlijk Pools, juiste
stad (uit het adres).
