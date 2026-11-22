const { applyTestMode } = require("../../lib/testmode");
const { store } = require("../../lib/natk");

// 1 января в 00:00 по Новосибирску = 31 декабря 17:00 UTC
exports.handler = async (event) => {
  const st = store(event);
  await applyTestMode(st);
  // +7 часов (НСК) и ещё 30 минут запаса: год считается верно, даже если запуск чуть раньше или позже
  const year = new Date(Date.now() + 7.5 * 3600e3).getUTCFullYear();
  const key = `newyear-${year}`;
  try {
    if (await st.get(key)) return { statusCode: 200 }; // уже поздравляли
  } catch {}

  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.CHAT_ID,
      text: `🎄🎆 С Новым ${year} годом, группа!\nПусть этот год будет лёгким на сессии и щедрым на выходные! 🥂`,
    }),
  });
  const j = await r.json();
  console.log("newyear:", JSON.stringify(j).slice(0, 200));
  if (j.ok) {
    try {
      await st.set(key, "1");
    } catch (e) {
      console.log("newyear mark failed:", e.message);
    }
  }
  return { statusCode: 200 };
};
