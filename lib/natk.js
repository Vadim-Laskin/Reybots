const https = require("https");
const { getStore, connectLambda } = require("@netlify/blobs");

const SCHEDULE_URL = "https://natk.ru/stud-grad/schedule/187?gid=386";
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const ROOM =
  "(?:Кабинет №\\d+|Лаборатория №\\d+|Спортивный комплекс|Дистанционные технологии)";

function getPage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { rejectUnauthorized: false, headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          return resolve(getPage(new URL(res.headers.location, url).href, redirects - 1));
        }
        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
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
          try {
            resolve(new TextDecoder(cs).decode(buf));
          } catch {
            resolve(buf.toString("utf8"));
          }
        });
      }
    );
    req.setTimeout(7000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/* ---------- разбор ---------- */
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

function parseAll(html) {
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
    const marks = [
      ...sec.matchAll(/(\d)\s*‖?\s*(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})\s*‖?\s*/g),
    ];
    if (!marks.length) {
      day.empty = true;
      return day;
    }
    marks.forEach((m, k) => {
      const end = k + 1 < marks.length ? marks[k + 1].index : sec.length;
      const body = sec.slice(m.index + m[0].length, end).slice(0, 400);
      const { entries, sub } = parseEntries(body);
      day.pairs.push({ num: m[1], start: m[2], end: m[3], entries, sub });
    });
    return day;
  });

  return { updated, days };
}

/* ---------- кэш ---------- */
function store(event) {
  if (process.env.BLOBS_TOKEN && process.env.BLOBS_SITE_ID) {
    return getStore({
      name: "schedule",
      consistency: "strong",
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });
  }
  if (event) {
    try {
      connectLambda(event);
    } catch (e) {
      console.log("connectLambda:", e.message);
    }
  }
  return getStore({ name: "schedule", consistency: "strong" });
}

// maxAge (мс): если кэш свежее, сайт не трогаем
async function getSchedule(event, opts = {}) {
  const st = store(event);
  let cached = null;
  try {
    cached = await st.get("last", { type: "json" });
  } catch (e) {
    console.log("cache read failed:", e.message);
  }

  if (opts.maxAge && cached && Date.now() - cached.fetchedAt < opts.maxAge) {
    return { ...cached, stale: false };
  }

  let err;
  try {
    const parsed = parseAll(await getPage(SCHEDULE_URL));
    if (!parsed.days.length) throw new Error("на странице нет расписания");
    const fresh = { updated: parsed.updated, fetchedAt: Date.now(), days: parsed.days };
    try {
      await st.setJSON("last", fresh);
    } catch (e) {
      console.log("cache save failed:", e.message);
    }
    return { ...fresh, stale: false };
  } catch (e) {
    err = e.code || e.message;
  }
  if (cached) return { ...cached, stale: true, error: err };
  throw new Error(err);
}

/* ---------- время по Новосибирску ---------- */
const iso = (d) => d.toISOString().slice(0, 10);
const toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
function nskInfo() {
  const d = new Date(Date.now() + 7 * 3600e3);
  const t = new Date(d.getTime() + 24 * 3600e3);
  return { date: iso(d), tomorrow: iso(t), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function fmtTime(ms) {
  const d = new Date(ms + 7 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

module.exports = { getSchedule, store, nskInfo, toMin, fmtTime };