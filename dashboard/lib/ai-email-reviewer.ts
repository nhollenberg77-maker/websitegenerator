// AI Email-review agent.
// Krijgt subject + HTML-body en check op fouten/rare formuleringen/broken merge-fields.

import type Anthropic from "@anthropic-ai/sdk";
import type { Lead } from "./types";
import { callAiJson, AI_MODEL_TEXT } from "./ai";

export interface EmailReview {
  pass: boolean;
  score: number; // 1-10
  issues: { severity: "low" | "medium" | "high"; description: string }[];
}

const SYSTEM_PROMPT = `Jesteś krytycznym redaktorem polskich maili sprzedażowych.
Twoje zadanie: sprawdzić wygenerowanego maila i zwrócić ocenę.

Sprawdź:
1. **Polski**: poprawność gramatyczna, naturalne sformułowania, brak literówek, brak rusycyzmów/anglicyzmów. Każde słowo powinno brzmieć jak napisane przez native speakera.
2. **Spersonalizowanie**: czy nazwa firmy, miasto, branża są poprawnie wstawione i mają sens razem
3. **Placeholdery**: BRAK pozostałości typu "{{FIRMA}}", "{{MIASTO}}", "undefined", "null", "[object Object]"
4. **Linki i CTA**: czy mailto / preview link wydają się poprawne (nie pusta strona, nie błędny adres)
5. **Ton**: profesjonalny, nie nachalny, bez clickbaitu czy ekscentrycznych zwrotów

Ocena 1-10:
- 9-10: można wysłać
- 7-8: drobne uwagi
- 5-6: problemy, naprawić przed wysłaniem
- 1-4: nie wysyłać

Zwróć JSON. issues: lista problemów. pass=true gdy score >= 7.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pass", "score", "issues"],
  properties: {
    pass: { type: "boolean" },
    score: { type: "integer" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "description"],
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          description: { type: "string" },
        },
      },
    },
  },
};

export async function reviewEmailForLead(lead: Lead, subject: string, html: string): Promise<EmailReview | null> {
  // Strip HTML naar plain text (rough — voldoende voor review)
  const plainText = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

  const userContent: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Firma docelowa: ${lead.name}\nMiasto: ${lead.city_query || "?"}\nBranża: ${lead.category_query || "?"}\n\nTEMAT MAILA:\n${subject}\n\nTREŚĆ MAILA (plain text):\n${plainText.slice(0, 6000)}`,
    },
    { type: "text", text: "Oceń maila zgodnie z regułami. Zwróć tylko JSON." },
  ];

  const { data } = await callAiJson<EmailReview>({
    model: AI_MODEL_TEXT,
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    schema: SCHEMA,
    maxTokens: 3000,
  });

  return data;
}
