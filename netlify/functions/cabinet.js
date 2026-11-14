const crypto = require("crypto");
const { store } = require("../../lib/natk");
const { isAdmin, isMember, load, save } = require("../../lib/sounds");

const MAX_PER_USER = 5;
const MAX_SECONDS = 30;
const MAX_BYTES = 4 * 1024 * 1024;
const H = { "Content-Type": "application/json" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });
const tgUrl = (m) => `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`;
const personKey = (id) => "person-" + id;

const STATUS = {
  review: "На проверке",
  planned: "Принято",
  dev: "Разрабатывается",
  done: "Разработано",
  rejected: "Отказано",
};
const adminList = () =>
  (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

async function dm(chat, text) {
  try {
    await fetch(tgUrl("sendMessage"), {
      method: "POST",
      headers: H,
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (e) {
    console.log("dm failed:", e.message);
  }
}

async function loadIdeas(st) {
  try {
    return (await st.get("ideas", { type: "json" })) || {};
  } catch (e) {
    console.log("ideas read failed:", e.message);
    return {};
  }
}
const ideaView = (i, uid) => ({
  id: i.id,
  text: i.text,
  author: i.authorName,
  mine: i.author === uid,
  status: i.status,
  comment: i.comment || "",
  ts: i.ts,
});

async function getPerson(st, id) {
  try {
    return await st.get(personKey(id), { type: "json" });
  } catch (e) {
    console.log("person read failed:", e.message);
    return null;
  }
}

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
  return {
    error: "Не удалось отправить файл в Telegram. Напиши боту /start в личку и попробуй другой файл",
  };
}

async function main(event) {
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

  /* ---------- профиль и подгруппы ---------- */
  if (body.action === "info") {
    const name = user.first_name || "";
    const username = user.username || "";
    let p = await getPerson(st, user.id);
    if (!p || p.name !== name || p.username !== username) {
      p = { ...(p || { sg: 0 }), id: user.id, name, username, ts: Date.now() };
      try {
        await st.setJSON(personKey(user.id), p);
      } catch (e) {
        console.log("person save failed:", e.message);
      }
    }
    return out(200, {
      id: user.id,
      name,
      isAdmin: admin,
      appLink: process.env.APP_LINK || "",
      sg: p.sg || 0,
    });
  }

  if (body.action === "people") {
    if (!admin) return out(403, { error: "Только для админа" });
    let list = [];
    try {
      const { blobs } = await st.list({ prefix: "person-" });
      list = (
        await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }).catch(() => null)))
      ).filter(Boolean);
    } catch (e) {
      console.log("people list failed:", e.message);
    }
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    return out(200, {
      people: list.map((p) => ({ id: p.id, name: p.name, username: p.username, sg: p.sg || 0 })),
    });
  }

  if (body.action === "setsg") {
    if (!admin) return out(403, { error: "Только для админа" });
    const sg = Number(body.sg);
    if (![0, 1, 2].includes(sg)) return out(400, { error: "Подгруппа 1, 2 или без подгруппы" });
    const id = String(body.id || "");
    if (!/^\d{1,20}$/.test(id)) return out(400, { error: "Плохой id" });
    const p = await getPerson(st, id);
    if (!p) return out(404, { error: "Человек не найден" });
    p.sg = sg;
    await st.setJSON(personKey(id), p);
    return out(200, { ok: true });
  }

  /* ---------- улучшения ---------- */
  if (body.action === "ideas") {
    const ideas = await loadIdeas(st);
    const items = Object.values(ideas)
      .sort((a, b) => b.ts - a.ts)
      .map((i) => ideaView(i, user.id));
    return out(200, { items });
  }

  if (body.action === "idea_add") {
    if (!(await isMember(user.id))) {
      return out(403, { error: "Предлагать идеи могут только участники группы" });
    }
    const text = String(body.text || "").replace(/\s+/g, " ").trim();
    if (text.length < 5) return out(400, { error: "Опиши идею подробнее (минимум 5 символов)" });
    if (text.length > 300) return out(400, { error: "Слишком длинно, максимум 300 символов" });
    const ideas = await loadIdeas(st);
    const waiting = Object.values(ideas).filter((i) => i.author === user.id && i.status === "review").length;
    if (!admin && waiting >= 5) {
      return out(400, { error: "У тебя уже 5 идей на проверке. Дождись ответа" });
    }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const idea = {
      id, text, author: user.id, authorName: user.first_name || "?",
      status: "review", comment: "", ts: Date.now(),
    };
    ideas[id] = idea;
    await st.setJSON("ideas", ideas);
    for (const a of adminList()) {
      if (a !== String(user.id)) await dm(a, `Новая идея от ${idea.authorName}:\n${text}`);
    }
    return out(200, { item: ideaView(idea, user.id) });
  }

  if (body.action === "idea_del") {
    const ideas = await loadIdeas(st);
    const i = ideas[body.id];
    if (!i) return out(404, { error: "Идея не найдена" });
    if (!admin && !(i.author === user.id && i.status === "review")) {
      return out(403, { error: "Удалить можно только свою идею, пока она на проверке" });
    }
    delete ideas[body.id];
    await st.setJSON("ideas", ideas);
    return out(200, { ok: true });
  }

  if (body.action === "idea_set") {
    if (!admin) return out(403, { error: "Только для админа" });
    if (!STATUS[body.status]) return out(400, { error: "Неизвестный статус" });
    const ideas = await loadIdeas(st);
    const i = ideas[body.id];
    if (!i) return out(404, { error: "Идея не найдена" });
    const comment = String(body.comment || "").trim().slice(0, 200);
    const changed = i.status !== body.status || (i.comment || "") !== comment;
    i.status = body.status;
    i.comment = comment;
    await st.setJSON("ideas", ideas);
    if (changed && i.author !== user.id) {
      await dm(
        i.author,
        `Твоя идея «${i.text.slice(0, 80)}»\nСтатус: ${STATUS[i.status]}` +
          (comment ? `\nКомментарий: ${comment}` : "")
      );
    }
    return out(200, { item: ideaView(i, user.id) });
  }

  /* ---------- звуки ---------- */
  const sounds = await load(st);

  if (body.action === "list") {
    const items = Object.entries(sounds)
      .filter(([, s]) => admin || s.owner === user.id)
      .map(([id, s]) => ({
        id,
        emoji: s.emoji,
        set: s.set,
        thumb: s.thumb || "",
        kind: s.kind,
        ownerName: s.ownerName,
        mine: s.owner === user.id,
        ts: s.ts,
      }))
      .sort((a, b) => b.ts - a.ts);
    return out(200, { items });
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
    if (!(await isMember(user.id))) {
      return out(403, { error: "Добавлять звуки могут только участники группы" });
    }
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
    if (!buf.length || buf.length > MAX_BYTES) {
      return out(400, { error: "Файл пустой или больше 4 МБ" });
    }

    const sent = await sendFile(user.id, buf, String(body.filename || "sound.mp3").slice(0, 80));
    if (sent.error) return out(400, { error: sent.error });

    const entry = {
      file_id: sent.file_id,
      kind: sent.kind,
      owner: user.id,
      ownerName: user.first_name || "?",
      emoji: String(body.emoji || "").slice(0, 8),
      set: String(body.set || "").slice(0, 64),
      thumb: String(body.thumb || "").slice(0, 200),
      ts: Date.now(),
    };
    sounds[id] = entry;
    await save(st, sounds);

    // копия исходного файла для проигрывания в приложении
    try {
      await st.setJSON("audio-" + id, {
        mime: String(body.mime || "audio/mpeg").slice(0, 40),
        data: String(body.audio),
      });
    } catch (e) {
      console.log("audio copy failed:", e.message);
    }

    return out(200, {
      ok: true,
      item: {
        id, emoji: entry.emoji, set: entry.set, thumb: entry.thumb, kind: entry.kind,
        ownerName: entry.ownerName, mine: true, ts: entry.ts,
      },
    });
  }

  const s = sounds[body.id];
  if (!s) return out(404, { error: "Звук не найден" });
  if (!admin && s.owner !== user.id) return out(403, { error: "Это не твой звук" });

  if (body.action === "sticker") {
    let thumb = s.thumb || "";
    if (!thumb && s.set) {
      try {
        const j = await (await fetch(tgUrl("getStickerSet") + `?name=${encodeURIComponent(s.set)}`)).json();
        const found = j.ok && j.result.stickers.find((x) => x.file_unique_id === body.id);
        if (found) {
          thumb = found.thumbnail?.file_id || found.file_id;
          s.thumb = thumb;
          sounds[body.id] = s;
          await save(st, sounds);
        }
      } catch (e) {
        console.log("sticker lookup failed:", e.message);
      }
    }
    return out(200, { thumb });
  }

  if (body.action === "audio") {
    let copy = null;
    try {
      copy = await st.get("audio-" + body.id, { type: "json" });
    } catch (e) {
      console.log("audio read failed:", e.message);
    }
    if (copy?.data) return out(200, { mime: copy.mime, data: copy.data });

    // запасной вариант: файл из Telegram
    const g = await (await fetch(tgUrl("getFile") + `?file_id=${encodeURIComponent(s.file_id)}`)).json();
    if (!g.ok) return out(502, { error: g.description || "Файл недоступен" });
    const r = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${g.result.file_path}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return out(400, { error: "Файл слишком большой" });
    const ext = g.result.file_path.split(".").pop().toLowerCase();
    const mime =
      { mp3: "audio/mpeg", m4a: "audio/mp4", oga: "audio/ogg", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav" }[ext] ||
      "audio/ogg";
    return out(200, { mime, data: buf.toString("base64") });
  }

  if (body.action === "play") {
    const method = s.kind === "audio" ? "sendAudio" : "sendVoice";
    const r = await fetch(tgUrl(method), {
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
    try {
      await st.delete("audio-" + body.id);
    } catch {}
    return out(200, { ok: true });
  }

  return out(400, { error: "Неизвестное действие" });
}

exports.handler = async (event) => {
  try {
    return await main(event);
  } catch (e) {
    console.log("cabinet error:", e.stack);
    return out(500, { error: "Ошибка сервера: " + e.message });
  }
};