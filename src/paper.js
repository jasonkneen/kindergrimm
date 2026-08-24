// The page everything is drawn on: cream stock, a signature in the
// corner, fold creases, and a layer of paper tooth ON TOP of the art
// (paper-colored speckle, invisible against the page, breaking up the
// graphite so it reads as pigment sitting in the grain).
import * as THREE from 'three';
import { PAPER, PR, Sketch } from './sketch.js';
import { mulberry32, hashStr } from './rng.js';
import { hand, U } from './part.js';

// a floor: one long pencil line with a few grass ticks and scuffs
// under it. Scenes stand characters on this using F.B.floorY.
export function makeFloorLine(widthU) {
  const PXW = Math.min(2048, Math.round(widthU * 150)), PXH = 44;
  const s = new Sketch(PXW, PXH);
  s.boil((Math.random() * 1e9) | 0);
  const y = 14;
  const pts = [];
  for (let x = 8; x <= PXW - 8; x += 60) pts.push([x, y + s.jr(-1.5, 1.5)]);
  s.sline(pts, 2.4, .5);
  // the odd second pass where the pencil went back over it
  if (s.chance(.7)) {
    const a = s.jr(.15, .7), b = a + s.jr(.1, .25);
    // `| 0 + 2` parses as `| 2`, which on a short line can slice a
    // single point out — harmless now that sline guards, but wrong
    s.sline(pts.slice((pts.length * a) | 0, ((pts.length * b) | 0) + 2), 2, .3);
  }
  for (let i = 0; i < PXW / 38; i++) {
    const x = s.jr(12, PXW - 12);
    if (s.chance(.6)) s.sline([[x, y + 3], [x + s.jr(-4, 4), y + s.jr(9, 18)]], 1.3, .35);
    else s.sline([[x - s.jr(3, 7), y + s.jr(6, 10)], [x + s.jr(3, 7), y + s.jr(6, 10)]], 1.2, .25);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(widthU, PXH / 150),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s.canvas), transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = -50;
  // the drawn line is above the canvas centre; scenes place the mesh
  // at (floor target - lineDy) so the LINE is where the feet land
  mesh.userData.lineDy = (PXH / 2 - y) / 150;
  return mesh;
}

// `wideU` is for a page that is much longer than it is tall — the
// timeline is thirty world units of paper. Without it the sheet is
// one stretched copy of the texture and the paper's tooth blows up
// into visible blobs; with it the grain REPEATS along the page at its
// own scale, which is what a long sheet of paper does.
// A BACKDROP: the space a character stands IN, painted by the style.
//
// This is the hook that lets a style stop being a palette and a
// texture. `tone / skin / edge` can only ever answer for a shape the
// drawing already has, which is enough for the movements defined by
// MARK — a woodcut, a photomontage, a broken-colour canvas — and
// hopeless for the ones defined by FORM or by MEANING. A gothic panel
// is not a tint, it is a gold space with an arch over it; a Caravaggio
// is a figure emerging from a void; a surrealist picture is an
// ordinary painting with one impossible thing in it. None of those
// live on the character. They live behind it.
//
// So a style may export `backdrop(s, { w, h, seed })` and draw
// whatever it likes onto a transparent panel that hangs behind the
// figure. It is drawn ONCE per character, not per boil frame, so it
// may be as expensive as it needs to be — and it is drawn by the
// current HAND, so it comes out of p5.brush on the brush pages.
//
// It may also say what SHAPE of panel it wants, in multiples of the
// cell: `panel = { w, h, y }`. A gothic polyptych wants a tall arch
// standing on the shelf; a surrealist landscape wants a wide, low
// window. The default is a little taller than the cell, centred on
// the figure.
export const PANEL = { w: 1.04, h: 1.2, y: .52 };
// `maxH` is the page's business, not the style's: a style says what
// SHAPE of panel it wants and the page says how much room there is.
// An arched polyptych compartment asked for 1.12 cells and the sheet's
// rows are one cell apart, so the arches grew up into the row above
// them until the page was a stack rather than a comparison. The whole
// panel is scaled to fit, so the shape survives and only its size
// gives.
export function makeBackdrop(m, wU, hU, seed, maxH = Infinity) {
  if (!m || typeof m.backdrop !== 'function') return null;
  const pan = { ...PANEL, ...(m.panel || {}) };
  wU *= pan.w / PANEL.w; hU *= pan.h / PANEL.h;
  const fit = Math.min(1, maxH / hU);
  wU *= fit; hU *= fit;
  const W = Math.max(8, Math.round(wU * U)), H = Math.max(8, Math.round(hU * U));
  const s = hand(W, H);
  s.boil(hashStr(`backdrop:${seed}`));
  if (m.ink) s.setBaseInk(m.ink);
  // where the figure's FEET are on this panel, so a backdrop can put a
  // horizon behind them, a cast shadow under them or an arch over them
  // without having to know anything about the page's layout
  m.backdrop(s, { w: W, h: H, seed, floor: H * (pan.y / pan.h + .5) });
  s.done?.();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(wU, hU),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(s.canvas), transparent: true, depthWrite: false }),
  );
  mesh.position.z = -1.2;
  mesh.renderOrder = -80;      // over the ground, under every part
  mesh.userData.fit = fit;     // the page needs it to place the panel
  return mesh;
}

