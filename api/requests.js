const { json } = require("./_lib/http");
const { getSessionUser, getRequests, canReadRequest, publicUser } = require("./_lib/domain");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      json(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    const user = await getSessionUser(req);
    const requests = (await getRequests())
      .filter((request) => canReadRequest(user, request))
      .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
    json(res, 200, { ok: true, user: publicUser(user), requests });
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { ok: false, error: error.message || "請購單查詢服務暫時無法使用" });
  }
};
