const crypto = require("crypto");
const { store, nskInfo, getSchedule } = require("../../lib/natk");
const { loadHw, saveHw, postHomework, norm, subjectsOf, subgroupSubjects, nextLesson, postIfLessonTomorrow } = require("../../lib/homework");
const nextBd = (bd, today) => {
  // сколько дней до ближайшего дня рождения (29 февраля в невисокосный год — 28-го)
  const [y, m, d] = today.split("-").map(Number);
  const t0 = Date.UTC(y, m - 1, d);
  const [bm, bdd] = bd.split("-").map(Number);
  const at = (yy) => Date.UTC(yy, bm - 1, bm === 2 && bdd === 29 && new Date(yy, 1, 29).getDate() !== 29 ? 28 : bdd);
  let t = at(y);
  if (t < t0) t = at(y + 1);
  return Math.round((t - t0) / 864e5);
};
const { isAdmin, isMember, load, save } = require("../../lib/sounds");
const { sendUpdate } = require("../../lib/update");
const ai = require("../../lib/ai");
// пока ИИ только для админа; чтобы открыть всем участникам — переменная окружения AI_FOR_ALL=1
const AI_FOR_ALL = process.env.AI_FOR_ALL === "1";
const AI_LIMIT = 15; // сообщений за 5 минут на человека
const UPD_KEY = "updates";
const UPD_MAX = 3500;

const MAX_PER_USER = 15;
const MAX_SECONDS = 30;
const MAX_BYTES = 4 * 1024 * 1024;
const H = { "Content-Type": "application/json" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });
const tgUrl = (m) => `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`;
const personKey = (id) => "person-" + id;

