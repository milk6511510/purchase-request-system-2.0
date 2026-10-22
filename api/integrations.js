const { Resend } = require("resend");

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY || "";
  return apiKey ? new Resend(apiKey) : null;
}

async function sendMail({ to, subject, html }) {
  const resend = getResendClient();
  if (!resend || !to) return { skipped: true };

  await resend.emails.send({
    from: process.env.MAIL_FROM || "請購單系統 <noreply@example.com>",
    to,
    subject,
    html
  });

  return { skipped: false };
}

module.exports = { sendMail };
