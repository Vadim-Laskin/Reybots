/* Офлайн-режим для мобильного приложения (в Telegram и в браузере не включается).
   — ответы сервера на чтение и расписание запоминаются и показываются без интернета;
   — безопасные небольшие изменения (идея, день рождения, уведомления) копятся в очереди и отправляются, когда сеть вернётся. */
(function () {
  if (!window.ReyApp) return;
  var PFX = "rc:", QK = "rq", MAXV = 400000;
  var READ = { info: 1, list: 1, ideas: 1, people: 1, hw_list: 1, bd_list: 1, mat_list: 1, news_list: 1, news_get: 1, sch_over: 1, upd_list: 1, hw_img: 1 };
  var QUEUEABLE = { idea_add: 1, bd_set: 1, bd_clear: 1, notif_set: 1 };
  var GROUP = { bd_set: "bd", bd_clear: "bd", notif_set: "notif" }; // из группы остаётся только последнее изменение
  var offline = !navigator.onLine, flushing = false, rawRef = null, bar = null, flashText = "", flashTimer = 0;

  var key = function (a, x) { return PFX + a + ":" + (x && Object.keys(x).length ? JSON.stringify(x) : ""); };
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var isNet = function (e) { return e instanceof TypeError; };
  var isDown = function (e) { return isNet(e) || (e && (e.status === 502 || e.status === 503 || e.status === 504)); };

  function prune() {
    var items = [], i, k;
    for (i = 0; i < localStorage.length; i++) {
      k = localStorage.key(i);
      if (k && k.indexOf(PFX) === 0) {
        var t = 0;
        try { t = JSON.parse(localStorage.getItem(k)).t || 0; } catch (e) {}
        items.push([k, t]);
      }
    }
    items.sort(function (a, b) { return a[1] - b[1]; });
    items.slice(0, Math.ceil(items.length * 0.4)).forEach(function (x) { localStorage.removeItem(x[0]); });
  }
  function cacheSet(k, v) {
    var s;
    try { s = JSON.stringify({ t: Date.now(), v: v }); } catch (e) { return; }
    if (s.length > MAXV) return;
    try { localStorage.setItem(k, s); } catch (e) {
      try { prune(); localStorage.setItem(k, s); } catch (e2) {}
    }
  }
  function cacheGet(k) {
    try { var s = localStorage.getItem(k); return s ? JSON.parse(s).v : undefined; } catch (e) { return undefined; }
  }
  function patch(k, fn) {
    var c = cacheGet(k);
    if (c === undefined) return;
    try { fn(c); cacheSet(k, c); } catch (e) {}
  }

  /* ---------- очередь изменений ---------- */
  function qGet() { try { return JSON.parse(localStorage.getItem(QK) || "[]"); } catch (e) { return []; } }
  function qSet(q) { try { localStorage.setItem(QK, JSON.stringify(q)); } catch (e) {} render(); }

  // что показать странице сразу, пока изменение не ушло на сервер (и как оно выглядит в сохранённых данных)
  function local(action, extra) {
    var ik = key("info");
    if (action === "bd_set") {
      var bd = pad(Number(extra.month)) + "-" + pad(Number(extra.day));
      patch(ik, function (c) { c.bd = bd; });
      return { ok: true, bd: bd, queued: true };
    }
    if (action === "bd_clear") { patch(ik, function (c) { c.bd = ""; }); return { ok: true, queued: true }; }
    if (action === "notif_set") { patch(ik, function (c) { c.notif = Number(extra.value); }); return { ok: true, queued: true }; }
    var info = cacheGet(ik) || {};
    var item = { id: "local-" + Date.now(), text: String(extra.text || "").trim().slice(0, 300), status: "review", author: info.name || "", mine: true, ts: Date.now(), comment: "", pending: true };
    patch(key("ideas"), function (c) { c.items = [item].concat(c.items || []); });
    return { ok: true, item: item, queued: true };
  }
  function enqueue(action, extra) {
    if (action === "idea_add" && !String((extra && extra.text) || "").trim()) throw new Error("Напиши текст идеи");
    var q = qGet(), g = GROUP[action];
    if (g) q = q.filter(function (x) { return GROUP[x.action] !== g; });
    if (action === "idea_add" && q.filter(function (x) { return x.action === "idea_add"; }).length >= 5) {
      throw new Error("Накопилось много неотправленных идей. Дождись интернета");
    }
    q.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), action: action, extra: extra || {}, ts: Date.now() });
    qSet(q);
    return local(action, extra || {});
  }

  async function flush() {
    if (flushing || !rawRef || !navigator.onLine) return 0;
    var q = qGet(), sent = 0;
    if (!q.length) return 0;
    flushing = true; render();
    try {
      while (q.length) {
        var it = q[0];
        try {
          await rawRef(it.action, it.extra);
          sent++;
        } catch (e) {
          if (isDown(e)) break; // сети нет — оставляем в очереди до следующего раза
          if (e && e.status === 401) break; // сессия истекла: приложение само вернёт на экран входа
          flash("Не удалось отправить изменение: " + (e && e.message ? e.message : "ошибка"));
        }
        q = qGet().filter(function (x) { return x.id !== it.id; });
        qSet(q);
      }
    } finally { flushing = false; render(); }
    return sent;
  }

  /* ---------- плашка внизу ---------- */
  function flash(t) {
    flashText = t; render();
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashText = ""; render(); }, 5000);
  }
  function render() {
    var n = qGet().length;
    var text = flashText ||
      (offline || !navigator.onLine ? "Нет интернета. Показаны сохранённые данные" + (n ? " · ждут отправки: " + n : "") : n ? "Отправляем изменения: " + n + "…" : "");
    if (!text) { if (bar) bar.hidden = true; return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", render, { once: true }); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:10px 14px;border-radius:14px;font:13px/1.35 -apple-system,'Segoe UI',Roboto,sans-serif;text-align:center;pointer-events:none;background:var(--card,#1a1d26);color:var(--text,#eceef5);border:1.5px solid var(--amber,#f5b942);box-shadow:0 6px 20px rgba(0,0,0,.3)";
      document.body.appendChild(bar);
    }
    bar.textContent = text; bar.hidden = false;
  }
  function setOffline(v) { if (offline !== v) { offline = v; render(); } }

  /* ---------- API кабинета ---------- */
  async function call(action, extra, raw) {
    extra = extra || {};
    if (READ[action]) {
      var k = key(action, extra);
      try {
        var j = await raw(action, extra);
        cacheSet(k, j); setOffline(false);
        return j;
      } catch (e) {
        if (!isDown(e)) throw e;
        var c = cacheGet(k);
        if (c !== undefined) { setOffline(true); return c; }
        throw new Error("Нет интернета, эти данные ещё не сохранены");
      }
    }
    if (QUEUEABLE[action]) {
      if (!navigator.onLine) return enqueue(action, extra);
      try { return await raw(action, extra); } catch (e) { if (isNet(e)) return enqueue(action, extra); throw e; }
    }
    try { return await raw(action, extra); } catch (e) {
      if (isNet(e)) throw new Error("Для этого действия нужен интернет");
      throw e;
    }
  }

  // расписание и другие публичные GET-запросы
  async function json(url) {
    var k = PFX + "url:" + url;
    try {
      var r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      var j = await r.json();
      cacheSet(k, j); setOffline(false);
      return j;
    } catch (e) {
      var c = cacheGet(k);
      if (c !== undefined) { setOffline(true); return c; }
      throw e;
    }
  }

  async function onOnline() {
    setOffline(false);
    await flush();
    window.dispatchEvent(new Event("rey-synced")); // страница обновит данные с сервера
  }
  window.addEventListener("online", onOnline);
  window.addEventListener("rey-online", onOnline); // то же от приложения, когда оно увидело сеть
  window.addEventListener("offline", function () { setOffline(true); });
  document.addEventListener("DOMContentLoaded", render);

  window.ReyOffline = {
    call: call,
    json: json,
    flush: flush,
    pending: function () { return qGet().length; },
    init: function (raw) { rawRef = raw; if (navigator.onLine) flush().then(function (n) { if (n) window.dispatchEvent(new Event("rey-synced")); }); },
  };
})();
