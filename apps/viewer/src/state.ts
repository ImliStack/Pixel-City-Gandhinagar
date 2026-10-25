export type Layer = 'A' | 'B' | 'source' | 'night' | 'monsoon' | 'winter';
export type ViewState = { version: 2; map: string; imageVersion?: string; layer: Layer; cx: number; cy: number; zoom: number; legacyViewportZoom?: boolean; selected?: string; filters?: string[] };

const LAYERS: Layer[] = ['A', 'B', 'source', 'night', 'monsoon', 'winter'];

// Camera center uses image pixels, so state does not depend on viewport size.
// v=2 stores image zoom (screen px per image px) plus map id, image version and layer;
// v=1 links (historical Jaipur) stored OpenSeadragon viewport zoom and still restore.
export function readViewState(hash: string, fallbackMap: string): ViewState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const v = params.get('v');
  if (v !== '1' && v !== '2') return null;
  if (!params.has('cx') || !params.has('cy') || !params.has('z')) return null;
  const cx = Number(params.get('cx'));
  const cy = Number(params.get('cy'));
  const zoom = Number(params.get('z'));
  if (![cx, cy, zoom].every(Number.isFinite) || zoom <= 0 || zoom > 1000) return null;
  const layer = LAYERS.includes(params.get('l') as Layer) ? (params.get('l') as Layer) : 'A';
  const map = v === '2' && params.get('m') ? params.get('m')! : fallbackMap;
  return { version: 2, map, imageVersion: params.get('iv') || undefined, layer, cx, cy, zoom, legacyViewportZoom: v === '1', selected: params.get('poi') || undefined, filters: params.get('f')?.split(',').filter((c) => /^[a-z]+$/.test(c)) || undefined };
}

export function writeViewState(state: ViewState): string {
  const params = new URLSearchParams({ v: '2', m: state.map, l: state.layer, cx: state.cx.toFixed(1), cy: state.cy.toFixed(1), z: state.zoom.toFixed(5) });
  if (state.imageVersion) params.set('iv', state.imageVersion);
  if (state.selected) params.set('poi', state.selected);
  if (state.filters?.length) params.set('f', state.filters.join(','));
  return `#${params.toString()}`;
}
