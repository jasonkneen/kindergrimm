// ---------------------------------------------------------------
// THE TIMELINE — six hundred years of painting, walked past.
//
// The style sheet (`styles.html`) is for COMPARING: the same five
// people down every column, one style per row, so the paint is the
// only variable. This page is for the other thing — seeing the
// styles as a HISTORY — and it only works if the axis is honest.
//
// The axis is linear in years and nothing is compressed, which means
// the page is mostly empty and that emptiness is the content: 190
// years of nothing between the gothic panel and Leonardo, 210 more
// between Caravaggio and Hokusai, and then impressionism, Die
// Brücke, cubism, Dada and surrealism arrive inside fifty-five years
// and pile into each other at the end of the road. You can see
// modernism detonate. A log axis, or an axis with even spacing per
// movement, would throw that away — which is why neither is used.
//
// The pile-up is handled the way a museum wall handles it: a cluster
// that would overlap its neighbour is lifted onto a higher SHELF,
// with a plumb line down to its own year on the spine. Shelves are
// already the project's furniture — every crowd row stands on one.
//
//   drag / wheel / arrows   walk along the centuries
//   ?fit                    the whole span at once
//   ?hand=graphite          the original hand
//   ?n=3                    characters per movement
//   ?shot                   draw it all synchronously, for a still
// ---------------------------------------------------------------
import * as THREE from 'three';
import { PAPER } from './sketch.js';
import { setRender, U, setHand } from './part.js';
import { addPaper, makeFloorLine, makeGround, makeBackdrop, PANEL } from './paper.js';
import { newRecipe, buildCharacter, ensureParams } from './rig.js';
import { mulberry32, hashStr } from './rng.js';
import { MEDIA, STYLE_IDS } from './media.js';
import { groundOf } from './styles/index.js';
import { createAnimator } from './anim.js';
import { brushHand } from './brush/bsketch.js';

const params = new URLSearchParams(location.search);
const PER = Math.max(1, +params.get('n') || 3);
const fit = params.has('fit');
const shot = params.has('shot');
const seed = params.get('seed') || '1';

setRender({ u: +params.get('u') || 128, frames: +params.get('frames') || (shot ? 1 : 2) });
if (params.get('hand') !== 'graphite') setHand(brushHand);

THREE.ColorManagement.enabled = false;

// ---- the axis ---------------------------------------------------
// world units per year. Chosen so that the shortest gap anyone would
// call a gap — Caravaggio to Hokusai, 210 years — reads as open road,
// and so the modern pile-up genuinely piles up.
const PER_YEAR = .045;
const FROM = 1290, TO = 1945;
const xOf = y => (y - FROM) * PER_YEAR;

const CELL_W = .95;
const CLUSTER_W = PER * CELL_W + .55;      // plus the air a cluster needs
const SHELF_H = 1.75;                      // the lift from one shelf to the next
const SPINE_Y = -1.55;

const movements = STYLE_IDS.map(id => ({ id, ...MEDIA[id] }))
  .filter(m => m.era)
  .sort((a, b) => a.era - b.era);

// Greedy shelf packing: walk the movements in date order and put each
// one on the lowest shelf where it does not touch what is already
// there. The result is the shape of art history — everything before
// 1874 sits on the ground floor, and the twentieth century stacks.
const shelfEnd = [];
for (const m of movements) {
  m.x = xOf(m.era);
  const left = m.x - CLUSTER_W / 2;
  let t = 0;
  while (t < shelfEnd.length && shelfEnd[t] > left) t++;
  m.shelf = t;
  shelfEnd[t] = m.x + CLUSTER_W / 2;
}
const SHELVES = shelfEnd.length;
const shelfY = t => SPINE_Y + .9 + t * SHELF_H;   // clear of the century ticks

const spanL = xOf(FROM) - 1.2, spanR = xOf(TO) + 1.2;
const HALF_H = (SPINE_Y + .9 + SHELVES * SHELF_H) / 2 + .9;
const MID_Y = (SPINE_Y - .9 + SPINE_Y + .9 + SHELVES * SHELF_H) / 2;

// ---- the scene --------------------------------------------------
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);
const camera = new THREE.OrthographicCamera(-1, 1, HALF_H, -HALF_H, .1, 100);
camera.position.set(fit ? (spanL + spanR) / 2 : xOf(1310), MID_Y, 10);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(shot ? 2 : Math.min(2, devicePixelRatio));
stage.appendChild(renderer.domElement);

