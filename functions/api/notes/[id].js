// PUT /api/notes/:id    — create or replace one note
// DELETE /api/notes/:id  — remove it
//
// The link is public and unauthenticated by design: anyone who has it can
// write. The only guards are shape and size, so a stray script cannot turn
// the board into a dumping ground.

import {
  readBoard, writeBoard, validId, clean, json, MAX_NOTES,
} from "../../../lib/board.js";

export async function onRequestPut({ params, request, env }) {
  const id = params.id;
  if (!validId(id)) return json({ error: "bad id" }, 400);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "bad body" }, 400);
  }

  const board = await readBoard(env);
  const isNew = !(id in board.notes);
  if (isNew && Object.keys(board.notes).length >= MAX_NOTES) {
    return json({ error: "board is full" }, 409);
  }

  board.notes[id] = clean(body);
  return json({ ok: true, v: await writeBoard(env, board) });
}

export async function onRequestDelete({ params, env }) {
  const id = params.id;
  if (!validId(id)) return json({ error: "bad id" }, 400);

  const board = await readBoard(env);
  if (!(id in board.notes)) return json({ ok: true, v: board.v });

  delete board.notes[id];
  return json({ ok: true, v: await writeBoard(env, board) });
}
