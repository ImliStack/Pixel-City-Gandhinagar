import { useCallback, useEffect, useRef, useState } from 'react';
import { BEAT_MS, type Guess, type Snapshot } from '../shared/social-core.mjs';

// Anonymous per-tab id (sessionStorage): two tabs are two visitors, nothing identifies a person.
function sessionId(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
  try {
    let id = sessionStorage.getItem('pc-id');
    if (!id || !/^[a-z0-9]{8,32}$/.test(id)) { id = make(); sessionStorage.setItem('pc-id', id); }
    return id;
  } catch { return make(); }
}

export type PendingGuess = Guess & { day: string; round: number };

// Heartbeat polling to /api/social/beat. Works with the Vite dev middleware and the Cloudflare
// Worker alike; when neither answers (static hosting, offline) `offline` turns true and the
// rest of the viewer is unaffected.
export function useSocial() {
  const [id] = useState(sessionId);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const pending = useRef<PendingGuess[]>([]);
  const timer = useRef(0);
  const beatRef = useRef<() => void>(() => {});

  const beat = useCallback(async () => {
    window.clearTimeout(timer.current);
    let hello = false;
    try { hello = !sessionStorage.getItem('pc-hello'); } catch { /* storage blocked: count nothing */ }
    const guess = pending.current[0];
    try {
      const response = await fetch('/api/social/beat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, hello, guess }) });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('no social server');
      const value: Snapshot = await response.json();
      if (hello) try { sessionStorage.setItem('pc-hello', '1'); } catch { /* ignore */ }
      if (guess && value.game.mine[guess.round]) pending.current.shift();
      setSnap(value); setOffline(false);
      timer.current = window.setTimeout(() => beatRef.current(), pending.current.length ? 300 : BEAT_MS);
    } catch {
      setOffline(true);
      timer.current = window.setTimeout(() => beatRef.current(), BEAT_MS * 4);
    }
  }, [id]);
  beatRef.current = beat;

  useEffect(() => {
    beat();
    const onVisible = () => { if (!document.hidden) beat(); };
    const bye = () => { try { navigator.sendBeacon('/api/social/beat', new Blob([JSON.stringify({ id, bye: true })], { type: 'application/json' })); } catch { /* ignore */ } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', bye);
    return () => { window.clearTimeout(timer.current); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('pagehide', bye); };
  }, [beat, id]);

  const sendGuess = useCallback((guess: PendingGuess) => { pending.current.push(guess); beat(); }, [beat]);
  return { id, snap, offline, sendGuess };
}
