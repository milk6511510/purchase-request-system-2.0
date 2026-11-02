function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function safeSubject(value) {
  return String(value || "").replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").slice(0, 160);
}

async function sendMail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey || !to) return { skipped: true };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "請購單系統 <noreply@example.com>",
      to: Array.isArray(to) ? to : [to],
      subject: safeSubject(subject),
      html
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("郵件服務暫時無法使用");

  return { skipped: false };
}

module.exports = { sendMail, escapeHtml, safeSubject };
