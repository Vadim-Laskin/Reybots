/* «Тайный карман» — скрытый раздел кабинета (5 тапов по заголовку): скинуться, колесо решений, табличка.
   Всё считается на устройстве, на сервер ничего не отправляется.
   Первая часть файла — расчёты без обращения к странице (проверяются в Node). */
(function (root) {
  "use strict";

  /* ---------- расчёты ---------- */
  // сколько скидывать каждому; доля округляется вверх, чтобы денег точно хватило
  function split(sum, people, tip, step) {
    sum = Number(sum); people = Math.floor(people);
    if (!(sum > 0) || sum > 1e8 || !(people >= 1)) return null;
    var total = Math.round(sum * (1 + (tip || 0) / 100) * 100) / 100;
    var s = step || 1;
    var each = Math.ceil(total / people / s - 1e-9) * s;
    return { total: total, each: each, extra: Math.round((each * people - total) * 100) / 100 };
  }
  function options(text) {
    return String(text || "").split(/\n/).map(function (x) { return x.trim().slice(0, 40); }).filter(Boolean).slice(0, 40);
  }
  // на какой угол докрутить колесо, чтобы под стрелкой (сверху) оказался сектор i; shift — место внутри сектора 0..1
  function spinTo(from, i, n, shift) {
    var size = 360 / n, target = 360 - (i + 0.15 + 0.7 * shift) * size;
    var turn = ((target - from) % 360 + 360) % 360;
    return from + 360 * 5 + turn;
  }
  function sectorAt(angle, n) { return Math.floor((((360 - angle) % 360) + 360) % 360 / (360 / n)); }

  var Core = { split: split, options: options, spinTo: spinTo, sectorAt: sectorAt };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  var doc = root.document;
  if (!doc) return;

  /* ---------- экраны ---------- */
  var CSS = [
    ".pk h1{margin-bottom:4px}",
    ".pk .pk-sub{color:var(--muted);margin-bottom:18px}",
    ".pk button{font:inherit;cursor:pointer}",
    ".pk-tile{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--card);color:var(--text);border:0;border-radius:20px;padding:18px 16px;margin-bottom:12px}",
    ".pk-tile i{font-style:normal;font-size:34px}.pk-tile b{display:block;font-size:17px}.pk-tile small{color:var(--muted)}",
    ".pk-back{background:none;border:0;color:var(--accent);padding:0;margin-bottom:12px}",
    ".pk label{display:block;color:var(--muted);font-size:13px;margin:14px 0 6px}",
    ".pk input,.pk textarea{width:100%;box-sizing:border-box;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:14px;padding:13px;font:inherit;font-size:17px;-webkit-user-select:text;user-select:text}",
    ".pk textarea{min-height:130px;resize:vertical}",
    ".pk-row{display:flex;flex-wrap:wrap;gap:8px}",
    ".pk-chip{border:0;border-radius:999px;padding:9px 15px;background:var(--card);color:var(--text)}",
    ".pk-chip.on{background:var(--accent);color:#fff}",
    ".pk-step{display:flex;align-items:center;gap:18px}.pk-step button{width:48px;height:48px;border:0;border-radius:14px;background:var(--card);color:var(--text);font-size:24px}.pk-step b{font-size:28px;min-width:44px;text-align:center}",
    ".pk-go{display:block;width:100%;border:0;border-radius:16px;padding:15px;margin-top:14px;background:var(--accent);color:#fff;font-weight:700}",
    ".pk-go:disabled{opacity:.5}",
    ".pk-res{background:var(--card);border-radius:20px;padding:18px;margin-top:18px;text-align:center}",
    ".pk-res b{display:block;font-size:44px}.pk-res span{color:var(--muted);font-size:14px}",
    ".pk-wheel{position:relative;width:min(78vw,300px);aspect-ratio:1;margin:6px auto 0}",
    ".pk-wheel canvas{width:100%;height:100%;border-radius:50%;transition:transform 4s cubic-bezier(.12,.75,.12,1)}",
    ".pk-wheel:after{content:'';position:absolute;left:50%;top:-8px;margin-left:-13px;border:13px solid transparent;border-top:24px solid var(--text);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}",
    ".pk-win{min-height:1.4em;text-align:center;font-size:24px;font-weight:800;margin-top:14px;overflow-wrap:anywhere}",
    ".pk-color{width:44px;height:44px;border-radius:50%;border:3px solid var(--line)}.pk-color.on{border-color:var(--accent);transform:scale(1.12)}",
    // табличка на весь экран
    ".pk-sign{position:fixed;inset:0;z-index:1000;overflow:hidden;display:flex;align-items:center;justify-content:center}",
    ".pk-sign span{position:absolute;left:50%;top:50%;white-space:nowrap;font-weight:900;line-height:1.1;text-align:center;transform:translate(-50%,-50%)}",
    ".pk-sign.rot span{transform:translate(-50%,-50%) rotate(90deg)}",
    ".pk-sign small{position:absolute;left:0;right:0;bottom:calc(var(--bot,0px) + 12px);text-align:center;font-size:12px;opacity:.45}",
    ".pk-sign.blink span{animation:pk-blink 1.2s ease-in-out infinite}",
    "@keyframes pk-blink{50%{opacity:.15}}",
    ".pk-sign.run span{animation:pk-run var(--time) linear infinite}",
    "@keyframes pk-run{from{transform:translate(calc(-50% + var(--way)),-50%)}to{transform:translate(calc(-50% - var(--way)),-50%)}}",
    ".pk-sign.rot.run span{animation-name:pk-run-rot}",
    "@keyframes pk-run-rot{from{transform:translate(-50%,calc(-50% + var(--way))) rotate(90deg)}to{transform:translate(-50%,calc(-50% - var(--way))) rotate(90deg)}}",
  ].join("\n");
  var HUES = ["#ff5d6c", "#ff9f43", "#f5c542", "#35c97a", "#38a8f5", "#9b7bff", "#ff7ac6", "#2fd0c8"];
  var SCHEMES = [["#000000", "#ffffff"], ["#000000", "#3dff7a"], ["#000000", "#ffd400"], ["#d6002a", "#ffffff"], ["#ffffff", "#000000"]];
  var PRESETS = { "Да или нет": "Да\nНет\nДа\nНет\nСпроси позже", "Где поесть": "Столовая\nКофейня\nШаурма\nПицца\nДома", "Чем заняться": "Погулять\nПоспать\nДомашка\nКино\nИграть" };

  var KEY = "rey-pocket", save = { wheel: PRESETS["Да или нет"], sign: "Я здесь!", scheme: 0, mode: "", tip: 0, step: 10, people: 4 };
  try { Object.assign(save, JSON.parse(root.localStorage.getItem(KEY) || "{}")); } catch (e) {}
  function persist() { try { root.localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }

  var host = null, box = null, page = "menu", sign = null, timer = 0, angle = 0, wake = null, exit = function () {};
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(cls, text, fn) { var b = el("button", cls, text); b.type = "button"; b.onclick = fn; return b; }
  function haptic(kind) {
    try { var h = root.Telegram.WebApp.HapticFeedback; if (kind === "ok") h.notificationOccurred("success"); else h.impactOccurred("light"); } catch (e) {}
  }
  function chips(list, current, pick) {
    var row = el("div", "pk-row");
    list.forEach(function (x) {
      var b = btn("pk-chip" + (x[0] === current ? " on" : ""), x[1], function () {
        row.querySelectorAll("button").forEach(function (o) { o.classList.toggle("on", o === b); });
        pick(x[0]);
      });
      row.append(b);
    });
    return row;
  }
  function screen(name, title, sub) {
    page = name; clearTimeout(timer);
    box = el("div", "pk");
    box.append(btn("pk-back", name === "menu" ? "← Назад" : "← В карман", function () { if (name === "menu") exit(); else menu(); }), el("h1", null, title), el("div", "pk-sub", sub));
    host.replaceChildren(box);
    root.scrollTo(0, 0);
    return box;
  }
  function menu() {
    var m = screen("menu", "Тайный карман", "Ты нашёл секрет 🤫 Тут лежит то, что пригодится в обычный день.");
    [["💸", "Скинуться", "Сколько с каждого за пиццу или подарок", splitPage],
     ["🎡", "Колесо решений", "Не можешь выбрать — пусть решит колесо", wheelPage],
     ["📣", "Табличка", "Огромный текст на весь экран или белый экран-подсветка", signPage]].forEach(function (x) {
      var t = btn("pk-tile", null, x[3]), body = el("div");
      body.append(el("b", null, x[1]), el("small", null, x[2]));
      t.append(el("i", null, x[0]), body); m.append(t);
    });
  }

  function money(v) { return v.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽"; }
  function splitPage() {
    var p = screen("split", "Скинуться", "Доля округляется вверх, чтобы точно хватило.");
    var sum = el("input"); sum.inputMode = "decimal"; sum.placeholder = "Например, 1850"; sum.value = save.sum || "";
    var count = el("b", null, String(save.people)), stepper = el("div", "pk-step");
    var res = el("div", "pk-res"), copy = btn("pk-go", "Скопировать сообщение", null), last = "";
    function draw() {
      var r = split(String(sum.value).replace(/\s/g, "").replace(",", "."), save.people, save.tip, save.step);
      copy.disabled = !r;
      if (!r) { res.replaceChildren(el("span", null, "Введи общую сумму")); last = ""; return; }
      res.replaceChildren(el("span", null, "С каждого"), el("b", null, money(r.each)), el("span", null, "Всего " + money(r.total) + (r.extra ? " · останется " + money(r.extra) : "")));
      last = "Скидываемся по " + money(r.each) + " (нас " + save.people + ", всего " + money(r.total) + ")";
    }
    var change = function (d) { return function () { save.people = Math.max(1, Math.min(100, save.people + d)); count.textContent = save.people; persist(); haptic(); draw(); }; };
    stepper.append(btn("", "−", change(-1)), count, btn("", "+", change(1)));
    sum.oninput = function () { save.sum = sum.value; persist(); draw(); };
    copy.onclick = function () {
      var done = function (ok) { copy.textContent = ok ? "✓ Скопировано" : last; setTimeout(function () { copy.textContent = "Скопировать сообщение"; }, ok ? 1500 : 6000); };
      try { root.navigator.clipboard.writeText(last).then(function () { done(true); haptic("ok"); }, function () { done(false); }); } catch (e) { done(false); }
    };
    p.append(el("label", null, "Общая сумма, ₽"), sum, el("label", null, "Сколько человек"), stepper,
      el("label", null, "Чаевые"), chips([[0, "Без"], [5, "5%"], [10, "10%"], [15, "15%"]], save.tip, function (v) { save.tip = v; persist(); draw(); }),
      el("label", null, "Округлять до"), chips([[1, "1 ₽"], [10, "10 ₽"], [50, "50 ₽"], [100, "100 ₽"]], save.step, function (v) { save.step = v; persist(); draw(); }),
      res, copy);
    draw();
  }

  function paint(canvas, list) {
    var s = 600, c = canvas.getContext("2d"), n = list.length || 1, a = (Math.PI * 2) / n;
    canvas.width = canvas.height = s;
    c.translate(s / 2, s / 2);
    for (var i = 0; i < n; i++) {
      var from = -Math.PI / 2 + i * a;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, s / 2, from, from + a); c.closePath();
      // соседние секторы (в том числе первый и последний) не должны совпадать по цвету
      c.fillStyle = HUES[(i === n - 1 && n % HUES.length === 1 ? 3 : i) % HUES.length]; c.fill();
      if (!list.length) continue;
      c.save(); c.rotate(from + a / 2);
      c.fillStyle = "#14161c"; c.textAlign = "right"; c.textBaseline = "middle";
      c.font = "700 " + Math.max(16, Math.min(34, 520 / n)) + "px sans-serif";
      var t = list[i].length > 14 ? list[i].slice(0, 13) + "…" : list[i];
      c.fillText(t, s / 2 - 22, 0); c.restore();
    }
    c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill();
  }
  function wheelPage() {
    var p = screen("wheel", "Колесо решений", "Каждый вариант с новой строки.");
    var wrap = el("div", "pk-wheel"), canvas = el("canvas"), win = el("div", "pk-win"), area = el("textarea"), picked = -1;
    var go = btn("pk-go", "Крутить", spin), drop = btn("pk-chip", "Убрать выпавшее", function () {
      var list = options(area.value); list.splice(picked, 1); set(list.join("\n"));
    });
    wrap.append(canvas); area.value = save.wheel;
    function reset() {
      picked = -1; win.textContent = ""; drop.hidden = true; angle = 0;
      canvas.style.transition = "none"; canvas.style.transform = ""; paint(canvas, options(area.value)); void canvas.offsetWidth; canvas.style.transition = "";
      go.disabled = options(area.value).length < 2;
    }
    function set(text) { area.value = text; save.wheel = text; persist(); reset(); }
    function spin() {
      var list = options(area.value);
      if (list.length < 2) return;
      var r = new Uint32Array(2); root.crypto.getRandomValues(r);
      var i = r[0] % list.length;
      angle = spinTo(angle, i, list.length, r[1] / 4294967296);
      go.disabled = true; area.disabled = true; drop.hidden = true; win.textContent = "…";
      canvas.style.transform = "rotate(" + angle + "deg)"; haptic();
      timer = setTimeout(function () {
        picked = i; win.textContent = "🎉 " + list[i]; go.disabled = false; area.disabled = false; drop.hidden = false; haptic("ok");
      }, 4100);
    }
    area.oninput = function () { save.wheel = area.value; persist(); reset(); };
    var presets = el("div", "pk-row");
    Object.keys(PRESETS).forEach(function (k) { presets.append(btn("pk-chip", k, function () { if (!area.disabled) set(PRESETS[k]); })); });
    var tools = el("div", "pk-row"); tools.style.justifyContent = "center"; tools.append(drop);
    p.append(wrap, win, tools, go, el("label", null, "Варианты"), area, el("label", null, "Готовые наборы"), presets);
    reset();
  }

  function signPage() {
    var p = screen("sign", "Табличка", "Покажи надпись через всю аудиторию. Оставь поле пустым, и будет белый экран-подсветка.");
    var input = el("input"); input.maxLength = 60; input.value = save.sign; input.placeholder = "Пусто = подсветка";
    input.oninput = function () { save.sign = input.value; persist(); };
    var colors = el("div", "pk-row");
    SCHEMES.forEach(function (s, i) {
      var b = btn("pk-color" + (i === save.scheme ? " on" : ""), "", function () {
        save.scheme = i; persist(); colors.querySelectorAll("button").forEach(function (o) { o.classList.toggle("on", o === b); });
      });
      b.style.background = "linear-gradient(135deg," + s[0] + " 50%," + s[1] + " 50%)"; b.setAttribute("aria-label", "Цвета " + (i + 1));
      colors.append(b);
    });
    p.append(el("label", null, "Надпись"), input, el("label", null, "Цвета"), colors,
      el("label", null, "Как показывать"), chips([["", "Спокойно"], ["blink", "Мигает"], ["run", "Бегущая строка"]], save.mode, function (v) { save.mode = v; persist(); }),
      btn("pk-go", "Показать на весь экран", showSign));
  }
  function fit() {
    if (!sign) return;
    var span = sign.querySelector("span"), W = root.innerWidth, H = root.innerHeight, rot = H > W;
    var long = rot ? H : W, short = rot ? W : H, run = save.mode === "run" && !!span.textContent;
    sign.classList.toggle("rot", rot);
    span.style.fontSize = "100px";
    var k = Math.min((long * 0.92) / (span.offsetWidth || 1), (short * 0.8) / (span.offsetHeight || 1));
    if (run) k = (short * 0.6) / (span.offsetHeight || 1);
    span.style.fontSize = Math.floor(100 * k) + "px";
    var way = (long + span.offsetWidth) / 2;
    span.style.setProperty("--way", way + "px");
    span.style.setProperty("--time", Math.max(3, (way * 2) / (long * 0.55)) + "s");
  }
  function showSign() {
    closeSign();
    var text = save.sign.trim(), s = text ? SCHEMES[save.scheme] || SCHEMES[0] : ["#ffffff", "#000000"];
    sign = el("div", "pk-sign" + (text && save.mode ? " " + save.mode : ""));
    sign.style.background = s[0]; sign.style.color = s[1];
    sign.append(el("span", null, text), el("small", null, "коснись, чтобы закрыть"));
    sign.onclick = closeSign;
    doc.body.append(sign); fit();
    try { root.navigator.wakeLock.request("screen").then(function (w) { if (sign) wake = w; else w.release(); }, function () {}); } catch (e) {}
  }
  function closeSign() {
    if (!sign) return false;
    sign.remove(); sign = null;
    if (wake) { wake.release().catch(function () {}); wake = null; }
    return true;
  }
  root.addEventListener("resize", fit);

  root.ReyPocket = {
    open: function (container, onExit) {
      if (!doc.getElementById("pk-css")) { var st = el("style"); st.id = "pk-css"; st.textContent = CSS; doc.head.append(st); }
      host = container; exit = onExit; menu();
    },
    // кнопка «Назад»: табличка → раздел → меню кармана; false — выходить из кармана
    back: function () {
      if (closeSign()) return true;
      if (page === "menu") return false;
      menu(); return true;
    },
    close: function () {
      closeSign(); clearTimeout(timer); page = "menu";
      if (host) host.replaceChildren();
    },
  };
})(typeof window !== "undefined" ? window : this);
