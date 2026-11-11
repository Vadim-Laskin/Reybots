const { getSchedule } = require("../../lib/natk");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  try {
    const s = await getSchedule(event, { maxAge: 120000 });
    return { statusCode: 200, headers, body: JSON.stringify(s) };
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message }) };
  }
};