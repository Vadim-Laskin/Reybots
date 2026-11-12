const crypto = require("crypto");
const { store } = require("../../lib/natk");
const { isAdmin, isMember, load, save } = require("../../lib/sounds");

const MAX_PER_USER = 5;
const MAX_SECONDS = 30;
const MAX_BYTES = 4 * 1024 * 1024;
const H = { "Content-Type": "application/json" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });
const tgUrl = (m) => `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`;

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

// отправляем файл пользователю, чтобы получить file_id
async function sendFile(chat, buf, filename) {
  for (const [method, field, kind] of [
    ["sendVoice", "voice", "voice"],
    ["sendAudio", "audio", "audio"],
  ]) {
    const fd = new FormData();
    fd.append("chat_id", String(chat));
    fd.append(field, new Blob([buf]), filename);
    const r = await fetch(tgUrl(method), { method: "POST", body: fd });
    const j = await r.json();
    console.log(method, JSON.stringify(j).slice(0, 300));
    if (j.ok) {
      const f = j.result[field];
      if ((f.duration || 0) > MAX_SECONDS) {
        await fetch(tgUrl("deleteMessage"), {
          method: "POST",
          headers: H,
          body: JSON.stringify({ chat_id: chat, message_id: j.result.message_id }),
        });
        return { error: `Слишком длинно, максимум ${MAX_SECONDS} секунд` };
      }
      return { file_id: f.file_id, kind };
    }
  }
  return { error: "Не удалось отправить файл в Telegram. Пришли боту /start в личку и попробуй другой файл" };
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
        id, emoji: s.emoji, set: s.set, kind: s.kind,
        ownerName: s.ownerName, mine: s.owner === user.id, ts: s.ts,
      }))
      .sort((a, b) => b.ts - a.ts);
    return out(200, { items });
  }

  if (body.action === "seen") {
    let seen = [];
    try {
      seen = (await st.get("seen", { type: "json" })) || [];
    } catch {}
    return out(200, { stickers: seen.map(({ uid, thumb, emoji, set }) => ({ uid, thumb, emoji, set })) });
  }

  if (body.action === "pack") {
    const name = String(body.name || "")
      .trim()
      .replace(/^.*addstickers\//, "")
      .replace(/[?#].*$/, "");
    if (!/^\w{1,64}$/.test(name)) return out(400, { error: "Не похоже на название набора" });
    const j = await (await fetch(tgUrl("getStickerSet") + `?name=${encodeURIComponent(name)}`)).json();
    if (!j.ok) return out(404, { error: "Набор не найден" });
    return out(200, {
      stickers: j.result.stickers.slice(0, 120).map((s) => ({
        uid: s.file_unique_id,
        thumb: s.thumbnail?.file_id || s.file_id,
        emoji: s.emoji || "",
        set: j.result.name,
      })),
    });
  }

  if (body.action === "upload") {
    if (!(await isMember(user.id))) return out(403, { error: "Добавлять звуки могут только участники группы" });
    const id = String(body.id || "");
    if (!/^[\w-]{1,100}$/.test(id)) return out(400, { error: "Не выбран стикер" });

    const cur = sounds[id];
    if (cur && cur.owner !== user.id && !admin) {
      return out(403, { error: `Звук уже добавил ${cur.ownerName}. Менять может автор или админ` });
    }
    const mine = Object.values(sounds).filter((x) => x.owner === user.id).length;
    if (!cur && !admin && mine >= MAX_PER_USER) {
      return out(400, { error: `Можно не больше ${MAX_PER_USER} звуков. Удали лишний` });
    }

    const buf = Buffer.from(String(body.audio || ""), "base64");
    if (!buf.length || buf.length > MAX_BYTES) return out(400, { error: "Файл пустой или больше 4 МБ" });

    const sent = await sendFile(user.id, buf, String(body.filename || "sound.mp3").slice(0, 80));
    if (sent.error) return out(400, { error: sent.error });

    sounds[id] = {
      file_id: sent.file_id,
      kind: sent.kind,
      owner: user.id,
      ownerName: user.first_name || "?",
      emoji: String(body.emoji || "").slice(0, 8),
      set: String(body.set || "").slice(0, 64),
      ts: Date.now(),
    };
    await save(st, sounds);
    return out(200, { ok: true });
  }

  const s = sounds[body.id];
  if (!s) return out(404, { error: "Звук не найден" });
  if (!admin && s.owner !== user.id) return out(403, { error: "Это не твой звук" });

  if (body.action === "play") {
    const method = s.kind === "audio" ? "sendAudio" : "sendVoice";
    const r = await fetch(tgUrl(method), {
      method: "POST",
      headers: H,
      body: JSON.stringify({ chat_id: user.id, [s.kind === "audio" ? "audio" : "voice"]: s.file_id }),
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