import { useEffect, useMemo, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { ChevronLeft, X } from 'lucide-react';
import { buildHunts, foundInView, FIND_ZOOM, type Hunt } from '../shared/hunts.mjs';
import { nearestArea, type Metadata, type Poi } from './types';
import { PixelIcon } from './icons';

type Progress = Record<string, string[]>;
const KEY = 'pc-hunts';
const load = (): Progress => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

// Scavenger hunts: pick a list, then explore. A place is stamped when you hold the map close in with
// it near the middle of the screen. Progress stays in this browser; completions are counted (anonymously)
// through the presence channel so everyone sees how many visitors finished each hunt.
export function Hunts({ metadata, viewer, counts, reportHunt, onClose, onFly }: {
  metadata: Metadata; viewer: OpenSeadragon.Viewer | null; counts: Record<string, number>; reportHunt: (id: string) => void; onClose: () => void; onFly: (poi: Poi) => void;
}) {
  const hunts = useMemo(() => buildHunts(metadata.pois) as Hunt[], [metadata]);
  const byId = useMemo(() => new Map(metadata.pois.map((p) => [p.id, p])), [metadata]);
  const [progress, setProgress] = useState<Progress>(load);
  const [active, setActive] = useState<string | null>(() => { try { return localStorage.getItem('pc-hunt-active'); } catch { return null; } });
  const [flash, setFlash] = useState<string | null>(null);
  const progressRef = useRef(progress); progressRef.current = progress;
  const hunt = hunts.find((h) => h.id === active) || null;
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(progress)); if (active) localStorage.setItem('pc-hunt-active', active); else localStorage.removeItem('pc-hunt-active'); } catch { /* ignore */ } }, [progress, active]);

  // Check the view a few times a second while a hunt is active.
  useEffect(() => {
    if (!hunt || !viewer) return;
    const timer = window.setInterval(() => {
      if (!viewer.world.getItemCount()) return;
      const r = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
      const zoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
      const have = progressRef.current[hunt.id] || [];
      const found = foundInView(metadata.pois, hunt.places.filter((id) => !have.includes(id)), { x: r.x, y: r.y, w: r.width, h: r.height, zoom });
      if (!found.length) return;
      const next = [...have, ...found];
      setProgress((p) => ({ ...p, [hunt.id]: next }));
      setFlash(found[0]);
      window.setTimeout(() => setFlash(null), 2600);
      if (next.length === hunt.places.length) reportHunt(hunt.id);
    }, 400);
    return () => window.clearInterval(timer);
  }, [hunt, viewer, metadata, reportHunt]);

  const have = hunt ? progress[hunt.id] || [] : [];
  const flashed = flash ? byId.get(flash) : null;
  return <>
    {flashed && <div className="hunt-toast" role="status"><PixelIcon category={flashed.category} size={16} color="#fff" /><span><b>Found {flashed.name}!</b> {hunt && `${have.length}/${hunt.places.length}`}{hunt && have.length === hunt.places.length ? ' · Hunt complete 🎉' : ''}</span></div>}
    <section className="hunt-panel" aria-label="Scavenger hunts">
      <header>
        {hunt ? <button className="back" onClick={() => setActive(null)} aria-label="All hunts"><ChevronLeft size={16} /></button> : null}
        <div><strong>{hunt ? hunt.title : 'Scavenger hunts'}</strong><span>{hunt ? hunt.blurb : 'Explore real places. Zoom in on one to stamp it.'}</span></div>
        <button className="close" onClick={onClose} aria-label="Close hunts"><X size={15} /></button>
      </header>
      {!hunt && <ul className="hunt-list">{hunts.map((h) => { const n = (progress[h.id] || []).length, done = n === h.places.length; return <li key={h.id}><button onClick={() => setActive(h.id)} data-testid={`hunt-${h.id}`}>
        <span className="tile-icon" style={{ ['--chip' as string]: 'transparent' }}><PixelIcon category={h.icon} size={16} /></span>
        <span className="meta"><b>{h.title}</b><small>{counts[h.id] ? `${counts[h.id]} visitor${counts[h.id] > 1 ? 's' : ''} finished` : 'Be the first to finish'}</small></span>
        <span className={`count ${done ? 'done' : ''}`}>{done ? '✓' : `${n}/${h.places.length}`}</span>
        <i className="bar" style={{ width: `${(100 * n) / h.places.length}%` }} />
      </button></li>; })}</ul>}
      {hunt && <>
        <div className="hunt-progress"><i style={{ width: `${(100 * have.length) / hunt.places.length}%` }} /><span>{have.length} of {hunt.places.length} found{counts[hunt.id] ? ` · ${counts[hunt.id]} finished` : ''}</span></div>
        <ul className="hunt-places">{hunt.places.map((id) => { const p = byId.get(id)!, got = have.includes(id), area = nearestArea(metadata.pois, p)?.name; return <li key={id} className={got ? 'got' : ''}>
          <button onClick={() => got && onFly(p)} disabled={!got} title={got ? 'Fly there' : `Somewhere${area ? ` near ${area}` : ' in the city'}. Zoom in on it to stamp it`}>
            <span className="stamp">{got ? <PixelIcon category={p.category || hunt.icon} size={14} color="#fff" /> : '?'}</span>
            <span className="name">{p.name}</span><span className="area">{got ? 'found' : area || ''}</span>
          </button></li>; })}</ul>
        <p className="fine">Hold a place near the centre at ≥{Math.round(FIND_ZOOM * 100)}% zoom to stamp it. The sector next to each place is your hint.</p>
      </>}
    </section>
  </>;
}
