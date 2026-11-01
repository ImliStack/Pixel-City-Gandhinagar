// Scavenger hunts over real POIs. Pure and deterministic: every visitor gets the same lists.
// A place counts as found when the map is held close in (image zoom ≥ FIND_ZOOM) with the place near
// the middle of the screen, so a hunt is about exploring the map, not about ticking a list.
import { hash32 } from './daily.mjs';

export const FIND_ZOOM = 0.2;

const named = (p) => Array.isArray(p.image) && !p.unnamed && p.name && p.name.length > 3;
const pick = (list, n, seed) => list.slice().sort((a, b) => hash32(`${seed}:${a.id}`) - hash32(`${seed}:${b.id}`)).slice(0, n);
// Drop duplicates that share a name (OSM sometimes maps one place as node + area).
const unique = (list) => { const seen = new Set(); return list.filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

export function buildHunts(pois) {
  const by = (fn) => unique(pois.filter((p) => named(p) && fn(p)));
  const hunts = [
    { id: 'metro', title: 'Ride Metro Line 2', blurb: 'Find every station on the line.', icon: 'metro', places: by((p) => p.category === 'metro') },
    { id: 'landmarks', title: 'Big landmarks', blurb: 'The Assembly, Akshardham, Dandi Kutir and more.', icon: 'government', places: by((p) => p.curated && (p.kind === 'landmark')) },
    { id: 'temples', title: 'Temple trail', blurb: 'Eight temples across the sectors.', icon: 'worship', places: pick(by((p) => p.category === 'worship' && p.kind !== 'landmark'), 8, 'temples') },
    { id: 'gardens', title: 'Green Gandhinagar', blurb: 'Eight of the city’s vans and gardens.', icon: 'park', places: pick(by((p) => p.category === 'park' && /van|udyan|park|garden/i.test(p.name)), 8, 'gardens') },
    { id: 'sights', title: 'Sights & stories', blurb: 'Dandi Kutir, Indroda and other places worth a visit.', icon: 'attraction', places: pick(by((p) => p.category === 'attraction'), 6, 'sights') },
  ];
  return hunts.filter((h) => h.places.length >= 3).map((h) => ({ ...h, places: h.places.map((p) => p.id) }));
}

// Places from `ids` that the current view "finds": zoomed in, within the central circle of the view.
export function foundInView(pois, ids, view) {
  if (!view || view.zoom < FIND_ZOOM) return [];
  const r = Math.min(view.w, view.h) * 0.3, cx = view.x + view.w / 2, cy = view.y + view.h / 2;
  return ids.filter((id) => { const p = pois.find((q) => q.id === id); return p?.image && Math.hypot(p.image[0] - cx, p.image[1] - cy) <= r; });
}
