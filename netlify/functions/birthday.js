const { store, nskInfo } = require("../../lib/natk");
const { isMember } = require("../../lib/sounds");
const HOLIDAYS = require("../../lib/holidays");

const H = { "Content-Type": "application/json" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  console.log(method, JSON.stringify(j).slice(0, 200));
  return j;
}

// каждый день в 9:00 по Новосибирску (02:00 UTC) поздравляем именинников
async function holiday(st, today) {
  const text = HOLIDAYS[today.slice(5)];
  if (!text) return;
  const key = `holiday-${today}`;
  try {
    if (await st.get(key)) return; // уже поздравляли
  } catch {}
  const j = await tg("sendMessage", { chat_id: process.env.CHAT_ID, text });
  if (j.ok) {
    try {
      await st.set(key, "1");
    } catch (e) {
      console.log("holiday mark failed:", e.message);
    }
  }
}

exports.handler = async (event) => {
  const st = store(event);
  const today = nskInfo().date; // YYYY-MM-DD
  const year = Number(today.slice(0, 4));
  try {
    await holiday(st, today);
  } catch (e) {
    console.log("holiday failed:", e.message);
  }
  let md = today.slice(5);
  // 29 февраля в невисокосный год отмечаем 28-го
  const feb29 = md === "02-28" && !isLeap(year);

  let people = [];
  try {
    const { blobs } = await st.list({ prefix: "person-" });
    people = (await Promise.all(blobs.map((b) => st.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
  } catch (e) {
    console.log("birthday: list failed:", e.message);
    return { statusCode: 200 };
  }

  const due = people.filter(
    (p) => p.bd && (p.bd === md || (feb29 && p.bd === "02-29")) && p.bdDone !== year
  );
  if (!due.length) return { statusCode: 200 };

  const names = [];
  const done = [];
  for (const p of due) {
    try {
      if (await isMember(p.id)) names.push(`<a href="tg://user?id=${p.id}">${esc(p.name || "именинник")}</a>`);
      done.push(p); // не в группе — пропускаем, но второй раз не проверяем
    } catch (e) {
      console.log("birthday: member check failed:", e.message);
    }
  }
  if (!names.length) {
    for (const p of done) await st.setJSON(`person-${p.id}`, { ...p, bdDone: year });
    return { statusCode: 200 };
  }

  const text =
    names.length === 1
      ? `🎉 Сегодня день рождения у ${names[0]}!\nПоздравляем и желаем всего самого лучшего! 🎂`
      : `🎉 Сегодня день рождения у ${names.join(", ")}!\nПоздравляем и желаем всего самого лучшего! 🎂`;

  const j = await tg("sendMessage", {
    chat_id: process.env.CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (j.ok) {
    for (const p of done) {
      try {
        await st.setJSON(`person-${p.id}`, { ...p, bdDone: year });
      } catch (e) {
        console.log("birthday: mark failed:", e.message);
      }
    }
  }
  return { statusCode: 200 };
};
