import { useEffect, useMemo, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { Check, Copy, Crosshair, X } from 'lucide-react';
import { dailyPuzzle, formatDistance, groundMeters, istDay, MAX_SCORE, ROUNDS, scoreEmoji, scoreFor, type Point } from '../shared/daily.mjs';
import type { Snapshot } from '../shared/social-core.mjs';
import type { PendingGuess } from './social';
import type { Metadata } from './types';
import { PixelFace } from './icons';
import { TileCrop } from './TileCrop';

type Result = { x: number; y: number; score: number; meters: number } | null;
const CLUE = 196;
const load = (key: string): Result[] => { try { const v = JSON.parse(localStorage.getItem(key) || 'null'); if (Array.isArray(v) && v.length === ROUNDS) return v; } catch { /* ignore */ } return Array(ROUNDS).fill(null); };

// Daily "Find the landmark": a close-up crop of a real place; pan the crosshair onto it and guess.
// Everyone gets the same three places per India day; guesses and the board go through the presence channel.
export function DailyGame({ metadata, base, viewer, screenPoint, me, snap, offline, sendGuess, onClose }: {
  metadata: Metadata; base: string; viewer: OpenSeadragon.Viewer | null; screenPoint: (x: number, y: number) => OpenSeadragon.Point | null;
  me: string; snap: Snapshot | null; offline: boolean; sendGuess: (g: PendingGuess) => void; onClose: () => void;
}) {
  const day = istDay();
  const puzzle = useMemo(() => dailyPuzzle(metadata.pois, day), [metadata, day]);
  // Progress is per day and per anonymous tab id, so a second tab is a second player.
  const key = `pc-daily-${day}-${me}`;
  const [results, setResults] = useState<Result[]>(() => load(key));
  const [reveal, setReveal] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(results)); } catch { /* ignore */ } }, [key, results]);
  // Re-send any locally stored guesses the server has not recorded (e.g. after a dev-server restart).
  useEffect(() => { if (snap) results.forEach((r, round) => { if (r && !snap.game.mine[round] && snap.game.day === day) sendGuess({ day, round, x: r.x, y: r.y, score: r.score }); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!snap]);

  const round = results.findIndex((r) => !r);
  const done = round === -1;
  const shown = reveal ?? (done ? null : round);
  const target = shown !== null ? puzzle[shown] : null;
  const total = results.reduce((s, r) => s + (r?.score || 0), 0);

  const center = (): Point | null => {
    if (!viewer?.world.getItemCount()) return null;
    const c = viewer.viewport.viewportToImageCoordinates(viewer.viewport.getCenter());
    return [c.x, c.y];
  };
  const fit = (a: Point, b: Point) => {
    if (!viewer) return;
    const pad = Math.max(600, Math.abs(a[0] - b[0]) * 0.35, Math.abs(a[1] - b[1]) * 0.35);
    const r = viewer.viewport.imageToViewportRectangle(Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.abs(a[0] - b[0]) + 2 * pad, Math.abs(a[1] - b[1]) + 2 * pad);
    viewer.viewport.fitBounds(r); viewer.viewport.applyConstraints();
  };
  const guess = () => {
    const at = center();
    if (!at || done || !puzzle[round]?.image) return;
    const meters = groundMeters(at, puzzle[round].image!, metadata.transform as { scale?: number; up?: number[] });
    const score = scoreFor(meters);
    const next = results.slice(); next[round] = { x: at[0], y: at[1], score, meters };
    setResults(next); setReveal(round);
    sendGuess({ day, round, x: at[0], y: at[1], score });
    fit(at, puzzle[round].image!);
  };
  const shareText = `Gandhinagar Daily ${day} ${results.map((r) => (r ? scoreEmoji(r.score) : '⬜')).join('')} ${total.toLocaleString('en-IN')}/${(MAX_SCORE * ROUNDS).toLocaleString('en-IN')}`;
  const copy = async () => { try { await navigator.clipboard.writeText(`${shareText}\n${location.origin}${location.pathname}`); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ } };

  // Overlays: my guess, the answer and (after guessing) other visitors' guesses for the revealed round.
  const revealed = reveal !== null ? results[reveal] : null;
  const answer = reveal !== null ? puzzle[reveal]?.image : undefined;
  const others = reveal !== null ? snap?.game.guesses[reveal] || [] : [];
  const sp = (p?: Point | null) => (p ? screenPoint(p[0], p[1]) : null);
  const mineS = sp(revealed ? [revealed.x, revealed.y] : null), answerS = sp(answer || null);
  if (!puzzle.length) return null;

  return <>
    <svg className="game-overlay" width="100%" height="100%" aria-hidden="true">
      {mineS && answerS && <line x1={mineS.x} y1={mineS.y} x2={answerS.x} y2={answerS.y} className="game-line" />}
    </svg>
    {others.map((g) => { const p = sp([g.x, g.y]); return p ? <span key={g.id} className="game-mark other" style={{ left: p.x, top: p.y }} title={`Another visitor · ${g.score}`}><PixelFace id={g.id} size={20} /></span> : null; })}
    {mineS && <span className="game-mark mine" style={{ left: mineS.x, top: mineS.y }} title="Your guess"><PixelFace id={me} size={22} /></span>}
    {answerS && <span className="game-mark answer" style={{ left: answerS.x, top: answerS.y }} title={puzzle[reveal!].name}>★</span>}
    {reveal === null && !done && <div className="game-crosshair" aria-hidden="true"><Crosshair size={34} strokeWidth={1.6} /></div>}

    <section className="game-panel" aria-label="Daily landmark game">
      <header><strong>Find the landmark</strong><span>{day} · {done ? 'done' : `round ${(reveal ?? round) + 1}/${ROUNDS}`}</span><button className="close" onClick={onClose} aria-label="Close game"><X size={15} /></button></header>
      {target && <>
        {target.image && <TileCrop metadata={metadata} base={base} point={target.image} size={CLUE} level={2} className="clue" label="Close-up of today's place"><span className="clue-ring" /></TileCrop>}
        {reveal === null
          ? <><p className="hint">A {target.kind === 'landmark' ? 'landmark' : (target.kind || 'place').replace(/_/g, ' ')}{target.category ? ` · ${target.category}` : ''}. Pan the map until the crosshair is on it.</p>
            <button className="game-primary" onClick={guess} data-testid="guess">Guess here</button></>
          : <><p className="answer"><b>{puzzle[reveal].name}</b><span>{formatDistance(results[reveal]!.meters)} away · <b>{results[reveal]!.score.toLocaleString('en-IN')}</b> pts {scoreEmoji(results[reveal]!.score)}</span>{others.length > 0 && <span className="others">{others.length} other visitor{others.length > 1 ? 's' : ''} guessed this round</span>}</p>
            <button className="game-primary" onClick={() => setReveal(null)}>{done ? 'See results' : 'Next place'}</button></>}
      </>}
      {done && reveal === null && <div className="game-done">
        <p className="total">{total.toLocaleString('en-IN')} <small>/ {(MAX_SCORE * ROUNDS).toLocaleString('en-IN')}</small></p>
        <p className="emoji">{results.map((r, i) => <button key={i} onClick={() => { setReveal(i); const r2 = results[i]; if (r2 && puzzle[i].image) fit([r2.x, r2.y], puzzle[i].image!); }} title={puzzle[i].name}>{scoreEmoji(r!.score)}</button>)}</p>
        <button className="game-secondary" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy result'}</button>
        <p className="fine">New places at midnight IST.</p>
      </div>}
      <div className="board">
        <span className="board-head">{offline ? 'Today’s board needs the social server — playing solo.' : `Today · ${snap?.game.players || 0} player${snap?.game.players === 1 ? '' : 's'}`}</span>
        {!offline && snap?.game.board.map((row, i) => <div key={row.id} className={`board-row ${row.id === me ? 'me' : ''}`}><span className="rank">{i + 1}</span><PixelFace id={row.id} size={18} /><span className="who">{row.id === me ? 'You' : 'Visitor'}</span><span className="played">{'●'.repeat(row.played)}{'○'.repeat(ROUNDS - row.played)}</span><b>{row.total.toLocaleString('en-IN')}</b></div>)}
      </div>
    </section>
  </>;
}
