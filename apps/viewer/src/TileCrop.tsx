import { clueTiles } from '../shared/daily.mjs';
import type { Metadata } from './types';

// A square crop of the map's own tiles around an image point. `level` counts down from full
// resolution (0 = native, 2 = quarter size); `zoom` > 1 enlarges with nearest-neighbour for a pixel look.
export function TileCrop({ metadata, base, dzi, point, size, level = 2, zoom = 1, className, children, label }: {
  metadata: Metadata; base: string; dzi?: string; point: [number, number]; size: number; level?: number; zoom?: number; className?: string; children?: React.ReactNode; label?: string;
}) {
  const maxLevel = Math.ceil(Math.log2(Math.max(metadata.width, metadata.height)));
  const dir = `${base}${(dzi || metadata.layers?.A?.dzi || metadata.dzi).replace(/\.dzi$/, '')}_files/`;
  const inner = Math.ceil(size / zoom);
  const tiles = clueTiles({ width: metadata.width, height: metadata.height, tileSize: metadata.tileSize || 512, overlap: metadata.overlap ?? 1 }, point, maxLevel - level, inner);
  return <div className={`tile-crop ${className || ''}`} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
    <div className="tile-crop-inner" style={{ width: inner, height: inner, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}>
      {tiles.map((t) => <img key={t.file} src={`${dir}${t.file}.${metadata.format || 'webp'}`} alt="" draggable={false} style={{ left: t.left, top: t.top }} />)}
    </div>
    {children}
  </div>;
}
