const { store, nskInfo, getSchedule } = require("../../lib/natk");
const { loadHw, saveHw, postHomework, postIfLessonTomorrow } = require("../../lib/homework");

// каждый день в 18:01 по Новосибирску:
// домашка «по паре» уходит в группу, если завтра есть этот предмет; иначе ждёт следующего дня.
// Старые записи с конкретной датой уходят в свой день, как раньше.
const { applyTestMode } = require("../../lib/testmode");
exports.handler = async (event) => {
  const st = store(event);
  await applyTestMode(st);
  const all = await loadHw(st);
  const n = nskInfo();
  let changed = false;

  let schedule = null;
  try {
    schedule = await getSchedule(event);
  } catch (e) {
    console.log("homework: расписание недоступно:", e.message);
  }

  for (const h of Object.values(all)) {
    if (h.posted) continue;
    try {
      if (h.mode === "lesson") {
        if (!schedule) continue;
        if (await postIfLessonTomorrow(h, schedule, n.tomorrow)) changed = true;
      } else if (h.date && h.date <= n.date && (await postHomework(h))) {
        h.posted = true;
        h.postedAt = Date.now();
        changed = true;
      }
    } catch (e) {
      console.log("homework post failed:", e.message);
    }
  }
  if (changed) await saveHw(st, all);
  return { statusCode: 200 };
};
