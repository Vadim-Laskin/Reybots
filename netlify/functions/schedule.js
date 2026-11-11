const https = require("https");
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const SCHEDULE_URL = "https://natk.ru/stud-grad/schedule/187?gid=386";
const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const ROOM =
  "(?:Кабинет №\\d+|Лаборатория №\\d+|Спортивный комплекс|Дистанционные технологии)";

/* ---------- загрузка страницы ---------- */
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

/* ---------- разбор ---------- */
function mk(before, room) {
  before = before.trim();
  const t = /([А-ЯЁ][а-яё-]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+)$/.exec(before);
  const teacher = t ? t[1] : "";
  const subject = (t ? before.slice(0, t.index) : before).trim();
  return { subject, teacher, room, cancelled: /^отмена/i.test(subject) };
}

function parseEntries(body) {
  let b = body.replace(/\s*по адресу проспект Дзержинского 26/g, "").replace(/\s+/g, " ").trim();
  let sub = false;
  if (/^1 подгруппа 2 подгруппа/.test(b)) {
    sub = true;
    b = b.replace(/^1 подгруппа 2 подгруппа\s*/, "");
  }
  const re = new RegExp(`(.+?)\\s*(${ROOM})`, "g");
  const entries = [];
  let m;
  while ((m = re.exec(b))) entries.push(mk(m[1], m[2]));
  if (!entries.length) entries.push(mk(b, ""));
  return { entries, sub };
}

function parseSchedule(res, day, month, year) {
  const flat = res.html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = new RegExp(`(?<!\\d)${day} ${month} ${year}`).exec(flat);
  if (!m) {
    return {
      error:
        flat.length < 500
          ? `DEBUG: страница пустая. HTTP ${res.status}, текст: ${flat}`
          : `Расписание на ${day} ${month} пока не опубликовано на сайте.`,
    };
  }

  let sec = flat.slice(m.index + m[0].length);
  const end = sec.search(new RegExp(`(?<!\\d)\\d{1,2} (?:${MONTHS.join("|")}) \\d{4} г\\.`));
  if (end !== -1) sec = sec.slice(0, end);

  const wd = /^\s*г\.\s*[-–—]\s*([А-Яа-яЁё]+)/.exec(sec)?.[1] || "";
  sec = sec.replace(/^\s*г\.\s*[-–—]\s*[А-Яа-яЁё]+/, "").trim();

  const d = { title: `Расписание на ${day} ${month}`, weekday: wd, pairs: [], empty: false };
  if (!sec || /информация отсутствует/i.test(sec)) {
    d.empty = true;
    return d;
  }

  const marks = [...sec.matchAll(/(\d)\s+(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})\s+/g)];
  marks.forEach((mk2, i) => {
    const bodyEnd = i + 1 < marks.length ? marks[i + 1].index : sec.length;
    const { entries, sub } = parseEntries(sec.slice(mk2.index + mk2[0].length, bodyEnd));
    d.pairs.push({ num: mk2[1], start: mk2[2], end: mk2[3], entries, sub });
  });
  if (!d.pairs.length) return { error: `DEBUG: не разобрал расписание: ${sec.slice(0, 500)}` };
  return d;
}

