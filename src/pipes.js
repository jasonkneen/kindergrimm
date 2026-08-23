// ---------------------------------------------------------------
// PIPES — a schematic that stands up.
//
// The first version of this file was an isometric grey city with fat
// glossy tubes on it, and it was wrong in a way worth writing down,
// because it is the obvious wrong answer:
//
//   * it INVERTED the colour logic. In the drawing that inspired it the
//     wires are HAIRLINE INK and colour arrives only as small solid
//     EVENTS — a disc, a square, a two-tone cap on the end of a stem.
//     Fat coloured tubes over a grey city is that board with its figure
//     and ground swapped, and it reads as plumbing.
//   * it FILLED THE FIELD. 97 rooms in 144 cells. The paper is the
//     design; a board with no empty cells has no rhythm, only density.
//   * it was LIT. Gloss, soft shadows and a 3/4 ortho view is a stock
//     idiom, and a stock idiom is the enemy of a graphic.
//
// So: no lights, no shadows, no tone mapping, no gloss. Everything is
// `MeshBasicMaterial` and one-pixel ink. What 3D is FOR here is a single
// idea, and the whole page hangs off it:
//
//   A MARK LYING IN THE PLANE IS FORESHORTENED — a disc on the board is
//   an ellipse. A MARK THAT STANDS UP IS NOT — an unlit sphere under an
//   ortho camera is a perfect circle from every angle. So HEIGHT is the
//   one thing that changes a mark's SHAPE, and as the camera sways the
//   three layers slide across each other and the composition re-cuts
//   itself without anything having moved.
//
// Three layers of schematic, hairline, mostly empty. And exactly ONE
// figure: a stem rising through all three with a gloss head on top — the
// only lit, round, real object on a flat board. One character placed is
// a composition; thirty scattered was clutter.
//
// Nothing rolls in the frame. `gen(seed)` decides everything; `frame(t)`
// only reads time.
// ---------------------------------------------------------------
import * as THREE from 'three';
import { makeRng, hashStr } from './rng.js';
import { buildGloss, newGRecipe } from './gloss/grig.js';
import { createGlossFace } from './gloss/gface.js';

// ---- the field ---------------------------------------------------------
const N = 14;              // cells a side
const GAP = 2.1;           // between schematic layers
const LAYERS = 3;
const PAPER = '#e7edf1';
const INK = '#24313a';
// five flats and nothing else. They only ever land on EVENTS.
const FLATS = ['#f2b705', '#ee7b2b', '#e2325f', '#1f9b52', '#1e6fb0'];
// a HARD CAP on colour, counted across all three layers. Restraint has
// to be a number or it does not survive a reroll.
const MARK_BUDGET = 46;

const stage = document.getElementById('stage');
const countEl = document.getElementById('count');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
// NO tone mapping: a flat colour must arrive on screen as the colour it
// was authored as. ACES is right for the gloss studio and wrong here —
// it desaturates every flat and the board goes chalky.
renderer.toneMapping = THREE.NoToneMapping;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PAPER);

// THE CHARACTERS ARE FLAT TOO. `buildGloss` takes its material factory as
// an argument, which is the whole seam: hand it one that pours unlit
// colour and the gloss rig comes out as flat shapes in the board's own
// five flats, with no studio, no environment and no light anywhere in
// this scene. A shaded character on an unshaded board is a render pasted
// onto a drawing — and a lit one is never SATURATED either, because half
// of every colour is spent on the falloff.
const plainCache = new Map();
const plainMat = c => {
  const k = String(c);
  if (!plainCache.has(k)) plainCache.set(k, new THREE.MeshBasicMaterial({ color: c }));
  return plainCache.get(k);
};
const charMaterialFor = (finish, color, shell, print) => {
  if (!print) return plainMat(color);
  // a screen-printed tee keeps its motif — that is a map, not a light.
  // `grig` has already baked it; the factory is handed the finished
  // { key, tex }, so calling `clothPrint` again here was doing the work
  // twice for the same texture.
  const k = `print:${print.key}`;
  if (!plainCache.has(k)) plainCache.set(k, new THREE.MeshBasicMaterial({ map: print.tex }));
  return plainCache.get(k);
};
const materialFor = charMaterialFor;

// ---- the reveal --------------------------------------------------------
// A new board should not CUT in — a page that is nothing but ink lines
// wants to be drawn, so it is: every line carries its own arc length as a
// vertex attribute and the fragment shader discards anything past the
// front of the stroke. The line is literally plotted, from its start to
// its end, and the plates pop in about their own centres.
//
// It is a shader and not a JS tween for one reason: there are two to three
// thousand strokes on a board and a per-frame geometry rewrite of that is
// a stutter. One uniform moves and the whole page draws.
//
// The ORDER is radial from the middle and upward through the layers, so
// the board grows out of its own centre and the top district lands last.
const REVEAL = { value: 0 };        // 0 → 1 + DRAW over REVEAL_SECS
// and its mirror. The board UNDRAWS at the end of a full turn — the same
// strokes retracting, outermost first, so the page empties the way it
// filled. A cut to a new board throws away the one thing the reveal is
// for, which is that this is a drawing and not a picture.
const ERASE = { value: 0 };
const DRAW = .45;                   // how long one stroke takes, in that scale
const REVEAL_SECS = 2.6;
const MAXR = Math.hypot(N / 2, N / 2);
// a stable positional jitter — the same board always draws in the same
// order, which is the plants lab's rule about geometry never rolling
const jit = (x, z) => {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
};
const delayFor = (x, y, z) =>
  Math.min(.999, (Math.hypot(x, z) / MAXR) * .58 + (y / (GAP * (LAYERS - 1))) * .3
                 + jit(x, z) * .09);

