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

// отправляем домашку в группу (без закрепа и без имени автора)
async function postHomework(h) {
  const chat = process.env.CHAT_ID;
  const cap = `Домашнее задание на ${dateLabel(h.date)}` + (h.text ? `\n\n${h.text}` : "");
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

module.exports = { loadHw, saveHw, postHomework, dateLabel };