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
    ? `<a href="${item.source_url}" style="color:#6b7280;font-size:13px;">📰 Source</a>`
    : "";

  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
        <div style="font-size:15px;font-weight:600;color:#111827;">
          ${emoji} ${item.display_name}
          <span style="color:${color};font-weight:700;margin-left:6px;">(${formatScore(item.impact_score)})</span>
        </div>
        <div style="color:#374151;font-size:14px;margin-top:4px;">
          → ${item.event_text}
        </div>
        ${sourceLink ? `<div style="margin-top:4px;">${sourceLink}</div>` : ""}
      </td>
    </tr>`;
}

function renderSection(title, items) {
  if (!items.length) return "";
  const rows = items.map(renderItem).join("");
  return `
    <tr>
      <td style="padding:24px 0 8px 0;font-size:12px;font-weight:700;letter-spacing:1px;color:#9ca3af;text-transform:uppercase;">
        ── ${title} ──
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
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:#111827;padding:24px 32px;">
            <div style="font-size:20px;font-weight:700;color:#ffffff;">Konnect</div>
            <div style="font-size:13px;color:#9ca3af;margin-top:4px;">Your Daily Digest</div>
          </td>
        </tr>

        <!-- Mood summary -->
        <tr>
          <td style="padding:24px 32px 0 32px;">
            <div style="font-size:15px;color:#374151;line-height:1.6;background:#f3f4f6;border-radius:6px;padding:16px;">
              ${digest.mood_summary}
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:0 32px 32px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${renderSection("Direct Hits", microItems)}
              ${renderSection("Macro Waves", macroItems)}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <div style="font-size:12px;color:#9ca3af;text-align:center;">
              You're receiving this because you have an active Konnect watchlist.
            </div>
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

  buildEmailHtml,
};

module.exports = emailService;
