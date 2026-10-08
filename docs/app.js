"use strict";

// ── sources ────────────────────────────────────────────────────────────
// Both endpoints are this site's own Pages Functions: /api/arena proxies
// and caches the Are.na channel, /api/notes keeps the shared board.
const ARENA = "/api/arena";
const CHANNEL = "basics-of-faith-s3";
const NOTES = "/api/notes";
const POLL_MS = 3000;

const TITLE_W = 1500, TITLE_H = 440;
const MIN_SCALE = 0.05, MAX_SCALE = 2.4;
const DEAL_STAGGER = 70;   // ms between frames landing on the pile
const TITLE_HOLD = 1500;   // ms the fullscreen title sits still
const MAX_TEXT = 4000;

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

let FRAMES = [];
let PHOTOS = [];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── layout ─────────────────────────────────────────────────────────────
// A jittered 6-column band with a block held open in the middle for the
// title. Cell spacing is derived from the frames' own rotated footprints
// rather than fixed, so the grid tightens until neighbours just kiss —
// about 3% of overlap, scattered by jitter so no two seams match.
const COLS = 6;
const BASE = 1000;      // nominal long edge of a frame, in world px
const OVERLAP = 0.03;   // mean fraction of a frame its neighbour covers

function layout() {
  const r = rng(20260308);
  const rad = (d) => d * Math.PI / 180;

  // Pass 1 — size and tilt each frame, and measure the box its rotation
  // actually sweeps, which is what has to be packed.
  const items = FRAMES.map((fr, i) => {
    const long = BASE * (0.88 + r() * 0.26);
    const w = fr.w >= fr.h ? long : long * (fr.w / fr.h);
    const h = fr.w >= fr.h ? long * (fr.h / fr.w) : long;
    const rot = (r() - 0.5) * 11;
    const c = Math.abs(Math.cos(rad(rot))), sn = Math.abs(Math.sin(rad(rot)));
    return { ...fr, i, w, h, rot, fw: w * c + h * sn, fh: h * c + w * sn };
  });

  const mean = (k) => items.reduce((a, it) => a + it[k], 0) / items.length;
  const cellW = mean("fw") * (1 - OVERLAP);
  const cellH = mean("fh") * (1 - OVERLAP);

  // Pass 2 — the open cells, minus the four the title sits across. Rows
  // grow with the channel, and the held block stays centred on the origin
  // whatever that count turns out to be.
  const rows = Math.max(4, Math.ceil((items.length + 4) / COLS));
  const holdRow = Math.floor((rows - 2) / 2);
  const originRow = holdRow + 0.5;
  const held = new Set([
    holdRow + ",2", holdRow + ",3",
    (holdRow + 1) + ",2", (holdRow + 1) + ",3"
  ]);
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!held.has(row + "," + col)) cells.push([row, col]);
    }
  }
  // Shuffle, so the leftover cells fall as gaps anywhere in the field.
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  // Stacking is deal order — a frame placed later lies on top, in the pile
  // and on the canvas alike. The shuffled cells already make which frame
  // covers which read as chance, with none of the pile's order broken.
  return items.map((it, i) => {
    const [row, col] = cells[i % cells.length];
    const x = (col - (COLS - 1) / 2) * cellW + (r() - 0.5) * cellW * 0.10;
    const y = (row - originRow) * cellH + (r() - 0.5) * cellH * 0.10;
    r();   // a reserved draw, so this scatter survives changes above it

    return {
      ...it, x, y,
      // Pose on the pile: a loose heap, each frame a little off the last.
      sx: (r() - 0.5) * 150,
      sy: (r() - 0.5) * 110,
      srot: (r() - 0.5) * 26
    };
  });
}

// ── camera ─────────────────────────────────────────────────────────────
const stage = document.getElementById("stage");
const world = document.getElementById("world");
const title = document.getElementById("titlecard");
const frames = document.getElementById("frames");
const cam = { x: 0, y: 0, s: 1 };

function applyCam() {
  world.style.transform =
    `translate(${innerWidth / 2 - cam.x * cam.s}px, ${innerHeight / 2 - cam.y * cam.s}px) scale(${cam.s})`;
}

function clampScale(s) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

/** Screen point -> world point, for zooming about the cursor. */
function toWorld(px, py) {
  return {
    x: (px - innerWidth / 2) / cam.s + cam.x,
    y: (py - innerHeight / 2) / cam.s + cam.y
  };
}

