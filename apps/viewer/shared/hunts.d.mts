import type { PoolPoi } from './daily.mjs';
export type Hunt = { id: string; title: string; blurb: string; icon: string; places: string[] };
export const FIND_ZOOM: number;
export function buildHunts(pois: PoolPoi[]): Hunt[];
export function foundInView(pois: PoolPoi[], ids: string[], view: { x: number; y: number; w: number; h: number; zoom: number } | null): string[];
