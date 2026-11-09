const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

exports.handler = async (event) => {
  if (event.headers["x-telegram-bot-api-secret-token"] !== process.env.SECRET) {
    return { statusCode: 403, body: "no" };
  }

  const msg = JSON.parse(event.body).message;
  if (msg?.sticker) {
    console.log("STICKER ID:", msg.sticker.file_unique_id);

    if (msg.sticker.file_unique_id === process.env.STICKER_ID) {
      await fetch(`${API}/sendAudio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          audio: process.env.AUDIO, // прямая ссылка на mp3 или file_id
          reply_to_message_id: msg.message_id,
        }),
      });
    }
  }
  return { statusCode: 200, body: "ok" };
};
