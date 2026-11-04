/* Joshua Paddock — portfolio. The site works with JavaScript turned off;
   this only fills in the footer year and draws the background. */

(function () {
  "use strict";

  /* ---- Footer year ---- */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ---- Background: a dim point-cloud terrain ----
     A grid of points over gently rolling ground, seen in perspective and
     drifting slowly toward the viewer, like a LiDAR scan. Points are
     coloured by height (blue lows, orange peaks), a faint scan ring pulses
     outward every few seconds, and the whole layer dims once you scroll
     past the top of the page. With reduced motion it is a still frame. */
  function initTerrain() {
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return;
    canvas.className = "terrain";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);

    var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    var LOW = [2, 151, 222], HIGH = [252, 115, 77];   // --blue, --orange
    var CAM_H = 1.3;                // camera height above the ground
    var NEAR = 1.5, FAR = 17;       // depth range drawn
    var ROW_STEP = 0.42;            // ground distance between scan lines
    var DOT_GAP = 7;                // screen px between points on a line
    var SPEED = 0.22;               // drift toward the viewer, units per second
    var RING = 8;                   // seconds between scan pulses
    var STRENGTH = 0.62;            // overall brightness at the top of the page
    var DIMMED = 0.4;               // ...and once scrolled past the hero
    var COLOURS = 6, ALPHAS = 10;   // draw buckets

    var W = 0, H = 0, dpr = 1, focal = 0, horizon = 0;
    var t0 = performance.now(), last = 0;
    var buckets = [];
    for (var b = 0; b < COLOURS * ALPHAS; b++) buckets.push([]);
    var styles = [];
    for (var c = 0; c < COLOURS; c++) {
      var k = c / (COLOURS - 1);
      var rgb = LOW.map(function (v, i) { return Math.round(v + (HIGH[i] - v) * k); }).join(",");
      for (var a = 0; a < ALPHAS; a++) styles.push("rgba(" + rgb + "," + ((a + 1) / ALPHAS).toFixed(2) + ")");
    }

    function hash(x, y) {
      var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function noise(x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      var p = hash(xi, yi), q = hash(xi + 1, yi), r = hash(xi, yi + 1), s = hash(xi + 1, yi + 1);
      return p + (q - p) * u + (r - p) * v + (p - q - r + s) * u * v;
    }
    function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      focal = Math.max(W, H * 0.9) * 0.62;
      horizon = H * 0.5;
      draw((performance.now() - t0) / 1000);
    }

    function draw(t) {
      var i, n;
      for (i = 0; i < buckets.length; i++) buckets[i].length = 0;

      var travel = t * SPEED, depth = FAR - NEAR;
      var ring = (t % RING) / RING * FAR * 1.15;
      var rows = Math.ceil(depth / ROW_STEP);
      var cols = Math.ceil(W / DOT_GAP);

      for (var r = 0; r < rows; r++) {
        // Each row is one scan line, fixed to the ground and wrapping from front to back
        var z = NEAR + ((r * ROW_STEP - travel) % depth + depth) % depth;
        var zw = z + travel;
        var fog = smooth(FAR, FAR * 0.6, z);
        if (fog <= 0) continue;
        var ground = horizon + CAM_H / z * focal;
        if (ground - 1.2 / z * focal > H + 4) continue;
        var size = Math.min(2.6, Math.max(1.4, 6 / z)) * dpr;
        for (var col = 0; col <= cols; col++) {
          // Beams are evenly spaced across the screen, like a scanner's fixed angles
          var sx = (col + 0.5 * (r & 1)) * DOT_GAP;
          var x = (sx - W / 2) * z / focal;
          var h = 0.62 * noise(x * 0.16 + 40, zw * 0.16) + 0.38 * noise(x * 0.42 - 7, zw * 0.42 + 13);
          var sy = ground - (h - 0.3) * 1.6 / z * focal;
          if (sy < 0 || sy > H + 4) continue;

          var dist = Math.sqrt(x * x + z * z), dr = (dist - ring) / 0.6;
          var pulse = reduceMotion ? 0 : Math.exp(-dr * dr) * 0.5;
          var alpha = fog * (0.3 + 0.8 * h * h + pulse) * STRENGTH;
          var heat = smooth(0.5, 0.74, h);

          var ci = Math.round(heat * (COLOURS - 1));
          var ai = Math.min(ALPHAS - 1, Math.floor(alpha * ALPHAS));
          buckets[ci * ALPHAS + ai].push(sx * dpr, sy * dpr, size);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (i = 0; i < buckets.length; i++) {
        var list = buckets[i];
        if (!list.length) continue;
        ctx.fillStyle = styles[i];
        for (n = 0; n < list.length; n += 3) ctx.fillRect(list[n] - list[n + 2] / 2, list[n + 1] - list[n + 2] / 2, list[n + 2], list[n + 2]);
      }
    }

    // Dim the whole layer as the hero scrolls away
    function onScroll() {
      var k = Math.min(1, window.scrollY / (H * 0.8 || 1));
      canvas.style.opacity = String(1 - (1 - DIMMED) * k);
    }

    function loop(now) {
      requestAnimationFrame(loop);
      if (now - last < 33) return;   // ~30 fps is plenty
      last = now;
      draw((now - t0) / 1000);
    }

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    });
    window.addEventListener("scroll", onScroll, { passive: true });

    resize();
    onScroll();
    if (!reduceMotion) requestAnimationFrame(loop);
  }

  initTerrain();
})();