function zoomAt(px, py, factor) {
  const before = toWorld(px, py);
  cam.s = clampScale(cam.s * factor);
  const after = toWorld(px, py);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  applyCam();
}

let tween = null;
function flyTo(target, ms, done) {
  if (tween) cancelAnimationFrame(tween);
  if (reduced || ms === 0) {
    Object.assign(cam, target); applyCam();
    if (done) done();
    return;
  }
  const from = { ...cam }, t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.x = from.x + (target.x - from.x) * e;
    cam.y = from.y + (target.y - from.y) * e;
    // Geometric on scale: a straight lerp lurches at high zoom.
    cam.s = from.s * Math.pow(target.s / from.s, e);
    applyCam();
    if (t < 1) { tween = requestAnimationFrame(step); }
    else { tween = null; if (done) done(); }
  };
  tween = requestAnimationFrame(step);
}

/** Camera that frames a world rect with breathing room. */
function frameRect(x, y, w, h, pad) {
  const p = pad === undefined ? 1.12 : pad;
  return { x, y, s: clampScale(Math.min(innerWidth / (w * p), innerHeight / (h * p))) };
}

/** The bounding box of the pile, so the opening frames it at any screen size. */
function fitPile() {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of PHOTOS) {
    const rad = Math.abs(p.srot) * Math.PI / 180;
    const w = p.w * Math.cos(rad) + p.h * Math.sin(rad);
    const h = p.h * Math.cos(rad) + p.w * Math.sin(rad);
    x0 = Math.min(x0, p.sx - w / 2); x1 = Math.max(x1, p.sx + w / 2);
    y0 = Math.min(y0, p.sy - h / 2); y1 = Math.max(y1, p.sy + h / 2);
  }
  return frameRect((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 1.35);
}

/** The bounding box of everything on the canvas, rotation included. */
function fitAll() {
  let x0 = -TITLE_W / 2, x1 = TITLE_W / 2, y0 = -TITLE_H / 2, y1 = TITLE_H / 2;

  for (const p of PHOTOS) {
    const rad = Math.abs(p.rot) * Math.PI / 180;
    const w = p.w * Math.cos(rad) + p.h * Math.sin(rad);
    const h = p.h * Math.cos(rad) + p.w * Math.sin(rad);
    x0 = Math.min(x0, p.x - w / 2); x1 = Math.max(x1, p.x + w / 2);
    y0 = Math.min(y0, p.y - h / 2); y1 = Math.max(y1, p.y + h / 2);
  }
  for (const n of notes.values()) {
    x0 = Math.min(x0, n.x - 240); x1 = Math.max(x1, n.x + 240);
    y0 = Math.min(y0, n.y - 160); y1 = Math.max(y1, n.y + 160);
  }
  return frameRect((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 1.06);
}

// ── frames ─────────────────────────────────────────────────────────────
const nodes = [];

function pose(p, spread) {
  const x = spread ? p.x : p.sx, y = spread ? p.y : p.sy;
  const r = spread ? p.rot : p.srot;
  return `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${r}deg)`;
}

function buildFrames() {
  frames.textContent = "";
  nodes.length = 0;

  for (const p of PHOTOS) {
    const fig = document.createElement("figure");
    fig.className = "obj photo";
    fig.style.width = p.w + "px";
    fig.style.transform = pose(p, false);
    fig.style.opacity = "0";
    fig.style.zIndex = String(10 + p.i);

    const img = document.createElement("img");
    img.src = p.src;
    img.alt = "";
    img.draggable = false;
    img.style.height = p.h + "px";

    fig.appendChild(img);
    fig.addEventListener("click", (e) => {
      if (dragMoved) return;
      e.stopPropagation();
      flyTo(frameRect(p.x, p.y, p.w, p.h, 1.22), 650);
    });
    frames.appendChild(fig);
    nodes.push(fig);
  }
}

/** Are.na gives no dimensions, so the thumbnails are loaded first purely
 *  to read their aspect — they are small, and the full frames stream in
 *  behind the opening. */
function measure(blocks) {
  return Promise.all(blocks.map((b) => new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve({
      id: b.id, src: b.src,
      w: probe.naturalWidth || 1000,
      h: probe.naturalHeight || 1000
    });
    probe.onerror = () => resolve(null);
    probe.src = b.thumb;
  }))).then((all) => all.filter(Boolean));
}

/** The channel, from this site's cached proxy where there is one and
 *  straight from Are.na where there isn't — their API is CORS-open, so a
 *  static host can ask for itself. */
