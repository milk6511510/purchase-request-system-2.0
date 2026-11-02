const { query } = require("./db");
const { hashRateLimitKey } = require("./security");

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const limits = { account: 8, ip: 30 };
const memoryBuckets = new Map();
let lastCleanupAt = 0;

function getClientIp(req) {
  const forwarded = req.headers?.["x-vercel-forwarded-for"]
    || req.socket?.remoteAddress
    || "";
  return String(forwarded).split(",")[0].trim().slice(0, 128);
}

function bucketsFor(employeeId, ipAddress) {
  const buckets = [{ type: "account", hash: hashRateLimitKey("account", String(employeeId).toUpperCase()) }];
  if (ipAddress) buckets.push({ type: "ip", hash: hashRateLimitKey("ip", ipAddress) });
  return buckets;
}

function pruneMemoryBuckets(now = Date.now()) {
  for (const [key, bucket] of memoryBuckets) {
    if (now - bucket.windowStartedAt > WINDOW_MS * 2 && bucket.blockedUntil <= now) memoryBuckets.delete(key);
  }
  while (memoryBuckets.size > 10000) memoryBuckets.delete(memoryBuckets.keys().next().value);
}

async function getLoginRetryAfter(employeeId, ipAddress) {
  const buckets = bucketsFor(employeeId, ipAddress);
  if (process.env.DATABASE_URL) {
    const hashes = buckets.map((bucket) => bucket.hash);
    const result = await query(
      `SELECT MAX(blocked_until) AS blocked_until
       FROM purchase_request.login_rate_limits
       WHERE bucket_hash = ANY($1::text[])`,
      [hashes]
    );
    const blockedUntil = result.rows[0]?.blocked_until ? new Date(result.rows[0].blocked_until).getTime() : 0;
    return Math.max(0, blockedUntil - Date.now());
  }

  pruneMemoryBuckets();
  const now = Date.now();
  return buckets.reduce((maximum, bucket) => {
    const state = memoryBuckets.get(`${bucket.type}:${bucket.hash}`);
    return Math.max(maximum, state?.blockedUntil > now ? state.blockedUntil - now : 0);
  }, 0);
}

async function recordFailedLogin(employeeId, ipAddress) {
  const buckets = bucketsFor(employeeId, ipAddress);
  if (process.env.DATABASE_URL) {
    for (const bucket of buckets) {
      await query(
        `INSERT INTO purchase_request.login_rate_limits AS current_bucket
          (bucket_type, bucket_hash, window_started_at, attempt_count, blocked_until, updated_at)
         VALUES ($1, $2, NOW(), 1, NULL, NOW())
         ON CONFLICT (bucket_type, bucket_hash) DO UPDATE SET
          attempt_count = CASE
            WHEN current_bucket.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
            ELSE current_bucket.attempt_count + 1
          END,
          window_started_at = CASE
            WHEN current_bucket.window_started_at <= NOW() - INTERVAL '15 minutes' THEN NOW()
            ELSE current_bucket.window_started_at
          END,
          blocked_until = CASE
            WHEN CASE
              WHEN current_bucket.window_started_at <= NOW() - INTERVAL '15 minutes' THEN 1
              ELSE current_bucket.attempt_count + 1
            END >= $3 THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
          END,
          updated_at = NOW()`,
        [bucket.type, bucket.hash, limits[bucket.type]]
      );
    }

    const now = Date.now();
    if (now - lastCleanupAt >= WINDOW_MS) {
      lastCleanupAt = now;
      await query("DELETE FROM purchase_request.login_rate_limits WHERE updated_at < NOW() - INTERVAL '7 days'");
    }
    return;
  }

  const now = Date.now();
  pruneMemoryBuckets(now);
  for (const bucket of buckets) {
    const key = `${bucket.type}:${bucket.hash}`;
    const previous = memoryBuckets.get(key);
    const attemptCount = !previous || now - previous.windowStartedAt > WINDOW_MS ? 1 : previous.attemptCount + 1;
    const windowStartedAt = attemptCount === 1 ? now : previous.windowStartedAt;
    memoryBuckets.set(key, {
      windowStartedAt,
      attemptCount,
      blockedUntil: attemptCount >= limits[bucket.type] ? now + BLOCK_MS : 0
    });
  }
}

async function clearAccountFailures(employeeId) {
  const account = bucketsFor(employeeId, "")[0];
  if (process.env.DATABASE_URL) {
    await query(
      "DELETE FROM purchase_request.login_rate_limits WHERE bucket_type = 'account' AND bucket_hash = $1",
      [account.hash]
    );
    return;
  }
  memoryBuckets.delete(`account:${account.hash}`);
}

module.exports = { getClientIp, getLoginRetryAfter, recordFailedLogin, clearAccountFailures };
