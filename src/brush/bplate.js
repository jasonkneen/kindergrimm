// ---------------------------------------------------------------
// THE PLATE — one WebGL canvas, borrowed by every brush mark.
//
// p5.brush composites into the canvas it was loaded onto, and the
// framebuffers it caches belong to THAT context: call `brush.load()`
// on a second canvas and every flush after it logs
// `INVALID_OPERATION: bindFramebuffer`. So there is exactly one plate
// in the process. A BSketch borrows it, draws, blits what landed onto
// its own 2D canvas and hands it back — which is also why a part can
// still keep a plain 2D canvas for three.js to texture from.
//
// The plate is kept as SMALL as the parts allow, and that is the one
// number that decides whether this hand is usable. p5.brush composites
// its mask into the target every time the colour changes, and a
// composite is a shader pass over the WHOLE canvas: on a 1024² plate a
// watercolour skin cost 300ms and a character took four seconds, on a
// plate cut to the part it costs 3ms. So the plate grows to the
// biggest part it is asked for and never further.
//
// Three things about p5.brush that this module exists to hide:
//   · the origin is the canvas CENTRE, like p5's WEBGL mode, so every
//     drawing pass runs inside a translate to the top-left corner;
//   · `brush.clear()` resets the composite state AND forgets the
//     current brush, so the brush has to be re-set after every flush;
//   · a colour change is not free — see above — so a mark that wants a
//     new tint pays for it, and the fills here spend that budget on
//     one good layer rather than three cheap ones.
// ---------------------------------------------------------------
import * as brush from '../../vendor/brush.esm.js';

export { brush };

let plate = null;
let cur = null;                     // [tip, color, weight] — restored after a clear

// The tips. Stock p5.brush ships eleven; these six are drawai's own,
// authored so the marks read like the graphite hand's vocabulary —
// a ribbon that tapers at both ends, a dry line that skips, chalk
// that sits on the tooth. Alpha is a BRUSH property in p5.brush, not
// a colour channel, so each tip is registered once per alpha bucket
// (see `tip()` below) rather than per call.
//
// Every envelope is FLAT — `pressure: [1, 1, 1]`. Pressure in
// p5.brush multiplies the tip's size, and a tip that also tapers
// itself multiplies twice: a stroke authored to thin to .35 at the
// ends came out at .12 of its width and the whole crowd drew as
// faint outlines. The taper belongs to the caller (see `stroke`),
// because that is where a part says what kind of mark it wants.
const TIPS = {
  // the wide graphite ribbon: wobbles, sheds, thins at both ends.
  // `spacing` is how often the tip stamps, and it is the cost knob for
  // every stroke on the page — .4 draws a stroke in 1.2ms, .85 in .5ms
  // and the difference is not visible at part scale.
  ribbon: { type: 'default', weight: 1, scatter: .45, sharpness: .5, grain: .9,
            spacing: .55, pressure: [1, 1, 1], rotate: 'natural', noise: .45 },
  // a thin dry line, the one that carries the drawing
  line:   { type: 'default', weight: 1, scatter: .28, sharpness: .62, grain: .92,
            spacing: .6, pressure: [1, 1, 1], rotate: 'natural', noise: .35 },
  // hatching wants to stay legible at 6px spacing: cleaner, harder
  hatch:  { type: 'default', weight: 1, scatter: .2, sharpness: .72, grain: .95,
            spacing: .65, pressure: [1, 1, 1], rotate: 'natural', noise: .3 },
  // a loaded brush: flat, opaque, no tip buildup — oil and marker
  loaded: { type: 'marker', weight: 1, scatter: .6, spacing: .55,
            pressure: [1, 1, 1], rotate: 'natural', markerTip: false, noise: .35 },
  // pigment caught on the tooth
  chalk:  { type: 'spray', weight: 1, scatter: 3.4, grain: 5, spacing: .9,
            pressure: [1, 1, 1], rotate: 'random', noise: .5 },
  // the wet rim a pool leaves as it dries
  wet:    { type: 'marker', weight: 1, scatter: 1.8, spacing: .7,
            pressure: [1, 1, 1], rotate: 'natural', markerTip: true, noise: .5 },
};

