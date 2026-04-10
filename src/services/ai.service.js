const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini Client
// Make sure GEMINI_API_KEY is in your environment variables
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
      // Gemini's JSON mode returns a raw string without markdown blocks
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

    // Initialize the model with system instructions and JSON mode
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
        const result = await model.generateContent(userMessage);
        const responseText = result.response.text();

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

      const result = await model.generateContent(eventLines);
      const parsed = JSON.parse(result.response.text());

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
};

module.exports = aiService;