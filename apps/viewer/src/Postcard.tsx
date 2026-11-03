import { useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { Download, Share2, X } from 'lucide-react';

// Photo mode: frame the current view (map tiles + motion layer) as a postcard with a caption and the
// OSM attribution, then save it, or share it on devices that support sharing files.
export function Postcard({ viewer, motionCanvas, defaultCaption, layerLabel, onClose }: {
  viewer: OpenSeadragon.Viewer | null; motionCanvas: HTMLCanvasElement | null; defaultCaption: string; layerLabel: string; onClose: () => void;
}) {
  const [caption, setCaption] = useState(defaultCaption);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const render = async (): Promise<Blob | null> => {
    const map = (viewer?.drawer as unknown as { canvas?: HTMLCanvasElement })?.canvas;
    if (!map) return null;
    const w = map.width, h = map.height, pad = Math.round(w * 0.03), strip = Math.round(w * 0.085);
    const card = document.createElement('canvas'); card.width = w + pad * 2; card.height = h + pad * 2 + strip;
    const ctx = card.getContext('2d')!;
    ctx.fillStyle = '#f6f2e7'; ctx.fillRect(0, 0, card.width, card.height);
    ctx.drawImage(map, pad, pad);
    if (motionCanvas && motionCanvas.width) ctx.drawImage(motionCanvas, pad, pad, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = Math.max(1, w / 900); ctx.strokeRect(pad, pad, w, h);
    const base = card.height - strip - pad / 2, f = (size: number, weight = 600) => `${weight} ${Math.round(size)}px 'DM Sans Variable', system-ui, sans-serif`;
    ctx.fillStyle = '#1f2322'; ctx.font = f(strip * 0.34, 700); ctx.textBaseline = 'top';
    ctx.fillText(caption || 'Gandhinagar', pad, base + strip * 0.18);
    ctx.fillStyle = '#6b6f66'; ctx.font = f(strip * 0.2, 500);
    ctx.fillText(`Pixel City Gandhinagar · ${layerLabel} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, pad, base + strip * 0.6);
    ctx.textAlign = 'right';
    ctx.fillText('© OpenStreetMap contributors · ODbL', card.width - pad, base + strip * 0.6);
    ctx.fillStyle = '#5a8f2c'; ctx.font = f(strip * 0.24, 700); ctx.fillText('ImliStack', card.width - pad, base + strip * 0.18);
    return new Promise((res) => card.toBlob(res, 'image/jpeg', 0.92));
  };

  const fileName = () => `gandhinagar-${(caption || 'postcard').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.jpg`;
  const save = async () => {
    setBusy(true);
    try {
      const blob = await render(); if (!blob) return;
      const url = URL.createObjectURL(blob); setPreview(url);
      const a = document.createElement('a'); a.href = url; a.download = fileName(); document.body.append(a); a.click(); a.remove();
    } finally { setBusy(false); }
  };
  const share = async () => {
    setBusy(true);
    try {
      const blob = await render(); if (!blob) return;
      const file = new File([blob], fileName(), { type: 'image/jpeg' });
      await navigator.share({ files: [file], title: caption, text: `${caption}, Pixel City Gandhinagar`, url: location.href });
    } catch { /* user cancelled */ } finally { setBusy(false); }
  };
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });

  return <section className="postcard-panel" aria-label="Photo mode">
    <header><strong>Photo postcard</strong><span>Frame the view, add a caption, save it.</span><button className="close" onClick={onClose} aria-label="Close photo mode"><X size={15} /></button></header>
    <label className="postcard-caption"><span>Caption</span><input value={caption} maxLength={60} onChange={(e) => setCaption(e.target.value)} data-testid="postcard-caption" /></label>
    <div className="postcard-actions">
      <button className="game-primary" onClick={save} disabled={busy || !viewer} data-testid="postcard-save"><Download size={15} /> Save postcard</button>
      {canShare && <button className="game-secondary" onClick={share} disabled={busy}><Share2 size={14} /> Share</button>}
    </div>
    {preview && <img className="postcard-preview" src={preview} alt="Postcard preview" data-testid="postcard-preview" />}
    <p className="fine">Includes the OpenStreetMap attribution. Night, monsoon and festival scenes are captured as you see them.</p>
  </section>;
}
