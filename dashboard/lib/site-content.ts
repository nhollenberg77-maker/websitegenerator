export interface CategoryContent {
  heroHeadline: string;
  heroHeadlineEm: string;
  heroLead: string;
  services: { title: string; description: string; icon: string }[];
  trustItems: string[];
  aboutHeadline: string;
  aboutHeadlineEm: string;
  aboutP1: string;
  aboutP2: string;
  aboutQuote: string;
  faqItems: { q: string; a: string }[];
  selectOptions: string[];
}

export type TemplateVariant = "eco" | "premium" | "traditional";

export const CATEGORY_VARIANT: Record<string, TemplateVariant> = {
  electrician: "premium",
  plumber: "traditional",
  painter: "eco",
  roofing_contractor: "traditional",
  general_contractor: "premium",
};

export const VARIANT_COLORS: Record<TemplateVariant, { bgDark: string; accent: string; accentHover: string; accentSoft: string }> = {
  eco: { bgDark: "#2D5A3F", accent: "#2D5A3F", accentHover: "#3A6E50", accentSoft: "#E5EFE9" },
  premium: { bgDark: "#2A2D34", accent: "#2A2D34", accentHover: "#3E424B", accentSoft: "#E8E9EC" },
  traditional: { bgDark: "#8B3A2E", accent: "#8B3A2E", accentHover: "#A04A3E", accentSoft: "#F5E6E1" },
};

const ICON_HOME = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
const ICON_GRID = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>';
const ICON_ROOF = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l10-9 10 9"/><path d="M5 10v10h14V10"/></svg>';
const ICON_LIST = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';
const ICON_TOOL = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
const ICON_BOLT = '<svg class="service-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>';

