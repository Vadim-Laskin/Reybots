const crypto = require("crypto");
const { store } = require("../../lib/natk");

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
  const admins = (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const isAdmin = admins.includes(String(user.id));

  let settings = {};
  try {
    settings = (await st.get("settings", { type: "json" })) || {};
  } catch (e) {
    console.log("settings read failed:", e.message);
  }
  const enabled = () => settings.voiceReply !== false;

  if (body.action === "info") {
    return out(200, {
      name: user.first_name || "",
      isAdmin,
      enabled: enabled(),
      appLink: process.env.APP_LINK || "",
      hasVoice: !!process.env.VOICE,
    });
  }

  if (body.action === "toggle") {
    if (!isAdmin) return out(403, { error: "Менять может только админ" });
    settings.voiceReply = !enabled();
    await st.setJSON("settings", settings);
    return out(200, { enabled: enabled() });
  }

  if (body.action === "preview") {
    if (!process.env.VOICE) return out(400, { error: "Голосовое не задано в боте" });
    const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendVoice`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ chat_id: user.id, voice: process.env.VOICE }),
    });
    const j = await r.json();
    console.log("preview sendVoice:", JSON.stringify(j));
    if (!j.ok) return out(502, { error: j.description });
    return out(200, { ok: true });
  }

  return out(400, { error: "Неизвестное действие" });
};