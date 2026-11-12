const crypto = require("crypto");
const { store } = require("../../lib/natk");
const { isAdmin, load, save } = require("../../lib/sounds");

const H = { "Content-Type": "application/json" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

function verify(initData) {
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const str = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(str).digest("hex");
  const a = Buffer.from(calc), b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date")) > 86400) return null;
  try {
    return JSON.parse(p.get("user"));
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return out(405, { error: "Только POST" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return out(400, { error: "Плохой запрос" });
  }

  const user = verify(body.initData || "");
  if (!user) return out(401, { error: "Открой кабинет из Telegram" });

  const st = store(event);
  const admin = isAdmin(user.id);

  if (body.action === "info") {
    return out(200, {
      name: user.first_name || "",
      isAdmin: admin,
      appLink: process.env.APP_LINK || "",
    });
  }

  const sounds = await load(st);

  if (body.action === "list") {
    const items = Object.entries(sounds)
      .filter(([, s]) => admin || s.owner === user.id)
      .map(([id, s]) => ({
        id,
        emoji: s.emoji,
        set: s.set,
        kind: s.kind,
        ownerName: s.ownerName,
        mine: s.owner === user.id,
        ts: s.ts,
      }))
      .sort((a, b) => b.ts - a.ts);
    return out(200, { items });
  }

  const s = sounds[body.id];
  if (!s) return out(404, { error: "Звук не найден" });
  if (!admin && s.owner !== user.id) return out(403, { error: "Это не твой звук" });

  if (body.action === "play") {
    const method = s.kind === "audio" ? "sendAudio" : "sendVoice";
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        chat_id: user.id,
        [s.kind === "audio" ? "audio" : "voice"]: s.file_id,
      }),
    });
    const j = await r.json();
    if (!j.ok) return out(502, { error: j.description });
    return out(200, { ok: true });
  }

  if (body.action === "delete") {
    delete sounds[body.id];
    await save(st, sounds);
    return out(200, { ok: true });
  }

  return out(400, { error: "Неизвестное действие" });
};