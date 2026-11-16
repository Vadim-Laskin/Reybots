const { store, nskInfo } = require("../../lib/natk");
const { loadHw, saveHw, postHomework } = require("../../lib/homework");

exports.handler = async (event) => {
  const st = store(event);
  const all = await loadHw(st);
  const today = nskInfo().date;
  let changed = false;

  for (const h of Object.values(all)) {
    if (h.posted || h.date > today) continue; // ждёт своей даты
    try {
      if (await postHomework(h)) {
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