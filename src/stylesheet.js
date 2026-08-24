// ---------------------------------------------------------------
// THE STYLE SHEET — the same people, painted nine ways.
//
// A contact sheet, like `items.html` is for objects: one ROW per
// style, in era order, and the SAME seeds down every column, so the
// only thing that changes across a row is the painting. That is what
// makes it a comparison instead of a gallery.
//
// It draws through whichever hand you ask for (`?hand=brush` is the
// default here, because the styles have more to say through
// p5.brush), and it fills progressively, one character a frame, like
// the crowd does.
//
//   ?style=cubism   one style, a bigger row of it
//   ?hand=graphite  the same sheet in the original hand
//   ?seed=7         pin the people
//   ?n=5            how many per row
//   ?shot           draw it all synchronously, for a headless still
// ---------------------------------------------------------------
import * as THREE from 'three';
import { PAPER } from './sketch.js';
import { setRender, U, setHand } from './part.js';
import { addPaper, makeFloorLine, makeGround, makeBackdrop, PANEL } from './paper.js';
import { newRecipe, buildCharacter, ensureParams } from './rig.js';
import { mulberry32, hashStr } from './rng.js';
import { MEDIA, STYLE_IDS, ALL_MEDIA_IDS } from './media.js';
import { groundOf } from './styles/index.js';
import { createAnimator } from './anim.js';
import { brushHand } from './brush/bsketch.js';

const params = new URLSearchParams(location.search);
const one = ALL_MEDIA_IDS.includes(params.get('style')) ? params.get('style') : null;
const rows = one ? [one] : STYLE_IDS;
const COLS = +params.get('n') || (one ? 6 : 5);
const seed = params.get('seed') || '1';
const species = params.get('species') || 'human';
const shot = params.has('shot');

setRender({ u: +params.get('u') || (one ? 150 : 122), frames: +params.get('frames') || (shot ? 1 : 2) });
if (params.get('hand') !== 'graphite') setHand(brushHand);

THREE.ColorManagement.enabled = false;

const ROWS = rows.length, N = COLS * ROWS;
// The rows are further apart than the characters need, because a
// style may now paint the SPACE behind its figure (`backdrop`) and an
// arched polyptych panel or a landscape window is taller than the
// person standing in it. At 1.36 the gothic arches were cutting into
// the renaissance band above them.
const CELL_W = 1.0, CELL_H = one ? 1.72 : 1.62, FACE_SCALE = one ? .72 : .6;
const HALF_H = ROWS * CELL_H / 2 + .3;
// the sheet is CONTAINED, not cropped: a page of nine rows on a wide
// screen is letterboxed left and right rather than shrunk to a ribbon
// down the middle, which is what fitting the height alone gives you
const HALF_W = COLS * CELL_W / 2 + .55 + (one ? 0 : .9);   // room for the captions
const rowFloorY = r => -(r - (ROWS - 1) / 2) * CELL_H - CELL_H * .40;

const stage = document.getElementById('stage');
const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);
const camera = new THREE.OrthographicCamera(-1, 1, HALF_H, -HALF_H, .1, 100);
camera.position.set(one ? 0 : .45, 0, 10);   // the captions take the left
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(shot ? 2 : Math.min(2, devicePixelRatio));
stage.appendChild(renderer.domElement);

let camHalfW = HALF_W;

function onResize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const k = Math.max(HALF_W / (w / h), HALF_H);          // contain
  camHalfW = k * w / h;
  camera.top = k; camera.bottom = -k;
  camera.left = -camHalfW; camera.right = camHalfW;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  widenBands();
}
addEventListener('resize', onResize);

addPaper(scene, Math.max(HALF_H, HALF_W));

// Every row is painted on its OWN paper (see `styles/index.js`): a
// torn band of the style's ground, laid over drawai's cream and under
// the paper's tooth, so the grain still reads across it. The band is
// authored one unit wide and stretched to whatever the camera turns
// out to be showing, so it always runs off both edges of the page.
const bands = [];
const widenBands = () => { for (const b of bands) b.scale.x = camHalfW * 2 + 1.2; };

