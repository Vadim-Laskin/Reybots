const https = require("https");

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const SCHEDULE_URL = "https://natk.ru/stud-grad/schedule/187?gid=386";
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

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

function formatBody(body) {
  let b = body
    .replace(/\s*по адресу проспект Дзержинского 26/g, "")
    .replace(/^1 подгруппа 2 подгруппа\s*/, "(по подгруппам) ")
    .replace(/\s+([А-ЯЁ][а-яё-]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+)/g, "\n$1")
    .replace(/\s+(Кабинет|Лаборатория|Спортивный комплекс|Дистанционные технологии)/g, "\n$1")
    .trim();
  if (/^отмена/i.test(b)) b = "❌ " + b;
  return b;
}

exports.handler = async () => {
  // завтра по Новосибирску (UTC+7)
  const t = new Date(Date.now() + 7 * 3600e3 + 24 * 3600e3);
  const day = t.getUTCDate();
  const month = MONTHS[t.getUTCMonth()];
  const year = t.getUTCFullYear();

  let out;
  try {
    const res = await getPage(SCHEDULE_URL);
    const flat = res.html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const m = new RegExp(`(?<!\\d)${day} ${month} ${year}`).exec(flat);
    if (!m) {
      out =
        flat.length < 500
          ? `DEBUG: страница пустая. HTTP ${res.status}, текст: ${flat}`
          : `Расписание на ${day} ${month} пока не опубликовано на сайте.`;
    } else {
      let sec = flat.slice(m.index + m[0].length);
      const end = sec.search(new RegExp(`(?<!\\d)\\d{1,2} (?:${MONTHS.join("|")}) \\d{4} г\\.`));
      if (end !== -1) sec = sec.slice(0, end);

      const wd = /^\s*г\.\s*[-–—]\s*([А-Яа-яЁё]+)/.exec(sec)?.[1];
      sec = sec.replace(/^\s*г\.\s*[-–—]\s*[А-Яа-яЁё]+/, "").trim();

      const head = `📅 Расписание на ${day} ${month}${wd ? ` (${wd})` : ""}`;
      if (!sec || /информация отсутствует/i.test(sec)) {
        out = `${head}\n\nЗанятий нет 🎉`;
      } else {
        const re = /(\d)\s+(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})\s+/g;
        const marks = [...sec.matchAll(re)];
        const pairs = marks.map((mk, i) => {
          const bodyEnd = i + 1 < marks.length ? marks[i + 1].index : sec.length;
          const body = sec.slice(mk.index + mk[0].length, bodyEnd);
          return `${mk[1]}. ${mk[2]}–${mk[3]}\n${formatBody(body)}`;
        });
        out = `${head}\n\n${pairs.join("\n\n")}`;
      }
    }
  } catch (e) {
    out = `DEBUG: сайт не открылся: ${e.message}; причина: ${e.code || e.cause?.code}`;
  }

  await send(out);
  return { statusCode: 200 };
};