export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
  electrician: {
    heroHeadline: "Bezpieczna elektryka.",
    heroHeadlineEm: "Profesjonalne instalacje.",
    heroLead: "Wykonujemy instalacje elektryczne w domach, mieszkaniach i obiektach komercyjnych. Uprawnienia SEP, gwarancja na każdą pracę. Rozmawia z Państwem bezpośrednio właściciel firmy.",
    services: [
      { title: "Instalacje elektryczne", description: "Kompleksowe instalacje w nowych budynkach i przy remontach. Rozdzielnie, okablowanie, gniazda i oświetlenie zgodnie z normami.", icon: ICON_BOLT },
      { title: "Oświetlenie", description: "Projektowanie i montaż oświetlenia wewnętrznego i zewnętrznego. LED, punktowe, dekoracyjne. Efekt wizualny i oszczędność energii.", icon: ICON_HOME },
      { title: "Smart home", description: "Inteligentne sterowanie oświetleniem, roletami, ogrzewaniem. Systemy KNX, Loxone, Wi-Fi. Wygoda na wyciągnięcie ręki.", icon: ICON_GRID },
      { title: "Monitoring i alarmy", description: "Systemy CCTV, alarmy, czujniki ruchu, wideodomofony. Montaż i konfiguracja. Bezpieczeństwo Państwa domu i firmy.", icon: ICON_LIST },
      { title: "Pompy ciepła", description: "Instalacje pomp ciepła i fotowoltaiki. Podłączenie do sieci, konfiguracja, odbiory. Niższe rachunki za prąd od pierwszego miesiąca.", icon: ICON_TOOL },
      { title: "Przeglądy i naprawy", description: "Okresowe przeglądy instalacji elektrycznych, pomiary, usuwanie usterek. Protokoły zgodne z wymaganiami ubezpieczycieli.", icon: ICON_BOLT },
    ],
    trustItems: ["Uprawnienia SEP do 1 kV", "Ubezpieczenie OC", "Pomiary i protokoły", "Gwarancja na każdą pracę"],
    aboutHeadline: "Doświadczony elektryk.",
    aboutHeadlineEm: "Uprawnienia i gwarancje.",
    aboutP1: "Specjalizujemy się w instalacjach elektrycznych dla domów jednorodzinnych, mieszkań i małych obiektów komercyjnych. Posiadamy pełne uprawnienia SEP oraz ubezpieczenie OC.",
    aboutP2: "Każda praca kończy się protokołem pomiarowym i gwarancją. Pracujemy czysto, terminowo i bez niespodzianek cenowych. Nasi klienci wracają do nas z kolejnymi zleceniami.",
    aboutQuote: "Dobra instalacja to taka, o której nie musisz myśleć. Po prostu działa — bezpiecznie i niezawodnie.",
    faqItems: [
      { q: "Czy macie uprawnienia SEP?", a: "Tak. Posiadamy aktualne uprawnienia SEP do 1 kV w zakresie eksploatacji i dozoru, ubezpieczenie OC oraz wszystkie wymagane certyfikaty. Dokumenty pokazujemy na pierwszym spotkaniu." },
      { q: "Jak wygląda wycena instalacji?", a: "Wycena jest bezpłatna. Po obejrzeniu projektu lub mieszkania przygotowujemy szczegółowy kosztorys w ciągu 2-3 dni roboczych z rozbiciem na materiały i robociznę." },
      { q: "Czy wystawiacie protokoły pomiarowe?", a: "Tak, po każdej instalacji wykonujemy pełne pomiary i wystawiamy protokoły zgodne z normami PN-HD. Są one wymagane przez ubezpieczycieli i przy odbiorach budowlanych." },
      { q: "Ile trwa typowa instalacja w domu?", a: "Instalacja elektryczna w domu jednorodzinnym 120-180 m² to zwykle 5-10 dni roboczych. Dokładny czas zależy od zakresu i złożoności projektu." },
      { q: "Czy zajmujecie się też fotowoltaiką?", a: "Tak, montujemy panele fotowoltaiczne, magazyny energii i pompy ciepła. Pomagamy też w formalnościach związanych z przyłączeniem do sieci i dotacjami." },
    ],
    selectOptions: ["Instalacja elektryczna w nowym domu", "Remont instalacji", "Oświetlenie", "Smart home / automatyka", "Fotowoltaika / pompa ciepła", "Inne"],
  },

  plumber: {
    heroHeadline: "Sprawna hydraulika.",
    heroHeadlineEm: "Ciepło w domu.",
    heroLead: "Instalacje hydrauliczne, ogrzewanie, kanalizacja. Pracujemy szybko, czysto i z gwarancją. Rozmawia z Państwem bezpośrednio właściciel firmy — bez pośredników.",
    services: [
      { title: "Instalacje hydrauliczne", description: "Woda zimna i ciepła, rury, zawory, podejścia. Nowe instalacje i wymiana starych. Materiały sprawdzonych marek.", icon: ICON_TOOL },
      { title: "Ogrzewanie podłogowe", description: "Projekty i montaż ogrzewania podłogowego. Wodne i elektryczne. Równomierne ciepło w całym domu, niższe rachunki.", icon: ICON_HOME },
      { title: "Łazienki pod klucz", description: "Kompleksowe remonty łazienek — od hydrauliki po glazurę. Kabiny prysznicowe, wanny, armatura. Jeden wykonawca, zero stresu.", icon: ICON_GRID },
      { title: "Kanalizacja", description: "Instalacje kanalizacyjne, przyłącza, drenaże, szamba. Udrażnianie rur kamerą inspekcyjną. Szybka diagnostyka i naprawa.", icon: ICON_LIST },
      { title: "Kotły i piece", description: "Montaż i serwis kotłów gazowych, na pellet, pomp ciepła. Wymiana starych źródeł ciepła z dotacją z programu Czyste Powietrze.", icon: ICON_BOLT },
      { title: "Awarie i naprawy", description: "Szybka reakcja na awarie hydrauliczne. Przecieki, pęknięte rury, niedziałające ogrzewanie. Dojeżdżamy tego samego dnia.", icon: ICON_TOOL },
    ],
    trustItems: ["Licencjonowany hydraulik", "Ubezpieczenie OC", "Gwarancja na instalacje", "Serwis awaryjny"],
    aboutHeadline: "Solidna hydraulika.",
    aboutHeadlineEm: "Od lat w branży.",
    aboutP1: "Specjalizujemy się w instalacjach wodno-kanalizacyjnych i grzewczych. Od nowych domów po remonty łazienek — robimy wszystko, co wiąże się z wodą i ciepłem w domu.",
    aboutP2: "Pracujemy bez pośredników, z własną ekipą. Każda instalacja jest wykonana zgodnie z normami i zakończona gwarancją. Nasi klienci cenią nas za terminowość i czystość na budowie.",
    aboutQuote: "Dobra hydraulika to taka, której nie widać i nie słychać. Po prostu działa — cicho i niezawodnie.",
    faqItems: [
      { q: "Czy przyjeżdżacie na awarię w weekend?", a: "Tak, w nagłych przypadkach (zalanie, pękniecie rury) dojeżdżamy też w weekendy. Czas reakcji to zwykle 1-3 godziny w obrębie miasta." },
      { q: "Ile kosztuje remont łazienki?", a: "Koszt zależy od metrażu i zakresu prac. Typowa łazienka 5-8 m² to zwykle 15 000-30 000 zł z materiałami. Dokładną wycenę przygotowujemy po oględzinach." },
      { q: "Czy pomagacie z dotacją Czyste Powietrze?", a: "Tak, pomagamy w doborze urządzeń kwalifikujących się do dotacji i przygotowaniu dokumentacji. Montujemy kotły, pompy ciepła i instalacje solarne." },
      { q: "Jak długo trwa montaż ogrzewania podłogowego?", a: "W domu jednorodzinnym 120-180 m² montaż ogrzewania podłogowego to zwykle 3-5 dni roboczych (bez wylewki). Z wylewką — dodatkowe 1-2 dni." },
      { q: "Czy dajecie gwarancję na instalacje?", a: "Tak, na wszystkie instalacje dajemy minimum 2 lata gwarancji. Na elementy jak kotły czy pompy ciepła obowiązuje dodatkowo gwarancja producenta (5-10 lat)." },
    ],
    selectOptions: ["Instalacja hydrauliczna", "Remont łazienki", "Ogrzewanie podłogowe", "Wymiana kotła / pompa ciepła", "Awaria / naprawa", "Inne"],
  },

  painter: {
    heroHeadline: "Kolory Twojego domu.",
    heroHeadlineEm: "Profesjonalne malowanie.",
    heroLead: "Malowanie wnętrz, elewacje, gładzie, tapetowanie. Czysta robota, terminowość i dbałość o detal. Rozmawia z Państwem bezpośrednio właściciel firmy.",
    services: [
      { title: "Malowanie wnętrz", description: "Ściany, sufity, elementy drewniane. Farby premium (Dulux, Śnieżka, Caparol). Przygotowanie powierzchni, gruntowanie, dwie warstwy.", icon: ICON_HOME },
      { title: "Gładzie gipsowe", description: "Gładzie na surowych ścianach, szpachlowanie nierówności, naprawa pęknięć. Idealnie gładka powierzchnia pod malowanie.", icon: ICON_GRID },
      { title: "Elewacje", description: "Malowanie i odnawianie elewacji. Tynki dekoracyjne, mycie ciśnieniowe, naprawa ubytków. Nowy wygląd budynku na lata.", icon: ICON_ROOF },
      { title: "Tapetowanie", description: "Montaż tapet winylowych, flizelinowych i tekstylnych. Precyzyjne dopasowanie wzorów, czyste krawędzie, trwały efekt.", icon: ICON_LIST },
      { title: "Dekoracje ścienne", description: "Efekty dekoracyjne, tynki strukturalne, beton architektoniczny, panele 3D. Unikalne wykończenie, które wyróżnia wnętrze.", icon: ICON_TOOL },
      { title: "Malowanie przemysłowe", description: "Hale, biura, lokale usługowe. Szybka realizacja, praca w godzinach nocnych na życzenie. Minimum przestojów w działalności.", icon: ICON_BOLT },
    ],
    trustItems: ["Farby premium klasy", "Ubezpieczenie OC", "Czysta robota", "Gwarancja na każdą pracę"],
    aboutHeadline: "Precyzja i detal.",
    aboutHeadlineEm: "W każdym pociągnięciu pędzla.",
    aboutP1: "Specjalizujemy się w profesjonalnym malowaniu wnętrz i elewacji. Pracujemy wyłącznie farbami klasy premium — bo tanie farby to fałszywa oszczędność.",
    aboutP2: "Każdą pracę traktujemy jak własny dom. Zabezpieczamy podłogi i meble, pracujemy czysto i zostawiamy po sobie porządek. Nasi klienci cenią nas za dbałość o detal.",
    aboutQuote: "Dobrze pomalowana ściana to taka, na której nie widać, że ktoś ją malował. Po prostu wygląda idealnie.",
    faqItems: [
      { q: "Jakimi farbami pracujecie?", a: "Używamy wyłącznie farb klasy premium: Dulux, Śnieżka Magnat, Caparol, Tikurilla. Klient może też dostarczyć własne farby — wyceniamy wtedy tylko robociznę." },
      { q: "Czy zabezpieczacie meble i podłogi?", a: "Tak, zawsze. Przed rozpoczęciem pracy zakrywamy folią wszystkie meble, podłogi i elementy, które nie są malowane. Po pracy zostawiamy porządek." },
      { q: "Ile kosztuje malowanie mieszkania?", a: "Typowe mieszkanie 50-70 m² to koszt 3 000-6 000 zł za robociznę (bez farb). Dokładna wycena po oględzinach — zależy od stanu ścian i zakresu przygotowania." },
      { q: "Jak długo trwa malowanie mieszkania?", a: "Mieszkanie 50-70 m² to zwykle 3-5 dni roboczych (z gruntowaniem i dwiema warstwami). Jeśli potrzebne są gładzie — dodatkowe 2-3 dni." },
      { q: "Czy robicie też elewacje?", a: "Tak, malujemy i odnawiamy elewacje domów jednorodzinnych i budynków wielorodzinnych. Dysponujemy rusztowaniami do wysokości 12 metrów." },
    ],
    selectOptions: ["Malowanie mieszkania", "Malowanie domu", "Gładzie gipsowe", "Elewacja", "Tapetowanie", "Inne"],
  },

  roofing_contractor: {
    heroHeadline: "Solidny dach.",
    heroHeadlineEm: "Na pokolenia.",
    heroLead: "Pokrycia dachowe, więźba, obróbki blacharskie, rynny. Pracujemy z materiałami najwyższej jakości i dajemy wieloletnią gwarancję. Rozmawia z Państwem bezpośrednio właściciel firmy.",
    services: [
      { title: "Dachy od podstaw", description: "Kompletna budowa dachu: więźba, membrana, łaty, pokrycie, obróbki. Dachówka ceramiczna, blachodachówka, blacha na rąbek.", icon: ICON_ROOF },
      { title: "Wymiana pokrycia", description: "Demontaż starego pokrycia, naprawa więźby, nowe łaty i kontrłaty, montaż nowego pokrycia. Bez uciążliwości dla domowników.", icon: ICON_HOME },
      { title: "Obróbki blacharskie", description: "Kominy, okna dachowe, ściany attykowe, pasy nadrynnowe. Precyzyjne obróbki z blachy powlekanej lub miedzianej.", icon: ICON_GRID },
      { title: "Rynny i odprowadzenie wody", description: "Montaż i wymiana rynien, rur spustowych, podbitek dachowych. Systemy Ruukki, Galeco, Marley. Sprawne odprowadzenie wody.", icon: ICON_LIST },
      { title: "Izolacja dachu", description: "Ocieplenie poddasza wełną mineralną, pianką PUR lub celulozą. Montaż paraizolacji i membrany. Ciepło w domu, niższe rachunki.", icon: ICON_TOOL },
      { title: "Przeglądy i naprawy", description: "Przeglądy stanu dachu, uszczelnianie przecieków, wymiana uszkodzonych dachówek. Szybka reakcja po burzach i wichurach.", icon: ICON_BOLT },
    ],
    trustItems: ["Pełne uprawnienia budowlane", "Ubezpieczenie OC", "Materiały premium", "5 lat gwarancji na pokrycie"],
    aboutHeadline: "Rodzinna firma dekarska.",
    aboutHeadlineEm: "Trzecie pokolenie na dachu.",
    aboutP1: "Specjalizujemy się w pokryciach dachowych i obróbkach blacharskich. Od nowych dachów po naprawy — pracujemy z materiałami najwyższej jakości od sprawdzonych producentów.",
    aboutP2: "Każdy dach traktujemy jak własny. Pracujemy bezpiecznie, terminowo i zostawiamy po sobie porządek. Nasi klienci polecają nas dalej — bo solidna praca mówi sama za siebie.",
    aboutQuote: "Dobry dach to taki, o którym zapominasz na dwadzieścia lat. My budujemy właśnie takie dachy.",
    faqItems: [
      { q: "Z jakich materiałów pracujecie?", a: "Pracujemy z dachówką ceramiczną (Wienerberger, Creaton, Roben), blachodachówką (Ruukki, Blachotrapez) i blachą na rąbek. Dobieramy materiał do projektu i budżetu klienta." },
      { q: "Ile kosztuje nowy dach?", a: "Koszt zależy od metrażu, kształtu dachu i materiału. Orientacyjnie: 250-450 zł/m² za robociznę z materiałem (blachodachówka) lub 350-600 zł/m² (dachówka ceramiczna)." },
      { q: "Jak długo trwa wymiana dachu?", a: "Typowy dach dwuspadowy 150-200 m² to 7-14 dni roboczych. Dachy wielospadowe lub z dużą liczbą okien mogą trwać dłużej. Harmonogram ustalamy przed startem." },
      { q: "Czy naprawiacie też przecieki?", a: "Tak, lokalizujemy i usuwamy przecieki. Dysponujemy kamerą termowizyjną do precyzyjnego znalezienia miejsca nieszczelności bez zbędnego rozbierania pokrycia." },
      { q: "Jakie gwarancje dajecie?", a: "5 lat gwarancji na pokrycie dachowe i obróbki, 2 lata na rynny i podbitki. Materiały objęte są dodatkowo gwarancjami producenta (15-30 lat na dachówkę ceramiczną)." },
    ],
    selectOptions: ["Nowy dach", "Wymiana pokrycia", "Naprawa / przeciek", "Rynny i obróbki", "Izolacja poddasza", "Inne"],
  },

  general_contractor: {
    heroHeadline: "Budujemy solidnie.",
    heroHeadlineEm: "Od fundamentów po klucz.",
    heroLead: "Kompleksowe usługi budowlane: domy, remonty, wykończenia. Własna ekipa, sprawdzone materiały, terminowość. Rozmawia z Państwem bezpośrednio właściciel firmy.",
    services: [
      { title: "Stan surowy zamknięty", description: "Kompleksowe stawianie budynków od fundamentów po dach. Domy jednorodzinne, obiekty komercyjne i agroturystyczne.", icon: ICON_HOME },
      { title: "Wykończenia wnętrz", description: "Tynki, posadzki, malowanie, montaż wykończeniowy. Pracujemy z architektem klienta lub własnym — pod klucz.", icon: ICON_GRID },
      { title: "Dachy", description: "Pokrycia dachowe, więźba, obróbki blacharskie. Materiały od sprawdzonych producentów (Wienerberger, Creaton).", icon: ICON_ROOF },
      { title: "Elewacje", description: "Ocieplenia, tynki elewacyjne, kamień, klinkier. Zwiększamy estetykę i izolacyjność. Cieplej i taniej w utrzymaniu.", icon: ICON_LIST },
      { title: "Remonty", description: "Remonty mieszkań, domów i lokali użytkowych. Od jednej ściany po kompleksową przebudowę z wyburzeniami.", icon: ICON_TOOL },
      { title: "Instalacje", description: "Hydraulika, elektryka, ogrzewanie. Współpraca ze sprawdzonymi, lokalnymi specjalistami. Wszystko z jednej ręki.", icon: ICON_BOLT },
    ],
    trustItems: ["Pełne uprawnienia budowlane", "Ubezpieczenie OC do 1 mln zł", "Umowa pisemna z harmonogramem", "5 lat gwarancji na konstrukcję"],
    aboutHeadline: "Rodzinna firma budowlana.",
    aboutHeadlineEm: "Trzecie pokolenie w branży.",
    aboutP1: "Realizujemy budowy domów jednorodzinnych i remonty. Posiadamy pełne uprawnienia budowlane, ubezpieczenie OC i własną ekipę sprawdzonych fachowców.",
    aboutP2: "Pracujemy bez pośredników. Z Państwem rozmawia bezpośrednio właściciel. Każdą budowę traktujemy jak własną — bo nasi klienci często są naszymi sąsiadami.",
    aboutQuote: "Solidna budowa to nie przypadek. To plan, materiał i ludzie, którym ufasz.",
    faqItems: [
      { q: "Czy macie uprawnienia budowlane?", a: "Tak. Posiadamy pełne uprawnienia konstrukcyjno-budowlane, wpis do Izby Inżynierów Budownictwa, ubezpieczenie OC do 1 mln zł." },
      { q: "Jak wygląda wycena?", a: "Wycena jest bezpłatna. Spotykamy się na miejscu, oglądamy i przygotowujemy szczegółowy kosztorys w ciągu 5 dni roboczych." },
      { q: "Czy podpisujemy umowę?", a: "Zawsze. Umowa pisemna z harmonogramem, kosztorysem materiałowym i gwarancjami. Nigdy nie pracujemy na słowo." },
      { q: "Ile trwa budowa domu?", a: "Stan surowy zamknięty: 4-6 miesięcy. Pod klucz z wykończeniem: 9-12 miesięcy. Dokładny harmonogram opracowujemy przed podpisaniem umowy." },
      { q: "Jakie gwarancje dajecie?", a: "5 lat na konstrukcję, 2 lata na wykończenia wnętrz, 5 lat na pokrycie dachowe. Materiały objęte gwarancjami producenta." },
    ],
    selectOptions: ["Budowa domu od zera", "Wykończenie wnętrz", "Remont / przebudowa", "Dach / elewacja", "Inne"],
  },
};
