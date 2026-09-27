// Вафельное полотенце: одна ячейка ткани = один пиксель картинки.
// Картинка рисуется в низком разрешении (cols × rows), квантуется в палитру
// и растягивается CSS-ом без сглаживания. Поверх — текстура вафли.
(() => {
  "use strict";

  const towel = document.querySelector(".towel");
  const cloth = towel.querySelector(".cloth");
  const scene = cloth.querySelector("canvas.scene");
  const weave = cloth.querySelector(".weave");
  const fringeTop = towel.querySelector("canvas.fringe.top");
  const fringeBottom = towel.querySelector("canvas.fringe.bottom");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ——— цвет ———
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const smooth = (e0, e1, v) => { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const ramp = (stops, t) => {
    t = clamp01(t) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    return mix(stops[i], stops[i + 1], t - i);
  };

  // Палитра «дешёвой фотопечати на вафле»: насыщенно, но без кислоты.
  const PALETTE = [
    // небо
    "#1b56ad", "#2468c2", "#2f7bd0", "#4290dc", "#5ea6e4", "#7dbbec", "#9fcff3", "#c3e2f8", "#e4f2fc", "#ffffff",
    "#b4c9e2", "#8fabd0", "#dfe7f0",
    // море
    "#123f8c", "#1a52a6", "#2567b9", "#3380cb", "#4c9ad8", "#6db6e2", "#93d0ea", "#bfe6f1",
    // волна, пальмы
    "#0d4a1f", "#16652a", "#1f8233", "#35a03a", "#5dbb3c", "#93d23f", "#c9e04a", "#efe25a", "#fff08a",
    // песок
    "#fdf8ee", "#f6ead3", "#ecdcbc", "#dcc59c", "#c4a577", "#a4845a", "#cfd8d6",
    // ракушки
    "#fcd9a0", "#f5b866", "#ec9443", "#dc6e2e", "#c0501f", "#963c19", "#6c2a12", "#44190a", "#f49a78", "#e7bf8f",
    // дельфины, чайки
    "#3e3a44", "#5d5760", "#80797f", "#a8a1a3", "#cdc6c0",
    // принт и текст
    "#1c2a5c", "#2d3f7c", "#fffaf0", "#c7302b", "#e8473b", "#ff6a55", "#ffd23f", "#ffb02e", "#ff9ab5",
    "#f2c29b", "#d8956c", "#5a3320", "#2a1a14", "#101010", "#e9d29a", "#c9a45e",
  ].map(hex);

  // ——— шум ———
  const hash = (x, y, s) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, s, oct = 4) => {
    let t = 0, amp = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { t += amp * vnoise(x * f, y * f, s + i * 31); n += amp; amp *= 0.5; f *= 2; }
    return t / n;
  };
  const rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ——— состояние ———
  let S = null;          // текущая раскладка
  let photo = null;      // загруженное фото владелицы
  let timer = 0;

  const photoEl = cloth.querySelector('[data-px="photo"]');
  if (photoEl && photoEl.dataset.src) {
    const img = new Image();
    img.onload = () => { photo = img; build(); };
    img.src = photoEl.dataset.src;
  }

  function measure() {
    towel.style.width = "";
    const avail = Math.floor(Math.min(towel.getBoundingClientRect().width, 960));
    const cell = avail >= 560 ? 6 : avail >= 400 ? 5 : 4;
    const cols = Math.floor(avail / cell);
    towel.style.setProperty("--cell", cell + "px");
    towel.style.width = cols * cell + "px";
    cloth.style.height = "auto";
    const rows = Math.ceil(cloth.getBoundingClientRect().height / cell);
    cloth.style.height = rows * cell + "px";
    const origin = cloth.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - origin.left) / cell, y: (r.top - origin.top) / cell, w: r.width / cell, h: r.height / cell };
    };
    const marks = [...cloth.querySelectorAll("[data-px]")].map((el) => ({ el, kind: el.dataset.px, r: rect(el) }));
    const find = (k) => marks.find((m) => m.kind === k);
    return {
      cell, cols, rows, marks,
      horizon: Math.round(find("horizon").r.y),
      shore: Math.round(find("shore").r.y),
      vista: find("vista").r,
      shells: find("shells").r,
    };
  }

  // ——— фон: небо, облака, море, прибой, песок (попиксельно) ———
  const SKY = ["#1b56ad", "#2468c2", "#3a88d6", "#6fb2e8", "#a9d6f4"].map(hex);
  const SEA = ["#123f8c", "#1a52a6", "#2567b9", "#3380cb", "#4c9ad8", "#6db6e2", "#93d0ea"].map(hex);
  const WHITE = hex("#ffffff"), CLOUD_SHADE = hex("#8fabd0"), FOAM = hex("#fdf8ee");
  const SHALLOW = hex("#93d0ea"), DEEP = hex("#123f8c");
  const SAND = ["#f6ead3", "#fdf8ee", "#f6ead3"].map(hex), SAND_WET = hex("#dcc59c"), SAND_WET_DARK = hex("#c4a577");
  const SURF_PERIOD = 6;

  function skyColor(x, y, L) {
    const t = y / L.horizon;
    let c = ramp(SKY, t);
    const band = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.1;
    const dens = fbm(x * 0.055, y * 0.12, 7, 5) + band;
    const cl = smooth(0.54, 0.64, dens);
    if (cl > 0) {
      const up = fbm(x * 0.055, (y - 2) * 0.12, 7, 5) + band;
      const shade = clamp01(0.45 + (dens - up) * 9);
      c = mix(c, mix(WHITE, CLOUD_SHADE, shade * 0.8), cl);
    }
    return c;
  }

  function seaColor(x, y, L, t) {
    const k = (y - L.horizon) / Math.max(1, L.shore - L.horizon);
    let c = ramp(SEA, Math.pow(clamp01(k), 0.8));
    const streak = fbm(x * 0.045 - t * 0.9, y * 0.55, 3, 3);
    if (streak > 0.6) c = mix(c, SHALLOW, (streak - 0.6) * 1.8);
    if (streak < 0.34) c = mix(c, DEEP, (0.34 - streak) * 1.4);
    const cap = fbm(x * 0.13 - t * 1.6, y * 0.9 + t * 0.15, 11, 2);
    if (cap > 0.74) c = mix(c, WHITE, Math.min(1, (cap - 0.74) * 6));
    return c;
  }

  // где в столбце x кончается вода в момент t: волна накатывает и уходит
  const surf = (t) => 0.5 - 0.5 * Math.cos((t / SURF_PERIOD) * Math.PI * 2);
  const edgeWobble = (x, t) => Math.sin(x * 0.16 + t * 0.5) * 1.3 + (fbm(x * 0.12, t * 0.2, 5, 2) - 0.5) * 4;
  const waterEdge = (x, L, t) => L.shore - 4 + surf(t) * 9 + edgeWobble(x, t);
  const maxReach = (x, L) => L.shore + 5.5 + Math.sin(x * 0.16) * 1.3 + (fbm(x * 0.12, 0, 5, 2) - 0.5) * 3;

  function beachColor(x, y, L, t) {
    const e = waterEdge(x, L, t);
    const d = y - e;
    if (d < 0) {
      let c = mix(seaColor(x, y, L, t), SHALLOW, smooth(-9, 0, d));
      const lace = fbm(x * 0.4, y * 0.7 - t * 0.6, 17, 2);
      const foam = Math.max(smooth(-2.4, -0.3, d), lace > 0.64 && d > -7 ? 0.85 : 0);
      return mix(c, FOAM, foam);
    }
    const grain = fbm(x * 0.4, y * 0.4, 21, 2);
    let c = ramp(SAND, grain);
    const reach = maxReach(x, L);
    if (y < reach) {
      // мокрый песок сохнет не сразу
      const wet = 0.85 * (1 - smooth(reach - 3, reach, y)) * (0.55 + 0.45 * (1 - smooth(0, 4, d)));
      c = mix(c, d < 2 ? SAND_WET_DARK : SAND_WET, wet);
    } else if (y < reach + 1.2 && fbm(x * 0.5, 3, 9, 2) > 0.5) {
      c = mix(c, WHITE, 0.6); // кружево от прошлой волны
    }
    if (hash(x, y, 99) > 0.994) c = SAND_WET;
    return c;
  }

  function bgColor(x, y, L, t) {
    if (y < L.horizon) return skyColor(x, y, L);
    if (y < L.shore - 14) return seaColor(x, y, L, t);
    return beachColor(x, y, L, t);
  }

  // ——— векторные слои, прибитые к сетке без сглаживания ———
  function stampInto(canvas, draw, into, kinds, kind, oy = 0) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    draw(ctx);
    ctx.restore();
    const src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const off = oy * canvas.width;
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      if (src[i + 3] >= 120) {
        const q = (p + off) * 4;
        into[q] = src[i]; into[q + 1] = src[i + 1]; into[q + 2] = src[i + 2]; into[q + 3] = 255;
        if (kinds) kinds[p + off] = kind;
      }
    }
  }

  function palm(ctx, x0, y0, ang, len, droop, seed) {
    const r = rng(seed);
    const greens = ["#16652a", "#1f8233", "#35a03a", "#5dbb3c", "#93d23f"];
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = ang + droop * t * t;
      const prev = pts[i - 1] || { x: x0, y: y0 };
      pts.push({ x: prev.x + Math.cos(a) * len / 24, y: prev.y + Math.sin(a) * len / 24, a });
    }
    ctx.lineCap = "round";
    for (let i = 2; i < pts.length; i += 2) {
      const t = i / 24, p = pts[i];
      const leaf = len * 0.42 * (0.35 + Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.75);
      for (const side of [-1, 1]) {
        const la = p.a + side * (0.95 - t * 0.35) + droop * 0.25;
        const ex = p.x + Math.cos(la) * leaf, ey = p.y + Math.sin(la) * leaf + leaf * 0.35;
        ctx.strokeStyle = side > 0 ? greens[Math.floor(r() * 2) + 3] : greens[Math.floor(r() * 2)];
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo((p.x + ex) / 2, (p.y + ey) / 2 - leaf * 0.12, ex, ey);
        ctx.stroke();
        if (r() > 0.55) {
          ctx.strokeStyle = r() > 0.5 ? "#c9e04a" : "#93d23f";
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + (ex - p.x) * 0.55, p.y + (ey - p.y) * 0.55);
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = "#5dbb3c";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function dolphin(ctx, x, y, L, rot, flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(flip ? -1 : 1, 1);
    const body = ctx.createLinearGradient(0, -L * 0.3, 0, L * 0.1);
    body.addColorStop(0, "#3e3a44"); body.addColorStop(0.6, "#80797f"); body.addColorStop(1, "#cdc6c0");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(L * 0.45, -L * 0.3, L * 0.98, -L * 0.02);
    ctx.lineTo(L * 1.14, -L * 0.16);
    ctx.lineTo(L * 1.08, L * 0.02);
    ctx.lineTo(L * 1.16, L * 0.15);
    ctx.lineTo(L * 0.96, L * 0.07);
    ctx.quadraticCurveTo(L * 0.5, L * 0.02, L * 0.1, L * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3e3a44";
    ctx.beginPath();
    ctx.moveTo(L * 0.42, -L * 0.19);
    ctx.lineTo(L * 0.52, -L * 0.36);
    ctx.lineTo(L * 0.6, -L * 0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(L * 0.3, L * 0.02);
    ctx.lineTo(L * 0.36, L * 0.16);
    ctx.lineTo(L * 0.44, L * 0.03);
    ctx.fill();
    ctx.restore();
  }

  function wave(ctx, cx, cy, w, h, seed, t) {
    const r = rng(seed);
    const lift = 1 + Math.sin(t * 1.4 + seed) * 0.12;
    cx += Math.sin(t * 0.7 + seed) * 2.2;
    const hh = h * lift;
    const g = ctx.createLinearGradient(cx - w / 2, cy - hh, cx + w / 2, cy + hh / 2);
    g.addColorStop(0, "#fff08a"); g.addColorStop(0.3, "#c9e04a"); g.addColorStop(0.65, "#35a03a"); g.addColorStop(1, "#16652a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + hh * 0.35);
    ctx.bezierCurveTo(cx - w * 0.3, cy - hh * 0.9, cx + w * 0.2, cy - hh * 1.05, cx + w / 2, cy - hh * 0.1);
    ctx.bezierCurveTo(cx + w * 0.3, cy + hh * 0.1, cx, cy + hh * 0.5, cx - w / 2, cy + hh * 0.35);
    ctx.fill();
    // пена бежит по гребню
    for (let i = 0; i < w * 1.6; i++) {
      const p = (r() + t * 0.06) % 1;
      const jitter = r(), size = r(), tint = r(), spread = r();
      const px = cx - w / 2 + p * w + (jitter - 0.5) * 3;
      const crest = cy - hh * (0.95 * Math.sin(Math.PI * Math.min(1, p * 1.05))) + hh * 0.2;
      const py = crest + (spread - 0.3) * hh * 0.5 * (p > 0.7 ? 2 : 1);
      ctx.fillStyle = tint > 0.25 ? "#ffffff" : "#bfe6f1";
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + size * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // прыжок дельфина: выныривает, летит дугой, уходит под воду с брызгами
  function dolphinJump(ctx, j, t) {
    const u = (((t - j.offset) % j.period) + j.period) % j.period / j.air;
    const splash = (sx, k, seed) => {
      if (k <= 0 || k > 1) return;
      const r = rng(seed);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(sx, j.water, 2 + (1 - k) * 4, 0.9, 0, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI * (0.1 + r() * 0.8), sp = (1 - k) * (3 + r() * 5);
        ctx.fillStyle = r() > 0.3 ? "#ffffff" : "#bfe6f1";
        ctx.fillRect(sx + Math.cos(a) * sp, j.water + Math.sin(a) * sp * 1.3 + (1 - k) * (1 - k) * 4, 1, 1);
      }
    };
    splash(j.x0, 1 - u / 0.3, j.seed);
    splash(j.x0 + j.span, 1 - (u - 0.95) / 0.3, j.seed + 1);
    if (u > 1) return;
    const x = j.x0 + j.span * u;
    const y = j.water - j.height * 4 * u * (1 - u);
    const ang = Math.atan2(-j.height * 4 * (1 - 2 * u), j.span);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, 1e4, j.water + 0.4); ctx.clip();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(-1, 1);
    dolphin(ctx, 0, 0, j.len, 0, false);
    ctx.restore();
  }

  // ракушки
  function scallop(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (1.08 + (i / n) * 0.84), a1 = Math.PI * (1.08 + ((i + 1) / n) * 0.84);
      ctx.fillStyle = i % 2 ? "#ec9443" : "#f5b866";
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, s, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = "#963c19"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(0, 0, s, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.fillStyle = "#c0501f";
    ctx.fillRect(-s * 0.28, -s * 0.05, s * 0.56, s * 0.22);
    ctx.restore();
  }
  function conch(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createLinearGradient(-s, -s, s, s);
    g.addColorStop(0, "#fcd9a0"); g.addColorStop(0.45, "#ec9443"); g.addColorStop(1, "#963c19");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const r = s * (0.42 - i * 0.08);
      ctx.fillStyle = i % 2 ? "#dc6e2e" : "#f5b866";
      ctx.beginPath(); ctx.arc(-s * (0.9 + i * 0.32), -s * 0.05, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "#6c2a12"; ctx.lineWidth = 0.8;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(-s * 0.7, i * s * 0.18); ctx.quadraticCurveTo(0, i * s * 0.3, s * 0.6, i * s * 0.12); ctx.stroke();
    }
    ctx.fillStyle = "#f49a78";
    ctx.beginPath(); ctx.ellipse(s * 0.35, s * 0.1, s * 0.45, s * 0.28, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function star(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = "#dc6e2e";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2, r = i % 2 ? s * 0.38 : s;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#f5b866";
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 / 5) * i - Math.PI / 2;
      for (let k = 0.3; k < 0.9; k += 0.25) {
        ctx.fillRect(Math.cos(a) * s * k - 0.4, Math.sin(a) * s * k - 0.4, 0.9, 0.9);
      }
    }
    ctx.restore();
  }
  function pebble(ctx, x, y, s, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const g = ctx.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
    g.addColorStop(0, "#fcd9a0"); g.addColorStop(0.6, "#e7bf8f"); g.addColorStop(1, "#a4845a");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6c2a12"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-s * 0.85, 0); ctx.quadraticCurveTo(0, s * 0.3, s * 0.85, -s * 0.05); ctx.stroke();
    ctx.restore();
  }

  // Подложки под текст — часть рисунка: облако в небе, отмель в море, голый песок на пляже
  function bumps(ctx, x, y, w, h, seed, big, small, grow) {
    const r = rng(seed);
    ctx.beginPath();
    ctx.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, 3);
    for (let px = x + 1; px < x + w; px += big * (0.8 + r() * 0.5)) {
      ctx.moveTo(px + big, y); ctx.arc(px, y + big * 0.35, big * (0.6 + r() * 0.5) + grow, 0, Math.PI * 2);
    }
    for (let py = y + 2; py < y + h - 1; py += small * 1.4) {
      const a = small * (0.7 + r() * 0.5) + grow;
      ctx.moveTo(x + a, py); ctx.arc(x, py, a, 0, Math.PI * 2);
      const b2 = small * (0.7 + r() * 0.5) + grow;
      ctx.moveTo(x + w + b2, py); ctx.arc(x + w, py, b2, 0, Math.PI * 2);
    }
    for (let px = x + 2; px < x + w - 1; px += small * 1.6) {
      const a = small * (0.5 + r() * 0.4) + grow;
      ctx.moveTo(px + a, y + h); ctx.arc(px, y + h, a, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function printPatch(ctx, r, kind, seed) {
    const x = r.x, y = r.y, w = r.w, h = r.h;
    if (kind === "cloud") {
      ctx.fillStyle = "#9fcff3";
      ctx.save(); ctx.translate(0.8, 1.8); bumps(ctx, x, y, w, h, seed, 5, 2.6, 0.4); ctx.restore();
      ctx.fillStyle = "#e4f2fc";
      bumps(ctx, x, y, w, h, seed, 5, 2.6, 0);
      ctx.fillStyle = "#ffffff";
      bumps(ctx, x + 1, y + 0.5, w - 2.5, h - 2, seed, 4.2, 2, 0);
    } else if (kind === "lagoon") {
      ctx.fillStyle = "#ffffff";
      bumps(ctx, x, y, w, h, seed, 2.4, 2, 0.8);
      ctx.fillStyle = "#93d0ea";
      bumps(ctx, x + 0.8, y + 0.8, w - 1.6, h - 1.6, seed + 1, 1.6, 1.4, 0);
      ctx.fillStyle = "#bfe6f1";
      ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 3); ctx.fill();
      const rr = rng(seed + 2);
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < (w + h) * 0.5; i++) {
        const side = rr(), t = rr();
        const px = side < 0.5 ? x + t * w : (side < 0.75 ? x + 1 : x + w - 2);
        const py = side < 0.25 ? y + 1 : side < 0.5 ? y + h - 2 : y + t * h;
        ctx.fillRect(px, py, 1, 1);
      }
    } else if (kind === "island") {
      const isle = (g, c) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2 + 3 + g, h / 2 + 3.5 + g, 0, 0, Math.PI * 2); ctx.fill();
        bumps(ctx, x + 2, y, w - 4, h, seed, 3.4, 3, g - 0.6);
      };
      isle(2.2, "#ffffff"); isle(1.2, "#93d0ea"); isle(0.3, "#dcc59c"); isle(-0.5, "#f6ead3");
      // пальмочка на краю острова
      const px = x + 3.5, base = y + h * 0.5;
      ctx.fillStyle = "#35a03a";
      ctx.beginPath(); ctx.ellipse(px, base + 1, 3.2, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8a4b1f"; ctx.lineWidth = 1.3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(px, base); ctx.quadraticCurveTo(px - 1.5, (base + y) / 2 - 2, px + 0.5, y - 3); ctx.stroke();
      ctx.lineWidth = 1.2;
      for (const [dx, dy, c] of [[-5, 2.2, "#1f8233"], [5, 2.4, "#35a03a"], [-3.8, -1.8, "#5dbb3c"], [3.8, -1.6, "#1f8233"], [0.5, -3.5, "#5dbb3c"]]) {
        ctx.strokeStyle = c;
        ctx.beginPath(); ctx.moveTo(px + 0.5, y - 3); ctx.quadraticCurveTo(px + 0.5 + dx * 0.5, y - 3 + dy - 1.5, px + 0.5 + dx, y - 3 + dy); ctx.stroke();
      }
      ctx.fillStyle = "#6b3a17"; ctx.fillRect(px, y - 2.5, 1, 1); ctx.fillRect(px + 1, y - 2, 1, 1);
    } else if (kind === "mattress") {
      ctx.fillStyle = "#1a52a6"; ctx.beginPath(); ctx.roundRect(x - 1, y - 0.5, w + 4, h + 4, 4); ctx.fill();
      ctx.fillStyle = "#ffb02e"; ctx.beginPath(); ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 4); ctx.fill();
      ctx.fillStyle = "#fff08a"; ctx.beginPath(); ctx.roundRect(x - 1, y - 1, w + 2, h + 2, 3); ctx.fill();
      ctx.fillStyle = "#efe25a";
      for (let yy = y + 3; yy < y + h - 1; yy += 5) ctx.fillRect(x + 6, yy, w - 6, 1);
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.roundRect(x - 1, y - 1, 6, h + 2, 3); ctx.fill();
      ctx.fillStyle = "#ffb02e"; ctx.fillRect(x + 5, y - 1, 1, h + 2);
      ctx.fillStyle = "#e8473b"; ctx.beginPath(); ctx.arc(x + w - 1, y + 1, 1.2, 0, Math.PI * 2); ctx.fill();
    } else if (kind === "note") {
      ctx.fillStyle = "#1a52a6"; ctx.fillRect(x, y - 1, w + 2, h + 4);
      ctx.fillStyle = "#fdf8ee"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = "#ecdcbc"; ctx.fillRect(x - 1, y - 1, 1, h + 2); ctx.fillRect(x + w, y - 1, 1, h + 2);
      for (const ry of [y - 4, y + h]) {
        ctx.fillStyle = "#c4a577"; ctx.beginPath(); ctx.roundRect(x - 2.5, ry, w + 5, 3.4, 1.7); ctx.fill();
        ctx.fillStyle = "#e7bf8f"; ctx.fillRect(x - 2, ry + 0.8, w + 4, 1.2);
        ctx.fillStyle = "#fcd9a0"; ctx.fillRect(x - 1.5, ry + 0.8, w + 3, 0.6);
      }
      // бутылка, из которой достали записку
      ctx.save(); ctx.translate(x + w - 6, y - 7); ctx.rotate(-0.35);
      ctx.fillStyle = "#16652a"; ctx.beginPath(); ctx.roundRect(-8, -2.6, 12, 5.2, 2.4); ctx.fill();
      ctx.fillStyle = "#35a03a"; ctx.beginPath(); ctx.roundRect(-7.5, -2.2, 11, 4.4, 2); ctx.fill();
      ctx.fillStyle = "#1f8233"; ctx.fillRect(3.5, -1.2, 4, 2.4);
      ctx.fillStyle = "#c4a577"; ctx.fillRect(7.3, -1.2, 1.8, 2.4);
      ctx.fillStyle = "#93d23f"; ctx.fillRect(-6, -1.6, 7, 0.8);
      ctx.restore();
    } else if (kind === "raft") {
      ctx.fillStyle = "#1a52a6"; ctx.fillRect(x - 3, y - 1, w + 9, h + 5);
      for (let yy = y - 2.5; yy < y + h + 1.5; yy += 4) {
        ctx.fillStyle = "#c4a577"; ctx.beginPath(); ctx.roundRect(x - 4, yy, w + 8, 3.8, 1.9); ctx.fill();
        ctx.fillStyle = "#ecdcbc"; ctx.fillRect(x - 3, yy + 0.5, w + 6, 2.4);
        ctx.fillStyle = "#f6ead3"; ctx.fillRect(x - 3, yy + 0.5, w + 6, 0.8);
        for (const ex of [x - 4, x + w + 4]) {
          ctx.fillStyle = "#e7bf8f"; ctx.beginPath(); ctx.arc(ex, yy + 1.9, 1.9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#a4845a"; ctx.fillRect(ex - 0.4, yy + 1.5, 1, 1);
        }
      }
      ctx.fillStyle = "#963c19";
      for (const rx of [x - 1.5, x + w + 0.5]) ctx.fillRect(rx, y - 2.5, 1.2, h + 5);
    } else if (kind === "surf") {
      const cy = y + h / 2;
      const board = () => {
        ctx.beginPath();
        ctx.moveTo(x - 7, cy);
        ctx.bezierCurveTo(x - 7, y - 9, x + w * 0.75, y - 9, x + w + 14, cy);
        ctx.bezierCurveTo(x + w * 0.75, y + h + 9, x - 7, y + h + 9, x - 7, cy);
      };
      ctx.save(); ctx.translate(1, 1.5); ctx.fillStyle = "#1a52a6"; board(); ctx.fill(); ctx.restore();
      ctx.fillStyle = "#2567b9"; board(); ctx.fill();
      ctx.save(); ctx.translate(0, 0); ctx.scale(1, 1);
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath();
      ctx.moveTo(x - 6, cy);
      ctx.bezierCurveTo(x - 6, y - 8, x + w * 0.75, y - 8, x + w + 12, cy);
      ctx.bezierCurveTo(x + w * 0.75, y + h + 8, x - 6, y + h + 8, x - 6, cy);
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = "#e8473b"; ctx.fillRect(x - 4.5, y - 5, 1.6, h + 10);
      ctx.fillStyle = "#ffd23f"; ctx.fillRect(x - 2.4, y - 5, 1.2, h + 10);
      ctx.fillStyle = "#e8473b"; ctx.fillRect(x + w + 4, y - 5, 1.2, h + 10);
      ctx.fillStyle = "#e4f2fc"; ctx.fillRect(x - 6, cy - 0.3, w + 18, 0.7);
      ctx.restore();
    } else if (kind === "boat") {
      const hull = (g) => {
        const cy = y + h / 2, top = y - 5 + g, bot = y + h + 5 - g;
        ctx.beginPath();
        ctx.moveTo(x - 7 + g, cy);
        ctx.bezierCurveTo(x - 7 + g, top - 1, x + w * 0.2, top, x + w * 0.55, top);
        ctx.bezierCurveTo(x + w * 0.85, top, x + w + 9 - g, cy - h * 0.2, x + w + 13 - g * 1.5, cy);
        ctx.bezierCurveTo(x + w + 9 - g, cy + h * 0.2, x + w * 0.85, bot, x + w * 0.55, bot);
        ctx.bezierCurveTo(x + w * 0.2, bot, x - 7 + g, bot + 1, x - 7 + g, cy);
      };
      // вёсла
      ctx.strokeStyle = "#a4845a"; ctx.lineWidth = 1.2;
      for (const s2 of [-1, 1]) {
        const oy = s2 < 0 ? y - 4 : y + h + 4;
        ctx.beginPath(); ctx.moveTo(x + w * 0.35, oy); ctx.lineTo(x + w * 0.2, oy + s2 * 8); ctx.stroke();
        ctx.fillStyle = "#c4a577"; ctx.beginPath(); ctx.ellipse(x + w * 0.17, oy + s2 * 9.5, 1.4, 2.4, 0.3 * s2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.save(); ctx.translate(1, 1.5); ctx.fillStyle = "#1a52a6"; hull(0); ctx.fill(); ctx.restore();
      ctx.fillStyle = "#c0501f"; hull(0); ctx.fill();
      ctx.fillStyle = "#ecdcbc"; hull(1.5); ctx.fill();
      ctx.save(); hull(1.5); ctx.clip();
      ctx.fillStyle = "#f6ead3";
      for (let yy = y - 2; yy < y + h + 3; yy += 3) ctx.fillRect(x - 8, yy, w + 20, 1);
      ctx.fillStyle = "#a4845a";
      ctx.fillRect(x - 3, y - 6, 1.8, h + 12);
      ctx.fillRect(x + w + 3, y - 6, 1.8, h + 12);
      ctx.restore();
    }
  }

  function ribbon(ctx, r) {
    const x = Math.round(r.x) - 2, y = Math.round(r.y), w = Math.round(r.w) + 4, h = Math.round(r.h);
    const n = Math.max(2, Math.round(h * 0.35));
    ctx.fillStyle = "#963c19";
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 2); ctx.lineTo(x + 3, y + 2); ctx.lineTo(x + 3, y + h + 2); ctx.lineTo(x - 4, y + h + 2); ctx.lineTo(x - 4 + n, y + 2 + h / 2);
    ctx.moveTo(x + w + 4, y + 2); ctx.lineTo(x + w - 3, y + 2); ctx.lineTo(x + w - 3, y + h + 2); ctx.lineTo(x + w + 4, y + h + 2); ctx.lineTo(x + w + 4 - n, y + 2 + h / 2);
    ctx.fill();
    ctx.fillStyle = "#e8473b";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#c7302b";
    ctx.fillRect(x, y + h - 1, w, 1);
  }

  // ——— сувенирный магнит: литая рамка с фаской, приклеенные ракушки, блик на фото ———
  const magnetWindow = (r) => ({ x: r.x + 5, y: r.y + 5, w: r.w - 10, h: r.h - 10 });

  function magnetPhoto(ctx, r) {
    const { x: ix, y: iy, w: iw, h: ih } = magnetWindow(r);
    ctx.save();
    ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih, 3); ctx.clip();
    const cx = ix + iw / 2, cy = iy + ih / 2;
    if (photo) {
      const s = Math.max(iw / photo.width, ih / photo.height);
      const pw = photo.width * s, ph = photo.height * s;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(photo, cx - pw / 2, cy - ph / 2, pw, ph);
    } else {
      // заглушка: курортница в панаме и очках
      const bg = ctx.createLinearGradient(0, iy, 0, iy + ih);
      bg.addColorStop(0, "#5ea6e4"); bg.addColorStop(0.62, "#9fcff3"); bg.addColorStop(0.63, "#3380cb"); bg.addColorStop(1, "#2567b9");
      ctx.fillStyle = bg; ctx.fillRect(ix, iy, iw, ih);
      const u = iw / 30;
      const hy = cy + 2 * u;
      ctx.fillStyle = "#5a3320";
      ctx.beginPath(); ctx.ellipse(cx, hy + 3 * u, 11 * u, 12 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8473b";
      ctx.beginPath(); ctx.ellipse(cx, iy + ih + 2 * u, 17 * u, 10 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f2c29b";
      ctx.fillRect(cx - 3 * u, hy + 6 * u, 6 * u, 6 * u);
      ctx.beginPath(); ctx.ellipse(cx, hy + 1 * u, 8 * u, 10 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#101010";
      ctx.beginPath(); ctx.roundRect(cx - 8 * u, hy - 1 * u, 7 * u, 4.5 * u, 1.5 * u); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 1 * u, hy - 1 * u, 7 * u, 4.5 * u, 1.5 * u); ctx.fill();
      ctx.fillRect(cx - 2 * u, hy, 4 * u, 1 * u);
      ctx.fillStyle = "#c7302b";
      ctx.beginPath(); ctx.ellipse(cx, hy + 6.5 * u, 2.6 * u, 1.3 * u, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#e9d29a";
      ctx.beginPath(); ctx.ellipse(cx, hy - 7 * u, 16 * u, 3.6 * u, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, hy - 10 * u, 8.5 * u, 6 * u, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#c9a45e";
      ctx.fillRect(cx - 8.5 * u, hy - 10.5 * u, 17 * u, 2 * u);
      ctx.fillStyle = "#e8473b";
      ctx.fillRect(cx - 8.5 * u, hy - 10.5 * u, 17 * u, 1.2 * u);
    }
    ctx.restore();
  }

  function wavyRect(ctx, x, y, w, h, grow) {
    ctx.beginPath();
    ctx.roundRect(x - grow, y - grow, w + grow * 2, h + grow * 2, 5 + grow);
    const step = 3.6, rad = 1.9 + grow;
    for (let px = x + 4; px < x + w - 3; px += step) {
      ctx.moveTo(px + rad, y); ctx.arc(px, y, rad, 0, Math.PI * 2);
      ctx.moveTo(px + rad, y + h); ctx.arc(px, y + h, rad, 0, Math.PI * 2);
    }
    for (let py = y + 4; py < y + h - 3; py += step) {
      ctx.moveTo(x + rad, py); ctx.arc(x, py, rad, 0, Math.PI * 2);
      ctx.moveTo(x + w + rad, py); ctx.arc(x + w, py, rad, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function lifebuoy(ctx, x, y, s) {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? "#fffaf0" : "#e8473b";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, s, (i / 8) * Math.PI * 2, ((i + 1) / 8) * Math.PI * 2); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#c9a45e";
    ctx.beginPath(); ctx.arc(x, y, s * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#963c19"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.stroke();
  }

  function magnetFrame(ctx, r) {
    const { x, y, w, h } = r;
    const x0 = x + 1.5, y0 = y + 1.5, w0 = w - 3, h0 = h - 3;
    // тень магнита на ткани
    ctx.fillStyle = "#1b56ad";
    ctx.save(); ctx.translate(1.2, 1.8); wavyRect(ctx, x0, y0, w0, h0, 0.8); ctx.restore();
    // литая рамка с фаской
    ctx.fillStyle = "#963c19"; wavyRect(ctx, x0, y0, w0, h0, 0.8);
    ctx.fillStyle = "#c9a45e"; ctx.save(); ctx.translate(0.6, 0.6); wavyRect(ctx, x0, y0, w0, h0, 0); ctx.restore();
    ctx.fillStyle = "#fcd9a0"; ctx.save(); ctx.translate(-0.4, -0.4); wavyRect(ctx, x0, y0, w0, h0, -0.2); ctx.restore();
    ctx.fillStyle = "#e9d29a"; wavyRect(ctx, x0 + 0.4, y0 + 0.4, w0 - 0.8, h0 - 0.8, -0.6);
    // песчинки в смоле
    const gr = rng(77);
    for (let yy = Math.floor(y0); yy < y0 + h0; yy++)
      for (let xx = Math.floor(x0); xx < x0 + w0; xx++) {
        const v = gr();
        if (v > 0.8) { ctx.fillStyle = v > 0.93 ? "#fcd9a0" : "#c9a45e"; ctx.fillRect(xx, yy, 1, 1); }
      }
    // вдавленное окно под фото: вырезаем, чтобы фото осталось видно
    const win = magnetWindow(r);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, 3); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#6c2a12";
    ctx.beginPath(); ctx.roundRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2, 4);
    ctx.roundRect(win.x, win.y, win.w, win.h, 3);
    ctx.fill("evenodd");
    ctx.fillStyle = "#fffaf0";
    ctx.fillRect(win.x - 1, win.y + win.h + 1, win.w + 2, 1);
    // блик на глянце
    ctx.save();
    ctx.beginPath(); ctx.roundRect(win.x, win.y, win.w, win.h, 3); ctx.clip();
    ctx.fillStyle = "#ffffff";
    for (let yy = Math.floor(win.y); yy < win.y + win.h; yy++)
      for (let xx = Math.floor(win.x); xx < win.x + win.w; xx++) {
        const d = (xx - win.x) + (yy - win.y) * 0.8;
        const inBand = (d > 5 && d < 9) || (d > 11 && d < 12.5);
        if (inBand && (xx + yy) % 2 === 0) ctx.fillRect(xx, yy, 1, 1);
      }
    ctx.restore();
    // приклеенный декор
    lifebuoy(ctx, x + 3.5, y + 5, 6);
    star(ctx, x + w - 4, y + 4.5, 7.5, 0.35);
    scallop(ctx, x + 8, y + h, 7, 0.2);
    conch(ctx, x + w - 8, y + h - 2.5, 5, -0.45);
    pebble(ctx, x + w * 0.52, y + h - 1, 2.6, 0.2);
  }

  function script(ctx, r, text, style, font) {
    const styles = {
      title: { fill: "#ffd23f", stroke: "#c7302b", shadow: "#1c2a5c" },
      name: { fill: "#fffaf0", stroke: "#1c2a5c", shadow: "#1c2a5c" },
      heading: { fill: "#ffd23f", stroke: "#c7302b", shadow: "#123f8c" },
    }[style || "title"];
    const family = font || "Lobster";
    let size = r.h * 0.95;
    ctx.font = `${size}px "${family}"`;
    const w = ctx.measureText(text).width;
    if (w > r.w * 0.98) { size *= (r.w * 0.98) / w; ctx.font = `${size}px "${family}"`; }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const x = r.x + r.w / 2, y = r.y + r.h * 0.52;
    const lw = Math.max(1, size * (style === "name" ? 0.06 : 0.08));
    ctx.lineJoin = "round";
    ctx.lineWidth = lw;
    ctx.strokeStyle = styles.shadow;
    ctx.fillStyle = styles.shadow;
    ctx.strokeText(text, x + 1.2, y + 1.2);
    ctx.fillText(text, x + 1.2, y + 1.2);
    ctx.strokeStyle = styles.stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = styles.fill;
    ctx.fillText(text, x, y);
  }

  // ——— сборка статичного слоя ———
  // ——— сборка ———
  function build() {
    const L = measure();
    const { cols, rows } = L;
    scene.width = cols; scene.height = rows;
    const full = document.createElement("canvas");
    full.width = cols; full.height = rows;

    const bg = new Uint8ClampedArray(cols * rows * 4);
    for (let y = 0, i = 0; y < rows; y++)
      for (let x = 0; x < cols; x++, i += 4) {
        const c = bgColor(x, y, L, 0);
        bg[i] = c[0]; bg[i + 1] = c[1]; bg[i + 2] = c[2]; bg[i + 3] = 255;
      }

    const over = new Uint8ClampedArray(cols * rows * 4);
    const kinds = new Uint8Array(cols * rows);   // 0 — фон, 1 — чёткий принт, 2 — фото с растром
    const mask = new Uint8Array(cols * rows);    // где не летают чайки и не бликует вода
    const stamp = (draw, kind = 1) => stampInto(full, draw, over, kinds, kind);
    const block = (r0, pad = 1) => {
      for (let y = Math.max(0, Math.floor(r0.y) - pad); y < Math.min(rows, Math.ceil(r0.y + r0.h) + pad + 1); y++)
        for (let x = Math.max(0, Math.floor(r0.x) - pad); x < Math.min(cols, Math.ceil(r0.x + r0.w) + pad + 1); x++)
          mask[y * cols + x] = 1;
    };

    // ракушки разбросаны по всему пляжу, в обход панелей и ярлычка
    const avoid = L.marks.filter((m) => m.kind === "panel" || m.kind === "avoid").map((m) => m.r);
    const u = Math.min(9, Math.max(5, cols / 11));
    const sandTop = L.shells.y + 1, sandBottom = rows - 4;
    const r = rng(42), shells = [];
    const free = (x, y, s) =>
      x > 2 && x < cols - 3 && y > sandTop && y < sandBottom &&
      avoid.every((a) => x < a.x - s || x > a.x + a.w + s || y < a.y - s || y > a.y + a.h + s) &&
      shells.every((o) => Math.hypot(o.x - x, o.y - y) > (o.s + s) * 1.9);
    const kindsOf = [conch, scallop, pebble, star, scallop, pebble, conch, pebble, star];
    const target = Math.round(((sandBottom - sandTop) * cols) / (u * u * 5.5));
    for (let tries = 0; tries < 900 && shells.length < target; tries++) {
      const s = u * (0.45 + r() * 0.4);
      const x = r() * cols, y = sandTop + r() * (sandBottom - sandTop);
      if (free(x, y, s)) shells.push({ x, y, s, rot: (r() - 0.5) * 2, draw: kindsOf[shells.length % kindsOf.length] });
    }
    stamp((ctx) => {
      for (const sh of shells) sh.draw(ctx, sh.x, sh.y, sh.s, sh.rot);
    });

    const pw = Math.min(cols, 120);
    stamp((ctx) => {
      palm(ctx, -4, -3, 0.35, pw * 0.42, 1.1, 1);
      palm(ctx, -2, -6, 0.9, pw * 0.3, 0.8, 2);
      palm(ctx, cols * 0.28, -5, 0.2, pw * 0.34, 1.4, 3);
      palm(ctx, cols * 0.62, -5, Math.PI - 0.25, pw * 0.3, -1.3, 4);
      if (cols > 130) palm(ctx, cols * 0.45, -6, 0.5, pw * 0.26, 1.2, 7);
      palm(ctx, cols + 4, -3, Math.PI - 0.4, pw * 0.4, -1.1, 5);
      palm(ctx, cols + 2, -6, Math.PI - 0.95, pw * 0.28, -0.8, 6);
    });

    // маршрут: пунктир между островами, флажок на последнем
    const isles = L.marks.filter((m) => m.kind === "panel" && m.el.dataset.print === "island").map((m) => m.r);
    const mid = (q) => ({ x: q.x + q.w / 2, y: q.y + q.h / 2 });
    const routeLine = () => stamp((ctx) => {
      ctx.beginPath();
      ctx.rect(0, 0, cols, rows);
      for (const q of isles) ctx.ellipse(q.x + q.w / 2, q.y + q.h / 2, q.w / 2 + 6, q.h / 2 + 6.5, 0, 0, Math.PI * 2);
      ctx.clip("evenodd");
      ctx.strokeStyle = "#e8473b"; ctx.lineWidth = 1.3; ctx.setLineDash([2.5, 2]);
      for (let i = 0; i < isles.length - 1; i++) {
        const a = mid(isles[i]), b = mid(isles[i + 1]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2 + (i % 2 ? -6 : 6), (a.y + b.y) / 2 + 3, b.x, b.y);
        ctx.stroke();
      }
    });

    for (const m of L.marks) {
      if (m.kind === "panel") { stamp((ctx) => printPatch(ctx, m.r, m.el.dataset.print, Math.round(m.r.y * 7 + m.r.x))); block(m.r); }
      else if (m.kind === "ribbon") { stamp((ctx) => ribbon(ctx, m.r)); block(m.r); }
      else if (m.kind === "photo") { stamp((ctx) => magnetPhoto(ctx, m.r), 2); stamp((ctx) => magnetFrame(ctx, m.r)); block(m.r); }
      else if (m.kind === "title") { stamp((ctx) => script(ctx, m.r, m.el.dataset.text, m.el.dataset.style, m.el.dataset.font)); block(m.r, 0); }
      else if (m.kind === "avoid") block(m.r);
    }
    if (isles.length > 1) routeLine();
    if (isles.length) {
      const last = isles[isles.length - 1];
      stamp((ctx) => {
        const fx = last.x + last.w - 3, fy = last.y + 1;
        ctx.fillStyle = "#5a3320"; ctx.fillRect(fx, fy - 8, 1, 9);
        ctx.fillStyle = "#e8473b";
        ctx.beginPath(); ctx.moveTo(fx + 1, fy - 8); ctx.lineTo(fx + 6, fy - 6.2); ctx.lineTo(fx + 1, fy - 4.4); ctx.fill();
      });
    }

    // живой слой над горизонтом «Кейсов»: волны и дельфины
    const v = L.vista;
    const dynTop = Math.max(0, Math.floor(v.y - v.h * 0.2)), dynBottom = Math.min(rows, Math.ceil(v.y + v.h));
    const dyn = document.createElement("canvas");
    dyn.width = cols; dyn.height = dynBottom - dynTop;
    const water = v.h * 0.66;
    const len = Math.min(20, Math.max(11, v.w * 0.16));
    const jumps = [0, 1].map((i) => ({
      x0: v.x + v.w * (0.14 + i * 0.3), span: v.w * 0.3, water: v.y - dynTop + water,
      height: v.h * 0.36, len: len * (1 - i * 0.12), period: 5.2, air: 1.9, offset: i * 2.4, seed: 30 + i * 7,
    }));
    const drawLive = (ctx, t) => {
      ctx.translate(0, -dynTop);
      wave(ctx, v.x + v.w * 0.18, v.y + v.h * 0.84, v.w * 0.4, v.h * 0.3, 5, t);
      wave(ctx, v.x + v.w * 0.86, v.y + v.h * 0.86, v.w * 0.32, v.h * 0.24, 9, t);
      ctx.translate(0, dynTop);
      for (const j of jumps) dolphinJump(ctx, j, t);
    };

    // чайки
    const gr = rng(7), gulls = [];
    for (let i = 0; i < Math.round(cols / 14); i++) {
      gulls.push({ x: gr() * cols, y: 14 + gr() * (L.horizon - 20), sp: 0.08 + gr() * 0.1, ph: Math.floor(gr() * 6), dir: gr() > 0.3 ? 1 : -1 });
    }

    S = {
      ...L, bg, over, kinds, mask, gulls, frame: 0,
      dyn, dynTop, dynBottom, drawLive,
      buf: new Uint8ClampedArray(bg), liveKinds: new Uint8Array(cols * rows),
      out: new ImageData(cols, rows),
    };
    paintWeave();
    setupFringe(fringeTop, true);
    setupFringe(fringeBottom, false);
    render(0, rows);
    schedule();
  }

  // ——— спрайты ———
  const GULL = [
    ["a.......a", ".a.....a.", "..abwba..", "....b...."],
    [".........", "..abwba..", ".a..b..a.", "a.......a"],
  ];
  const GULL_COL = { a: hex("#5d5760"), b: hex("#cdc6c0"), w: hex("#ffffff") };

  // ——— квантование с упорядоченным дизерингом ———
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
  const cache = new Int16Array(1 << 18).fill(-1);
  const nearest = (r, g, b) => {
    r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let k = cache[key];
    if (k < 0) {
      let best = 1e9;
      for (let i = 0; i < PALETTE.length; i++) {
        const p = PALETTE[i];
        const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
        const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (dist < best) { best = dist; k = i; }
      }
      cache[key] = k;
    }
    return PALETTE[k];
  };

  const FRAME = 90;

  function render(r0, r1) {
    const { cols, bg, over, kinds, mask, gulls, buf, out, liveKinds } = S;
    const f = S.frame, t = reduceMotion ? 0 : (f * FRAME) / 1000;
    for (let y = r0; y < r1; y++) {
      const live = !reduceMotion && y >= S.horizon;
      for (let x = 0; x < cols; x++) {
        const p = y * cols + x, i = p * 4;
        liveKinds[p] = 0;
        if (live && !kinds[p]) {
          const c = bgColor(x, y, S, t);
          buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
          if (y < S.shore - 14 && !mask[p] && hash(x, y, 5) > 0.93 && hash(p, f >> 1, 3) > 0.9) buf[i] = buf[i + 1] = buf[i + 2] = 255;
        } else {
          buf[i] = bg[i]; buf[i + 1] = bg[i + 1]; buf[i + 2] = bg[i + 2];
        }
      }
    }
    if (S.dynBottom > r0 && S.dynTop < r1) stampInto(S.dyn, (ctx) => S.drawLive(ctx, t), buf, liveKinds, 1, S.dynTop);

    for (const g of gulls) {
      const spr = GULL[Math.floor((f + g.ph) / 3) % 2];
      const gx = Math.round(g.x), gy = Math.round(g.y + Math.sin((f + g.ph * 7) * 0.08) * 1.5);
      if (gy + spr.length < r0 || gy > r1) continue;
      for (let y = 0; y < spr.length; y++)
        for (let x = 0; x < spr[y].length; x++) {
          const ch = spr[y][x];
          if (ch === ".") continue;
          const px = gx + (g.dir > 0 ? x : spr[y].length - 1 - x), py = gy + y;
          if (px < 0 || py < r0 || px >= cols || py >= r1 || mask[py * cols + px]) continue;
          const c = GULL_COL[ch], i = (py * cols + px) * 4;
          buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
        }
    }

    const d = out.data, rows = S.rows;
    for (let y = r0; y < r1; y++) {
      for (let x = 0; x < cols; x++) {
        const p = y * cols + x, i = p * 4;
        let r = buf[i], g = buf[i + 1], b = buf[i + 2], kind = liveKinds[p] ? 1 : 0;
        if (kinds[p]) { r = over[i]; g = over[i + 1]; b = over[i + 2]; kind = kinds[p]; }
        const o = kind === 1 ? 0 : BAYER[(y & 3) * 4 + (x & 3)] * 34;
        const c = nearest(r + o, g + o, b + o);
        const e = Math.min(x, y, cols - 1 - x, rows - 1 - y);
        const k = e < 2 ? 0.86 : e === 2 ? 1.07 : 1;
        d[i] = c[0] * k; d[i + 1] = c[1] * k; d[i + 2] = c[2] * k; d[i + 3] = 255;
      }
    }
    scene.getContext("2d").putImageData(out, 0, 0, 0, r0, cols, r1 - r0);
  }

  function visibleRows() {
    const rc = cloth.getBoundingClientRect();
    const a = Math.floor(-rc.top / S.cell) - 2, b = Math.ceil((innerHeight - rc.top) / S.cell) + 2;
    return [Math.max(0, Math.min(S.rows, a)), Math.max(0, Math.min(S.rows, b))];
  }

  function schedule() {
    clearInterval(timer);
    if (reduceMotion) return;
    timer = setInterval(() => {
      if (document.hidden) return;
      S.frame++;
      for (const g of S.gulls) {
        g.x += g.sp * g.dir * 1.6;
        if (g.x > S.cols + 10) g.x = -10;
        if (g.x < -10) g.x = S.cols + 10;
      }
      const [r0, r1] = visibleRows();
      if (r1 > r0) render(r0, r1);
    }, FRAME);
  }

  // ——— вафля ———
  function paintWeave() {
    const dpr = window.devicePixelRatio || 1;
    const n = Math.max(3, Math.round(S.cell * dpr));
    const t = document.createElement("canvas");
    t.width = t.height = n;
    const c = t.getContext("2d");
    const line = Math.max(1, Math.round(n * 0.14));
    // рёбра вафли — светлые, карманы — утоплены
    c.fillStyle = "rgba(255,255,255,.30)";
    c.fillRect(0, 0, n, line); c.fillRect(0, 0, line, n);
    c.fillStyle = "rgba(0,0,0,.20)";
    c.fillRect(0, n - line, n, line); c.fillRect(n - line, 0, line, n);
    const p = line * 2;
    c.fillStyle = "rgba(0,0,0,.10)";
    c.fillRect(p - line, p - line, n - 2 * p + line * 2, n - 2 * p + line * 2);
    c.fillStyle = "rgba(0,0,0,.16)";
    c.fillRect(p - line, p - line, n - 2 * p + line * 2, line);
    c.fillStyle = "rgba(255,255,255,.10)";
    c.fillRect(p - line, n - p, n - 2 * p + line * 2, line);
    weave.style.backgroundImage = `url(${t.toDataURL()})`;
    weave.style.backgroundSize = `${S.cell}px ${S.cell}px`;
  }

  // ——— бахрома: настоящая, из тонких нитей — это не принт, поэтому рисуется в экранном разрешении ———
  const FRINGE_H = 46;
  function setupFringe(cv, top) {
    const dpr = window.devicePixelRatio || 1, w = S.cols * S.cell;
    cv.width = Math.round(w * dpr); cv.height = Math.round(FRINGE_H * dpr);
    cv.style.width = w + "px";
    cv.style.height = FRINGE_H + "px";
    cv.style.transform = top ? "scaleY(-1)" : "";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, FRINGE_H);
    const r = rng(top ? 11 : 12);
    const threads = ["#fffdf8", "#f3ede2", "#e6dece", "#d6ccb9"];
    ctx.lineCap = "round";
    // подрубка края
    ctx.fillStyle = "#d9cfbd";
    ctx.fillRect(0, 0, w, 2);
    const step = 9, n = Math.floor((w - 6) / step) + 1, start = (w - (n - 1) * step) / 2;
    for (let k = 0; k < n; k++) {
      const x = start + k * step + (r() - 0.5) * 1.2;
      const len = 34 + r() * 9, lean = (r() - 0.5) * 5;
      const knotY = 7 + r() * 1.5;
      // нити собраны в пучок, ниже узелка чуть расходятся
      for (let i = 0; i < 6; i++) {
        const spread = (i - 2.5) * 0.9;
        const ex = x + lean + spread * (1.2 + r() * 0.8), ey = len - r() * 5;
        ctx.strokeStyle = threads[(i + k) % threads.length];
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(x + spread * 0.9, 1.5);
        ctx.quadraticCurveTo(x + spread * 0.25, knotY, x + spread * 0.35, knotY + 2);
        ctx.quadraticCurveTo(x + lean * 0.4 + spread, knotY + (ey - knotY) * 0.5, ex, ey);
        ctx.stroke();
      }
      ctx.fillStyle = "#e9e1d1";
      ctx.beginPath(); ctx.ellipse(x, knotY + 0.5, 2.6, 2.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(90,70,40,.25)";
      ctx.beginPath(); ctx.ellipse(x + 0.6, knotY + 1.4, 2.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }



  window.towel = { rebuild: () => build() };

  let rt = 0, lastW = 0;
  addEventListener("resize", () => {
    if (towel.parentElement.clientWidth === lastW) return;
    clearTimeout(rt);
    rt = setTimeout(() => { lastW = towel.parentElement.clientWidth; build(); }, 150);
  });

  Promise.all([
    document.fonts.load("40px Lobster", "Москва"),
    document.fonts.ready,
  ]).then(() => { lastW = towel.parentElement.clientWidth; build(); });
})();
