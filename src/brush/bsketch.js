// ---------------------------------------------------------------
// THE SECOND HAND — the same drawing, made with p5.brush.
//
// `Sketch` is drawai's own hand: ribbon strokes wobbling at three
// frequencies, dry granulation, wrist overshoots. This is a PARALLEL
// hand, the way `carve.js`, `gshape.js` and `oshape.js` are parallel
// to it in the other labs — every mark comes out of p5.brush's brush
// engine instead, so a contour is a real tip dragged along a spline
// and shading is real hatching that ends on the outline.
//
// It is a SUBCLASS on purpose, and that is the whole trick:
//
//   · the RNG, the path helpers (`blobPts`, `wobbly`, `poly`) and the
//     colour helpers are inherited, so a seed picks the same GEOMETRY
//     in both hands. The same character, drawn twice by two hands.
//   · only the MARK-MAKERS are overridden. Anything not overridden
//     still works — the port can never be half-broken, only half-done.
//   · `this.ctx` stays a real 2D context, so the 53 places where a
//     part reaches for `s.ctx` — clips, transforms, flat fills — keep
//     working verbatim. Parts are not touched by any of this.
//
// Every mark goes out through the shared PLATE (`bplate.js`) and is
// blitted back onto this canvas, so the two halves have to agree
// about ORDER and about the FRAME:
//
//   · order — `ctx` is wrapped in a guard that flushes the plate
//     before any 2D call that draws or moves the frame, so a brush
//     mark can never end up on top of a 2D fill that came after it.
//     Path building does not flush, so `poly(); fill()` is one flush.
//   · frame — a mark is drawn under the 2D context's own transform
//     (see `mark`), and the blit back runs at identity. The CLIP still
//     comes for free, because a clip is resolved to device space when
//     it is set. That is what makes a clipped, rotated ear work.
// ---------------------------------------------------------------
import { Sketch, smooth } from '../sketch.js';
import * as P from './bplate.js';

const brush = P.brush;

const bbox = pts => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

// Path building never draws, so it never needs a flush. Everything
// else on a 2D context either puts pixels down or moves the frame
// the pending marks were authored in.
const PATH_OPS = new Set([
  'beginPath', 'moveTo', 'lineTo', 'closePath', 'arc', 'arcTo', 'ellipse',
  'rect', 'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'setLineDash',
]);