const added = new Set();

// Alpha is baked into the tip, so ask for it in buckets: six steps is
// under the eye's resolution for a pencil line and keeps the brush
// registry to a few dozen entries instead of one per stroke.
const STEPS = 6;

export function tip(name, alpha = 1) {
  const b = Math.max(1, Math.min(STEPS, Math.round(Math.min(1, alpha) * STEPS)));
  const id = `dw-${name}-${b}`;
  if (!added.has(id)) {
    brush.add(id, { ...TIPS[name], opacity: Math.round(b / STEPS * 255) });
    added.add(id);
  }
  return id;
}

// ---- the plate itself -------------------------------------------
// It is resized to fit the part being drawn — exactly, not rounded up:
// a composite covers the whole plate, so every spare pixel is paid for
// on every colour change. A resize costs 1.7ms and the two boil frames
// of a part are the same size, so it happens about once per part.
//
// What must NEVER change is the canvas: resizing one keeps one WebGL
// context, while loading a SECOND canvas leaves p5.brush holding
// framebuffers from the first and every flush after that logs
// `INVALID_OPERATION: bindFramebuffer`. Call this only between parts —
// a resize drops whatever is still pending on the plate.
export function ensurePlate(w = 256, h = 256) {
  w = Math.max(4, Math.ceil(w)); h = Math.max(4, Math.ceil(h));
  plate ??= document.createElement('canvas');
  if (plate.width === w && plate.height === h) return plate;
  plate.width = w; plate.height = h;
  brush.load(plate);
  return plate;
}

export function plateCanvas() { return plate; }
export function plateSize() { return plate ? `${plate.width}×${plate.height}` : ''; }

// Everything a part draws is authored in CHARACTER coordinates — y
// down, origin at the centre of the head — and the 2D context carries
// the transform that lands them on the canvas (`rig.js` sets it before
// calling a part's draw, and parts add their own translate/rotate/
// scale on top). p5.brush knows nothing about that context, so the
// transform is handed to it here, on top of the centre-origin offset
// its own canvas uses.
//
// Getting this wrong is not subtle and it is not obvious either: a
// part draws at x = -60 and the mark lands off the left of the plate,
// so most of every character simply is not there, and what survives
// sits at the wrong offset. That was one arc of a head's outline and
// nothing else.
export function begin(m) {
  brush.push();
  brush.translate(-plate.width / 2, -plate.height / 2);
  if (!m) return;
  brush.translate(m.e, m.f);
  const rot = Math.atan2(m.b, m.a);
  const sx = Math.hypot(m.a, m.b) || 1;
  const det = m.a * m.d - m.b * m.c;
  const sy = (det / sx) || 1;
  if (rot) brush.rotate(rot);
  if (sx !== 1 || sy !== 1) brush.scale(sx, sy);
}

export function end() { brush.pop(); }

// Remember what was set, because a clear forgets it.
// `weight` is in drawai pixels — what the 2D hand means by a stroke
// width. p5.brush lays down about 1.7× that for the same number
// (measured on a flat line), so the two are reconciled here and
// nowhere else.
export const WEIGHT = .55;

export function use(tipName, color, weight, alpha = 1) {
  cur = [tip(tipName, alpha), color, Math.max(.12, weight * WEIGHT)];
  brush.set(...cur);
}

export function restore() { if (cur) brush.set(...cur); }

// `brush.clear()` clears to TRANSPARENT WHITE — rgb(1,1,1) with alpha
// 0 — and a premultiplied WebGL canvas in that state does not blit
// harmlessly: `drawImage` of it replaces the destination's colour with
// white while leaving its alpha alone, so every paper-filled shape a
// part had already laid down came out a solid white block. Clearing to
// transparent BLACK afterwards costs nothing and blits as nothing.
export function wipe() {
  brush.clear();                      // resets p5.brush's composite state
  const gl = plate.getContext('webgl2');
  if (gl) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

export function seed(n) { brush.seed(n); brush.noiseSeed(n); }

// css colour from an [r,g,b] triple — p5.brush parses rgb()/rgba()
export const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
