// GET /api/notes — the whole board. The page polls this and diffs by `v`.

import { readBoard, json } from "../../../lib/board.js";

export async function onRequestGet({ env }) {
  return json(await readBoard(env));
}
