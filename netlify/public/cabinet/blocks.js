/* «Блоки» — блочная головоломка с уровнями. Пока только для админа (вход из админ-панели, раздел «Разработка»).
   Первая часть файла — правила без обращения к странице (их можно прогонять в Node), вторая — экран и анимации. */
(function (root) {
  "use strict";
  var N = 8, TOTAL = 60;

  /* ================= правила ================= */
  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // фигуры: строки через «/», вес в начале и в конце игры
  var SHAPES = [];
  [
    ["#", 5, 1], ["##", 7, 3], ["###", 8, 5], ["####", 5, 5], ["#####", 1, 4],
    ["##/##", 7, 6], ["###/###", 2, 5], ["###/###/###", 0.5, 3.5],
    ["##/#.", 7, 4], ["#../###", 3, 5], ["..#/###", 3, 5], ["#../#../###", 0.6, 3.5],
    [".#./###", 2, 4], ["##./.##", 1, 3.5], [".##/##.", 1, 3.5],
    ["#./.#", 0, 1.2], ["#../.#./..#", 0, 0.7],
  ].forEach(function (d) {
    var cells = [];
    d[0].split("/").forEach(function (row, r) { row.split("").forEach(function (ch, c) { if (ch === "#") cells.push([r, c]); }); });
    var seen = {}, variants = [];
    for (var k = 0; k < 4; k++) {
      var minR = Math.min.apply(null, cells.map(function (p) { return p[0]; }));
      var minC = Math.min.apply(null, cells.map(function (p) { return p[1]; }));
      var norm = cells.map(function (p) { return [p[0] - minR, p[1] - minC]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      var key = norm.join(";");
      if (!seen[key]) { seen[key] = 1; variants.push(norm); }
      cells = cells.map(function (p) { return [p[1], -p[0]]; }); // поворот на 90°
    }
    variants.forEach(function (v) {
      SHAPES.push({
        cells: v,
        h: Math.max.apply(null, v.map(function (p) { return p[0]; })) + 1,
        w: Math.max.apply(null, v.map(function (p) { return p[1]; })) + 1,
        w0: d[1] / variants.length, w1: d[2] / variants.length,
      });
    });
  });

  var WORLDS = ["Разминка", "Кристаллы", "Каменоломня", "Теснина", "Обсидиан", "Предел"];

  // moves подобраны прогоном бота (см. комментарий у MOVES)
  function levelSpec(n) {
    var w = Math.floor((n - 1) / 10), i = (n - 1) % 10, t = (n - 1) / (TOTAL - 1);
    var s = { n: n, world: w, hard: t, goals: {}, gems: 0, stones: 0, hp: 2, junk: 0, safe: n <= 24 };
    var boss = i === 9;
    if (w === 0) {
      if (i % 2 === 0) s.goals.score = 220 + i * 45; else s.goals.lines = 4 + i;
      s.junk = i < 3 ? 0 : i + 2;
    } else if (w === 1) {
      s.gems = 4 + Math.floor(i * 0.7); s.goals.gems = s.gems; s.junk = 6 + i;
      if (boss) s.goals.score = 500;
    } else if (w === 2) {
      s.stones = 4 + Math.floor(i * 0.6); s.goals.stones = s.stones; s.junk = 5 + Math.floor(i / 2);
      if (boss) { s.stones = 7; s.goals.stones = 7; s.gems = 3; s.goals.gems = 3; }
    } else if (w === 3) {
      s.junk = 16 + Math.floor(i / 2);
      if (i % 3 === 0) s.goals.score = 700 + i * 60;
      else if (i % 3 === 1) { s.gems = 6 + Math.floor(i / 3); s.goals.gems = s.gems; }
      else { s.goals.lines = 12 + i; }
      if (boss) { s.stones = 2; s.goals.stones = 2; s.goals.score = 800; s.junk = 14; }
    } else if (w === 4) {
      s.hp = 3; s.stones = 3 + Math.floor(i / 4); s.goals.stones = s.stones; s.junk = 7 + Math.floor(i / 3);
      if (i % 2 === 1) { s.gems = 3 + Math.floor(i / 4); s.goals.gems = s.gems; }
    } else {
      s.hp = i > 6 ? 3 : 2; s.stones = 3 + Math.floor(i / 4); s.gems = 3 + Math.floor(i / 3);
      s.goals.stones = s.stones; s.goals.gems = s.gems; s.junk = 7 + Math.floor(i / 3);
      if (i % 3 === 2 || boss) s.goals.score = 500 + i * 30;
    }
    s.moves = MOVES[n - 1] || 150;
    return s;
  }

  // стартовое поле уровня всегда одно и то же (зерно от номера), симметрично слева направо
  function makeBoard(spec) {
    var R = rng(7919 * spec.n + 17), b = [], i;
    for (i = 0; i < N * N; i++) b.push(null);
    var rows = [0, 0, 0, 0, 0, 0, 0, 0], cols = [0, 0, 0, 0, 0, 0, 0, 0];
    function put(cell, count, minRow) {
      var left = count, tries = 0;
      while (left > 0 && tries++ < 800) {
        var r = minRow + Math.floor(R() * (N - minRow)), c = Math.floor(R() * N / 2);
        var pair = left > 1 ? [c, N - 1 - c] : [R() < 0.5 ? c : N - 1 - c];
        var ok = pair.every(function (x) { return !b[r * N + x] && cols[x] < 5; }) && rows[r] + pair.length <= 5;
        if (!ok) continue;
        pair.forEach(function (x) { var v = cell(); b[r * N + x] = v; rows[r]++; cols[x]++; left--; });
      }
    }
    var color = function () { return 1 + Math.floor(R() * 6); };
    put(function () { return { c: 0, hp: spec.hp }; }, spec.stones, 1);
    put(function () { return { c: color(), gem: true }; }, spec.gems, 1);
    put(function () { return { c: color() }; }, spec.junk, 2);
    return b;
  }

  function canPlace(b, s, r, c) {
    if (r < 0 || c < 0 || r + s.h > N || c + s.w > N) return false;
    for (var i = 0; i < s.cells.length; i++) if (b[(r + s.cells[i][0]) * N + c + s.cells[i][1]]) return false;
    return true;
  }
  function fitsAnywhere(b, s) {
    for (var r = 0; r <= N - s.h; r++) for (var c = 0; c <= N - s.w; c++) if (canPlace(b, s, r, c)) return true;
    return false;
  }
  function fullLines(b) {
    var rows = [], cols = [], i, j;
    for (i = 0; i < N; i++) {
      var fr = true, fc = true;
      for (j = 0; j < N; j++) { if (!b[i * N + j]) fr = false; if (!b[j * N + i]) fc = false; }
      if (fr) rows.push(i);
      if (fc) cols.push(i);
    }
    return { rows: rows, cols: cols };
  }
  // ставит фигуру и убирает заполненные линии; поле меняется на месте
  function apply(b, p, r, c) {
    var placed = [];
    p.shape.cells.forEach(function (d) { var k = (r + d[0]) * N + c + d[1]; b[k] = { c: p.color }; placed.push(k); });
    var L = fullLines(b), hit = {}, cleared = [], gems = [], broken = [], cracked = [];
    L.rows.forEach(function (y) { for (var x = 0; x < N; x++) hit[y * N + x] = (hit[y * N + x] || 0) + 1; });
    L.cols.forEach(function (x) { for (var y = 0; y < N; y++) hit[y * N + x] = (hit[y * N + x] || 0) + 1; });
    Object.keys(hit).forEach(function (key) {
      var k = +key, cell = b[k];
      if (cell.hp) { // камень теряет прочность за каждую линию
        var hp = cell.hp - hit[k];
        if (hp > 0) { b[k] = { c: 0, hp: hp }; cracked.push(k); return; }
        broken.push(k);
      }
      if (cell.gem) gems.push(k);
      cleared.push({ k: k, cell: cell });
      b[k] = null;
    });
    return { placed: placed, lines: L.rows.length + L.cols.length, rows: L.rows, cols: L.cols, cleared: cleared, gems: gems, broken: broken, cracked: cracked };
  }

  function pickShape(spec, R) {
    var t = spec.hard, sum = 0, w = SHAPES.map(function (s) { var v = s.w0 + (s.w1 - s.w0) * t; sum += v; return v; });
    var x = R() * sum;
    for (var i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return SHAPES[i]; }
    return SHAPES[0];
  }
  // можно ли поставить все фигуры хоть в каком-то порядке
  function solvable(b, shapes, budget) {
    if (!shapes.length) return true;
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i], rest = shapes.slice(0, i).concat(shapes.slice(i + 1));
      for (var r = 0; r <= N - s.h; r++) for (var c = 0; c <= N - s.w; c++) {
        if (!canPlace(b, s, r, c)) continue;
        if (--budget.n < 0) return false;
        var copy = b.slice();
        apply(copy, { shape: s, color: 1 }, r, c);
        if (solvable(copy, rest, budget)) return true;
      }
    }
    return false;
  }
  // три новые фигуры: на первых уровнях гарантированно ставятся все, дальше — хотя бы одна
  function deal(g) {
    var set = null;
    for (var a = 0; a < 40; a++) {
      var s = [pickShape(g.spec, g.R), pickShape(g.spec, g.R), pickShape(g.spec, g.R)];
      var ok = g.spec.safe ? solvable(g.board, s, { n: 600 }) : s.some(function (x) { return fitsAnywhere(g.board, x); });
      if (ok) { set = s; break; }
    }
    if (!set) {
      var fit = SHAPES.filter(function (x) { return fitsAnywhere(g.board, x); }).sort(function (x, y) { return x.cells.length - y.cells.length; });
      set = [fit[0] || SHAPES[0], pickShape(g.spec, g.R), pickShape(g.spec, g.R)];
    }
    g.tray = set.map(function (x) { return { shape: x, color: 1 + Math.floor(g.R() * 6) }; });
  }

  function newGame(n, seed) {
    var spec = levelSpec(n);
    var g = { spec: spec, board: makeBoard(spec), R: rng(seed), tray: [], moves: spec.moves, score: 0, lines: 0, gems: 0, stones: 0, combo: 0, idle: 0, swaps: 1, over: null };
    deal(g);
    return g;
  }
  function goalsDone(g) {
    return Object.keys(g.spec.goals).every(function (k) { return g[k] >= g.spec.goals[k]; });
  }
  function checkStuck(g) {
    if (g.over) return;
    var stuck = !g.tray.some(function (p) { return p && fitsAnywhere(g.board, p.shape); });
    if (stuck && !g.swaps) g.over = { win: false, why: "Фигуры больше некуда ставить" };
  }
  function play(g, slot, r, c) {
    var p = g.tray[slot];
    if (g.over || !p || !canPlace(g.board, p.shape, r, c)) return null;
    var res = apply(g.board, p, r, c);
    g.tray[slot] = null;
    g.moves--;
    var gain = p.shape.cells.length;
    if (res.lines) {
      g.combo++; g.idle = 0;
      gain += 10 * res.lines * res.lines * Math.min(g.combo, 6);
    } else if (++g.idle >= 3) g.combo = 0;
    g.score += gain; g.lines += res.lines; g.gems += res.gems.length; g.stones += res.broken.length;
    res.gain = gain; res.combo = g.combo;
    if (goalsDone(g)) {
      var left = g.moves / g.spec.moves;
      g.over = { win: true, stars: left >= 0.3 ? 3 : left >= 0.12 ? 2 : 1 };
    } else if (g.moves <= 0) g.over = { win: false, why: "Ходы закончились" };
    else {
      if (g.tray.every(function (x) { return !x; })) { deal(g); res.dealt = true; }
      checkStuck(g);
    }
    return res;
  }
  function swap(g) {
    if (g.over || !g.swaps) return false;
    g.swaps--; deal(g); checkStuck(g);
    return true;
  }

  // лимиты ходов по уровням: бот проходил каждый уровень много раз, лимит взят по доле его побед
  // (около 95% в начале и всё ниже к концу)
  var MOVES = [
    38, 30, 49, 34, 50, 42, 56, 45, 57, 49,
    41, 25, 36, 48, 24, 28, 44, 43, 39, 43,
    43, 39, 42, 60, 86, 72, 101, 84, 58, 108,
    44, 30, 40, 50, 24, 49, 53, 45, 61, 46,
    84, 55, 61, 54, 34, 65, 68, 94, 81, 74,
    34, 43, 53, 42, 45, 74, 45, 44, 96, 75,
  ];

  var Core = { N: N, TOTAL: TOTAL, WORLDS: WORLDS, SHAPES: SHAPES, levelSpec: levelSpec, makeBoard: makeBoard, canPlace: canPlace, fitsAnywhere: fitsAnywhere, fullLines: fullLines, apply: apply, newGame: newGame, play: play, swap: swap };
  if (typeof module !== "undefined" && module.exports) { module.exports = Core; return; }

  /* ================= экран ================= */
  var doc = root.document;
  var CSS = [
    "#blocks{--cell:40px;max-width:480px;margin:0 auto}",
    "body:has(#game:not([hidden])) #cat{display:none}",
    "#blocks .bk-top{display:flex;align-items:center;gap:8px;margin-bottom:12px}",
    "#blocks .bk-top h1{flex:1;font-size:22px}",
    ".bk-btn{border:0;border-radius:14px;background:var(--card);color:var(--text);font:inherit;font-weight:700;padding:10px 14px;transition:transform .12s}",
    ".bk-btn:active{transform:scale(.93)}",
    ".bk-btn:disabled{opacity:.4}",
    ".bk-btn.main{background:var(--accent);color:#fff}",
    ".bk-w{margin:18px 0 8px;font-weight:800;display:flex;justify-content:space-between;align-items:baseline}",
    ".bk-w span{font-size:12px;color:var(--muted);font-weight:600}",
    ".bk-map{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}",
    ".bk-lv{aspect-ratio:1;border:0;border-radius:16px;background:var(--card);color:var(--text);font:inherit;font-size:19px;font-weight:800;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:bk-in .35s backwards;transition:transform .12s}",
    ".bk-lv:active{transform:scale(.9)}",
    ".bk-lv small{font-size:10px;letter-spacing:1px;color:var(--amber);height:13px}",
    ".bk-lv.bk-off{opacity:.35}",
    ".bk-lv.cur{background:var(--accent);color:#fff;animation:bk-in .35s backwards,bk-pulse 1.6s ease-in-out .4s infinite}",
    ".bk-lv.cur small{color:#fff}",
    ".bk-check{display:flex;gap:10px;align-items:center;margin-top:6px;color:var(--muted);font-size:14px}",
    ".bk-hud{display:flex;gap:8px;margin-bottom:10px}",
    ".bk-stat{background:var(--card);border-radius:14px;padding:6px 12px;text-align:center;min-width:72px}",
    ".bk-stat b{display:block;font-size:22px}",
    ".bk-stat span{font-size:11px;color:var(--muted)}",
    ".bk-stat.low b{color:var(--red);animation:bk-pulse .8s ease-in-out infinite}",
    ".bk-goals{flex:1;background:var(--card);border-radius:14px;padding:8px 10px;display:flex;flex-wrap:wrap;gap:4px 14px;align-content:center;justify-content:center}",
    ".bk-goal{font-size:15px;font-weight:700;white-space:nowrap}",
    ".bk-goal.ok{color:var(--green)}",
    ".bk-goal.bump{animation:bk-bump .4s}",
    ".bk-wrap{position:relative;width:calc(var(--cell)*8 + 12px);margin:0 auto}",
    ".bk-board{display:grid;grid-template-columns:repeat(8,var(--cell));grid-auto-rows:var(--cell);background:var(--card);border-radius:16px;padding:6px;touch-action:none}",
    ".bk-board.shake{animation:bk-shake .35s}",
    ".bk-c{position:relative;padding:1.5px}",
    ".bk-c::before{content:'';position:absolute;inset:1.5px;border-radius:7px;background:var(--line);opacity:.55}",
    ".bk-b{position:relative;display:block;width:100%;height:100%;border-radius:7px;background:var(--k);box-shadow:inset 0 3px 0 rgba(255,255,255,.35),inset 0 -4px 0 rgba(0,0,0,.25)}",
    ".bk-k1{--k:#ff5d6c}.bk-k2{--k:#ff9f43}.bk-k3{--k:#f5c542}.bk-k4{--k:#35c97a}.bk-k5{--k:#38a8f5}.bk-k6{--k:#9b7bff}",
    ".bk-gem::after{content:'';position:absolute;inset:26%;background:linear-gradient(135deg,#fff 0 45%,#aef2ff 45% 70%,#58cfe8 70%);transform:rotate(45deg);border-radius:3px;box-shadow:0 0 8px #fff;animation:bk-glint 1.8s ease-in-out infinite}",
    ".bk-stone{--k:#7d8597}",
    ".bk-stone.h3{--k:#453a63}",
    ".bk-stone::after{content:attr(data-hp);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:calc(var(--cell)*.4);color:#fff;text-shadow:0 1px 3px #000}",
    ".bk-pop{animation:bk-pop .25s}",
    ".bk-crack{animation:bk-shake .3s}",
    ".bk-ghost{opacity:.4}",
    ".bk-will .bk-b{filter:brightness(1.35);box-shadow:0 0 12px var(--k);opacity:1}",
    ".bk-will::before{background:#fff;opacity:.35}",
    ".bk-boom{position:absolute;inset:1.5px;border-radius:7px;background:var(--k);animation:bk-boom .45s forwards;pointer-events:none;z-index:2}",
    ".bk-dead .bk-b{filter:grayscale(1) brightness(.7);transition:filter .5s}",
    ".bk-fx{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:130}",
    ".bk-float{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);font-size:30px;font-weight:900;color:#fff;text-shadow:0 3px 10px #000,0 0 22px var(--accent);white-space:nowrap;pointer-events:none;z-index:5;animation:bk-float 1s forwards;text-align:center}",
    ".bk-float small{display:block;font-size:18px;color:var(--amber)}",
    ".bk-tray{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}",
    ".bk-slot{height:calc(var(--cell)*3.1);display:flex;align-items:center;justify-content:center;background:var(--card);border-radius:16px;touch-action:none}",
    ".bk-piece{display:grid;grid-auto-columns:var(--p);grid-auto-rows:var(--p)}",
    ".bk-piece i{padding:1px}",
    ".bk-slot .bk-piece{animation:bk-in .35s backwards}",
    ".bk-slot:nth-child(2) .bk-piece{animation-delay:.07s}.bk-slot:nth-child(3) .bk-piece{animation-delay:.14s}",
    ".bk-slot.no .bk-piece{opacity:.3}",
    ".bk-slot.held .bk-piece{visibility:hidden}",
    ".bk-drag{position:fixed;left:0;top:0;z-index:140;pointer-events:none;filter:drop-shadow(0 12px 14px rgba(0,0,0,.45))}",
    ".bk-drag.back{transition:transform .22s cubic-bezier(.3,1.3,.5,1)}",
    ".bk-bar{display:flex;gap:8px;margin-top:10px;justify-content:center}",
    ".bk-modal{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);padding:20px;animation:bk-fade .3s}",
    ".bk-box{width:100%;max-width:340px;background:var(--card);border-radius:26px;padding:24px 20px;text-align:center;animation:bk-in .4s cubic-bezier(.2,1.4,.4,1)}",
    ".bk-box h2{font-size:24px;margin-bottom:6px}",
    ".bk-box p{color:var(--muted);margin-bottom:16px}",
    ".bk-stars{font-size:46px;margin:6px 0 10px;color:var(--line)}",
    ".bk-stars i{font-style:normal;display:inline-block;margin:0 4px}",
    ".bk-stars i.on{color:var(--amber);animation:bk-star .5s cubic-bezier(.2,1.8,.4,1) backwards}",
    ".bk-box .bk-btn{width:100%;margin-top:8px}",
    ".bk-box .bk-btn:not(.main){background:var(--line)}",
    "@keyframes bk-in{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:none}}",
    "@keyframes bk-fade{from{opacity:0}}",
    "@keyframes bk-pulse{50%{transform:scale(1.07)}}",
    "@keyframes bk-bump{40%{transform:scale(1.35);color:var(--amber)}}",
    "@keyframes bk-pop{0%{transform:scale(1.25)}60%{transform:scale(.9)}}",
    "@keyframes bk-boom{0%{transform:scale(1);filter:brightness(2.5)}35%{transform:scale(1.2);filter:brightness(1.8)}100%{transform:scale(0) rotate(40deg);opacity:0}}",
    "@keyframes bk-shake{20%{transform:translate(-6px,2px)}40%{transform:translate(5px,-3px)}60%{transform:translate(-4px,-1px)}80%{transform:translate(3px,2px)}}",
    "@keyframes bk-float{0%{opacity:0;transform:translate(-50%,-20%) scale(.4)}25%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-120%) scale(1)}}",
    "@keyframes bk-glint{50%{filter:brightness(1.5);transform:rotate(45deg) scale(1.15)}}",
    "@keyframes bk-star{from{transform:scale(0) rotate(-180deg);opacity:0}}",
    "@media (prefers-reduced-motion:reduce){#blocks *,.bk-modal *,.bk-drag{animation-duration:.01s!important;animation-iteration-count:1!important;transition:none!important}}",
  ].join("\n");

  var host, G = null, screen = "map", cells = [], boardEl, trayEl, drag = null, fx = null, parts = [], rafId = 0, audio = null;
  var SAVE = "rey-blocks";
  var save = { stars: {}, all: false, mute: false };
  try { Object.assign(save, JSON.parse(root.localStorage.getItem(SAVE) || "{}")); } catch (e) {}
  function persist() { try { root.localStorage.setItem(SAVE, JSON.stringify(save)); } catch (e) {} }
  var reduce = function () { try { return root.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, fn, cls) { var b = el("button", "bk-btn" + (cls ? " " + cls : ""), text); b.type = "button"; b.onclick = fn; return b; }
  function visible() { return host && !host.hidden; }

  function haptic(kind) {
    try {
      var h = root.Telegram.WebApp.HapticFeedback;
      if (kind === "win" || kind === "lose") h.notificationOccurred(kind === "win" ? "success" : "error");
      else h.impactOccurred(kind);
    } catch (e) {}
  }
  function beep(freqs, step, type, vol) {
    if (save.mute) return;
    try {
      audio = audio || new (root.AudioContext || root.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      freqs.forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * step;
        o.type = type || "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(vol || 0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + step * 2.2);
        o.connect(g); g.connect(audio.destination);
        o.start(t); o.stop(t + step * 2.3);
      });
    } catch (e) {}
  }

  /* ---------- частицы ---------- */
  function burst(x, y, color, count, speed, life) {
    if (reduce()) return;
    for (var i = 0; i < count && parts.length < 600; i++) {
      var a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random());
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.6, s: 3 + Math.random() * 5, c: color, a: a, t: (life || 40) * (0.6 + Math.random() * 0.8) });
    }
    if (!rafId) rafId = root.requestAnimationFrame(frame);
  }
  function frame() {
    if (!fx) {
      fx = el("canvas", "bk-fx"); doc.body.append(fx);
    }
    if (fx.width !== root.innerWidth || fx.height !== root.innerHeight) { fx.width = root.innerWidth; fx.height = root.innerHeight; }
    var x = fx.getContext("2d");
    x.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter(function (p) { return --p.t > 0 && visible(); });
    parts.forEach(function (p) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.28; p.vx *= 0.98; p.a += 0.15;
      x.save(); x.globalAlpha = Math.min(1, p.t / 18); x.translate(p.x, p.y); x.rotate(p.a);
      x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); x.restore();
    });
    if (parts.length) rafId = root.requestAnimationFrame(frame);
    else { rafId = 0; fx.remove(); fx = null; }
  }
  var COLORS = ["#aab1c2", "#ff5d6c", "#ff9f43", "#f5c542", "#35c97a", "#38a8f5", "#9b7bff"];

  /* ---------- карта уровней ---------- */
  var stars = function (n) { return save.stars[n] || 0; };
  var unlocked = function (n) { return save.all || n === 1 || stars(n - 1) > 0 || stars(n) > 0; };
  function closeModal() { var m = doc.querySelector(".bk-modal"); if (m) m.remove(); }
  function showMap() {
    screen = "map"; G = null; cancelDrag(); closeModal();
    host.replaceChildren();
    var top = el("div", "bk-top");
    var got = Object.keys(save.stars).reduce(function (s, k) { return s + save.stars[k]; }, 0);
    var mute = btn(save.mute ? "🔇" : "🔊", function () { save.mute = !save.mute; persist(); mute.textContent = save.mute ? "🔇" : "🔊"; });
    mute.setAttribute("aria-label", "Звук");
    top.append(btn("←", function () { api.onExit(); }), el("h1", null, "Блоки"), el("b", null, "★ " + got + "/" + TOTAL * 3), mute);
    host.append(top);
    var check = el("label", "bk-check"), box = el("input");
    box.type = "checkbox"; box.checked = save.all;
    box.onchange = function () { save.all = box.checked; persist(); showMap(); };
    check.append(box, doc.createTextNode("Открыть все уровни (для теста)"));
    host.append(check);
    var cur = 1;
    while (cur < TOTAL && stars(cur) > 0) cur++;
    WORLDS.forEach(function (name, w) {
      var head = el("div", "bk-w", w + 1 + ". " + name);
      head.append(el("span", null, ["очки и линии", "собери кристаллы", "разбей камни", "тесное поле", "камни прочностью 3", "всё сразу"][w]));
      var map = el("div", "bk-map");
      for (var i = 1; i <= 10; i++) (function (n, i) {
        var b = el("button", "bk-lv" + (!unlocked(n) ? " bk-off" : n === cur ? " cur" : ""));
        b.type = "button"; b.style.animationDelay = Math.min(n * 12, 400) + "ms";
        var s = stars(n);
        b.append(el("span", null, unlocked(n) ? String(n) : "🔒"), el("small", null, s ? "★★★".slice(0, s) : ""));
        b.disabled = !unlocked(n);
        b.onclick = function () { start(n); };
        map.append(b);
      })(w * 10 + i, i);
      host.append(head, map);
    });
    root.scrollTo(0, 0);
  }

  /* ---------- игра ---------- */
  var GOAL = { score: "⭐ Очки", lines: "➖ Линии", gems: "💎", stones: "🪨" };
  var hud = {};
  function sizeCells() {
    var w = Math.min(host.clientWidth || root.innerWidth - 32, 480);
    // сверху учитываем шапку Telegram (отступ до игры), поле — 8 клеток, лоток — около 3
    var above = host.getBoundingClientRect().top + root.scrollY;
    var h = (root.innerHeight - above - 230) / 11.4;
    var c = Math.max(26, Math.floor(Math.min((w - 12) / 8, h)));
    host.style.setProperty("--cell", c + "px");
  }
  function start(n) {
    screen = "game"; cancelDrag(); closeModal();
    G = newGame(n, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    host.replaceChildren();
    var top = el("div", "bk-top");
    top.append(btn("←", showMap), el("h1", null, "Уровень " + n), btn("↻", function () { start(n); }));
    var h = el("div", "bk-hud");
    var mv = el("div", "bk-stat"); hud.moves = el("b"); hud.movesBox = mv; mv.append(hud.moves, el("span", null, "ходов"));
    var goals = el("div", "bk-goals"); hud.goals = {};
    Object.keys(G.spec.goals).forEach(function (k) { var x = el("div", "bk-goal"); hud.goals[k] = x; goals.append(x); });
    var sc = el("div", "bk-stat"); hud.score = el("b"); sc.append(hud.score, el("span", null, "очки"));
    h.append(mv, goals, sc);
    var wrap = el("div", "bk-wrap");
    boardEl = el("div", "bk-board"); cells = [];
    for (var i = 0; i < N * N; i++) { var c = el("div", "bk-c"); cells.push(c); boardEl.append(c); }
    wrap.append(boardEl); hud.wrap = wrap;
    trayEl = el("div", "bk-tray");
    var bar = el("div", "bk-bar");
    hud.swap = btn("", function () { cancelDrag(); if (swap(G)) { beep([440, 660], 0.06); renderTray(); renderHud(); finish(); } });
    bar.append(hud.swap);
    host.append(top, h, wrap, trayEl, bar);
    sizeCells();
    renderBoard(); renderTray(); renderHud();
    root.scrollTo(0, 0);
  }
  function blockEl(cell) {
    var b = el("i", "bk-b");
    if (cell.hp) { b.className += " bk-stone" + (cell.hp > 2 ? " h3" : ""); b.dataset.hp = cell.hp; }
    else b.className += " bk-k" + cell.c + (cell.gem ? " bk-gem" : "");
    return b;
  }
  function renderBoard(res) {
    G.board.forEach(function (cell, k) {
      cells[k].className = "bk-c";
      cells[k].replaceChildren();
      if (!cell) return;
      var b = blockEl(cell);
      if (res && res.placed.indexOf(k) >= 0) b.className += " bk-pop";
      if (res && res.cracked.indexOf(k) >= 0) b.className += " bk-crack";
      cells[k].append(b);
    });
  }
  function pieceEl(p, size) {
    var g = el("div", "bk-piece");
    g.style.setProperty("--p", size);
    p.shape.cells.forEach(function (d) {
      var i = el("i"); i.style.gridRow = d[0] + 1; i.style.gridColumn = d[1] + 1;
      i.append(el("span", "bk-b bk-k" + p.color)); g.append(i);
    });
    return g;
  }
  function renderTray() {
    trayEl.replaceChildren();
    G.tray.forEach(function (p, i) {
      var s = el("div", "bk-slot");
      if (p) {
        if (!fitsAnywhere(G.board, p.shape)) s.className += " no";
        s.append(pieceEl(p, "calc(var(--cell)*" + (Math.max(p.shape.w, p.shape.h) > 3 ? 0.44 : 0.56) + ")"));
        s.onpointerdown = function (e) { pickUp(e, i, s); };
      }
      trayEl.append(s);
    });
  }
  function renderHud() {
    hud.moves.textContent = G.moves;
    hud.movesBox.className = "bk-stat" + (G.moves <= 5 ? " low" : "");
    hud.score.textContent = G.score;
    Object.keys(hud.goals).forEach(function (k) {
      var need = G.spec.goals[k], have = Math.min(G[k], need), x = hud.goals[k];
      var text = GOAL[k] + " " + have + "/" + need;
      var changed = x.textContent && x.textContent !== text;
      x.textContent = text;
      x.className = "bk-goal" + (have >= need ? " ok" : "");
      if (changed) { void x.offsetWidth; x.className += " bump"; }
    });
    hud.swap.textContent = "🔀 Сменить фигуры (" + G.swaps + ")";
    hud.swap.disabled = !G.swaps || !!G.over;
    var stuck = !G.over && !G.tray.some(function (p) { return p && fitsAnywhere(G.board, p.shape); });
    hud.swap.classList.toggle("main", stuck);
  }

  /* ---------- перетаскивание ---------- */
  function pickUp(e, slot, slotEl) {
    if (drag || !G || G.over) return;
    e.preventDefault();
    var p = G.tray[slot], size = cells[0].getBoundingClientRect().width;
    var node = pieceEl(p, size + "px"); node.classList.add("bk-drag");
    doc.body.append(node);
    var from = slotEl.firstChild.getBoundingClientRect();
    drag = { id: e.pointerId, slot: slot, slotEl: slotEl, p: p, node: node, size: size, at: null, lift: e.pointerType === "mouse" ? 0 : size * 1.6, home: [from.left, from.top], x0: e.clientX, y0: e.clientY };
    slotEl.classList.add("held");
    beep([520], 0.04); haptic("light");
    move(e);
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    var s = drag.p.shape, size = drag.size;
    // фигура чуть выше пальца и движется немного быстрее него, чтобы дотянуться до верха поля
    var travel = Math.min(1, Math.max(0, (drag.y0 - e.clientY) / (size * 3)));
    var x = e.clientX - (s.w * size) / 2 + (e.clientX - drag.x0) * 0.15;
    var y = e.clientY - s.h * size - drag.lift + (drag.lift ? 0 : (s.h * size) / 2) - (drag.lift ? travel * size : 0);
    drag.node.style.transform = "translate(" + x + "px," + y + "px)";
    var r0 = cells[0].getBoundingClientRect();
    var c = Math.round((x - r0.left) / size), r = Math.round((y - r0.top) / size);
    var at = canPlace(G.board, s, r, c) ? [r, c] : null;
    if (String(at) !== String(drag.at)) { drag.at = at; preview(); }
  }
  function preview() {
    renderBoard();
    if (!drag || !drag.at) return;
    var copy = G.board.slice(), r = drag.at[0], c = drag.at[1];
    drag.p.shape.cells.forEach(function (d) {
      var k = (r + d[0]) * N + c + d[1];
      copy[k] = { c: drag.p.color };
      var b = blockEl(copy[k]); b.className += " bk-ghost"; cells[k].append(b);
    });
    var L = fullLines(copy);
    cells.forEach(function (cell, k) { if (L.rows.indexOf((k / N) | 0) >= 0 || L.cols.indexOf(k % N) >= 0) cell.classList.add("bk-will"); });
  }
  function drop(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.type === "pointercancel") return cancelDrag();
    move(e);
    var d = drag;
    if (!d.at) {
      drag = null; renderBoard();
      var sc = 0.56;
      d.node.classList.add("back");
      d.node.style.transformOrigin = "0 0";
      d.node.style.transform = "translate(" + d.home[0] + "px," + d.home[1] + "px) scale(" + sc + ")";
      setTimeout(function () { d.node.remove(); d.slotEl.classList.remove("held"); }, 230);
      return;
    }
    drag = null; d.node.remove();
    var res = play(G, d.slot, d.at[0], d.at[1]);
    if (!res) return renderTray();
    renderBoard(res); renderTray(); renderHud(); effects(res); finish();
  }
  function cancelDrag() {
    if (!drag) return;
    drag.node.remove(); drag.slotEl.classList.remove("held"); drag = null;
    if (G && cells.length) renderBoard();
  }

  function effects(res) {
    if (!res.lines) { beep([240], 0.05, "sine", 0.18); haptic("light"); return; }
    var first = res.placed[0];
    res.cleared.forEach(function (x) {
      var k = x.k, delay = (Math.abs((k % N) - (first % N)) + Math.abs(((k / N) | 0) - ((first / N) | 0))) * 28;
      var color = x.cell.hp ? 0 : x.cell.c;
      var boom = el("i", "bk-boom bk-k" + color);
      if (!color) boom.style.setProperty("--k", COLORS[0]);
      boom.style.animationDelay = delay + "ms";
      cells[k].append(boom);
      setTimeout(function () {
        boom.remove();
      }, delay + 470);
      setTimeout(function () {
        if (!visible()) return;
        var r = cells[k].getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2, x.cell.gem ? "#bff6ff" : COLORS[color], x.cell.gem ? 18 : 6, x.cell.gem ? 5 : 3.5);
      }, delay + 90);
    });
    var base = 330 * Math.pow(1.12, Math.min(res.combo, 8)), notes = [];
    for (var i = 0; i < Math.min(res.lines + 2, 6); i++) notes.push(base * Math.pow(1.26, i));
    beep(notes, 0.07);
    haptic(res.lines > 1 || res.combo > 2 ? "heavy" : "medium");
    if (res.lines > 1 || res.broken.length) { boardEl.classList.remove("shake"); void boardEl.offsetWidth; boardEl.classList.add("shake"); }
    var word = res.lines >= 4 ? "Невероятно!" : res.lines === 3 ? "Мощно!" : res.lines === 2 ? "Двойная!" : "+" + res.gain;
    var f = el("div", "bk-float", word);
    if (res.combo > 1 || res.lines > 1) f.append(el("small", null, (res.combo > 1 ? "Комбо ×" + res.combo + " · " : "") + "+" + res.gain));
    hud.wrap.append(f);
    setTimeout(function () { f.remove(); }, 1050);
  }

  function finish() {
    if (!G.over) return;
    var g = G, o = g.over, n = g.spec.n;
    if (o.win && o.stars > stars(n)) { save.stars[n] = o.stars; persist(); }
    renderHud();
    setTimeout(function () {
      if (G !== g) return;
      if (o.win) {
        beep([523, 659, 784, 1047, 1319], 0.11); haptic("win");
        [0, 250, 500, 800].forEach(function (t) {
          setTimeout(function () { if (G === g && visible()) burst(root.innerWidth * (0.15 + Math.random() * 0.7), root.innerHeight * (0.2 + Math.random() * 0.3), COLORS[1 + Math.floor(Math.random() * 6)], 60, 7, 70); }, t);
        });
      } else { beep([330, 262, 196, 131], 0.16, "sawtooth", 0.07); haptic("lose"); boardEl.classList.add("bk-dead"); }
      setTimeout(function () { if (G === g && visible()) result(g, o); }, o.win ? 700 : 900);
    }, 450);
  }
  function result(g, o) {
    closeModal();
    var m = el("div", "bk-modal"), box = el("div", "bk-box"), n = g.spec.n;
    box.append(el("h2", null, o.win ? (n === TOTAL ? "Игра пройдена!" : "Уровень пройден!") : "Не вышло"));
    if (o.win) {
      var st = el("div", "bk-stars");
      for (var i = 0; i < 3; i++) { var s = el("i", i < o.stars ? "on" : "", "★"); s.style.animationDelay = 0.2 + i * 0.25 + "s"; st.append(s); }
      box.append(st, el("p", null, "Очки: " + g.score + " · осталось ходов: " + g.moves));
      if (n < TOTAL) box.append(btn("Дальше", function () { start(n + 1); }, "main"));
    } else {
      box.append(el("p", null, o.why + ". Очки: " + g.score));
      box.append(btn("Ещё раз", function () { start(n); }, "main"));
    }
    if (o.win) box.append(btn("Переиграть", function () { start(n); }));
    box.append(btn("К уровням", showMap));
    m.append(box); doc.body.append(m);
  }

  var api = {
    onExit: function () {},
    open: function (container, onExit) {
      if (!doc.getElementById("bk-css")) { var st = el("style"); st.id = "bk-css"; st.textContent = CSS; doc.head.append(st); }
      host = container; api.onExit = onExit;
      showMap();
    },
    // кнопка «Назад»: из уровня — на карту; false — выходить из игры
    back: function () { if (screen === "game") { showMap(); return true; } return false; },
    close: function () { cancelDrag(); closeModal(); G = null; screen = "map"; parts = []; },
  };
  doc.addEventListener("pointermove", move, { passive: false });
  doc.addEventListener("pointerup", drop);
  doc.addEventListener("pointercancel", drop);
  doc.addEventListener("visibilitychange", function () { if (doc.hidden) cancelDrag(); });
  root.addEventListener("resize", function () { if (visible() && screen === "game") { cancelDrag(); sizeCells(); } });
  root.ReyBlocks = api;
})(typeof window !== "undefined" ? window : this);