function guard(ctx, flush) {
  const bound = new Map();
  return new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (PATH_OPS.has(k)) {
        if (!bound.has(k)) bound.set(k, v.bind(t));
        return bound.get(k);
      }
      return (...a) => { flush(); return v.apply(t, a); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

export class BSketch extends Sketch {
  constructor(w, h) {
    super(w, h);
    P.ensurePlate(w, h);
    // A fresh canvas WITHOUT `willReadFrequently`: the 2D hand asks for
    // it because it reads pixels back, this one only ever writes, and a
    // software-backed canvas makes every blit off the plate a GPU
    // readback — 5ms a part, 100ms a character.
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.raw = this.canvas.getContext('2d');
    this.pending = false;
    this.ctx = guard(this.raw, () => this.flush());
  }

  // the brush engine has its own dice; a part is one seed for both
  boil(seed) {
    super.boil(seed);
    P.seed((seed >>> 0) || 1);
  }

  // ---- the plate ------------------------------------------------
  // One brush pass, composited and taken off the plate immediately.
  //
  // It has to be immediate. p5.brush composites a mark by blending its
  // mask over the WHOLE dirty region, and on a transparent plate the
  // pixels where the new mask is empty come out transparent rather
  // than keeping what was under them — so a second mark ERASES the
  // first. On the library's own opaque canvas this never shows. Batch
  // two strokes here and only the last one survives: a head came out
  // as one arc of its outline, which is exactly what it looked like.
  //
  // So the plate carries one mark at a time. It costs about .8ms a
  // mark, and with ~200 marks to a character that is most of why this
  // hand is 9× the graphite one (292ms against 32ms, measured over
  // every medium and species).
  mark(fn) {
    P.begin(this.raw.getTransform());
    try { fn(); } finally { P.end(); }
    this.pending = true;
    this.flush();
  }

  flush() {
    if (!this.pending) return;
    this.pending = false;
    brush.render();
    // 1:1, because the marks were already drawn under the context's
    // transform (see `mark`). The clip still applies — it was resolved
    // to device space when the part set it — and the call goes through
    // `this.raw`, never the guarded ctx, or it would ask for a flush
    // inside a flush.
    this.raw.save();
    this.raw.setTransform(1, 0, 0, 1, 0, 0);
    this.raw.drawImage(P.plateCanvas(), 0, 0);
    this.raw.restore();
    P.wipe();                    // to transparent BLACK — see bplate.js
    P.restore();                 // a clear forgets the brush
  }

  // part.js calls this before the canvas becomes a texture
  done() { this.flush(); }

  inkCss() { return P.css(this.ink); }

  // ---- pouring -------------------------------------------------
  // p5.brush's `fill()` — the real watercolour pool, with bleed and a
  // tide line out of one call — CANNOT be used here, and that is the
  // one thing this hand had to give up. It blends pigment into the
  // canvas assuming paper underneath, so on a part's transparent plate
  // it writes an opaque near-white patch: measured 3077 white pixels
  // inside a shape that should have been a translucent wash. Every
  // other route p5.brush offers — brush tips of all three types,
  // `hatch()`, `mass()` — composites with correct alpha. (It also cost
  // a flat 18ms whatever the shape's size, so a face wanting
  // twenty-six of them was never going to be affordable either.)
  //
  // So a pool is PAINTED: crossing passes of the wet tip inside the
  // shape, then the tide line the water leaves as it dries, which is
  // the mark the eye actually reads as watercolour.
  pour(pts, col, alpha, o = {}) {
    const [x0, y0, x1, y1] = bbox(pts);
    const diag = Math.hypot(x1 - x0, y1 - y0);
    const c = this.ctx;
    c.save();
    this.poly(this.offsetShape(pts, 1.02, 0, 0, 0), true);
    c.clip();
    const a = o.ang ?? this.jr(-.5, .5);
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    const wd = Math.max(3, diag * (o.wide ?? .3));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use(o.tip ?? 'wet', col, wd, Math.min(1, alpha));
      for (let off = -diag * .55; off <= diag * .55; off += wd * this.jr(.5, .75))
        brush.line(cx + px * off - dx * diag * .6, cy + py * off - dy * diag * .6,
                   cx + px * off + dx * diag * .6, cy + py * off + dy * diag * .6);
    });
    c.restore();
    if (o.rim === false) return;
    // the tide line: pigment crowds the edge as the water retreats
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('wet', o.rimCol ?? col, Math.max(1.4, diag * .035), Math.min(1, alpha * 1.5));
      const ring = this.offsetShape(pts, .965, 0, 0, diag * .012);
      brush.beginShape(.5);
      for (const [x, y] of ring) brush.vertex(x, y, 1);
      brush.endShape(true);
    });
  }

  // ---- strokes --------------------------------------------------
  // the ribbon: p5.brush carries the wobble and the grain in the tip,
  // so what is authored here is the SHAPE and the pressure profile —
  // thin at both ends, or swelling to one if the part asked for a wedge
  stroke(pts, w, o = {}) {
    if (!pts || pts.length < 2) return;
    const alpha = o.alpha ?? this.jr(.68, .97);
    const shape = o.over ? overshoot(this, pts, o.over) : pts;
    const taper = o.taper ?? .22;
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('ribbon', this.inkCss(), Math.max(.5, w), alpha);
      brush.beginShape(.42);
      const n = shape.length;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1 || 1);
        // pressure MULTIPLIES the tip: below about .5 a stroke stops
        // reading as a mark at all, so the taper lives in a narrow band
        const p = o.wedge ? .6 + .6 * t
                          : .62 + .5 * smooth(Math.min(t, 1 - t) / taper);
        brush.vertex(shape[i][0], shape[i][1], Math.max(.5, p * this.jr(.94, 1.08)));
      }
      brush.endShape(false);
    });
    // the sketcher's second and third pass, further off the line
    if (o.ghost && this.chance(.6)) {
      this.stroke(pts, w * .5, { alpha: alpha * .24, taper });
      if (this.chance(.3)) this.stroke(pts, w * .4, { alpha: alpha * .14, taper });
    }
  }

  // the thin line that carries the drawing. The pen still lifts —
  // that is drawai's tic, not p5.brush's, so it is authored here as
  // separate sub-paths rather than one.
  sline(pts, w, alpha, color) {
    if (!pts || pts.length < 2) return;
    const a = Math.min(1, (alpha ?? .8) * 1.25);
    const runs = [[]];
    for (let i = 0; i < pts.length; i++) {
      runs[runs.length - 1].push(pts[i]);
      if (i && i < pts.length - 2 && this.chance(.035)) runs.push([]);
    }
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('line', color || this.inkCss(), Math.max(.4, w * this.jr(.8, 1.25)), a);
      for (const run of runs) {
        if (run.length < 2) continue;
        brush.beginShape(.5);
        for (const [x, y] of run) brush.vertex(x, y, 1);
        brush.endShape(false);
      }
    });
  }

  curl(cx, cy, r, a0, len, color, width) {
    const n = 9, pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + len * i / n;
      pts.push([cx + Math.cos(a) * r * this.jr(.94, 1.06), cy + Math.sin(a) * r * this.jr(.94, 1.06)]);
    }
    this.sline(pts, width, .9, color);
  }

  // ---- hatching -------------------------------------------------
  // p5.brush hatches a POLYGON, so the lines end on the outline
  // instead of being clipped off it — the difference between a shaded
  // shape and a shape with shading stuck behind it.
  hatchFill(pts, spacing, ang, alpha, w = 1.1) {
    this.mark(() => {
      brush.noFill(); brush.noStroke(); brush.noMass();
      brush.hatch(Math.max(1.6, spacing), ang, { rand: .14, continuous: false });
      brush.hatchStyle(P.tip('hatch', Math.min(1, alpha * 1.15)), this.inkCss(), Math.max(.25, w * P.WEIGHT));
      brush.polygon(pts);
      brush.noHatch();
    });
  }

  // the dry scribble: same idea, looser, and it wanders off the shape
  scribbleFill(pts, spacing, alpha) {
    this.mark(() => {
      brush.noFill(); brush.noStroke(); brush.noMass();
      brush.hatch(Math.max(2, spacing), this.jr(-.35, .35), { rand: .55, continuous: true });
      brush.hatchStyle(P.tip('line', Math.min(1, alpha * 1.2)), this.inkCss(), P.WEIGHT);
      brush.polygon(pts);
      brush.noHatch();
    });
  }

  stippleFill(pts, spacing, alpha) {
    const [x0, y0, x1, y1] = bbox(pts);
    const n = Math.min(260, ((x1 - x0) * (y1 - y0)) / (spacing * spacing));
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('chalk', this.inkCss(), spacing * .5, Math.min(1, alpha * 1.4));
      for (let i = 0; i < n; i++) {
        const x = this.jr(x0, x1), y = this.jr(y0, y1);
        if (!inside(pts, x, y)) continue;
        brush.line(x, y, x + this.jr(-.8, .8), y + this.jr(-.8, .8));
      }
    });
  }

  // solid graphite: p5.brush's massing is three layers of internally
  // generated hatch, which is what the 2D hand fakes with two scribble
  // passes and a flat base
  pencilFill(pts, darkness) {
    this.mark(() => {
      brush.noFill(); brush.noStroke(); brush.noHatch();
      brush.mass(P.tip('ribbon', Math.min(1, .35 + darkness * .5)), this.inkCss(),
        { precision: .5, strength: Math.min(1, .45 + darkness * .55), gradient: .3 });
      brush.polygon(pts);
      brush.noMass();
    });
  }

  // `inkFill` and `paperFill` stay the 2D hand's: they are flat value,
  // laid under the drawing and read as one tone whoever put them down.
  // A brush fill each would be the most expensive thing on the page for
  // no visible difference — a part calls them a dozen times.

  // ---- wet and dry media ----------------------------------------
  // The 2D hand stacks three translucent layers to get a tide line out
  // of flat fills. Here the pool is painted once (see `pour`) and the
  // tide line is a stroke, so the layers become depth of colour rather
  // than three passes over the same shape.
  washFill(pts, col, o = {}) {
    const { layers = 3, alpha = .17, bleed = 1, blooms = true } = o;
    const shape = this.offsetShape(pts, 1.006, this.jr(-1.5, 1.5) * bleed,
      this.jr(-1.5, 1.5) * bleed, 1.1 * bleed);
    this.pour(shape, P.css(col), Math.min(1, alpha * layers * 1.9),
      { wide: .34, rimCol: P.css(this.colMix(col, .84)) });
    // backruns: water pushed in late carries pigment out to a hard ring
    if (blooms) {
      const [x0, y0, x1, y1] = bbox(pts);
      const rings = [];
      for (let k = 0; k < this.ri(1, 3); k++)
        rings.push(this.blobPts(this.jr(x0, x1), this.jr(y0, y1),
          (x1 - x0) * this.jr(.12, .3), (y1 - y0) * this.jr(.12, .3)));
      const c = this.ctx;
      c.save(); this.poly(pts, true); c.clip();
      for (const b of rings) {                      // the pale pool inside
        this.poly(b, true);
        c.fillStyle = this.paperA(this.jr(.12, .24));
        c.fill();
      }
      this.mark(() => {
        brush.noFill(); brush.noHatch(); brush.noMass();
        P.use('wet', P.css(this.colMix(col, .78)), this.jr(1.2, 2.4), .35);
        for (const b of rings) {
          brush.beginShape(.5);
          for (const [x, y] of b) brush.vertex(x, y, 1);
          brush.endShape(true);
        }
      });
      c.restore();
    }
  }

  // one loaded brush mark
  daub(x0, y0, x1, y1, wd, col, o = {}) {
    const alpha = o.alpha ?? 1;
    const ridge = o.ridge ?? true;
    const mx = (x0 + x1) / 2 + this.jr(-1.5, 1.5), my = (y0 + y1) / 2 + this.jr(-1.5, 1.5);
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('loaded', P.css(col), wd, alpha);
      brush.beginShape(.5);
      brush.vertex(x0, y0, .8); brush.vertex(mx, my, 1.05); brush.vertex(x1, y1, .85);
      brush.endShape(false);
      // the ridge the bristles piled up
      if (!ridge) return;
      let nx = -(y1 - y0), ny = x1 - x0;
      const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
      P.use('line', P.css(this.colMix(col, this.jr(1.14, 1.32))), wd * .22, alpha * .85);
      brush.beginShape(.5);
      brush.vertex(x0 + nx * wd * .28, y0 + ny * wd * .28, 1);
      brush.vertex(mx + nx * wd * .28, my + ny * wd * .28, 1);
      brush.vertex(x1 + nx * wd * .28, y1 + ny * wd * .28, 1);
      brush.endShape(false);
    });
  }

  // oil: the shape is covered by daubs, not filled
  oilFill(pts, col, o = {}) {
    const { alpha = 1, ang = null, density = 1 } = o;
    const [x0, y0, x1, y1] = bbox(pts);
    const c = this.ctx;
    c.save();
    this.poly(this.offsetShape(pts, 1.02, 0, 0, 1.5), true);
    c.clip();
    // a ground so the gaps between daubs never show paper
    this.pour(this.offsetShape(pts, 1.06, 0, 0, 0), P.css(this.colMix(col, .9)), alpha,
      { tip: 'loaded', wide: .38, rim: false });
    const a = ang ?? this.jr(-1.3, -.5);
    const dx = Math.cos(a), dy = Math.sin(a);
    const diag = Math.hypot(x1 - x0, y1 - y0);
    const wd = Math.max(3.5, diag * .1);
    const step = wd * .95 / density;      // fewer, fatter marks: each one is a stroke
    const px = -dy, py = dx;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let off = -diag * .6; off <= diag * .6; off += step * this.jr(.8, 1.2)) {
      const bx = cx + px * off, by = cy + py * off;
      const len = diag * this.jr(.22, .55);
      const t0 = this.jr(-.55, .15) * diag;
      const sx = bx + dx * t0, sy = by + dy * t0;
      this.daub(sx, sy, sx + dx * len, sy + dy * len, wd * this.jr(.8, 1.25),
        this.colMix(col, this.jr(.82, 1.18)), { alpha, ridge: this.chance(.55) });
    }
    c.restore();
  }

  // chalk: pigment caught on the tooth, never covering it. The obvious
  // build — `mass()` with the spray tip — draws a lovely stick of
  // pastel and costs 290ms a shape, so the body is painted with the
  // spray tip and the tooth is a scatter of marks over it.
  chalkFill(pts, col, o = {}) {
    const { alpha = .5, density = 1 } = o;
    const [x0, y0, x1, y1] = bbox(pts);
    this.pour(pts, P.css(col), alpha * .8, { tip: 'chalk', wide: .26, rim: false });
    const c = this.ctx;
    c.save(); this.poly(pts, true); c.clip();
    const a = this.jr(-1.2, -.5), dx = Math.cos(a), dy = Math.sin(a);
    const diag = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.min(24, Math.round(diag * .3 * density));
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      P.use('chalk', P.css(col), diag * .07, Math.min(1, alpha * 1.2));
      for (let i = 0; i < n; i++) {
        const t = this.jr(-.5, .5) * diag, u = this.jr(-.55, .55) * diag;
        const cx = (x0 + x1) / 2 + dx * t - dy * u, cy = (y0 + y1) / 2 + dy * t + dx * u;
        const len = diag * this.jr(.06, .22);
        brush.line(cx, cy, cx + dx * len, cy + dy * len);
      }
    });
    // smudged with a thumb, and lifted in places
    for (let k = 0; k < this.ri(2, 4); k++) {
      this.poly(this.blobPts(this.jr(x0, x1), this.jr(y0, y1),
        (x1 - x0) * this.jr(.1, .26), (y1 - y0) * this.jr(.08, .2)), true);
      c.fillStyle = this.chance(.5) ? this.paperA(this.jr(.1, .26)) : this.colA(this.colMix(col, .8), .12);
      c.fill();
    }
    c.restore();
  }

  // marker: flat translucent bands, doubling where the nib crossed
  markerFill(pts, col, o = {}) {
    const { alpha = .3 } = o;
    const [x0, y0, x1, y1] = bbox(pts);
    const c = this.ctx;
    c.save();
    this.poly(this.offsetShape(pts, 1.01, this.jr(-2, 2), this.jr(-2, 2), 0), true);
    c.clip();
    const a = this.jr(-.35, .35) + (this.chance(.5) ? 0 : Math.PI / 2);
    const dx = Math.cos(a), dy = Math.sin(a);
    const px = -dy, py = dx;
    const diag = Math.hypot(x1 - x0, y1 - y0);
    const wd = Math.max(6, diag * .16);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    this.mark(() => {
      brush.noFill(); brush.noHatch(); brush.noMass();
      for (let off = -diag * .6; off <= diag * .6; off += wd * this.jr(.72, .95)) {
        const bx = cx + px * off, by = cy + py * off;
        P.use('loaded', P.css(col), wd, Math.min(1, alpha * this.jr(.85, 1.2)));
        brush.line(bx - dx * diag * .7, by - dy * diag * .7,
                   bx + dx * diag * .7, by + dy * diag * .7);
      }
    });
    c.restore();
  }
}

