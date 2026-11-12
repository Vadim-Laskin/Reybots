const { getSchedule, nskInfo, toMin, fmtTime } = require("../../lib/natk");
const { send, sendDay } = require("../../lib/render");

exports.handler = async (event) => {
  let s;
  try {
    s = await getSchedule(event);
  } catch (e) {
    await send(`Расписание недоступно: ${e.message}. Сохранённой копии тоже нет.`);
    return { statusCode: 200 };
  }

  const n = nskInfo();
  const today = s.days.find((d) => d.date === n.date);
  const tomorrow = s.days.find((d) => d.date === n.tomorrow);

  const actual =
    today &&
    !today.empty &&
    today.pairs.some((p) => !p.entries.every((e) => e.cancelled) && toMin(p.end) > n.min);

  const day = actual ? today : tomorrow;
  const prefix = actual ? "Сегодня" : "Завтра";
  if (!day) {
    await send(`Расписание на ${prefix.toLowerCase()} пока не опубликовано на сайте.`);
    return { statusCode: 200 };
  }
  if (!actual && /воскресенье/i.test(day.weekday)) return { statusCode: 200 };

  let caption = `${prefix}, ${day.label}`;
  if (s.stale) {
    caption += `\n⚠️ natk.ru недоступен, показано сохранённое расписание (${fmtTime(s.fetchedAt)} НСК)`;
  }
  await sendDay({ ...day, title: `${prefix}, ${day.label}` }, caption);
  return { statusCode: 200 };
};