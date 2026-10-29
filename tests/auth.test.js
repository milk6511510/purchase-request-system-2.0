const test = require("node:test");
const assert = require("node:assert/strict");
const authHandler = require("../api/auth");

test("employee self-registration is disabled", async () => {
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    getHeader(name) { return headers[name]; },
    end(body) { this.body = body; }
  };

  await authHandler({ method: "POST", body: { action: "register" } }, res);

  assert.equal(res.statusCode, 403);
  assert.match(JSON.parse(res.body).error, /不開放員工自行註冊/);
});
