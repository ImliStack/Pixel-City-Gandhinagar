export type Poi = {
  id: string;
  sourceId?: string;
  name: string;
  hindi?: string;
  gujarati?: string;
  aliases?: string[];
  description?: string;
  kind?: string;
  lon?: number;
  lat?: number;
  x?: number;
  y?: number;
  image?: [number, number];
  curated?: boolean;
  category?: string;
  unnamed?: boolean;
  reconstruction?: boolean;
};

export type Metadata = {
  schema?: number;
  city?: string;
  mapId?: string;
  version: string;
  title?: string;
  subtitle?: string;
  width: number;
  height: number;
  tileSize?: number;
  overlap?: number;
  format?: string;
  dzi: string;
  layers?: Partial<Record<'A' | 'B' | 'source' | 'night' | 'monsoon' | 'winter', { dzi: string; label?: string; group?: 'scene' | 'style' }>>;
  categories?: { id: string; label: string; count: number }[];
  minimap?: string;
  mode: string;
  artAvailable: boolean;
  artDzi?: string;
  artNote?: string;
  geometryNote?: string;
  coverage: { polygon: [number, number][]; bbox?: number[]; note?: string };
  pois: Poi[];
  transform?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  attribution: string;
};

export function pointForPoi(poi: Poi): [number, number] | null {
  // x/y are local UTM metres in the source data, not image pixels.
  const point = poi.image;
  return point?.length === 2 && point.every((v) => typeof v === 'number' && Number.isFinite(v)) ? point : null;
}

export function isStreet(poi: Poi): boolean {
  return ['street', 'road', 'highway'].includes(poi.kind || '');
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['of', 'and', 'the', 'for', 'de', 'in']);
function edits(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
// Score one name against a folded query: exact > prefix > word prefix > substring > initials > typo-tolerant words.
function scoreName(name: string, q: string) {
  const n = fold(name);
  if (!n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 85;
  const words = n.split(' ');
  if (words.some((w) => w.startsWith(q))) return 70;
  if (n.includes(q)) return 55;
  const initials = words.filter((w) => !STOP.has(w)).map((w) => w[0]).join('');
  if (q.length >= 3 && !q.includes(' ') && initials.startsWith(q)) return 50;
  const qWords = q.split(' ');
  const near = (qw: string, w: string) => { const k = qw.length >= 7 ? 2 : 1; return edits(qw, w, k) <= k || (w.length > qw.length && edits(qw, w.slice(0, qw.length), k) <= k); };
  const hit = qWords.every((qw) => qw.length < 4 ? words.some((w) => w.startsWith(qw)) : words.some((w) => near(qw, w)));
  return hit ? 35 : 0;
}

// Ranked local search over names, aliases, Gujarati/Hindi names and kinds; duplicates collapse to the best entry.
export function searchPois(pois: Poi[], term: string, limit = 8): Poi[] {
  const q = fold(term);
  if (!q) return [];
  const scored: { poi: Poi; score: number }[] = [];
  for (const poi of pois) {
    let score = Math.max(...[poi.name, poi.hindi, poi.gujarati, ...(poi.aliases || [])].filter(Boolean).map((n) => scoreName(n!, q)), 0);
    // Category words ("metro", "hospital", "school") find every place of that type.
    if (poi.category) score = Math.max(score, Math.min(48, scoreName(poi.category, q)));
    if (!score && poi.kind && fold(poi.kind) === q) score = 30;
    if (!score) continue;
    if (poi.curated) score += 14;
    if (poi.kind === 'landmark') score += 6;
    if (poi.unnamed) score -= 25;
    if (isStreet(poi)) score -= 4;
    scored.push({ poi, score });
  }
  scored.sort((a, b) => b.score - a.score || a.poi.name.length - b.poi.name.length);
  // Typo-tolerant hits only fill in when there are few direct matches.
  if (scored.filter((r) => r.score >= 50).length >= 3) scored.splice(0, scored.length, ...scored.filter((r) => r.score >= 50));
  const out: Poi[] = [], seen = new Set<string>();
  for (const { poi } of scored) { const key = fold(poi.name); if (seen.has(key)) continue; seen.add(key); out.push(poi); if (out.length >= limit) break; }
  return out;
}

export function matchesPoi(poi: Poi, term: string): boolean {
  return searchPois([poi], term, 1).length === 1;
}

const KIND_LABEL: Record<string, string> = { place_of_worship: 'Place of worship', landmark: 'Landmark', building: 'Building', park: 'Park', site: 'Site', hospital: 'Hospital', clinic: 'Clinic', railway: 'Railway station', restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Fast food', hotel: 'Hotel', bank: 'Bank', atm: 'ATM', fuel: 'Petrol pump', college: 'College', university: 'University', school: 'School', water: 'Lake / water', dentist: 'Dentist', doctors: 'Doctor', pharmacy: 'Pharmacy', community_centre: 'Community centre', cinema: 'Cinema', theatre: 'Theatre', street: 'Street', road: 'Road', neighbourhood: 'Sector / area' };
export const kindLabel = (poi: Poi) => KIND_LABEL[poi.kind || ''] || (poi.kind || 'Place').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Nearest named area (sector) by image distance, and a factual summary built only from map data.
export function nearestArea(pois: Poi[], poi: Poi): Poi | null {
  const p = pointForPoi(poi); if (!p) return null;
  let best: Poi | null = null, d = Infinity;
  for (const a of pois) { if (a.kind !== 'neighbourhood' || a === poi) continue; const q = pointForPoi(a); if (!q) continue; const dd = Math.hypot(q[0] - p[0], q[1] - p[1]); if (dd < d) { d = dd; best = a; } }
  return d < 9000 ? best : null;
}

export function describePoi(pois: Poi[], poi: Poi, metresBetween: (a: [number, number], b: [number, number]) => number, categoryLabel?: string): string {
  const p = pointForPoi(poi);
  const area = nearestArea(pois, poi);
  const parts: string[] = [];
  parts.push(`${poi.unnamed ? `An unnamed ${kindLabel(poi).toLowerCase()}` : `${kindLabel(poi)}`}${area ? ` in ${area.name}` : ''}.`);
  if (p) {
    // Closest well-known landmark, for orientation.
    let near: Poi | null = null, nd = Infinity;
    for (const o of pois) { if (!o.curated || o === poi || o.kind === 'neighbourhood' || o.kind === 'infrastructure' || isStreet(o)) continue; const q = pointForPoi(o); if (!q) continue; const m = metresBetween(p, q); if (m < nd) { nd = m; near = o; } }
    if (near && nd < 4000) parts.push(`${nd < 1000 ? Math.round(nd / 10) * 10 + ' m' : (nd / 1000).toFixed(1) + ' km'} from ${near.name}.`);
    if (poi.category) {
      const same = pois.filter((o) => o !== poi && o.category === poi.category && (() => { const q = pointForPoi(o); return q && metresBetween(p, q) < 1500; })()).length;
      if (same) parts.push(`${categoryLabel || 'Similar places'} within 1.5 km: ${same} more.`);
    }
  }
  if (poi.sourceId) parts.push(`Mapped in OpenStreetMap as ${poi.sourceId}.`);
  return parts.join(' ');
}
