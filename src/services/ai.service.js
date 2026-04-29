const { GoogleGenerativeAI } = require("@google/generative-ai");
const Fuse = require("fuse.js");
const Entity = require("../models/entity.model");

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EXTRACTION_SYSTEM_PROMPT = `Extract entities and events from news articles. Return a JSON array.

Each item:
- entity_key: lowercase name_type ("tesla_company", "elon_musk_person"). Normalize aliases to one key. Disambiguate same names by type.
- display_name: human-readable ("Tesla", "Elon Musk")
- event_text: one sentence
- event_category: earnings|expansion|regulation|funding|legal|product|partnership|leadership|policy|market|other
- impact_score: -5 to +5 integer
- reasoning: one sentence
- is_macro: true if event affects entire sector/industry
- article_index: which article (0-based) this extraction came from

Return a JSON array only. Empty array if nothing found.`;

const MOOD_SYSTEM_PROMPT = `Write an email subject and mood summary for a daily market digest.

Given events with entity names and scores, return JSON:
{ "subject_line": "under 60 chars, punchy, no emojis", "mood_summary": "one casual sentence" }

Return JSON only.`;

const BATCH_SIZE = 10;
const MODEL_NAME = "gemini-3.1-flash-lite-preview";

/**
 * Retry a function with exponential backoff.
 * @param {Function} fn - async function to retry
 * @param {number} maxRetries - max attempts (default 3)
 * @param {number} baseDelay - starting delay in ms (default 10000 = 10s)
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 10000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;

      const delay = baseDelay * Math.pow(2, attempt - 1); // 10s, 20s, 40s
      console.warn(`Retry ${attempt}/${maxRetries} after ${delay / 1000}s — ${error.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

const aiService = {
  /**
   * Format multiple articles into a single prompt.
   */
  buildBatchPrompt(articles) {
    return articles
      .map(
        (a, i) =>
          `[Article ${i}]\nTitle: ${a.title}${a.body ? `\nBody: ${a.body}` : ""}`
      )
      .join("\n\n---\n\n");
  },

  /**
   * Parse and validate extraction JSON from Gemini.
   */
  parseAIResponse(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.error("AI parse error:", err.message);
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const required = [
      "entity_key",
      "display_name",
      "event_text",
      "event_category",
      "impact_score",
      "reasoning",
    ];

    return parsed
      .filter((item) => {
        const valid = required.every(
          (f) => item[f] !== undefined && item[f] !== null
        );
        if (!valid) return false;

        const score = Number(item.impact_score);
        if (!Number.isInteger(score) || score < -5 || score > 5) return false;

        return true;
      })
      .map((item) => ({
        entity_key: String(item.entity_key).toLowerCase().trim(),
        display_name: String(item.display_name).trim(),
        event_text: String(item.event_text).trim(),
        event_category: String(item.event_category).toLowerCase().trim(),
        impact_score: Number(item.impact_score),
        reasoning: String(item.reasoning).trim(),
        is_macro: Boolean(item.is_macro),
        article_index: Number(item.article_index) || 0,
      }));
  },

  /**
   * Extract entities/events from a single article.
   */
  async extractFromArticle(article) {
    const results = await this.extractFromArticles([article]);
    return results[0] || [];
  },

  /**
   * Extract entities/events from multiple articles in one API call.
   */
  async extractFromArticles(articles) {
    if (!articles || articles.length === 0) return [];

    const results = new Array(articles.length).fill(null).map(() => []);

    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: EXTRACTION_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const batchOffset = i;

      try {
        const userMessage = this.buildBatchPrompt(batch);

        const responseText = await retryWithBackoff(async () => {
          const result = await model.generateContent(userMessage);
          return result.response.text();
        });

        const extractions = this.parseAIResponse(responseText);

        for (const ext of extractions) {
          const localIndex = ext.article_index;
          const globalIndex = batchOffset + localIndex;

          if (globalIndex >= 0 && globalIndex < articles.length) {
            const { article_index, ...extraction } = ext;
            results[globalIndex].push(extraction);
          }
        }
      } catch (error) {
        console.error(
          `Batch extraction error (articles ${batchOffset}-${batchOffset + batch.length - 1}):`,
          error.message
        );
      }
    }
    await new Promise(r => setTimeout(r, 6000));
    return results;
  },

  /**
   * Generate mood summary + subject line from matched events.
   */
  async composeMoodSummary(events) {
    if (!events || events.length === 0) {
      return {
        subject_line: "Your daily digest — quiet day",
        mood_summary: "Nothing major today across your watchlist.",
      };
    }

    try {
      const eventLines = events
        .map(
          (e) =>
            `${e.display_name} (${e.impact_score > 0 ? "+" : ""}${e.impact_score}): ${e.event_text}`
        )
        .join("\n");

      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: MOOD_SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
        },
      });

      const parsed = await retryWithBackoff(async () => {
        const result = await model.generateContent(eventLines);
        return JSON.parse(result.response.text());
      });

      return {
        subject_line: String(parsed.subject_line || "Your daily digest").slice(0, 80),
        mood_summary: String(parsed.mood_summary || "Here's what happened today."),
      };
    } catch (error) {
      console.error("Mood summary error:", error.message);
      return {
        subject_line: "Your daily digest",
        mood_summary: "Here's what happened today.",
      };
    }
  },

  /**
   * Single Gemini call: normalize free text watchlist + assign macro groups.
   * Fuzzy-matches terms against existing entities first; sends candidates to
   * Gemini so it can reuse them instead of always creating new keys.
   */
  async normalizeAndAssignWatchlist(freeText, macroGroups) {
    if (!freeText || !freeText.trim()) return [];

    const existingEntities = await Entity.find(
      {},
      { entity_key: 1, display_name: 1, _id: 0 }
    ).lean();

    const terms = freeText
      .split(/[,\n]+/)
      .map(t => t.trim())
      .filter(Boolean);

    const candidateMap = {};
    const freshTerms = [];

    if (existingEntities.length > 0) {
      const fuse = new Fuse(existingEntities, {
        keys: ["display_name"],
        includeScore: true,
        threshold: 0.5,
      });

      for (const term of terms) {
        const hits = fuse.search(term).slice(0, 5);
        const candidates = hits.map(h => ({
          entity_key: h.item.entity_key,
          display_name: h.item.display_name,
          score: Math.round((1 - h.score) * 100),
        }));

        if (candidates.length > 0) {
          candidateMap[term] = candidates;
        } else {
          freshTerms.push(term);
        }
      }
    } else {
      freshTerms.push(...terms);
    }

    const groupList = macroGroups
      .map(g => `${g.group_key} — ${g.display_name}`)
      .join("\n");

    const candidateBlock = Object.entries(candidateMap)
      .map(([term, candidates]) => {
        const lines = candidates
          .map(c => `  - ${c.entity_key} (${c.display_name}) [${c.score}% match]`)
          .join("\n");
        return `Term: "${term}"\n${lines}`;
      })
      .join("\n\n");

    const freshBlock = freshTerms.map(t => `- ${t}`).join("\n");

    const systemPrompt = `You normalize user watchlist text into entities and assign macro groups.

For each input term, return a JSON array (max 5 items total):
[{
  "entity_key": "lowercase_name_type",
  "display_name": "Human Readable Name",
  "macro_group_keys": ["matching_group_key"]
}]

entity_key rules:
- lowercase, format: name_type
- types: company, person, commodity, organization, sector, index, currency
- normalize aliases: 'Reliance', 'RIL', 'Reliance Industries' → 'reliance_company'
- disambiguate: 'Tesla' company vs 'Tesla' person

CANDIDATE MATCHING RULES:
- For terms that have EXISTING CANDIDATES listed below, pick the best match if it represents the same entity
- If none of the candidates are a good match, create a new entity_key
- For terms with NO CANDIDATES, create a fresh entity_key

--- TERMS WITH EXISTING CANDIDATES ---
${candidateBlock || "(none)"}

--- TERMS WITH NO EXISTING MATCH ---
${freshBlock || "(none)"}

macro_group_keys rules:
- pick ONLY from the approved list below
- assign all relevant groups per entity (usually 1-3)
- empty array if no group fits

APPROVED MACRO GROUPS:
${groupList}

Return JSON array only. Max 5 entities.`;

    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: "application/json" },
      });

      const parsed = await retryWithBackoff(async () => {
        const result = await model.generateContent(freeText.trim());
        return JSON.parse(result.response.text());
      });

      if (!Array.isArray(parsed)) return [];

      const validGroupKeys = new Set(macroGroups.map(g => g.group_key));

      console.log("Normalization complete");
      return parsed
        .filter(item => item.entity_key && item.display_name)
        .slice(0, 5)
        .map(item => ({
          entity_key: String(item.entity_key).toLowerCase().trim(),
          display_name: String(item.display_name).trim(),
          macro_group_keys: Array.isArray(item.macro_group_keys)
            ? item.macro_group_keys.filter(k => validGroupKeys.has(k))
            : [],
        }));
    } catch (error) {
      console.error("normalizeAndAssignWatchlist error:", error.message);
      return [];
    }
  },

  /**
   * Resolve extracted entities against existing ones using fuzzy + Gemini.
   */
  async resolveExtractedEntities(extractions, fuseIndex) {
    if (!fuseIndex || !extractions || extractions.length === 0) return extractions;

    const uniqueKeys = {};
    for (const ext of extractions) {
      if (!uniqueKeys[ext.entity_key]) {
        uniqueKeys[ext.entity_key] = ext.display_name;
      }
    }

    const toResolve = [];
    const alreadyResolved = {};

    for (const [key, displayName] of Object.entries(uniqueKeys)) {
      const hits = fuseIndex.search(displayName).slice(0, 5);
      const candidates = hits
        .filter(h => (1 - h.score) >= 0.5)
        .map(h => ({
          entity_key: h.item.entity_key,
          display_name: h.item.display_name,
          score: Math.round((1 - h.score) * 100),
        }));

      if (candidates.some(c => c.entity_key === key)) {
        alreadyResolved[key] = { entity_key: key, display_name: displayName };
      } else if (candidates.length > 0) {
        toResolve.push({ original_key: key, display_name: displayName, candidates });
      } else {
        alreadyResolved[key] = { entity_key: key, display_name: displayName };
      }
    }

    if (toResolve.length === 0) return extractions;

    const resolveBlock = toResolve
      .map(r => {
        const candidateLines = r.candidates
          .map(c => `  - ${c.entity_key} (${c.display_name}) [${c.score}%]`)
          .join("\n");
        return `New: "${r.display_name}" (${r.original_key})\nExisting candidates:\n${candidateLines}`;
      })
      .join("\n\n");

    const systemPrompt = `You resolve entity duplicates. For each "New" entity below, decide:
- If an existing candidate is the SAME entity, return the existing entity_key and display_name
- If none match (different entity), return the new entity_key and display_name

Return a JSON array:
[{ "original_key": "the_new_key", "resolved_key": "picked_key", "resolved_name": "Picked Name" }]

Return JSON array only.`;

    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: "application/json" },
      });

      const parsed = await retryWithBackoff(async () => {
        const result = await model.generateContent(resolveBlock);
        return JSON.parse(result.response.text());
      });

      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (r.original_key && r.resolved_key) {
            alreadyResolved[r.original_key] = {
              entity_key: String(r.resolved_key).toLowerCase().trim(),
              display_name: String(r.resolved_name || r.resolved_key).trim(),
            };
          }
        }
      }
    } catch (error) {
      console.error("resolveExtractedEntities error:", error.message);
    }

    for (const r of toResolve) {
      if (!alreadyResolved[r.original_key]) {
        alreadyResolved[r.original_key] = {
          entity_key: r.original_key,
          display_name: r.display_name,
        };
      }
    }

    return extractions.map(ext => {
      const resolved = alreadyResolved[ext.entity_key];
      if (resolved) {
        return { ...ext, entity_key: resolved.entity_key, display_name: resolved.display_name };
      }
      return ext;
    });
  },

  /**
   * Assign macro groups to entities that don't have any.
   * Single Gemini call per batch of 50 entities.
   */
  async assignMacroGroupsBatch(entities, macroGroups) {
    if (!entities || entities.length === 0) return [];

    const groupList = macroGroups
      .map(g => `${g.group_key} — ${g.display_name}: ${g.description}`)
      .join("\n");

    const entityList = entities
      .map(e => `- ${e.entity_key} (${e.display_name})`)
      .join("\n");

    const systemPrompt = `You assign macro groups to entities.

For each entity below, pick the most relevant macro groups from the approved list.
Each entity should get 1-3 groups. Empty array only if absolutely nothing fits.

Return a JSON array:
[{ "entity_key": "the_key", "macro_group_keys": ["group1", "group2"] }]

ENTITIES:
${entityList}

APPROVED MACRO GROUPS:
${groupList}

Return JSON array only. One entry per entity.`;

    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        systemInstruction: systemPrompt,
        generationConfig: { responseMimeType: "application/json" },
      });

      const parsed = await retryWithBackoff(async () => {
        const result = await model.generateContent("Assign macro groups to all entities listed.");
        return JSON.parse(result.response.text());
      });

      if (!Array.isArray(parsed)) return [];

      const validGroupKeys = new Set(macroGroups.map(g => g.group_key));

      return parsed
        .filter(item => item.entity_key && Array.isArray(item.macro_group_keys))
        .map(item => ({
          entity_key: String(item.entity_key).toLowerCase().trim(),
          macro_group_keys: item.macro_group_keys.filter(k => validGroupKeys.has(k)),
        }));
    } catch (error) {
      console.error("assignMacroGroupsBatch error:", error.message);
      return [];
    }
  },
};

module.exports = aiService;