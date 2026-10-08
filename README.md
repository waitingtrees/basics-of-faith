# Basics of Faith S3 — reference canvas

An infinite canvas of the [Are.na channel](https://are.na/constant/basics-of-faith-s3),
with notes anyone holding the link can add.

Frames load live from Are.na on every visit, so adding a block to the
channel is all it takes — nothing here needs rebuilding or redeploying.

## Shape

    docs/index.html        markup + styles
    docs/app.js            canvas, camera, intro, notes
    functions/api/arena.js   GET  /api/arena      channel blocks, edge-cached 5 min
    functions/api/notes/     GET  /api/notes      the whole board
                             PUT  /api/notes/:id  upsert one note
                             DEL  /api/notes/:id  remove one note
    lib/board.js             the KV board: one value, {v, notes}

## Deploy

    npx wrangler login                              # once
    npx wrangler kv namespace create NOTES          # once; put the id in wrangler.jsonc
    npx wrangler pages deploy docs

Local: `npx wrangler pages dev docs` (add `--kv NOTES` for a local board).

## Notes on the notes

The board is one KV value polled every 3 seconds. Writes are
last-writer-wins per note, and the page never overwrites a note the
visitor is mid-edit or mid-drag.

The link is unauthenticated on purpose — anyone with it can write. Guards
are shape and size only: 500 notes, 4000 characters each.

The site lives in `docs/` because GitHub Pages serves this repo from that
folder; Cloudflare Pages is pointed at the same directory, so one tree
serves both hosts.
