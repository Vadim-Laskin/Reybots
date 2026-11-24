// Вход в мобильное приложение через Telegram-бота.
// Схема: приложение просит код (init) → открывает t.me/<бот>?start=app_<код> → бот присылает кнопку
// «Подтвердить вход в приложение» → приложение опрашивает poll и получает подписанную сессию.
// Сессия принимается в cabinet.js вместо Telegram initData.
const crypto = require("crypto");

const CODE_TTL = 5 * 60e3; // сколько живёт запрос на вход
const SESSION_TTL = 90 * 864e5; // сколько живёт сессия в приложении
const PREFIX = "appauth-";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const newCode = () => crypto.randomBytes(16).toString("hex"); // 32 символа; вместе с «app_» < 64, как требует Telegram
const codeOk = (c) => typeof c === "string" && /^[a-f0-9]{32}$/.test(c);
const secretHashOk = (h) => typeof h === "string" && /^[a-f0-9]{64}$/.test(h);

function key() {
  const base = process.env.SESSION_SECRET || process.env.BOT_TOKEN;
  if (!base) throw new Error("Не задан SESSION_SECRET или BOT_TOKEN");
  return crypto.createHash("sha256").update("appsession:" + base).digest();
}

function signSession(user) {
  const p = Buffer.from(
    JSON.stringify({ id: user.id, n: user.first_name || "", u: user.username || "", exp: Date.now() + SESSION_TTL })
  ).toString("base64url");
  const s = crypto.createHmac("sha256", key()).update(p).digest("base64url");
  return p + "." + s;
}

// возвращает {id, first_name, username} или null (так же, как проверка initData)
function verifySession(token) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [p, s] = token.split(".");
  if (!p || !s) return null;
  const calc = crypto.createHmac("sha256", key()).update(p).digest("base64url");
  const a = Buffer.from(calc), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!d.id || !(d.exp > Date.now())) return null;
    return { id: d.id, first_name: d.n || "", username: d.u || "" };
  } catch {
    return null;
  }
}

async function getRec(st, code) {
  try {
    return (await st.get(PREFIX + code, { type: "json", consistency: "strong" })) || null;
  } catch (e) {
    console.log("appauth read failed:", e.message);
    return null;
  }
}
const putRec = (st, code, rec) => st.setJSON(PREFIX + code, rec);
const delRec = async (st, code) => {
  try {
    await st.delete(PREFIX + code);
  } catch {}
};

// иногда чистим просроченные запросы
async function cleanup(st) {
  try {
    const { blobs } = await st.list({ prefix: PREFIX });
    for (const b of blobs.slice(0, 50)) {
      const r = await st.get(b.key, { type: "json" }).catch(() => null);
      if (!r || Date.now() > (r.exp || 0) + 600e3) await st.delete(b.key).catch(() => {});
    }
  } catch (e) {
    console.log("appauth cleanup failed:", e.message);
  }
}

module.exports = {
  CODE_TTL, SESSION_TTL, sha, newCode, codeOk, secretHashOk,
  signSession, verifySession, getRec, putRec, delRec, cleanup,
};