// The camera FOLLOWS THE STAIRCASE. Standing in 1310 there is one
// shelf and the view sits down on it; walk into the twentieth century
// and the view lifts and pulls back to take in the pile-up. Framing
// the whole height everywhere instead would spend most of the page on
// six hundred years of empty air above a single shelf.
let halfW = 1, halfH = HALF_H, aspect = 1;
function frameFor(x) {
  if (fit) return { h: Math.max(HALF_H, (spanR - spanL) / 2 / aspect), y: MID_Y };
  let top = 0;
  for (const m of movements)                       // the tallest thing in shot
    if (Math.abs(m.x - x) < halfW + CLUSTER_W) top = Math.max(top, m.shelf);
  const hi = shelfY(top) + 1.5, lo = SPINE_Y - .6;   // the century ticks live in that .6
  const need = Math.max(1.9, (hi - lo) / 2);
  return { h: need, y: (hi + lo) / 2 };
}
// A phone is taller than it is wide, and a frame chosen by height
// alone shows ONE character — the timeline stops being a line. So the
// frame also has a minimum WIDTH, about four characters, and on a
// narrow screen that is what decides the zoom.
const MIN_HALF_W = 2.0;
const fitTo = f => {
  halfW = Math.max(f.h * aspect, MIN_HALF_W);
  halfH = halfW / aspect;
};

function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  aspect = w / h;
  const f = frameFor(camera.position.x);
  fitTo(f);
  camera.position.y = f.y;
  camera.top = halfH; camera.bottom = -halfH;
  camera.left = -halfW; camera.right = halfW;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
addEventListener('resize', () => { onResize(); place(); });

addPaper(scene, HALF_H, spanR - spanL + 4);

// the spine: one long drawn line with a tick at every century
const spine = makeFloorLine(spanR - spanL);
spine.position.set((spanL + spanR) / 2, SPINE_Y - spine.userData.lineDy, -1);
scene.add(spine);

for (const m of movements) {
  // each movement stands on its OWN paper — a torn mat of the ground
  // that style was painted on. Along a line they read as a row of
  // different sheets laid out on a table, which is what they are.
  const col = groundOf(m);
  if (col) {
    const g = makeGround(col, CLUSTER_W + .5, SHELF_H * .95, m.era);
    g.position.set(m.x, shelfY(m.shelf) + SHELF_H * .3, -1.8);
    scene.add(g);
  }
  const sh = makeFloorLine(CLUSTER_W);
  sh.position.set(m.x, shelfY(m.shelf) - sh.userData.lineDy, -1);
  scene.add(sh);
  if (m.shelf > 0) {                       // the plumb line down to its own year
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(m.x, shelfY(m.shelf) - .04, -1),
      new THREE.Vector3(m.x, SPINE_Y + .02, -1),
    ]);
    scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1f1d1a, transparent: true, opacity: .22 })));
  }
}

// ---- the people -------------------------------------------------
const FACE_SCALE = .58;
const cells = [];
let queue = [];
for (const m of movements) for (let i = 0; i < PER; i++) queue.push({ m, i });

function draw({ m, i }) {
  // the same people in every movement, so a face you recognise from
  // 1310 turns up again in 1929 wearing different paint
  const rnd = mulberry32(hashStr(`${seed}:${i}`));
  const recipe = newRecipe((rnd() * 1e9) | 0);
  recipe.media = m.id;
  recipe.species = ['human', 'human', 'dog', 'cat', 'nightmare'][(rnd() * 5) | 0];
  recipe.base = null;
  ensureParams(recipe);
  const face = buildCharacter(recipe);
  const holder = new THREE.Group();
  const x = m.x + (i - (PER - 1) / 2) * CELL_W;
  holder.position.set(x, shelfY(m.shelf) + (face.F.B.floorY / U) * FACE_SCALE, 0);
  holder.scale.setScalar(FACE_SCALE);
  holder.add(face.group);
  scene.add(holder);
  const back = makeBackdrop(m, CELL_W * PANEL.w, SHELF_H * PANEL.h * .82, `${seed}:${m.id}:${i}`, SHELF_H * .84);
  if (back) {
    const pan = { ...PANEL, ...(m.panel || {}) };
    back.position.set(x, shelfY(m.shelf) + SHELF_H * .82 * pan.y * back.userData.fit, -1.2);
    scene.add(back);
  }
  cells.push({ face, holder, animator: createAnimator(() => face, {
    blink: true, gaze: true, talk: false, sway: true, breath: true, boil: !shot,
    boilSpeed: .45, phase: Math.random() * 20, amp: 1.3,
  }) });
}

