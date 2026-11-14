const {
  getSchedule, store, nskInfo, toMin, sigOf, getPosted, savePosted,
} = require("../../lib/natk");
const { sendDay } = require("../../lib/render");

exports.handler = async (event) => {
  let s;
  try {
    s = await getSchedule(event);
  } catch (e) {
    console.log("watch: нет данных:", e.message);
    return { statusCode: 200 };
  }
  if (s.stale || !s.days.length) {
    console.log("watch: сайт недоступен, пропускаю");
    return { statusCode: 200 };
  }

  const st = store(event);
  let prev = null;
  try {
    prev = await st.get("watch", { type: "json" });
  } catch (e) {
    console.log("watch read failed:", e.message);
  }

  const next = {};
  s.days.forEach((d) => (next[d.date] = sigOf(d)));
  try {
    await st.setJSON("watch", next);
  } catch (e) {
    console.log("watch save failed:", e.message);
  }
  if (!prev) return { statusCode: 200 }; // первый запуск: только запоминаем

  const n = nskInfo();
  const posted = await getPosted(st);
  let changed = false;

  for (const [date, prefix] of [[n.date, "Сегодня"], [n.tomorrow, "Завтра"]]) {
    const d = s.days.find((x) => x.date === date);
    if (!d || prev[date] === next[date]) continue;
    if (date === n.date && !d.pairs.some((p) => toMin(p.end) > n.min)) continue; // день уже прошёл
    if (posted[date] === next[date]) continue; // именно это расписание уже отправляли

    const id = await sendDay(
      { ...d, title: `${prefix}, ${d.label}` },
      `⚠️ Изменение в расписании: ${prefix.toLowerCase()}, ${d.label}`,
      event
    );
    if (id) {
      posted[date] = next[date];
      changed = true;
    }
  }
  if (changed) await savePosted(st, posted);
  return { statusCode: 200 };
};