const HW_MAX_FILES = 8;
const HW_MAX_BYTES = 15 * 1024 * 1024;
const HW_MAX_CHUNKS = 6;
// раздел «Информатика»: файлы по двум предметам, грузит только админ
const MAT_SUBJ = {
  itpd: "Информационные технологии в профессиональной деятельности",
  infvt: "Информатика и вычислительная техника",
};
const MAT_KEY = "materials";
const MAT_MAX = 200;
const loadMat = async (st) => {
  try {
    return (await st.get(MAT_KEY, { type: "json" })) || {};
  } catch {
    return {};
  }
};
const matView = (m, admin) => ({
  id: m.id,
  subj: m.subj,
  title: m.title,
  name: m.name,
  size: m.size || 0,
  ts: m.ts,
});
const addDays = (date, n) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10);
const hwView = (h, uid, admin, expected = "") => ({
  id: h.id,
  date: h.date || "",
  expected,
  mode: h.mode || "date",
  subject: h.subject || "",
  sg: h.sg || 0,
  text: h.text,
  // file_id нужен автору и админу, чтобы изменить домашку
  files: h.files.map((f) => ({ kind: f.kind, name: f.name, ...(admin || h.author === uid ? { file_id: f.file_id } : {}) })),
  posted: !!h.posted,
  mine: h.author === uid,
  ts: h.ts,
  sender: admin ? `${h.authorName}${h.authorUsername ? " @" + h.authorUsername : ""}` : "",
});

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
      bd: p.bd || "",
      ai: admin || AI_FOR_ALL,
      aiName: ai.NAME,
    });
  }

  /* ---------- день рождения (только свой) ---------- */
  if (body.action === "bd_set") {
    if (!(await isMember(user.id))) {
      return out(403, { error: "Указать день рождения могут только участники группы" });
    }
    const day = Number(body.day), month = Number(body.month);
    const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > maxDay) {
      return out(400, { error: "Некорректная дата" });
    }
    const name = user.first_name || "";
    const username = user.username || "";
    const p = (await getPerson(st, user.id)) || { sg: 0 };
    const bd = String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
    if (p.bd !== bd) delete p.bdDone;
    await st.setJSON(personKey(user.id), { ...p, id: user.id, name, username, bd, ts: Date.now() });
    return out(200, { bd });
  }

  // список дней рождений (имя и дата), ближайшие сверху
  if (body.action === "bd_list") {
    if (!(await isMember(user.id))) return out(403, { error: "Только для участников группы" });
    let list = [];
    try {
      const { blobs } = await st.list({ prefix: "person-" });
      list = (await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }).catch(() => null)))).filter((p) => p && p.bd);
    } catch (e) {
      console.log("bd list failed:", e.message);
    }
    const today = nskInfo().date;
    const items = list
      .map((p) => ({ name: p.name || "?", bd: p.bd, days: nextBd(p.bd, today), mine: p.id === user.id }))
      .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name, "ru"));
    return out(200, { items });
  }

  if (body.action === "bd_clear") {
    const p = await getPerson(st, user.id);
    if (p) {
      delete p.bd;
      delete p.bdDone;
      await st.setJSON(personKey(user.id), p);
    }
    return out(200, { ok: true });
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
  
    /* ---------- домашка ---------- */
  if (body.action === "hw_file") {
    const uid = String(body.uid || "");
    const i = Number(body.i), n = Number(body.n);
    if (!/^[\w-]{6,40}$/.test(uid) || !Number.isInteger(i) || !Number.isInteger(n) || i < 0 || n < 1 || n > HW_MAX_CHUNKS || i >= n) {
      return out(400, { error: "Плохой запрос загрузки" });
    }
    const mat = body.purpose === "mat";
    if (mat && !admin) return out(403, { error: "Материалы загружает только админ" });
    if (i === 0 && !mat && !(await isMember(user.id))) {
      return out(403, { error: "Загружать домашку могут только участники группы" });
    }
    const key = (k) => `hwc-${user.id}-${uid}-${k}`;
    await st.set(key(i), String(body.data || ""));
    if (i < n - 1) return out(200, { ok: true });

    // последний кусок: собираем файл
    const parts = [];
    for (let k = 0; k < n; k++) {
      let part = k === n - 1 ? String(body.data || "") : null;
      for (let t = 0; t < 4 && !part; t++) {
        try {
          part = await st.get(key(k));
        } catch (e) {
          console.log("chunk read failed:", e.message);
        }
        if (!part) await new Promise((r) => setTimeout(r, 600));
      }
      if (!part) return out(500, { error: "Не удалось собрать файл, попробуй ещё раз" });
      parts.push(Buffer.from(part, "base64"));
    }
    for (let k = 0; k < n; k++) {
      try {
        await st.delete(key(k));
      } catch {}
    }
    const buf = Buffer.concat(parts);
    if (!buf.length || buf.length > HW_MAX_BYTES) {
      return out(400, { error: "Файл пустой или больше 15 МБ" });
    }

    const kind = mat ? "document" : ["photo", "video", "document"].includes(body.kind) ? body.kind : "document";
    const name = String(body.name || "file").slice(0, 80);
    const sendOne = async (method, field) => {
      const fd = new FormData();
      fd.append("chat_id", String(user.id));
      fd.append("caption", mat ? "Файл для раздела «Информатика»." : "Файл для домашки. В группу уйдёт в назначенный день.");
      fd.append(field, new Blob([buf]), name);
      const j = await (await fetch(tgUrl(method), { method: "POST", body: fd })).json();
      console.log(method, JSON.stringify(j).slice(0, 200));
      if (!j.ok) return null;
      const r = j.result;
      if (r.photo) return { file_id: r.photo[r.photo.length - 1].file_id, kind: "photo", name };
      if (r.video) return { file_id: r.video.file_id, kind: "video", name };
      if (r.document) return { file_id: r.document.file_id, kind: "document", name };
      return null;
    };
    let res = null;
    if (kind === "photo") res = await sendOne("sendPhoto", "photo");
    else if (kind === "video") res = await sendOne("sendVideo", "video");
    if (!res) res = await sendOne("sendDocument", "document");
    if (!res) {
      return out(502, { error: "Telegram не принял файл. Напиши боту /start в личку и попробуй другой файл" });
    }
    return out(200, { ...res, size: buf.length });
  }

  /* ---------- обновления: админ шлёт сообщение в группу ---------- */
  if (body.action === "upd_list") {
    if (!admin) return out(403, { error: "Только для админа" });
    let items = [];
    try { items = (await st.get(UPD_KEY, { type: "json" })) || []; } catch {}
    return out(200, { items });
  }
  if (body.action === "upd_send") {
    if (!admin) return out(403, { error: "Только для админа" });
    const text = String(body.text || "").trim();
    if (!text) return out(400, { error: "Напиши текст обновления" });
    if (text.length > UPD_MAX) return out(400, { error: `Слишком длинно, максимум ${UPD_MAX} символов` });
    try {
      await sendUpdate(text);
    } catch (e) {
      return out(502, { error: e.message });
    }
    let items = [];
    try { items = (await st.get(UPD_KEY, { type: "json" })) || []; } catch {}
    items.unshift({ ts: Date.now(), text, author: user.id });
    await st.setJSON(UPD_KEY, items.slice(0, 10));
    return out(200, { ok: true, items: items.slice(0, 10) });
  }

  /* ---------- Информатика: материалы ---------- */
  if (body.action === "mat_list") {
    if (!(await isMember(user.id))) return out(403, { error: "Только для участников группы" });
    const items = Object.values(await loadMat(st))
      .sort((a, b) => b.ts - a.ts)
      .map((m) => matView(m, admin));
    return out(200, { items, subjects: MAT_SUBJ });
  }

  if (body.action === "mat_add") {
    if (!admin) return out(403, { error: "Материалы добавляет только админ" });
    const subj = String(body.subj || "");
    if (!MAT_SUBJ[subj]) return out(400, { error: "Выбери предмет" });
    const f = body.file || {};
    if (typeof f.file_id !== "string" || !f.file_id) return out(400, { error: "Сначала загрузи файл" });
    const name = String(f.name || "файл").slice(0, 80);
    const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 120) || name;
    const all = await loadMat(st);
    if (Object.keys(all).length >= MAT_MAX) return out(400, { error: "Слишком много материалов, удали ненужные" });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    all[id] = { id, subj, title, name, size: Number(f.size) || 0, file_id: f.file_id.slice(0, 250), ts: Date.now(), author: user.id };
    await st.setJSON(MAT_KEY, all);
    return out(200, { item: matView(all[id], admin) });
  }

  if (body.action === "mat_del") {
    if (!admin) return out(403, { error: "Удалять материалы может только админ" });
    const all = await loadMat(st);
    if (!all[body.id]) return out(404, { error: "Материал не найден" });
    delete all[body.id];
    await st.setJSON(MAT_KEY, all);
    return out(200, { ok: true });
  }

  // получить файл: бот присылает его в личку
  if (body.action === "mat_get") {
    if (!(await isMember(user.id))) return out(403, { error: "Только для участников группы" });
    const m = (await loadMat(st))[body.id];
    if (!m) return out(404, { error: "Материал не найден" });
    const j = await (
      await fetch(tgUrl("sendDocument"), {
        method: "POST",
        headers: H,
        body: JSON.stringify({ chat_id: user.id, document: m.file_id, caption: `${m.title}\n${MAT_SUBJ[m.subj] || ""}` }),
      })
    ).json();
    console.log("mat_get", JSON.stringify(j).slice(0, 200));
    if (!j.ok) return out(502, { error: "Не получилось отправить. Напиши боту /start в личку и попробуй снова" });
    return out(200, { ok: true });
  }

  // расписание для привязки домашки к паре (из кэша; если сайт недоступен — null)
  const schedule = async () => {
    try {
      return await getSchedule(event, { maxAge: 10 * 60 * 1000 });
    } catch (e) {
      console.log("hw: расписание недоступно:", e.message);
      return null;
    }
  };

  // общая проверка полей домашки для hw_add и hw_edit
  const hwClean = async () => {
    let subject = String(body.subject || "").replace(/\s+/g, " ").trim();
    if (!subject) return { error: "Выбери предмет" };
    if (subject.length > 120) return { error: "Слишком длинное название предмета" };
    let sg = Number(body.sg) === 1 || Number(body.sg) === 2 ? Number(body.sg) : 0;
    const sch = await schedule();
    if (sch) {
      const known = subjectsOf(sch).get(norm(subject));
      if (!known) return { error: "Такого предмета нет в расписании. Выбери из списка" };
      subject = known;
      // у предметов по подгруппам (иностранный язык, компьютерная графика) подгруппа обязательна
      if (subgroupSubjects(sch).has(norm(subject))) {
        if (!sg) return { error: "Выбери подгруппу" };
      } else sg = 0;
    }
    const text = String(body.text || "").trim();
    if (text.length > 900) return { error: "Текст слишком длинный, максимум 900 символов" };
    const files = (Array.isArray(body.files) ? body.files : [])
      .slice(0, HW_MAX_FILES)
      .filter((f) => f && typeof f.file_id === "string" && ["photo", "video", "document"].includes(f.kind))
      .map((f) => ({ file_id: f.file_id.slice(0, 250), kind: f.kind, name: String(f.name || "").slice(0, 80) }));
    // если часть вложений отсеялась (битый file_id, лишние), не отправляем молча без них
    if (body.nfiles !== undefined && Number(body.nfiles) !== files.length) {
      return { error: "Не все вложения загрузились. Загрузи их заново и повтори" };
    }
    if (!text && !files.length) return { error: "Добавь текст, фото, видео или файл" };
    return { subject, sg, text, files, sch };
  };

  // ближайшая пара по предмету (для подписи «ждёт пару»)
  const expectedOf = (h, sch) =>
    !h.posted && h.mode === "lesson" && sch ? nextLesson(sch, h.subject, nskInfo().tomorrow, h.sg || 0) : "";

  // картинка вложения для просмотра при редактировании (только автору и админу)
  if (body.action === "hw_img") {
    const fid = String(body.file_id || "");
    const all = await loadHw(st);
    const ok = Object.values(all).some((h) => (admin || h.author === user.id) && h.files.some((f) => f.file_id === fid && f.kind === "photo"));
    if (!fid || !ok) return out(404, { error: "Фото не найдено" });
    try {
      const g = await (await fetch(tgUrl("getFile"), { method: "POST", headers: H, body: JSON.stringify({ file_id: fid }) })).json();
      if (!g.ok) return out(502, { error: "Telegram не отдал фото" });
      const r = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${g.result.file_path}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || !buf.length) return out(502, { error: "Не удалось загрузить фото" });
      if (buf.length > 4.2 * 1024 * 1024) return out(413, { error: "Фото слишком большое для просмотра" });
      const mime = /\.png$/i.test(g.result.file_path) ? "image/png" : /\.webp$/i.test(g.result.file_path) ? "image/webp" : "image/jpeg";
      return out(200, { mime, data: buf.toString("base64") });
    } catch (e) {
      return out(502, { error: "Не удалось загрузить фото" });
    }
  }

  if (body.action === "hw_edit") {
    const all = await loadHw(st);
    const h = all[body.id];
    if (!h) return out(404, { error: "Домашка не найдена" });
    if (!admin && h.author !== user.id) return out(403, { error: "Менять можно только свою домашку" });
    if (h.posted) return out(400, { error: "Эта домашка уже отправлена, изменить нельзя" });
    const c = await hwClean();
    if (c.error) return out(400, { error: c.error });
    Object.assign(h, { subject: c.subject, sg: c.sg, text: c.text, files: c.files });
    if (!h.mode) { h.mode = "lesson"; h.date = ""; } // старая запись с датой становится «по паре»
    await saveHw(st, all);
    return out(200, { item: hwView(h, user.id, admin, expectedOf(h, c.sch)) });
  }

  if (body.action === "hw_add") {
    if (!(await isMember(user.id))) {
      return out(403, { error: "Загружать домашку могут только участники группы" });
    }
    const c = await hwClean();
    if (c.error) return out(400, { error: c.error });

    const all = await loadHw(st);
    const pending = Object.values(all).filter((h) => h.author === user.id && !h.posted).length;
    if (!admin && pending >= 10) return out(400, { error: "У тебя уже 10 неотправленных домашек" });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const hw = {
      id, mode: "lesson", date: "", subject: c.subject, sg: c.sg, text: c.text, files: c.files,
      author: user.id,
      authorName: user.first_name || "?",
      authorUsername: user.username || "",
      ts: Date.now(),
      posted: false,
    };
    all[id] = hw;
    // 18:01 уже прошло, а завтра есть эта пара: ждать до завтрашнего вечера поздно, отправляем сразу
    const nw = nskInfo();
    if (c.sch && nw.min >= 18 * 60 + 1) {
      try {
        await postIfLessonTomorrow(hw, c.sch, nw.tomorrow);
      } catch (e) {
        console.log("hw immediate post failed:", e.message);
      }
    }
    await saveHw(st, all);
    return out(200, { item: hwView(hw, user.id, admin, expectedOf(hw, c.sch)) });
  }

  // вся домашка видна всем участникам группы (без отправителя; его видит только админ)
  if (body.action === "hw_list") {
    if (!(await isMember(user.id))) return out(403, { error: "Только для участников группы" });
    const all = Object.values(await loadHw(st));
    const sch = all.some((h) => !h.posted && h.mode === "lesson") ? await schedule() : null;
    const items = all
      .sort((a, b) =>
        (a.posted ? 1 : 0) - (b.posted ? 1 : 0) ||
        (a.posted ? (b.date || "").localeCompare(a.date || "") || b.ts - a.ts : b.ts - a.ts)
      )
      .map((h) => hwView(h, user.id, admin, expectedOf(h, sch)));
    return out(200, { items });
  }

  if (body.action === "hw_del") {
    const all = await loadHw(st);
    const h = all[body.id];
    if (!h) return out(404, { error: "Домашка не найдена" });
    if (!admin && !(h.author === user.id && !h.posted)) {
      return out(403, { error: "Удалить можно только свою неотправленную домашку" });
    }
    delete all[body.id];
    await saveHw(st, all);
    return out(200, { ok: true });
  }

  if (body.action === "hw_now") {
    if (!admin) return out(403, { error: "Только для админа" });
    const all = await loadHw(st);
    const h = all[body.id];
    if (!h) return out(404, { error: "Домашка не найдена" });
    if (h.posted) return out(400, { error: "Уже отправлено" });
    if (h.mode === "lesson" && !h.date) {
      const sch = await schedule();
      h.date = (sch && nextLesson(sch, h.subject, nskInfo().tomorrow, h.sg || 0)) || "";
    }
    if (!(await postHomework(h))) return out(502, { error: "Не удалось отправить в группу" });
    h.posted = true;
    h.postedAt = Date.now();
    await saveHw(st, all);
    return out(200, { item: hwView(h, user.id, true) });
  }

  /* ---------- ИИ-помощник ---------- */
  if (body.action === "ai_chat") {
    if (!(admin || (AI_FOR_ALL && (await isMember(user.id))))) return out(403, { error: "ИИ пока доступен только админу" });
    const messages = ai.cleanMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") return out(400, { error: "Напиши сообщение" });
    // не больше AI_LIMIT сообщений за 5 минут
    const rk = "ai-rate-" + user.id;
    let hits = [];
    try { hits = ((await st.get(rk, { type: "json" })) || []).filter((t) => Date.now() - t < 5 * 60 * 1000); } catch {}
    if (hits.length >= AI_LIMIT) return out(429, { error: "Мурзик устал, подожди пару минут" });
    hits.push(Date.now());
    try { await st.setJSON(rk, hits); } catch {}

    // собираем только то, что видит обычный участник; админские данные (отправители, участники, чужие заявки, рассылки) не берём
    const nw = nskInfo();
    const p = (await getPerson(st, user.id)) || {};
    const sch = await schedule();
    const hwAll = Object.values(await loadHw(st));
    const weekAgo = Date.now() - 14 * 864e5;
    const homework = hwAll
      .filter((h) => !h.posted || (h.postedAt || h.ts) > weekAgo)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 25)
      .map((h) => ({ subject: h.subject, sg: h.sg || 0, text: h.text, files: h.files.length, posted: !!h.posted, date: h.date, expected: expectedOf(h, sch) }));
    const materials = Object.values(await loadMat(st)).sort((a, b) => b.ts - a.ts).slice(0, 40).map((m) => ({ subj: MAT_SUBJ[m.subj] || m.subj, title: m.title }));
    const ideas = Object.values(await loadIdeas(st)).filter((i) => i.author === user.id).slice(0, 10).map((i) => ({ text: i.text, status: STATUS[i.status] || i.status, comment: i.comment || "" }));
    let birthdays = [];
    try {
      const { blobs } = await st.list({ prefix: "person-" });
      const ppl = (await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }).catch(() => null)))).filter((x) => x && x.bd);
      birthdays = ppl.map((x) => ({ name: x.name || "?", bd: x.bd, days: nextBd(x.bd, nw.date) })).sort((a, b) => a.days - b.days).slice(0, 8);
    } catch {}
    const context = ai.buildContext({
      now: { ...nw, dateMs: Date.parse(nw.date + "T00:00:00Z") },
      person: { name: user.first_name || "", sg: p.sg || 0 },
      schedule: sch, homework, materials, ideas, birthdays,
    });
    try {
      return out(200, { reply: await ai.chat(messages, context) });
    } catch (e) {
      return out(e.status || 502, { error: e.message + (e.diag && admin ? " " + e.diag : "") });
    }
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