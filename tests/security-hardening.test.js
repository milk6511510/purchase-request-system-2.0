const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_BODY_BYTES,
  readBody,
  isSameOrigin,
  getCookies,
  publicErrorMessage
} = require("../api/_lib/http");
const { parseDataUrl, normalizeCellValue } = require("../api/_lib/sheets");
const { escapeHtml, safeSubject, sendMail } = require("../api/integrations");
const { getClientIp } = require("../api/_lib/login-rate-limit");

test("request bodies are bounded and malformed JSON is rejected", async () => {
  await assert.rejects(
    readBody({ headers: { "content-length": String(MAX_BODY_BYTES + 1) }, body: "{}" }),
    (error) => error.statusCode === 413
  );
  await assert.rejects(
    readBody({ headers: {}, body: "{" }),
    (error) => error.statusCode === 400
  );
});

test("state-changing requests can be restricted to the exact same origin", () => {
  assert.equal(isSameOrigin({
    headers: { host: "purchase.example", origin: "https://purchase.example", "x-forwarded-proto": "https" }
  }), true);
  assert.equal(isSameOrigin({
    headers: { host: "purchase.example", origin: "https://attacker.example", "x-forwarded-proto": "https" }
  }), false);
  assert.equal(isSameOrigin({ headers: { host: "purchase.example" } }), false);
});

test("login limits use Vercel's trusted client IP header, not a supplied forwarding header", () => {
  assert.equal(getClientIp({
    headers: { "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "203.0.113.99" },
    socket: { remoteAddress: "127.0.0.1" }
  }), "198.51.100.4");
  assert.equal(getClientIp({
    headers: { "x-forwarded-for": "203.0.113.99" },
    socket: { remoteAddress: "127.0.0.1" }
  }), "127.0.0.1");
});

test("the app page has no inline script blocks or inline event attributes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../purchase_request_form.html"), "utf8");
  assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script\s*>/i);
  assert.doesNotMatch(html, /\son(?:click|error|load)\s*=/i);
});

test("malformed cookies and internal errors do not crash or leak details", () => {
  assert.doesNotThrow(() => getCookies({ headers: { cookie: "session=%E0%A4%A" } }));
  assert.equal(publicErrorMessage(new Error("secret database detail"), "服務暫時無法使用"), "服務暫時無法使用");
  assert.equal(publicErrorMessage(Object.assign(new Error("輸入資料錯誤"), { statusCode: 400 }), "fallback"), "輸入資料錯誤");
});

test("attachment parsing accepts bounded raster image data only", () => {
  const png = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")}`;
  assert.equal(parseDataUrl(png).mimeType, "image/png");
  assert.equal(parseDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), null);
  assert.equal(parseDataUrl("data:image/png;base64,PHN2Zy8+"), null);
  const tooLarge = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(512 * 1024)]);
  assert.equal(parseDataUrl(`data:image/png;base64,${tooLarge.toString("base64")}`), null);
});

test("spreadsheet user text remains literal while approved numeric columns stay numeric", () => {
  const formulaLike = "=HYPERLINK(\"https://example.invalid\",\"click\")";
  assert.equal(normalizeCellValue("廠商名稱", formulaLike), formulaLike);
  assert.equal(normalizeCellValue("金額", "150.5"), 150.5);
  assert.equal(normalizeCellValue("金額", "not a number"), "");
});

test("mail fields are escaped and the email API key stays server-side", async () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(safeSubject("請購\r\nBcc: attacker@example.invalid"), "請購 Bcc: attacker@example.invalid");

  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = global.fetch;
  let captured;
  process.env.RESEND_API_KEY = "test-only-key";
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true };
  };
  try {
    const result = await sendMail({ to: "employee@example.com", subject: "safe", html: "<p>ok</p>" });
    assert.equal(result.skipped, false);
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.equal(captured.options.headers.Authorization, "Bearer test-only-key");
    assert.deepEqual(JSON.parse(captured.options.body).to, ["employee@example.com"]);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});