async function loadBlocks() {
  try {
    const res = await fetch(ARENA);
    if (res.ok) {
      const blocks = await res.json();
      if (Array.isArray(blocks) && blocks.length) return blocks;
    }
  } catch (e) {
    /* no proxy here — fall through */
  }

  const res = await fetch(`https://api.are.na/v2/channels/${CHANNEL}?per=100`);
  const channel = await res.json();

  return (channel.contents || [])
    .filter((b) => b.class === "Image" && b.image && b.image.display && b.image.thumb)
    .map((b) => ({
      id: String(b.id),
      src: b.image.display.url,
      thumb: b.image.thumb.url
    }));
}

// ── notes ──────────────────────────────────────────────────────────────
const notes = new Map();   // id -> {id, x, y, text}
let boardVersion = -1;

// The same page runs two ways: on Cloudflare, where /api/notes is a shared
// KV board, and on a static host, where it 404s and the board falls back to
// this browser. Which one is in force is settled once, at boot.
let shared = false;
const LOCAL_KEY = "bof-s3-notes";

function noteEl(n) {
  let el = document.querySelector('[data-note="' + n.id + '"]');
  if (!el) {
    el = document.createElement("div");
    el.className = "obj note";
    el.dataset.note = n.id;
    el.style.zIndex = "50";
    el.innerHTML =
      '<button class="kill" title="Delete" aria-label="Delete note">×</button>' +
      '<textarea placeholder="Note" aria-label="Note" maxlength="' + MAX_TEXT + '"></textarea>';

    const ta = el.querySelector("textarea");
    ta.addEventListener("input", () => {
      grow(ta);
      n.text = ta.value;
      queueSave(n);
    });
    ta.addEventListener("blur", () => saveNote(n));

    el.querySelector(".kill").addEventListener("click", (e) => {
      e.stopPropagation();
      removeNote(n.id);
    });

    // Drag from anywhere on the card; a press that never moves lands in
    // the text instead, so there is no handle to aim at on a phone.
    el.addEventListener("pointerdown", (e) => startNoteDrag(e, n, el));
    world.appendChild(el);
  }

  if (!(noteDrag && noteDrag.n.id === n.id)) {
    el.style.transform = `translate(${n.x}px, ${n.y}px) translate(-50%, -50%)`;
  }

  const ta = el.querySelector("textarea");
  if (document.activeElement !== ta && ta.value !== (n.text || "")) {
    ta.value = n.text || "";
    grow(ta);
  }
  return el;
}

function grow(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

function renderNotes() {
  for (const n of notes.values()) noteEl(n);
  for (const el of document.querySelectorAll("[data-note]")) {
    if (!notes.has(el.dataset.note)) el.remove();
  }
}

function addNote() {
  const c = toWorld(innerWidth / 2, innerHeight / 2 - 40);
  const n = {
    id: "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    x: Math.round(c.x), y: Math.round(c.y), text: ""
  };
  notes.set(n.id, n);
  noteEl(n).querySelector("textarea").focus();
  saveNote(n);
}

// ── the shared board ───────────────────────────────────────────────────
const saveTimers = new Map();
const inFlight = new Set();

function queueSave(n) {
  clearTimeout(saveTimers.get(n.id));
  saveTimers.set(n.id, setTimeout(() => saveNote(n), 700));
}

function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify([...notes.values()])); }
  catch (e) { /* private window: the board still works for this visit */ }
}

function loadLocal() {
  try {
    for (const n of JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]")) notes.set(n.id, n);
  } catch (e) { /* unreadable storage */ }
}

async function saveNote(n) {
  clearTimeout(saveTimers.get(n.id));
  if (!shared) return saveLocal();

  inFlight.add(n.id);
  try {
    const res = await fetch(NOTES + "/" + n.id, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: n.x, y: n.y, text: n.text || "" })
    });
    const out = await res.json();
    if (typeof out.v === "number") boardVersion = out.v;
  } catch (e) {
    /* offline: the note stays on screen and the next edit retries */
  } finally {
    inFlight.delete(n.id);
  }
}

async function removeNote(id) {
  notes.delete(id);
  renderNotes();
  if (!shared) return saveLocal();

  try {
    const res = await fetch(NOTES + "/" + id, { method: "DELETE" });
    const out = await res.json();
    if (typeof out.v === "number") boardVersion = out.v;
  } catch (e) { /* gone is gone */ }
}

