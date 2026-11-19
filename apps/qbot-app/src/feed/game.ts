/** Local ordering toy for the lesson 1 immersive page. Nothing leaves the device. */

export const GAME_FIXED = ["系统提示", "工具定义", "用户消息"] as const;

export const GAME_CHIPS = [
  { id: "think", label: "模型思考 + 工具调用" },
  { id: "result", label: "工具结果" },
  { id: "noise", label: "天气预报" },
] as const;

const ANSWER = ["think", "result"] as const;

export type GameBoard = {
  pool: string[];
  slots: (string | null)[];
};

export function initialBoard(): GameBoard {
  return { pool: GAME_CHIPS.map((chip) => chip.id), slots: [null, null] };
}

export function chipLabel(id: string): string {
  return GAME_CHIPS.find((chip) => chip.id === id)?.label ?? id;
}

export function placeOnBoard(board: GameBoard, id: string, slot: number): GameBoard {
  if ((slot !== 0 && slot !== 1) || !GAME_CHIPS.some((chip) => chip.id === id)) return board;
  const slots = board.slots.map((item) => (item === id ? null : item));
  const displaced = slots[slot] ?? null;
  slots[slot] = id;
  const pool = board.pool.filter((item) => item !== id);
  if (displaced && !pool.includes(displaced)) pool.push(displaced);
  return { pool, slots };
}

export function returnChip(board: GameBoard, slot: number): GameBoard {
  const id = board.slots[slot];
  if (!id) return board;
  const slots = board.slots.slice();
  slots[slot] = null;
  return { pool: board.pool.includes(id) ? board.pool : [...board.pool, id], slots };
}

export function placedCount(board: GameBoard): number {
  return GAME_FIXED.length + board.slots.filter((item) => item !== null).length;
}

export function boardCorrect(board: GameBoard): boolean {
  return board.slots[0] === ANSWER[0] && board.slots[1] === ANSWER[1];
}

export function checkBoard(board: GameBoard): "empty" | "wrong" | "right" {
  if (board.slots.some((item) => item === null)) return "empty";
  return boardCorrect(board) ? "right" : "wrong";
}
