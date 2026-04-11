const nodemailer = require("nodemailer");

/**
 * Create the SMTP transport once at module load.
 * Supports Gmail, SES, or any generic SMTP provider via env vars.
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_FROM  – defaults to SMTP_USER
 *   SMTP_SECURE – "true" for port 465, otherwise STARTTLS is used
 */
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM_ADDRESS = process.env.SMTP_FROM || process.env.SMTP_USER;

// ─── HTML builder helpers ───────────────────────────────────────────

function impactBadge(score) {
  if (score > 0) return { emoji: "🟢", color: "#22c55e" };
  if (score < 0) return { emoji: "🔴", color: "#ef4444" };
  return { emoji: "🟡", color: "#eab308" };
}

function formatScore(score) {
  return score > 0 ? `+${score}/5` : `${score}/5`;
}

function renderItem(item) {
  const { emoji, color } = impactBadge(item.impact_score);
  const sourceLink = item.source_url
    ? `<a href="${item.source_url}" style="color:#4b5563;font-size:12px;text-decoration:none;">↗ Source</a>`
    : "";

  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #2a2a2a;">
        <div style="font-size:13px;font-weight:600;color:#ffffff;">
          ${item.display_name}
          <span style="color:${color};font-weight:700;margin-left:6px;">${formatScore(item.impact_score)}</span>
        </div>
        <div style="color:#9ca3af;font-size:13px;margin-top:5px;line-height:1.6;">
          ${item.event_text}
        </div>
        ${sourceLink ? `<div style="margin-top:6px;">${sourceLink}</div>` : ""}
      </td>
    </tr>`;
}

/**
 * Build welcome email HTML showing confirmed watchlist entities.
 * @param {Array<{entity_key: string, display_name: string}>} watchlist
 * @returns {string} HTML string
 */
function buildWelcomeHtml(watchlist) {
  const entityRows = watchlist
    .map(
      (e) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">
        <div style="font-size:14px;font-weight:600;color:#ffffff;">${e.display_name}</div>
        <div style="font-size:11px;color:#4b5563;margin-top:2px;">${e.entity_key}</div>
      </td>
    </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
  <html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 0;">
      <tr><td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #2a2a2a;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:2px;text-transform:uppercase;">KONNECT</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">Welcome aboard</div>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #2a2a2a;">
              <div style="font-size:14px;color:#d1d5db;line-height:1.7;">You're in. Every morning at 6 AM, you'll get a digest covering what matters across your watchlist.</div>
            </td>
          </tr>

          <!-- Watchlist -->
          <tr>
            <td style="padding:24px 32px;">
              <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#4b5563;text-transform:uppercase;margin-bottom:12px;">Your Watchlist</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${entityRows}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2a2a2a;">
              <div style="font-size:11px;color:#4b5563;text-align:center;">Your first digest arrives tomorrow morning · Konnect</div>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

function renderSection(title, items) {
  if (!items.length) return "";
  const rows = items.map(renderItem).join("");
  return `
    <tr>
      <td style="padding:20px 0 8px 0;">
        <div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#4b5563;text-transform:uppercase;">${title}</div>
      </td>
    </tr>
    ${rows}`;
}
/**
 * Build the full digest email HTML.
 * @param {Object} digest - Mongoose digest document (or plain object)
 * @returns {string} HTML string
 */
function buildEmailHtml(digest) {
  const microItems = (digest.items || []).filter(
    (i) => i.section_type === "micro"
  );
  const macroItems = (digest.items || []).filter(
    (i) => i.section_type === "macro"
  );

  return `<!DOCTYPE html>
  <html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
  <body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 0;">
      <tr><td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid #2a2a2a;">
              <div style="font-size:11px;font-weight:600;color:#6b7280;letter-spacing:2px;text-transform:uppercase;">KONNECT</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">Daily Digest</div>
              <div style="font-size:12px;color:#4b5563;margin-top:4px;">${new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
            </td>
          </tr>

          <!-- Mood summary -->
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #2a2a2a;">
              <div style="font-size:14px;color:#d1d5db;line-height:1.7;">${digest.mood_summary}</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${renderSection("Direct Hits", microItems)}
                ${renderSection("Macro Waves", macroItems)}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #2a2a2a;">
              <div style="font-size:11px;color:#4b5563;text-align:center;">Your watchlist · Konnect</div>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>`;
}

// ─── Public API ─────────────────────────────────────────────────────

const emailService = {
  /**
   * Build and send a digest email.
   * @param {Object} user  - User document (needs at least `email`)
   * @param {Object} digest - Digest document (subject_line, mood_summary, items)
   * @returns {Promise<Object>} nodemailer send result
   */
  async sendDigestEmail(user, digest) {
    try {
      if (!user?.email) throw new Error("user.email is required");
      if (!digest?.subject_line) throw new Error("digest.subject_line is required");

      const html = buildEmailHtml(digest);

      const result = await transport.sendMail({
        from: FROM_ADDRESS,
        to: user.email,
        subject: digest.subject_line,
        html,
      });

      console.log(
        `Email sent to ${user.email} (messageId: ${result.messageId})`
      );
      return result;
    } catch (error) {
      console.error(
        `Service Error [sendDigestEmail] user=${user?.email}:`,
        error.message
      );
      throw error;
    }
  },

  /**
   * Send welcome email with confirmed watchlist.
   * @param {Object} user - needs `email`
   * @param {Array<{entity_key: string, display_name: string}>} watchlist
   * @returns {Promise<Object>} nodemailer send result
   */
  async sendWelcomeEmail(user, watchlist) {
    try {
      if (!user?.email) throw new Error("user.email is required");

      const html = buildWelcomeHtml(watchlist);

      const result = await transport.sendMail({
        from: FROM_ADDRESS,
        to: user.email,
        subject: "Welcome to Konnect — your watchlist is set",
        html,
      });

      console.log(`Welcome email sent to ${user.email} (messageId: ${result.messageId})`);
      return result;
    } catch (error) {
      console.error(`Service Error [sendWelcomeEmail] user=${user?.email}:`, error.message);
      throw error;
    }
  },

  buildEmailHtml,
};

module.exports = emailService;