/** every line vertex carries `aT`, its own position along the stroke, and
 *  `aDelay`, when the stroke starts. */
function lineGeo(pts) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) { total += pts[i].distanceTo(pts[i - 1]); cum.push(total); }
  const aT = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i++) aT[i] = total > 0 ? cum[i] / total : 0;
  const c = pts[0];
  const d = delayFor(c.x, c.y, c.z);
  g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  g.setAttribute('aDelay', new THREE.BufferAttribute(new Float32Array(pts.length).fill(d), 1));
  return g;
}

/** a plate or a ball pops about its own centre — its geometry is already
 *  centred on the origin, so the vertex shader only has to scale. */
function meshGeo(geo, x, y, z) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aDelay', new THREE.BufferAttribute(
    new Float32Array(n).fill(delayFor(x, y, z)), 1));
  return geo;
}

const REVEAL_HEAD = `\n  uniform float uReveal;\n  attribute float aDelay;\n`;
const patchLine = mat => {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uReveal = REVEAL;
    sh.vertexShader = `attribute float aT;\nattribute float aDelay;\n`
      + `varying float vT;\nvarying float vD;\n`
      + sh.vertexShader.replace('void main() {', 'void main() {\n  vT = aT; vD = aDelay;');
    sh.uniforms.uErase = ERASE;
    sh.fragmentShader = `uniform float uReveal;\nuniform float uErase;\nvarying float vT;\nvarying float vD;\n`
      + sh.fragmentShader.replace('void main() {',
        `void main() {\n  float p = clamp((uReveal - vD) / ${DRAW.toFixed(3)}, 0.0, 1.0);\n`
        + `  if (vT > p) discard;\n`
        // the erase runs on the REVERSED delay, so the last strokes drawn
        // are the first to go and the board retracts toward its middle
        + `  float q = clamp((uErase - (1.0 - vD)) / ${DRAW.toFixed(3)}, 0.0, 1.0);\n`
        + `  if (vT < q) discard;`);
  };
  return mat;
};
const patchMesh = mat => {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uReveal = REVEAL;
    sh.uniforms.uErase = ERASE;
    sh.vertexShader = REVEAL_HEAD + `uniform float uErase;\n`
      + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>\n`
      + `  float p = clamp((uReveal - aDelay) / ${DRAW.toFixed(3)}, 0.0, 1.0);\n`
      // a touch of overshoot, so a mark lands rather than fades up
      + `  p = p * p * (3.0 - 2.0 * p);\n`
      + `  float e = clamp((uErase - (1.0 - aDelay)) / ${DRAW.toFixed(3)}, 0.0, 1.0);\n`
      + `  transformed *= p * (1.0 - e * e) * (1.0 + 0.18 * sin(p * 3.14159));`);
  };
  return mat;
};

// ---- one ink, three DEPTHS of it ---------------------------------------
// The layers were invisible when every one of them was drawn in the same
// black: three schematics at the same weight stack into one tangle. So
// the ink FADES WITH DEPTH — the top layer, nearest the eye, is the only
// full-strength black, and the two under it recede. That is a drafting
// convention rather than a rendering trick, which is why it survives a
// scene with no lights in it: it is the depth cue this page is allowed.
const DEPTH = [.44, .66, 1];                     // by layer, bottom → top
const matCache = new Map();
const cached = (key, make) => {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key);
};
const inkAt = l => cached(`ink${l}`, () => patchLine(new THREE.LineBasicMaterial(
  { color: INK, transparent: DEPTH[l] < 1, opacity: DEPTH[l] })));
const faintAt = l => cached(`faint${l}`, () => patchLine(new THREE.LineBasicMaterial(
  { color: INK, transparent: true, opacity: DEPTH[l] * .34 })));
const flatAt = (c, l) => cached(`f${c}:${l}`, () => patchMesh(new THREE.MeshBasicMaterial(
  { color: c, transparent: DEPTH[l] < 1, opacity: .45 + DEPTH[l] * .55 })));
// A WASH is the same flat mixed most of the way back into the paper. It
// has to be a TINT and not a flat: a saturated field is louder than every
// event on the board, and the events are the point.
const washAt = (c, l) => cached(`w${c}:${l}`, () => patchMesh(new THREE.MeshBasicMaterial(
  { color: new THREE.Color(PAPER).lerp(new THREE.Color(c), .17 * DEPTH[l]) })));

// ---- camera: a TOUR OF STATIONS, not an orbit --------------------------
// A continuous orbit has no moments in it — every frame is a three-quarter
// view of something. The board has EIGHT views worth stopping at and they
// alternate: a CORNER, where the three districts are furthest apart and
// the field reads as a diamond, and a SIDE, where the yaw is square to the
// lattice and every layer's lines project onto the layer under it — the
// grids MOUNT EACH OTHER and the three schematics collapse into one dense
// drawing. That collapse is the whole reason the layers are parallel, and
// you only ever see it from the four square angles.
//
// So the camera holds a station, moves, holds the next. The move is eased
// at both ends; the hold is what makes the alignment read as an event
// rather than as a frame you passed through.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 200);
// THE PITCH IS NOT A TASTE DECISION, it is solved. Under an ortho camera
// square to the lattice, a point at height y and depth z lands at screen
// height y·cos(p) − z·sin(p). So climbing one layer is worth exactly
// GAP/tan(p) cells of depth — and the layers' grids only MOUNT EACH OTHER
// when that is a whole number of cells. At .6 rad it was 3.07 and every
// line landed a hair off its neighbour, which reads as a printing error
// rather than as an alignment. Solve it instead: one layer up = MOUNT
// cells back, exactly.
// And the SQUARE and the DIAMOND cannot share a pitch: square-on the
// compensating offset is MOUNT cells of z, at 45° it is (Δx+Δz)·√2/2, and
// asking one pitch to make both whole numbers asks √2 to be rational. So
// each station carries its OWN solved pitch — 3 cells back square-on,
// (2,2) on the diagonal — and the camera eases between them along with
// the yaw. It is 1.6° of travel; nobody sees it move, and both stations
// land dead on.
const MOUNT = 3;
const PITCH_SQ = Math.atan(GAP / MOUNT);              // Δz = 3
const PITCH_DIA = Math.atan(GAP * Math.SQRT2 / 4);    // Δx = Δz = 2
const pitchAt = j => (j % 2 === 0 ? PITCH_SQ : PITCH_DIA);
const STATION = Math.PI / 4;      // corner, side, corner, side…
// The DWELL is the stop, and it wants to be short: long enough that the
// alignment registers as an arrival, not so long that the page is a
// slideshow. Mostly gliding, briefly landed.
const DWELL = .55, MOVE = 1.95, CYCLE = DWELL + MOVE;
const ROUND = CYCLE * 8;            // one full turn of the eight stations
const ERASE_SECS = 2.0;
const ERASE_AT = ROUND - ERASE_SECS;
let zoom = 1, dragYaw = 0, touring = true, drag = null;
// a station pinned for inspection (and for a reproducible screenshot)
let held = null;

const easeInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
/** the tour: yaw AND the pitch that makes that station's grids mount */
function tourCam(t) {
  const k = Math.floor(t / CYCLE);
  const u = t - k * CYCLE;
  const j = k + 1;                  // start on a DIAMOND: the establishing shot
  const e = u < DWELL ? 0 : easeInOut((u - DWELL) / MOVE);
  return { yaw: (j + e) * STATION, pitch: pitchAt(j) + (pitchAt(j + 1) - pitchAt(j)) * e };
}

// The frame TRACKS THE YAW. A square field projects (|cos y| + |sin y|)
// wide — √2 at the diamond, exactly 1 square-on — so a frame fitted to
// the diamond leaves the square stations swimming in half a page of
// paper. Scale the box by the same factor and every station is full.
let camYaw = Math.PI / 4;
let camPitch = 0;
function fitCamera() {
  const a = stage.clientWidth / Math.max(1, stage.clientHeight);
  const spread = (Math.abs(Math.cos(camYaw)) + Math.abs(Math.sin(camYaw))) / Math.SQRT2;
  const base = (a >= 1 ? N * .58 : N * .72) * spread / zoom;
  let hw, hh;
  if (a >= 1) { hh = base; hw = hh * a; }
  else { hw = base; hh = hw / a; }
  camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
  camera.updateProjectionMatrix();
}

// ---- helpers -----------------------------------------------------------
const C = i => i - N / 2;                       // cell index → world
const wpick = (rng, pairs) => {
  let tot = 0; for (const p of pairs) tot += p[1];
  let x = rng.r(0, tot);
  for (const p of pairs) if ((x -= p[1]) < 0) return p[0];
  return pairs[pairs.length - 1][0];
};
const line = (pts, mat, loop = false) =>
  new (loop ? THREE.LineLoop : THREE.Line)(lineGeo(loop ? pts.concat([pts[0]]) : pts), mat);

/** a filled shape LYING IN THE PLANE — foreshortened, and that is the
 *  point: a plate on the board is an ellipse. */
function plate(geo, mat, x, y, z, spin = 0) {
  const m = new THREE.Mesh(meshGeo(geo, x, y, z), mat);
  m.rotation.set(-Math.PI / 2, 0, spin);
  m.position.set(x, y, z);
  return m;
}

/** a ring lying in the plane */
function ring(rad, x, y, z, mat, seg = 44) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * rad, y, z + Math.sin(a) * rad));
  }
  return line(pts, mat, true);
}

/** waypoints → CurvePath with the corners cut. Straights are lines, each
 *  corner a quadratic — the rounded elbow the reference wires have. */
function roundedPath(pts, r = .3) {
  const path = new THREE.CurvePath();
  if (pts.length < 2) return path;
  let cur = pts[0].clone();
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const inD = a.clone().sub(cur).normalize();
    const outD = b.clone().sub(a).normalize();
    if (inD.dot(outD) > .999) continue;
    const rr = Math.min(r, cur.distanceTo(a) * .5, a.distanceTo(b) * .5);
    const p1 = a.clone().addScaledVector(inD, -rr);
    const p2 = a.clone().addScaledVector(outD, rr);
    if (p1.distanceTo(cur) > 1e-4) path.add(new THREE.LineCurve3(cur, p1));
    path.add(new THREE.QuadraticBezierCurve3(p1, a.clone(), p2));
    cur = p2;
  }
  path.add(new THREE.LineCurve3(cur, pts[pts.length - 1].clone()));
  return path;
}

// ---- the mark catalogue ------------------------------------------------
// Weighted, and the weights ARE the art direction: dots and discs carry
// the board, dials and caps are the ones you catch. Same rule as the
// gloss style tables — a uniform pick over six marks gives a board that
// is a third dials.
const MARKS = [['dot', 34], ['disc', 26], ['square', 12], ['cap', 8], ['dial', 7], ['lolli', 13]];

const RIDERS = [];         // everything that moves. `u(t)` and nothing else.

/** a mark at a point. It either LIES on the board or STANDS UP off it —
 *  the one distinction the whole page is built on. */
function mark(kind, p, rng, group, S) {
  const col = () => S.flat(rng.pick(FLATS));
  const y = p.y;
  if (kind === 'dot') {
    group.add(plate(new THREE.CircleGeometry(rng.r(.05, .08), 18), S.dot, p.x, y, p.z));
    return;
  }
  if (kind === 'disc') {
    group.add(plate(new THREE.CircleGeometry(wpick(rng, [[.1, 30], [.17, 40], [.26, 22], [.36, 8]]), 30),
                    col(), p.x, y, p.z));
    return;
  }
  if (kind === 'square') {
    const s = rng.r(.2, .32);
    group.add(plate(new THREE.PlaneGeometry(s, s), col(), p.x, y, p.z, rng.chance(.22) ? Math.PI / 4 : 0));
    return;
  }
  if (kind === 'cap') {
    // two flats stacked — the reference's capacitor
    const w = rng.r(.3, .44), h = rng.r(.1, .15);
    const ca = rng.pick(FLATS);
    const cb = FLATS[(FLATS.indexOf(ca) + rng.ri(1, 4)) % FLATS.length];
    const a = S.flat(ca), b = S.flat(cb);
    const spin = rng.chance(.5) ? Math.PI / 2 : 0;
    const n = spin ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const t = plate(new THREE.PlaneGeometry(w, h), a, p.x, y, p.z, spin);
    const u = plate(new THREE.PlaneGeometry(w, h), b, p.x, y, p.z, spin);
    t.position.addScaledVector(n, h / 2); u.position.addScaledVector(n, -h / 2);
    group.add(t, u);
    return;
  }
  if (kind === 'dial') {
    // paper disc, ink rim, three spokes — and it TURNS. A rider on a circle.
    const r = rng.r(.19, .28);
    const g = new THREE.Group();
    g.position.set(p.x, y, p.z);
    g.add(plate(new THREE.CircleGeometry(r, 30), S.paper, 0, 0, 0));
    g.add(ring(r, 0, .001, 0, S.ink));
    const spokes = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      spokes.add(line([new THREE.Vector3(0, .002, 0),
                       new THREE.Vector3(Math.cos(a) * r, .002, Math.sin(a) * r)], S.ink));
    }
    g.add(spokes);
    g.add(plate(new THREE.CircleGeometry(r * .22, 16), col(), 0, .003, 0));
    group.add(g);
    RIDERS.push({ kind: 'dial', obj: spokes, period: rng.r(6, 16), phase: rng.r(0, 9),
                  dir: rng.chance(.5) ? 1 : -1 });
    return;
  }
  // LOLLI — the mark that stands up. Ink stem, unlit ball, so the ball is
  // a true circle while everything around it is an ellipse.
  const h = rng.r(.35, .95), r = rng.r(.11, .2);
  group.add(line([new THREE.Vector3(p.x, y, p.z), new THREE.Vector3(p.x, y + h, p.z)], S.ink));
  const ball = new THREE.Mesh(meshGeo(new THREE.SphereGeometry(r, 20, 12), p.x, y + h, p.z), col());
  if (rng.chance(.45)) {
    // a slow lean in the plane it hangs in — a rider on an arc
    const piv = new THREE.Group();
    piv.position.set(p.x, y, p.z);
    ball.position.set(0, h + r * .2, 0);
    piv.add(ball); group.add(piv);
    RIDERS.push({ kind: 'swing', obj: piv, axis: rng.chance(.5) ? 'x' : 'z',
                  amp: rng.r(.06, .17), period: rng.r(4, 9), phase: rng.r(0, 9) });
  } else {
    ball.position.set(p.x, y + h + r * .2, p.z);
    group.add(ball);
  }
}

// ---- a layer of schematic ----------------------------------------------
// TWO things were wrong before this and they had the same fix.
//
// The rooms floated: isolated rectangles with paper between them, which
// reads as debris rather than as a plan. The reference TESSELLATES — the
// rooms are a partition of their field, sharing walls, interlocking, with
// the odd wall knocked out. So a district is subdivided GUILLOTINE-style
// (split, recurse) and the leaves are the rooms. That is the algorithm
// that makes the interlock, and no amount of packing gets there.
//
// And the layers were illegible: three schematics stacked at the same
// place read as one tangle however you weight the ink. So each layer owns
// a DIFFERENT DISTRICT of the field — they overlap at the edges and
// nowhere else. Now the ink fade is a second cue rather than the only
// one, and the paper between the districts is what lets each be read.
function district(rng, l) {
  // spread the three around the centre, one third of a turn apart
  const a = (l / LAYERS) * Math.PI * 2 + rng.r(-.4, .4);
  const rad = rng.r(1.6, 3.2);
  const w = rng.ri(6, 9), h = rng.ri(6, 9);
  const cx = N / 2 + Math.cos(a) * rad, cz = N / 2 + Math.sin(a) * rad;
  const x0 = Math.max(0, Math.min(N - w, Math.round(cx - w / 2)));
  const z0 = Math.max(0, Math.min(N - h, Math.round(cz - h / 2)));
  return { x0, z0, w, h };
}

/** guillotine subdivision: split, recurse, stop when small. The leaves
 *  tessellate the district exactly — shared walls, no gaps. */
function carve(rng, x, z, w, h, out, depth = 0) {
  const area = w * h;
  // Stop LATE. The first cut of this stopped at area 6 and gave four or
  // five big rooms a district — the reference's field is many small
  // rooms, and the fineness is most of what makes it read as a schematic
  // rather than as a floor plan.
  if (depth > 7 || area <= 1 || (area <= 4 && rng.chance(.5))) { out.push({ x, z, w, h }); return; }
  const vertical = w === h ? rng.chance(.5) : w > h;
  if (vertical) {
    const cut = rng.ri(1, w - 1);
    carve(rng, x, z, cut, h, out, depth + 1);
    carve(rng, x + cut, z, w - cut, h, out, depth + 1);
  } else {
    const cut = rng.ri(1, h - 1);
    carve(rng, x, z, w, cut, out, depth + 1);
    carve(rng, x, z + cut, w, h - cut, out, depth + 1);
  }
}

function genLayer(rng, l, group, budget, wires) {
  const y = l * GAP;
  const S = { ink: inkAt(l), faint: faintAt(l), dot: flatAt(INK, l),
              paper: flatAt(PAPER, l), flat: c => flatAt(c, l),
              wash: c => washAt(c, l) };
  const D = district(rng, l);

  const rooms = [];
  carve(rng, D.x0, D.z0, D.w, D.h, rooms);

  for (const r of rooms) {
    const ax = C(r.x), az = C(r.z), bx = C(r.x + r.w), bz = C(r.z + r.h);
    const corner = [new THREE.Vector3(ax, y, az), new THREE.Vector3(bx, y, az),
                    new THREE.Vector3(bx, y, bz), new THREE.Vector3(ax, y, bz)];
    // WALLS ONE AT A TIME, because a knocked-out wall is the whole
    // open-plan read and a LineLoop cannot drop one.
    for (let i = 0; i < 4; i++) {
      if (rng.chance(.16)) continue;                       // knocked out
      group.add(line([corner[i], corner[(i + 1) % 4]], S.ink));
    }
    // a WASH — a pale tint, never a flat. A saturated block of colour
    // outweighs every mark on the board and the eye goes to it instead
    // of to the events, which are the point.
    if (rng.chance(.16))
      group.add(plate(new THREE.PlaneGeometry(r.w - .04, r.h - .04), S.wash(rng.pick(FLATS)),
                      (ax + bx) / 2, y - .006, (az + bz) / 2));
    // a quarter arc inscribed in a corner — the reference's decorator
    if (rng.chance(.16) && Math.min(r.w, r.h) >= 2) {
      const rad = Math.min(r.w, r.h) - .04;
      const cx = rng.chance(.5) ? ax : bx, cz = rng.chance(.5) ? az : bz;
      const sx = cx === ax ? 1 : -1, sz = cz === az ? 1 : -1;
      const pts = [];
      for (let i = 0; i <= 36; i++) {
        const t = i / 36 * Math.PI / 2;
        pts.push(new THREE.Vector3(cx + Math.cos(t) * rad * sx, y, cz + Math.sin(t) * rad * sz));
      }
      group.add(line(pts, S.ink));
    }
  }

  // WIRES — walks along the cell edges, starting inside the district and
  // free to wander out of it into the paper. This is where colour lands.
  const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const count = rng.ri(7, 11);
  for (let i = 0; i < count; i++) {
    let x = rng.ri(D.x0, D.x0 + D.w), z = rng.ri(D.z0, D.z0 + D.h);
    let d = rng.pick(DIR);
    const pts = [new THREE.Vector3(C(x), y, C(z))];
    const len = rng.ri(2, 5);
    for (let k = 0; k < len; k++) {
      if (rng.chance(.42)) { const nd = rng.pick(DIR); if (!(nd[0] === -d[0] && nd[1] === -d[1])) d = nd; }
      if (rng.chance(.34)) {
        // the jog: one cell sideways, and the walk carries on. Two rounded
        // corners half a cell apart IS the S-meander.
        const s1 = rng.chance(.5) ? 1 : -1;
        const jx = Math.max(D.x0 - 1, Math.min(D.x0 + D.w + 1, x + d[1] * s1));
        const jz = Math.max(D.z0 - 1, Math.min(D.z0 + D.h + 1, z + d[0] * s1));
        if (jx !== x || jz !== z) { x = jx; z = jz; pts.push(new THREE.Vector3(C(x), y, C(z))); }
      }
      const step = rng.ri(1, 3);
      // CLIP TO THE DISTRICT (with one cell of overhang). A wire that
      // wanders off into the paper is a loose thread: it takes its end
      // mark out of the composition and draws a long bare line to nowhere.
      const nx = Math.max(D.x0 - 1, Math.min(D.x0 + D.w + 1, x + d[0] * step));
      const nz = Math.max(D.z0 - 1, Math.min(D.z0 + D.h + 1, z + d[1] * step));
      if (nx === x && nz === z) break;
      x = nx; z = nz;
      pts.push(new THREE.Vector3(C(x), y, C(z)));
    }
    if (pts.length < 2) continue;
    const path = roundedPath(pts);
    if (path.getLength() < .8) continue;
    group.add(line(path.getPoints(Math.max(24, pts.length * 12)), S.ink));

    for (const u of [0, 1]) {
      if (budget.marks <= 0) break;
      if (!rng.chance(.9)) continue;
      mark(wpick(rng, MARKS), path.getPointAt(u), rng, group, S);
      budget.marks--;
    }
    // long enough to be worth walking: the cast picks from these
    if (path.getLength() > 1.8) wires.push({ path, y, l });
    if (rng.chance(.5)) {
      const bead = plate(new THREE.CircleGeometry(rng.r(.08, .13), 20),
                         S.flat(rng.pick(FLATS)), 0, y + .006, 0);
      group.add(bead);
      RIDERS.push({ kind: 'slide', obj: bead, path, y: y + .006,
                    period: rng.r(6, 15), phase: rng.r(0, 20) });
    }
  }

  // LOOSE MARKS — a few standing in the district's own rooms, on no wire.
  const loose = rng.ri(5, 9);
  for (let i = 0; i < loose && budget.marks > 0; i++) {
    const p = new THREE.Vector3(C(rng.ri(D.x0, D.x0 + D.w)), y, C(rng.ri(D.z0, D.z0 + D.h)));
    mark(wpick(rng, MARKS), p, rng, group, S);
    budget.marks--;
  }
  return D;
}

// ---- the inhabitants ---------------------------------------------------
// ONE was a composition and thirty was clutter; four is a cast. They are
// made of the board's own five flats (the `circuit` palette, added to
// `gpalette.js` and kept out of its deal exactly the way `skin` is), so
// they belong to the drawing instead of sitting on top of it — a pastel
// character among signal-red marks reads as a sticker.
//
// The TALL one still pierces every layer on its stem and is the figure.
// The others STAND on a layer, in a district, small: inhabitants of a
// schematic rather than a second focal point.
const FIGURES = [];

// THE CAST IS NEVER BEHIND THE BOARD. A walker on the bottom layer was
// seen through two grids of hairline and the lift vanished behind every
// plate it rose past — a character is the one round, real thing here and
// the board kept cutting it. So the cast lives on its own render layer and
// `frame` draws the board, clears DEPTH, and draws the cast over it: every
// character still occludes itself correctly (a maw behind its own head
// stays behind it) and the cast still sorts among ITSELF, but no stroke or
// plate of the schematic can ever come in front of one. `depthTest:false`
// per mesh would have been cheaper to write and wrong — face features
// would then be drawn in mesh order, through the back of the skull.
const CAST_LAYER = 1;

// A character costs ~14ms to build and there are fourteen of them, so
// building the cast inside `gen` cost 120–200ms — a dozen dropped frames
// at exactly the moment the board is supposed to be drawing itself
// smoothly. It is measured in the HUD, so it cannot quietly come back.
//
// So `gen` only PLANS them: it rolls each recipe seed and position off the
// board's rng (which keeps the whole board deterministic, the plants
// lab's rule) and leaves an empty group in place. They HATCH one per
// frame, each a little before its own reveal delay comes due — fourteen
// builds spread over fourteen frames instead of one stall.
function planChar(rng, group, x, y, z, headH, delay) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(0);
  group.add(g);
  const f = { g, seed: rng.ri(1, 1e9), built: null, life: null,
              base: y, headH, scale: 0, delay, bob: rng.r(0, 9), ride: null };
  FIGURES.push(f);
  return f;
}

function hatch(f) {
  const recipe = newGRecipe(f.seed);
  recipe.palette = 'circuit';        // ??= in ensureGParams — a pin wins
  recipe.material = 'rubber';        // matte: a clearcoat lobe on a flat board
  const built = buildGloss(recipe, { materialFor });
  built.group.position.y = -built.bounds.minY;
  f.g.add(built.group);
  // the cast is on its own render layer — see CAST_LAYER in `frame`
  f.g.traverse(o => o.layers.set(CAST_LAYER));
  f.scale = f.headH / built.L.H;
  f.built = built;
  f.life = createGlossFace(built, { gaze: true });
  return f;
}

// A CAST, and a range of SIZES — that is the point of a dozen of them
// rather than three. The big one is the figure; the walkers are
// inhabitants; and the tiny ones are the size of a disc mark, so the board
// reads as marks until you look twice and find some of them have faces.
// That only works if they are genuinely mark-sized, so they are.
const CAST = { walkers: [3, 4], tiny: [6, 9] };

function buildFigures(rng, group, districts, wires) {
  // THE FIGURE rides its own stem like a lift — a rider on a vertical
  // line, passing up and down through all three layers.
  const top = districts[LAYERS - 1];
  const x = C(rng.ri(top.x0 + 1, top.x0 + top.w - 1));
  const z = C(rng.ri(top.z0 + 1, top.z0 + top.h - 1));
  const y = (LAYERS - 1) * GAP + rng.r(.5, .85);
  group.add(line([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, y, z)], inkAt(LAYERS - 1)));
  for (let l = 0; l < LAYERS; l++) group.add(ring(.26, x, l * GAP + .002, z, faintAt(l), 30));
  const lift = planChar(rng, group, x, y, z, 1.15, .86);
  lift.ride = { kind: 'lift', lo: rng.r(.15, .6), hi: y,
                period: rng.r(6, 9.5), phase: rng.r(0, 9) };

  // the wires are the roads. Longest first, so the big walkers get the
  // long runs and the tiny ones take whatever is left.
  const pool = wires.slice().sort((a, b) => b.path.getLength() - a.path.getLength());
  let next = 0;
  const takeWire = () => (next < pool.length ? pool[next++] : null);

  const walk = (headH, delayBias) => {
    const w = takeWire();
    if (!w) return null;
    const p0 = w.path.getPointAt(0);
    const c = planChar(rng, group, p0.x, w.y, p0.z, headH,
                       delayBias ?? delayFor(p0.x, w.y, p0.z));
    // the period is per LENGTH, not per walker: a long wire and a short
    // one crossed in the same time means two different speeds, and the
    // short one looks like it is being dragged.
    c.ride = { kind: 'walk', path: w.path, y: w.y, yaw: 0,
               period: Math.max(3.2, w.path.getLength() * rng.r(.7, 1.15)),
               phase: rng.r(0, 20) };
    return c;
  };

  for (let i = 0; i < rng.ri(...CAST.walkers); i++) walk(rng.r(.6, .85));

  // and the tiny ones: some walking whatever wire is left, the rest
  // standing about in the rooms, on every layer.
  const tiny = rng.ri(...CAST.tiny);
  for (let i = 0; i < tiny; i++) {
    const h = rng.r(.2, .34);
    if (rng.chance(.55) && next < pool.length) { walk(h); continue; }
    const l = rng.ri(0, LAYERS - 1);
    const D = districts[l];
    const cx = C(rng.ri(D.x0, D.x0 + D.w)), cz = C(rng.ri(D.z0, D.z0 + D.h));
    planChar(rng, group, cx, l * GAP, cz, h, delayFor(cx, l * GAP, cz));
  }
}

// ---- gen ----------------------------------------------------------------
let board = null, seed = (Math.random() * 1e9) | 0, t0 = null, last = 0;
// a pinned clock, for inspecting one moment of the reveal with the
// rAF loop still running — the loop would otherwise overwrite any
// hand-called `frame` before a screenshot could be taken
let frozen = null;

function gen(s) {
  const t0ms = performance.now();
  // the module's seed IS whatever is on screen. The auto-regen at the end
  // of a turn calls this directly, and without this line `__pipes.seed`
  // and the R key still referred to the board before last.
  seed = s;
  if (board) { scene.remove(board.group); board.group.traverse(o => o.geometry?.dispose()); }
  RIDERS.length = 0; FIGURES.length = 0;
  const rng = makeRng(hashStr(`pipes:${s}`));
  const group = new THREE.Group();
  const budget = { marks: MARK_BUDGET };
  const districts = [], wires = [];
  for (let l = 0; l < LAYERS; l++) districts.push(genLayer(rng, l, group, budget, wires));
  buildFigures(rng, group, districts, wires);
  scene.add(group);
  board = { group, seed: s, marks: MARK_BUDGET - budget.marks,
            buildMs: Math.round(performance.now() - t0ms) };
  t0 = null;
  if (countEl) countEl.textContent =
    `seed ${s} · ${LAYERS} layers · ${board.marks} marks · ${RIDERS.length} moving · `
    + `${FIGURES.length} characters · ${board.buildMs}ms`;
}

// ---- frame --------------------------------------------------------------
const pingpong = x => { const f = ((x % 2) + 2) % 2; return f < 1 ? f : 2 - f; };
const smooth = x => x * x * (3 - 2 * x);
const _p = new THREE.Vector3(), _t = new THREE.Vector3();

function frame(t, dt = 1 / 60) {
  // THE REVEAL is a function of t, not an accumulator: `gen` resets the
  // clock, so a board always draws itself the same way and `pump` can
  // drive it with the panel hidden.
  REVEAL.value = Math.min(1 + DRAW, (t / REVEAL_SECS) * (1 + DRAW));
  // and the mirror at the end of the turn
  ERASE.value = t < ERASE_AT ? 0
    : Math.min(1 + DRAW, ((t - ERASE_AT) / ERASE_SECS) * (1 + DRAW));
  const gone = ERASE.value > 0 ? Math.min(1, (t - ERASE_AT) / ERASE_SECS) : 0;

  // the camera is resolved BEFORE anything else, because the cast faces it
  const cam = touring && held === null ? tourCam(t)
            : { yaw: (held ?? 1) * STATION, pitch: pitchAt(held ?? 1) };
  const camY = dragYaw + cam.yaw;

  for (const r of RIDERS) {
    if (r.kind === 'slide') {
      r.path.getPointAt(smooth(pingpong(t / r.period + r.phase)), _p);
      r.obj.position.set(_p.x, r.y, _p.z);
    } else if (r.kind === 'dial') {
      r.obj.rotation.y = (t / r.period + r.phase) * Math.PI * 2 * r.dir;
    } else if (r.kind === 'swing') {
      r.obj.rotation[r.axis] = Math.sin((t / r.period + r.phase) * Math.PI * 2) * r.amp;
    }
  }
  for (const f of FIGURES) {
    if (!f.built) continue;
    // in on its own delay, out with the board
    const up = Math.max(0, Math.min(1, (t - f.delay * REVEAL_SECS) / .55));
    const e = up * up * (3 - 2 * up);
    f.g.scale.setScalar(f.scale * e * (1 - gone * gone) * (1 + .16 * Math.sin(e * Math.PI)));
    const hd = f.life.update(t + f.bob, dt);
    const h = f.built.head;
    h.position.set(hd.x, h.userData.restY + hd.y, 0);
    h.rotation.set(hd.pitch, hd.yaw, hd.rot);
    const R = f.ride;
    if (R && R.kind === 'walk') {
      const u = smooth(pingpong(t / R.period + R.phase));
      R.path.getPointAt(u, _p);
      f.g.position.set(_p.x, R.y + Math.sin(t * .5 + f.bob) * .03, _p.z);
      // FACE THE WAY IT IS GOING. A walker was briefly yaw-billboarded to
      // the camera so its face never turned away — but a character whose
      // feet go one way and whose face holds still is a sprite being
      // dragged, and the turn at the end of a run is worth watching. It
      // turns the SHORT way round, so it never unwinds the long way.
      R.path.getTangentAt(u, _t);
      const fwd = ((t / R.period + R.phase) % 2 + 2) % 2 < 1 ? 1 : -1;
      const want = Math.atan2(_t.x * fwd, _t.z * fwd);
      const d = Math.atan2(Math.sin(want - R.yaw), Math.cos(want - R.yaw));
      R.yaw += d * Math.min(1, dt * 6);
      f.g.rotation.y = R.yaw;
    } else if (R && R.kind === 'lift') {
      const u = smooth(pingpong(t / R.period + R.phase));
      f.g.position.y = R.lo + (R.hi - R.lo) * u;
      f.g.rotation.y = Math.sin(t * .3 + f.bob) * 1.1;
    } else {
      // a stander still turns on the spot, or fourteen characters include
      // a handful of statues
      f.g.position.y = f.base + Math.sin(t * .8 + f.bob) * .05;
      f.g.rotation.y = Math.sin(t * .27 + f.bob) * 1.4;
    }
  }

  // the camera walks its stations — see `tourYaw`
  const y = camY, PITCH = cam.pitch;
  // ORBIT THE TARGET, not the origin. Placed about the origin and aimed at
  // a raised target, the view direction's pitch is not PITCH — it was
  // .581 against a .611 placement, which is exactly the 3.195-cells-per-
  // layer that stopped the grids mounting. The target's height has to be
  // in the position too.
  if (y !== camYaw || PITCH !== camPitch) { camYaw = y; camPitch = PITCH; fitCamera(); }
  const d = 60, ty = GAP;
  camera.position.set(Math.sin(y) * Math.cos(PITCH) * d, ty + Math.sin(PITCH) * d,
                      Math.cos(y) * Math.cos(PITCH) * d);
  camera.lookAt(0, ty, 0);
  // two passes: the board, then the cast over it (see CAST_LAYER). The
  // scene has a Color background, and three.js clears for that whatever
  // `autoClear` says — so the second pass switches off only the COLOUR
  // clear and lets the forced clear wipe depth, which is the point.
  camera.layers.set(0);
  renderer.render(scene, camera);
  camera.layers.set(CAST_LAYER);
  renderer.autoClearColor = false;
  renderer.render(scene, camera);
  renderer.autoClearColor = true;
  camera.layers.set(0);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (t0 === null) { t0 = now; last = now; }
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const t = frozen !== null ? frozen : (now - t0) / 1000;
  // A FULL TURN, then a new board. The regen lives here and not in
  // `frame` on purpose: `frame` has to stay a pure function of t so
  // `pump` and the determinism checks can drive it.
  if (frozen === null && t >= ROUND) { gen((Math.random() * 1e9) | 0); return; }
  // one hatch a frame, a little ahead of when it is due on screen
  const due = FIGURES.find(f => !f.built && t >= f.delay * REVEAL_SECS - .4);
  if (due) hatch(due);
  frame(t, dt);
}

// ---- input --------------------------------------------------------------
function resize() { renderer.setSize(stage.clientWidth, stage.clientHeight); fitCamera(); }
addEventListener('resize', resize);
stage.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw: dragYaw }; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', e => { if (drag) dragYaw = drag.yaw + (e.clientX - drag.x) * .005; });
stage.addEventListener('pointerup', () => { drag = null; });
stage.addEventListener('wheel', e => {
  zoom = Math.max(.6, Math.min(3.2, zoom * (e.deltaY > 0 ? .92 : 1.08))); fitCamera();
}, { passive: true });
addEventListener('keydown', e => {
  if (e.key === ' ') { touring = !touring; e.preventDefault(); }
  if (e.key === 'r' || e.key === 'R') { seed = (Math.random() * 1e9) | 0; gen(seed); }
});

const q = new URLSearchParams(location.search);
if (q.get('seed')) seed = +q.get('seed');
resize();
gen(seed);
requestAnimationFrame(loop);

window.__pipes = {
  get seed() { return seed; },
  gen: s => { gen(s ?? ((Math.random() * 1e9) | 0)); return seed; },
  frame, riders: RIDERS, renderer, scene, camera,
  /** pin a station. EVEN k is square to the lattice — the layers'
   *  lines mount each other; ODD k is the diamond. */
  station: k => { held = k; return k === null ? 'touring' : (k % 2 ? 'diamond' : 'square'); },
  /** build every planned character at once — the tests and `pump` need
   *  the cast present without waiting for the loop to hatch it */
  settle: () => { for (const f of FIGURES) if (!f.built) hatch(f); return FIGURES.length; },
  figures: FIGURES,
  /** pin the clock (null to release) — inspect one frame of the reveal */
  freeze: t => { frozen = t; return t; },
  reveal: () => REVEAL.value,
  board: () => board,
  async pump(n = 60, dt = 1 / 60) {
    for (let i = 0; i < n; i++) { frame(i * dt, dt); await new Promise(r => setTimeout(r, 0)); }
  },
};
