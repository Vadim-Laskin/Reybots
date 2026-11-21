// Озвучка голосами Microsoft Edge (ru-RU-SvetlanaNeural и др.) без ключей.
// Неофициальный API: WebSocket реализован вручную, без внешних пакетов.
const tls = require("tls");
const net = require("net");
const crypto = require("crypto");

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const VERSION = process.env.EDGE_TTS_VERSION || "143.0.3650.75";
const HOST = "speech.platform.bing.com";
const PATH = "/consumer/speech/synthesize/readaloud/edge/v1";

// Sec-MS-GEC: SHA256 от «времени Windows» (в тиках по 100 нс, округлено до 5 минут) и токена
function gec() {
  let t = Math.floor(Date.now() / 1000) + 11644473600;
  t -= t % 300;
  return crypto.createHash("sha256").update(String(t) + "0000000" + TOKEN).digest("hex").toUpperCase();
}
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
const stamp = () => new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

function frame(opcode, payload) {
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, body]);
}

function synth(text, opts = {}) {
  const voice = opts.voice || process.env.EDGE_VOICE || "ru-RU-SvetlanaNeural";
  const rate = opts.rate || process.env.EDGE_RATE || "+0%";
  const host = opts.host || HOST, port = opts.port || 443, secure = opts.secure !== false;
  const path = opts.path || `${PATH}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-${VERSION}&ConnectionId=${crypto.randomUUID().replace(/-/g, "")}`;
  return new Promise((resolve, reject) => {
    const audio = [];
    let buf = Buffer.alloc(0), upgraded = false, done = false, frag = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch {}
      if (err) return reject(err);
      const out = Buffer.concat(audio);
      if (!out.length) return reject(Object.assign(new Error("Голос Edge вернул пустой ответ"), { status: 502 }));
      resolve({ buf: out, mime: "audio/mpeg" });
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("Голос Edge не ответил вовремя"), { status: 502 })), 9000);
    const sock = (secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port }));
    sock.on("error", (e) => finish(Object.assign(new Error("Голос Edge недоступен: " + e.message), { status: 502 })));
    sock.on("close", () => finish());
    const onConnect = () => {
      const key = crypto.randomBytes(16).toString("base64");
      sock.write([
        `GET ${path} HTTP/1.1`, `Host: ${host}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13",
        "Pragma: no-cache", "Cache-Control: no-cache",
        "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${VERSION.split(".")[0]}.0.0.0 Safari/537.36 Edg/${VERSION.split(".")[0]}.0.0.0`,
        "Accept-Language: en-US,en;q=0.9", `Cookie: muid=${crypto.randomBytes(16).toString("hex").toUpperCase()};`, "", "",
      ].join("\r\n"));
    };
    sock.on(secure ? "secureConnect" : "connect", onConnect);
    const sendText = (s) => sock.write(frame(1, Buffer.from(s, "utf8")));
    const onMessage = (isText, data) => {
      if (isText) {
        if (/Path:turn\.end/.test(data.toString("utf8"))) finish();
        return;
      }
      if (data.length < 2) return;
      const hl = data.readUInt16BE(0);
      const header = data.slice(2, 2 + hl).toString("utf8");
      if (/Path:audio/.test(header)) audio.push(data.slice(2 + hl));
    };
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const i = buf.indexOf("\r\n\r\n");
        if (i < 0) return;
        const head = buf.slice(0, i).toString("utf8");
        const status = Number((/^HTTP\/1\.1 (\d+)/.exec(head) || [])[1]);
        if (status !== 101) return finish(Object.assign(new Error(status === 403 ? "Microsoft закрыла доступ к голосу Edge (403). Нужно обновить код" : "Голос Edge отказал (" + status + ")"), { status: 502 }));
        upgraded = true;
        buf = buf.slice(i + 4);
        sendText(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ru-RU'><voice name='${voice}'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${esc(text)}</prosody></voice></speak>`;
        sendText(`X-RequestId:${crypto.randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      }
      // разбор кадров от сервера (они без маски)
      for (;;) {
        if (buf.length < 2) return;
        const fin = !!(buf[0] & 0x80), op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 8) return finish();
        if (op === 9) { sock.write(frame(10, payload)); continue; }
        if (op === 10) continue;
        if (op === 1 || op === 2) frag = { text: op === 1, parts: [payload] };
        else if (op === 0 && frag) frag.parts.push(payload);
        if (fin && frag) { const f = frag; frag = null; onMessage(f.text, Buffer.concat(f.parts)); }
      }
    });
  });
}

module.exports = { synth, gec };
