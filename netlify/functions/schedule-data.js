const { getSchedule, store, nskInfo } = require("../../lib/natk");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const s = await getSchedule(event, { maxAge: 120000 });
    // правки админа (отмена пары, «отпустили раньше»): только для «Идёт / следующая», не трогают само расписание
    let over = {};
    try {
      over = (await store(event).get("schover", { type: "json" })) || {};
      const today = nskInfo().date;
      Object.keys(over).forEach((d) => { if (d < today) delete over[d]; });
    } catch {}
    return { statusCode: 200, headers, body: JSON.stringify({ ...s, over }) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};