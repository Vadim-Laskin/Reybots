const admins = () =>
  (process.env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const isAdmin = (id) => admins().includes(String(id));

async function load(st) {
  try {
    return (await st.get("sounds", { type: "json" })) || {};
  } catch (e) {
    console.log("sounds read failed:", e.message);
    return {};
  }
}
const save = (st, data) => st.setJSON("sounds", data);

module.exports = { isAdmin, load, save };