// the wrist flicking past the end of the line, off-axis
function overshoot(s, pts, over) {
  const out = pts.slice();
  const a = out[0], b = out[1];
  const d0 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const f0 = over * s.jr(-.5, .5);
  out[0] = [a[0] - (b[0] - a[0]) / d0 * over - (b[1] - a[1]) / d0 * f0,
            a[1] - (b[1] - a[1]) / d0 * over + (b[0] - a[0]) / d0 * f0];
  const y = out[out.length - 1], z = out[out.length - 2];
  const d1 = Math.hypot(y[0] - z[0], y[1] - z[1]) || 1;
  const f1 = over * s.jr(-.5, .5);
  out[out.length - 1] = [y[0] + (y[0] - z[0]) / d1 * over - (y[1] - z[1]) / d1 * f1,
                         y[1] + (y[1] - z[1]) / d1 * over + (y[0] - z[0]) / d1 * f1];
  return out;
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The hand, as a factory `part.js` can be handed. If the browser has
// no WebGL2 there is no plate and no shame in the graphite one.
export function brushHand(w, h) {
  try { return new BSketch(w, h); }
  catch (e) {
    if (!brushHand.warned) { console.warn('[brush] falling back to the graphite hand:', e.message); brushHand.warned = true; }
    return new Sketch(w, h);
  }
}
