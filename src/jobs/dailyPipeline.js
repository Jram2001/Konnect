const cron = require("node-cron");
const newsService = require("../services/news.service");
const aiService = require("../services/ai.service");
const entityService = require("../services/entity.service");
const digestService = require("../services/digest.service");
const emailService = require("../services/email.service");
const { User, Connection, Digest } = require("../models");

// ─── Step 1: Ingest ────────────────────────────────────────────────
// fetch → dedup → store articles

async function step1_ingest() {
  console.log("[Pipeline] Step 1 — Ingest: starting");

  let totalStored = 0;
  let nextPage = null;

  do {
    const { articles, nextPage: next } = await newsService.fetchTodaysNews({
      category: "business",
      nextPage,
    });
    nextPage = next;

    const fresh = await newsService.deduplicateArticles(articles);
    const stored = await newsService.storeArticles(fresh);
    totalStored += stored.length;
  } while (nextPage);

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

  for (const article of articles) {
    try {
      const extractions = await aiService.extractFromArticle(article);

      if (extractions.length > 0) {
        // upsert each entity
        for (const ext of extractions) {
          await entityService.upsertEntity(ext.entity_key, ext.display_name);
        }

        // bulk insert connections
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
      console.error(
        `[Pipeline] Step 2 — Process: error on article ${article._id}:`,
        error.message
      );
    }
  }

  console.log(
    `[Pipeline] Step 2 — Process: ${articles.length} articles processed, ${totalConnections} connections created`
  );
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

// ─── Orchestrator ──────────────────────────────────────────────────

async function runPipeline() {
  const start = Date.now();
  console.log("[Pipeline] ═══════════════════════════════════════");
  console.log("[Pipeline] Daily pipeline started at", new Date().toISOString());

  try {
    await step1_ingest();
    await step2_process();
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
  });

  console.log("[Pipeline] Cron scheduled — daily at 06:00 AM");
}

module.exports = {
  runPipeline,
  schedulePipeline,
  step1_ingest,
  step2_process,
  step3_compose,
  step4_deliver,
};
