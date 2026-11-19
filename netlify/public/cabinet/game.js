/* «Неон-Блок» — мини-игра (разработка, только для админа).
   Блочный мир как в майнкрафте, неоновый город, режим на выживание как в бравле:
   8 бойцов, сужающаяся зона, кубы силы, супер-удар. Без внешних библиотек. */
(function () {
  "use strict";

  const TS = 32, MW = 40, MH = 40, PLAYERS = 8;
  const W_ = 1, CRATE = 2, BUSH = 3, CAR = 4;

  const BR = {
    biker: { name: "Байкер", desc: "Дробовик: 3 пули веером. Супер — граната.", hp: 120, speed: 150, reload: 0.9, cd: 0.3, range: 215, bspeed: 540, dmg: 14, pellets: 3, spread: 0.3, col: "#e0364f", hair: "#1b1b24", sup: "nade", supName: "Граната" },
    sniper: { name: "Снайпер", desc: "Дальний мощный выстрел. Супер — лазер навылет.", hp: 80, speed: 140, reload: 1.25, cd: 0.45, range: 440, bspeed: 900, dmg: 42, pellets: 1, spread: 0, col: "#2fa862", hair: "#3b2a1a", sup: "beam", supName: "Лазер" },
    gang: { name: "Гангстер", desc: "Быстрый автомат. Супер — ускорение на 6 секунд.", hp: 100, speed: 160, reload: 0.55, cd: 0.17, range: 300, bspeed: 640, dmg: 11, pellets: 1, spread: 0.07, col: "#8f4bd8", hair: "#e8c44a", sup: "haste", supName: "Ускорение" },
  };
  const ORDER = ["biker", "sniper", "gang"];
  const BOTNAMES = ["Рик", "Макс", "Вайс", "Лео", "Дон", "Тони", "Бо", "Ким"];

  const tg = window.Telegram?.WebApp;
  let root, cv, cx, dpr = 1, vw = 0, vh = 0, zoom = 1;
  let raf = 0, last = 0, running = false, ac = null;
  let mode = "menu"; // menu | count | play | over
  let pick = "biker";
  let G = null;
  const keys = {};
  const mouse = { x: 0, y: 0, down: false, on: false };
  let stickL = null, stickR = null, supBtn = null;
  let ov = null;
  const cleanups = [];

  /* ---------- утилиты ---------- */
  const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const store = {
    get() { try { return JSON.parse(localStorage.getItem("neonblock") || "{}"); } catch { return {}; } },
    set(o) { try { localStorage.setItem("neonblock", JSON.stringify(o)); } catch {} },
  };
  function sfx(f, d, type, v) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "square"; o.frequency.value = f;
      g.gain.value = v || 0.03;
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
    } catch {}
  }
  const buzz = (k) => { try { tg?.HapticFeedback?.impactOccurred(k || "light"); } catch {} };

  /* ---------- текстуры (пиксель-арт как в майнкрафте) ---------- */
  const TX = {};
  function mkTex(w, h, fn, seed) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); fn(g, mulberry(seed || 1), w, h); return c;
  }
  const shade = (hex, k) => {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v * k), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  function noiseFill(g, r, w, h, base, amp) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { g.fillStyle = shade(base, 1 + (r() - 0.5) * amp); g.fillRect(x, y, 1, 1); }
  }
  const NEON = ["#ff3fa4", "#2ee6ff", "#ffa23c", "#9a6bff"];
  function buildTextures() {
    if (TX.road) return;
    TX.road = mkTex(16, 16, (g, r, w, h) => { noiseFill(g, r, w, h, "#2c2742", 0.22); g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 4; i++) g.fillRect((r() * 14) | 0, (r() * 14) | 0, 2, 1); }, 3);
    TX.roadLine = mkTex(16, 16, (g, r, w, h) => { noiseFill(g, r, w, h, "#2c2742", 0.22); g.fillStyle = "#f3d65a"; g.fillRect(2, 7, 5, 2); g.fillRect(10, 7, 4, 2); }, 4);
    TX.roadLineV = mkTex(16, 16, (g, r, w, h) => { noiseFill(g, r, w, h, "#2c2742", 0.22); g.fillStyle = "#f3d65a"; g.fillRect(7, 2, 2, 5); g.fillRect(7, 10, 2, 4); }, 5);
    TX.walk = mkTex(16, 16, (g, r, w, h) => {
      noiseFill(g, r, w, h, "#8274ab", 0.16);
      g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(0, 7, 16, 1); g.fillRect(7, 0, 1, 16);
    }, 6);
    TX.bush = mkTex(16, 16, (g, r, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (r() < 0.2) continue;
        g.fillStyle = shade(r() < 0.3 ? "#35c25a" : "#1c8a3e", 1 + (r() - 0.5) * 0.25); g.fillRect(x, y, 1, 1);
      }
    }, 7);
    TX.crateTop = mkTex(16, 16, (g, r, w, h) => {
      noiseFill(g, r, w, h, "#b57a36", 0.16);
      g.fillStyle = "#6e4519"; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
      g.fillRect(2, 2, 1, 12); g.fillRect(13, 2, 1, 12); g.fillRect(2, 2, 12, 1); g.fillRect(2, 13, 12, 1);
    }, 8);
    TX.crateFront = mkTex(16, 16, (g, r, w, h) => { noiseFill(g, r, w, h, "#8a5a24", 0.16); g.fillStyle = "#4e3010"; g.fillRect(0, 0, 16, 1); g.fillRect(0, 8, 16, 1); }, 9);
    TX.facade = [];
    TX.roof = [];
    TX.car = [];
    NEON.forEach((col, i) => {
      TX.roof.push(mkTex(16, 16, (g, r, w, h) => {
        noiseFill(g, r, w, h, "#262040", 0.18);
        g.fillStyle = col; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
        g.fillStyle = "#3b3260"; g.fillRect(4, 4, 5, 4); g.fillStyle = "#5a4e8c"; g.fillRect(4, 4, 5, 1);
        g.fillStyle = col; g.fillRect(11, 10, 2, 2);
      }, 20 + i));
      TX.facade.push(mkTex(16, 16, (g, r, w, h) => {
        noiseFill(g, r, w, h, "#3a2f5c", 0.14);
        for (let y = 2; y < 14; y += 5) for (let x = 2; x < 14; x += 5) {
          g.fillStyle = r() < 0.6 ? (r() < 0.5 ? "#ffe27a" : col) : "#171230"; g.fillRect(x, y, 3, 3);
        }
        g.fillStyle = col; g.fillRect(0, 0, 16, 1);
      }, 30 + i));
      TX.car.push(mkTex(16, 16, (g, r, w, h) => {
        g.fillStyle = shade(col, 0.55); g.fillRect(0, 0, 16, 16);
        g.fillStyle = col; g.fillRect(1, 2, 14, 12);
        g.fillStyle = "#101428"; g.fillRect(3, 4, 10, 3); g.fillRect(3, 10, 10, 2);
        g.fillStyle = "#fff6b0"; g.fillRect(1, 0, 3, 1); g.fillRect(12, 0, 3, 1);
      }, 40 + i));
    });
  }

  /* ---------- карта ---------- */
  function genMap(seed) {
    const r = mulberry(seed);
    const R = (a, b) => a + r() * (b - a);
    for (let attempt = 0; attempt < 12; attempt++) {
      const T = new Uint8Array(MW * MH);
      const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < MW && y < MH) T[y * MW + x] = v; };
      const get = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? W_ : T[y * MW + x]);
      for (let x = 0; x < MW; x++) { set(x, 0, W_); set(x, MH - 1, W_); }
      for (let y = 0; y < MH; y++) { set(0, y, W_); set(MW - 1, y, W_); }
      // точки появления по кругу
      const spawns = [];
      const a0 = R(0, 6.28);
      for (let i = 0; i < PLAYERS; i++) {
        const a = a0 + (i / PLAYERS) * 6.283;
        spawns.push({ x: Math.round(MW / 2 + Math.cos(a) * 15), y: Math.round(MH / 2 + Math.sin(a) * 15) });
      }
      const nearSpawn = (x0, y0, x1, y1) => spawns.some((s) => s.x >= x0 - 3 && s.x <= x1 + 3 && s.y >= y0 - 3 && s.y <= y1 + 3);
      // здания
      for (let i = 0; i < 70; i++) {
        const w = 2 + ((r() * 3) | 0), h = 2 + ((r() * 2) | 0);
        const x = 2 + ((r() * (MW - 4 - w)) | 0), y = 2 + ((r() * (MH - 4 - h)) | 0);
        let ok = !nearSpawn(x, y, x + w - 1, y + h - 1);
        for (let yy = y - 1; ok && yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (get(xx, yy) !== 0) { ok = false; break; }
        if (!ok) continue;
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) set(xx, yy, W_);
      }
      // машины, кусты, ящики
      const free = (x, y) => get(x, y) === 0 && !nearSpawn(x, y, x, y);
      for (let i = 0; i < 24; i++) { const x = 2 + ((r() * (MW - 4)) | 0), y = 2 + ((r() * (MH - 4)) | 0); if (free(x, y)) set(x, y, CAR); }
      for (let i = 0; i < 16; i++) {
        const x = 2 + ((r() * (MW - 6)) | 0), y = 2 + ((r() * (MH - 6)) | 0);
        for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) if (r() < 0.75 && get(x + xx, y + yy) === 0) set(x + xx, y + yy, BUSH);
      }
      for (let i = 0; i < 36; i++) { const x = 2 + ((r() * (MW - 4)) | 0), y = 2 + ((r() * (MH - 4)) | 0); if (free(x, y)) set(x, y, CRATE); }
      spawns.forEach((s) => { for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) set(s.x + xx, s.y + yy, 0); });
      // все точки должны быть связаны (стены и машины непроходимы)
      const seen = new Uint8Array(MW * MH), q = [spawns[0].y * MW + spawns[0].x];
      seen[q[0]] = 1;
      while (q.length) {
        const c = q.pop(), x = c % MW, y = (c / MW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = ny * MW + nx;
          if (nx < 0 || ny < 0 || nx >= MW || ny >= MH || seen[k]) continue;
          if (T[k] === W_ || T[k] === CAR) continue;
          seen[k] = 1; q.push(k);
        }
      }
      if (spawns.every((s) => seen[s.y * MW + s.x]) || attempt === 11) {
        const CH = new Int16Array(MW * MH);
        for (let i = 0; i < T.length; i++) if (T[i] === CRATE) CH[i] = 60;
        const hash = new Uint8Array(MW * MH);
        for (let i = 0; i < hash.length; i++) hash[i] = (r() * 4) | 0;
        return { T, CH, hash, spawns: spawns.map((s) => ({ x: (s.x + 0.5) * TS, y: (s.y + 0.5) * TS })) };
      }
    }
  }
  const tileAt = (x, y) => { const tx = Math.floor(x / TS), ty = Math.floor(y / TS); return tx < 0 || ty < 0 || tx >= MW || ty >= MH ? W_ : G.T[ty * MW + tx]; };
  const solidT = (t) => t === W_ || t === CRATE || t === CAR;
  function hitsSolid(x, y, r) {
    const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r) / TS), y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = tx < 0 || ty < 0 || tx >= MW || ty >= MH ? W_ : G.T[ty * MW + tx];
      if (!solidT(t)) continue;
      const px = clamp(x, tx * TS, tx * TS + TS), py = clamp(y, ty * TS, ty * TS + TS);
      if ((x - px) ** 2 + (y - py) ** 2 < r * r) return true;
    }
    return false;
  }
  function los(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 8);
    for (let i = 1; i < n; i++) { const t = i / n; if (solidT(tileAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))) return false; }
    return true;
  }
  const inBush = (p) => tileAt(p.x, p.y) === BUSH;

  /* ---------- матч ---------- */
  function newMatch(brk) {
    const map = genMap((Math.random() * 1e9) | 0);
    G = { ...map, players: [], bullets: [], parts: [], drops: [], nades: [], beams: [], feed: [], t: 0, zoneR: 99999, over: false, endT: 0, shake: 0 };
    const order = [...Array(PLAYERS).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < PLAYERS; i++) {
      const s = map.spawns[order[i]];
      const bk = i === 0 ? brk : ORDER[(Math.random() * 3) | 0];
      const b = BR[bk];
      G.players.push({ id: i, bot: i > 0, b, bk, name: i === 0 ? "Ты" : BOTNAMES[i - 1], x: s.x, y: s.y, r: 11, hp: b.hp, max: b.hp, ammo: 3, reg: 0, cd: 0, sup: 0, haste: 0, cubes: 0, aim: rnd(6.28), face: 1, alive: true, kills: 0, hit: 0, walk: 0, ai: { t: 0, tg: null, td: 0, strafe: Math.random() < 0.5 ? 1 : -1, sw: rnd(1), wx: s.x, wy: s.y, stuck: 0, px: s.x, py: s.y, pt: 0 } });
    }
    G.me = G.players[0];
    G.focus = G.me;
    // кубы силы из ящиков уже есть; пара кубов лежит на карте
    for (let i = 0; i < 6; i++) { const p = randFloor(); if (p) G.drops.push({ x: p.x, y: p.y, bob: rnd(6) }); }
    buildMini();
  }
  function randFloor() {
    for (let i = 0; i < 40; i++) {
      const tx = 2 + ((Math.random() * (MW - 4)) | 0), ty = 2 + ((Math.random() * (MH - 4)) | 0);
      if (!solidT(G.T[ty * MW + tx])) return { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
    }
    return null;
  }
  const dmgMul = (p) => 1 + 0.1 * p.cubes;
  function part(x, y, col, n, sp, life, size) {
    for (let i = 0; i < n; i++) { const a = rnd(6.28), s = rnd(0.3, 1) * sp; G.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, col, size: size || 3 }); }
  }
  function text(x, y, txt, col) { G.parts.push({ x, y, vx: 0, vy: -38, life: 0.7, max: 0.7, col, txt, size: 12 }); }
  const near = (p, d) => G.focus && Math.hypot(p.x - G.focus.x, p.y - G.focus.y) < d;

  function fire(p, ang) {
    if (!p.alive || p.ammo < 1 || p.cd > 0) return false;
    const b = p.b, dm = dmgMul(p);
    p.ammo -= 1; p.cd = p.haste > 0 ? b.cd * 0.5 : b.cd; p.aim = ang;
    for (let k = 0; k < b.pellets; k++) {
      const a = ang + (b.pellets > 1 ? (k - (b.pellets - 1) / 2) * b.spread : (Math.random() - 0.5) * b.spread);
      G.bullets.push({ x: p.x + Math.cos(a) * 14, y: p.y - 2 + Math.sin(a) * 14, vx: Math.cos(a) * b.bspeed, vy: Math.sin(a) * b.bspeed, left: b.range, dmg: b.dmg * dm, o: p, col: b.col });
    }
    part(p.x + Math.cos(ang) * 18, p.y + Math.sin(ang) * 18, "#fff2a0", 3, 80, 0.15, 2);
    if (near(p, 380)) sfx(p.bk === "sniper" ? 140 : p.bk === "biker" ? 190 : 320, 0.09, "sawtooth", p === G.me ? 0.04 : 0.015);
    return true;
  }
  function useSuper(p, ang) {
    if (!p.alive || p.sup < 100) return false;
    p.sup = 0; p.aim = ang;
    const dm = dmgMul(p);
    if (p.b.sup === "nade") {
      const d = 210;
      G.nades.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, tx: p.x + Math.cos(ang) * d, ty: p.y + Math.sin(ang) * d, t: 0, o: p, dmg: 62 * dm });
    } else if (p.b.sup === "beam") {
      const L = 540, n = Math.ceil(L / 8);
      let ex = p.x, ey = p.y;
      for (let i = 1; i <= n; i++) {
        const x = p.x + Math.cos(ang) * i * 8, y = p.y + Math.sin(ang) * i * 8;
        const t = tileAt(x, y);
        if (t === W_ || t === CAR) break;
        if (t === CRATE) hitCrate(x, y, 999);
        ex = x; ey = y;
      }
      G.beams.push({ x1: p.x, y1: p.y - 2, x2: ex, y2: ey - 2, t: 0.22 });
      G.players.forEach((q) => {
        if (q === p || !q.alive) return;
        const dx = ex - p.x, dy = ey - p.y, l2 = dx * dx + dy * dy || 1;
        const t = clamp(((q.x - p.x) * dx + (q.y - p.y) * dy) / l2, 0, 1);
        if (Math.hypot(q.x - (p.x + dx * t), q.y - (p.y + dy * t)) < q.r + 10) hurt(q, 78 * dm, p);
      });
      G.shake = 0.2;
    } else if (p.b.sup === "haste") {
      p.haste = 6; p.ammo = 3;
      part(p.x, p.y, "#c9a0ff", 14, 120, 0.4, 3);
    }
    if (near(p, 400)) sfx(90, 0.3, "sawtooth", 0.05);
    return true;
  }
  function hitCrate(x, y, dmg) {
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS), i = ty * MW + tx;
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH || G.T[i] !== CRATE) return;
    G.CH[i] -= dmg;
    part(x, y, "#c98a3d", 3, 70, 0.3, 3);
    if (G.CH[i] <= 0) {
      G.T[i] = 0; G.mini && (G.dirtyMini = true);
      part((tx + 0.5) * TS, (ty + 0.5) * TS, "#b57a36", 12, 110, 0.5, 4);
      G.drops.push({ x: (tx + 0.5) * TS, y: (ty + 0.5) * TS, bob: rnd(6) });
      if (near({ x: x, y: y }, 400)) sfx(100, 0.12, "triangle", 0.04);
    }
  }
  function hurt(q, dmg, src, quiet) {
    if (!q.alive) return;
    q.hp -= dmg; q.hit = 0.12;
    if (!quiet) text(q.x, q.y - 20, String(Math.round(dmg)), src === G.me ? "#ffe45a" : "#ff6a6a");
    if (src) src.sup = Math.min(100, src.sup + dmg * 0.9);
    if (q === G.me) { buzz("medium"); G.shake = Math.max(G.shake, 0.1); }
    if (q.hp <= 0) die(q, src);
  }
  function die(q, src) {
    q.alive = false; q.hp = 0;
    part(q.x, q.y, q.b.col, 22, 150, 0.7, 4);
    const n = 1 + q.cubes;
    for (let i = 0; i < n; i++) G.drops.push({ x: q.x + rnd(-16, 16), y: q.y + rnd(-16, 16), bob: rnd(6) });
    if (src) src.kills++;
    G.feed.push({ t: 4, txt: (src ? src.name : "Зона") + " → " + q.name, me: src === G.me || q === G.me });
    if (G.feed.length > 4) G.feed.shift();
    q.place = G.players.filter((p) => p.alive).length + 1;
    if (near(q, 500)) sfx(70, 0.35, "sawtooth", 0.05);
    if (q === G.me) { buzz("heavy"); G.endT = 1.3; G.focus = src && src.alive ? src : G.players.find((p) => p.alive) || G.me; }
    else if (G.focus === q) G.focus = G.players.find((p) => p.alive) || G.me;
    const alive = G.players.filter((p) => p.alive);
    if (alive.length === 1 && !G.over) { G.over = true; alive[0].place = 1; G.endT = Math.max(G.endT, alive[0] === G.me ? 0.8 : G.endT); }
    if (alive.length === 0) G.over = true;
  }

  /* ---------- обновление ---------- */
  function moveP(p, dx, dy, dt) {
    const nx = p.x + dx * dt, ny = p.y + dy * dt;
    if (!hitsSolid(nx, p.y, p.r)) p.x = nx;
    if (!hitsSolid(p.x, ny, p.r)) p.y = ny;
  }
  function update(dt) {
    G.t += dt;
    const sT = 15, dur = 120, R0 = 905, R1 = 105;
    G.zoneR = G.t < sT ? R0 : R0 + (R1 - R0) * clamp((G.t - sT) / dur, 0, 1);
    const zc = { x: (MW * TS) / 2, y: (MH * TS) / 2 };
    const zdmg = 7 + G.t / 25;

    G.players.forEach((p) => {
      if (!p.alive) return;
      p.cd = Math.max(0, p.cd - dt); p.hit = Math.max(0, p.hit - dt); p.haste = Math.max(0, p.haste - dt);
      if (p.ammo < 3) { p.reg += dt * (p.haste > 0 ? 2.5 : 1); if (p.reg >= p.b.reload) { p.reg = 0; p.ammo = Math.min(3, Math.floor(p.ammo) + 1); } } else p.reg = 0;
      if (p.bot) aiStep(p, dt, zc); else humanStep(p, dt);
      if (Math.hypot(p.x - zc.x, p.y - zc.y) > G.zoneR) { p.hp -= zdmg * dt; p.hit = 0.05; if (p.hp <= 0) die(p, null); }
    });
    // не слипаемся
    const A = G.players;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      const a = A[i], b = A[j]; if (!a.alive || !b.alive) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r - 2;
      if (d > 0.01 && d < m) { const k = (m - d) / 2 / d; if (!hitsSolid(a.x - dx * k, a.y - dy * k, a.r)) { a.x -= dx * k; a.y -= dy * k; } if (!hitsSolid(b.x + dx * k, b.y + dy * k, b.r)) { b.x += dx * k; b.y += dy * k; } }
    }
    // кубы силы
    G.drops = G.drops.filter((d) => {
      for (const p of A) if (p.alive && Math.hypot(p.x - d.x, p.y - d.y) < 20) {
        p.cubes++; const add = p.b.hp * 0.1; p.max += add; p.hp += add;
        if (p === G.me) { text(p.x, p.y - 22, "+куб", "#7dffb0"); sfx(660, 0.12, "triangle", 0.04); buzz("light"); }
        return false;
      }
      return true;
    });
    // пули
    G.bullets = G.bullets.filter((b) => {
      const step = Math.hypot(b.vx, b.vy) * dt, n = Math.max(1, Math.ceil(step / 8));
      for (let i = 0; i < n; i++) {
        b.x += (b.vx * dt) / n; b.y += (b.vy * dt) / n;
        const t = tileAt(b.x, b.y);
        if (solidT(t)) { if (t === CRATE) hitCrate(b.x, b.y, b.dmg); part(b.x, b.y, "#ffffff", 2, 60, 0.15, 2); return false; }
        for (const q of A) if (q.alive && q !== b.o && Math.hypot(q.x - b.x, q.y - b.y) < q.r + 3) { hurt(q, b.dmg, b.o); part(b.x, b.y, "#ffffff", 4, 90, 0.2, 2); return false; }
      }
      b.left -= step;
      return b.left > 0;
    });
    // гранаты
    G.nades = G.nades.filter((g) => {
      g.t += dt;
      const k = clamp(g.t / 0.6, 0, 1);
      g.x = g.sx + (g.tx - g.sx) * k; g.y = g.sy + (g.ty - g.sy) * k;
      if (solidT(tileAt(g.x, g.y)) && k < 1) { g.tx = g.x; g.ty = g.y; g.t = 0.6; }
      if (g.t < 0.6) return true;
      const R = 72;
      part(g.x, g.y, "#ff9a3c", 26, 200, 0.5, 5); part(g.x, g.y, "#ffe27a", 14, 130, 0.35, 3);
      G.shake = Math.max(G.shake, 0.25);
      G.beams.push({ ring: true, x1: g.x, y1: g.y, r: R, t: 0.25 });
      A.forEach((q) => { if (q.alive && q !== g.o && Math.hypot(q.x - g.x, q.y - g.y) < R + q.r) hurt(q, g.dmg, g.o); });
      for (let ty = Math.floor((g.y - R) / TS); ty <= Math.floor((g.y + R) / TS); ty++) for (let tx = Math.floor((g.x - R) / TS); tx <= Math.floor((g.x + R) / TS); tx++) {
        if (tx >= 0 && ty >= 0 && tx < MW && ty < MH && G.T[ty * MW + tx] === CRATE && Math.hypot((tx + 0.5) * TS - g.x, (ty + 0.5) * TS - g.y) < R + 12) hitCrate((tx + 0.5) * TS, (ty + 0.5) * TS, 999);
      }
      if (near(g, 500)) sfx(60, 0.4, "sawtooth", 0.06);
      return false;
    });
    G.beams = G.beams.filter((b) => ((b.t -= dt) > 0));
    G.parts = G.parts.filter((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= p.txt ? 1 : 0.92; return (p.life -= dt) > 0; });
    G.feed.forEach((f) => (f.t -= dt)); G.feed = G.feed.filter((f) => f.t > 0);
    G.shake = Math.max(0, G.shake - dt);
    if (G.endT > 0) { G.endT -= dt; if (G.endT <= 0 && mode === "play") finish(); }
    if (G.over && G.endT <= 0 && mode === "play") finish();
  }

  function humanStep(p, dt) {
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1; if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
    if (stickL) { const dx = stickL.x - stickL.sx, dy = stickL.y - stickL.sy, d = Math.hypot(dx, dy); if (d > 6) { const k = Math.min(1, d / 50); mx = (dx / d) * k; my = (dy / d) * k; } }
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const sp = p.b.speed * (p.haste > 0 ? 1.35 : 1);
    if (l > 0.05) { moveP(p, mx * sp, my * sp, dt); p.walk += dt * 12; if (Math.abs(mx) > 0.2) p.face = mx > 0 ? 1 : -1; }
    // прицел и стрельба
    if (stickR) {
      const dx = stickR.x - stickR.sx, dy = stickR.y - stickR.sy, d = Math.hypot(dx, dy);
      if (d > 14) { stickR.aiming = true; stickR.ang = Math.atan2(dy, dx); fire(p, stickR.ang); }
      if (stickR.aiming) p.aim = stickR.ang;
    } else if (mouse.on && mouse.down) {
      const sx = (p.x - G.camX) * zoom, sy = (p.y - G.camY) * zoom;
      const a = Math.atan2(mouse.y - sy, mouse.x - sx); p.aim = a; fire(p, a);
    } else if (mouse.on) {
      p.aim = Math.atan2(mouse.y - (p.y - G.camY) * zoom, mouse.x - (p.x - G.camX) * zoom);
    }
    if (keys.Space && p.sup >= 100) useSuper(p, p.aim);
  }
  function nearestEnemy(p, maxD, seeBush) {
    let best = null, bd = maxD;
    G.players.forEach((q) => {
      if (q === p || !q.alive) return;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd && (seeBush || !inBush(q) || d < 90) && los(p, q)) { best = q; bd = d; }
    });
    return best;
  }

  function aiStep(p, dt, zc) {
    const a = p.ai, b = p.b;
    a.t -= dt;
    if (a.t <= 0) {
      a.t = 0.25 + Math.random() * 0.15;
      a.tg = nearestEnemy(p, 420, false);
      if (!a.tg) {
        let bd = 330, bg = null;
        G.drops.forEach((d) => { const dd = Math.hypot(d.x - p.x, d.y - p.y); if (dd < bd) { bd = dd; bg = d; } });
        a.drop = bg;
      }
    }
    let gx = null, gy = null, mxv = 0, myv = 0, spd = b.speed * 0.88 * (p.haste > 0 ? 1.35 : 1);
    const dz = Math.hypot(p.x - zc.x, p.y - zc.y);
    if (dz > G.zoneR - 70) { gx = zc.x; gy = zc.y; a.tg = a.tg && dz < G.zoneR + 20 ? a.tg : null; }
    else if (a.tg && a.tg.alive) {
      const q = a.tg, dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
      const ideal = b.range * 0.6;
      let f = d > ideal * 1.15 ? 1 : d < ideal * 0.7 ? -1 : 0;
      a.sw -= dt; if (a.sw <= 0) { a.strafe *= -1; a.sw = 0.7 + Math.random() * 1.2; }
      mxv = (dx / d) * f + (-dy / d) * a.strafe * 0.7; myv = (dy / d) * f + (dx / d) * a.strafe * 0.7;
      if (d < b.range * 0.95 && p.ammo >= 1 && p.cd <= 0 && Math.random() < dt * 7) fire(p, ang + (Math.random() - 0.5) * 0.3);
      if (p.sup >= 100 && d < b.range * 0.9 && Math.random() < dt * 2) useSuper(p, ang);
      p.aim = ang;
    } else {
      if (a.drop && G.drops.includes(a.drop)) { gx = a.drop.x; gy = a.drop.y; }
      else {
        if (Math.hypot(a.wx - p.x, a.wy - p.y) < 24 || a.stuck > 0.8) { const f = randFloor(); if (f && Math.hypot(f.x - zc.x, f.y - zc.y) < G.zoneR - 80) { a.wx = f.x; a.wy = f.y; } a.stuck = 0; }
        gx = a.wx; gy = a.wy;
      }
    }
    if (gx !== null) { const dx = gx - p.x, dy = gy - p.y, d = Math.hypot(dx, dy) || 1; mxv = dx / d; myv = dy / d; }
    const l = Math.hypot(mxv, myv);
    if (l > 0.05) {
      mxv /= Math.max(1, l); myv /= Math.max(1, l);
      moveP(p, mxv * spd, myv * spd, dt); p.walk += dt * 12;
      if (Math.abs(mxv) > 0.2) p.face = mxv > 0 ? 1 : -1;
    }
    a.pt += dt;
    if (a.pt > 0.5) { if (Math.hypot(p.x - a.px, p.y - a.py) < 6 && l > 0.05) { a.stuck += 0.5; a.strafe *= -1; a.sw = 1; } else a.stuck = 0; a.px = p.x; a.py = p.y; a.pt = 0; }
  }

  /* ---------- отрисовка ---------- */
  function drawChar(g, x, y, p, opts) {
    const b = p.b || BR[p.bk], hitF = p.hit > 0, walk = opts && opts.still ? 0 : Math.sin(p.walk || 0) * 1.5;
    g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(x, y + 9, 11, 5, 0, 0, 6.3); g.fill();
    const body = hitF ? "#ffffff" : b.col, dark = hitF ? "#ffffff" : shade(b.col, 0.6);
    // ноги
    g.fillStyle = hitF ? "#fff" : "#242038"; g.fillRect(x - 6, y + 2, 5, 7 + walk); g.fillRect(x + 1, y + 2, 5, 7 - walk);
    // корпус
    g.fillStyle = body; g.fillRect(x - 8, y - 8, 16, 12);
    g.fillStyle = dark; g.fillRect(x - 8, y + 2, 16, 2);
    // голова
    const hy = y - 19;
    g.fillStyle = hitF ? "#fff" : "#f0c093"; g.fillRect(x - 6, hy, 12, 11);
    g.fillStyle = hitF ? "#fff" : b.hair; g.fillRect(x - 6, hy - 1, 12, 4);
    // лицо / очки / шапка
    if (!hitF) {
      if (p.bk === "gang") { g.fillStyle = "#101018"; g.fillRect(x - 5, hy + 4, 10, 3); g.fillStyle = "#ff3fa4"; g.fillRect(x - 5, hy + 4, 4, 1); }
      else { g.fillStyle = "#1a1a24"; g.fillRect(x - 4, hy + 5, 2, 2); g.fillRect(x + 2, hy + 5, 2, 2); }
      if (p.bk === "biker") { g.fillStyle = "#1b1b24"; g.fillRect(x - 7, hy - 2, 14, 5); g.fillStyle = "#e0364f"; g.fillRect(x - 7, hy + 1, 14, 1); }
      if (p.bk === "sniper") { g.fillStyle = "#1e6e40"; g.fillRect(x - 7, hy - 2, 14, 4); g.fillRect(x - 7, hy + 1, 4, 5); g.fillRect(x + 3, hy + 1, 4, 5); }
    }
    // оружие
    const aim = p.aim || 0;
    g.save(); g.translate(x, y - 3); g.rotate(aim);
    if (Math.cos(aim) < 0) g.scale(1, -1);
    const L = p.bk === "sniper" ? 24 : p.bk === "gang" ? 17 : 19;
    g.fillStyle = "#15151c"; g.fillRect(2, -2, L, 4);
    g.fillStyle = "#5b5b70"; g.fillRect(2, -2, L, 1);
    g.fillStyle = p.haste > 0 ? "#c9a0ff" : "#2c2c3a"; g.fillRect(2, 1, 6, 4);
    g.restore();
  }
  function drawBlock(g, top, front, px, py, h, drawFront) {
    if (drawFront) g.drawImage(front, 0, 0, 16, Math.max(1, Math.round((h / TS) * 16)), px, py + TS - h, TS, h);
    g.drawImage(top, px, py - h, TS, TS);
  }
  function buildMini() {
    const s = 2, c = document.createElement("canvas"); c.width = MW * s; c.height = MH * s;
    G.mini = c; G.dirtyMini = true;
  }
  function paintMini() {
    const g = G.mini.getContext("2d"), s = 2;
    g.clearRect(0, 0, G.mini.width, G.mini.height);
    g.fillStyle = "rgba(10,6,24,.8)"; g.fillRect(0, 0, G.mini.width, G.mini.height);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const t = G.T[y * MW + x]; if (!t) continue;
      g.fillStyle = t === W_ ? "#6b5aa8" : t === BUSH ? "#1c8a3e" : t === CRATE ? "#b57a36" : "#ff3fa4";
      g.fillRect(x * s, y * s, s, s);
    }
    G.dirtyMini = false;
  }

  function render() {
    const g = cx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#0d0820"; g.fillRect(0, 0, vw, vh);
    if (!G) return;
    const f = G.focus || G.me;
    const wv = vw / zoom, hv = vh / zoom;
    let camX = clamp(f.x - wv / 2, -40, MW * TS - wv + 40), camY = clamp(f.y - hv / 2 + 20, -40, MH * TS - hv + 40);
    if (G.shake > 0) { camX += rnd(-3, 3) * (G.shake * 6); camY += rnd(-3, 3) * (G.shake * 6); }
    G.camX = camX; G.camY = camY;
    g.save(); g.scale(zoom, zoom); g.translate(-camX, -camY);
    const x0 = Math.max(0, Math.floor(camX / TS) - 1), x1 = Math.min(MW - 1, Math.ceil((camX + wv) / TS) + 1);
    const y0 = Math.max(0, Math.floor(camY / TS) - 1), y1 = Math.min(MH - 1, Math.ceil((camY + hv) / TS) + 2);
    // пол
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const road = tx % 10 < 3 || ty % 10 < 3;
      let t = TX.walk;
      if (road) {
        t = TX.road;
        if (tx % 10 === 1 && ty % 10 >= 3) t = TX.roadLineV;
        else if (ty % 10 === 1 && tx % 10 >= 3) t = TX.roadLine;
      }
      g.drawImage(t, tx * TS, ty * TS, TS, TS);
    }
    // за пределами зоны — красная заливка и граница
    const zc = { x: (MW * TS) / 2, y: (MH * TS) / 2 };
    // кубы
    G.drops.forEach((d) => {
      const bob = Math.sin(G.t * 4 + d.bob) * 2;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(d.x, d.y + 8, 7, 3, 0, 0, 6.3); g.fill();
      g.fillStyle = "#2cf5a1"; g.fillRect(d.x - 7, d.y - 8 + bob, 14, 14);
      g.fillStyle = "#a8ffd8"; g.fillRect(d.x - 7, d.y - 8 + bob, 14, 3);
      g.fillStyle = "#12a366"; g.fillRect(d.x - 7, d.y + 3 + bob, 14, 3);
      g.fillStyle = "#0a5e3b"; g.fillRect(d.x - 2, d.y - 3 + bob, 4, 4);
    });
    // бойцы
    const vis = G.players.filter((p) => p.alive).sort((a, b) => a.y - b.y);
    vis.forEach((p) => {
      const bush = inBush(p), me = p === f || p === G.me;
      if (bush && !me && Math.hypot(p.x - f.x, p.y - f.y) > 90) return;
      g.globalAlpha = bush ? 0.7 : 1;
      drawChar(g, p.x, p.y, p, null);
      g.globalAlpha = 1;
    });
    // пули
    G.bullets.forEach((b) => {
      const a = Math.atan2(b.vy, b.vx);
      g.save(); g.translate(b.x, b.y - 2); g.rotate(a);
      g.fillStyle = b.col; g.globalAlpha = 0.4; g.fillRect(-12, -2, 12, 4); g.globalAlpha = 1;
      g.fillStyle = "#fff8c0"; g.fillRect(-3, -2, 7, 4);
      g.restore();
    });
    // гранаты
    G.nades.forEach((n) => {
      const k = clamp(n.t / 0.6, 0, 1), h = Math.sin(k * Math.PI) * 38;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(n.x, n.y + 4, 6, 3, 0, 0, 6.3); g.fill();
      g.fillStyle = "#3a8a3a"; g.fillRect(n.x - 5, n.y - h - 5, 10, 10); g.fillStyle = "#9ee89e"; g.fillRect(n.x - 5, n.y - h - 5, 10, 3);
    });
    // высокие блоки поверх бойцов (псевдо-3D)
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * MW + tx, t = G.T[i]; if (!t) continue;
      const px = tx * TS, py = ty * TS, v = G.hash[i];
      if (t === W_) drawBlock(g, TX.roof[v], TX.facade[v], px, py, 12, ty + 1 >= MH || G.T[i + MW] !== W_);
      else if (t === CRATE) drawBlock(g, TX.crateTop, TX.crateFront, px, py, 7, true);
      else if (t === CAR) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(px + 1, py + 4, TS - 2, TS - 2); g.drawImage(TX.car[v], px, py - 5, TS, TS); }
      else if (t === BUSH) { g.globalAlpha = 0.96; g.drawImage(TX.bush, px, py - 3, TS, TS); g.globalAlpha = 1; }
    }
    // лучи и кольца
    G.beams.forEach((b) => {
      if (b.ring) { g.strokeStyle = `rgba(255,170,60,${b.t * 3})`; g.lineWidth = 3; g.beginPath(); g.arc(b.x1, b.y1, b.r * (1 - b.t * 2), 0, 6.3); g.stroke(); return; }
      g.strokeStyle = `rgba(120,255,240,${Math.min(1, b.t * 5)})`; g.lineWidth = 6; g.beginPath(); g.moveTo(b.x1, b.y1); g.lineTo(b.x2, b.y2); g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 2; g.stroke();
    });
    // частицы
    G.parts.forEach((p) => {
      g.globalAlpha = clamp(p.life / p.max, 0, 1);
      if (p.txt) { g.fillStyle = p.col; g.font = "bold 12px system-ui,sans-serif"; g.textAlign = "center"; g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3; g.strokeText(p.txt, p.x, p.y); g.fillText(p.txt, p.x, p.y); }
      else { g.fillStyle = p.col; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    });
    g.globalAlpha = 1;
    // полоски над бойцами и прицел
    vis.forEach((p) => {
      const bush = inBush(p), me = p === G.me;
      if (bush && !me && Math.hypot(p.x - f.x, p.y - f.y) > 90) return;
      const w = 34, x = p.x - w / 2, y = p.y - 36;
      g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(x - 1, y - 1, w + 2, 7);
      g.fillStyle = me ? "#38d6ff" : "#ff4d6a"; g.fillRect(x, y, w * clamp(p.hp / p.max, 0, 1), 5);
      g.fillStyle = "#fff"; g.font = "bold 9px system-ui,sans-serif"; g.textAlign = "center";
      g.fillText(Math.ceil(p.hp), p.x, y - 3);
      if (p.cubes) { g.fillStyle = "#2cf5a1"; g.fillRect(x, y + 7, 5, 5); g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(p.cubes, x + 7, y + 12); }
      if (!me) { g.fillStyle = "rgba(255,255,255,.85)"; g.textAlign = "center"; g.fillText(p.name, p.x, y - 13); }
    });
    // линия прицела у игрока
    if (G.me.alive && mode === "play") {
      const m = G.me;
      if (stickR && stickR.aiming) {
        g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 3; g.setLineDash([8, 6]);
        g.beginPath(); g.moveTo(m.x, m.y - 3); g.lineTo(m.x + Math.cos(stickR.ang) * m.b.range, m.y - 3 + Math.sin(stickR.ang) * m.b.range); g.stroke(); g.setLineDash([]);
      }
      for (let i = 0; i < 3; i++) {
        const fill = clamp(m.ammo - i, 0, 1);
        g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(m.x - 14 + i * 10, m.y + 14, 8, 4);
        g.fillStyle = "#ffcf3a"; g.fillRect(m.x - 14 + i * 10, m.y + 14, 8 * fill, 4);
      }
    }
    // зона
    g.save();
    g.beginPath(); g.rect(camX - 10, camY - 10, wv + 20, hv + 20); g.arc(zc.x, zc.y, Math.max(1, G.zoneR), 0, 6.2832, true);
    g.fillStyle = "rgba(255,30,90,.28)"; g.fill("evenodd");
    g.restore();
    g.strokeStyle = "#ff3fa4"; g.lineWidth = 3; g.beginPath(); g.arc(zc.x, zc.y, Math.max(1, G.zoneR), 0, 6.2832); g.stroke();
    g.restore();

    // неоновая виньетка
    const vg = g.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.35, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
    vg.addColorStop(0, "rgba(255,80,170,0)"); vg.addColorStop(1, "rgba(40,10,90,.55)");
    g.fillStyle = vg; g.fillRect(0, 0, vw, vh);
    drawHud(g);
  }

  function drawHud(g) {
    const m = G.me, alive = G.players.filter((p) => p.alive).length;
    g.textAlign = "left"; g.font = "800 13px system-ui,sans-serif";
    const chip = (x, y, w, txt, col) => { g.fillStyle = "rgba(10,6,24,.72)"; rr(g, x, y, w, 26, 8); g.fill(); g.fillStyle = col || "#fff"; g.fillText(txt, x + 9, y + 18); };
    const top = 62; // место под системную кнопку/шапку Telegram
    chip(12, top, 88, "Живых: " + alive, "#fff");
    chip(12, top + 32, 88, "Убийств: " + m.kills, "#ffe45a");
    // зона
    if (G.t < 15) chip(12, top + 64, 150, "Зона через " + Math.ceil(15 - G.t) + " с", "#ff7ab8");
    else if (G.zoneR > 110) chip(12, top + 64, 130, "Зона сужается", "#ff7ab8");
    // лента
    g.font = "700 11px system-ui,sans-serif";
    G.feed.forEach((fd, i) => { g.globalAlpha = Math.min(1, fd.t); g.fillStyle = fd.me ? "#ffe45a" : "#ffffff"; g.textAlign = "right"; g.fillText(fd.txt, vw - 12, top + 100 + i * 15); });
    g.globalAlpha = 1;
    // миникарта
    const ms = 92, mx = vw - ms - 12, my = top;
    if (G.dirtyMini) paintMini();
    g.drawImage(G.mini, mx, my, ms, ms * (MH / MW));
    g.strokeStyle = "#ff3fa4"; g.lineWidth = 1.5;
    g.save(); g.beginPath(); g.rect(mx, my, ms, ms * (MH / MW)); g.clip(); g.beginPath(); g.arc(mx + ms / 2, my + ms / 2, (G.zoneR / (MW * TS)) * ms, 0, 6.3); g.stroke(); g.restore();
    G.players.forEach((p) => { if (!p.alive) return; g.fillStyle = p === m ? "#38d6ff" : "#ff4d6a"; g.fillRect(mx + (p.x / (MW * TS)) * ms - 2, my + (p.y / (MH * TS)) * ms - 2, p === m ? 5 : 4, p === m ? 5 : 4); });
    // супер
    const sb = supPos(), ready = m.sup >= 100 && m.alive;
    g.fillStyle = "rgba(10,6,24,.7)"; g.beginPath(); g.arc(sb.x, sb.y, sb.r, 0, 6.3); g.fill();
    g.strokeStyle = ready ? "#ffe45a" : "#ff3fa4"; g.lineWidth = 6; g.beginPath(); g.arc(sb.x, sb.y, sb.r - 3, -1.5708, -1.5708 + 6.2832 * (m.sup / 100)); g.stroke();
    g.fillStyle = ready ? "#ffe45a" : "rgba(255,255,255,.7)"; g.textAlign = "center"; g.font = "900 13px system-ui,sans-serif";
    g.fillText("СУПЕР", sb.x, sb.y + 4);
    // стики
    if (!m.alive) return;
    const stick = (s, col) => { if (!s) return; g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 3; g.beginPath(); g.arc(s.sx, s.sy, 50, 0, 6.3); g.stroke(); const d = Math.hypot(s.x - s.sx, s.y - s.sy), k = d > 50 ? 50 / d : 1; g.fillStyle = col; g.globalAlpha = 0.65; g.beginPath(); g.arc(s.sx + (s.x - s.sx) * k, s.sy + (s.y - s.sy) * k, 24, 0, 6.3); g.fill(); g.globalAlpha = 1; };
    stick(stickL, "#38d6ff"); stick(stickR, "#ff3fa4");
    if (!stickL && !stickR && "ontouchstart" in window && G.t < 6) { g.fillStyle = "rgba(255,255,255,.5)"; g.font = "700 12px system-ui,sans-serif"; g.fillText("слева — ходить, справа — тянуть и стрелять, тап — авто-прицел", vw / 2, vh - 24); }
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  const supPos = () => ({ x: vw - 52, y: vh - 190, r: 32 });

  /* ---------- ввод ---------- */
  function bindInput() {
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
    on(window, "keydown", (e) => { if (mode === "play") { keys[e.code] = true; if (/^(Arrow|Space)/.test(e.code)) e.preventDefault(); } });
    on(window, "keyup", (e) => { keys[e.code] = false; });
    on(cv, "contextmenu", (e) => e.preventDefault());
    on(cv, "pointerdown", (e) => {
      if (mode !== "play") return;
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch {}
      const x = e.clientX, y = e.clientY;
      if (e.pointerType === "mouse") { mouse.on = true; mouse.down = true; mouse.x = x; mouse.y = y; return; }
      const sb = supPos();
      if (Math.hypot(x - sb.x, y - sb.y) < sb.r + 14 && !supBtn) { supBtn = { id: e.pointerId }; const m = G.me, t = nearestEnemy(m, 420, false); useSuper(m, t ? Math.atan2(t.y - m.y, t.x - m.x) : m.aim); return; }
      if (x < vw / 2) { if (!stickL) stickL = { id: e.pointerId, sx: x, sy: y, x, y }; }
      else if (!stickR) stickR = { id: e.pointerId, sx: x, sy: y, x, y, t0: performance.now(), aiming: false, ang: G.me.aim };
    });
    on(cv, "pointermove", (e) => {
      if (e.pointerType === "mouse") { mouse.on = true; mouse.x = e.clientX; mouse.y = e.clientY; return; }
      if (stickL && stickL.id === e.pointerId) { stickL.x = e.clientX; stickL.y = e.clientY; }
      if (stickR && stickR.id === e.pointerId) { stickR.x = e.clientX; stickR.y = e.clientY; }
    });
    const up = (e) => {
      if (e.pointerType === "mouse") { mouse.down = false; return; }
      if (supBtn && supBtn.id === e.pointerId) supBtn = null;
      if (stickL && stickL.id === e.pointerId) stickL = null;
      if (stickR && stickR.id === e.pointerId) {
        const s = stickR; stickR = null;
        if (!s.aiming && mode === "play" && G.me.alive && performance.now() - s.t0 < 350) { // тап — авто-прицел
          const m = G.me, t = nearestEnemy(m, m.b.range * 1.15, false);
          fire(m, t ? Math.atan2(t.y - m.y, t.x - m.x) : m.aim);
        }
      }
    };
    on(cv, "pointerup", up); on(cv, "pointercancel", up);
    on(window, "resize", resize);
    on(document, "visibilitychange", () => { if (document.hidden) { stickL = stickR = supBtn = null; mouse.down = false; } });
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    vw = root.clientWidth || window.innerWidth; vh = root.clientHeight || window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + "px"; cv.style.height = vh + "px";
    zoom = clamp(Math.min(vw, vh) / (TS * 10), 0.9, 2);
  }

  /* ---------- интерфейс: меню и итоги ---------- */
  function css() {
    if (document.getElementById("nb-css")) return;
    const s = document.createElement("style"); s.id = "nb-css";
    s.textContent = `
#game{position:fixed;inset:0;z-index:30;background:#0d0820;touch-action:none;overflow:hidden;padding:0!important}
#game canvas{display:block;touch-action:none;user-select:none;-webkit-user-select:none}
.nb-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:70px 18px 24px;background:linear-gradient(180deg,rgba(40,8,70,.93),rgba(8,4,24,.96));color:#fff;font-family:system-ui,sans-serif;overflow:auto;text-align:center}
.nb-ov h1{margin:0;font-size:30px;font-weight:900;letter-spacing:.5px;background:linear-gradient(90deg,#ff3fa4,#ffa23c,#2ee6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.nb-badge{font-size:11px;font-weight:800;letter-spacing:1.5px;color:#ffe45a;border:1px solid #ffe45a;border-radius:20px;padding:3px 10px}
.nb-sub{font-size:13px;opacity:.75;max-width:320px}
.nb-row{display:flex;gap:10px;width:100%;max-width:380px}
.nb-card{flex:1;background:rgba(255,255,255,.07);border:2px solid transparent;border-radius:14px;padding:10px 6px;color:#fff;font:inherit;cursor:pointer}
.nb-card.on{border-color:#ff3fa4;background:rgba(255,63,164,.16)}
.nb-card b{display:block;font-size:14px;margin-top:2px}
.nb-card span{display:block;font-size:11px;opacity:.7;margin-top:2px}
.nb-info{font-size:12.5px;max-width:340px;min-height:36px;opacity:.9}
.nb-btn{border:0;border-radius:14px;padding:14px 34px;font:900 18px system-ui,sans-serif;color:#1a0a2a;background:linear-gradient(90deg,#ff3fa4,#ffa23c);cursor:pointer;box-shadow:0 6px 24px rgba(255,63,164,.4)}
.nb-btn.ghost{background:rgba(255,255,255,.12);color:#fff;box-shadow:none;font-size:15px;padding:11px 24px}
.nb-big{font-size:46px;font-weight:900}
.nb-stat{font-size:15px}
.nb-x{position:absolute;top:calc(var(--tg-content-safe-area-inset-top,0px) + var(--tg-safe-area-inset-top,0px) + 12px);left:12px;z-index:5;width:40px;height:40px;border-radius:12px;border:0;background:rgba(10,6,24,.72);color:#fff;font:700 20px system-ui,sans-serif}
`;
    document.head.appendChild(s);
  }
  const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function clearOv() { if (ov) { ov.remove(); ov = null; } }
  function previewCanvas(bk) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 70; c.style.width = "64px"; c.style.height = "70px";
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    drawChar(g, 32, 40, { bk, b: BR[bk], aim: 0.3, hit: 0, walk: 0, haste: 0 }, { still: true });
    return c;
  }
  function menu() {
    mode = "menu"; clearOv();
    ov = h("div", "nb-ov");
    ov.append(h("div", "nb-badge", "РАЗРАБОТКА · ТОЛЬКО АДМИН"), h("h1", null, "НЕОН-БЛОК"), h("div", "nb-sub", "Блочный город в неоне. 8 бойцов, одна сужающаяся зона. Выживи и стань последним."));
    const row = h("div", "nb-row"), info = h("div", "nb-info");
    const upd = () => { info.textContent = BR[pick].desc + "  HP " + BR[pick].hp; [...row.children].forEach((c, i) => c.classList.toggle("on", ORDER[i] === pick)); };
    ORDER.forEach((k) => {
      const b = h("button", "nb-card"); b.append(previewCanvas(k), h("b", null, BR[k].name), h("span", null, BR[k].supName));
      b.onclick = () => { pick = k; upd(); sfx(500, 0.06, "triangle"); }; row.append(b);
    });
    const st = store.get();
    const rec = h("div", "nb-sub", st.games ? `Игр: ${st.games} · Побед: ${st.wins || 0} · Лучшее место: ${st.best || "—"}` : "Пока ни одной игры");
    const go = h("button", "nb-btn", "В БОЙ"); go.onclick = start;
    const help = h("div", "nb-sub", "Телефон: слева — ходить, справа — тянуть и стрелять (тап — авто-прицел), кнопка СУПЕР. Компьютер: WASD, мышь, пробел.");
    ov.append(row, info, go, rec, help); root.append(ov); upd();
  }
  function start() {
    clearOv(); buildTextures(); newMatch(pick);
    mode = "count"; G.count = 3;
    stickL = stickR = supBtn = null; mouse.down = false;
    sfx(440, 0.1, "square");
  }
  function finish() {
    if (mode === "over") return;
    mode = "over"; stickL = stickR = null; mouse.down = false;
    const m = G.me, place = m.alive ? 1 : m.place || PLAYERS, win = place === 1;
    const st = store.get(); st.games = (st.games || 0) + 1; if (win) st.wins = (st.wins || 0) + 1; st.best = Math.min(st.best || 99, place); store.set(st);
    buzz(win ? "heavy" : "medium");
    clearOv(); ov = h("div", "nb-ov"); ov.style.background = "linear-gradient(180deg,rgba(40,8,70,.8),rgba(8,4,24,.88))";
    ov.append(h("div", "nb-big", win ? "ПОБЕДА!" : "#" + place), h("div", "nb-stat", win ? "Ты последний выживший" : "Ты занял " + place + " место из " + PLAYERS), h("div", "nb-stat", "Убийств: " + m.kills + " · Кубов: " + m.cubes));
    const again = h("button", "nb-btn", "ЕЩЁ РАЗ"); again.onclick = start;
    const mn = h("button", "nb-btn ghost", "В меню"); mn.onclick = () => { G = null; menu(); };
    ov.append(again, mn); root.append(ov);
  }

  /* ---------- цикл ---------- */
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts;
    if (G && mode === "count") { G.count -= dt; if (G.count <= 0) mode = "play"; }
    if (G && (mode === "play" || mode === "over")) update(dt);
    else if (G && mode === "count") { G.t = 0; G.players.forEach((p) => (p.cd = 0)); }
    if (G) render(); else { cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = "#0d0820"; cx.fillRect(0, 0, vw, vh); }
    if (G && mode === "count") {
      cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.fillStyle = "#fff"; cx.font = "900 72px system-ui,sans-serif"; cx.textAlign = "center";
      cx.strokeStyle = "#ff3fa4"; cx.lineWidth = 6; cx.strokeText(String(Math.ceil(G.count)), vw / 2, vh / 2); cx.fillText(String(Math.ceil(G.count)), vw / 2, vh / 2);
    }
    raf = requestAnimationFrame(loop);
  }

  window.GAME = {
    open(el, onExit) {
      this.stop();
      root = el; css(); root.replaceChildren();
      cv = document.createElement("canvas"); root.append(cv); cx = cv.getContext("2d");
      const x = h("button", "nb-x", "←"); x.onclick = () => onExit && onExit(); root.append(x);
      bindInput(); resize(); buildTextures();
      running = true; last = performance.now(); raf = requestAnimationFrame(loop);
      menu();
    },
    stop() {
      running = false; cancelAnimationFrame(raf);
      cleanups.splice(0).forEach((f) => f());
      clearOv(); G = null; mode = "menu"; stickL = stickR = supBtn = null; mouse.down = false; mouse.on = false;
      Object.keys(keys).forEach((k) => delete keys[k]);
      if (root) root.replaceChildren();
    },
    // для тестов
    _dbg: () => ({ G, mode }),
    _step: (n, dt) => { for (let i = 0; i < n && G && mode !== "over"; i++) update(dt); },
  };
})();
