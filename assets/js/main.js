/* Joshua Paddock — portfolio. Progressive enhancements only:
   the site works with JavaScript turned off. */

(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

  /* ---- Theme toggle (light / dark), remembered per visitor ---- */
  var toggle = document.querySelector(".theme-toggle");
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function currentTheme() {
    var set = root.getAttribute("data-theme");
    if (set) return set;
    return darkQuery && darkQuery.matches ? "dark" : "light";
  }
  function announceTheme() { document.dispatchEvent(new CustomEvent("themechange")); }

  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) { /* storage blocked: fine */ }
      announceTheme();
    });
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener("change", announceTheme);

  /* ---- Project filter chips ----
     Each card lists its disciplines in data-tags="mech elec ml ctrl".
     Each chip has data-filter="all" or one of those keys. */
  var chips = document.querySelectorAll(".chip[data-filter]");
  var cards = document.querySelectorAll(".card[data-tags]");

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var f = chip.getAttribute("data-filter");
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
      cards.forEach(function (card) {
        var tags = (card.getAttribute("data-tags") || "").split(/\s+/);
        card.hidden = !(f === "all" || tags.indexOf(f) !== -1);
      });
    });
  });

  /* ---- Footer year ---- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---- Nav: mark the section currently in view (home page only) ---- */
  var navLinks = document.querySelectorAll('.nav a[href^="#"]');
  if (navLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    navLinks.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.removeAttribute("aria-current"); });
        if (byId[e.target.id]) byId[e.target.id].setAttribute("aria-current", "true");
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main > section[id]").forEach(function (s) { spy.observe(s); });
  }

  /* ---- Pixel backdrop ----
     Square specks on a fixed grid, clustered with value noise like a sparse
     point cloud, with faint registration crosses. A slow scan line sweeps
     down the screen now and then, a few specks blink, and specks near the
     mouse light up. Colours come from the CSS tokens --speck, --speck-hi
     and --speck-alpha, so it follows the theme. */
  function initBackdrop() {
    var canvas = document.createElement("canvas");
    if (!canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.className = "backdrop";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);

    var layer = document.createElement("canvas");
    var lctx = layer.getContext("2d");

    var CELL = 8;        // grid pitch, CSS px
    var DOT = 2;         // speck size, CSS px
    var LEVELS = 8;      // brightness buckets for the static layer
    var CROSS = 14;      // registration cross every N cells
    var SWEEP = 7;       // seconds for the scan line to cross the screen
    var PERIOD = 18;     // seconds between scans
    var HALO = 130;      // pointer radius, CSS px

    var dpr = 1, W = 0, H = 0, cols = 0, rows = 0;
    var X = [], Y = [], LV = [], HI = [], rowStart = new Int32Array(1), twinkles = [];
    var col = { base: "150,172,196", hi: "124,200,255", a: 0.5 };
    var pointer = null;
    var t0 = performance.now(), last = 0, raf = 0;

    function hash(x, y, s) {
      var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    function noise(x, y, s) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    function readColors() {
      var cs = getComputedStyle(root);
      function rgb(name, fallback) {
        var v = cs.getPropertyValue(name).trim();
        return v ? v.split(/\s+/).join(",") : fallback;
      }
      col.base = rgb("--speck", col.base);
      col.hi = rgb("--speck-hi", col.hi);
      col.a = parseFloat(cs.getPropertyValue("--speck-alpha")) || col.a;
    }

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = layer.width = Math.round(W * dpr);
      canvas.height = layer.height = Math.round(H * dpr);
      cols = Math.ceil(W / CELL) + 1; rows = Math.ceil(H / CELL) + 1;

      // Specks are keyed to their grid cell, so the pattern is stable across resizes.
      X = []; Y = []; LV = []; HI = []; rowStart = new Int32Array(rows + 1);
      for (var r = 0; r < rows; r++) {
        rowStart[r] = X.length;
        for (var c = 0; c < cols; c++) {
          var d = 0.7 * noise(c / 26, r / 26, 1) + 0.3 * noise(c / 7, r / 7, 2);
          if (hash(c, r, 3) >= 0.02 + 0.5 * smoothstep(0.45, 0.85, d)) continue;
          X.push(c); Y.push(r);
          LV.push(Math.min(LEVELS - 1, Math.floor((0.3 + 0.7 * hash(c, r, 4)) * d * LEVELS * 1.25)));
          HI.push(hash(c, r, 5) < 0.06 ? 1 : 0);
        }
      }
      rowStart[rows] = X.length;

      twinkles = [];
      var n = X.length, count = Math.min(240, Math.floor(n / 35));
      for (var i = 0; i < count; i++) {
        twinkles.push({ i: Math.floor(hash(i, 7, 6) * n), phase: hash(i, 8, 6) * 6.283, speed: 0.5 + hash(i, 9, 6) * 1.1 });
      }
      paintLayer();
    }

    function paintLayer() {
      var s = Math.max(1, Math.round(DOT * dpr)), step = CELL * dpr, n = X.length;
      lctx.clearRect(0, 0, layer.width, layer.height);
      for (var b = 0; b < LEVELS; b++) {
        for (var h = 0; h < 2; h++) {
          var alpha = col.a * (0.12 + 0.5 * (b + 1) / LEVELS) * (h ? 1.5 : 1);
          lctx.fillStyle = "rgba(" + (h ? col.hi : col.base) + "," + alpha.toFixed(3) + ")";
          for (var i = 0; i < n; i++) {
            if (LV[i] === b && HI[i] === h) lctx.fillRect(Math.round(X[i] * step), Math.round(Y[i] * step), s, s);
          }
        }
      }
      // Registration crosses, like the marks on a machine bed
      var arm = Math.round(4 * dpr), t = Math.max(1, Math.round(dpr));
      lctx.fillStyle = "rgba(" + col.base + "," + (col.a * 0.45).toFixed(3) + ")";
      for (var gy = CROSS / 2; gy < rows; gy += CROSS) {
        for (var gx = CROSS / 2; gx < cols; gx += CROSS) {
          var cx = Math.round(gx * step), cy = Math.round(gy * step);
          lctx.fillRect(cx - arm, cy, arm * 2 + t, t);
          lctx.fillRect(cx, cy - arm, t, arm * 2 + t);
        }
      }
      draw((performance.now() - t0) / 1000);
    }

    function draw(t) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(layer, 0, 0);
      if (reduceMotion) return;

      var s = Math.max(1, Math.round(DOT * dpr)), step = CELL * dpr, i, j, r;
      ctx.fillStyle = "rgb(" + col.hi + ")";

      // Blinking specks
      for (i = 0; i < twinkles.length; i++) {
        var tw = twinkles[i], a = Math.sin(t * tw.speed + tw.phase);
        if (a <= 0.3) continue;
        ctx.globalAlpha = (a - 0.3) * col.a * 1.1;
        ctx.fillRect(Math.round(X[tw.i] * step), Math.round(Y[tw.i] * step), s, s);
      }

      // Scan line with a fading trail
      var phase = t % PERIOD;
      if (phase < SWEEP) {
        var TRAIL = 140, sy = (phase / SWEEP) * (H + TRAIL) - 10;
        ctx.globalAlpha = col.a * 0.18;
        ctx.fillRect(0, Math.round(sy * dpr), canvas.width, Math.max(1, Math.round(dpr)));
        var r0 = Math.max(0, Math.floor((sy - TRAIL) / CELL)), r1 = Math.min(rows - 1, Math.ceil((sy + 8) / CELL));
        for (r = r0; r <= r1; r++) {
          var dy = sy - r * CELL, k = dy >= 0 ? 1 - dy / TRAIL : 1 + dy / 8;
          if (k <= 0) continue;
          ctx.globalAlpha = k * k * col.a * 1.3;
          for (j = rowStart[r]; j < rowStart[r + 1]; j++) ctx.fillRect(Math.round(X[j] * step), Math.round(r * step), s, s);
        }
      }

      // Pointer halo
      if (pointer) {
        var pr0 = Math.max(0, Math.floor((pointer.y - HALO) / CELL)), pr1 = Math.min(rows - 1, Math.ceil((pointer.y + HALO) / CELL));
        for (r = pr0; r <= pr1; r++) {
          var ddy = r * CELL - pointer.y;
          for (j = rowStart[r]; j < rowStart[r + 1]; j++) {
            var ddx = X[j] * CELL - pointer.x, d2 = ddx * ddx + ddy * ddy;
            if (d2 >= HALO * HALO) continue;
            var f = 1 - Math.sqrt(d2) / HALO;
            ctx.globalAlpha = f * f * col.a * 1.4;
            ctx.fillRect(Math.round(X[j] * step), Math.round(r * step), s, s);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;   // ~30 fps is plenty for this
      last = now;
      draw((now - t0) / 1000);
    }

    readColors();
    build();

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(build, 150);
    });
    document.addEventListener("themechange", function () { readColors(); paintLayer(); });

    if (reduceMotion) return;
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      pointer = { x: e.clientX, y: e.clientY };
    }, { passive: true });
    document.addEventListener("mouseout", function (e) { if (!e.relatedTarget) pointer = null; });
    raf = requestAnimationFrame(loop);
  }

  /* ---- Hero arm sketch ----
     A planar model of the SO-101 follower (shoulder, elbow, wrist, gripper)
     solved with closed-form two-link inverse kinematics. Left alone it runs a
     pick-and-place loop; point at it to teleoperate, click to grip.
     Units are SVG units, read as millimetres; +y is up from the shoulder. */
  function initRig() {
    var rig = document.querySelector("[data-rig]");
    if (!rig) return;
    var view = rig.querySelector(".rig-view");
    var svg = view && view.querySelector("svg");
    if (!svg) return;
    function el(id) { return document.getElementById(id); }
    var j1 = el("arm-j1"), j2 = el("arm-j2"), j3 = el("arm-j3");
    var jawA = el("arm-jaw-a"), jawB = el("arm-jaw-b");
    var cubeEl = el("arm-cube"), trailEl = el("arm-trail"), targetEl = el("arm-target");
    var modeEl = rig.querySelector("[data-rig-mode]");
    var ro = { q1: el("ro-q1"), q2: el("ro-q2"), q3: el("ro-q3"), grip: el("ro-grip"), tcp: el("ro-tcp"), ep: el("ro-ep") };
    if (!j1 || !j2 || !j3) return;

    var VB_W = 520, VB_H = 340;           // viewBox
    var SX = 170, SY = 250;               // shoulder, in viewBox coords
    var L1 = 130, L2 = 120;               // upper arm, forearm
    var LT = 40;                          // wrist joint → tool centre point
    var HOLD = 4;                         // TCP → block centre while held
    var REST = -41;                       // block centre resting on the table
    var GRASP = REST + HOLD;              // TCP height when grasping
    var HOVER = 40, HOME = { x: 150, y: 90 };
    var OPEN = 15, ON_BLOCK = 9, SHUT = 3;  // half-gap between jaws
    var DOWN = -Math.PI / 2;
    var SPOTS = [120, 220];
    var DEG = 180 / Math.PI;

    function ik(x, y, phi) {
      var wx = x - LT * Math.cos(phi), wy = y - LT * Math.sin(phi);
      var r = Math.sqrt(wx * wx + wy * wy), max = L1 + L2 - 1, min = 30;
      if (r > max) { wx *= max / r; wy *= max / r; r = max; }
      else if (r < min) { wx = r ? wx * min / r : min; wy = r ? wy * min / r : 0; r = min; }
      var a2 = -Math.acos(clamp((r * r - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1));  // elbow up
      var a1 = Math.atan2(wy, wx) - Math.atan2(L2 * Math.sin(a2), L1 + L2 * Math.cos(a2));
      return [a1, a2, phi - a1 - a2];
    }
    function fk(q) {
      var a = q[0], b = q[0] + q[1], p = b + q[2];
      return {
        x: L1 * Math.cos(a) + L2 * Math.cos(b) + LT * Math.cos(p),
        y: L1 * Math.sin(a) + L2 * Math.sin(b) + LT * Math.sin(p),
        phi: p
      };
    }

    var q = ik(HOME.x, HOME.y, DOWN), grip = OPEN;
    var cmd = { x: HOME.x, y: HOME.y, phi: DOWN, g: OPEN };
    var block = { x: SPOTS[0], y: REST, rot: 0, vy: 0, held: false };
    var steps = [], si = 0, st = null, episode = 0;
    var tele = null, releaseTimer = 0;
    var trail = [], lastReadout = 0;

    // A fresh plan from wherever the block is now: pick it up (unless it is
    // already held), carry it to the other spot, set it down, go home.
    function plan() {
      var a = block.x;
      var b = Math.abs(a - SPOTS[0]) > Math.abs(a - SPOTS[1]) ? SPOTS[0] : SPOTS[1];
      var pick = [
        { x: a, y: HOVER }, { g: OPEN }, { x: a, y: GRASP }, { g: ON_BLOCK, pick: true }, { x: a, y: HOVER }
      ];
      var place = [
        { x: b, y: HOVER }, { x: b, y: GRASP }, { g: OPEN, place: b }, { x: b, y: HOVER },
        { x: HOME.x, y: HOME.y }, { wait: 1.6 }
      ];
      steps = block.held ? place : pick.concat(place);
      si = 0; st = null;
    }

    function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }

    function runPlan(dt) {
      if (si >= steps.length) plan();
      var s = steps[si];
      if (!st) {
        st = { t: 0, x: cmd.x, y: cmd.y, g: cmd.g };
        st.dur = s.x != null ? Math.max(0.5, Math.hypot(s.x - cmd.x, s.y - cmd.y) / 130) : (s.wait || 0.45);
      }
      st.t += dt;
      var k = Math.min(1, st.t / st.dur), e = ease(k);
      if (s.x != null) { cmd.x = st.x + (s.x - st.x) * e; cmd.y = st.y + (s.y - st.y) * e; }
      if (s.g != null) cmd.g = st.g + (s.g - st.g) * e;
      cmd.phi = DOWN;
      if (k < 1) return;
      if (s.pick) block.held = true;
      if (s.place != null) { block.held = false; block.x = s.place; block.y = REST; block.rot = 0; episode++; }
      st = null; si++;
    }

    function update(dt) {
      if (tele) {
        cmd.x = clamp(tele.x, 52, 248);
        cmd.y = clamp(tele.y, GRASP, 200);
        cmd.phi = DOWN + (Math.PI / 2 - 0.3) * smoothstep(30, 190, cmd.y);  // tilt forward when reaching high
        cmd.g = tele.grip ? (block.held ? ON_BLOCK : SHUT) : OPEN;
      } else if (!reduceMotion) {
        runPlan(dt);
      }

      var goal = ik(cmd.x, cmd.y, cmd.phi);
      var rate = 1 - Math.exp(-dt * (tele ? 10 : 16));
      for (var i = 0; i < 3; i++) {
        var d = goal[i] - q[i];
        q[i] += Math.atan2(Math.sin(d), Math.cos(d)) * rate;
      }
      grip += (cmd.g - grip) * (1 - Math.exp(-dt * 14));

      var p = fk(q);
      var gx = p.x + HOLD * Math.cos(p.phi), gy = p.y + HOLD * Math.sin(p.phi);  // between the jaws

      // Teleop grasp: closing the jaws around the block picks it up
      if (tele && tele.grip && !block.held && grip < ON_BLOCK + 1 && Math.hypot(gx - block.x, gy - block.y) < 11) {
        block.held = true;
      }
      if (block.held) {
        block.x = gx; block.y = gy; block.rot = p.phi - DOWN; block.vy = 0;
        if (tele && !tele.grip) block.held = false;   // let go
      } else if (block.y > REST) {
        block.vy -= 1400 * dt;                         // drop it
        block.y = Math.max(REST, block.y + block.vy * dt);
        block.rot *= 0.85;
        if (block.y === REST) { block.vy = 0; block.rot = 0; }
      }

      var tx = SX + p.x, ty = SY - p.y, prev = trail[trail.length - 1];
      if (!prev || Math.abs(prev[0] - tx) + Math.abs(prev[1] - ty) > 2) {
        trail.push([tx, ty]);
        if (trail.length > 70) trail.shift();
      }
      return p;
    }

    function f(n) { return n.toFixed(2); }
    function render(p, now) {
      j1.setAttribute("transform", "rotate(" + f(-q[0] * DEG) + ")");
      j2.setAttribute("transform", "translate(" + L1 + " 0) rotate(" + f(-q[1] * DEG) + ")");
      j3.setAttribute("transform", "translate(" + L2 + " 0) rotate(" + f(-q[2] * DEG) + ")");
      jawA.setAttribute("transform", "translate(0 " + f(-grip) + ")");
      jawB.setAttribute("transform", "translate(0 " + f(grip) + ")");
      cubeEl.setAttribute("transform", "translate(" + f(SX + block.x) + " " + f(SY - block.y) + ") rotate(" + f(-block.rot * DEG) + ")");
      if (tele) targetEl.setAttribute("transform", "translate(" + f(SX + tele.x) + " " + f(SY - tele.y) + ")");
      trailEl.setAttribute("d", trail.length > 1 ? "M" + trail.map(function (pt) { return f(pt[0]) + " " + f(pt[1]); }).join("L") : "");

      if (now - lastReadout > 90) {
        lastReadout = now;
        var deg = function (a) { var v = a * DEG; return (v < 0 ? "−" : "") + Math.abs(v).toFixed(1) + "°"; };
        ro.q1.textContent = deg(q[0]);
        ro.q2.textContent = deg(q[1]);
        ro.q3.textContent = deg(q[2]);
        ro.grip.textContent = Math.round(grip * 2) + " mm";
        ro.tcp.textContent = Math.round(p.x) + ", " + Math.round(p.y);
        ro.ep.textContent = ("00" + episode).slice(-3);
      }
    }

    function setTele(on) {
      if (!!tele === on) return;
      rig.classList.toggle("is-teleop", on);
      if (modeEl) modeEl.textContent = on ? "Teleop" : "Auto · pick & place";
      if (!on) {
        tele = null;
        var p = fk(q);
        cmd.x = p.x; cmd.y = p.y;
        plan();
      }
    }
    function toLocal(e) {
      var r = svg.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * VB_W / r.width - SX,
        y: SY - (e.clientY - r.top) * VB_H / r.height
      };
    }
    // Taking control keeps hold of the block if the arm is carrying it;
    // mouse down closes the jaws, mouse up opens them.
    function aim(e) {
      clearTimeout(releaseTimer);
      var at = toLocal(e);
      if (!tele) { setTele(true); tele = { grip: block.held }; }
      tele.x = at.x; tele.y = at.y;
    }

    view.addEventListener("pointermove", function (e) {
      if (e.pointerType === "mouse" || tele) aim(e);
    });
    view.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      aim(e);
      if (e.pointerType === "mouse") tele.grip = true;
    });
    view.addEventListener("pointerup", function (e) {
      if (!tele) return;
      if (e.pointerType === "mouse") { tele.grip = false; return; }
      releaseTimer = setTimeout(function () { setTele(false); }, 1600);
    });
    view.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse") setTele(false);
    });
    view.addEventListener("pointercancel", function () { setTele(false); });

    // Only animate while the panel is on screen
    var visible = true, raf = 0, prevT = 0;
    function frame(now) {
      raf = 0;
      if (!visible) return;
      var dt = prevT ? Math.min(0.05, (now - prevT) / 1000) : 0.016;
      prevT = now;
      render(update(dt), now);
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf) { prevT = 0; raf = requestAnimationFrame(frame); } }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start();
      }).observe(rig);
    }

    plan();
    start();
  }

  initBackdrop();
  initRig();
})();
