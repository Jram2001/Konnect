const crypto = require("crypto");
const axios = require("axios");
const { Article } = require("../models");

const NEWSDATA_API_KEY = process.env.NEWSDATA_API_KEY;
const NEWSDATA_BASE_URL = "https://newsdata.io/api/1/latest";

/**
 * Fetch today's news from NewsData.io.
 * @param {Object} [opts]
 * @param {string} [opts.query]      - keyword / phrase filter
 * @param {string} [opts.category]   - e.g. "business", "technology"
 * @param {string} [opts.language]   - default "en"
 * @param {string} [opts.nextPage]   - pagination token
 * @returns {Promise<{ articles: Array, nextPage: string|null }>}
 */
async function fetchTodaysNews(opts = {}) {
  const params = {
    apikey: NEWSDATA_API_KEY,
    language: "en",
    q: "India OR BSE OR NSE OR RBI OR rupee OR oil OR tariff OR \"Fed rate\"",
    category: "business",
    country: "in",
  };
  if (opts.query) params.q = opts.query;
  if (opts.category) params.category = opts.category;
  if (opts.nextPage) params.page = opts.nextPage;

  try {
    const { data } = await axios.get(NEWSDATA_BASE_URL, { params });

    const articles = (data.results || []).map((item) => ({
      title: item.title || "",
      body: item.description || item.content || "",
      source_url: item.link || "",
      published_at: item.pubDate ? new Date(item.pubDate) : new Date(),
    }));

    return { articles, nextPage: data.nextPage || null };
  } catch (err) {
    console.error("[NewsService] fetchTodaysNews error:", {
      status: err.response?.status,
      message: err.response?.data?.message || err.message,
      data: err.response?.data,
    });
    throw err;
  }
}
/**
 * Generate a SHA-256 hash for a URL to use as a dedup key.
 * @param {string} url
 * @returns {string}
 */
function hashUrl(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Remove articles whose URL is already stored in the database.
 * @param {Array<Object>} articles - raw articles from fetchTodaysNews
 * @returns {Promise<Array<Object>>} articles not yet in the DB
 */
async function deduplicateArticles(articles) {
  if (!articles.length) return [];

  const hashes = articles.map((a) => hashUrl(a.source_url));
  const existing = await Article.find(
    { url_hash: { $in: hashes } },
    { url_hash: 1 }
  ).lean();

  const existingSet = new Set(existing.map((e) => e.url_hash));
  return articles.filter((a) => !existingSet.has(hashUrl(a.source_url)));
}

/**
 * Bulk-insert articles into the database with is_processed = false.
 * Skips duplicates gracefully via ordered: false.
 * @param {Array<Object>} articles
 * @returns {Promise<Array<Object>>} inserted documents
 */
async function storeArticles(articles) {
  if (!articles.length) return [];

  const docs = articles.map((a) => ({
    url_hash: hashUrl(a.source_url),
    title: a.title,
    body: a.body,
    source_url: a.source_url,
    published_at: a.published_at,
    is_processed: false,
  }));

  try {
    const result = await Article.insertMany(docs, { ordered: false });
    return result;
  } catch (err) {
    // BulkWriteError code 11000 = duplicate key; return whatever was inserted
    if (err.code === 11000 || err.insertedDocs) {
      return err.insertedDocs || [];
    }
    throw err;
  }
}

/**
 * Get today's articles that haven't been processed yet.
 * @returns {Promise<Array<Object>>}
 */
async function getUnprocessedArticles() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  startOfDay.setMinutes(startOfDay.getMinutes() - 330);

  return Article.find({
    is_processed: false,
    published_at: { $gte: startOfDay },
  })
    .sort({ published_at: -1 })
    .lean();
}

/**
 * Mark a single article as processed.
 * @param {string} articleId - MongoDB _id
 * @returns {Promise<Object>} updated document
 */
async function markAsProcessed(articleId) {
  return Article.findByIdAndUpdate(
    articleId,
    { is_processed: true },
    { new: true }
  );
}

module.exports = {
  fetchTodaysNews,
  deduplicateArticles,
  storeArticles,
  getUnprocessedArticles,
  markAsProcessed,
};
