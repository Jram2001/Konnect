const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic();

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

JSON array only. No markdown. Empty array if nothing found.`;

const MOOD_SYSTEM_PROMPT = `Write an email subject and mood summary for a daily market digest.

Given events with entity names and scores, return JSON:
{ "subject_line": "under 60 chars, punchy, no emojis", "mood_summary": "one casual sentence" }

JSON only. No markdown.`;

const BATCH_SIZE = 5;

const aiService = {
  /**
   * Format multiple articles into a single prompt.
   * @param {Array<Object>} articles - Array of { title, body }
   * @returns {string}
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
   * Parse and validate extraction JSON from Claude.
   * @param {string} text - Raw response
   * @returns {Array<Object>}
   */
  parseAIResponse(text) {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/, "")
      .replace(/```\s*$/, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
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
   * @param {Object} article - { title, body, source_url }
   * @returns {Promise<Array<Object>>}
   */
  async extractFromArticle(article) {
    const results = await this.extractFromArticles([article]);
    return results[0] || [];
  },

  /**
   * Extract entities/events from multiple articles in one API call.
   * Batches into groups of BATCH_SIZE to stay within token limits.
   * Returns array of arrays — one per article in input order.
   *
   * @param {Array<Object>} articles - Array of { title, body, source_url }
   * @returns {Promise<Array<Array<Object>>>}
   */
  async extractFromArticles(articles) {
    if (!articles || articles.length === 0) return [];

    const results = new Array(articles.length).fill(null).map(() => []);

    // process in batches
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
      const batch = articles.slice(i, i + BATCH_SIZE);
      const batchOffset = i;

      try {
        const userMessage = this.buildBatchPrompt(batch);

        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 4096,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        });

        const extractions = this.parseAIResponse(response.content[0].text);

        // distribute extractions back to their source articles
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
        // batch fails = those articles get empty results, pipeline continues
      }
    }

    return results;
  },

  /**
   * Generate mood summary + subject line from matched events.
   * One call per user — not batched (personalized output).
   *
   * @param {Array<Object>} events - [{ display_name, event_text, impact_score }]
   * @returns {Promise<Object>} - { subject_line, mood_summary }
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

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: MOOD_SYSTEM_PROMPT,
        messages: [{ role: "user", content: eventLines }],
      });

      const text = response.content[0].text
        .trim()
        .replace(/^```json\s*/, "")
        .replace(/```\s*$/, "")
        .trim();

      const parsed = JSON.parse(text);

      return {
        subject_line: String(parsed.subject_line || "Your daily digest").slice(
          0,
          80
        ),
        mood_summary: String(
          parsed.mood_summary || "Here's what happened today."
        ),
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