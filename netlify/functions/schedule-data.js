const https = require("https");

const URL_ = "https://natk.ru/stud-grad/schedule/187?gid=386";
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const ROOM =
  "(?:Кабинет №\\d+|Лаборатория №\\d+|Спортивный комплекс|Дистанционные технологии)";

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
          resolve(html);
        });
      })
      .on("error", reject);
  });
}

function mk(before, room) {
  before = before.trim();
  const t = /([А-ЯЁ][а-яё-]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+)$/.exec(before);
  const teacher = t ? t[1] : "";
  const subject = (t ? before.slice(0, t.index) : before).trim();
  return { subject, teacher, room, cancelled: /^отмена/i.test(subject) };
}

function parseEntries(body) {
  const clean = (s) =>
    s
      .replace(/\s*по адресу проспект Дзержинского 26/g, "")
      .replace(/‖/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const split = (b) => {
    const re = new RegExp(`(.+?)\\s*(${ROOM})`, "g");
    const out = [];
    let m;
    while ((m = re.exec(b))) out.push(mk(m[1], m[2]));
    if (!out.length) out.push(mk(b, ""));
    return out;
  };

  const sg = /^[\s‖]*1 подгруппа[\s‖]*2 подгруппа[\s‖]*/.exec(body);
  if (sg) {
    const parts = body.slice(sg[0].length).split("‖").map(clean);
    const entries = [];
    [0, 1].forEach((i) => {
      if (parts[i]) split(parts[i]).forEach((e) => entries.push({ ...e, sg: i + 1 }));
    });
    if (entries.length) return { entries, sub: false };
    return { entries: split(clean(body.slice(sg[0].length))), sub: true };
  }
  return { entries: split(clean(body)), sub: false };
}

exports.handler = async () => {
  try {
    const html = await getPage(URL_);
    const flat = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/t[dh]>/gi, " ‖ ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const updated =
      /Последнее обновление\s+(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/.exec(flat)?.[1] || "";

    const headRe = new RegExp(
      `(\\d{1,2}) (${MONTHS.join("|")}) (\\d{4}) г\\.\\s*[-–—]\\s*([А-Яа-яЁё]+)`,
      "g"
    );
    const heads = [...flat.matchAll(headRe)];

    const days = heads.map((h, i) => {
      const sec = flat
        .slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined)
        .trim();
      const mm = String(MONTHS.indexOf(h[2]) + 1).padStart(2, "0");
      const day = {
        date: `${h[3]}-${mm}-${h[1].padStart(2, "0")}`,
        label: `${h[1]} ${h[2]}`,
        weekday: h[4],
        pairs: [],
        empty: false,
      };
      const marks = [...sec.matchAll(/(\d)\s*‖?\s*(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})\s*‖?\s*/g)];
      if (!marks.length) {
        day.empty = true;
        return day;
      }
      marks.forEach((mk2, k) => {
        const end = k + 1 < marks.length ? marks[k + 1].index : sec.length;
        const body = sec.slice(mk2.index + mk2[0].length, end).slice(0, 400);
        const { entries, sub } = parseEntries(body);
        day.pairs.push({ num: mk2[1], start: mk2[2], end: mk2[3], entries, sub });
      });
      return day;
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify({ updated, days }),
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};