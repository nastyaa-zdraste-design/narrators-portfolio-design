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

  function panel(ctx, r, tone) {
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    ctx.fillStyle = "rgba(20,30,70,.9)";
    ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w, h, 3); ctx.fill();
    ctx.fillStyle = tone;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill();
    ctx.fillStyle = "#fffaf0";
    ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 2); ctx.fill();
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

  function portrait(ctx, r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
    const rings = [["#e8473b", 0], ["#ffd23f", 1.4], ["#fffaf0", 2.6], ["#e8473b", 3.4]];
    for (const [c, inset] of rings) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx - inset, ry - inset, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, rx - 4.4, ry - 4.4, 0, 0, Math.PI * 2); ctx.clip();
    const ix = cx - rx, iy = cy - ry, iw = r.w, ih = r.h;
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
      const u = iw / 36;
      ctx.fillStyle = "#5a3320";
      ctx.beginPath(); ctx.ellipse(cx, cy + 3 * u, 11 * u, 12 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e8473b";
      ctx.beginPath(); ctx.ellipse(cx, iy + ih + 2 * u, 17 * u, 12 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f2c29b";
      ctx.fillRect(cx - 3 * u, cy + 6 * u, 6 * u, 6 * u);
      ctx.beginPath(); ctx.ellipse(cx, cy + 1 * u, 8 * u, 10 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#101010";
      ctx.beginPath(); ctx.roundRect(cx - 8 * u, cy - 1 * u, 7 * u, 4.5 * u, 1.5 * u); ctx.fill();
      ctx.beginPath(); ctx.roundRect(cx + 1 * u, cy - 1 * u, 7 * u, 4.5 * u, 1.5 * u); ctx.fill();
      ctx.fillRect(cx - 2 * u, cy, 4 * u, 1 * u);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(cx - 6.5 * u, cy, 1.2 * u, 1.2 * u); ctx.fillRect(cx + 2.5 * u, cy, 1.2 * u, 1.2 * u);
      ctx.fillStyle = "#c7302b";
      ctx.beginPath(); ctx.ellipse(cx, cy + 6.5 * u, 2.6 * u, 1.3 * u, 0, 0, Math.PI); ctx.fill();
      ctx.fillStyle = "#e9d29a";
      ctx.beginPath(); ctx.ellipse(cx, cy - 7 * u, 16 * u, 3.6 * u, -0.08, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy - 10 * u, 8.5 * u, 6 * u, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "#c9a45e";
      ctx.fillRect(cx - 8.5 * u, cy - 10.5 * u, 17 * u, 2 * u);
      ctx.fillStyle = "#e8473b";
      ctx.fillRect(cx - 8.5 * u, cy - 10.5 * u, 17 * u, 1.2 * u);
    }
    ctx.restore();
  }

  function script(ctx, r, text, style) {
    const styles = {
      title: { fill: "#ffd23f", stroke: "#c7302b", shadow: "#1c2a5c" },
      name: { fill: "#fffaf0", stroke: "#1c2a5c", shadow: "#1c2a5c" },
      heading: { fill: "#ffd23f", stroke: "#c7302b", shadow: "#123f8c" },
    }[style || "title"];
    let size = r.h * 0.95;
    ctx.font = `${size}px Lobster`;
    const w = ctx.measureText(text).width;
    if (w > r.w * 0.98) { size *= (r.w * 0.98) / w; ctx.font = `${size}px Lobster`; }
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

    for (const m of L.marks) {
      if (m.kind === "panel") { stamp((ctx) => panel(ctx, m.r, m.el.dataset.tone || "#e8473b")); block(m.r); }
      else if (m.kind === "ribbon") { stamp((ctx) => ribbon(ctx, m.r)); block(m.r); }
      else if (m.kind === "photo") { stamp((ctx) => portrait(ctx, m.r), 2); block(m.r); }
      else if (m.kind === "title") { stamp((ctx) => script(ctx, m.r, m.el.dataset.text, m.el.dataset.style)); block(m.r, 0); }
      else if (m.kind === "avoid") block(m.r);
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
      const t = (S.frame * FRAME) / 1000;
      for (const [cv, top] of [[fringeTop, true], [fringeBottom, false]]) {
        const rc = cv.getBoundingClientRect();
        if (rc.bottom > 0 && rc.top < innerHeight) paintFringe(cv, top, t);
      }
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

  // ——— бахрома ———
  // ——— бахрома: скрученные кисточки с узелками и растрёпанными кончиками ———
  const FRINGE_ROWS = 16;
  function setupFringe(cv, top) {
    cv.width = S.cols; cv.height = FRINGE_ROWS;
    cv.style.width = S.cols * S.cell + "px";
    cv.style.height = FRINGE_ROWS * S.cell + "px";
    cv.style.transform = top ? "scaleY(-1)" : "";
    paintFringe(cv, top, 0);
  }
  function paintFringe(cv, top, t) {
    const cols = S.cols, h = FRINGE_ROWS;
    const img = new ImageData(cols, h), d = img.data;
    const put = (x, y, c) => {
      x = Math.round(x);
      if (x < 0 || x >= cols || y < 0 || y >= h) return;
      const i = (y * cols + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    };
    const HEM = hex("#cabea7"), KNOT = hex("#d6c9b1"), LIGHT = hex("#fbf7ef"), MID = hex("#e6dccb"), TWIST = hex("#c4b69d");
    for (let x = 0; x < cols; x++) put(x, 0, HEM);
    const r = rng(top ? 11 : 12);
    for (let x = 3; x < cols - 3; x += 5) {
      const len = 9 + Math.floor(r() * 4), bend = (r() - 0.5) * 2.2, ph = r() * 6;
      const sway = reduceMotion ? 0 : Math.sin(t * 1.1 + ph + x * 0.1) * 0.9;
      const at = (y) => x + bend * (y / len) * (y / len) + sway * (y / len);
      // узелок
      for (let k = -2; k <= 1; k++) { put(x + k, 1, KNOT); put(x + k, 2, KNOT); }
      put(x - 2, 2, TWIST); put(x + 1, 2, TWIST);
      // скрученный шнурок
      for (let y = 3; y < len; y++) {
        const c = at(y);
        put(c - 1, y, LIGHT);
        put(c, y, MID);
        if ((y + x) % 3 === 0) put(c - 1, y, TWIST);
        if ((y + x) % 3 === 1) put(c, y, TWIST);
      }
      // растрёпанный кончик
      const c = at(len);
      put(c - 2, len, MID); put(c - 0.5, len, LIGHT); put(c + 1, len, MID);
      put(c - 3, len + 1, LIGHT); put(c + 1.5, len + 1, LIGHT);
      if (r() > 0.4) put(c - 0.5, len + 1, MID);
      if (r() > 0.5) put(c - 3.5, len + 2, MID);
    }
    cv.getContext("2d").putImageData(img, 0, 0);
  }



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
