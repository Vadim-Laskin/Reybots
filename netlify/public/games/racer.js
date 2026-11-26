/* «Неон-трасса» — 3D-гонка для горизонтального экрана (WebGL без библиотек).
   Первая часть файла — правила и построение трасс без обращения к странице (проверяются в Node),
   вторая — отрисовка, управление и экраны. */
(function (root) {
  "use strict";
  var TOTAL = 15, HALF = 5, LIMIT = 4.2, SIDE = 12, JUMP = 11, GRAVITY = 30, SHIP_W = 0.75, RUSH = 5, BONUS = 9;

  /* ================= правила ================= */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // n = 1..15 — уровни, 0 — бесконечный заезд
  function spec(n, dist) {
    if (n) {
      var t = (n - 1) / (TOTAL - 1);
      return { n: n, speed: 20 + 20 * t, length: Math.round(450 + 950 * t), gap: 22 - 4 * t, t: t };
    }
    var k = Math.min(1, (dist || 0) / 5000);
    return { n: 0, speed: 22 + 24 * k, length: Infinity, gap: 22 - 3 * k, t: k };
  }
  // Ряды препятствий строятся вокруг «безопасного коридора»: он смещается не быстрее, чем успевает корабль,
  // поэтому любую трассу можно пройти без столкновений.
  function addRow(g) {
    var s = spec(g.n, g.nextZ), R = g.R, z = g.nextZ;
    var gap = Math.max(s.gap, s.speed * 0.5) * (0.95 + R() * 0.25);
    var jumpRow = R() < 0.08 + s.t * 0.14 && !g.lastJump;
    var move = Math.min(3.6, (SIDE * gap / s.speed) * 0.4);
    if (!jumpRow) g.safe = Math.max(-3.6, Math.min(3.6, g.safe + (R() * 2 - 1) * move));
    var safe = g.safe, wide = 1.5 - 0.35 * s.t; // полуширина коридора
    if (jumpRow) {
      g.objects.push({ type: "bar", z: z, x: 0, w: HALF * 2, h: 0.8, d: 0.6 });
      if (R() < 0.5) g.objects.push({ type: "gem", z: z, x: safe, y: 2.1 });
    } else {
      // свободные участки слева и справа от коридора
      var spans = [[-HALF, safe - wide], [safe + wide, HALF]].filter(function (p) { return p[1] - p[0] >= 0.9; });
      spans.forEach(function (p, i) {
        if (spans.length > 1 && i === (R() < 0.5 ? 0 : 1) && R() > 0.35 + s.t * 0.55) return;
        var room = p[1] - p[0], w = Math.min(room, 1.2 + R() * (1 + s.t * 2.6));
        var x = p[0] + w / 2 + R() * (room - w);
        var o = { type: "block", z: z, x: x, w: w, h: 1.6 + R() * 1.8, d: 1 };
        // подвижные препятствия ездят только по своему участку и в коридор не заезжают
        if (g.n !== 1 && s.t > 0.25 && room - w > 0.8 && R() < s.t * 0.55) {
          o.type = "mover"; o.base = p[0] + room / 2; o.amp = (room - w) / 2; o.rate = 1.2 + R() * 2; o.phase = R() * 6.28;
          o.x = o.base;
        }
        g.objects.push(o);
      });
      if (R() < 0.45) g.objects.push({ type: "gem", z: z, x: safe, y: 0.7 });
    }
    // золотой портал стоит в безопасном коридоре, после обычного (не прыжкового) ряда
    if (!jumpRow && z >= g.portalAt) {
      g.objects.push({ type: "portal", z: z + 2, x: safe, w: 3.8, d: 0.8 });
      g.portalAt = g.n ? Infinity : z + 900 + R() * 700;
    }
    g.path.push({ z: z, x: safe, jump: jumpRow });
    g.lastJump = jumpRow;
    g.nextZ += jumpRow || R() < 0.01 ? Math.max(gap, s.speed * 0.85) : gap;
  }
  function fill(g) {
    var end = spec(g.n, g.dist).length;
    while (g.nextZ < Math.min(g.dist + 220, end - 30)) addRow(g);
  }
  function newGame(n, seed) {
    var g = { n: n, R: rng(n ? 4099 * n + 7 : seed), dist: 0, x: 0, y: 0, vy: 0, roll: 0, lives: 3, gems: 0, safeTime: 0, safe: 0, nextZ: 55, lastJump: false, objects: [], path: [], t: 0, over: null,
      score: 0, combo: 0, charge: 0, rush: 0, bonus: 0, portals: 0 };
    // где на трассе спрятан портал (на бесконечном заезде они повторяются)
    g.portalAt = n ? spec(n).length * (0.35 + g.R() * 0.2) : 350 + g.R() * 300;
    fill(g);
    return g;
  }
  function objectX(o, t) { return o.type === "mover" ? o.base + o.amp * Math.sin(t * o.rate + o.phase) : o.x; }
  function charge(g, amount, events) {
    if (g.rush || g.bonus) return;
    g.charge = Math.min(1, g.charge + amount);
    if (g.charge >= 1) { g.rush = RUSH; g.charge = 0; events.push("rush"); }
  }
  // «Котомир»: препятствия исчезают, впереди змейкой летят кристаллы
  function enterBonus(g, speed) {
    g.bonus = BONUS; g.rush = 0; g.portals++;
    var end = g.dist + speed * BONUS, i = 0;
    g.objects = []; g.path = []; g.safe = Math.max(-3.6, Math.min(3.6, g.x));
    for (var z = g.dist + 14; z < end - 8; z += 3.2, i++) {
      var x = g.x * Math.max(0, 1 - i / 8) + Math.sin(i * 0.32) * 3;
      g.objects.push({ type: "gem", z: z, x: x, y: 0.7, gold: true });
      g.path.push({ z: z, x: x, jump: false });
    }
    g.nextZ = end + 35; g.lastJump = false;
  }
  // input: {steer: -1..1, jump: bool}; возвращает список событий
  function step(g, input, dt) {
    var events = [];
    if (g.over) return events;
    var s = spec(g.n, g.dist), from = g.dist, speed = s.speed * (g.rush ? 1.6 : 1);
    g.t += dt;
    g.x = Math.max(-LIMIT, Math.min(LIMIT, g.x + input.steer * SIDE * dt));
    g.roll += (input.steer * 0.35 - g.roll) * Math.min(1, dt * 10);
    if (input.jump && g.y === 0) { g.vy = JUMP; events.push("jump"); }
    if (g.y > 0 || g.vy > 0) {
      g.y += g.vy * dt; g.vy -= GRAVITY * dt;
      if (g.y <= 0) { g.y = 0; g.vy = 0; }
    }
    g.dist += speed * dt;
    g.score += speed * dt * (g.rush ? 3 : 1);
    g.safeTime = Math.max(0, g.safeTime - dt);
    // после форсажа и бонуса даётся немного неуязвимости, чтобы не влететь сразу в стену
    if (g.rush) { g.rush = Math.max(0, g.rush - dt); if (!g.rush) { g.safeTime = 1.4; events.push("rushEnd"); } }
    if (g.bonus) { g.bonus = Math.max(0, g.bonus - dt); if (!g.bonus) { g.safeTime = 1.4; events.push("bonusEnd"); } }
    for (var i = 0; i < g.objects.length; i++) {
      var o = g.objects[i];
      var half = (o.d || 0.8) / 2 + 0.6;
      if (o.z - half > g.dist) continue;
      var x = objectX(o, g.t), solid = o.type !== "gem" && o.type !== "portal";
      if (o.z + half < from) {
        // препятствие позади: пролетели впритирку или перепрыгнули — это комбо
        if (solid && !o.done) {
          o.done = true;
          var edge = Math.abs(g.x - x) - o.w / 2 - SHIP_W;
          if (!g.rush && !g.safeTime && (o.type === "bar" ? g.y > 0 : edge >= 0 && edge < 0.8)) {
            g.combo++; g.score += 50 * Math.min(g.combo, 10); events.push("near"); charge(g, 0.17, events);
          }
        }
        continue;
      }
      if (o.done) continue;
      if (o.type === "gem") {
        // на форсаже кристаллы притягиваются издалека
        if (Math.abs(g.x - x) < (g.rush ? 3 : g.bonus ? 1.5 : 1.1) && Math.abs(g.y + 0.5 - o.y) < (g.rush ? 3 : 1.1)) {
          o.done = o.taken = true; g.gems++; g.score += o.gold ? 150 : 100; events.push("gem"); charge(g, 0.07, events);
        }
      } else if (o.type === "portal") {
        if (Math.abs(g.x - x) < o.w / 2) { o.done = o.taken = true; g.score += 500; enterBonus(g, s.speed); events.push("bonus"); break; }
      } else if (Math.abs(g.x - x) < o.w / 2 + SHIP_W && g.y < o.h) {
        if (g.rush) { o.done = o.taken = true; g.score += 200; events.push({ smash: o, x: x }); }
        else if (!g.safeTime) {
          o.done = true; g.lives--; g.safeTime = 1.4; g.combo = 0; g.charge = 0; events.push("hit");
          if (g.lives <= 0) { g.over = { win: false }; events.push("lose"); return events; }
        }
      }
    }
    while (g.objects.length && g.objects[0].z < g.dist - 20) g.objects.shift();
    while (g.path.length > 2 && g.path[1].z < g.dist - 5) g.path.shift();
    fill(g);
    if (g.dist >= s.length) { g.over = { win: true, stars: g.lives }; events.push("win"); }
    return events;
  }

  var Core = { TOTAL: TOTAL, spec: spec, newGame: newGame, step: step, objectX: objectX, JUMP: JUMP, GRAVITY: GRAVITY };
  if (typeof module !== "undefined" && module.exports) { module.exports = Core; return; }

  /* ================= отрисовка ================= */
  var doc = root.document;
  var VS = "attribute vec3 p;attribute vec3 n;uniform mat4 proj;uniform vec3 pos,cam;uniform mediump vec3 size;uniform float roll,spin;uniform vec2 pivot;" +
    "varying vec3 vn;varying vec3 vl;varying float vz;" +
    "void main(){vec3 q=p*size;float c=cos(spin),s=sin(spin);q=vec3(c*q.x+s*q.z,q.y,c*q.z-s*q.x);vec3 m=vec3(c*n.x+s*n.z,n.y,c*n.z-s*n.x);" +
    "vec3 w=q+pos;c=cos(roll);s=sin(roll);vec2 r=w.xy-pivot;w.xy=pivot+vec2(c*r.x+s*r.y,c*r.y-s*r.x);" +
    "vn=m;vl=p;vz=-w.z;gl_Position=proj*vec4(w-cam,1.0);}";
  var FS = "precision mediump float;uniform vec3 color,edge,size;uniform float glow,alpha;varying vec3 vn;varying vec3 vl;varying float vz;" +
    "void main(){float l=0.45+0.55*max(0.0,dot(normalize(vn),normalize(vec3(0.35,0.85,0.45))));vec3 c=mix(color*l,color,glow);" +
    // светящиеся рёбра куба
    "vec3 d=(0.5-abs(vl))*size;vec3 a=abs(vn);float e=a.x>0.5?min(d.y,d.z):a.y>0.5?min(d.x,d.z):min(d.x,d.y);" +
    "c=mix(edge,c,smoothstep(0.03,0.09,e));" +
    "float f=clamp((vz-40.0)/130.0,0.0,1.0);gl_FragColor=vec4(mix(c,vec3(0.16,0.05,0.28),f),alpha*(1.0-f*f));}";

  function makeRenderer(canvas) {
    var gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    if (!gl) return null;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    var data = [];
    [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]].forEach(function (face) {
      var axis = face[0], sign = face[1], u = (axis + 1) % 3, v = (axis + 2) % 3;
      [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(function (c) {
        var p = [0, 0, 0], n = [0, 0, 0];
        p[axis] = 0.5 * sign; p[u] = 0.5 * c[0]; p[v] = 0.5 * c[1]; n[axis] = sign;
        data.push(p[0], p[1], p[2], n[0], n[1], n[2]);
      });
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    ["p", "n"].forEach(function (name, i) {
      var loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, i * 12);
    });
    var U = {};
    ["proj", "pos", "size", "cam", "roll", "spin", "pivot", "color", "edge", "glow", "alpha"].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    return {
      gl: gl,
      begin: function (cam, wide) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        var aspect = canvas.width / canvas.height, f = 1 / Math.tan(wide || 0.55), near = 0.5, far = 220;
        // горизонт поднят выше середины (смещение проекции), чтобы было видно дальше
        gl.uniformMatrix4fv(U.proj, false, [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, -0.2, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
        gl.uniform3fv(U.cam, cam);
      },
      box: function (pos, size, color, o) {
        o = o || {};
        gl.uniform3fv(U.pos, pos); gl.uniform3fv(U.size, size); gl.uniform3fv(U.color, color);
        gl.uniform3fv(U.edge, o.edge || color); gl.uniform1f(U.glow, o.glow || 0);
        gl.uniform1f(U.alpha, o.alpha == null ? 1 : o.alpha); gl.uniform1f(U.roll, o.roll || 0);
        gl.uniform1f(U.spin, o.spin || 0); gl.uniform2fv(U.pivot, o.pivot || [0, 0]);
        gl.drawArrays(gl.TRIANGLES, 0, 36);
      },
    };
  }

  var PINK = [1, 0.25, 0.55], CYAN = [0.2, 0.9, 1], VIOLET = [0.55, 0.4, 1], AMBER = [1, 0.75, 0.2], WHITE = [1, 1, 1];
  function hue(h) { // цвет радуги, h — любое число
    var k = function (n) { var t = (n + h * 6) % 6; if (t < 0) t += 6; return 1 - Math.max(0, Math.min(1, Math.min(t, 4 - t))) * 0.85; };
    return [k(5), k(3), k(1)];
  }
  var shards = []; // осколки разбитых на форсаже препятствий
  // огромный кубический кот, который выглядывает из-за горизонта в «Котомире»
  function drawCat(r, g) {
    var up = Math.min(1, (BONUS - g.bonus) / 1.4, g.bonus / 0.9), t = g.t;
    var K = 2.1, bx = Math.sin(t * 1.1) * 4, by = -30 + 43 * up + Math.sin(t * 5) * 0.8, z = -75;
    var fur = [1, 0.62, 0.18], dark = [0.75, 0.35, 0.08], white = [1, 0.95, 0.88], black = [0.08, 0.03, 0.1], pink = [1, 0.45, 0.65];
    var tilt = Math.sin(t * 2.5) * 0.14, pv = [bx, by];
    var box = function (x, y, dz, w, h, c, o) { o = o || {}; o.roll = tilt; o.pivot = pv; o.glow = o.glow == null ? 0.55 : o.glow; r.box([bx + x * K, by + y * K, z + dz], [w * K, h * K, 1.5], c, o); };
    box(0, 0, 0, 17, 13, fur, { edge: dark });
    [-1, 1].forEach(function (s) {
      box(s * 6, 7.8, 0, 4.6, 3, fur, { edge: dark }); box(s * 6.5, 10, 0, 2.6, 2, fur, { edge: dark }); box(s * 6, 7.8, 0.9, 2.2, 1.8, pink);
      var blink = t % 2.6 < 0.14;
      box(s * 4, 1.8, 1, 3.6, blink ? 0.4 : 3.8, white, { glow: 1 });
      if (!blink) { box(s * 4 + Math.sin(t * 1.7), 1.6, 1.9, 1.5, 2.6, black); box(s * 4 + Math.sin(t * 1.7) + 0.4, 2.4, 2.7, 0.5, 0.6, white, { glow: 1 }); }
      for (var w = -1; w <= 1; w++) box(s * 9.6, -2.4 + w * 1.5, 1, 5, 0.25, white, { glow: 1 });
      // лапы машут по очереди
      var wave = Math.max(0, Math.sin(t * 6 + (s > 0 ? Math.PI : 0))) * 3;
      box(s * 11, -7 + wave, 3, 4.4, 3.6, white, { edge: dark });
      box(s * 11, -7 + wave, 4, 1.8, 1.4, pink);
    });
    box(0, 5.2, 1, 1.2, 2.4, dark); box(-2.4, 5.4, 1, 1, 1.8, dark); box(2.4, 5.4, 1, 1, 1.8, dark);
    box(0, -3, 1, 8, 4.2, white, { edge: white });
    box(0, -1.6, 2, 2, 1.1, pink);
    box(0, -4.1, 2, 3.4, 1 + Math.abs(Math.sin(t * 7)) * 1.4, black); box(0, -4.6, 2.9, 1.8, 0.7, pink);
  }
  function draw(r, g) {
    var fast = g.rush ? Math.min(1, g.rush, (RUSH - g.rush) * 4) : 0;
    var shake = fast * 0.07;
    r.begin([g.x * 0.55 + (Math.random() - 0.5) * shake, 3.2 + g.y * 0.35 + (Math.random() - 0.5) * shake, 7], 0.55 + fast * 0.17);
    var d = g.dist, i, z, party = g.bonus > 0, wild = party || fast > 0;
    if (party) drawCat(r, g);
    r.box([0, -0.55, -90], [HALF * 2 + 0.6, 0.1, 200], [0.07, 0.05, 0.14], { glow: 1 });
    [-1, 1].forEach(function (s) { r.box([s * (HALF + 0.35), -0.35, -90], [0.18, 0.3, 200], wild ? hue(g.t * 0.8 + s * 0.25) : s < 0 ? PINK : CYAN, { glow: 1 }); });
    if (party) for (i = 0; i < 36; i++) { // радужная дорога
      z = -(i * 5 - (d % 5)) + 6;
      r.box([0, -0.49, z], [HALF * 2, 0.02, 5], hue((Math.floor(d / 5) + i) / 7), { glow: 1, alpha: 0.55 });
    }
    if (fast) for (i = 0; i < 26; i++) { // полосы скорости
      var side = i % 2 ? 1 : -1;
      z = -((i * 29 - d * 2.2) % 90 + 90) % 90 + 5;
      r.box([side * (5.5 + (i * 7) % 6), 0.3 + (i * 13) % 6, z], [0.07, 0.07, 5], hue(i / 9 + g.t), { glow: 1, alpha: 0.8 * fast });
    }
    // разметка и «города» по бокам бегут навстречу
    for (i = 0; i < 28; i++) {
      z = -(i * 7 - (d % 7)) + 6;
      r.box([0, -0.48, z], [HALF * 2, 0.02, 0.08], [0.3, 0.16, 0.5], { glow: 1 });
      [-1.7, 1.7].forEach(function (x) { r.box([x, -0.47, z - 3.5], [0.1, 0.02, 2.4], [0.45, 0.35, 0.75], { glow: 1 }); });
    }
    var first = Math.floor(d / 11);
    for (i = first; i < first + 18; i++) {
      z = -(i * 11 - d);
      [-1, 1].forEach(function (s) {
        var h = 2 + ((i * 37 + (s > 0 ? 11 : 0)) % 9), x = s * (10 + ((i * 53) % 7));
        if (party) h *= 0.7 + Math.abs(Math.sin(g.t * 6 + i)) * 0.7; // дома пляшут
        r.box([x, h / 2 - 2, z], [2.6, h, 2.6], [0.1, 0.06, 0.22], { edge: party ? hue(i / 5 + g.t) : (i + (s > 0 ? 1 : 0)) % 3 ? VIOLET : PINK });
      });
      if (i % 3 === 0) [-1, 1].forEach(function (s) { r.box([s * (HALF + 1.4), 0.5, z], [0.15, 2.2, 0.15], s < 0 ? PINK : CYAN, { glow: 1 }); });
    }
    var end = spec(g.n, d).length;
    if (end - d < 190) { // финишная арка
      z = -(end - d);
      [-1, 1].forEach(function (s) { r.box([s * (HALF + 0.3), 2, z], [0.5, 5, 0.5], AMBER, { glow: 1 }); });
      for (i = 0; i < 10; i++) r.box([-4.5 + i, 4.5, z], [1, 0.8, 0.4], i % 2 ? WHITE : [0.1, 0.1, 0.1], { glow: 1 });
    }
    // дальние предметы рисуем первыми
    for (i = g.objects.length - 1; i >= 0; i--) {
      var o = g.objects[i];
      z = -(o.z - d);
      if (o.taken || z < -190 || z > 6) continue;
      var x = objectX(o, g.t), a = z > 1.5 ? 0.25 : 1;
      if (o.type === "gem") r.box([x, o.y - 0.35 + Math.sin(g.t * 4 + o.z) * 0.12, z], [0.55, 0.55, 0.55], o.gold ? hue(o.z / 20) : [0.5, 1, 0.9], { edge: o.gold ? hue(o.z / 20 + 0.12) : WHITE, glow: o.gold ? 1 : 0.6, spin: g.t * 3 });
      else if (o.type === "portal") for (var k = 0; k < 14; k++) { // кольцо из вращающихся кубиков
        var an = (k / 14) * 6.283 + g.t * 2.5;
        r.box([x + Math.cos(an) * 1.7, 1.2 + Math.sin(an) * 1.7, z], [0.5, 0.5, 0.5], k % 2 ? AMBER : [1, 0.95, 0.6], { glow: 1, edge: WHITE, spin: an });
        if (k % 2) r.box([x + Math.cos(-an * 1.6) * 0.8, 1.2 + Math.sin(-an * 1.6) * 0.8, z], [0.28, 0.28, 0.28], hue(k / 14 + g.t), { glow: 1, spin: -an });
      }
      else if (o.type === "bar") r.box([x, o.h / 2 - 0.5, z], [o.w, o.h, o.d], [0.45, 0.28, 0.05], { edge: AMBER, alpha: a });
      else r.box([x, o.h / 2 - 0.5, z], [o.w, o.h, o.d], o.type === "mover" ? [0.08, 0.3, 0.42] : [0.38, 0.07, 0.25], { edge: o.type === "mover" ? CYAN : PINK, alpha: a });
    }
    for (i = shards.length - 1; i >= 0; i--) {
      var p = shards[i], age = g.t - p.born;
      if (age > 0.9 || age < 0) { shards.splice(i, 1); continue; }
      r.box([p.x + p.vx * age, p.y + p.vy * age - 9 * age * age, p.z + p.vz * age], [p.s, p.s, p.s], p.c, { glow: 0.8, edge: WHITE, spin: age * p.rate, alpha: 1 - age });
    }
    if (wild) for (i = 1; i <= 9; i++) // радужный шлейф
      r.box([g.x - g.roll * i * 0.25 + Math.sin(g.t * 14 - i) * 0.08, g.y - 0.05, 1 + i * 0.42], [0.75 - i * 0.06, 0.1, 0.4], hue(i / 7 - g.t * 2), { glow: 1, alpha: 0.9 - i * 0.085 });
    // корабль (после удара мигает)
    if (g.safeTime && !wild && Math.floor(g.t * 12) % 2) return;
    var y = g.y + Math.sin(g.t * 9) * 0.04, roll = g.roll, pv = [g.x, y];
    r.box([g.x, -0.48, 0], [1.5 / (1 + g.y), 0.02, 1.8 / (1 + g.y)], [0, 0, 0], { glow: 1, alpha: 0.5 });
    var part = function (px, py, pz, size, color, o) { o = o || {}; o.roll = roll; o.pivot = pv; r.box([g.x + px, y + py, pz], size, color, o); };
    part(0, 0, 0, [0.8, 0.32, 1.7], fast ? hue(g.t * 3) : [0.75, 0.78, 0.95], { edge: VIOLET, glow: fast * 0.7 });
    part(0, -0.02, -1.15, [0.42, 0.2, 0.65], [0.9, 0.92, 1], { edge: CYAN });
    part(0, 0.27, 0.1, [0.46, 0.26, 0.7], [0.1, 0.45, 0.65], { edge: CYAN });
    [-1, 1].forEach(function (s) {
      part(s * 0.68, -0.08, 0.35, [0.6, 0.12, 0.85], [0.35, 0.22, 0.75], { edge: PINK });
      part(s * 0.98, 0.1, 0.55, [0.1, 0.45, 0.45], [0.9, 0.2, 0.5], { glow: 0.5 });
      part(s * 0.24, -0.02, 0.95 + Math.random() * 0.12, [0.2, 0.16, 0.22 + Math.random() * 0.2], CYAN, { glow: 1, edge: WHITE });
    });
  }

  /* ================= экраны и управление ================= */
  var CSS = [
    ".rc{position:fixed;left:0;top:0;z-index:100;overflow:hidden;color:#fff;background:linear-gradient(#090418 0,#2b0c52 34%,#ff4f8b 40%,#3a0f5c 41%,#0a0517);touch-action:none;--l:12px;--r:12px;--t:10px;--b:10px;--w:100vw;--h:100vh;",
    "--l:calc(env(safe-area-inset-left,0px) + 12px);--r:calc(env(safe-area-inset-right,0px) + 12px);--b:calc(max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px)) + 10px);--t:calc(max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)) + 10px)}",
    // телефон держат вертикально: поворачиваем игру сами, отступы поворачиваются вместе с ней
    ".rc.rot{transform-origin:0 0;--l:calc(max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px)) + 12px);--r:calc(max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px)) + 12px);--t:10px;--b:10px}",
    ".rc-sun{position:absolute;left:50%;top:40%;width:calc(var(--h)*.44);height:calc(var(--h)*.22);margin:calc(var(--h)*-.22) 0 0 calc(var(--h)*-.22);border-radius:999px 999px 0 0;background:repeating-linear-gradient(transparent 0 11px,rgba(43,12,82,.9) 11px 15px),linear-gradient(#ffe36e,#ff4f8b)}",
    ".rc canvas{position:absolute;inset:0;width:100%;height:100%}",
    ".rc-btn{border:0;border-radius:14px;background:rgba(20,12,45,.75);color:#fff;font:inherit;font-weight:800;padding:10px 16px;outline-offset:3px}",
    ".rc-btn:active{transform:scale(.94)}",
    ".rc-btn.main{background:#ff3f86}",
    ".rc-hud{position:absolute;left:var(--l);right:var(--r);top:var(--t);display:flex;align-items:center;gap:14px;font-weight:800;text-shadow:0 2px 6px #000;font-size:18px}",
    ".rc-prog{flex:1;height:8px;border-radius:8px;background:rgba(255,255,255,.18);overflow:hidden}",
    ".rc-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3fe4ff,#ff3f86)}",
    ".rc-pad{position:absolute;bottom:var(--b);width:clamp(64px,calc(var(--h)*.22),110px);height:clamp(64px,calc(var(--h)*.22),110px);border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(20,12,45,.45);color:#fff;font-size:30px;display:flex;align-items:center;justify-content:center;touch-action:none}",
    ".rc-pad.on{background:rgba(255,63,134,.7)}",
    "@media (pointer:fine){.rc-pad{display:none}}",
    ".rc-menu{position:absolute;inset:0;display:flex;flex-direction:column;padding:var(--t) var(--r) var(--b) var(--l);gap:10px;overflow:auto;background:rgba(8,4,22,.72);touch-action:pan-x pan-y}",
    ".rc.rot .rc-menu{touch-action:none}",
    ".rc-top{display:flex;align-items:center;gap:10px}.rc-top h1{flex:1;font-size:clamp(20px,calc(var(--h)*.075),34px);font-style:italic}",
    ".rc-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;width:100%;max-width:680px;margin:auto}",
    ".rc-lv{height:clamp(44px,calc(var(--h)*.15),84px);border:2px solid #7a52ff;border-radius:14px;background:rgba(40,18,84,.85);color:#fff;font:inherit;font-weight:900;font-size:20px;outline-offset:3px}",
    ".rc-lv small{display:block;font-size:10px;color:#ffc54d;height:12px}.rc-lv:disabled{opacity:.35}",
    ".rc-row{display:flex;gap:10px;justify-content:center;align-items:center;flex-wrap:wrap;font-size:14px}",
    ".rc button:focus-visible{outline:3px solid #ffc54d}",
    ".rc-modal{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,4,22,.6)}",
    ".rc-box{background:#1b0f3a;border:2px solid #7a52ff;border-radius:22px;padding:16px 22px;text-align:center;min-width:260px}",
    ".rc-box h2{font-size:24px}.rc-box p{color:#b9acdf;margin:6px 0 12px}.rc-box .rc-row{flex-wrap:nowrap}",
    ".rc-stars{font-size:34px;color:#ffc54d}",
    ".rc-flash{position:absolute;inset:0;background:#ff2255;opacity:0;pointer-events:none}",
    ".rc-flash.on{animation:rc-flash .4s}",
    "@keyframes rc-flash{20%{opacity:.5}}",
    ".rc.rush{background:linear-gradient(#020a2b,#10357a 34%,#4ff7ff 40%,#152a6b 41%,#05081f)}",
    ".rc.party{background:linear-gradient(#26004d,#c5189a 30%,#ffe45c 40%,#7a1fa8 41%,#12002b)}",
    ".rc.party .rc-sun{display:none}",
    ".rc-score{font-variant-numeric:tabular-nums;color:#ffd66b}",
    ".rc-charge{position:absolute;left:50%;top:calc(var(--t) + 44px);width:min(38%,260px);height:9px;transform:translateX(-50%);border-radius:9px;background:rgba(255,255,255,.18);overflow:hidden}",
    ".rc-charge i{display:block;height:100%;width:100%;transform-origin:left;transform:scaleX(0);background:linear-gradient(90deg,#ffc54d,#ff3f86)}",
    ".rc.rush .rc-charge i{background:linear-gradient(90deg,#fff,#4ff7ff)}",
    ".rc-pop{position:absolute;left:0;right:0;top:33%;text-align:center;font-size:calc(var(--h)*.065);font-weight:900;font-style:italic;color:#ffe36e;text-shadow:0 0 14px #ff3f86,0 3px 6px #000;pointer-events:none;animation:rc-pop .75s forwards}",
    ".rc-banner{position:absolute;left:0;right:0;top:22%;text-align:center;font-weight:900;font-style:italic;font-size:calc(var(--h)*.15);line-height:1.05;text-shadow:0 0 20px #ff3f86,0 0 50px #7a52ff,0 5px 0 #3a0f5c;pointer-events:none;animation:rc-banner 1.8s forwards}",
    ".rc-banner small{display:block;font-size:.34em;color:#ffe36e}",
    // при входе в портал весь мир делает «бочку»
    ".rc.flip canvas{animation:rc-flip 1.1s cubic-bezier(.5,0,.3,1)}",
    "@keyframes rc-flip{0%{transform:rotate(0) scale(1)}50%{transform:rotate(180deg) scale(2.3)}100%{transform:rotate(360deg) scale(1)}}",
    "@keyframes rc-pop{0%{opacity:0;transform:scale(.4)}25%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:translateY(-40px)}}",
    "@keyframes rc-banner{0%{opacity:0;transform:scale(3) rotate(-8deg)}18%{opacity:1;transform:scale(.92) rotate(2deg)}28%{transform:none}80%{opacity:1}100%{opacity:0;transform:scale(1.2)}}",
    ".rc-count{position:absolute;left:0;right:0;top:30%;text-align:center;font-size:calc(var(--h)*.18);font-weight:900;font-style:italic;text-shadow:0 0 24px #ff3f86;pointer-events:none}",
  ].join("\n");

  var host, box, canvas, renderer, layer, G = null, screen = "menu", raf = 0, prev = 0, countdown = 0, paused = false, audio = null, hud = {}, level = 1;
  var keys = {}, pads = { left: 0, right: 0 }, jumpWanted = 0;
  var SAVE = "rey-racer", save = { stars: {}, best: 0, top: {}, all: false, mute: false };
  try { Object.assign(save, JSON.parse(root.localStorage.getItem(SAVE) || "{}")); } catch (e) {}
  function persist() { try { root.localStorage.setItem(SAVE, JSON.stringify(save)); } catch (e) {} }

  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, fn, cls) { var b = el("button", "rc-btn" + (cls ? " " + cls : ""), text); b.type = "button"; b.onclick = fn; return b; }
  function beep(freqs, step_, type, vol) {
    if (save.mute) return;
    try {
      audio = audio || new (root.AudioContext || root.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      freqs.forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * step_;
        o.type = type || "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(vol || 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + step_ * 2.2);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + step_ * 2.3);
      });
    } catch (e) {}
  }
  // скользящий тон: «мяу», рёв форсажа
  function slide(points, len, type, vol, delay) {
    if (save.mute) return;
    try {
      audio = audio || new (root.AudioContext || root.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + (delay || 0);
      o.type = type; o.frequency.setValueAtTime(points[0], t);
      points.slice(1).forEach(function (f, i) { o.frequency.exponentialRampToValueAtTime(f, t + (len * (i + 1)) / (points.length - 1)); });
      g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + len);
    } catch (e) {}
  }
  function meow(delay) { slide([520, 980, 880, 430], 0.55, "sawtooth", 0.09, delay); }
  function flash(cls, text, sub) {
    var b = el("div", cls, text);
    if (sub) b.append(el("small", null, sub));
    layer.append(b);
    setTimeout(function () { b.remove(); }, cls === "rc-pop" ? 780 : 1850);
  }
  function effect(e) {
    if (e.smash) {
      for (var i = 0; i < 18; i++) shards.push({ born: G.t, x: e.x + (Math.random() - 0.5) * e.smash.w, y: Math.random() * e.smash.h, z: -1, vx: (Math.random() - 0.5) * 16, vy: Math.random() * 12, vz: -Math.random() * 22, s: 0.2 + Math.random() * 0.45, rate: Math.random() * 14, c: i % 3 ? PINK : CYAN });
      beep([120, 70], 0.05, "square", 0.12); haptic("medium");
    } else if (e === "jump") { jumpWanted = 0; beep([300, 480], 0.05, "square", 0.05); }
    else if (e === "gem") { var up = Math.pow(1.06, G.bonus ? Math.min(24, G.gems % 25) : 0); beep([990 * up, 1320 * up], 0.05); }
    else if (e === "near") {
      if (hud.pop) hud.pop.remove();
      hud.pop = el("div", "rc-pop", (G.combo > 1 ? "Впритирку ×" + G.combo : "Впритирку!") + " +" + 50 * Math.min(G.combo, 10));
      layer.append(hud.pop);
      beep([600 + Math.min(G.combo, 12) * 90], 0.07, "square", 0.06); haptic("light");
    } else if (e === "rush") { flash("rc-banner", "ФОРСАЖ!", "круши всё на пути"); slide([90, 900], 0.8, "sawtooth", 0.11); haptic("heavy"); }
    else if (e === "bonus") {
      box.classList.remove("flip"); void box.offsetWidth; box.classList.add("flip");
      flash("rc-banner", "КОТОМИР!", "мяу?!");
      meow(0.15); meow(0.85); beep([523, 659, 784, 1047, 784, 1047, 1319], 0.1); haptic("win");
    } else if (e === "bonusEnd") { flash("rc-pop", "Кот помахал лапой 🐾"); meow(0); }
    else if (e === "hit") { beep([150, 90], 0.1, "sawtooth", 0.14); haptic("heavy"); hud.flash.classList.remove("on"); void hud.flash.offsetWidth; hud.flash.classList.add("on"); }
  }
  function haptic(kind) {
    try {
      var h = root.Telegram.WebApp.HapticFeedback;
      if (kind === "win" || kind === "lose") h.notificationOccurred(kind === "win" ? "success" : "error");
      else h.impactOccurred(kind);
    } catch (e) {}
  }

  // игра всегда горизонтальная
  function layout() {
    if (!box) return;
    var W = root.innerWidth, H = root.innerHeight, rot = H > W, w = rot ? H : W, h = rot ? W : H;
    box.classList.toggle("rot", rot);
    box.style.width = w + "px"; box.style.height = h + "px";
    box.style.transform = rot ? "translateX(" + W + "px) rotate(90deg)" : "";
    box.style.setProperty("--w", w + "px"); box.style.setProperty("--h", h + "px");
    var k = Math.min(root.devicePixelRatio || 1, 1.75);
    canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
    if (G && renderer) draw(renderer, G);
  }

  function clearLayer() { layer.replaceChildren(); }
  var stars = function (n) { return save.stars[n] || 0; };
  var unlocked = function (n) { return save.all || n === 1 || stars(n - 1) > 0 || stars(n) > 0; };
  function showMenu() {
    screen = "menu"; stopLoop(); clearInput(); shards = []; box.classList.remove("rush", "party", "flip");
    G = newGame(1, 1); G.objects = []; // фон меню — пустая трасса
    if (renderer) draw(renderer, G);
    clearLayer();
    var m = el("div", "rc-menu"), top = el("div", "rc-top");
    var mute = btn(save.mute ? "🔇" : "🔊", function () { save.mute = !save.mute; persist(); mute.textContent = save.mute ? "🔇" : "🔊"; });
    mute.setAttribute("aria-label", "Звук");
    top.append(btn("←", function () { api.onExit(); }), el("h1", null, "Неон-трасса"), mute);
    var grid = el("div", "rc-grid"), cur = 1;
    while (cur < TOTAL && stars(cur) > 0) cur++;
    for (var i = 1; i <= TOTAL; i++) (function (n) {
      var b = el("button", "rc-lv" + (n === cur ? " cur" : ""));
      b.type = "button"; b.disabled = !unlocked(n);
      b.append(el("span", null, unlocked(n) ? String(n) : "🔒"), el("small", null, "★★★".slice(0, stars(n))));
      b.onclick = function () { start(n); };
      grid.append(b);
    })(i);
    var row = el("div", "rc-row"), check = el("label"), c = el("input");
    c.type = "checkbox"; c.checked = save.all;
    c.onchange = function () { save.all = c.checked; persist(); showMenu(); };
    check.append(c, doc.createTextNode(" Открыть все уровни (для теста)"));
    row.append(btn("∞ Бесконечный заезд" + (save.best ? " · рекорд " + save.best + " м" : ""), function () { start(0); }, "main"), check);
    m.append(top, grid, row);
    layer.append(m);
  }

  function start(n) {
    if (!renderer) return;
    level = n; screen = "race"; paused = false; stopLoop(); clearInput(); clearLayer(); shards = []; box.classList.remove("rush", "party", "flip");
    G = newGame(n, (Date.now() % 1e9) | 0);
    var top = el("div", "rc-hud");
    hud.lives = el("span"); hud.info = el("span"); hud.gems = el("span");
    var prog = el("div", "rc-prog"); hud.bar = el("i"); prog.append(hud.bar);
    if (!n) prog.style.visibility = "hidden";
    var pause = btn("⏸", function () { setPause(true); }); pause.setAttribute("aria-label", "Пауза");
    hud.score = el("span", "rc-score"); hud.pop = null;
    var meter = el("div", "rc-charge"); hud.charge = el("i"); meter.append(hud.charge);
    top.append(pause, hud.lives, el("span", null, n ? "Ур. " + n : "∞"), prog, hud.info, hud.gems, hud.score);
    layer.append(meter);
    layer.append(top, pad("◀", "left", "left:var(--l)"), pad("▶", "right", "left:calc(var(--l) + clamp(74px,calc(var(--h)*.25),128px))"), pad("▲", "jump", "right:var(--r)"));
    hud.flash = el("div", "rc-flash"); hud.count = el("div", "rc-count");
    layer.append(hud.flash, hud.count);
    countdown = 3; beep([440], 0.1);
    updateHud(); doc.activeElement && doc.activeElement.blur();
    loop();
  }
  function pad(text, kind, style) {
    var p = el("div", "rc-pad", text);
    p.style.cssText = style;
    var held = {};
    var set = function (e, on) {
      e.preventDefault();
      if (on) held[e.pointerId] = 1; else delete held[e.pointerId];
      var active = Object.keys(held).length > 0;
      p.classList.toggle("on", active);
      if (kind === "jump") { if (on) jumpWanted = 0.18; }
      else pads[kind] = active ? 1 : 0;
    };
    p.onpointerdown = function (e) { try { p.setPointerCapture(e.pointerId); } catch (x) {} set(e, true); };
    p.onpointerup = p.onpointercancel = p.onlostpointercapture = function (e) { set(e, false); };
    return p;
  }
  function clearInput() { keys = {}; pads.left = pads.right = 0; jumpWanted = 0; }
  function updateHud() {
    var s = spec(G.n, G.dist);
    hud.lives.textContent = "❤".repeat(Math.max(0, G.lives)) + "♡".repeat(3 - Math.max(0, G.lives));
    hud.info.textContent = G.n ? Math.min(100, Math.floor((G.dist / s.length) * 100)) + "%" : Math.floor(G.dist) + " м";
    hud.gems.textContent = "💎 " + G.gems;
    hud.score.textContent = Math.floor(G.score);
    hud.charge.style.transform = "scaleX(" + (G.rush ? G.rush / RUSH : G.charge) + ")";
    box.classList.toggle("rush", G.rush > 0); box.classList.toggle("party", G.bonus > 0);
    if (G.n) hud.bar.style.width = Math.min(100, (G.dist / s.length) * 100) + "%";
  }
  function stopLoop() { if (raf) root.cancelAnimationFrame(raf); raf = 0; }
  function loop() { prev = 0; raf = root.requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    if (screen !== "race" || paused || !G) return;
    var dt = prev ? Math.min(0.05, (now - prev) / 1000) : 0;
    prev = now;
    if (countdown > 0) {
      var before = Math.ceil(countdown);
      countdown -= dt;
      var left = Math.ceil(countdown);
      if (left !== before) beep([left > 0 ? 440 : 880], 0.12);
      hud.count.textContent = left > 0 ? left : "";
    } else {
      var steer = (pads.right || keys.ArrowRight || keys.KeyD ? 1 : 0) - (pads.left || keys.ArrowLeft || keys.KeyA ? 1 : 0);
      var input = { steer: steer, jump: jumpWanted > 0 };
      jumpWanted = Math.max(0, jumpWanted - dt); // нажатие чуть раньше приземления тоже засчитывается
      var left_ = dt, events = [];
      while (left_ > 0) { var d = Math.min(left_, 1 / 120); events = events.concat(step(G, input, d)); left_ -= d; }
      events.forEach(effect);
      updateHud();
    }
    draw(renderer, G);
    if (G.over) return finish();
    raf = root.requestAnimationFrame(frame);
  }
  function modal(title, text, buttons, extra) {
    var m = el("div", "rc-modal"), b = el("div", "rc-box"), row = el("div", "rc-row");
    b.append(el("h2", null, title));
    if (extra) b.append(extra);
    b.append(el("p", null, text));
    buttons.forEach(function (x) { row.append(x); });
    b.append(row); m.append(b); layer.append(m);
    return m;
  }
  function setPause(on) {
    if (screen !== "race" || !G || G.over || on === paused) return;
    paused = on; clearInput();
    if (on) {
      stopLoop();
      hud.modal = modal("Пауза", level ? "Уровень " + level : "Бесконечный заезд", [btn("Продолжить", function () { setPause(false); }, "main"), btn("Заново", function () { start(level); }), btn("В меню", showMenu)]);
    } else { hud.modal.remove(); loop(); }
  }
  function finish() {
    var o = G.over, n = G.n, meters = Math.floor(G.dist);
    screen = "result"; clearInput();
    var score = Math.floor(G.score), top = save.top[n] || 0;
    if (score > top) { save.top[n] = score; persist(); }
    var buttons = [], title, text = "Очки: " + score + (score > top && top ? " — рекорд!" : top ? " (рекорд " + top + ")" : "") + " · 💎 " + G.gems, extra = null;
    if (o.win) {
      if (o.stars > stars(n)) { save.stars[n] = o.stars; persist(); }
      title = n === TOTAL ? "Все трассы пройдены!" : "Финиш!";
      extra = el("div", "rc-stars", "★".repeat(o.stars) + "☆".repeat(3 - o.stars));
      if (n < TOTAL) buttons.push(btn("Дальше", function () { start(n + 1); }, "main"));
      beep([523, 659, 784, 1047], 0.12); haptic("win");
    } else {
      title = "Авария";
      if (!n) { var record = meters > save.best; if (record) { save.best = meters; persist(); } text = meters + " м" + (record ? " — новый рекорд!" : " · рекорд " + save.best + " м") + " · " + text; }
      else text = "Пройдено " + Math.floor((G.dist / spec(n).length) * 100) + "% · " + text;
      beep([330, 247, 165], 0.16, "sawtooth", 0.07); haptic("lose");
    }
    buttons.push(btn("Заново", function () { start(n); }, o.win ? "" : "main"), btn("В меню", showMenu));
    modal(title, text, buttons, extra);
  }

  function visible() { return !!box && box.isConnected && !host.closest("[hidden]"); }
  function onKey(e) {
    if (!box || !visible() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.type === "keyup") { delete keys[e.code]; return; }
    var back = e.code === "Escape" || e.code === "Backspace", done = true;
    var list = Array.prototype.slice.call(layer.querySelectorAll((layer.querySelector(".rc-modal") ? ".rc-modal " : "") + "button:not(:disabled)"));
    if (back) { if (!e.repeat) { if (screen === "menu") api.onExit(); else if (screen === "race" && !paused) setPause(true); else showMenu(); } }
    else if (screen === "race" && !paused) {
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { if (!e.repeat) jumpWanted = 0.18; }
      else if (e.code === "KeyP") setPause(true);
      else if (e.code === "KeyR") { if (!e.repeat) start(level); }
      else if (/^(ArrowLeft|ArrowRight|KeyA|KeyD)$/.test(e.code)) keys[e.code] = true;
      else done = false;
    } else if (paused && e.code === "KeyP") setPause(false);
    else {
      var move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: screen === "menu" ? -5 : -1, ArrowDown: screen === "menu" ? 5 : 1 }[e.code];
      if (!move) done = false;
      else {
        var i = list.indexOf(doc.activeElement);
        var next = i < 0 ? list.filter(function (b) { return b.classList.contains("cur") || b.classList.contains("main"); })[0] || list[0] : list[Math.max(0, Math.min(list.length - 1, i + move))];
        if (next) next.focus();
      }
    }
    if (done) e.preventDefault();
  }

  var api = {
    onExit: function () {},
    open: function (container, onExit) {
      if (!doc.getElementById("rc-css")) { var st = el("style"); st.id = "rc-css"; st.textContent = CSS; doc.head.append(st); }
      host = container; api.onExit = onExit;
      box = el("div", "rc"); canvas = el("canvas"); layer = el("div");
      box.append(el("div", "rc-sun"), canvas, layer);
      host.replaceChildren(box);
      renderer = null;
      try { renderer = makeRenderer(canvas); } catch (e) { console.log("racer:", e.message); }
      canvas.addEventListener("webglcontextlost", function (e) { if (e.target !== canvas || !renderer) return; e.preventDefault(); stopLoop(); renderer = null; clearLayer(); modal("Графика сбросилась", "Откройте игру заново.", [btn("Выйти", function () { api.onExit(); }, "main")]); });
      layout(); showMenu(); layout();
      if (!renderer) { clearLayer(); modal("3D недоступно", "Этот браузер не поддерживает WebGL.", [btn("Назад", function () { api.onExit(); }, "main")]); }
      // где браузер разрешает, дополнительно закрепляем горизонтальную ориентацию
      try { var p = root.screen.orientation.lock("landscape"); if (p) p.catch(function () {}); } catch (e) {}
    },
    // кнопка «Назад»: гонка → пауза → меню; false — выходить из игры
    back: function () {
      if (screen === "menu") return false;
      if (screen === "race" && !paused) setPause(true); else showMenu();
      return true;
    },
    close: function () {
      stopLoop(); screen = "menu"; G = null; clearInput();
      try { root.screen.orientation.unlock(); } catch (e) {}
      if (renderer) { var lose = renderer.gl.getExtension("WEBGL_lose_context"); renderer = null; if (box) box.remove(); if (lose) lose.loseContext(); }
      if (box) box.remove();
      box = null;
    },
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("keyup", onKey);
  root.addEventListener("blur", clearInput);
  doc.addEventListener("visibilitychange", function () { if (doc.hidden && box) setPause(true); });
  root.addEventListener("resize", layout);
  root.ReyRacer = api;
})(typeof window !== "undefined" ? window : this);
