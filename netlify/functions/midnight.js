// в 00:00 по НСК расписание «на завтра» становится расписанием «на сегодня»: правим уже отправленные сообщения
const { rollover } = require("../../lib/render");

exports.handler = async (event) => {
  try {
    console.log("midnight: исправлено сообщений:", await rollover(event));
  } catch (e) {
    console.log("midnight failed:", e.message);
  }
  return { statusCode: 200 };
};
