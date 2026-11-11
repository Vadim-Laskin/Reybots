const https = require("https");

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const SCHEDULE_URL = "https://natk.ru/stud-grad/schedule/187?gid=386";

function getPage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { rejectUnauthorized: false, headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(getPage(new URL(res.headers.location, url).href, redirects - 1));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const head = buf.toString("latin1", 0, 2000);
          const cs = (
            /charset=([\w-]+)/i.exec(res.headers["content-type"] || "")?.[1] ||
            /charset=["']?([\w-]+)/i.exec(head)?.[1] ||
            "utf-8"
          ).toLowerCase();
          let html;
          try {
            html = new TextDecoder(cs).decode(buf);
          } catch {
            html = buf.toString("utf8");
          }
          resolve({ status: res.statusCode, html });
        });
      })
      .on("error", reject);
  });
}

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
  // завтрашняя дата по Новосибирску (UTC+7)
  const t = new Date(Date.now() + 7 * 3600e3 + 24 * 3600e3);
  const date = [
    String(t.getUTCDate()).padStart(2, "0"),
    String(t.getUTCMonth() + 1).padStart(2, "0"),
    t.getUTCFullYear(),
  ].join(".");

  let out;
  try {
    const res = await getPage(SCHEDULE_URL);
    const text = res.html
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
    out = `DEBUG: сайт не открылся: ${e.message}; причина: ${e.code || e.cause?.code}`;
  }

  await send(out);
  return { statusCode: 200 };
};