const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const URL = "https://natk.ru/stud-grad/schedule/187?gid=386";

exports.handler = async () => {
  // завтрашняя дата по Новосибирску
  const t = new Date(Date.now() + 7 * 3600e3 + 24 * 3600e3);
  const date = [
    String(t.getUTCDate()).padStart(2, "0"),
    String(t.getUTCMonth() + 1).padStart(2, "0"),
    t.getUTCFullYear(),
  ].join(".");

  const html = await (await fetch(URL)).text();
    let out;
  try {
    const res = await fetch(URL);
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();

    const i = text.indexOf(date);
    if (i !== -1) {
      const rest = text.slice(i + date.length);
      const next = rest.search(/\d{2}\.\d{2}\.\d{4}/);
      out = text.slice(i, next === -1 ? undefined : i + date.length + next).trim();
    } else {
      out = `DEBUG: даты ${date} нет. HTTP ${res.status}, длина текста ${text.length}.\n\n${text.slice(0, 3000)}`;
    }
  } catch (e) {
    out = `DEBUG: ошибка запроса к сайту: ${e.message}`;
  }

  const r = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: process.env.CHAT_ID,
      text: out.slice(0, 4000),
    }),
  });
  console.log("sendMessage:", await r.text());
  return { statusCode: 200 };
};