// The crowd, drawn by the other hand.
//
// There is almost nothing here on purpose: the scene, the rigs, the
// parts and the six media are the crowd's, unchanged. All this module
// does is choose the HAND before the first part is built — after that
// every mark on the page comes out of p5.brush instead of `sketch.js`.
//
// `?hand=graphite` puts the original hand back on this same page, and
// `?seed=` pins the 35 characters, so
//
//   crowdbrush.html?seed=7   vs   crowd.html?seed=7
//
// is the same page of people drawn twice, which is the only honest way
// to look at what changed.
import { setHand } from './part.js';
import { brushHand } from './brush/bsketch.js';

const q = new URLSearchParams(location.search);
if (q.get('hand') !== 'graphite') setHand(brushHand);

const title = document.querySelector('#hud h1');
if (title) title.textContent = q.get('hand') === 'graphite' ? 'crowd · graphite' : 'crowd · p5.brush';

// crowd.js runs on import, and it must not run before the hand is set:
// a static import would be hoisted above the line above.
await import('./crowd.js');

const P = await import('./brush/bplate.js');
window.__brush = {
  P,
  // the plate is resized to each part, so this reports the LAST part drawn
  get plate() { return P.plateSize(); },
  get tips() { return P.brush.box().filter(n => n.startsWith('dw-')); },
};
