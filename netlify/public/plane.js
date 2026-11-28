/* Анимация отправки: сообщение складывается в бумажный самолётик и улетает.
   const fly = ReyPlane.start({ from: элемент, title, text, fields: [поля, чей текст «уехал» на листок] });
   fly.send()   — сервер принял: самолётик улетает (можно передать свою подпись вместо «Отправлено!»);
   fly.cancel() — ошибка: листок разворачивается обратно на место.
   Пока ответа нет, сложенный самолётик покачивается и ждёт. */
(function () {
  // этапы складывания, мс: лист поднимается, два сгиба, превращение в самолётик
  var LIFT = 450, F1 = 480, F2 = 480, MORPH = 380, FOLD = LIFT + F1 + F2 + MORPH;
  var WIND = 420, FLY = 1500, BYE = 750, OUT = WIND + FLY + BYE;

  var clamp = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var ease = function (t) { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  var mix = function (a, b, t) { return a + (b - a) * t; };
  var haptic = function (kind) {
    try {
      var h = window.Telegram.WebApp.HapticFeedback;
      kind === "success" ? h.notificationOccurred("success") : h.impactOccurred(kind);
    } catch (e) {}
  };

  /* ---------- бумага ---------- */
  function wrap(g, text, width, max) {
    var lines = [];
    String(text).split("\n").forEach(function (par) {
      var line = "";
      par.split(/\s+/).forEach(function (word) {
        var next = line ? line + " " + word : word;
        if (g.measureText(next).width <= width) { line = next; return; }
        if (line) lines.push(line);
        line = word;
        while (g.measureText(line).width > width && line.length > 1) { // слово длиннее строки
          var n = line.length - 1;
          while (n > 1 && g.measureText(line.slice(0, n)).width > width) n--;
          lines.push(line.slice(0, n));
          line = line.slice(n);
        }
      });
      lines.push(line);
    });
    if (lines.length > max) { lines.length = max; lines[max - 1] = lines[max - 1].slice(0, -1) + "…"; }
    return lines;
  }

  // лист с текстом сообщения (картинка, которую потом режут сгибы)
  function sheet(w, h, title, text, dpr) {
    var c = document.createElement("canvas");
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var g = c.getContext("2d"), pad = w * 0.09, y = pad, size = Math.max(11, w * 0.066);
    g.scale(dpr, dpr);
    var bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#ffffff"); bg.addColorStop(1, "#e9ecfb");
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(90,110,200,.16)"; g.lineWidth = 1;
    for (var ly = pad + size * 1.5; ly < h - pad / 2; ly += size * 1.5) {
      g.beginPath(); g.moveTo(pad, ly + 0.5); g.lineTo(w - pad, ly + 0.5); g.stroke();
    }
    g.textBaseline = "alphabetic"; g.fillStyle = "#232842";
    var put = function (str, weight, max) {
      g.font = weight + " " + size + "px system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
      wrap(g, str, w - pad * 2, max).forEach(function (line) {
        y += size * 1.5;
        if (y < h - pad / 2) g.fillText(line, pad, y - 3);
      });
    };
    if (title) put(title, "800", 2);
    put(text, "500", 14);
    return c;
  }

  /* ---------- сгибы ---------- */
  // часть многоугольника по одну сторону от прямой a→b (sign выбирает сторону)
  function half(pts, a, b, sign) {
    var side = function (p) { return sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])); };
    var res = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], sp = side(p), sq = side(q);
      if (sp >= 0) res.push(p);
      if (sp * sq < 0) {
        var k = sp / (sp - sq);
        res.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
      }
    }
    return res.length > 2 ? res : null;
  }

  // перегнуть всё, что лежит по сторону sign от прямой a→b; t: 0 — ровно, 1 — загнуто
  function fold(layers, a, b, sign, t) {
    if (t <= 0) return layers;
    var angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    var m = new DOMMatrix().translate(a[0], a[1]).rotate(angle).scale(1, Math.cos(Math.PI * t)).rotate(-angle).translate(-a[0], -a[1]);
    var stay = [], move = [];
    layers.forEach(function (l) {
      var s = half(l.pts, a, b, -sign), f = half(l.pts, a, b, sign);
      if (s) stay.push({ pts: s, m: l.m, back: l.back, shade: l.shade });
      if (f) move.push({
        pts: f.map(function (p) { var r = new DOMPoint(p[0], p[1]).matrixTransform(m); return [r.x, r.y]; }),
        m: m.multiply(l.m), back: t > 0.5 ? !l.back : l.back, shade: Math.sin(Math.PI * t) * 0.28,
      });
    });
    if (t > 0.5) move.reverse();
    return stay.concat(move);
  }

  function path(g, pts) {
    g.beginPath();
    pts.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.closePath();
  }

  function drawFolding(g, tex, w, h, t1, t2) {
    var nose = [0, -h / 2], x = w / 2, y1 = -h / 2 + w / 2, y2 = -h / 2 + (w / 2) / Math.tan(Math.PI / 8);
    var layers = [{ pts: [[-x, -h / 2], [x, -h / 2], [x, h / 2], [-x, h / 2]], m: new DOMMatrix(), back: false, shade: 0 }];
    layers = fold(layers, nose, [-x, y1], 1, t1);
    layers = fold(layers, nose, [x, y1], -1, t1);
    layers = fold(layers, nose, [-x, y2], 1, t2);
    layers = fold(layers, nose, [x, y2], -1, t2);
    layers.forEach(function (l) {
      g.save();
      g.shadowColor = "rgba(10,12,35,.28)"; g.shadowBlur = 9; g.shadowOffsetY = 3;
      path(g, l.pts); g.fillStyle = l.back ? "#d9def4" : "#f6f7ff"; g.fill();
      g.shadowColor = "transparent";
      if (!l.back) {
        g.clip();
        g.transform(l.m.a, l.m.b, l.m.c, l.m.d, l.m.e, l.m.f);
        g.drawImage(tex, -w / 2, -h / 2, w, h);
      }
      g.restore();
      path(g, l.pts);
      if (l.shade) { g.fillStyle = "rgba(40,45,100," + l.shade + ")"; g.fill(); }
      g.strokeStyle = "rgba(70,80,150,.35)"; g.lineWidth = 1; g.stroke();
    });
  }

  // готовый самолётик носом вверх; w, h — размеры исходного листа
  function drawPlane(g, w, h) {
    var top = -h / 2, s = w * 0.52;
    var part = function (pts, c1, c2) {
      var fill = g.createLinearGradient(-s, top, s, h / 2);
      fill.addColorStop(0, c1); fill.addColorStop(1, c2);
      path(g, pts); g.fillStyle = fill; g.fill();
      g.strokeStyle = "rgba(90,100,175,.55)"; g.lineWidth = 1.5; g.lineJoin = "round"; g.stroke();
    };
    g.save();
    g.shadowColor = "rgba(150,140,255,.75)"; g.shadowBlur = 28;
    path(g, [[0, top], [-s, h * 0.36], [-s * 0.13, h * 0.24], [0, h * 0.46], [s * 0.13, h * 0.24], [s, h * 0.36]]);
    g.fillStyle = "#eef0ff"; g.fill();
    g.restore();
    part([[0, top], [-s, h * 0.36], [-s * 0.13, h * 0.24]], "#ffffff", "#e3e7fb");
    part([[0, top], [s, h * 0.36], [s * 0.13, h * 0.24]], "#e8ebfc", "#c3caef");
    part([[0, top], [-s * 0.13, h * 0.24], [0, h * 0.46]], "#c9cff2", "#aab2e0");
    part([[0, top], [s * 0.13, h * 0.24], [0, h * 0.46]], "#a9b0de", "#8f97cc");
  }

  /* ---------- маршрут: разгон, мёртвая петля и вылет за экран ---------- */
  function route(W, H, cx, cy) {
    var R = Math.min(W, H) * 0.19, ox = cx + R * 0.2, oy = cy - R * 0.55;
    var pts = [[cx - R * 1.1, cy + R * 0.35]];
    for (var a = 90; a >= -270; a -= 45) {
      pts.push([ox + R * Math.cos(a * Math.PI / 180), oy + R * Math.sin(a * Math.PI / 180)]);
    }
    pts.push([ox + R * 1.3, oy + R * 0.7], [Math.max(W * 0.86, ox + R * 2.1), oy - R * 0.7], [W + 160, -140]);
    var line = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      for (var j = 0; j < 24; j++) {
        var t = j / 24, t2 = t * t, t3 = t2 * t;
        line.push([0, 1].map(function (k) {
          return 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t3);
        }));
      }
    }
    line.push(pts[pts.length - 1]);
    var len = [0];
    for (var n = 1; n < line.length; n++) len.push(len[n - 1] + Math.hypot(line[n][0] - line[n - 1][0], line[n][1] - line[n - 1][1]));
    var total = len[len.length - 1];
    return {
      total: total,
      at: function (d) {
        d = Math.max(0, Math.min(total, d));
        var i = 1;
        while (i < len.length - 1 && len[i] < d) i++;
        var a = line[i - 1], b = line[i], k = (d - len[i - 1]) / (len[i] - len[i - 1] || 1);
        return { x: mix(a[0], b[0], k), y: mix(a[1], b[1], k), angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      },
    };
  }

  /* ---------- проигрывание ---------- */
  var nothing = { send: function () { return Promise.resolve(); }, cancel: function () { return Promise.resolve(); } };

  function start(opts) {
    var from = opts.from;
    if (!from || !window.DOMMatrix || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return nothing;
    var cv = document.createElement("canvas");
    cv.id = "rey-plane";
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;z-index:1000;touch-action:none";
    document.body.appendChild(cv);
    var g = cv.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2);
    document.activeElement?.blur?.(); // прячем клавиатуру
    var fields = opts.fields || [];
    fields.forEach(function (f) { f.style.color = "transparent"; });

    var pw = Math.min(250, innerWidth * 0.62, innerHeight * 0.42), ph = pw * 1.36;
    var tex = sheet(pw, ph, opts.title, opts.text, dpr);
    var born = performance.now(), mode = "wait", since = 0, backFrom = 0, done = null, over = false, frame = 0, timer = 0;
    var way = null, sparks = [], buzzed = {}, label = "Отправлено!";

    function end() {
      if (over) return;
      over = true;
      cancelAnimationFrame(frame); clearTimeout(timer);
      document.removeEventListener("visibilitychange", hidden);
      cv.remove();
      fields.forEach(function (f) { f.style.color = ""; });
      done?.();
    }
    var hidden = function () { if (document.hidden && mode !== "wait") end(); };
    document.addEventListener("visibilitychange", hidden);
    cv.addEventListener("pointerdown", function (e) { e.preventDefault(); if (mode === "send") end(); }); // касание пропускает полёт

    function once(key, kind) { if (!buzzed[key]) { buzzed[key] = 1; haptic(kind); } }

    function draw() {
      if (over) return;
      var now = performance.now(), age = now - born, W = innerWidth, H = innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); way = null;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      var cx = W / 2, cy = H * 0.5;
      // ответ пришёл раньше, чем лист сложился: сначала доскладываем
      if (mode === "send" && !since && age >= FOLD) since = now;
      var out = mode === "send" && since ? now - since : -1;
      var f = age;
      if (mode === "cancel") {
        f = backFrom * (1 - clamp((now - since) / 600));
        if (now - since >= 600) return end();
      }
      var dim = mode === "cancel" ? clamp(f / LIFT) : clamp(age / 300);
      if (out >= 0) dim *= 1 - clamp((out - WIND - FLY - BYE * 0.5) / (BYE * 0.5));
      var shade = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
      shade.addColorStop(0, "rgba(38,30,92," + 0.86 * dim + ")");
      shade.addColorStop(1, "rgba(6,8,22," + 0.92 * dim + ")");
      g.fillStyle = shade; g.fillRect(0, 0, W, H);

      if (out < 0) {
        if (f < LIFT) { // лист отрывается от формы и встаёт по центру
          var k = ease(f / LIFT), r = from.getBoundingClientRect();
          var x = mix(r.left + r.width / 2, cx, k), y = mix(r.top + r.height / 2, cy, k);
          var w = mix(r.width, pw, k), h = mix(r.height, ph, k);
          g.save();
          g.translate(x, y); g.rotate(Math.sin(Math.PI * k) * -0.07);
          g.globalAlpha = clamp(f / 120);
          g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 26; g.shadowOffsetY = 10;
          g.fillStyle = "#f6f7ff"; g.fillRect(-w / 2, -h / 2, w, h);
          g.shadowColor = "transparent";
          var fit = Math.min(w / pw, h / ph);
          g.globalAlpha *= clamp(k * 1.6);
          g.drawImage(tex, -pw * fit / 2, -ph * fit / 2, pw * fit, ph * fit);
          g.restore();
        } else {
          var t1 = ease((f - LIFT) / F1), t2 = ease((f - LIFT - F1) / F2), m = ease((f - LIFT - F1 - F2) / MORPH);
          var bob = f >= FOLD ? Math.sin((age - FOLD) / 260) * 7 : 0;
          if (t1 >= 1) once("f1", "light");
          if (t2 >= 1) once("f2", "light");
          g.save();
          g.translate(cx, cy + bob);
          var pop = 1 + Math.sin(Math.PI * m) * 0.12;
          g.scale(pop, pop);
          if (m < 1) { g.save(); g.globalAlpha = 1 - m * m; drawFolding(g, tex, pw, ph, t1, t2); g.restore(); }
          if (m > 0) { g.globalAlpha = m; drawPlane(g, pw, ph); }
          g.restore();
        }
      } else {
        if (!way) way = route(W, H, cx, cy);
        var first = way.at(0), heading = Math.atan2(Math.sin(first.angle + Math.PI / 2), Math.cos(first.angle + Math.PI / 2));
        var pos, rot, scale, travelled = 0;
        if (out < WIND) { // замах: отходим назад и разворачиваемся по курсу
          var u = ease(out / WIND);
          pos = { x: mix(cx, first.x, u), y: mix(cy, first.y, u) };
          rot = heading * u; scale = mix(1, 0.5, u);
        } else {
          once("go", "medium");
          var v = clamp((out - WIND) / FLY);
          travelled = way.total * (0.3 * v + 0.7 * v * v); // постепенно набирает скорость
          pos = way.at(travelled);
          rot = pos.angle + Math.PI / 2; scale = mix(0.5, 0.2, v * v);
          if (v < 1) for (var s = 0; s < 2; s++) {
            sparks.push({ x: pos.x + (Math.random() - 0.5) * 26, y: pos.y + (Math.random() - 0.5) * 26, born: now, size: 1.5 + Math.random() * 3.5, hue: [48, 190, 255, 320][(Math.random() * 4) | 0] });
          }
        }
        // пунктирный след
        var tail = Math.max(0, travelled - Math.max(W, H) * 0.9);
        g.lineCap = "round"; g.lineWidth = 3;
        for (var d = Math.ceil(tail / 22) * 22; d < travelled - 24; d += 22) {
          var a = way.at(d), b = way.at(d + 10);
          var alpha = clamp((d - tail) / (travelled - tail)) * (1 - clamp((out - WIND - FLY) / 400));
          g.strokeStyle = "rgba(190,180,255," + alpha * 0.85 + ")";
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        sparks = sparks.filter(function (p) { return now - p.born < 700; });
        sparks.forEach(function (p) {
          var life = 1 - (now - p.born) / 700, z = p.size * life;
          g.fillStyle = "hsla(" + p.hue + ",95%,75%," + life + ")";
          path(g, [[p.x, p.y - z * 2], [p.x + z * 0.55, p.y], [p.x, p.y + z * 2], [p.x - z * 0.55, p.y]]); g.fill();
          path(g, [[p.x - z * 2, p.y], [p.x, p.y - z * 0.55], [p.x + z * 2, p.y], [p.x, p.y + z * 0.55]]); g.fill();
        });
        if (out < WIND + FLY) {
          g.save(); g.translate(pos.x, pos.y); g.rotate(rot); g.scale(scale, scale); drawPlane(g, pw, ph); g.restore();
        } else { // «Отправлено» с галочкой
          once("ok", "success");
          var e = (out - WIND - FLY) / BYE, grow = ease(e * 2.6), fade = 1 - clamp((e - 0.75) * 4);
          g.save();
          g.translate(cx, cy); g.globalAlpha = fade;
          g.beginPath(); g.arc(0, -22, 38 * grow, 0, Math.PI * 2); g.fillStyle = "#34d17a"; g.fill();
          g.strokeStyle = "#fff"; g.lineWidth = 7; g.lineCap = g.lineJoin = "round";
          g.setLineDash([70, 70]); g.lineDashOffset = 70 * (1 - clamp(e * 2.4 - 0.25));
          if (e > 0.11) { g.beginPath(); g.moveTo(-17, -22); g.lineTo(-5, -10); g.lineTo(19, -34); g.stroke(); }
          g.fillStyle = "#fff"; g.textAlign = "center";
          g.font = "800 24px system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
          g.globalAlpha = fade * clamp(e * 3);
          g.fillText(label, 0, 52);
          g.restore();
        }
        if (out >= OUT) return end();
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);

    function finish(next) {
      return new Promise(function (resolve) {
        if (over || mode !== "wait") return resolve();
        done = resolve;
        mode = next;
        if (next === "cancel") { since = performance.now(); backFrom = Math.min(since - born, FOLD); }
        if (document.hidden) return end();
        timer = setTimeout(end, FOLD + OUT + 1000); // страховка, если кадры не рисуются
      });
    }
    return { send: function (text) { label = text || label; return finish("send"); }, cancel: function () { return finish("cancel"); } };
  }

  window.ReyPlane = { start: start };
})();
