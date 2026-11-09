const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

exports.handler = async (event) => {
  if (event.headers["x-telegram-bot-api-secret-token"] !== process.env.SECRET) {
    console.log("secret mismatch");
    return { statusCode: 403, body: "no" };
  }

  const update = JSON.parse(event.body);
  console.log("UPDATE:", JSON.stringify(update));

  const msg = update.message;
  if (msg?.audio) console.log("AUDIO ID:", msg.audio.file_id);
if (msg?.document) console.log("DOC ID:", msg.document.file_id);
  if (msg?.sticker) {
    console.log("STICKER ID:", msg.sticker.file_unique_id);

    if (msg.sticker.file_unique_id === process.env.STICKER_ID) {
      const r = await fetch(`${API}/sendAudio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          audio: process.env.AUDIO,
          reply_to_message_id: msg.message_id,
        }),
      });
      console.log("sendAudio:", await r.text());
    }
  }
  return { statusCode: 200, body: "ok" };
};