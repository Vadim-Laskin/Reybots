// режим тестирования: пока включён и задан id тестового чата, все посты бота
// идут в этот чат вместо основной группы (подмена process.env.CHAT_ID на время вызова)
const KEY = "testmode";
const REAL = process.env.CHAT_ID;

async function loadTest(st) {
  try {
    return (await st.get(KEY, { type: "json" })) || {};
  } catch (e) {
    console.log("testmode read failed:", e.message);
    return {};
  }
}
const saveTest = (st, t) => st.setJSON(KEY, t);

async function applyTestMode(st) {
  const t = await loadTest(st);
  process.env.CHAT_ID = t.on && /^-?\d{5,20}$/.test(String(t.chat || "")) ? String(t.chat) : REAL;
  return t;
}
// настоящая группа: по ней проверяем, что человек состоит в группе
const realChat = () => REAL;

module.exports = { loadTest, saveTest, applyTestMode, realChat };
