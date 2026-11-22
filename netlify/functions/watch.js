const {
  getSchedule, store, nskInfo, toMin, sigOf, isSuspicious, getPosted, savePosted,
} = require("../../lib/natk");
const { sendDay } = require("../../lib/render");

const { applyTestMode } = require("../../lib/testmode");
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
  await applyTestMode(st);
  let prev = null;
  try {
    prev = await st.get("watch", { type: "json" });
  } catch (e) {
    console.log("watch read failed:", e.message);
  }

  const next = {};
  s.days.forEach((d) => (next[d.date] = sigOf(d)));

  let meta = { count: 0, pending: {} };
  try {
    meta = { ...meta, ...((await st.get("watch-meta", { type: "json" })) || {}) };
  } catch (e) {
    console.log("watch-meta read failed:", e.message);
  }
  const saveAll = async (confirmed) => {
    try {
      await st.setJSON("watch", confirmed);
      await st.setJSON("watch-meta", meta);
    } catch (e) {
      console.log("watch save failed:", e.message);
    }
  };

  if (!prev) {
    // первый запуск: только запоминаем
    meta.count = s.days.length;
    await saveAll(next);
    return { statusCode: 200 };
  }
  // страница выглядит сломанной (дней стало заметно меньше) — ничего не трогаем до следующей проверки
  if (meta.count && s.days.length < meta.count - 2) {
    console.log(`watch: дней ${s.days.length} вместо ${meta.count}, похоже на сбой страницы, пропускаю`);
    return { statusCode: 200 };
  }

  const n = nskInfo();
  const posted = await getPosted(st);
  const watched = [[n.date, "Сегодня"], [n.tomorrow, "Завтра"]];
  const watchedDates = watched.map((w) => w[0]);

  // остальные дни принимаем молча, а сегодня и завтра — только после подтверждения
  const confirmed = {};
  for (const [date, sig] of Object.entries(next)) {
    if (!watchedDates.includes(date)) confirmed[date] = sig;
    else if (date in prev) confirmed[date] = prev[date]; // новый день (нет в prev) подтвердится позже
  }
  // день пропал со страницы (сбой разбора): помним прежнюю версию, чтобы при возвращении не было ложного «изменения»
  for (const date of watchedDates) if (!(date in next) && date in prev) confirmed[date] = prev[date];
  let changed = false;

  for (const [date, prefix] of watched) {
    const d = s.days.find((x) => x.date === date);
    if (!d) continue;
    const sig = next[date];
    if (prev[date] === sig) {
      delete meta.pending[date]; // всё как было (или временная правка откатилась)
      continue;
    }
    if (isSuspicious(d)) {
      console.log(`watch: ${date} разобран подозрительно (повтор номеров пар), жду следующей проверки`);
      delete meta.pending[date];
      continue;
    }
    if (meta.pending[date] !== sig) {
      meta.pending[date] = sig; // увидели впервые: ждём подтверждения следующей проверкой
      console.log(`watch: ${date} изменился, жду подтверждения`);
      continue;
    }
    // изменение держится две проверки подряд — считаем настоящим
    delete meta.pending[date];
    confirmed[date] = sig;
    if (date === n.date && !d.pairs.some((p) => toMin(p.end) > n.min)) continue; // день уже прошёл
    if (posted[date] === sig) continue; // именно это расписание уже отправляли

    const id = await sendDay(
      { ...d, title: `${prefix}, ${d.label}` },
      `⚠️ Изменение в расписании: ${prefix.toLowerCase()}, ${d.label}`,
      event
    );
    if (id) {
      posted[date] = sig;
      changed = true;
    }
  }
  meta.count = s.days.length;
  await saveAll(confirmed);
  if (changed) await savePosted(st, posted);
  return { statusCode: 200 };
};