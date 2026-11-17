/* Праздничное оформление: украшения и анимации поверх страницы.
   Подключается и в расписании, и в кабинете. Праздник выбирается сам по дате (НСК).
   Чтобы поменять или добавить праздник, правьте список THEMES ниже.
   Проверить вручную: добавьте к адресу ?festive=newyear (или другой ключ), ?festive=off — выключить. */
(function () {
  "use strict";

  // from / to — «ММ-ДД», включительно. Если from > to, период переходит через Новый год.
  var THEMES = {
    newyear:  { from: "12-15", to: "01-10", chip: "🎄 С Новым годом!",        strip: "lights",   fall: ["❄", "❅", "❆"], burstDays: ["12-31", "01-01"] },
    tatyana:  { from: "01-23", to: "01-25", chip: "🎓 С Татьяниным днём!",    strip: "pink",     confetti: true, fall: ["🎓"] },
    feb23:    { from: "02-20", to: "02-23", chip: "🛡 С 23 Февраля!",         strip: "army",     fall: ["⭐", "✨"] },
    mar8:     { from: "03-05", to: "03-08", chip: "💐 С 8 Марта!",            strip: "pink",     fall: ["🌸", "🌷", "🌼"] },
    may1:     { from: "04-29", to: "05-01", chip: "🌷 С 1 Мая!",              strip: "green",    fall: ["🍃", "🌷"] },
    may9:     { from: "05-05", to: "05-09", chip: "🎗 С Днём Победы!",        strip: "ribbon",   burst: true },
    jun12:    { from: "06-09", to: "06-12", chip: "🇷🇺 С Днём России!",        strip: "tricolor", confetti: ["#ffffff", "#2a6fdb", "#e0352b"] },
    sep1:     { from: "08-29", to: "09-02", chip: "📚 С Днём знаний!",        strip: "green",    fall: ["🍂", "🍁", "📚"] },
    nov4:     { from: "11-02", to: "11-04", chip: "🤝 С Днём единства!",      strip: "tricolor", fall: ["🍁", "🍂"] },
    students: { from: "11-16", to: "11-17", chip: "🎓 С Днём студентов!",     strip: "pink",     confetti: true, fall: ["🎓"] },
    birthday: { chip: "🎂 С днём рождения!", confetti: true, fall: ["🎂", "🎈", "🎉"], never: true },
  };

  var COLORS = ["#ff5d6c", "#f5b942", "#4ade80", "#4cc2ff", "#8b7bff", "#ff8fd0"];
  var reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var root = null, timers = [], current = "";

  function nskMd() {
    return new Date(Date.now() + 7 * 3600e3).toISOString().slice(5, 10);
  }
  function inRange(md, from, to) {
    return from <= to ? md >= from && md <= to : md >= from || md <= to;
  }
  function pick() {
    var q = "";
    try { q = new URLSearchParams(location.search).get("festive") || ""; } catch (e) {}
    if (q === "off") return "";
    if (q && THEMES[q]) return q;
    var md = nskMd();
    for (var k in THEMES) {
      var t = THEMES[k];
      if (!t.never && inRange(md, t.from, t.to)) return k;
    }
    return "";
  }

  function css() {
    if (document.getElementById("festive-css")) return;
    var s = document.createElement("style");
    s.id = "festive-css";
    s.textContent =
      "#festive{position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden}" +
      ".fs-strip{position:absolute;left:0;right:0;top:calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px));height:6px;opacity:.95}" +
      // в кабинете лента идёт по самому краю экрана, а не по середине шапки
      ".fs-edge .fs-strip{top:0}" +
      ".fs-tricolor{background:linear-gradient(#fff 0 33.3%,#2a6fdb 33.3% 66.6%,#e0352b 66.6%)}" +
      ".fs-ribbon{background:repeating-linear-gradient(135deg,#f58220 0 8px,#111 8px 16px)}" +
      ".fs-pink{background:linear-gradient(90deg,#ff8fb8,#ffd1e3,#ff8fb8)}" +
      ".fs-green{background:linear-gradient(90deg,#4ade80,#a3e635,#4ade80)}" +
      ".fs-army{background:repeating-linear-gradient(90deg,#4b5320 0 20px,#6b7a2f 20px 40px)}" +
      ".fs-lights{height:18px;display:flex;justify-content:space-between;padding:0 6px;border-top:2px solid rgba(120,120,120,.5);border-radius:0 0 50% 50%/0 0 8px 8px}" +
      ".fs-lights i{width:8px;height:12px;border-radius:50% 50% 55% 55%;margin-top:1px;background:var(--c);box-shadow:0 0 8px var(--c);animation:fs-blink 3.5s ease-in-out infinite}" +
      "@keyframes fs-blink{0%,100%{opacity:1}50%{opacity:.6}}" +
      ".fs-p{position:absolute;top:-10vh;left:var(--x);font-size:var(--s);line-height:1;opacity:.6;will-change:transform;animation:fs-fall var(--d) linear var(--dl) infinite}" +
      ".fs-c{position:absolute;top:-10vh;left:var(--x);width:8px;height:12px;background:var(--c);border-radius:2px;opacity:.55;will-change:transform;animation:fs-fall var(--d) linear var(--dl) infinite}" +
      "@keyframes fs-fall{from{transform:translate(0,0) rotate(0)}to{transform:translate(var(--dx),115vh) rotate(540deg)}}" +
      ".fs-b{position:absolute;width:0;height:0}" +
      ".fs-b i{position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:var(--c);box-shadow:0 0 6px var(--c);animation:fs-burst 1.3s ease-out forwards}" +
      "@keyframes fs-burst{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.4);opacity:0}}" +
      ".fs-chip{position:absolute;left:50%;top:calc(var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px) + 26px);transform:translateX(-50%);background:var(--card,#fff);color:var(--text,#111);padding:8px 16px;border-radius:999px;font:700 14px -apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);white-space:nowrap;animation:fs-chip 5s ease forwards}" +
      "@keyframes fs-chip{0%{opacity:0;transform:translate(-50%,-10px)}10%,80%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-10px)}}";
    document.head.appendChild(s);
  }

  function el(tag, cls, style) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (style) e.setAttribute("style", style);
    return e;
  }
  var rnd = function (a, b) { return a + Math.random() * (b - a); };

  function clear() {
    timers.forEach(clearInterval);
    timers = [];
    if (root) root.remove();
    root = null;
  }

  function burst() {
    if (!root || document.hidden) return;
    var b = el("div", "fs-b", "left:" + rnd(15, 85) + "%;top:" + rnd(18, 50) + "%;--c:hsl(" + Math.round(rnd(0, 360)) + ",90%,60%)");
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2, r = rnd(50, 80);
      b.appendChild(el("i", "", "--dx:" + Math.cos(a) * r + "px;--dy:" + Math.sin(a) * r + "px"));
    }
    root.appendChild(b);
    setTimeout(function () { b.remove(); }, 1500);
  }

  function start(key) {
    clear();
    current = key;
    var t = THEMES[key];
    if (!key || !t || !document.body) return;
    css();
    root = el("div");
    root.id = "festive";
    root.setAttribute("aria-hidden", "true");
    if (/\/cabinet\//.test(location.pathname) || /[?&]edge=1/.test(location.search)) root.className = "fs-edge";

    // полоска / гирлянда сверху
    if (t.strip === "lights") {
      var g = el("div", "fs-strip fs-lights");
      for (var i = 0; i < 18; i++) g.appendChild(el("i", "", "--c:" + COLORS[i % COLORS.length] + ";animation-delay:" + (i % 3) * 0.5 + "s" + (reduce ? ";animation:none" : "")));
      root.appendChild(g);
    } else if (t.strip) {
      root.appendChild(el("div", "fs-strip fs-" + t.strip));
    }

    if (!reduce) {
      // падающие эмодзи
      (t.fall || []).length && (function () {
        for (var i = 0; i < 6; i++) {
          var p = el("span", "fs-p", "--x:" + rnd(4, 94) + "%;--s:" + Math.round(rnd(14, 20)) + "px;--d:" + rnd(16, 26) + "s;--dl:-" + rnd(0, 26) + "s;--dx:" + rnd(-40, 40) + "px");
          p.textContent = t.fall[i % t.fall.length];
          root.appendChild(p);
        }
      })();
      // конфетти
      if (t.confetti) {
        var cols = Array.isArray(t.confetti) ? t.confetti : COLORS;
        for (var j = 0; j < 8; j++) {
          root.appendChild(el("span", "fs-c", "--x:" + rnd(4, 96) + "%;--d:" + rnd(12, 20) + "s;--dl:-" + rnd(0, 20) + "s;--dx:" + rnd(-50, 50) + "px;--c:" + cols[j % cols.length]));
        }
      }
      // салют
      var salute = t.burst || (t.burstDays && t.burstDays.indexOf(nskMd()) !== -1);
      if (salute) {
        burst();
        timers.push(setInterval(burst, 6000));
      }
    }

    // приветствие на несколько секунд, один раз в сутки
    var seenKey = "festive-" + key + "-" + nskMd(), seen = false;
    try { seen = !!localStorage.getItem(seenKey); } catch (e) {}
    if (t.chip && !seen) {
      var chip = el("div", "fs-chip");
      chip.textContent = t.chip;
      root.appendChild(chip);
      setTimeout(function () { chip.remove(); }, 5200);
      try { localStorage.setItem(seenKey, "1"); } catch (e) {}
    }
    document.body.appendChild(root);
  }

  window.Festive = {
    // вызывается кабинетом: у человека сегодня день рождения
    birthday: function (bd) {
      if (current && current !== "birthday") return; // праздник календаря важнее
      if (bd && bd === nskMd()) start("birthday");
    },
    current: function () { return current; },
  };

  function init() { start(pick()); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
