// AI Foto-curator agent.
// Input : lead's Google Places foto-URLs
// Output: JSON met hero_photo_index, gallery_photo_indices, about_photo_index,
//         skip_photo_indices, notes — opgeslagen in lead.ai_polish

import type Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./types";
import { callAiJson, photoUrlWithKey, AI_MODEL_VISION } from "./ai";

export interface PhotoCuration {
  hero_photo_index: number | null;
  gallery_photo_indices: number[];
  about_photo_index: number | null;
  skip_photo_indices: number[];
  notes: string;
}

const SYSTEM_PROMPT = `Jesteś ekspertem od projektowania stron internetowych dla polskich firm budowlanych i instalacyjnych.
Twoje zadanie: ocenić zestaw zdjęć z profilu Google Business Profile firmy i wybrać które zdjęcia użyć i gdzie.

Reguły:
- HERO (główne zdjęcie na górze strony): najbardziej profesjonalne, wysokiej jakości, pokazujące pracę firmy lub gotowy obiekt. Nie selfie, nie zdjęcia produktu/opakowania, nie napisy.
- GALERIA: 3-6 zdjęć pokazujących realizacje, pracę, sprzęt. Różnorodne, w dobrej jakości.
- O NAS (about_photo): jeden portret zespołu / wnętrza firmy / front budynku — jeśli dostępny, w innym wypadku null.
- POMIŃ (skip): logo, zdjęcia tekstu, niskiej jakości, rozmyte, niezwiązane z branżą, prywatne zdjęcia, duplikaty.

Zwróć JSON z indeksami od 0. Każdy indeks może być użyty tylko raz (lub w skip).
W notes wytłumacz krótko po polsku dlaczego wybrałeś hero (1-2 zdania).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hero_photo_index", "gallery_photo_indices", "about_photo_index", "skip_photo_indices", "notes"],
  properties: {
    hero_photo_index: { type: ["integer", "null"] },
    gallery_photo_indices: { type: "array", items: { type: "integer" } },
    about_photo_index: { type: ["integer", "null"] },
    skip_photo_indices: { type: "array", items: { type: "integer" } },
    notes: { type: "string" },
  },
};

/**
 * Past de AI-curation toe op een lijst foto-URLs.
 * Resultaat: [hero, ...gallery, about, ...rest_niet_skipped]
 * Als ai_polish ontbreekt of niet parsebaar is, retourneert de originele lijst.
 */
export function applyPhotoCuration(photoUrls: string[], aiPolishJson: string | null | undefined): string[] {
  if (!aiPolishJson || photoUrls.length === 0) return photoUrls;
  let curation: PhotoCuration;
  try {
    curation = JSON.parse(aiPolishJson) as PhotoCuration;
  } catch {
    return photoUrls;
  }

  const skip = new Set(curation.skip_photo_indices || []);
  const used = new Set<number>();
  const ordered: string[] = [];

  const pushIdx = (idx: number | null | undefined) => {
    if (idx === null || idx === undefined) return;
    if (used.has(idx) || skip.has(idx)) return;
    if (!photoUrls[idx]) return;
    ordered.push(photoUrls[idx]);
    used.add(idx);
  };

  pushIdx(curation.hero_photo_index);
  for (const idx of curation.gallery_photo_indices || []) pushIdx(idx);
  pushIdx(curation.about_photo_index);
  for (let i = 0; i < photoUrls.length; i++) {
    if (!used.has(i) && !skip.has(i)) {
      ordered.push(photoUrls[i]);
      used.add(i);
    }
  }

  return ordered.length > 0 ? ordered : photoUrls;
}

export async function curatePhotosForLead(lead: Lead): Promise<PhotoCuration | null> {
  if (!lead.photo_urls) return null;
  let urls: string[];
  try {
    urls = JSON.parse(lead.photo_urls) as string[];
  } catch {
    return null;
  }
  if (!Array.isArray(urls) || urls.length === 0) return null;

  // Cap op 8 foto's voor lagere vision-kosten
  const limited = urls.slice(0, 8);

  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Firma: ${lead.name}\nMiasto: ${lead.city_query || "?"}\nBranża: ${lead.category_query || "?"}\n\nPoniżej ${limited.length} zdjęć (numerowane od 0):`,
    },
  ];

  limited.forEach((u, i) => {
    userContent.push({ type: "text", text: `Zdjęcie ${i}:` });
    userContent.push({
      type: "image",
      source: { type: "url", url: photoUrlWithKey(u, 1200) },
    });
  });

  userContent.push({
    type: "text",
    text: "Wybierz role dla każdego zdjęcia zgodnie z regułami. Zwróć tylko JSON.",
  });

  const { data } = await callAiJson<PhotoCuration>({
    model: AI_MODEL_VISION,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    schema: SCHEMA,
    maxTokens: 2000,
  });

  return data;
}
