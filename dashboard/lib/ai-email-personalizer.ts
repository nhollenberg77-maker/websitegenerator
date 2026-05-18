// AI Email-personalisatie agent.
// Vult Polish branża/niche + hero-title/sub voor de mail-template,
// opgeslagen in lead.ai_email als JSON.

import type Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./types";
import { callAiJson, AI_MODEL_TEXT } from "./ai";

export interface EmailPersonalization {
  branza_pl: string;
  nisza_pl: string;
  hero_title: string;
  hero_sub: string;
  hero_cta: string;
  firma_krotka: string;
}

const SYSTEM_PROMPT = `Jesteś copywriterem dla agencji tworzącej strony internetowe dla polskich firm budowlanych.
Twoje zadanie: na podstawie informacji o firmie wygenerować krótkie, naturalne polskie teksty do maila i kart podglądu strony.

Zasady:
- branza_pl: jaka to branża, jako rzeczownik w dopełniaczu liczby mnogiej (np. "instalatorów hydraulicznych", "dekarzy", "elektryków")
- nisza_pl: konkretna specjalizacja w lokativie (np. "wymianie wodomierzy i ciepłomierzy", "pokryciach dachowych", "fotowoltaice")
- hero_title: 4-7 słów po polsku, opisujące główną usługę w mieście. Np. "Wymiana wodomierza w Krakowie" lub "Profesjonalne dekarstwo w Wadowicach". Bez wykrzykników.
- hero_sub: 6-12 słów, konkretne usługi rozdzielone przecinkami + miasto. Np. "Montaż, legalizacja i plombowanie — Kraków i okolice."
- hero_cta: 1-3 słowa, np. "Zobacz ofertę", "Bezpłatna wycena", "Skontaktuj się"
- firma_krotka: krótka wersja nazwy firmy (max 20 znaków), bez form prawnych ("Sp. z o.o.", "FHU", "S.A."). Np. "NIKLA", "PLUS AQUA", "GAZ-SERWIS".

Wszystko po polsku, naturalnie, bez wodolejstwa. Zwróć tylko JSON.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["branza_pl", "nisza_pl", "hero_title", "hero_sub", "hero_cta", "firma_krotka"],
  properties: {
    branza_pl: { type: "string" },
    nisza_pl: { type: "string" },
    hero_title: { type: "string" },
    hero_sub: { type: "string" },
    hero_cta: { type: "string" },
    firma_krotka: { type: "string" },
  },
};

export async function personalizeEmailForLead(lead: Lead): Promise<EmailPersonalization | null> {
  const userParts: string[] = [
    `Firma: ${lead.name}`,
    `Miasto: ${lead.city_query || "Polska"}`,
    `Województwo: ${lead.voivodeship || "?"}`,
    `Kategoria Google: ${lead.category_query || "?"}`,
  ];
  if (lead.primary_type) userParts.push(`Typ: ${lead.primary_type}`);
  if (lead.types) {
    try {
      const ts = JSON.parse(lead.types);
      if (Array.isArray(ts) && ts.length) userParts.push(`Tags: ${ts.slice(0, 6).join(", ")}`);
    } catch { /* ignore */ }
  }
  if (lead.rating && lead.rating_count) {
    userParts.push(`Rating: ${lead.rating}/5 (${lead.rating_count} opinii)`);
  }
  if (lead.description) userParts.push(`Opis Google: ${lead.description.slice(0, 400)}`);
  if (lead.website) userParts.push(`Strona: ${lead.website}`);

  const userContent: Anthropic.ContentBlockParam[] = [
    { type: "text", text: userParts.join("\n") },
    { type: "text", text: "Wygeneruj teksty zgodnie z regułami. Zwróć tylko JSON." },
  ];

  const { data } = await callAiJson<EmailPersonalization>({
    model: AI_MODEL_TEXT,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    schema: SCHEMA,
    maxTokens: 2000,
  });

  return data;
}
