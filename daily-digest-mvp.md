# Daily Market Intelligence Digest — MVP Document

## Overview

An AI-powered daily email digest that monitors news for entities (stocks, people, companies, sectors) a user cares about. Every morning, a cron job fetches the day's news, uses Claude AI to extract entities, detect events, score sentiment, and map micro/macro relationships — then delivers a punchy, personalized email summarizing what matters.

---

## Core User Flow

1. User signs up via a minimal web page, enters their email
2. User adds entities to their watchlist (e.g., "TSLA", "Elon Musk", "AI Sector", "India Tech")
3. Entities are auto-mapped to macro groups (e.g., TSLA → EV Sector → Tech Industry)
4. Every morning at 6 AM, the system runs the full pipeline
5. User receives an email with a 1-line mood summary, followed by micro events, macro events, and article links

---

## Services & Components

### 1. News Ingestion Service

**Purpose:** Fetch, deduplicate, and store the day's news articles.

- **Source:** NewsAPI and/or Google News RSS
- **Trigger:** Cron job (daily, ~5:30 AM — runs before the AI pipeline)
- **Logic:**
  - Query news APIs with broad market/business/tech categories
  - Deduplicate by URL hash to avoid processing the same article twice
  - Store raw articles (title, body, URL, source, published date) in PostgreSQL
  - Cache recent articles in Redis for fast lookup
- **Output:** A batch of fresh, deduplicated articles ready for AI processing

### 2. AI Processing Pipeline (Claude API)

The core intelligence layer. All sub-steps are powered by the Anthropic Claude API. These can be a single chained prompt or separate calls depending on performance tuning.

#### 2a. Entity Extraction

- **Input:** Article text
- **Output:** List of named entities with type labels
  - Types: `person`, `company`, `stock_ticker`, `country`, `sector`, `organization`
- **Example:**
  ```json
  [
    { "name": "Elon Musk", "type": "person" },
    { "name": "Tesla", "type": "company" },
    { "name": "TSLA", "type": "stock_ticker" },
    { "name": "EV Sector", "type": "sector" }
  ]
  ```

#### 2b. Event Detection

- **Input:** Article text
- **Output:** List of discrete events described in the article
- **Example:**
  ```json
  [
    { "event": "CEO announced factory expansion in Mexico", "category": "expansion" },
    { "event": "Quarterly deliveries fell short of estimates", "category": "earnings" }
  ]
  ```

#### 2c. Sentiment & Impact Scoring

- **Input:** Entity + Event pair
- **Output:** Impact score from -5 (very negative) to +5 (very positive)
- **Example:**
  ```json
  {
    "entity": "Tesla",
    "event": "Quarterly deliveries fell short of estimates",
    "impact_score": -3,
    "reasoning": "Missed delivery targets signal demand weakness"
  }
  ```

#### 2d. Entity–Event Relation Mapping (Micro Events)

- **Purpose:** Link extracted entities to detected events from the same article
- **Logic:** For each article, pair every entity with every event and ask Claude to confirm or deny the relationship and provide a sentiment score
- **Output:** A set of confirmed `(entity, event, score, article_url)` tuples

#### 2e. Macro Event Matching

- **Purpose:** Detect events that affect a broader group/sector, not just a single entity
- **Logic:**
  - Maintain a mapping table: `entity → macro_group` (e.g., TSLA → EV Sector → Tech)
  - When an event affects a macro group (e.g., "Fed raises interest rates" → Finance sector), propagate that event to ALL entities in that group that appear in any user's watchlist
  - Claude determines if the event is macro-level and which groups it impacts
- **Output:** A set of `(macro_group, event, score, article_url)` tuples

### 3. Digest Composer (Claude API)

**Purpose:** Generate the final email content per user.

- **Input:** All micro + macro events matched to the user's watchlist
- **Output:** Structured email content
  - **1-line mood summary:** e.g., "Rough morning — 3 of your 5 watchlist items took hits"
  - **Micro events section:** Direct impacts on watched entities, sorted by severity
  - **Macro events section:** Broader sector/group events that indirectly affect the user's entities
  - **Article links:** Source articles for each event
- **Tone:** Casual, direct, slightly irreverent (configurable later)

