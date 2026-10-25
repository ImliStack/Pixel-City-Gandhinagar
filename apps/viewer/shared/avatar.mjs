// Deterministic 12×12 pixel-art faces from an anonymous session id (same bitmap style as icons.tsx).
// Left half is generated, right half mirrored. Characters: s skin, h hair, e eye, m mouth, b blush, '.' empty.
import { hash32, rng } from './daily.mjs';

const SKIN = ['#f1c9a5', '#e0ac85', '#c68b5e', '#a26a43', '#7d4f2f', '#f6d7b8'];
const HAIR = ['#2b1d14', '#4a2f1d', '#7a4b28', '#c08a3e', '#e3c16f', '#3a3a46', '#b5462f', '#e0654b', '#5b7be0', '#3fae7a'];
const SHIRT = ['#e0654b', '#3b82c4', '#3fae7a', '#d8a21c', '#c05be0', '#2f9bb3', '#d07a1f', '#7a63d6'];

export function avatarFor(id) {
  const rand = rng(hash32(`avatar:${id}`));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const palette = { s: pick(SKIN), h: pick(HAIR), e: '#1d1d22', m: '#8c3b32', b: '#e98a7d', c: pick(SHIRT) };
  const grid = Array.from({ length: 12 }, () => Array(6).fill('.'));
  // Head: rows 2–9, cols 1–5 (mirrored to 1–10).
  for (let y = 2; y <= 9; y++) for (let x = 1; x < 6; x++) grid[y][x] = 's';
  grid[2][1] = '.'; grid[9][1] = '.';
  // Hair style.
  const style = Math.floor(rand() * 4);
  for (let x = 1; x < 6; x++) grid[1][x] = 'h';
  grid[1][1] = '.';
  for (let x = 1; x < 6; x++) grid[2][x] = 'h';
  if (style >= 1) { grid[3][1] = 'h'; grid[4][1] = 'h'; }
  if (style === 2) { for (let y = 5; y <= 8; y++) grid[y][0] = 'h'; }
  if (style === 3) { grid[0][3] = 'h'; grid[0][4] = 'h'; grid[0][5] = 'h'; }
  // Eyes, blush, mouth.
  const eyeX = rand() < 0.5 ? 3 : 4;
  grid[5][eyeX] = 'e';
  if (rand() < 0.4) grid[4][eyeX] = 'h';
  if (rand() < 0.5) grid[7][2] = 'b';
  const smile = rand() < 0.6;
  grid[8][5] = 'm'; if (smile) grid[7][4] = 'm';
  // Shoulders.
  for (let x = 2; x < 6; x++) { grid[10][x] = 'c'; grid[11][x] = 'c'; }
  grid[11][1] = 'c';
  const rows = grid.map((half) => half.join('') + [...half].reverse().join(''));
  return { rows, palette };
}
