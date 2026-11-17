const H = { "Content-Type": "application/json" };
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const tgUrl = (m) => `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`;

async function tg(method, payload) {
  const r = await fetch(tgUrl(method), { method: "POST", headers: H, body: JSON.stringify(payload) });
  const j = await r.json();
  console.log(method, JSON.stringify(j).slice(0, 200));
  return j;
}

async function loadHw(st) {
  try {
    return (await st.get("homework", { type: "json" })) || {};
  } catch (e) {
    console.log("homework read failed:", e.message);
    return {};
  }
}
async function saveHw(st, all) {
  const old = Date.now() - 30 * 864e5;
  for (const [id, h] of Object.entries(all)) {
    if (h.posted && (h.postedAt || h.ts) < old) delete all[id];
  }
  await st.setJSON("homework", all);
}

const dateLabel = (date) => {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};

/* ---------- привязка домашки к паре ---------- */
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// есть ли в этот день пара по предмету (отменённые не считаем)
function lessonOn(day, subject) {
  const key = norm(subject);
  return !!day && !day.empty && day.pairs.some((p) => p.entries.some((e) => !e.cancelled && norm(e.subject) === key));
}

// все предметы расписания: norm -> красивое название
function subjectsOf(schedule) {
  const m = new Map();
  for (const d of schedule?.days || [])
    for (const p of d.pairs)
      for (const e of p.entries) if (!e.cancelled && e.subject && !m.has(norm(e.subject))) m.set(norm(e.subject), e.subject.trim());
  return m;
}

// ближайший день не раньше fromDate, когда есть пара по предмету ("" — в расписании не нашли)
function nextLesson(schedule, subject, fromDate) {
  const d = (schedule?.days || []).filter((x) => x.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date)).find((x) => lessonOn(x, subject));
  return d ? d.date : "";
}

// отправляем домашку в группу (без закрепа и без имени автора)
// chat по умолчанию — группа; можно передать id чата, чтобы прислать одному человеку
async function postHomework(h, chat = process.env.CHAT_ID) {
  const cap =
    `Домашнее задание` + (h.date ? ` на ${dateLabel(h.date)}` : "") +
    (h.subject ? ` · ${h.subject}` : "") +
    (h.text ? `\n\n${h.text}` : "");
  const vis = h.files.filter((f) => f.kind === "photo" || f.kind === "video");
  const docs = h.files.filter((f) => f.kind === "document");

  if (!vis.length && !docs.length) {
    return (await tg("sendMessage", { chat_id: chat, text: cap })).ok;
  }

  let ok = true;
  const segments = [vis, docs].filter((s) => s.length);
  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const caption = k === 0 ? cap : undefined;
    let j;
    if (seg.length === 1) {
      const f = seg[0];
      const field = f.kind === "photo" ? "photo" : f.kind === "video" ? "video" : "document";
      const method = { photo: "sendPhoto", video: "sendVideo", document: "sendDocument" }[f.kind];
      j = await tg(method, { chat_id: chat, [field]: f.file_id, ...(caption ? { caption } : {}) });
    } else {
      j = await tg("sendMediaGroup", {
        chat_id: chat,
        media: seg.map((f, i) => ({
          type: f.kind,
          media: f.file_id,
          ...(i === 0 && caption ? { caption } : {}),
        })),
      });
    }
    ok = ok && j.ok;
  }
  return ok;
}

// последняя отправленная в группу домашка (самая свежая дата не позже сегодня, не старше 14 дней)
function latestPosted(all, today) {
  const min = new Date(Date.parse(today) - 14 * 864e5).toISOString().slice(0, 10);
  const posted = Object.values(all).filter((h) => h.posted && h.date <= today && h.date >= min);
  if (!posted.length) return [];
  const date = posted.reduce((m, h) => (h.date > m ? h.date : m), "");
  return posted.filter((h) => h.date === date).sort((a, b) => a.ts - b.ts);
}

// домашка по паре: если завтра есть этот предмет, отправляем её в группу
async function postIfLessonTomorrow(h, schedule, tomorrow) {
  const day = (schedule?.days || []).find((d) => d.date === tomorrow);
  if (!lessonOn(day, h.subject)) return false;
  h.date = tomorrow;
  if (!(await postHomework(h))) return false;
  h.posted = true;
  h.postedAt = Date.now();
  return true;
}

module.exports = {
  loadHw, saveHw, postHomework, dateLabel, latestPosted,
  norm, lessonOn, subjectsOf, nextLesson, postIfLessonTomorrow,
};