### 4. Cron Scheduler

**Purpose:** Orchestrate the entire daily pipeline.

- **Tech:** Node.js cron (node-cron) or system-level crontab
- **Schedule:** Daily at 6:00 AM (user's timezone — default UTC for MVP)
- **Pipeline order:**
  1. Trigger News Ingestion Service
  2. Wait for ingestion to complete
  3. Run AI Processing Pipeline on all new articles
  4. For each user, gather matched events from their watchlist
  5. Call Digest Composer per user
  6. Hand off to Email Delivery Service

### 5. Email Delivery Service

**Purpose:** Send the final HTML digest emails.

- **Provider:** SendGrid (free tier: 100 emails/day) or Resend
- **Template:** Clean HTML email template with sections for mood line, micro events, macro events
- **Tracking:** Log delivery status (sent, bounced, opened — if provider supports it)
- **Unsubscribe:** Include a 1-click unsubscribe link in every email (required by CAN-SPAM)

### 6. Minimal Signup Page

**Purpose:** The only user-facing UI in the MVP.

- **Stack:** Single HTML page (static site or simple Express route)
- **Fields:**
  - Email address
  - Watchlist entities (text input, comma-separated or tag-style)
  - Optional: assign entities to macro groups
- **Actions:**
  - Create account (email + watchlist saved to DB)
  - Edit watchlist (via a link in the digest email)
- **No auth for MVP:** Use a unique token in email links for watchlist management

---

## Data Stores

### MongoDB

Document database with 7 collections. Separate entities registry and connections collection build a queryable knowledge graph.

| Collection | Purpose | Key Fields | Embedded / Notes |
|------------|---------|------------|------------------|
| `users` | Accounts | `email`, `is_active` | `watchlist[]` (entity_key, display_name) |
| `entities` | Canonical entity registry | `entity_key` (unique), `display_name`, `macro_group_keys` | AI upserts by entity_key. Admin assigns macro groups manually |
| `macro_groups` | Sector/group definitions | `group_key` (unique), `display_name`, `description` | Seeded manually. MVP: no AI suggestion |
| `articles` | Raw ingested articles | `url_hash` (unique), `title`, `body`, `source_url`, `published_at`, `is_processed` | Lean — no AI output embedded |
| `connections` | AI-discovered relationships | `entity_key`, `display_name`, `event_text`, `event_category`, `impact_score`, `reasoning`, `is_macro`, `macro_group_keys`, `source_url`, `discovered_at` | One doc per entity-event pair. Heart of the system |
| `digests` | Sent digest history | `user_id`, `sent_at`, `status`, `subject_line`, `mood_summary` | `items[]` (connection_id, entity_name, event_text, impact_score, section_type, source_url) |

**Key design decisions:**
- **entity_key for disambiguation** — AI returns stable keys like "tesla_company" vs "nikola_tesla_person". Upsert by key, never by display name
- **Connections as separate collection** — queryable knowledge graph, not embedded in articles
- **Macro groups manual-only for MVP** — admin seeds groups, assigns to entities. Convert to hybrid (AI suggests from approved list) later
- **Watchlist embedded in users** — always read together, 5-20 items max
- **Digest items denormalized** — self-contained snapshot for email rendering

### Redis

- **Article dedup cache:** URL hash → boolean (TTL: 48 hours)
- **Rate limit tracking:** Claude API call counts per minute
- **Temporary processing queue:** Article IDs pending AI processing

---

## Tech Stack (MVP)

| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | Node.js (Express) | Fast to build, good async I/O for API calls |
| AI | Anthropic Claude API | Entity extraction, sentiment, summarization |
| Database | MongoDB (Atlas free tier) | Document-shaped AI outputs, flexible schema, no migrations |
| Cache | Redis | Dedup, rate limiting, temp queues |
| Email | SendGrid or Resend | Free tier, reliable delivery |
| Scheduler | node-cron | Simple, in-process cron for MVP |
| Hosting | Railway / Render / Fly.io | Easy deploy, free/cheap tiers |
| Signup page | Static HTML or Express route | Minimal UI, no framework needed |

---

## Daily Pipeline Flow (Sequence)

```
[05:30 AM] Cron triggers News Ingestion
     │
     ▼
[05:30–05:45] Fetch articles from NewsAPI / Google News
     │         Deduplicate by URL hash
     │         Store in MongoDB
     ▼
[05:45–06:00] AI Processing Pipeline (per article batch)
     │         ├── Entity Extraction (Claude)
     │         ├── Event Detection (Claude)
     │         ├── Sentiment Scoring (Claude)
     │         ├── Micro: Entity–Event Relation Mapping
     │         └── Macro: Group-level Event Matching
     ▼
[06:00–06:10] Per-user Digest Composition
     │         ├── Gather all matched micro events
     │         ├── Gather all matched macro events
     │         └── Claude generates email copy
     ▼
[06:10–06:15] Email Delivery
              └── Send via SendGrid / Resend
```

---

## Email Format (Example)

```
Subject: Your daily digest — mostly rough, but one bright spot 🔥

---

Hey Alex,

TL;DR: 3 out of 4 things you watch took a hit today. Buckle up.

── DIRECT HITS ──────────────────────────

🔴 Tesla (-3/5)
   → Quarterly deliveries fell short of analyst estimates
   📰 Reuters: [link]

🟢 Anthropic (+4/5)
   → Closed $2B funding round at $60B valuation
   📰 TechCrunch: [link]

🔴 Elon Musk (-2/5)
   → SEC investigation into social media posts reopened
   📰 Bloomberg: [link]

── MACRO WAVES ──────────────────────────

🔴 AI Sector (-1/5)
   → EU passed strict AI regulation bill — compliance costs expected
   📰 Financial Times: [link]
   ↳ Affects your watchlist: Anthropic, OpenAI

🟡 EV Sector (0/5)
   → Mixed signals — China EV sales up, US incentives under review
   📰 WSJ: [link]
   ↳ Affects your watchlist: Tesla

---

Manage your watchlist: [link]
Unsubscribe: [link]
```

---

## Claude API Prompt Strategy

For the MVP, use a single chained prompt per article to minimize API calls:

```
System: You are a financial news analyst. Given a news article, extract:
1. All named entities (people, companies, tickers, sectors, countries)
2. All discrete events described in the article
3. For each entity–event pair, a sentiment impact score from -5 to +5
4. Whether any events are macro-level (affecting an entire sector/group)

Respond in structured JSON only.
```

This keeps costs low by batching extraction, detection, and scoring into one call per article. The digest composition is a separate call per user.

---

## MVP Scope — What's IN vs OUT

| IN (MVP) | OUT (Post-MVP) |
|----------|----------------|
| Daily email digest | Real-time alerts / push notifications |
| NewsAPI + Google News | Premium data feeds (Bloomberg, Reuters) |
| Entity extraction + sentiment via Claude | Custom fine-tuned NER models |
| Basic watchlist (text input) | Smart entity autocomplete / search |
| Macro group mapping (manual) | Auto-discovered macro relationships |
| Single daily cron | Configurable frequency (hourly, weekly) |
| Email-only delivery | Slack, Telegram, SMS channels |
| No auth (token-based links) | Full auth (OAuth, magic links) |
| English only | Multi-language support |
| UTC timezone | Per-user timezone scheduling |
| No stock price tracking | Stock price integration + charts |

---

## Estimated Costs (MVP, ~100 users)

| Service | Free Tier / Cost |
|---------|-----------------|
| NewsAPI | Free (100 requests/day) |
| Claude API | ~$5–15/day (depending on article volume) |
| SendGrid | Free (100 emails/day) |
| MongoDB Atlas | Free tier (512MB) |
| Redis (Railway) | Free tier available |
| Hosting (Railway/Render) | Free tier or ~$5/month |
| **Total** | **~$10–20/month** |

---

## Next Steps

1. Set up the project repo and basic Express server
2. Integrate NewsAPI and build the ingestion worker
3. Design and test the Claude prompt chain (entity + event + sentiment)
4. Build the macro group mapping table and matching logic
5. Create the digest composer prompt and email template
6. Wire up SendGrid and test end-to-end with a test user
7. Build the minimal signup page
8. Deploy and schedule the cron job
9. Invite beta users
