const { store } = require("../../lib/natk");

const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const ok = { statusCode: 200, body: "ok" };

async function tg(method, payload) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log(`${method}:`, await r.text());
}

exports.handler = async (event) => {
  if (event.headers["x-telegram-bot-api-secret-token"] !== process.env.SECRET) {
    return { statusCode: 403, body: "no" };
  }
  const update = JSON.parse(event.body);
  const msg = update.message;
  if (!msg) return ok;

  // /start в личке: зовём в кабинет
  if (msg.chat.type === "private" && msg.text && msg.text.startsWith("/start")) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: "Привет! Чтобы пользоваться ботом, заходи в мини-приложение 👇",
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть кабинет", web_app: { url: process.env.CABINET_URL } }]],
      },
    });
    return ok;
  }

  // чтобы узнать file_id: отправь боту в личку голосовое
  if (msg.chat.type === "private") {
    if (msg.voice) console.log("VOICE ID:", msg.voice.file_id);
    if (msg.audio) console.log("AUDIO ID:", msg.audio.file_id);
  }

  if (msg.sticker) {
    console.log("STICKER ID:", msg.sticker.file_unique_id);

    if (msg.sticker.file_unique_id === process.env.STICKER_ID) {
      let enabled = true;
      try {
        const s = await store(event).get("settings", { type: "json" });
        if (s && s.voiceReply === false) enabled = false;
      } catch (e) {
        console.log("settings read failed:", e.message);
      }

      if (enabled) {
        if (process.env.VOICE) {
          await tg("sendVoice", {
            chat_id: msg.chat.id,
            voice: process.env.VOICE,
            reply_to_message_id: msg.message_id,
          });
        } else if (process.env.AUDIO) {
          await tg("sendAudio", {
            chat_id: msg.chat.id,
            audio: process.env.AUDIO,
            reply_to_message_id: msg.message_id,
          });
        }
      }
    }
  }
  return ok;
};