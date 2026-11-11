const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const URL = "https://natk.ru/stud-grad/schedule/187?gid=386";

async function send(text) {
  try {
    const r = await fetch(`${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text: text.slice(0, 4000) }),
    });
    console.log("sendMessage:", await r.text());
  } catch (e) {
    console.log("send failed:", e.message, e.cause?.code);
  }
}

exports.handler = async () => {
  const t = new Date(Date.now() + 7 * 3600e3 + 24 * 3600e3);
  const date = [
    String(t.getUTCDate()).padStart(2, "0"),
    String(t.getUTCMonth() + 1).padStart(2, "0"),
    t.getUTCFullYear(),
  ].join(".");

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
      out = `DEBUG: даты ${date} нет. HTTP ${res.status}, длина ${text.length}.\n\n${text.slice(0, 3000)}`;
    }
  } catch (e) {
    out = `DEBUG: сайт не открылся: ${e.message}; причина: ${e.cause?.code || e.cause?.message}`;
  }

  await send(out);
  return { statusCode: 200 };
};