/** Pull the board, keeping anything this visitor is mid-edit or mid-drag. */
async function pullNotes() {
  if (!shared) return;

  let board;
  try {
    board = await (await fetch(NOTES, { cache: "no-store" })).json();
  } catch (e) {
    return;
  }
  if (board.v === boardVersion) return;
  boardVersion = board.v;

  const incoming = board.notes || {};
  for (const [id, v] of Object.entries(incoming)) {
    if (inFlight.has(id)) continue;

    const el = document.querySelector('[data-note="' + id + '"]');
    const typing = el && document.activeElement === el.querySelector("textarea");
    const dragging = noteDrag && noteDrag.n.id === id;
    const cur = notes.get(id);

    notes.set(id, {
      id,
      x: dragging && cur ? cur.x : (v.x || 0),
      y: dragging && cur ? cur.y : (v.y || 0),
      text: typing && cur ? cur.text : (v.text || "")
    });
  }
  for (const id of [...notes.keys()]) {
    if (!(id in incoming) && !inFlight.has(id)) notes.delete(id);
  }
  renderNotes();
}

// ── pan, zoom, drag ────────────────────────────────────────────────────
const pointers = new Map();
let panning = false, dragMoved = false, pinchStart = null;
let noteDrag = null;

stage.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".note")) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stage.setPointerCapture(e.pointerId);
  dragMoved = false;

  if (pointers.size === 1) {
    panning = true;
    stage.classList.add("grabbing");
  } else if (pointers.size === 2) {
    panning = false;
    pinchStart = pinchState();
  }
});

function pinchState() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    s: cam.s,
    world: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2)
  };
}

stage.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;

  const prev = { x: p.x, y: p.y };
  p.x = e.clientX; p.y = e.clientY;

  if (pointers.size === 2 && pinchStart) {
    const now = pinchState();
    cam.s = clampScale(pinchStart.s * (now.dist / pinchStart.dist));
    // Keep the point between the fingers pinned under them.
    cam.x = pinchStart.world.x - (now.mid.x - innerWidth / 2) / cam.s;
    cam.y = pinchStart.world.y - (now.mid.y - innerHeight / 2) / cam.s;
    applyCam();
    dragMoved = true;
    return;
  }

  if (!panning) return;
  const dx = p.x - prev.x, dy = p.y - prev.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) dragMoved = true;
  cam.x -= dx / cam.s;
  cam.y -= dy / cam.s;
  applyCam();
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) {
    panning = false;
    stage.classList.remove("grabbing");
  }
}
stage.addEventListener("pointerup", endPointer);
stage.addEventListener("pointercancel", endPointer);

stage.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    return;
  }
  cam.x += e.deltaX / cam.s;
  cam.y += e.deltaY / cam.s;
  applyCam();
}, { passive: false });

stage.addEventListener("dblclick", (e) => {
  if (e.target.closest(".note")) return;
  zoomAt(e.clientX, e.clientY, 1.9);
});

const DRAG_SLOP = 4;   // px of movement before a press becomes a drag

function startNoteDrag(e, n, el) {
  const ta = el.querySelector("textarea");
  if (document.activeElement === ta) return;   // already editing: let the caret work

  e.preventDefault();   // suppress the native focus; a tap focuses on release

  const start = toWorld(e.clientX, e.clientY);
  noteDrag = {
    n, el, ta,
    ox: n.x - start.x, oy: n.y - start.y,
    sx: e.clientX, sy: e.clientY,
    moved: false
  };
  el.setPointerCapture(e.pointerId);
  el.addEventListener("pointermove", moveNoteDrag);
  el.addEventListener("pointerup", endNoteDrag);
  el.addEventListener("pointercancel", endNoteDrag);
}

function moveNoteDrag(e) {
  if (!noteDrag) return;
  if (!noteDrag.moved) {
    if (Math.abs(e.clientX - noteDrag.sx) + Math.abs(e.clientY - noteDrag.sy) < DRAG_SLOP) return;
    noteDrag.moved = true;
    noteDrag.el.classList.add("dragging");
  }
  const w = toWorld(e.clientX, e.clientY);
  noteDrag.n.x = Math.round(w.x + noteDrag.ox);
  noteDrag.n.y = Math.round(w.y + noteDrag.oy);
  noteDrag.el.style.transform =
    `translate(${noteDrag.n.x}px, ${noteDrag.n.y}px) translate(-50%, -50%)`;
}

function endNoteDrag(e) {
  if (!noteDrag) return;
  const { n, el, ta, moved } = noteDrag;
  el.classList.remove("dragging");
  el.removeEventListener("pointermove", moveNoteDrag);
  el.removeEventListener("pointerup", endNoteDrag);
  el.removeEventListener("pointercancel", endNoteDrag);
  noteDrag = null;

  if (moved) { saveNote(n); return; }
  if (e.target.closest(".kill")) return;
  ta.focus();
}

