// Topographic contours from word density: a Gaussian KDE on a grid, traced with
// marching squares, joined into closed loops and smoothed. Coordinates are in [0,1].

// Segment table: corner bits are tl=8, tr=4, br=2, bl=1; edges t r b l.
const CASES = [
  [], [['l', 'b']], [['b', 'r']], [['l', 'r']],
  [['t', 'r']], [['l', 't'], ['b', 'r']], [['t', 'b']], [['l', 't']],
  [['l', 't']], [['t', 'b']], [['t', 'r'], ['l', 'b']], [['t', 'r']],
  [['l', 'r']], [['b', 'r']], [['l', 'b']], [],
];

export function contourLines(points, { n = 72, h = 0.055, levels = 8, floor = 0.16 } = {}) {
  const N = n + 1;
  const g = new Float32Array(N * N);
  const inv = 1 / (2 * h * h);
  let max = 0;
  for (let j = 1; j < n; j++) {
    for (let i = 1; i < n; i++) {
      const x = i / n;
      const y = j / n;
      let v = 0;
      for (const p of points) {
        const dx = x - p.x;
        const dy = y - p.y;
        v += Math.exp(-(dx * dx + dy * dy) * inv);
      }
      g[j * N + i] = v;
      if (v > max) max = v;
    }
  } // border stays 0, so every contour closes

  const out = [];
  for (let k = 1; k <= levels; k++) {
    const t = max * (floor + (1 - floor) * Math.pow(k / (levels + 1), 1.1));
    for (const loop of trace(g, n, t)) out.push({ level: k, points: loop });
  }
  return out;
}

function trace(g, n, t) {
  const N = n + 1;
  const at = (i, j) => g[j * N + i];
  // Edge ids are shared between neighbouring cells, so segments join exactly.
  const edgeId = (i, j, e) =>
    e === 't' ? `h${i},${j}` : e === 'b' ? `h${i},${j + 1}` : e === 'l' ? `v${i},${j}` : `v${i + 1},${j}`;
  const pos = new Map();
  const point = (id) => {
    let p = pos.get(id);
    if (p) return p;
    const [a, b] = id.slice(1).split(',').map(Number);
    let x0 = a, y0 = b, x1 = a, y1 = b;
    if (id[0] === 'h') x1 = a + 1;
    else y1 = b + 1;
    const v0 = at(x0, y0);
    const v1 = at(x1, y1);
    const f = (t - v0) / (v1 - v0 || 1e-9);
    p = [(x0 + (x1 - x0) * f) / n, (y0 + (y1 - y0) * f) / n];
    pos.set(id, p);
    return p;
  };

  const segs = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = (at(i, j) > t) << 3 | (at(i + 1, j) > t) << 2 | (at(i + 1, j + 1) > t) << 1 | (at(i, j + 1) > t);
      for (const [e1, e2] of CASES[c]) segs.push([edgeId(i, j, e1), edgeId(i, j, e2)]);
    }
  }

  const byEdge = new Map();
  segs.forEach((s, idx) => s.forEach((e) => (byEdge.get(e) ?? byEdge.set(e, []).get(e)).push(idx)));
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const chain = [segs[s][0], segs[s][1]];
    for (;;) {
      const tail = chain[chain.length - 1];
      const next = byEdge.get(tail).find((x) => !used[x]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next];
      chain.push(a === tail ? b : a);
    }
    if (chain.length > 4) loops.push(chain.map(point));
  }
  return loops;
}

/** Closed Catmull-Rom spline through pts (already in pixel space) as an SVG path. */
export function smoothPath(pts) {
  const p = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
  const n = p.length;
  const f = (v) => v.toFixed(1);
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + 'Z';
}