for (let r = 0; r < ROWS; r++) {
  const col = groundOf(MEDIA[rows[r]]);
  if (col) {
    const g = makeGround(col, 1, CELL_H * .99, r);
    g.position.y = rowFloorY(r) + CELL_H * .38;
    scene.add(g); bands.push(g);
  }
  const fl = makeFloorLine(COLS * CELL_W + .6);
  fl.position.set(0, rowFloorY(r) - fl.userData.lineDy, -1);
  scene.add(fl);
}

// the labels live in the DOM, not the scene: a style's name is a
// caption, and captions belong in type
const labels = document.getElementById('labels');
function placeLabels() {
  const h = stage.clientHeight;
  const k = camera.top;
  labels.innerHTML = rows.map((id, r) => {
    const y = (1 - (rowFloorY(r) + k) / (k * 2)) * h;
    const m = MEDIA[id];
    // a caption on a bole ground has to be light, or it is not a caption
    const g = groundOf(m);
    const dark = g && (g[0] * .299 + g[1] * .587 + g[2] * .114) < 140;
    return `<b class="${dark ? 'onDark' : ''}" style="top:${y - 16}px">${m.label}${m.era ? `<i>${m.era}</i>` : ''}</b>`;
  }).join('');
}

const cellPos = i => [
  ((i % COLS) - (COLS - 1) / 2) * CELL_W,
  -((i / COLS | 0) - (ROWS - 1) / 2) * CELL_H,
];

const cells = new Array(N).fill(null);
const cellsBack = [];
let queue = [...Array(N).keys()];

function drawCell(i) {
  const col = i % COLS, row = i / COLS | 0;
  // the SAME person down every column, so a row is the only variable
  const rnd = mulberry32(hashStr(`${seed}:${col}`));
  const recipe = newRecipe((rnd() * 1e9) | 0);
  recipe.media = rows[row];
  recipe.species = species === 'all' ? ['human', 'human', 'dog', 'cat', 'nightmare'][(rnd() * 5) | 0] : species;
  recipe.base = null;
  ensureParams(recipe);
  const face = buildCharacter(recipe);
  const holder = new THREE.Group();
  holder.position.set(cellPos(i)[0], rowFloorY(row) + (face.F.B.floorY / U) * FACE_SCALE, 0);
  holder.scale.setScalar(FACE_SCALE);
  holder.add(face.group);
  scene.add(holder);
  // the space this character stands in, if its style paints one
  const m = MEDIA[recipe.media];
  const back = makeBackdrop(m, CELL_W * PANEL.w, CELL_H * PANEL.h, `${seed}:${i}`, CELL_H * .88);
  if (back) {
    const pan = { ...PANEL, ...(m.panel || {}) };
    back.position.set(cellPos(i)[0], rowFloorY(row) + CELL_H * pan.y * back.userData.fit, -1.2);
    scene.add(back);
    cellsBack.push(back);
  }
  const opts = { blink: true, gaze: true, talk: false, sway: true, breath: true, boil: !shot,
                 boilSpeed: .45, phase: Math.random() * 20, amp: 1.3 };
  cells[i] = { i, recipe, face, holder, animator: createAnimator(() => face, opts) };
}

const countEl = document.getElementById('count');
let last = performance.now();

function frame(now) {
  const t = now / 1000, dt = Math.min(.1, (now - last) / 1000);
  last = now;
  if (queue.length) {
    const until = performance.now() + 24;
    do { drawCell(queue.shift()); } while (queue.length && performance.now() < until);
    countEl.textContent = queue.length ? `painting… ${N - queue.length}/${N}` : '';
  }
  for (const c of cells) if (c) c.animator.update(t, dt);
  renderer.render(scene, camera);
}