// ── the opening ────────────────────────────────────────────────────────
// 1. frames land on the pile  2. the title fills the screen
// 3. the camera pulls back and the pile deals out onto the canvas
let introTimers = [];
function clearIntro() { introTimers.forEach(clearTimeout); introTimers = []; }

function playIntro() {
  clearIntro();
  document.body.classList.add("intro");
  title.classList.remove("on");

  frames.style.opacity = "1";
  Object.assign(cam, fitPile());
  applyCam();

  nodes.forEach((el, i) => {
    el.style.transition = "none";
    el.style.transitionDelay = "0ms";
    el.style.opacity = "0";
    el.style.transform = pose(PHOTOS[i], false) + " scale(1.14)";
  });
  void world.offsetWidth;   // flush, so the restored transition animates

  if (reduced) return finishIntro();

  nodes.forEach((el, i) => {
    introTimers.push(setTimeout(() => {
      el.style.transition = "transform .5s cubic-bezier(.2,.8,.2,1), opacity .35s ease";
      el.style.opacity = "1";
      el.style.transform = pose(PHOTOS[i], false);
    }, 180 + i * DEAL_STAGGER));
  });

  const dealt = 180 + nodes.length * DEAL_STAGGER + 450;

  // The title takes the screen; the pile hushes to a shadow underneath it.
  introTimers.push(setTimeout(() => {
    title.classList.add("on");
    frames.style.opacity = ".14";
    flyTo(frameRect(0, 0, TITLE_W, TITLE_H, 1.04), 900);
  }, dealt));

  introTimers.push(setTimeout(finishIntro, dealt + 900 + TITLE_HOLD));
}

function finishIntro() {
  clearIntro();
  title.classList.add("on");
  frames.style.opacity = "1";
  nodes.forEach((el, i) => {
    el.style.transition = "transform 1.15s cubic-bezier(.22,.9,.24,1), opacity .5s ease";
    el.style.opacity = "1";
    el.style.transitionDelay = reduced ? "0ms" : (i * 45) + "ms";
    el.style.transform = pose(PHOTOS[i], true);
    setTimeout(() => { el.style.transitionDelay = "0ms"; }, 1400);
  });
  flyTo(fitAll(), reduced ? 0 : 1200);
  document.body.classList.remove("intro");
}

// ── wiring ─────────────────────────────────────────────────────────────
document.getElementById("add").addEventListener("click", addNote);
document.getElementById("zin").addEventListener("click",
  () => zoomAt(innerWidth / 2, innerHeight / 2, 1.45));
document.getElementById("zout").addEventListener("click",
  () => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.45));
document.getElementById("fit").addEventListener("click", () => flyTo(fitAll(), 700));
document.getElementById("replay").addEventListener("click", playIntro);
document.getElementById("skip").addEventListener("click", finishIntro);

addEventListener("keydown", (e) => {
  if (e.target.matches("textarea")) {
    if (e.key === "Escape") e.target.blur();
    return;
  }
  if (e.key === "f") flyTo(fitAll(), 700);
  if (e.key === "n") addNote();
  if (e.key === "Escape") finishIntro();
});

addEventListener("resize", applyCam);

/** Is there a notes service behind this page, or is it a static host? */
async function probeBoard() {
  try {
    const res = await fetch(NOTES, { cache: "no-store" });
    if (!res.ok) return false;
    const board = await res.json();
    return typeof board.v === "number";
  } catch (e) {
    return false;
  }
}

// ── boot ───────────────────────────────────────────────────────────────
async function boot() {
  const msg = document.getElementById("boot");
  try {
    FRAMES = await measure(await loadBlocks());
  } catch (e) {
    FRAMES = [];
  }

  if (!FRAMES.length) {
    msg.textContent = "The channel didn't load. Reload to try again.";
    return;
  }

  msg.remove();
  PHOTOS = layout();
  buildFrames();
  playIntro();

  shared = await probeBoard();

  if (!shared) {
    loadLocal();
    renderNotes();
    document.getElementById("local").hidden = false;
    return;
  }

  await pullNotes();
  setInterval(pullNotes, POLL_MS);
  // A tab coming back to the front should not wait out the interval.
  addEventListener("visibilitychange", () => { if (!document.hidden) pullNotes(); });
}

boot();
