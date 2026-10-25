export type Guess = { x: number; y: number; score: number };
export type Snapshot = { online: string[]; onlineCount: number; visits: number; game: { day: string; players: number; board: { id: string; total: number; played: number }[]; guesses: ({ id: string } & Guess)[][]; mine: (Guess | null)[] } };
export type Room = { beat(body: unknown): { status: number; json: unknown; dirty?: boolean }; snapshot(viewer: string): Snapshot; toJSON(): unknown; readonly visits: number };
export const BEAT_MS: number;
export function createRoom(options?: { ttl?: number; now?: () => number; state?: any }): Room;
export function handle(room: Room, method: string, pathname: string, readBody: () => Promise<string>): Promise<{ status: number; json: unknown; dirty?: boolean }>;
