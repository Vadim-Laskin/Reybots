const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const TG = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

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
    `<text x="${X}" y="134" font-size="28" fill="${C.accent}">${esc(d.weekday || "")}</text>`;

  if (d.empty) {
    body +=
      `<rect x="${X}" y="${y}" width="${CW}" height="200" rx="24" fill="${C.card}"/>` +
      `<text x="${W / 2}" y="${y + 100}" font-size="48" font-weight="bold" fill="${C.green}" text-anchor="middle">Занятий нет</text>` +
      `<text x="${W / 2}" y="${y + 150}" font-size="26" fill="${C.muted}" text-anchor="middle">Можно отдыхать</text>`;
    y += 200;
  } else {
    for (const p of d.pairs) {
      const rows = [];
      p.entries.forEach((e, i) => {
        if (i > 0) rows.push({ t: "gap", h: 16 });
        const lab = e.sg ? `${e.sg} подгруппа` : p.sub ? "по подгруппам" : "";
        if (lab) rows.push({ t: "label", h: 30, b: 22, s: lab });
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
  const dirs = [
    process.env.LAMBDA_TASK_ROOT,
    process.cwd(),
    path.join(__dirname, ".."),
    path.join(__dirname, "../.."),
    __dirname,
  ].filter(Boolean);
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
  if (process.env.APP_LINK) {
    fd.append(
      "reply_markup",
      JSON.stringify({ inline_keyboard: [[{ text: "📅 Всё расписание", url: process.env.APP_LINK }]] })
    );
  }
  fd.append("photo", new Blob([png], { type: "image/png" }), "schedule.png");
  const r = await fetch(`${TG}/sendPhoto`, { method: "POST", body: fd });
  console.log("sendPhoto:", await r.text());
}

function toText(d) {
  if (d.empty) return `${d.title}\n\nЗанятий нет 🎉`;
  const pairs = d.pairs.map((p) => {
    const e = p.entries
      .map((x) =>
        [x.sg ? `${x.sg} подгруппа` : "", x.subject, x.teacher, x.room].filter(Boolean).join("\n")
      )
      .join("\n— — —\n");
    return `${p.num}. ${p.start}–${p.end}\n${e}`;
  });
  return `📅 ${d.title} (${d.weekday})\n\n${pairs.join("\n\n")}`;
}

// view = { title, weekday, empty, pairs }
async function sendDay(view, caption) {
  try {
    await sendPhoto(render(view), caption);
  } catch (e) {
    console.log("render/send failed:", e.message);
    await send(`${toText(view)}\n\n${caption}\n(картинка не получилась: ${e.message})`);
  }
}

module.exports = { send, sendDay };