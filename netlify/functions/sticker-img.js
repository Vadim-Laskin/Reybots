exports.handler = async (event) => {
  const f = event.queryStringParameters?.f;
  if (!f) return { statusCode: 400, body: "no" };
  const base = `https://api.telegram.org`;
  const g = await (await fetch(`${base}/bot${process.env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(f)}`)).json();
  if (!g.ok) return { statusCode: 404, body: "no" };
  const r = await fetch(`${base}/file/bot${process.env.BOT_TOKEN}/${g.result.file_path}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = g.result.file_path.split(".").pop();
  const type =
    ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
  return {
    statusCode: 200,
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" },
    body: buf.toString("base64"),
    isBase64Encoded: true,
  };
};