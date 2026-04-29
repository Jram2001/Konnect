const cron = require("node-cron");
const newsService = require("../services/news.service");
const aiService = require("../services/ai.service");
const entityService = require("../services/entity.service");
const digestService = require("../services/digest.service");
const emailService = require("../services/email.service");
const { User, Connection, Digest } = require("../models");
const MacroGroup = require("../models/macrogroup.model");
const Entity = require("../models/entity.model");

// ─── Step 1: Ingest ────────────────────────────────────────────────
// fetch → dedup → store articles

async function step1_ingest() {
  console.log("[Pipeline] Step 1 — Ingest: starting");

  let totalStored = 0;
  let nextPage = null;
  const ARTICLE_LIMIT = 100;

  do {
    const { articles, nextPage: next } = await newsService.fetchTodaysNews({
      category: "business",
      nextPage,
    });
    nextPage = next;

    const fresh = await newsService.deduplicateArticles(articles);
    const stored = await newsService.storeArticles(fresh);
    totalStored += stored.length;

    if (nextPage && totalStored < ARTICLE_LIMIT) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

  } while (nextPage && totalStored < ARTICLE_LIMIT);

  console.log(`[Pipeline] Step 1 — Ingest: ${totalStored} new articles stored`);
  return totalStored;
}

// ─── Step 2: Process ───────────────────────────────────────────────
// for each unprocessed: extractFromArticle → upsertEntity → bulk insert connections → markAsProcessed

async function step2_process() {
  console.log("[Pipeline] Step 2 — Process: starting");

  const articles = await newsService.getUnprocessedArticles();
  if (articles.length === 0) {
    console.log("[Pipeline] Step 2 — Process: no unprocessed articles");
    return 0;
  }

  let totalConnections = 0;

  // Build fuzzy index once for the entire run
  const fuseIndex = await entityService.buildEntityIndex();

  // Extract all at once using batching
  const allExtractions = await aiService.extractFromArticles(articles);

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    let extractions = allExtractions[i] || [];

    try {
      if (extractions.length > 0) {
        // Resolve against existing entities: fuzzy filter → Gemini judge
        extractions = await aiService.resolveExtractedEntities(extractions, fuseIndex);

        for (const ext of extractions) {
          await entityService.upsertEntity(ext.entity_key, ext.display_name);
        }

        const connectionDocs = extractions.map((ext) => ({
          entity_key: ext.entity_key,
          display_name: ext.display_name,
          event_text: ext.event_text,
          event_category: ext.event_category,
          impact_score: ext.impact_score,
          reasoning: ext.reasoning,
          is_macro: ext.is_macro,
          source_url: article.source_url,
        }));

        await Connection.insertMany(connectionDocs);
        totalConnections += connectionDocs.length;
      }

      await newsService.markAsProcessed(article._id);
    } catch (error) {
      console.error(`[Pipeline] Step 2 — Process: error on article ${article._id}:`, error.message);
    }
  }

  console.log(`[Pipeline] Step 2 — Process: ${articles.length} articles processed, ${totalConnections} connections created`);
  return totalConnections;
}

// ─── Step 3: Compose ───────────────────────────────────────────────
// for each active user: buildDigestForUser (resolves macro groups, queries connections, AI mood, creates digest)

async function step3_compose() {
  console.log("[Pipeline] Step 3 — Compose: starting");

  const users = await User.find({ is_active: true });
  if (users.length === 0) {
    console.log("[Pipeline] Step 3 — Compose: no active users");
    return 0;
  }

  let composed = 0;

  for (const user of users) {
    try {
      const digest = await digestService.buildDigestForUser(user);
      if (digest) composed++;
    } catch (error) {
      console.error(
        `[Pipeline] Step 3 — Compose: error for user ${user._id}:`,
        error.message
      );
    }
  }

  console.log(`[Pipeline] Step 3 — Compose: ${composed}/${users.length} digests created`);
  return composed;
}

// ─── Step 4: Deliver ───────────────────────────────────────────────
// for each pending digest: render email → send → mark delivered

async function step4_deliver() {
  console.log("[Pipeline] Step 4 — Deliver: starting");

  const pendingDigests = await Digest.find({ status: "pending" });
  if (pendingDigests.length === 0) {
    console.log("[Pipeline] Step 4 — Deliver: no pending digests");
    return 0;
  }

  let delivered = 0;

  for (const digest of pendingDigests) {
    try {
      const user = await User.findById(digest.user_id);
      if (!user) {
        console.error(`[Pipeline] Step 4 — Deliver: user ${digest.user_id} not found, skipping`);
        continue;
      }

      await emailService.sendDigestEmail(user, digest);
      await digestService.markSent(digest._id);
      delivered++;
    } catch (error) {
      console.error(
        `[Pipeline] Step 4 — Deliver: error for digest ${digest._id}:`,
        error.message
      );

      await Digest.findByIdAndUpdate(digest._id, { status: "failed" });
    }
  }

  console.log(`[Pipeline] Step 4 — Deliver: ${delivered}/${pendingDigests.length} emails sent`);
  return delivered;
}

// ─── Step 2b: Assign Macro Groups ──────────────────────────────────
async function step2b_assignMacroGroups() {
  console.log("[Pipeline] Step 2b — Assign Macro Groups: starting");

  const unassigned = await Entity.find(
    { $or: [{ macro_group_keys: { $size: 0 } }, { macro_group_keys: { $exists: false } }] },
    "entity_key display_name"
  ).lean();

  if (unassigned.length === 0) {
    console.log("[Pipeline] Step 2b — Assign Macro Groups: all entities assigned");
    return 0;
  }

  const macroGroups = await MacroGroup.find({}).lean();

  // Batch in chunks of 50 to avoid prompt size issues
  let totalAssigned = 0;

  for (let i = 0; i < unassigned.length; i += 50) {
    const batch = unassigned.slice(i, i + 50);
    const assignments = await aiService.assignMacroGroupsBatch(batch, macroGroups);

    for (const a of assignments) {
      if (a.macro_group_keys.length > 0) {
        await Entity.findOneAndUpdate(
          { entity_key: a.entity_key },
          { $addToSet: { macro_group_keys: { $each: a.macro_group_keys } } }
        );
        totalAssigned++;
      }
    }

    if (i + 50 < unassigned.length) {
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  console.log(`[Pipeline] Step 2b — Assign Macro Groups: ${totalAssigned}/${unassigned.length} entities assigned`);
  return totalAssigned;
}

// ─── Orchestrator ──────────────────────────────────────────────────

async function runPipeline() {
  const start = Date.now();
  console.log("[Pipeline] ═══════════════════════════════════════");
  console.log("[Pipeline] Daily pipeline started at", new Date().toISOString());

  try {
    await step1_ingest();
    await step2_process();
    await step2b_assignMacroGroups();
    await step3_compose();
    await step4_deliver();
  } catch (error) {
    console.error("[Pipeline] Fatal error:", error.message);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Pipeline] Completed in ${elapsed}s`);
  console.log("[Pipeline] ═══════════════════════════════════════");
}

// ─── Cron schedule: every day at 06:00 AM ──────────────────────────

function schedulePipeline() {
  cron.schedule("0 6 * * *", () => {
    runPipeline();
  },
    {
      timezone: "Asia/Kolkata",
    }
  );

  console.log("[Pipeline] Cron scheduled — daily at 06:00 AM");
}

module.exports = {
  runPipeline,
  schedulePipeline,
  step1_ingest,
  step2_process,
  step2b_assignMacroGroups,
  step3_compose,
  step4_deliver,
};
