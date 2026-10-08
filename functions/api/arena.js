// GET /api/arena — the channel's image blocks, newest state, cached at the edge.
//
// Proxying rather than letting the browser hit Are.na directly keeps the
// channel slug in one place, trims the payload to what the canvas needs,
// and spends one upstream request per 5 minutes instead of one per visitor.

const CHANNEL = "basics-of-faith-s3";
const EDGE_TTL = 300;     // seconds the edge holds Are.na's answer
const CLIENT_TTL = 120;   // seconds a browser may reuse ours

export async function onRequestGet() {
  const upstream = `https://api.are.na/v2/channels/${CHANNEL}?per=100`;

  const res = await fetch(upstream, {
    headers: { "user-agent": "basics-of-faith-canvas", accept: "application/json" },
    cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
  });

  if (!res.ok) {
    return json({ error: "are.na returned " + res.status }, 502);
  }

  const channel = await res.json();

  // `display` is Are.na's 1200px variant — the right size for the canvas.
  // `thumb` is loaded first, purely to read each frame's aspect ratio.
  const blocks = (channel.contents || [])
    .filter((b) => b.class === "Image" && b.image?.display?.url && b.image?.thumb?.url)
    .map((b) => ({
      id: String(b.id),
      src: b.image.display.url,
      thumb: b.image.thumb.url,
    }));

  return json(blocks, 200, CLIENT_TTL);
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}
