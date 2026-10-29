const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvironment() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) throw new Error("找不到專案根目錄的 .env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(separator + 1).trim();
  }
}

function askLine(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (value) => resolve(value.trim()));
  });
}

function askSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("請在可互動的 PowerShell 終端執行此指令，密碼不會回顯。"));
      return;
    }

    let value = "";
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("已取消密碼重設。"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  loadLocalEnvironment();
  if (!process.env.DATABASE_URL) throw new Error(".env.local 缺少 DATABASE_URL");

  const host = new URL(process.env.DATABASE_URL).hostname;
  if (!host.startsWith("ep-plain-star-azjb3bxx")) {
    throw new Error("安全保護：此指令只允許重設 Neon development endpoint 的 A001，不會連到其他資料庫。");
  }

  process.stdout.write("目標：Neon development 分支的 A001 最高權限帳號。\n");
  if ((await askLine("輸入 RESET 確認重設：")) !== "RESET") {
    throw new Error("未確認，沒有變更任何帳號。");
  }

  const password = await askSecret("輸入新密碼（輸入不會顯示；不足 8 字元會要求首次登入更換）：");
  const confirmation = await askSecret("再次輸入新密碼：");
  const temporary = password.length >= 4 && password.length < 8;
  if (password.length < 4) throw new Error("新密碼至少需要 4 個字元。");
  if (password !== confirmation) throw new Error("兩次輸入不一致，沒有變更密碼。");

  const { hashPassword } = require("../api/_lib/security");
  const { getUser, saveUser } = require("../api/_lib/domain-postgres");
  const { closePool } = require("../api/_lib/db");
  try {
    const existing = await getUser("A001");
    await saveUser({
      ...(existing || {}),
      employeeId: "A001",
      name: "李柏勳",
      email: existing?.email || process.env.ADMIN_EMAIL || "",
      departmentCode: existing?.departmentCode || "ADMIN",
      role: "superAdmin",
      approvalRole: "",
      active: true,
      mustChangePassword: temporary,
      passwordHash: await hashPassword(password, temporary ? 4 : 8),
      note: "最高權限者"
    });
    process.stdout.write(temporary
      ? "A001 已設為臨時登入密碼；首次登入必須立即改成至少 8 個字元的新密碼。\n"
      : "A001 密碼已重設；新密碼只存在你剛才的輸入與 Neon 密碼雜湊中。\n");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
