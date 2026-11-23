// картинки новостей: публичная выдача по случайному id
const { store } = require("../../lib/natk");

exports.handler = async (event) => {
  const id = String(event.queryStringParameters?.id || "");
  if (!/^[a-f0-9]{16}$/.test(id)) return { statusCode: 400, body: "no" };
  try {
    const buf = await store(event).get("newsimg-" + id, { type: "arrayBuffer" });
    if (!buf) return { statusCode: 404, body: "no" };
    return {
      statusCode: 200,
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
      body: Buffer.from(buf).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 500, body: "err" };
  }
};
