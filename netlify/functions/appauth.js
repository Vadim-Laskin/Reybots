// API входа для мобильного приложения (публичная функция, защита — секрет, который знает только приложение)
const crypto = require("crypto");
const { store } = require("../../lib/natk");
const A = require("../../lib/appauth");

const out = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return out(405, { error: "Только POST" });
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return out(400, { error: "Плохой запрос" });
    }
    const st = store(event);

    // 1. приложение создаёт запрос на вход; сам секрет остаётся в приложении, на сервер уходит только его хэш
    if (body.action === "init") {
      if (!A.secretHashOk(body.h)) return out(400, { error: "Плохой запрос" });
      const code = A.newCode();
      const now = Date.now();
      await A.putRec(st, code, { h: body.h, st: "new", ts: now, exp: now + A.CODE_TTL });
      if (Math.random() < 0.1) await A.cleanup(st);
      const bot = process.env.BOT_USERNAME || "Armaturchic_bot";
      return out(200, {
        code,
        bot,
        link: `https://t.me/${bot}?start=app_${code}`,
        ttl: Math.round(A.CODE_TTL / 1000),
      });
    }

    // 2. приложение ждёт подтверждения
    if (body.action === "poll") {
      if (!A.codeOk(body.code) || typeof body.secret !== "string" || body.secret.length > 200) {
        return out(400, { error: "Плохой запрос" });
      }
      const rec = await A.getRec(st, body.code);
      if (!rec || Date.now() > rec.exp) return out(200, { status: "expired" });
      const a = Buffer.from(A.sha(body.secret)), b = Buffer.from(rec.h);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return out(403, { error: "Нет доступа" });

      if (rec.st === "ok") {
        await A.delRec(st, body.code); // токен выдаётся один раз
        return out(200, {
          status: "ok",
          token: A.signSession({ id: rec.uid, first_name: rec.name, username: rec.username }),
          user: { id: rec.uid, name: rec.name },
        });
      }
      if (rec.st === "no") {
        await A.delRec(st, body.code);
        return out(200, { status: "denied", reason: rec.reason || "cancel" });
      }
      return out(200, { status: rec.st === "opened" ? "opened" : "pending" });
    }

    return out(400, { error: "Неизвестное действие" });
  } catch (e) {
    console.log("appauth error:", e.stack);
    return out(500, { error: "Ошибка сервера" });
  }
};
