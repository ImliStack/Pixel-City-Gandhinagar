import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { Check, ChevronDown, Dices, Info, Layers, LocateFixed, MapPin, Minus, Plus, Search, Share2, Target, X } from 'lucide-react';
import { isStreet, pointForPoi, searchPois, type Metadata, type Poi } from './types';
import { readViewState, writeViewState, type Layer } from './state';
import { PixelIcon, PixelFace, CATEGORY_COLOR } from './icons';
import { useSocial } from './social';
import { MotionLayer, paintMinimapBlank, type MotionData } from './motion';
import { DailyGame } from './DailyGame';

const DEFAULT_MAP = 'gandhinagar-city';
// The historical Jaipur export stays at /map/; new city exports live under /maps/<id>/.
const mapBase = (id: string) => (id === 'jaipur' ? '/map/' : `/maps/${encodeURIComponent(id)}/`);
const localPath = (base: string, file: string) => {
  if (/^[a-z]+:|^\/\//i.test(file) || file.includes('..')) throw new Error('Map assets must be local files.');
  return file.startsWith('/') ? file : `${base}${file}`;
};
const LAYER_LABEL: Record<Layer, string> = { A: 'Summer day', night: 'Night', monsoon: 'Monsoon', winter: 'Winter morning', B: 'Pixel edge', source: 'Source geometry' };
const SCENE_LAYERS: Layer[] = ['A', 'night', 'monsoon', 'winter'];
const STYLE_LAYERS: Layer[] = ['B', 'source'];
const MINIMAP_WIDTH = 176;
const SHORT_LABEL: Record<string, string> = { fuel: 'Petrol', hospital: 'Hospitals', pharmacy: 'Pharmacy', college: 'Colleges', school: 'Schools', mall: 'Malls', bank: 'Banks', worship: 'Temples', government: 'Govt', food: 'Food', hotel: 'Hotels', metro: 'Metro', rail: 'Railway', bus: 'Bus', airport: 'Airport', park: 'Parks', attraction: 'Sights' };

export default function App() {
  const mapId = useMemo(() => new URLSearchParams(window.location.search).get('map') || readViewState(window.location.hash, DEFAULT_MAP)?.map || DEFAULT_MAP, []);
  const base = mapBase(mapId);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const selectedRef = useRef<string | null>(null);
  const layerRef = useRef<Layer>('A');
  const searchRef = useRef<HTMLInputElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  // Tiled images currently drawn, bottom to top; a layer switch cross-fades a new one in on top.
  const stackRef = useRef<{ layer: Layer; item: OpenSeadragon.TiledImage }[]>([]);
  const fadeRef = useRef(0);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniBlankRef = useRef<HTMLCanvasElement>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingTiles, setMissingTiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>(() => readViewState(window.location.hash, mapId)?.layer || 'A');
  const [infoOpen, setInfoOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [frame, setFrame] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shareFallback, setShareFallback] = useState('');
  const [versionNotice, setVersionNotice] = useState('');
  const [debug, setDebug] = useState(false);
  const reducedMotion = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, []);
  const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };
  // Night motion is on by default unless the OS asks for reduced motion; the layer menu can switch it.
  const [motionOn, setMotionOn] = useState(() => (stored('pc-motion') ?? (reducedMotion ? '0' : '1')) === '1');
  const motionOnRef = useRef(motionOn);
  motionOnRef.current = motionOn;
  // Live clock: day, dusk and night follow the current time in India.
  const [liveClock, setLiveClock] = useState(() => stored('pc-live') === '1');
  const [nightMix, setNightMix] = useState(1);
  const [motionData, setMotionData] = useState<MotionData | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const social = useSocial();
  const deckRef = useRef<Poi[]>([]);
  const [maps, setMaps] = useState<{ id: string; title?: string; subtitle?: string }[]>([]);
  useEffect(() => { fetch('/maps/index.json').then((r) => r.ok ? r.json() : []).then(setMaps).catch(() => setMaps([])); }, []);
  const [filters, setFilters] = useState<string[]>(() => readViewState(window.location.hash, mapId)?.filters || []);
  const filtersRef = useRef<string[]>(filters);
  filtersRef.current = filters;
  const [placesOpen, setPlacesOpen] = useState(false);
  const placesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!placesOpen) return;
    const away = (e: PointerEvent) => { if (!placesRef.current?.contains(e.target as Node)) setPlacesOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlacesOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [placesOpen]);
  const toggleFilter = (id: string) => setFilters((list) => list.includes(id) ? list.filter((c) => c !== id) : [...list, id]);
  const selected = metadata?.pois.find((poi) => poi.id === selectedId) || null;
  const layers = useMemo(() => metadata ? (metadata.layers || { A: { dzi: metadata.dzi } }) : {}, [metadata]);
  layerRef.current = layers[layer] ? layer : 'A';

  useEffect(() => {
    const abort = new AbortController();
    fetch(`${base}metadata.json`, { signal: abort.signal })
      .then(async (response) => {
        // A missing file falls back to index.html (200, text/html) on the dev server, so check the type too.
        if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error(`The “${mapId}” map has not been exported yet (or is still being built). Open another map from ?map=…, or wait for npm run export-map to finish.`);
        const value: Metadata = await response.json();
        if (!value.width || !value.height || !Array.isArray(value.pois) || !value.dzi) throw new Error('The local map metadata is incomplete.');
        document.title = value.title || `${value.city || 'Indian Pixel City'} · local map`;
        setMetadata(value);
      })
      .catch((reason: Error) => { if (reason.name !== 'AbortError') { setError(reason.message); setLoading(false); } });
    return () => abort.abort();
  }, [base]);

  const persistView = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer?.world.getItemCount() || !metadata) return '';
    const center = viewer.viewport.viewportToImageCoordinates(viewer.viewport.getCenter());
    const hash = writeViewState({ version: 2, map: mapId, imageVersion: metadata.version, layer: layerRef.current, cx: center.x, cy: center.y, zoom: viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom()), selected: selectedRef.current || undefined, filters: filtersRef.current });
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    return window.location.href;
  }, [metadata, mapId]);

  useEffect(() => { selectedRef.current = selectedId; persistView(); }, [selectedId, layer, filters, persistView]);

  useEffect(() => {
    if (!metadata || !containerRef.current) return;
    const source = layers[layerRef.current]?.dzi || metadata.dzi;
    let animationFrame = 0;
    let smoothing = true;
    let viewer: OpenSeadragon.Viewer;
    try {
      viewer = OpenSeadragon({
        element: containerRef.current,
        tileSources: localPath(base, source),
        showNavigationControl: false,
        showNavigator: false,
        maxImageCacheCount: 160,
        imageLoaderLimit: 6,
        timeout: 20000,
        animationTime: 0.55,
        blendTime: 0.12,
        springStiffness: 9,
        // The art always fills the window: no zooming out past fill, no panning off the image.
        visibilityRatio: 1,
        homeFillsViewer: true,
        constrainDuringPan: true,
        minZoomImageRatio: 1,
        ...({ silenceMultiImageWarnings: true } as object), // layers cross-fade as two identical-lattice images (option missing from @types)
        maxZoomPixelRatio: 4,
        immediateRender: false,
        placeholderFillStyle: '#d9cfae',
        gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true },
        gestureSettingsTouch: { pinchToZoom: true, clickToZoom: false, dblClickToZoom: true, flickEnabled: true },
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open the local map.');
      setLoading(false);
      return;
    }
    viewerRef.current = viewer;
    (window as unknown as { __viewer?: OpenSeadragon.Viewer }).__viewer = viewer; // QA hook
    const redraw = () => {
      if (animationFrame) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = 0;
        setFrame((value) => value + 1);
        if (viewer.world.getItemCount()) {
          // Smooth when minified; nearest-neighbour at and above native pixels keeps detail crisp.
          // Device pixels, not CSS pixels: on a 2× screen an image pixel is already crisp from 50% zoom.
          const devicePixels = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom()) * (window.devicePixelRatio || 1);
          if (smoothing !== (devicePixels < 1)) {
            smoothing = devicePixels < 1;
            viewer.drawer.setImageSmoothingEnabled(smoothing);
            viewer.forceRedraw();
          }
        }
      });
    };
    const restoreView = () => {
      const state = readViewState(window.location.hash, mapId);
      if (!state || state.map !== mapId) return false;
      if (state.imageVersion && state.imageVersion !== metadata.version) setVersionNotice(`This link was made for map version ${state.imageVersion}; showing ${metadata.version}. Positions use the same image lattice only if the camera is unchanged.`);
      const zoom = state.legacyViewportZoom ? state.zoom : viewer.viewport.imageToViewportZoom(state.zoom);
      viewer.viewport.panTo(viewer.viewport.imageToViewportCoordinates(Math.max(0, Math.min(metadata.width, state.cx)), Math.max(0, Math.min(metadata.height, state.cy))), true);
      viewer.viewport.zoomTo(zoom, undefined, true);
      viewer.viewport.applyConstraints(true);
      const restoredId = metadata.pois.some((poi) => poi.id === state.selected) ? state.selected! : null;
      selectedRef.current = restoredId;
      setSelectedId(restoredId);
      redraw();
      return true;
    };
    viewer.addHandler('open', () => {
      stackRef.current = [{ layer: layerRef.current, item: viewer.world.getItemAt(0) }];
      restoreView();
      redraw();
    });
    viewer.addHandler('tile-loaded', () => setLoading(false));
    viewer.addHandler('open-failed', () => { setError('The local image pyramid could not be opened. Render and export the map first.'); setLoading(false); });
    viewer.addHandler('tile-load-failed', () => { setMissingTiles((n) => n + 1); setLoading(false); });
    viewer.addHandler('animation', redraw);
    viewer.addHandler('viewport-change', redraw);
    viewer.addHandler('update-viewport', redraw);
    viewer.addHandler('resize', redraw);
    viewer.addHandler('animation-finish', persistView);
    const onHash = () => { restoreView(); };
    window.addEventListener('hashchange', onHash);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('hashchange', onHash);
      stackRef.current = [];
      viewer.destroy();
      if (viewerRef.current === viewer) viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata, base, mapId]);

  // Cross-fade between layers (summer → dusk → night …): add the target on top at opacity 0 and ease
  // it to `nightMix` (1 unless the live clock is mid-dusk); once fully opaque, drop the layers below.
  useEffect(() => {
    const viewer = viewerRef.current, stack = stackRef.current;
    if (!viewer || !stack.length || !metadata) return;
    const target = layerRef.current, to = target === 'night' ? nightMix : 1, token = ++fadeRef.current;
    const fadeTo = (entry: { layer: Layer; item: OpenSeadragon.TiledImage }) => {
      const from = entry.item.getOpacity(), start = performance.now(), duration = reducedMotion ? 0 : 900;
      const step = (now: number) => {
        if (token !== fadeRef.current) return;
        const k = duration ? Math.min(1, (now - start) / duration) : 1, eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        entry.item.setOpacity(from + (to - from) * eased);
        if (k < 1) { requestAnimationFrame(step); return; }
        if (to >= 1) for (const other of stack.slice()) if (other !== entry) { viewer.world.removeItem(other.item); stack.splice(stack.indexOf(other), 1); }
      };
      requestAnimationFrame(step);
    };
    const top = stack[stack.length - 1];
    if (top.layer === target) { fadeTo(top); return; }
    // Keep at most the image being faded out underneath the new one.
    while (stack.length > 1) viewer.world.removeItem(stack.shift()!.item);
    viewer.addTiledImage({ tileSource: localPath(base, layers[target]?.dzi || metadata.dzi), opacity: 0, success: (event) => {
      const entry = { layer: target, item: (event as unknown as { item: OpenSeadragon.TiledImage }).item }; stack.push(entry);
      if (token === fadeRef.current) fadeTo(entry); else { viewer.world.removeItem(entry.item); stack.pop(); }
    } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, nightMix, metadata, base]);

  // Live clock: dusk 17:45–19:15 and dawn 05:45–07:00 IST blend night over day; checked every 30 s.
  useEffect(() => {
    store('pc-live', liveClock ? '1' : '0');
    if (!liveClock) { setNightMix(1); return; }
    const apply = () => {
      const now = new Date(Date.now() + 5.5 * 3600e3), m = now.getUTCHours() * 60 + now.getUTCMinutes();
      const mix = m >= 1155 || m < 345 ? 1 : m >= 1065 ? (m - 1065) / 90 : m < 420 ? 1 - (m - 345) / 75 : 0;
      setLayer(mix > 0 ? 'night' : 'A'); setNightMix(mix > 0 ? Math.max(0.05, mix) : 1);
    };
    apply();
    const timer = window.setInterval(apply, 30000);
    return () => window.clearInterval(timer);
  }, [liveClock]);

  // Motion overlay data is optional: without motion.json the map simply has no animation.
  useEffect(() => {
    if (!metadata) return;
    const abort = new AbortController();
    fetch(`${base}motion.json`, { signal: abort.signal })
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then((value: MotionData | null) => { if (value?.roads && value.blank) setMotionData(value); })
      .catch(() => {});
    return () => abort.abort();
  }, [metadata, base]);

  useEffect(() => {
    const canvas = motionCanvasRef.current;
    if (!motionData || !canvas) return;
    const mix = (name: Layer) => stackRef.current.reduce((m, e) => { const o = e.item.getOpacity(); return m * (1 - o) + (e.layer === name ? o : 0); }, 0);
    const motion = new MotionLayer(canvas, motionData, () => {
      const v = viewerRef.current;
      if (!v?.world.getItemCount() || !containerRef.current) return null;
      const r = v.viewport.viewportToImageRectangle(v.viewport.getBounds(true));
      return { x: r.x, y: r.y, w: r.width, h: r.height, cw: containerRef.current.clientWidth, ch: containerRef.current.clientHeight };
    }, () => ({ night: mix('night'), monsoon: mix('monsoon'), animate: motionOnRef.current }));
    motion.start();
    (window as unknown as { __motion?: MotionLayer }).__motion = motion;
    return () => motion.stop();
  }, [motionData]);
  useEffect(() => { store('pc-motion', motionOn ? '1' : '0'); }, [motionOn]);
  useEffect(() => { if (motionData && miniBlankRef.current && metadata) paintMinimapBlank(miniBlankRef.current, motionData.blank, (MINIMAP_WIDTH * 2) / metadata.width); }, [motionData, metadata]);

  const zoom = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.world.getItemCount()) return;
    viewer.viewport.zoomBy(factor);
    viewer.viewport.applyConstraints();
  }, []);

  const reset = useCallback(() => {
    viewerRef.current?.viewport.goHome();
    setSelectedId(null);
    setQuery('');
  }, []);

  const choosePoi = useCallback((poi: Poi) => {
    const viewer = viewerRef.current;
    const point = pointForPoi(poi);
    setSelectedId(poi.id);
    setQuery('');
    setSearchOpen(false);
    searchRef.current?.blur();
    if (viewer?.world.getItemCount() && point) {
      viewer.viewport.panTo(viewer.viewport.imageToViewportCoordinates(point[0], point[1]));
      viewer.viewport.zoomTo(viewer.viewport.imageToViewportZoom(isStreet(poi) ? 0.6 : 1));
      viewer.viewport.applyConstraints();
    }
  }, []);

  // Shuffle-bag tour of curated landmarks: every one is visited before any repeats.
  const randomLandmark = useCallback(() => {
    if (!metadata) return;
    if (!deckRef.current.length) {
      const deck = metadata.pois.filter((p) => p.curated && p.kind !== 'neighbourhood' && pointForPoi(p));
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      if (deck.length > 1 && deck[deck.length - 1].id === selectedRef.current) [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
      deckRef.current = deck;
    }
    const next = deckRef.current.pop();
    if (next) choosePoi(next);
  }, [metadata, choosePoi]);

  const results = useMemo(() => {
    if (!metadata) return [];
    const term = query.trim();
    return term ? searchPois(metadata.pois, term, 8) : metadata.pois.filter((poi) => poi.curated).slice(0, 8);
  }, [metadata, query]);
  useEffect(() => setActiveResult(0), [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (infoOpen) { if (event.key === 'Escape') setInfoOpen(false); return; }
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.4); }
      else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.4); }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); reset(); }
      else if (event.key.toLowerCase() === 'g') setDebug((value) => !value);
      else if (event.key.toLowerCase() === 'r') randomLandmark();
      else if (event.key.toLowerCase() === 'd') { setGameOpen((value) => !value); setSelectedId(null); }
      else if (event.key === '?') setInfoOpen((value) => !value);
      else if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      else if (event.key === 'Escape') { setSelectedId(null); setLayersOpen(false); setShareFallback(''); setGameOpen(false); }
      else if (event.key.startsWith('Arrow')) {
        const viewer = viewerRef.current;
        if (!viewer?.world.getItemCount()) return;
        event.preventDefault();
        const step = 90 / (viewer.viewport.getContainerSize().x * viewer.viewport.getZoom());
        viewer.viewport.panBy(new OpenSeadragon.Point(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
        viewer.viewport.applyConstraints();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, reset, infoOpen, randomLandmark]);

  const share = async () => {
    const link = persistView();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setShareFallback(link); }
  };

  const viewer = viewerRef.current;
  const ready = !!viewer?.world.getItemCount();
  const screenPoint = useCallback((x: number, y: number) => {
    const v = viewerRef.current;
    if (!v?.world.getItemCount()) return null;
    return v.viewport.pixelFromPoint(v.viewport.imageToViewportCoordinates(x, y), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);
  const imageZoom = ready ? viewer!.viewport.viewportToImageZoom(viewer!.viewport.getZoom(true)) : 0;
  const coverage = metadata?.coverage?.polygon?.map(([x, y]) => screenPoint(x, y)).filter((p) => p !== null) || [];
  // Curated pins appear from neighbourhood scale; a selected place always shows.
  // Category pins appear at any zoom when their filter is on; curated pins appear from neighbourhood scale.
  const pins = metadata?.pois.filter((poi) => poi.id === selectedId || (poi.category && filters.includes(poi.category)) || (!filters.length && poi.curated && poi.kind !== 'neighbourhood' && imageZoom > 0.32)) || [];
  const showPinLabels = imageZoom > 0.55;
  // Close zoom: label named places in view (dot + name), greedily decluttered by priority so labels never overlap.
  const placeLabels = (() => {
    if (!metadata || imageZoom < 0.3) return [];
    const pinned = new Set(pins.map((p) => p.id)), W = window.innerWidth, H = window.innerHeight, boxes: number[][] = [], out: { poi: Poi; x: number; y: number }[] = [];
    const rank = (p: Poi) => (p.curated ? 4 : 0) + (p.kind === 'landmark' ? 2 : 0) + (p.category ? 1.5 : 0) + (['building', 'park', 'site', 'water'].includes(p.kind || '') ? 1 : 0) - (isStreet(p) ? (imageZoom < 0.4 ? 9 : 1) : 0) - (p.unnamed ? (imageZoom < 0.8 ? 9 : 2) : 0);
    const cands = metadata.pois.filter((p) => !pinned.has(p.id) && p.kind !== 'neighbourhood').map((p) => ({ p, r: rank(p) })).filter((c) => c.r > -5).sort((a, b) => b.r - a.r);
    for (const { p } of cands) {
      const im = pointForPoi(p); const sp = im && screenPoint(im[0], im[1]); if (!sp || sp.x < 0 || sp.y < 30 || sp.x > W || sp.y > H) continue;
      const w = Math.min(220, p.name.length * 6.6 + 18), b = [sp.x - 6, sp.y - 9, sp.x + w, sp.y + 9];
      if (boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3])) continue;
      boxes.push(b); out.push({ poi: p, x: sp.x, y: sp.y }); if (out.length >= 70) break;
    }
    return out;
  })();
  const labels = metadata?.pois.filter((poi) => poi.kind === 'neighbourhood' && imageZoom > 0.12 && imageZoom < 0.7) || [];

  // Minimap rectangle: current viewport bounds in image pixels, scaled to the minimap.
  const miniScale = metadata ? MINIMAP_WIDTH / metadata.width : 0;
  const miniHeight = metadata ? Math.round(metadata.height * miniScale) : 0;
  let miniRect: { x: number; y: number; w: number; h: number } | null = null;
  if (ready && metadata) {
    const r = viewer!.viewport.viewportToImageRectangle(viewer!.viewport.getBounds(true));
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(metadata.width, r.x + r.width), y1 = Math.min(metadata.height, r.y + r.height);
    miniRect = { x: x0 * miniScale, y: y0 * miniScale, w: Math.max(3, (x1 - x0) * miniScale), h: Math.max(3, (y1 - y0) * miniScale) };
  }
  const panFromMinimap = (event: React.PointerEvent<HTMLDivElement>) => {
    const v = viewerRef.current;
    if (!v?.world.getItemCount() || !minimapRef.current || !metadata) return;
    if (event.type === 'pointermove' && event.buttons !== 1) return;
    const box = minimapRef.current.getBoundingClientRect();
    const ix = ((event.clientX - box.left) / box.width) * metadata.width, iy = ((event.clientY - box.top) / box.height) * metadata.height;
    v.viewport.panTo(v.viewport.imageToViewportCoordinates(ix, iy), event.type === 'pointermove');
    v.viewport.applyConstraints();
  };
  const right = metadata?.transform?.right as number[] | undefined;
  const up = metadata?.transform?.up as number[] | undefined;
  const northAngle = right && up ? Math.atan2(right[1], up[1]) * 180 / Math.PI : 0;
  const minimapSrc = metadata ? localPath(base, metadata.minimap || 'overview.png') : '';

  return <main className={`app ${debug ? 'debug-active' : ''}`}>
    <div ref={containerRef} className="map-canvas" role="region" aria-label={`Interactive orthographic map of ${metadata?.city || 'the city'}. Drag to pan; scroll or pinch to zoom.`} />
    <canvas ref={motionCanvasRef} className="motion-canvas" aria-hidden="true" />
    <svg className="map-overlay" width="100%" height="100%" aria-hidden="true">
      {coverage.length > 2 && <polygon points={coverage.map((p) => `${p.x},${p.y}`).join(' ')} className="coverage-line" />}
      {debug && metadata?.pois.map((poi) => {
        const image = pointForPoi(poi);
        const p = image && screenPoint(image[0], image[1]);
        return p ? <g key={poi.id} transform={`translate(${p.x},${p.y})`}><path d="M-8 0h16M0-8v16" className="debug-cross" /><text x="10" y="4" className="debug-label">{poi.name}</text></g> : null;
      })}
    </svg>
    {!loading && labels.map((poi) => {
      const image = pointForPoi(poi);
      const p = image && screenPoint(image[0], image[1]);
      return p ? <span key={poi.id} className="area-label" style={{ left: p.x, top: p.y }}>{poi.name}</span> : null;
    })}
    {!loading && placeLabels.map(({ poi, x, y }) => <button key={'l' + poi.id} className={`place-label ${poi.category ? 'has-cat' : ''}`} style={{ left: x, top: y, ['--pin' as string]: CATEGORY_COLOR[poi.category || ''] || '#f3efe2' }} onClick={() => choosePoi(poi)} title={poi.name}><span className="dot" /><span className="text">{poi.unnamed ? <i>{poi.name}</i> : poi.name}</span></button>)}
    {!loading && pins.map((poi) => {
      const image = pointForPoi(poi);
      const p = image && screenPoint(image[0], image[1]);
      if (!p || p.x < -60 || p.y < -60 || p.x > window.innerWidth + 60 || p.y > window.innerHeight + 60) return null;
      const iconPin = !!poi.category && (filters.includes(poi.category) || !poi.curated);
      return <button key={poi.id} className={`map-pin ${iconPin ? 'icon-pin' : ''} ${poi.id === selectedId ? 'selected' : ''} ${showPinLabels || poi.id === selectedId || !iconPin ? 'labelled' : ''}`} style={{ left: p.x, top: p.y, ['--pin' as string]: CATEGORY_COLOR[poi.category || ''] || '#e0654b' }} onClick={() => choosePoi(poi)} aria-label={poi.name} title={poi.name}>
        <span className="pin-label">{poi.name}</span>{iconPin ? <span className="pin-icon"><PixelIcon category={poi.category} size={16} color="#fff" /></span> : <span className="pin-dot" />}
      </button>;
    })}

    <div className="brand-chip" title={metadata?.subtitle}>
      <strong>{metadata?.city || 'Indian Pixel City'}</strong><span>{metadata?.subtitle || 'Local edition'}</span>
    </div>

    <div className={`search ${searchOpen ? 'open' : ''}`} role="combobox" aria-expanded={searchOpen && results.length > 0} aria-haspopup="listbox">
      <Search size={18} className="search-icon" />
      <input ref={searchRef} value={query} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
        onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveResult((i) => Math.min(results.length - 1, i + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveResult((i) => Math.max(0, i - 1)); }
          else if (event.key === 'Enter' && results[activeResult]) choosePoi(results[activeResult]);
          else if (event.key === 'Escape') { setQuery(''); searchRef.current?.blur(); }
        }}
        placeholder="Search sector, street or place" aria-label="Search places, sectors and streets" aria-controls="search-results" />
      {query && <button className="clear" onMouseDown={(e) => e.preventDefault()} onClick={() => setQuery('')} aria-label="Clear search"><X size={15} /></button>}
      {searchOpen && <ul id="search-results" role="listbox" className="results">
        {!query && results.length > 0 && <li className="results-heading">Places to begin</li>}
        {results.map((poi, i) => <li key={poi.id} role="option" aria-selected={i === activeResult}>
          <button className={i === activeResult ? 'active' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choosePoi(poi)}>
            {poi.category ? <PixelIcon category={poi.category} size={14} /> : <MapPin size={14} />}<span className="result-name">{poi.name}</span>{poi.gujarati && <span className="result-alt" lang="gu">{poi.gujarati}</span>}<span className="result-kind">{poi.kind}</span>
          </button></li>)}
        {query && results.length === 0 && <li className="no-results">No mapped place in this coverage matches “{query}”.</li>}
      </ul>}
    </div>

    {!social.offline && social.snap && <div className="presence" aria-label={`${social.snap.onlineCount} on the map now, ${social.snap.visits} visits`}>
      <span className="faces">{social.snap.online.slice(0, 5).map((id) => <PixelFace key={id} id={id} size={22} title={id === social.id ? 'You' : 'Another visitor'} />)}{social.snap.onlineCount > 5 && <b>+{social.snap.onlineCount - 5}</b>}</span>
      <span className="counts"><strong data-testid="online">{social.snap.onlineCount}</strong> here now · <span data-testid="visits">{social.snap.visits.toLocaleString('en-IN')}</span> visits</span>
    </div>}

    {gameOpen && metadata && <DailyGame metadata={metadata} base={base} viewer={ready ? viewer : null} screenPoint={screenPoint} me={social.id} snap={social.snap} offline={social.offline} sendGuess={social.sendGuess} onClose={() => setGameOpen(false)} />}

    {!!metadata?.categories?.length && <div ref={placesRef} className={`places ${placesOpen ? 'open' : ''}`}>
      <button className="places-toggle" aria-expanded={placesOpen} aria-controls="places-panel" onClick={() => setPlacesOpen(!placesOpen)}>
        <MapPin size={15} /><span>Places</span>
        {filters.length > 0 ? <span className="active-icons">{filters.slice(0, 4).map((id) => <PixelIcon key={id} category={id} size={13} />)}{filters.length > 4 && <b>+{filters.length - 4}</b>}</span> : <span className="hint">Filter</span>}
        <ChevronDown size={14} className="chev" />
      </button>
      {filters.length > 0 && !placesOpen && <button className="places-clear" onClick={() => setFilters([])} aria-label="Clear place filters"><X size={13} /></button>}
      {placesOpen && <div id="places-panel" className="places-panel" role="group" aria-label="Show places by category">
        <div className="places-head"><span>Show on map</span><span className="places-actions"><button onClick={() => setFilters(metadata.categories!.map((c) => c.id))}>All</button><button onClick={() => setFilters([])} disabled={!filters.length}>Clear</button></span></div>
        <div className="places-grid">
          {metadata.categories.map((c) => { const on = filters.includes(c.id); return <button key={c.id} className={on ? 'active' : ''} aria-pressed={on} onClick={() => toggleFilter(c.id)} style={{ ['--chip' as string]: CATEGORY_COLOR[c.id] }} title={c.label}>
            <span className="tile-icon"><PixelIcon category={c.id} size={16} color={on ? '#fff' : undefined} /></span><span className="tile-label">{SHORT_LABEL[c.id] || c.label}</span><span className="count">{c.count}</span>
          </button>; })}
        </div>
      </div>}
    </div>}
    <nav className="controls" aria-label="Map controls">
      <button className="compass" onClick={reset} aria-label="Reset view" title="North as projected by the fixed camera">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><g transform={`rotate(${northAngle} 12 12)`}><path d="M12 2 16 13 12 11 8 13Z" fill="#e0654b" /><path d="M12 22 8 11 12 13 16 11Z" fill="#cfd3c8" /></g></svg>
      </button>
      <button onClick={() => zoom(1.6)} aria-label="Zoom in" title="Zoom in (+)"><Plus size={19} /></button>
      <button onClick={() => zoom(1 / 1.6)} aria-label="Zoom out" title="Zoom out (−)"><Minus size={19} /></button>
      <button onClick={reset} aria-label="Reset map" title="Reset view (0)"><LocateFixed size={18} /></button>
      <button onClick={randomLandmark} aria-label="Random landmark" title="Random landmark (R)" disabled={!ready}><Dices size={18} /></button>
      <button onClick={() => { setGameOpen(!gameOpen); setSelectedId(null); }} aria-label="Daily landmark game" aria-pressed={gameOpen} className={gameOpen ? 'active' : ''} title="Find the landmark — daily game (D)" disabled={!ready}><Target size={18} /></button>
      <button onClick={share} aria-label="Copy link to this view" title="Share view" disabled={!ready}>{copied ? <Check size={18} /> : <Share2 size={18} />}</button>
      <button onClick={() => setLayersOpen(!layersOpen)} aria-label="Map layers" aria-expanded={layersOpen} title="Layers"><Layers size={18} /></button>
      <button onClick={() => setInfoOpen(true)} aria-label="About this map" title="About (?)"><Info size={18} /></button>
      {layersOpen && <div className="layer-menu" role="menu">
        <span className="menu-heading">Time &amp; climate</span>
        {SCENE_LAYERS.map((l) => <button key={l} role="menuitemradio" aria-checked={layer === l} disabled={!layers[l]} title={layers[l] ? undefined : 'Not exported for this map yet — still rendering or tiling'} className={layer === l ? 'active' : ''} onClick={() => { setLiveClock(false); setLayer(l); setLayersOpen(false); }}>{LAYER_LABEL[l]}</button>)}
        <span className="menu-heading">Style</span>
        {STYLE_LAYERS.map((l) => <button key={l} role="menuitemradio" aria-checked={layer === l} disabled={!layers[l]} title={layers[l] ? undefined : 'Not exported for this map yet — still rendering or tiling'} className={layer === l ? 'active' : ''} onClick={() => { setLiveClock(false); setLayer(l); setLayersOpen(false); }}>{LAYER_LABEL[l]}</button>)}
        <span className="menu-heading">Motion</span>
        <button role="menuitemcheckbox" aria-checked={liveClock} className={liveClock ? 'active' : ''} disabled={!layers.night} onClick={() => setLiveClock(!liveClock)} title="Day, dusk and night follow the current time in India">Live India time</button>
        <button role="menuitemcheckbox" aria-checked={motionOn} className={motionOn ? 'active' : ''} disabled={!motionData} onClick={() => setMotionOn(!motionOn)} title={reducedMotion ? 'Your system asks for reduced motion' : 'Traffic, metro, windows, lamps, fireflies and monsoon clouds'}>Night &amp; weather motion</button>
        <p>{Object.keys(layers).length < 6 ? 'Greyed layers are still being rendered or tiled. ' : ''}All layers are the same geometry rendered with different light and palette. No generative art layer exists yet.</p>
      </div>}
    </nav>

    {metadata && <div className="minimap" aria-label="Overview map; click or drag to move">
      <div ref={minimapRef} className="minimap-frame" style={{ width: MINIMAP_WIDTH, height: miniHeight }} onPointerDown={panFromMinimap} onPointerMove={panFromMinimap}>
        <img src={minimapSrc} alt="" draggable={false} />
        <canvas ref={miniBlankRef} className="minimap-blank" width={MINIMAP_WIDTH * 2} height={miniHeight * 2} aria-hidden="true" />
        {miniRect && <span className="minimap-view" style={{ left: miniRect.x, top: miniRect.y, width: miniRect.w, height: miniRect.h }} />}
      </div>
      <span className="minimap-zoom">{imageZoom ? `${Math.round(imageZoom * 100)}%` : '—'}</span>
    </div>}

    <footer className="attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">{metadata?.attribution || '© OpenStreetMap contributors · ODbL 1.0'}</a><span> · {LAYER_LABEL[layerRef.current]} · {metadata?.version}</span></footer>

    {selected && <div className="place-card" role="dialog" aria-label={selected.name}>
      <button className="close" onClick={() => setSelectedId(null)} aria-label="Close"><X size={15} /></button>
      <span className="kind">{selected.kind}</span><strong>{selected.name}</strong>{selected.gujarati && <span lang="gu" className="alt">{selected.gujarati}</span>}
      {selected.description && <p>{selected.description}</p>}
      {Number.isFinite(selected.lat) && <span className="coords">{selected.lat!.toFixed(5)}° N · {selected.lon!.toFixed(5)}° E</span>}
    </div>}
    {missingTiles > 0 && !error && <div className="toast" role="status"><Info size={15} /><span>{missingTiles} local tile{missingTiles > 1 ? 's' : ''} missing — shown as blank ground. Re-run <code>npm run export-map</code>.</span><button onClick={() => setMissingTiles(0)} aria-label="Dismiss"><X size={13} /></button></div>}
    {versionNotice && <div className="toast upper" role="status"><Info size={15} /><span>{versionNotice}</span><button onClick={() => setVersionNotice('')} aria-label="Dismiss"><X size={13} /></button></div>}
    {(loading || error) && <div className="map-status" role="status"><h2>{error ? 'Local map not ready' : 'Loading local tiles…'}</h2>{error && <><p>{error}</p><code>npm run render-pilot && npm run export-map</code></>}</div>}
    {shareFallback && <div className="share-fallback" role="dialog" aria-label="Copy share link"><input readOnly value={shareFallback} onFocus={(e) => e.target.select()} autoFocus aria-label="Share URL" /><button onClick={() => setShareFallback('')} aria-label="Close"><X size={14} /></button></div>}
    {infoOpen && <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) setInfoOpen(false); }}><section className="about" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <button className="close" onClick={() => setInfoOpen(false)} aria-label="Close" autoFocus><X size={18} /></button>
      <h2 id="about-title">{metadata?.title || 'Indian Pixel City'}</h2>
      <p>{metadata?.subtitle}. Rendered on this machine from OpenStreetMap data; all tiles, search and fonts are local. The visitor counter and daily game talk only to this site's own server, with anonymous per-tab ids (no IPs or cookies).</p>
      <p><strong>Geometry.</strong> {metadata?.geometryNote}</p>
      <p><strong>Art status.</strong> {metadata?.artNote || 'Deterministic render only.'}</p>
      <p><strong>Coverage.</strong> {metadata?.coverage?.note || 'The dashed line marks the working extent.'}</p>
      {maps.length > 1 && <p><strong>Maps on this machine.</strong> {maps.map((m, i) => <span key={m.id}>{i ? ' · ' : ''}{m.id === mapId ? <b>{m.subtitle || m.id}</b> : <a href={`/?map=${encodeURIComponent(m.id)}`}>{m.subtitle || m.id}</a>}</span>)} · <a href="/?map=jaipur">Jaipur (historical)</a></p>}
      <p className="keys"><kbd>/</kbd> search · <kbd>+</kbd><kbd>−</kbd> zoom · <kbd>0</kbd> reset · <kbd>R</kbd> random landmark · <kbd>D</kbd> daily game · arrows pan · <kbd>G</kbd> debug</p>
      <p className="fine">{metadata?.attribution}</p>
    </section></div>}
  </main>;
}