/* ---------- картинка ---------- */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function wrap(text, max) {
  const lines = [];
  let cur = "";
  for (const w of text.split(" ")) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildSvg(d) {
  const W = 900, X = 40, CW = W - 2 * X;
  const C = {
    bg: "#0e1014", card: "#1a1d26", cardRed: "#2a1a20", accent: "#8b7bff",
    red: "#ff5d6c", green: "#4ade80", text: "#eceef5", muted: "#8b90a0", line: "#2a2e3a",
  };
  let y = 170;
  let body =
    `<text x="${X}" y="92" font-size="46" font-weight="bold" fill="${C.text}">${esc(d.title)}</text>` +
    `<text x="${X}" y="134" font-size="28" fill="${C.accent}">${esc(d.weekday)}</text>`;

  if (d.empty) {
    body +=
      `<rect x="${X}" y="${y}" width="${CW}" height="200" rx="24" fill="${C.card}"/>` +
      `<text x="${W / 2}" y="${y + 100}" font-size="48" font-weight="bold" fill="${C.green}" text-anchor="middle">Занятий нет</text>` +
      `<text x="${W / 2}" y="${y + 150}" font-size="26" fill="${C.muted}" text-anchor="middle">Можно отдыхать</text>`;
    y += 200;
  } else {
    for (const p of d.pairs) {
      const rows = [];
      if (p.sub && p.entries.length === 1) rows.push({ t: "label", h: 30, b: 22, s: "по подгруппам" });
      p.entries.forEach((e, i) => {
        if (i > 0) rows.push({ t: "gap", h: 16 });
        if (p.entries.length > 1) rows.push({ t: "label", h: 30, b: 22, s: `${i + 1} подгруппа` });
        wrap(e.subject, 30).forEach((l) =>
          rows.push({ t: e.cancelled ? "cancel" : "subj", h: 38, b: 30, s: l })
        );
        if (e.teacher) rows.push({ t: "teacher", h: 32, b: 24, s: e.teacher });
        if (e.room) rows.push({ t: "room", h: 32, b: 24, s: e.room });
      });

      const h = Math.max(130, 52 + rows.reduce((a, r) => a + r.h, 0));
      const red = p.entries.every((e) => e.cancelled);
      const bar = red ? C.red : C.accent;

      body +=
        `<rect x="${X}" y="${y}" width="${CW}" height="${h}" rx="22" fill="${red ? C.cardRed : C.card}"/>` +
        `<rect x="${X}" y="${y + 18}" width="6" height="${h - 36}" rx="3" fill="${bar}"/>` +
        `<text x="${X + 28}" y="${y + 66}" font-size="54" font-weight="bold" fill="${bar}">${p.num}</text>` +
        `<text x="${X + 28}" y="${y + 100}" font-size="22" fill="${C.muted}">${p.start}–${p.end}</text>` +
        `<rect x="${X + 186}" y="${y + 20}" width="2" height="${h - 40}" fill="${C.line}"/>`;

      const style = {
        subj: ["30", "bold", C.text],
        cancel: ["30", "bold", C.red],
        teacher: ["24", "normal", C.muted],
        room: ["24", "normal", C.text],
        label: ["20", "bold", C.accent],
      };
      let ry = y + 26;
      for (const r of rows) {
        if (r.t !== "gap") {
          const st = style[r.t];
          body += `<text x="${X + 210}" y="${ry + r.b}" font-size="${st[0]}" font-weight="${st[1]}" fill="${st[2]}">${esc(r.s)}</text>`;
        }
        ry += r.h;
      }
      y += h + 18;
    }
  }

  body += `<text x="${W / 2}" y="${y + 36}" font-size="20" fill="${C.muted}" text-anchor="middle">natk.ru</text>`;
  const H = y + 70;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Roboto">` +
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>${body}</svg>`
  );
}

function findFont(name) {
  const dirs = [process.env.LAMBDA_TASK_ROOT, process.cwd(), path.join(__dirname, "../.."), __dirname].filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, "fonts", name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function render(d) {
  const reg = findFont("Roboto-Regular.ttf");
  const bold = findFont("Roboto-Bold.ttf");
  if (!reg || !bold) throw new Error("не найдены шрифты в папке fonts");
  const resvg = new Resvg(buildSvg(d), {
    font: { fontFiles: [reg, bold], loadSystemFonts: false, defaultFontFamily: "Roboto" },
    fitTo: { mode: "width", value: 1440 },
  });
  return resvg.render().asPng();
}

/* ---------- отправка ---------- */
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

async function sendPhoto(png, caption) {
  const fd = new FormData();
  fd.append("chat_id", process.env.CHAT_ID);
  fd.append("caption", caption);
  fd.append("photo", new Blob([png], { type: "image/png" }), "schedule.png");
  const r = await fetch(`${TG}/sendPhoto`, { method: "POST", body: fd });
  console.log("sendPhoto:", await r.text());
}

function toText(d) {
  if (d.empty) return `${d.title}\n\nЗанятий нет 🎉`;
  const pairs = d.pairs.map((p) => {
    const e = p.entries
      .map((x) => [x.subject, x.teacher, x.room].filter(Boolean).join("\n"))
      .join("\n— — —\n");
    return `${p.num}. ${p.start}–${p.end}\n${e}`;
  });
  return `📅 ${d.title} (${d.weekday})\n\n${pairs.join("\n\n")}`;
}

/* ---------- запуск ---------- */
const toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

exports.handler = async () => {
  const nsk = new Date(Date.now() + 7 * 3600e3); // сейчас по НСК
  const nowMin = nsk.getUTCHours() * 60 + nsk.getUTCMinutes();
  const tom = new Date(nsk.getTime() + 24 * 3600e3);
  const T = { day: nsk.getUTCDate(), month: MONTHS[nsk.getUTCMonth()], year: nsk.getUTCFullYear() };
  const N = { day: tom.getUTCDate(), month: MONTHS[tom.getUTCMonth()], year: tom.getUTCFullYear() };

  let d;
  try {
    const res = await getPage(SCHEDULE_URL);
    const today = parseSchedule(res, T.day, T.month, T.year);

    const stillActual =
      !today.error &&
      !today.empty &&
      today.pairs.some(
        (p) => !p.entries.every((e) => e.cancelled) && toMin(p.end) > nowMin
      );

    if (stillActual) {
      d = today;
      d.title = `Сегодня, ${T.day} ${T.month}`;
    } else {
      d = parseSchedule(res, N.day, N.month, N.year);
      if (!d.error) d.title = `Завтра, ${N.day} ${N.month}`;
    }
  } catch (e) {
    d = { error: `DEBUG: сайт не открылся: ${e.message}; причина: ${e.code || e.cause?.code}` };
  }

  if (d.error) {
    await send(d.error);
    return { statusCode: 200 };
  }

  try {
    await sendPhoto(render(d), d.title);
  } catch (e) {
    console.log("render/send failed:", e.message);
    await send(`${toText(d)}\n\n(картинка не получилась: ${e.message})`);
  }
  return { statusCode: 200 };
};