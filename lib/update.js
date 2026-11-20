// отправка «обновления» в группу: всегда с одной и той же картинкой первым фото
const fs = require("fs");
const path = require("path");

const CAP = 1024; // лимит подписи к фото в Telegram
function findBanner() {
  const dirs = [process.env.LAMBDA_TASK_ROOT, process.cwd(), path.join(__dirname, ".."), path.join(__dirname, "../.."), __dirname].filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, "assets", "update-banner.png");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const url = (m) => `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${m}`;

async function sendUpdate(text) {
  const file = findBanner();
  if (!file) throw new Error("Не найдена картинка assets/update-banner.png");
  const short = text.length <= CAP;
  const fd = new FormData();
  fd.append("chat_id", String(process.env.CHAT_ID));
  if (short) fd.append("caption", text);
  fd.append("photo", new Blob([fs.readFileSync(file)], { type: "image/png" }), "update.png");
  const j = await (await fetch(url("sendPhoto"), { method: "POST", body: fd })).json();
  if (!j.ok) throw new Error("Telegram не принял: " + (j.description || "ошибка"));
  if (!short) {
    // длинный текст не влезает в подпись — уходит следом отдельным сообщением
    const m = await (await fetch(url("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text: text.slice(0, 4000), reply_to_message_id: j.result.message_id }),
    })).json();
    if (!m.ok) throw new Error("Картинка ушла, а текст нет: " + (m.description || "ошибка"));
  }
  return j.result.message_id;
}
module.exports = { sendUpdate, CAP };
