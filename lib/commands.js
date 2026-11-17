const { getSchedule, store, nskInfo, toMin, fmtTime } = require("./natk");
const { sendDayTo } = require("./render");
const { loadHw, postHomework, latestPosted } = require("./homework");

const API = () => `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const COOLDOWN_MS = 60 * 1000; // одну и ту же команду в группе принимаем раз в минуту

const SCHEDULE = ["расписание", "raspisanie", "schedule", "rasp"];
const HOMEWORK = ["дз", "dz", "hw", "homework", "домашка"];

let myName = null;
async function botName() {
  if (myName) return myName;
  try {
    const j = await (await fetch(`${API()}/getMe`)).json();
    myName = (j.result?.username || "").toLowerCase();
  } catch {}
  return myName || "";
}

async function reply(msg, text) {
  await fetch(`${API()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: msg.chat.id, text, reply_to_message_id: msg.message_id }),
  });
}

// не даём засыпать группу одной и той же командой
async function cooledDown(st, name) {
  const key = `cmd-${name}`;
  try {
    const last = await st.get(key, { type: "json" });
    if (last && Date.now() - last.ts < COOLDOWN_MS) return false;
  } catch {}
  try {
    await st.setJSON(key, { ts: Date.now() });
  } catch {}
  return true;
}

async function scheduleCmd(event, msg) {
  let s;
  try {
    s = await getSchedule(event, { maxAge: 120000 });
  } catch (e) {
    return reply(msg, `Расписание недоступно: ${e.message}`);
  }
  const n = nskInfo();
  const today = s.days.find((d) => d.date === n.date);
  const tomorrow = s.days.find((d) => d.date === n.tomorrow);
  const actual =
    today &&
    !today.empty &&
    today.pairs.some((p) => !p.entries.every((e) => e.cancelled) && toMin(p.end) > n.min);
  const day = actual ? today : tomorrow;
  const prefix = actual ? "Сегодня" : "Завтра";
  if (!day) return reply(msg, `Расписание на ${prefix.toLowerCase()} пока не опубликовано на сайте.`);

  let caption = `${prefix}, ${day.label}`;
  if (s.stale) caption += `\n⚠️ natk.ru недоступен, показано сохранённое расписание (${fmtTime(s.fetchedAt)} НСК)`;
  await sendDayTo({ ...day, title: caption.split("\n")[0] }, caption, msg.chat.id, msg.message_id);
}

async function homeworkCmd(st, msg) {
  const items = latestPosted(await loadHw(st), nskInfo().date);
  if (!items.length) return reply(msg, "Свежей домашки пока нет.");
  for (const h of items) {
    try {
      await postHomework(h, msg.chat.id);
    } catch (e) {
      console.log("homework cmd failed:", e.message);
    }
  }
}

// возвращает true, если сообщение было командой бота
async function groupCommand(event, msg) {
  const m = /^\/([^\s@]+)(?:@(\w+))?/.exec((msg.text || "").trim());
  if (!m) return false;
  const cmd = m[1].toLowerCase();
  const kind = SCHEDULE.includes(cmd) ? "schedule" : HOMEWORK.includes(cmd) ? "hw" : null;
  if (!kind) return false;
  if (m[2] && m[2].toLowerCase() !== (await botName())) return false; // команда другому боту
  if (String(msg.chat.id) !== String(process.env.CHAT_ID)) return false;

  const st = store(event);
  if (!(await cooledDown(st, kind))) return true;
  if (kind === "schedule") await scheduleCmd(event, msg);
  else await homeworkCmd(st, msg);
  return true;
}

module.exports = { groupCommand };