// ---- the type ---------------------------------------------------
// Labels are DOM, positioned from world coordinates every frame:
// dates and movement names are type, and type belongs in the page.
const labels = document.getElementById('labels');

// The GAPS get a label of their own. The empty road is the argument
// this page is making, and an unlabelled void reads as a layout
// mistake rather than as two centuries in which nothing on this sheet
// happened. Only the long ones — under eighty years the emptiness is
// not the point.
const gaps = movements.slice(1).map((m, i) => {
  const prev = movements[i], years = m.era - prev.era;
  return years >= 80 ? { x: (prev.x + m.x) / 2, years } : null;
}).filter(Boolean);

labels.innerHTML = [
  ...movements.map(m => {
    // a caption on a bole ground has to be light, or it is not a caption
    const g = groundOf(m);
    const dark = g && (g[0] * .299 + g[1] * .587 + g[2] * .114) < 140;
    return `<b class="${dark ? 'onDark' : ''}" data-x="${m.x}" data-y="${shelfY(m.shelf)}">${m.label}<i>${m.era}</i></b>`;
  }),
  ...gaps.map(g => `<s data-x="${g.x}" data-y="${SPINE_Y}">${g.years} years</s>`),
  ...Array.from({ length: Math.floor((TO - FROM) / 100) + 1 }, (_, k) => {
    const y = Math.ceil(FROM / 100) * 100 + k * 100;
    return y <= TO ? `<u data-x="${xOf(y)}" data-y="${SPINE_Y}">${y}</u>` : '';
  }),
].join('');
const marks = [...labels.children];

function place() {
  const w = stage.clientWidth, h = stage.clientHeight;
  for (const el of marks) {
    const wx = +el.dataset.x, wy = +el.dataset.y;
    const sx = (wx - camera.position.x + halfW) / (halfW * 2) * w;
    const sy = (1 - (wy - camera.position.y + halfH) / (halfH * 2)) * h;
    el.style.transform = `translate(${sx}px, ${sy}px)`;
    el.style.opacity = (sx < -140 || sx > w + 140) ? 0 : 1;
  }
}

// ---- walking along it -------------------------------------------
let target = camera.position.x;
const clampX = x => Math.min(spanR - halfW, Math.max(spanL + halfW, x));
if (!fit) {
  addEventListener('wheel', e => {
    target = clampX(target + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * .006);
  }, { passive: true });
  let drag = null;
  stage.addEventListener('pointerdown', e => { drag = e.clientX; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => {
    if (drag === null) return;
    target = clampX(target - (e.clientX - drag) / stage.clientWidth * halfW * 2);
    drag = e.clientX;
  });
  stage.addEventListener('pointerup', () => { drag = null; });
  addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') target = clampX(target + 2);
    if (e.key === 'ArrowLeft') target = clampX(target - 2);
    const n = +e.key;
    if (n >= 1 && n <= movements.length) target = clampX(movements[n - 1].x);
  });
}

const countEl = document.getElementById('count');
let last = performance.now();

function frame(now) {
  const t = now / 1000, dt = Math.min(.1, (now - last) / 1000);
  last = now;
  if (queue.length) {
    const until = performance.now() + 24;
    do { draw(queue.shift()); } while (queue.length && performance.now() < until);
    countEl.textContent = queue.length ? `painting… ${cells.length}/${cells.length + queue.length}` : '';
  }
  if (!fit) {
    camera.position.x += (target - camera.position.x) * Math.min(1, dt * 7);
    const f = frameFor(camera.position.x), k = Math.min(1, dt * 3);
    const want = Math.max(f.h * aspect, MIN_HALF_W) / aspect;
    halfH += (want - halfH) * k;
    camera.position.y += (f.y - camera.position.y) * k;
    halfW = halfH * aspect;
    camera.top = halfH; camera.bottom = -halfH;
    camera.left = -halfW; camera.right = halfW;
    camera.updateProjectionMatrix();
  }
  for (const c of cells) c.animator.update(t, dt);
  place();
  renderer.render(scene, camera);
}

onResize(); place();

if (shot) {
  while (queue.length) draw(queue.shift());
  countEl.textContent = '';
  place();
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  window.__ready = true;
} else {
  renderer.setAnimationLoop(frame);
}

window.__timeline = {
  frame, cells, movements, shelves: SHELVES,
  get drawn() { return cells.length; },
  goto(id) { const m = movements.find(x => x.id === id); if (m) target = clampX(m.x); },
  async pump(n = 1) {
    for (let i = 0; i < n; i++) { frame(last + 16.7); await new Promise(r => setTimeout(r, 0)); }
    return this.drawn;
  },
};