// A GROUND: the paper a style is painted on, laid over drawai's cream
// (see `src/styles/index.js`). It is TORN, not cut — nine rectangles
// of flat colour is a swatch chart, nine hand-torn sheets is a table
// with work on it, and the difference is these twenty lines. The tear
// is seeded, so a still of the page is the same still every time.
export function makeGround(col, wU, hU, seed = 1) {
  const rnd = mulberry32(hashStr(`ground:${seed}`));
  const shape = new THREE.Shape();
  const N = 44, ph = rnd() * 7;
  const edge = (y, dir) => {
    for (let i = 0; i <= N; i++) {
      const t = dir > 0 ? i / N : 1 - i / N;
      const wob = (Math.sin(t * 21 + ph) * .3 + Math.sin(t * 7.3 + ph * 2) * .5 + (rnd() - .5)) * .04;
      const x = (t - .5) * wU, yy = y + wob * hU;
      i ? shape.lineTo(x, yy) : shape.moveTo(x, yy);
    }
  };
  edge(hU / 2, 1); edge(-hU / 2, -1); shape.closePath();
  const g = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(`rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`), depthWrite: false,
    }),
  );
  g.position.z = -1.8;
  g.renderOrder = -90;
  return g;
}

export function addPaper(scene, halfH, wideU = 0) {
  const W = 1200, H = 900;
  const natural = 2 * halfH * (W / H) * 1.6;
  const wU = Math.max(natural, wideU), hU = 2 * halfH * 1.6;
  const rep = wU / natural;

  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const b = c.getContext('2d');
  b.fillStyle = PAPER; b.fillRect(0, 0, W, H);

  // the artist signed the page
  b.strokeStyle = 'rgba(60,55,48,.4)';
  b.lineCap = 'round'; b.lineJoin = 'round';
  b.lineWidth = 1.6;
  const sx0 = W - 130, sy0 = H - 46;
  b.beginPath();
  for (let k = 0; k <= 22; k++) {
    const x = sx0 + k * 3.4;
    const y = sy0 + Math.sin(k * 1.1) * 4.4 + Math.sin(k * 2.7) * 2 + (Math.random() - .5) * 1.8;
    k ? b.lineTo(x, y) : b.moveTo(x, y);
  }
  b.stroke();
  b.lineWidth = 1.2;
  b.strokeStyle = 'rgba(60,55,48,.25)';
  b.beginPath();
  b.moveTo(sx0 + 5, sy0 + 12);
  b.lineTo(sx0 + 68 + Math.random() * 10, sy0 + 10 + Math.random() * 4);
  b.stroke();

  // fold creases: a lighter ridge with a darker seam beside it
  const nCrease = 2 + (Math.random() < .5 ? 1 : 0);
  for (let i = 0; i < nCrease; i++) {
    const vert = Math.random() < .55;
    const pos = (0.15 + Math.random() * .7) * (vert ? W : H);
    const drift = 30 + Math.random() * 50, ph = Math.random() * 7;
    for (const [colr, wd, off] of [['rgba(255,254,246,.4)', 2, 0], ['rgba(84,76,62,.07)', 1.4, 1.8]]) {
      b.strokeStyle = colr; b.lineWidth = wd;
      b.beginPath();
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const main = pos + Math.sin(t * 2.4 + ph) * drift * .3 + (t - .5) * drift;
        const x = vert ? main + off : t * W;
        const y = vert ? t * H : main + off;
        k ? b.lineTo(x, y) : b.moveTo(x, y);
      }
      b.stroke();
    }
  }

  // A long page gets the flat sheet and no creases: the crease and
  // the signature are drawn ONCE into this texture, and repeating it
  // along thirty units of paper repeats them too — a seam every screen
  // and the artist signing the page nine times.
  const page = new THREE.Mesh(
    new THREE.PlaneGeometry(wU, hU),
    rep > 1
      ? new THREE.MeshBasicMaterial({ color: new THREE.Color(PAPER), depthWrite: false })
      : new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }),
  );
  page.position.z = -2;
  page.renderOrder = -100;
  scene.add(page);

  const t = document.createElement('canvas');
  t.width = 1600; t.height = 1200;
  const tc = t.getContext('2d');
  const td = tc.createImageData(t.width, t.height);
  for (let i = 0; i < td.data.length; i += 4) {
    if (Math.random() < .09) {
      td.data[i] = PR[0]; td.data[i + 1] = PR[1]; td.data[i + 2] = PR[2];
      td.data[i + 3] = (25 + Math.random() * 70) | 0;
    }
  }
  tc.putImageData(td, 0, 0);
  const toothTex = new THREE.CanvasTexture(t);
  if (rep > 1) { toothTex.wrapS = THREE.RepeatWrapping; toothTex.repeat.x = rep; }
  const tooth = new THREE.Mesh(
    new THREE.PlaneGeometry(wU, hU),
    new THREE.MeshBasicMaterial({ map: toothTex, transparent: true, depthWrite: false }),
  );
  tooth.position.z = 1;
  // above everything, with room to spare: the game room gives each
  // character a block of 16 renderOrder slots, so a fixed 1000 would
  // sink into the crowd once there are ~60 of them on the page
  tooth.renderOrder = 1e6;
  scene.add(tooth);
}
