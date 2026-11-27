/* Пасхалка кабинета (5 тапов по заголовку): минутная анимация «Ночь Мурзика».
   Каждый кадр считается только от времени t, поэтому анимацию можно открыть с любой секунды. */
(function (root) {
  "use strict";
  var doc = root.document;
  var LENGTH = 62, TAU = Math.PI * 2;

  function rand(seed) { // повторяемые «случайные» числа
    return function () { seed = (seed + 0x6d2b79f5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  var clamp = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  // 0 до a, плавно до 1 к b
  var ease = function (t, a, b) { var x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  // плавно появиться в a и исчезнуть к d
  var span = function (t, a, b, c, d) { return ease(t, a, b) * (1 - ease(t, c, d)); };
  function mix(a, b, k) {
    var x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    var f = function (s) { return Math.round(((x >> s) & 255) + (((y >> s) & 255) - ((x >> s) & 255)) * k); };
    return "rgb(" + f(16) + "," + f(8) + "," + f(0) + ")";
  }
  // цвета неба: время, верх, середина, низ
  var SKY = [[0, "#000000", "#000000", "#000000"], [5, "#02030c", "#050824", "#0a0f33"], [20, "#050725", "#121650", "#2b2468"],
    [36, "#07061f", "#1b1050", "#4a226e"], [46, "#121247", "#4b2670", "#b4486f"], [53, "#3c5aa8", "#e87f86", "#ffc27a"], [62, "#5f97dc", "#f6b9a0", "#ffe3a8"]];

  /* ---------- звук: тихая музыка, колокольчики и салюты ---------- */
  var NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5];
  var CHORDS = [[130.8, 196, 329.6], [110, 164.8, 261.6], [87.3, 130.8, 220], [98, 146.8, 246.9]];
  var SOUNDS = (function () {
    var list = [], R = rand(77), t, i;
    for (t = 1, i = 0; t < 56; t += 6, i++) CHORDS[i % 4].forEach(function (f) { list.push([t, f, 6.5, "sine", 0.045, 1.5]); });
    for (t = 2.5; t < 46; t += 0.9 + R() * 1.1) list.push([t, NOTES[(R() * NOTES.length) | 0], 1.8, "triangle", 0.025, 0.02]);
    [523.25, 659.25, 783.99, 1046.5, 783.99, 880, 1046.5, 1318.5].forEach(function (f, k) { list.push([50 + k * 0.5, f, 2.2, "triangle", 0.045, 0.02]); });
    [130.8, 196, 261.6, 329.6].forEach(function (f) { list.push([54.5, f, 7, "sine", 0.05, 1]); });
    return list;
  })();

  /* ---------- салюты ---------- */
  var FIRE = (function () {
    var R = rand(31), list = [], t = 34.5;
    while (t < 44.5) {
      list.push({ t: t, x: 0.12 + R() * 0.76, y: 0.14 + R() * 0.3, hue: (R() * 360) | 0, n: 70, r: 0.16 + R() * 0.12, shape: "ball", seed: (R() * 1e6) | 0 });
      t += 0.35 + R() * 0.75;
    }
    list.push({ t: 40.2, x: 0.5, y: 0.28, hue: 340, n: 90, r: 0.3, shape: "heart", seed: 5 });
    list.push({ t: 44.2, x: 0.5, y: 0.3, hue: 36, n: 120, r: 0.34, shape: "cat", seed: 9 });
    return list;
  })();
  // контур кошачьей морды (для созвездия и финального салюта), координаты -1..1
  var CAT = [[-0.78, -0.18], [-0.82, -0.95], [-0.36, -0.6], [0, -0.66], [0.36, -0.6], [0.82, -0.95], [0.78, -0.18], [0.86, 0.24], [0.6, 0.62], [0.24, 0.82], [0, 0.86], [-0.24, 0.82], [-0.6, 0.62], [-0.86, 0.24], [-0.78, -0.18]];
  function along(path, k) { // точка на ломаной, k от 0 до 1
    var s = k * (path.length - 1), i = Math.min(path.length - 2, Math.floor(s)), f = s - i;
    return [path[i][0] + (path[i + 1][0] - path[i][0]) * f, path[i][1] + (path[i + 1][1] - path[i][1]) * f];
  }

  var CAPTIONS = [[1.5, 5.5, "Тсс…"], [6, 10, "Ты нажал куда не следовало"], [16, 19.5, "Кажется, кто-то смотрит"], [24.5, 28.5, "Это Мурзик. Он не спит"], [30, 33.5, "Загадай желание"], [46.5, 49.5, "А вот и утро"]];

  var el = null, cv = null, c = null, W = 0, H = 0, U = 0, raf = 0, time = 0, prev = 0, audio = null, played = 0, muted = false, wake = null, done = null;
  var stars = [], city = [], lanterns = [], words = [], glows = {};

  function glow(color) { // заранее нарисованное свечение: быстрее, чем тени на каждом кадре
    if (glows[color]) return glows[color];
    var s = doc.createElement("canvas"); s.width = s.height = 64;
    var g = s.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(" + color + ",1)"); r.addColorStop(0.25, "rgba(" + color + ",.55)"); r.addColorStop(1, "rgba(" + color + ",0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return (glows[color] = s);
  }
  function light(x, y, size, color, alpha) {
    if (alpha <= 0.01) return;
    c.globalAlpha = Math.min(1, alpha);
    c.drawImage(glow(color), x - size / 2, y - size / 2, size, size);
    c.globalAlpha = 1;
  }

  // точки, из которых складываются слова финала
  function textDots(lines) {
    var s = doc.createElement("canvas"), g = s.getContext("2d"), w = Math.round(W), size = Math.min(W / 9, H / 10, 76);
    s.width = w; s.height = Math.round(size * 1.35 * lines.length);
    g.font = "900 " + size + "px -apple-system,'Segoe UI',Roboto,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
    lines.forEach(function (t, i) {
      var k = Math.min(1, (w * 0.92) / g.measureText(t).width);
      g.save(); g.translate(w / 2, size * 1.35 * (i + 0.5)); g.scale(k, k); g.fillText(t, 0, 0); g.restore();
    });
    var data = g.getImageData(0, 0, s.width, s.height).data, step = Math.max(3, Math.round(size / 15)), out = [], R = rand(3);
    for (var y = 0; y < s.height; y += step) for (var x = 0; x < s.width; x += step)
      if (data[(y * s.width + x) * 4 + 3] > 128) out.push({ x: x, y: y + H * 0.14, fx: R() * W, fy: R() * H, delay: R() * 2, s: step });
    return { dots: out, image: s };
  }

  function build() {
    var R = rand(11), i, x;
    stars = [];
    for (i = 0; i < 240; i++) stars.push({ x: R(), y: R() * 0.82, r: 0.5 + R() * R() * 2.2, at: 0.8 + R() * 8, f: 1 + R() * 3, p: R() * TAU });
    city = [];
    for (x = -10; x < W + 10; ) {
      var bw = U * (0.09 + R() * 0.11), bh = H * (0.09 + R() * 0.17), win = [], step = Math.max(9, U * 0.028);
      for (var wy = step; wy < bh - step; wy += step) for (var wx = step * 0.6; wx < bw - step * 0.8; wx += step) if (R() < 0.5) win.push([wx, wy, 19 + R() * 15]);
      city.push({ x: x, w: bw, h: bh, win: win, s: step });
      x += bw + 2;
    }
    lanterns = [];
    for (i = 0; i < 46; i++) lanterns.push({ x: R(), at: 22.5 + R() * 9, v: 0.07 + R() * 0.06, s: 0.35 + R() * 0.75, p: R() * TAU });
    lanterns.sort(function (a, b) { return a.s - b.s; });
    words = textDots(["Ты нашёл", "пасхалку!"]);
  }
  function resize() {
    if (!el) return;
    var dpr = Math.min(2, root.devicePixelRatio || 1);
    W = el.clientWidth || root.innerWidth; H = el.clientHeight || root.innerHeight; U = Math.min(W, H);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function drawSky(t) {
    var i = 0; while (i < SKY.length - 2 && t > SKY[i + 1][0]) i++;
    var a = SKY[i], b = SKY[i + 1], k = clamp((t - a[0]) / (b[0] - a[0]));
    var g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(a[1], b[1], k)); g.addColorStop(0.6, mix(a[2], b[2], k)); g.addColorStop(1, mix(a[3], b[3], k));
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // туманность
    var neb = span(t, 8, 18, 42, 52);
    light(W * (0.25 + Math.sin(t * 0.05) * 0.1), H * 0.28, U * 1.3, "130,80,255", neb * 0.22);
    light(W * 0.82, H * (0.5 + Math.cos(t * 0.07) * 0.05), U * 1.1, "255,90,180", neb * 0.16);
  }
  function drawStars(t) {
    var fade = 1 - ease(t, 45, 53);
    stars.forEach(function (s) {
      var a = ease(t, s.at, s.at + 1.2) * fade * (0.65 + 0.35 * Math.sin(t * s.f + s.p));
      if (a <= 0.02) return;
      c.globalAlpha = a; c.fillStyle = "#fff"; c.beginPath(); c.arc(s.x * W, s.y * H, s.r * 0.8, 0, TAU); c.fill(); c.globalAlpha = 1;
      if (s.r > 1.8) light(s.x * W, s.y * H, s.r * 10, "190,205,255", a * 0.7);
    });
    // падающие звёзды
    [[4.5, 0.15, 0.1], [8.2, 0.7, 0.06], [13.5, 0.45, 0.2], [30.2, 0.1, 0.12], [31.4, 0.55, 0.05], [32.3, 0.3, 0.22]].forEach(function (m) {
      var k = (t - m[0]) / 1.3;
      if (k < 0 || k > 1) return;
      var x = m[1] * W + k * U * 0.75, y = m[2] * H + k * U * 0.32, tail = U * 0.22 * Math.sin(k * Math.PI);
      var g = c.createLinearGradient(x - tail, y - tail * 0.43, x, y);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,.95)");
      c.strokeStyle = g; c.lineWidth = 2.2; c.beginPath(); c.moveTo(x - tail, y - tail * 0.43); c.lineTo(x, y); c.stroke();
      light(x, y, 26, "255,255,255", Math.sin(k * Math.PI));
    });
  }
  // созвездие-кот: звёзды зажигаются, соединяются, кот открывает глаза и рассыпается искрами
  function drawConstellation(t) {
    if (t < 9 || t > 25.5) return;
    var cx = W / 2, cy = H * 0.36, r = Math.min(W * 0.36, H * 0.23);
    var live = ease(t, 15.5, 17), away = ease(t, 20.5, 25);
    var bob = Math.sin(t * 1.4) * r * 0.025 * live;
    var P = function (p) { return [cx + p[0] * r, cy + p[1] * r + bob]; };
    var drawn = ease(t, 10, 15.5) * (CAT.length - 1);
    c.lineWidth = 1.4 + live; c.lineCap = "round"; c.strokeStyle = live ? mix("#9fb4ff", "#ffd27a", live) : "#9fb4ff"; c.globalAlpha = 0.75 * (1 - ease(t, 20.2, 21.8));
    c.beginPath();
    for (var i = 0; i < Math.ceil(drawn); i++) {
      var a = P(CAT[i]), b = P(along(CAT, Math.min(drawn, i + 1) / (CAT.length - 1)));
      c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
    }
    c.stroke();
    // усы
    var wk = ease(t, 15, 16.5);
    if (wk > 0) [-1, 1].forEach(function (s) {
      [-0.08, 0.1, 0.28].forEach(function (dy, j) {
        var a = P([s * 0.42, 0.34 + dy * 0.5]), b = P([s * (0.42 + 0.78 * wk), 0.34 + dy * 1.35 + Math.sin(t * 3 + j) * 0.02]);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      });
    });
    c.globalAlpha = 1;
    // вершины, а потом искры, улетающие вверх
    var R = rand(21);
    for (var n = 0; n < 150; n++) {
      var k = n / 150, p = P(along(CAT, k)), vx = (R() - 0.5) * r * 1.4, vy = -(0.3 + R()) * r * 1.6;
      var node = n < CAT.length - 1;
      if (node) { var q = P(CAT[n]); light(q[0], q[1], 30 + 8 * Math.sin(t * 3 + n), "255,235,190", ease(t, 9 + n * 0.12, 9.6 + n * 0.12) * (1 - ease(t, 20.4, 21.4))); }
      var spark = span(t, 20.2, 20.8, 22.5 + R() * 2.5, 25.2);
      if (spark > 0) light(p[0] + vx * away + Math.sin(t * 4 + n) * 6 * away, p[1] + vy * away, 10 + R() * 14, "255,214,130", spark);
    }
    // глаза и нос
    var open = ease(t, 16, 16.8) * (1 - ease(t, 20.4, 21.2));
    [17.9, 19.3].forEach(function (b) { open *= 1 - span(t, b, b + 0.12, b + 0.12, b + 0.28); });
    if (open > 0.02) [-1, 1].forEach(function (s) {
      var e = P([s * 0.36, 0.02]);
      light(e[0], e[1], r * 0.7, "120,255,190", open * 0.65);
      c.fillStyle = "#b6ffd8"; c.beginPath(); c.ellipse(e[0], e[1], r * 0.14, r * 0.17 * open, 0, 0, TAU); c.fill();
      c.fillStyle = "#0b1030"; c.beginPath(); c.ellipse(e[0] + Math.sin(t * 1.7) * r * 0.04, e[1], r * 0.035, r * 0.14 * open, 0, 0, TAU); c.fill();
    });
    var nose = P([0, 0.32]); light(nose[0], nose[1], r * 0.28, "255,130,180", open);
  }
  function drawMoon(t) {
    var up = ease(t, 14, 30), gone = ease(t, 46, 56);
    if (!up || gone === 1) return;
    var x = W * 0.8, y = H * (0.95 - 0.78 * up + 0.3 * gone), r = U * 0.075;
    c.globalAlpha = 1 - gone;
    light(x, y, r * 7, "210,220,255", 0.4 * (1 - gone));
    c.globalAlpha = 1 - gone; c.fillStyle = "#f2f0dc"; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.fillStyle = "rgba(160,160,140,.35)";
    [[-0.35, -0.2, 0.22], [0.28, 0.3, 0.16], [0.2, -0.42, 0.1], [-0.15, 0.45, 0.09]].forEach(function (m) { c.beginPath(); c.arc(x + m[0] * r, y + m[1] * r, m[2] * r, 0, TAU); c.fill(); });
    c.globalAlpha = 1;
  }
  function drawSun(t) {
    var up = ease(t, 46, 58);
    if (!up) return;
    var x = W / 2, y = H * (1.05 - 0.48 * up), r = U * 0.14;
    light(x, y, U * 2.4 * up, "255,190,110", 0.55);
    c.save(); c.translate(x, y); c.rotate(t * 0.08);
    c.fillStyle = "rgba(255,225,160," + 0.13 * up + ")";
    for (var i = 0; i < 14; i++) { c.rotate(TAU / 14); c.beginPath(); c.moveTo(0, 0); c.lineTo(U * 1.4, -U * 0.07); c.lineTo(U * 1.4, U * 0.07); c.fill(); }
    c.restore();
    c.fillStyle = "#fff0c2"; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  function drawLanterns(t) {
    lanterns.forEach(function (l) {
      var age = t - l.at;
      if (age < 0) return;
      var y = H * 1.05 - age * l.v * H * (0.5 + l.s * 0.6), x = l.x * W + Math.sin(age * 0.8 + l.p) * U * 0.035;
      if (y < -60) return;
      var s = U * 0.05 * l.s, a = (1 - ease(t, 40, 47)) * Math.min(1, age);
      if (a <= 0) return;
      light(x, y, s * 5, "255,150,60", a * (0.5 + 0.12 * Math.sin(t * 9 + l.p)));
      c.globalAlpha = a;
      var g = c.createLinearGradient(x, y - s, x, y + s); g.addColorStop(0, "#e0522f"); g.addColorStop(1, "#ffd277");
      c.fillStyle = g; c.beginPath();
      c.moveTo(x - s * 0.45, y + s * 0.7); c.bezierCurveTo(x - s * 0.95, y - s * 0.2, x - s * 0.6, y - s, x, y - s); c.bezierCurveTo(x + s * 0.6, y - s, x + s * 0.95, y - s * 0.2, x + s * 0.45, y + s * 0.7); c.fill();
      c.fillStyle = "#fff3c4"; c.fillRect(x - s * 0.22, y + s * 0.62, s * 0.44, s * 0.16);
      c.globalAlpha = 1;
    });
  }
  function drawFireworks(t) {
    c.globalCompositeOperation = "lighter";
    FIRE.forEach(function (f) {
      var age = t - f.t, big = f.shape !== "ball", x = f.x * W, y = (big ? 0.34 : f.y) * H, life = big ? 3.6 : 2.1;
      if (age < -0.9 || age > life) return;
      var hsl = "hsl(" + f.hue + ",100%,";
      if (age < 0) { // взлёт
        var k = 1 + age / 0.9, ry = H - (H - y) * (1 - (1 - k) * (1 - k));
        c.strokeStyle = hsl + "80%)"; c.lineWidth = 2; c.globalAlpha = 0.8; c.beginPath(); c.moveTo(x, ry); c.lineTo(x, ry + U * 0.05 * (1 - k * 0.7)); c.stroke(); c.globalAlpha = 1;
        return;
      }
      var R = rand(f.seed), a = 1 - ease(age, life * 0.45, life), out = 1 - Math.pow(1 - clamp(age / (big ? 0.9 : 1.1)), 3);
      light(x, y, U * 0.7, "255,220,180", (1 - clamp(age / 0.45)) * 0.7);
      for (var i = 0; i < f.n; i++) {
        var px, py, w = R();
        if (f.shape === "heart") { var h = (i / f.n) * TAU; px = Math.pow(Math.sin(h), 3); py = -(13 * Math.cos(h) - 5 * Math.cos(2 * h) - 2 * Math.cos(3 * h) - Math.cos(4 * h)) / 16; }
        else if (f.shape === "cat") {
          if (i < 100) { var p = along(CAT, i / 100); px = p[0]; py = p[1]; }
          else { var e = ((i - 100) / 10) * TAU; px = (i < 110 ? -0.36 : 0.36) + Math.cos(e) * 0.12; py = 0.02 + Math.sin(e) * 0.16; }
        } else { var an = R() * TAU, d = Math.sqrt(R()); px = Math.cos(an) * d; py = Math.sin(an) * d; }
        var rr = big ? Math.min(U * f.r, H * 0.22) : U * f.r * (0.85 + w * 0.3), fall = age * age * U * (big ? 0.006 : 0.022);
        var sx = x + px * rr * out, sy = y + py * rr * out + fall;
        var tw = age > life * 0.5 ? 0.6 + 0.4 * Math.sin(t * 30 + i) : 1;
        c.globalAlpha = a * tw; c.fillStyle = hsl + (60 + w * 25) + "%)";
        c.beginPath(); c.arc(sx, sy, big ? 2.6 : 1.6 + w * 1.4, 0, TAU); c.fill();
        if (!big) { c.strokeStyle = c.fillStyle; c.lineWidth = 1.2; c.globalAlpha = a * 0.35; c.beginPath(); c.moveTo(sx, sy); c.lineTo(x + px * rr * out * 0.82, y + py * rr * out * 0.82 + fall * 0.8); c.stroke(); }
        c.globalAlpha = 1;
        if (i % 4 === 0) { c.globalAlpha = a * 0.45; c.fillStyle = hsl + "55%)"; c.beginPath(); c.arc(sx, sy, 7, 0, TAU); c.fill(); c.globalAlpha = 1; }
      }
    });
    c.globalCompositeOperation = "source-over";
  }
  // город поднимается снизу, на крыше сидит Мурзик
  function drawCity(t) {
    var rise = ease(t, 18, 25);
    if (!rise) return;
    var base = H + (1 - rise) * H * 0.4, day = ease(t, 46, 56), best = null;
    city.forEach(function (b, bi) {
      var y = base - b.h;
      c.fillStyle = mix("#070817", "#3a2748", day); c.fillRect(b.x, y, b.w, b.h + 2);
      b.win.forEach(function (w, i) {
        if (t < w[2] + (i % 5) * 0.3 || (day && (i * 7 + bi) % 10 < day * 10)) return;
        c.fillStyle = (i + bi) % 7 ? "rgba(255,205,110,.85)" : "rgba(140,210,255,.85)";
        c.fillRect(b.x + w[0], y + w[1], b.s * 0.45, b.s * 0.55);
      });
      var mid = b.x + b.w / 2;
      if (!best || Math.abs(mid - W * 0.3) < Math.abs(best.x + best.w / 2 - W * 0.3)) best = b;
    });
    if (best) drawCat(t, best.x + best.w / 2, base - best.h, U * 0.085, day);
  }
  function drawCat(t, x, y, s, day) {
    var body = mix("#05050d", "#2a1830", day);
    c.fillStyle = body; c.strokeStyle = body; c.lineCap = "round";
    c.lineWidth = s * 0.22; c.beginPath(); c.moveTo(x + s * 0.35, y - s * 0.12);
    c.quadraticCurveTo(x + s * 1.25, y + s * 0.05, x + s * (1.05 + Math.sin(t * 1.8) * 0.22), y - s * (0.85 + Math.cos(t * 1.8) * 0.12)); c.stroke();
    c.beginPath(); c.ellipse(x, y - s * 0.55, s * 0.52, s * 0.6, 0, 0, TAU); c.fill();
    var hx = x - s * 0.08 + Math.sin(t * 0.5) * s * 0.08, hy = y - s * 1.3;
    c.beginPath(); c.arc(hx, hy, s * 0.42, 0, TAU); c.fill();
    [-1, 1].forEach(function (d) { c.beginPath(); c.moveTo(hx + d * s * 0.4, hy - s * 0.1); c.lineTo(hx + d * s * 0.38, hy - s * (d > 0 && t % 4 < 0.2 ? 0.52 : 0.68)); c.lineTo(hx + d * s * 0.08, hy - s * 0.38); c.fill(); });
    // контур от луны и глаза
    c.strokeStyle = "rgba(190,200,255," + 0.55 * (1 - day) + ")"; c.lineWidth = 1.4; c.beginPath(); c.arc(hx, hy, s * 0.42, -1.2, 0.5); c.stroke(); c.beginPath(); c.ellipse(x, y - s * 0.55, s * 0.52, s * 0.6, 0, -0.9, 0.7); c.stroke();
    var shut = t % 3.7 < 0.15 || t > 57.5;
    [-1, 1].forEach(function (d) {
      var ex = hx + d * s * 0.16;
      if (shut) { c.strokeStyle = "#b6ffd8"; c.lineWidth = 1.5; c.beginPath(); c.arc(ex, hy - s * 0.04, s * 0.08, 0.2, Math.PI - 0.2); c.stroke(); return; }
      light(ex, hy, s * 0.45, "120,255,190", 0.5 * (1 - day * 0.6));
      c.fillStyle = "#b6ffd8"; c.beginPath(); c.ellipse(ex, hy, s * 0.07, s * 0.095, 0, 0, TAU); c.fill();
    });
    // после рассвета кот засыпает
    if (t > 57.5) for (var i = 0; i < 3; i++) {
      var k = ((t - 57.5) * 0.45 + i / 3) % 1;
      c.globalAlpha = Math.sin(k * Math.PI); c.fillStyle = "#fff"; c.font = "700 " + s * (0.22 + k * 0.3) + "px sans-serif";
      c.fillText("z", hx + s * (0.45 + k * 0.7), hy - s * (0.5 + k * 1.1)); c.globalAlpha = 1;
    }
  }
  function drawBirds(t) {
    if (t < 49) return;
    c.strokeStyle = "rgba(55,25,60,.75)"; c.lineWidth = 2; c.lineCap = "round";
    for (var i = 0; i < 9; i++) {
      var x = -U * 0.1 + (t - 49 - Math.abs(i - 4) * 0.35) * W * 0.11, y = H * 0.5 + (i - 4) * U * 0.028 - (t - 49) * H * 0.012;
      if (x < -20 || x > W + 20) continue;
      var f = Math.sin(t * 8 + i) * U * 0.013, s = U * 0.022;
      c.beginPath(); c.moveTo(x - s, y - f); c.quadraticCurveTo(x - s * 0.4, y - f * 0.3 - s * 0.3, x, y); c.quadraticCurveTo(x + s * 0.4, y - f * 0.3 - s * 0.3, x + s, y - f); c.stroke();
    }
  }
  function drawWords(t) {
    if (t < 50) return;
    var solid = ease(t, 55, 56.5);
    if (solid < 1) words.dots.forEach(function (d, i) {
      var k = ease(t, 50 + d.delay, 53.5 + d.delay);
      var x = d.fx + (d.x - d.fx) * k + Math.sin(t * 3 + i) * 14 * (1 - k), y = d.fy + (d.y - d.fy) * k + Math.cos(t * 2 + i) * 14 * (1 - k);
      light(x, y, d.s * (2.6 - k), "255,250,225", ease(t, 50 + d.delay * 0.5, 51 + d.delay) * (1 - solid));
    });
    if (solid > 0) {
      c.save(); c.globalAlpha = solid; c.shadowColor = "rgba(120,40,90,.75)"; c.shadowBlur = 18;
      c.drawImage(words.image, 0, H * 0.14); c.restore();
    }
    var a = ease(t, 56.5, 58);
    if (a > 0) {
      c.globalAlpha = a; c.fillStyle = "#fff"; c.textAlign = "center"; c.font = "700 " + Math.max(15, U * 0.045) + "px -apple-system,'Segoe UI',Roboto,sans-serif";
      c.shadowColor = "rgba(90,30,80,.9)"; c.shadowBlur = 8;
      c.fillText("Мурзик желает тебе хорошего дня 🐾", W / 2, H * 0.14 + words.image.height + U * 0.06, W * 0.92);
      c.shadowBlur = 0; c.globalAlpha = 1; c.textAlign = "left";
    }
  }
  function drawCaption(t) {
    CAPTIONS.forEach(function (x) {
      var a = span(t, x[0], x[0] + 0.9, x[1] - 0.9, x[1]);
      if (a <= 0) return;
      c.globalAlpha = a; c.fillStyle = "#fff"; c.textAlign = "center"; c.font = "600 " + Math.max(17, U * 0.05) + "px -apple-system,'Segoe UI',Roboto,sans-serif";
      c.shadowColor = "#000"; c.shadowBlur = 10;
      c.fillText(x[2], W / 2, H * (t < 9 ? 0.5 : t < 20 ? 0.68 : 0.6) + (1 - a) * 10, W * 0.9);
      c.shadowBlur = 0; c.globalAlpha = 1; c.textAlign = "left";
    });
  }
  function frame(t) {
    drawSky(t); drawStars(t); drawMoon(t); drawConstellation(t); drawSun(t); drawBirds(t);
    drawFireworks(t); drawCity(t); drawLanterns(t); drawWords(t); drawCaption(t);
  }

  function tone(f, len, type, vol, rise) {
    var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + rise); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + len);
  }
  function sound(from, to) {
    if (muted || !audio || audio.state !== "running") return;
    try {
      SOUNDS.forEach(function (s) { if (s[0] > from && s[0] <= to) tone(s[1], s[2], s[3], s[4], s[5]); });
      FIRE.forEach(function (f) { if (f.t > from && f.t <= to) { tone(60 + (f.hue % 50), 0.8, "sawtooth", 0.05, 0.01); tone(900 + f.hue * 3, 0.35, "square", 0.012, 0.01); } });
    } catch (e) {}
  }
  function tick(now) {
    raf = root.requestAnimationFrame(tick);
    // свернули приложение — время не убегает вперёд
    var dt = prev ? Math.min(0.1, (now - prev) / 1000) : 0; prev = now;
    time += dt;
    sound(played, time); played = time;
    frame(time);
    if (time >= LENGTH) el.classList.add("end");
  }
  function replay() { time = 0; played = 0; prev = 0; el.classList.remove("end"); }

  var CSS = ".egg{position:fixed;inset:0;z-index:1000;background:#000;overflow:hidden;touch-action:none;animation:egg-in 1.2s both}" +
    ".egg canvas{width:100%;height:100%;display:block}" +
    ".egg button{position:absolute;border:0;border-radius:999px;color:#fff;background:rgba(20,10,40,.45);font:inherit;font-weight:700;cursor:pointer}" +
    ".egg .x,.egg .snd{top:calc(max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)) + 10px);width:42px;height:42px;opacity:.65}" +
    ".egg .x{right:12px}.egg .snd{left:12px}" +
    ".egg .again,.egg .bye{bottom:calc(var(--bot,0px) + 22px);padding:14px 24px;visibility:hidden;opacity:0;transition:opacity .8s,visibility .8s}" +
    ".egg .again{right:calc(50% + 6px)}.egg .bye{left:calc(50% + 6px);background:#6c4fd8}" +
    ".egg.end .again,.egg.end .bye{visibility:visible;opacity:1}" +
    "@keyframes egg-in{from{opacity:0}}";

  function close() {
    if (!el) return false;
    root.cancelAnimationFrame(raf); el.remove(); el = cv = c = null; glows = {};
    root.removeEventListener("resize", resize);
    if (audio) { try { audio.close(); } catch (e) {} audio = null; }
    if (wake) { wake.release().catch(function () {}); wake = null; }
    var f = done; done = null; if (f) f();
    return true;
  }
  function button(cls, text, label, fn) {
    var b = doc.createElement("button"); b.type = "button"; b.className = cls; b.textContent = text; b.setAttribute("aria-label", label); b.onclick = fn; el.append(b); return b;
  }

  root.ReyEgg = {
    LENGTH: LENGTH,
    isOpen: function () { return !!el; },
    play: function (onClose) {
      if (el) return;
      done = onClose || null;
      if (!doc.getElementById("egg-css")) { var st = doc.createElement("style"); st.id = "egg-css"; st.textContent = CSS; doc.head.append(st); }
      el = doc.createElement("div"); el.className = "egg"; cv = doc.createElement("canvas"); el.append(cv);
      muted = false;
      try { audio = new (root.AudioContext || root.webkitAudioContext)(); audio.resume().catch(function () {}); } catch (e) { audio = null; }
      var snd = button("snd", "🔊", "Звук", function () { muted = !muted; snd.textContent = muted ? "🔇" : "🔊"; if (audio) (muted ? audio.suspend() : audio.resume()).catch(function () {}); });
      button("x", "✕", "Закрыть", close);
      button("again", "Ещё раз", "Ещё раз", replay);
      button("bye", "Закрыть", "Закрыть пасхалку", close);
      doc.body.append(el); c = cv.getContext("2d");
      resize(); root.addEventListener("resize", resize);
      time = 0; played = 0; prev = 0;
      try { root.navigator.wakeLock.request("screen").then(function (w) { if (el) wake = w; else w.release(); }, function () {}); } catch (e) {}
      raf = root.requestAnimationFrame(tick);
    },
    // перемотка (нужна для проверки кадров)
    seek: function (t) { time = t; played = t; prev = 0; if (el) { el.classList.toggle("end", t >= LENGTH); frame(t); } },
    back: close,
  };
})(window);