onResize(); placeLabels();
addEventListener('resize', placeLabels);

if (shot) {
  // A still wants everything on the sheet before the first paint and
  // nothing moving afterwards. It still renders on the LOOP: a
  // headless screenshot composites whenever it likes, and a canvas
  // drawn once before that comes out blank however the drawing buffer
  // was configured.
  while (queue.length) drawCell(queue.shift());
  countEl.textContent = '';
  document.title = `styles — ${rows.join(', ')}`;
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  window.__ready = true;
} else {
  renderer.setAnimationLoop(frame);
}

// ---- the flicker check ------------------------------------------
// A style may not ROLL a decision that changes the composition. Every
// part is drawn once per boil frame with a different seed, so
// `s.chance(.5)` deciding whether a shape gets a halo, a sky or a
// torn patch means it appears and disappears two or three times a
// second on every animated page. Texture may roll — that IS the boil
// — but structure may not.
//
// A still cannot show that, so it is measured: draw both boil frames
// of every part, average each down to a coarse grid, and compare. The
// boil moves a few percent; a halo blinking on and off does not.
//
//   __styles.flicker('gothic')   -> [{ part, diff }, …], worst first
async function flicker(style, seed = 4242) {
  const { newRecipe: nr, ensureParams: ep, buildCharacter: bc } = await import('./rig.js');
  const { setRender: sr } = await import('./part.js');
  sr({ frames: 2 });
  const r = nr(seed); r.media = style; r.species = 'human'; ep(r);
  const face = bc(r);
  const G = 16, tmp = document.createElement('canvas');
  tmp.width = tmp.height = G;
  const tc = tmp.getContext('2d', { willReadFrequently: true });
  const grid = cv => { tc.clearRect(0, 0, G, G); tc.drawImage(cv, 0, 0, G, G);
                       return tc.getImageData(0, 0, G, G).data; };
  const out = [];
  for (const e of face.entries) {
    const fr = e.part.canvases[e.part.cur.state];
    if (!fr || fr.length < 2) continue;
    const a = grid(fr[0]), b = grid(fr[1]);
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    out.push({ part: e.part.name, diff: +(d / a.length / 255).toFixed(4) });
  }
  face.dispose();
  return out.sort((x, y) => y.diff - x.diff);
}

// ---- the audit --------------------------------------------------
// A style is handed whatever outline a part happens to have, and some
// of them are degenerate: a two-point sliver, a zero-area shape, a
// horn 6px across. A style that throws on one of those takes the
// whole character down — worse than looking wrong, because nothing
// downstream renders at all. So every style is built against every
// species and timed.
//
//   await __styles.audit()   -> [{ style, ok, ms, error }]
async function audit(ids = null) {
  const { newRecipe: nr, ensureParams: ep, buildCharacter: bc } = await import('./rig.js');
  const { ALL_MEDIA_IDS: all } = await import('./media.js');
  const SPECIES = ['human', 'dog', 'cat', 'nightmare'];
  const out = [];
  for (const id of ids || all) {
    let ok = true, error = null, n = 0;
    const t0 = performance.now();
    for (const sp of SPECIES) for (let k = 0; k < 3; k++) {
      try {
        const r = nr(1000 + k * 7); r.media = id; r.species = sp; r.base = null;
        ep(r); bc(r).dispose(); n++;
      } catch (e) { ok = false; error ??= `${sp}/${k}: ${e.message}`; }
    }
    out.push({ style: id, ok, ms: Math.round((performance.now() - t0) / Math.max(1, n)), error });
  }
  return out;
}

window.__styles = {
  frame, cells, rows, N, flicker, audit,
  get drawn() { return N - queue.length; },
  async pump(n = 1) {
    for (let i = 0; i < n; i++) { frame(last + 16.7); await new Promise(r => setTimeout(r, 0)); }
    return this.drawn;
  },
};
