const admins = () =>
  (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const isAdmin = (id) => admins().includes(String(id));

async function load(st) {
  try {
    return (await st.get("sounds", { type: "json", consistency: "strong" })) || {};
  } catch (e) {
    console.log("sounds read failed:", e.message);
    return {};
  }
}
const save = (st, data) => st.setJSON("sounds", data);

async function isMember(uid) {
  if (isAdmin(uid)) return true;
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getChatMember`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.CHAT_ID, user_id: uid }),
  });
  const j = await r.json();
  const s = j.result?.status;
  return (
    ["creator", "administrator", "member"].includes(s) ||
    (s === "restricted" && j.result.is_member === true)
  );
}

module.exports = { isAdmin, isMember, load, save };