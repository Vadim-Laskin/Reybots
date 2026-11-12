const { getSchedule, store, nskInfo, toMin } = require("../../lib/natk");
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
  s.days.forEach((d) => (next[d.date] = JSON.stringify([d.empty, d.pairs])));
  try {
    await st.setJSON("watch", next);
  } catch (e) {
    console.log("watch save failed:", e.message);
  }
  if (!prev) return { statusCode: 200 }; // первый запуск: только запоминаем

  const n = nskInfo();
  for (const [date, prefix] of [[n.date, "Сегодня"], [n.tomorrow, "Завтра"]]) {
    const d = s.days.find((x) => x.date === date);
    if (!d || prev[date] === next[date]) continue;
    if (date === n.date && !d.pairs.some((p) => toMin(p.end) > n.min)) continue; // день уже прошёл
    await sendDay(
  { ...d, title: `${prefix}, ${d.label}` },
  `⚠️ Изменение в расписании: ${prefix.toLowerCase()}, ${d.label}`,
  event
);
  }
  return { statusCode: 200 };
};