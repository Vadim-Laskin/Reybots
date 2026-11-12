const { store } = require("../../lib/natk");
const { isAdmin, load, save } = require("../../lib/sounds");

const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const MAX_PER_USER = 5;
const MAX_SECONDS = 30;
const ok = { statusCode: 200, body: "ok" };

async function tg(method, payload) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  console.log(`${method}:`, JSON.stringify(j));
  return j;
}
const say = (chat_id, text, extra = {}) => tg("sendMessage", { chat_id, text, ...extra });

async function isMember(uid) {
  if (isAdmin(uid)) return true;
  const j = await tg("getChatMember", { chat_id: process.env.CHAT_ID, user_id: uid });
  const s = j.result?.status;
  return ["creator", "administrator", "member"].includes(s) || (s === "restricted" && j.result.is_member);
}

async function privateChat(st, msg) {
  const uid = msg.from.id;
  const chat = msg.chat.id;

  if (msg.text && msg.text.startsWith("/start")) {
    return say(chat, "Привет! Чтобы пользоваться ботом, заходи в мини-приложение 👇", {
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть кабинет", web_app: { url: process.env.CABINET_URL } }]],
      },
    });
  }

  // шаг 1: стикер
  if (msg.sticker) {
    const s = msg.sticker;
    if (!(await isMember(uid))) return say(chat, "Добавлять звуки могут только участники группы.");
    const sounds = await load(st);
    const cur = sounds[s.file_unique_id];
    if (cur && cur.owner !== uid) {
      return say(chat, `У этого стикера уже есть звук, его добавил ${cur.ownerName}. Менять может только автор или админ (через кабинет).`);
    }
    const mine = Object.values(sounds).filter((x) => x.owner === uid).length;
    if (!cur && !isAdmin(uid) && mine >= MAX_PER_USER) {
      return say(chat, `Можно добавить не больше ${MAX_PER_USER} звуков. Удали лишний в кабинете.`);
    }
    await st.setJSON(`pending-${uid}`, {
      uid: s.file_unique_id,
      emoji: s.emoji || "",
      set: s.set_name || "",
      ts: Date.now(),
    });
    return say(
      chat,
      cur
        ? "Звук для этого стикера уже есть. Пришли новое голосовое (или mp3), чтобы заменить."
        : "Принял стикер. Теперь пришли голосовое сообщение (или mp3) для него."
    );
  }

  // шаг 2: голосовое или mp3
  const kind = msg.voice ? "voice" : msg.audio ? "audio" : null;
  if (kind) {
    const file = msg.voice || msg.audio;
    let p = null;
    try {
      p = await st.get(`pending-${uid}`, { type: "json" });
    } catch (e) {
      console.log("pending read failed:", e.message);
    }
    if (!p || Date.now() - p.ts > 10 * 60e3) {
      return say(chat, "Сначала пришли стикер, на который нужен звук.");
    }
    if ((file.duration || 0) > MAX_SECONDS) {
      return say(chat, `Слишком длинно, максимум ${MAX_SECONDS} секунд.`);
    }
    const sounds = await load(st);
    const cur = sounds[p.uid];
    if (cur && cur.owner !== uid) return say(chat, "У этого стикера уже есть звук другого автора.");

    sounds[p.uid] = {
      file_id: file.file_id,
      kind,
      owner: uid,
      ownerName: msg.from.first_name || "?",
      emoji: p.emoji,
      set: p.set,
      ts: Date.now(),
    };
    await save(st, sounds);
    try {
      await st.delete(`pending-${uid}`);
    } catch {}
    return say(chat, `Готово! Стикер ${p.emoji} теперь отвечает этим звуком.`);
  }
}

async function groupSticker(st, msg) {
  console.log("STICKER ID:", msg.sticker.file_unique_id);
  if (String(msg.chat.id) !== String(process.env.CHAT_ID)) return;
  const s = (await load(st))[msg.sticker.file_unique_id];
  if (!s) return;
  const method = s.kind === "audio" ? "sendAudio" : "sendVoice";
  await tg(method, {
    chat_id: msg.chat.id,
    [s.kind === "audio" ? "audio" : "voice"]: s.file_id,
    reply_to_message_id: msg.message_id,
  });
}

exports.handler = async (event) => {
  if (event.headers["x-telegram-bot-api-secret-token"] !== process.env.SECRET) {
    return { statusCode: 403, body: "no" };
  }
  const msg = JSON.parse(event.body).message;
  if (!msg) return ok;
  const st = store(event);

  try {
    if (msg.chat.type === "private") await privateChat(st, msg);
    else if (msg.sticker) await groupSticker(st, msg);
  } catch (e) {
    console.log("bot error:", e.message);
  }
  return ok;
};