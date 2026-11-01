import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import type { Cursor } from '../shared/social-core.mjs';
import { PixelFace } from './icons';

const GLIDE_MS = 3800; // a little under the 4 s heartbeat, so faces keep moving between updates

// Live cursors: where other visitors are looking right now, as their pixel faces. Positions arrive
// every heartbeat; each face glides from its last position to the new one, and the ring size shows
// how far in they are zoomed (bigger ring = closer view).
export function Cursors({ cursors, viewer, onJump }: { cursors: Cursor[]; viewer: OpenSeadragon.Viewer | null; onJump: (c: Cursor) => void }) {
  const tracks = useRef(new Map<string, { from: Cursor; to: Cursor; at: number }>());
  const [, tick] = useState(0);
  useEffect(() => {
    const now = performance.now(), live = new Set(cursors.map((c) => c.id));
    for (const c of cursors) {
      const t = tracks.current.get(c.id);
      if (!t) tracks.current.set(c.id, { from: c, to: c, at: now });
      else if (t.to.x !== c.x || t.to.y !== c.y || t.to.z !== c.z) tracks.current.set(c.id, { from: position(t, now), to: c, at: now });
    }
    for (const id of [...tracks.current.keys()]) if (!live.has(id)) tracks.current.delete(id);
    tick((n) => n + 1); // draw new arrivals even where animation frames are throttled
  }, [cursors]);
  useEffect(() => {
    if (!cursors.length) return;
    let raf = 0, last = 0;
    const loop = (t: number) => { raf = requestAnimationFrame(loop); if (t - last > 33) { last = t; tick((n) => n + 1); } };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cursors.length]);
  if (!viewer?.world.getItemCount()) return null;
  const now = performance.now();
  return <>{[...tracks.current.entries()].map(([id, t]) => {
    const c = position(t, now), p = viewer.viewport.pixelFromPoint(viewer.viewport.imageToViewportCoordinates(c.x, c.y), true);
    if (p.x < -40 || p.y < -40 || p.x > window.innerWidth + 40 || p.y > window.innerHeight + 40) return null;
    const ring = Math.max(26, Math.min(64, 18 + Math.log2(1 + c.z * 40) * 9));
    return <button key={id} className="cursor-mark" style={{ left: p.x, top: p.y, ['--ring' as string]: `${ring}px` }} onClick={() => onJump(c)} title="Another visitor is looking here. Click to join them" aria-label="Go to where another visitor is looking">
      <span className="ring" /><PixelFace id={id} size={22} />
    </button>;
  })}</>;
}

function position(t: { from: Cursor; to: Cursor; at: number }, now: number): Cursor {
  const k = Math.min(1, (now - t.at) / GLIDE_MS), e = k * k * (3 - 2 * k);
  return { id: t.to.id, x: t.from.x + (t.to.x - t.from.x) * e, y: t.from.y + (t.to.y - t.from.y) * e, z: t.from.z + (t.to.z - t.from.z) * e };
}
