// The word map: contours, dots, labels, the player's pin and the reveal.
import { contourLines, smoothPath } from './contours.js';
import { reducedMotion, svgEl } from './util.js';

const SPRING = 'cubic-bezier(.2,.9,.3,1.25)';
const OUT = 'cubic-bezier(.2,.8,.2,1)';
const PIN_PATH = 'M0 0C-2.6-7-10.5-12.4-10.5-20.5a10.5 10.5 0 1 1 21 0C10.5-12.4 2.6-7 0 0Z';

const ctx = document.createElement('canvas').getContext('2d');
function measure(text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

const FONTS = {
  anchor: (s) => ({ font: `700 ${s}px "Bricolage Grotesque", system-ui, sans-serif`, size: s }),
  label: (s) => ({ font: `italic 450 ${s}px "Source Serif 4", Georgia, serif`, size: s }),
  target: (s) => ({ font: `800 ${s}px "Bricolage Grotesque", system-ui, sans-serif`, size: s }),
};

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Greedy label placement around each dot, avoiding other labels and dots. */
function placeLabels(items, S, placed = [], dots = []) {
  const out = [];
  for (const it of items) {
    const w = measure(it.text, it.font) + 2;
    const h = it.size;
    const g = it.gap;
    const cands = [
      [it.x + g, it.y - h / 2], [it.x - g - w, it.y - h / 2],
      [it.x + g * 0.6, it.y - g * 0.6 - h], [it.x + g * 0.6, it.y + g * 0.6],
      [it.x - g * 0.6 - w, it.y - g * 0.6 - h], [it.x - g * 0.6 - w, it.y + g * 0.6],
      [it.x - w / 2, it.y - g - h], [it.x - w / 2, it.y + g],
    ];
    let best = null;
    cands.forEach(([x, y], k) => {
      const box = { x, y, w, h };
      let cost = k * 0.6;
      const m = 3;
      if (x < m || y < m || x + w > S - m || y + h > S - m) cost += 1e6;
      for (const p of placed) cost += overlap(box, p) * 4;
      for (const d of dots) if (d !== it.dot) cost += overlap(box, d) * 2;
      if (!best || cost < best.cost) best = { ...box, cost };
    });
    placed.push(best);
    out.push({ ...it, box: best });
  }
  return out;
}

export class MapView {
  constructor(svg, { onPin, onSubmit } = {}) {
    this.svg = svg;
    this.onPin = onPin;
    this.onSubmit = onSubmit;
    this.round = null;
    this.pin = null;
    this.revealed = false;
    this.interactive = false;
    this.debug = false;
    this.S = 0;
    this.#bindInput();
    new ResizeObserver(() => {
      const S = Math.round(this.svg.getBoundingClientRect().width);
      if (this.round && S && S !== this.S) this.render();
    }).observe(svg);
  }

  /** Show a new round. Animates the survey-in unless `animate` is false. */
  load(round, { animate = true, debug = false } = {}) {
    this.round = round;
    this.debug = debug;
    this.pin = null;
    this.revealed = false;
    round._contours ??= contourLines(round.words);
    this.render();
    if (animate && !reducedMotion()) return this.#surveyIn();
    return Promise.resolve();
  }

  render() {
    const r = this.round;
    const S = (this.S = Math.round(this.svg.getBoundingClientRect().width) || 360);
    const svg = this.svg;
    svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svg.replaceChildren();
    const P = (v) => v * S;
    const fs = Math.max(11, Math.min(15, S / 30));

    const anchor = r.words[0];
    this.anchorPx = [P(anchor.x), P(anchor.y)];

    // graticule ticks along the frame, a quiet nod to survey charts
    const frame = svgEl('g', { class: 'graticule' }, svg);
    for (let k = 1; k < 10; k++) {
      const v = (k * S) / 10;
      const len = k === 5 ? 9 : 5;
      svgEl('line', { x1: v, y1: 0, x2: v, y2: len }, frame);
      svgEl('line', { x1: v, y1: S, x2: v, y2: S - len }, frame);
      svgEl('line', { x1: 0, y1: v, x2: len, y2: v }, frame);
      svgEl('line', { x1: S, y1: v, x2: S - len, y2: v }, frame);
    }

    const topo = (this.topo = svgEl('g', { class: 'topo' }, svg));
    for (const c of r._contours) {
      const d = smoothPath(c.points.map(([x, y]) => [P(x), P(y)]));
      svgEl('path', { d, class: `tint lv${c.level}` }, topo);
    }
    for (const c of r._contours) {
      const d = smoothPath(c.points.map(([x, y]) => [P(x), P(y)]));
      svgEl('path', { d, class: `contour${c.level % 4 === 0 ? ' index' : ''}`, 'data-level': c.level }, topo);
    }

    const dotsG = (this.dotsG = svgEl('g', { class: 'dots' }, svg));
    const showAll = this.debug;
    this.dotEls = r.words.map((w, i) => {
      const cls = i === 0 ? 'dot anchor' : w.label || showAll ? 'dot labeled' : 'dot';
      const [x, y] = [P(w.x), P(w.y)];
      const el =
        i === 0
          ? svgEl('polygon', { points: `${x},${y - 6} ${x + 6},${y} ${x},${y + 6} ${x - 6},${y}`, class: cls }, dotsG)
          : svgEl('circle', { cx: x, cy: y, r: w.label || showAll ? 3.1 : 2.4, class: cls }, dotsG);
      if (this.debug && w.w === r.target) el.classList.add('is-target');
      return el;
    });
    this.dotBoxes = r.words.map((w) => ({ x: P(w.x) - 4, y: P(w.y) - 4, w: 8, h: 8 }));

    // labels: anchor first so it gets the best spot
    const items = [];
    r.words.forEach((w, i) => {
      if (!(i === 0 || w.label || showAll)) return;
      const f = i === 0 ? FONTS.anchor(fs * 1.22) : FONTS.label(showAll ? fs * 0.85 : fs);
      items.push({ text: w.w, x: P(w.x), y: P(w.y), gap: i === 0 ? 9 : 6, dot: this.dotBoxes[i], cls: i === 0 ? 'label anchor' : 'label', ...f, word: w });
    });
    this.placed = [];
    this.labelsG = svgEl('g', { class: 'labels' }, svg);
    this.labelEls = placeLabels(items, S, this.placed, this.dotBoxes).map((it) => this.#drawLabel(it, this.labelsG));
    if (this.debug) this.labelEls.forEach((el) => el.textContent === r.target && el.classList.add('is-target'));

    this.revealG = svgEl('g', { class: 'reveal' }, svg);
    this.pinG = svgEl('g', { class: 'pin', 'aria-hidden': 'true' }, svg);
    if (this.pin) this.#drawPin(false);
    if (this.revealed) this.#drawReveal(false);
  }

  #drawLabel(it, parent) {
    const t = svgEl('text', { x: it.box.x + 1, y: it.box.y + it.size * 0.8, class: it.cls, style: `font-size:${it.size}px` }, parent);
    t.textContent = it.text;
    return t;
  }

  // Entrance: contour lines draw outward, dots bloom by distance from the anchor.
  async #surveyIn() {
    const [ax, ay] = this.anchorPx;
    const S = this.S;
    const contours = [...this.topo.querySelectorAll('.contour')];
    contours.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      const lv = +p.dataset.level;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: 1100, delay: 80 + lv * 70, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'backwards',
      }).finished.then(() => (p.style.strokeDasharray = ''));
    });
    this.topo.querySelectorAll('.tint').forEach((p) =>
      p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 500, easing: 'ease-out', fill: 'backwards' }));

    let last = 0;
    this.round.words.forEach((w, i) => {
      const d = Math.hypot(w.x * S - ax, w.y * S - ay) / S;
      const delay = i === 0 ? 120 : 260 + d * 900;
      last = Math.max(last, delay);
      this.dotEls[i].animate(
        [{ opacity: 0, scale: 0 }, { opacity: 1, scale: 1.6, offset: 0.6 }, { opacity: 1, scale: 1 }],
        { duration: 520, delay, easing: SPRING, fill: 'backwards' });
    });
    const labelAnims = this.labelEls.map((el, k) => {
      const d = Math.hypot(+el.getAttribute('x') - ax, +el.getAttribute('y') - ay) / S;
      return el.animate([{ opacity: 0, translate: '0 5px' }, { opacity: 1, translate: '0 0' }],
        { duration: 420, delay: k === 0 ? 200 : 420 + d * 900, easing: OUT, fill: 'backwards' });
    });
    await Promise.all(labelAnims.map((a) => a.finished.catch(() => {})));
  }

  exit() {
    if (reducedMotion()) return Promise.resolve();
    return this.svg
      .animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(3px)', scale: 0.97 }],
        { duration: 260, easing: 'ease-in', fill: 'forwards' })
      .finished.then((a) => a.cancel());
  }

  // Pin ----------------------------------------------------------------------

  setPin(x, y, { animate = true } = {}) {
    const first = !this.pin;
    this.pin = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    this.#drawPin(animate, first);
    this.onPin?.(this.pin);
  }

  #drawPin(animate, first = false) {
    const g = this.pinG;
    const x = this.pin.x * this.S;
    const y = this.pin.y * this.S;
    if (!g.firstChild) {
      svgEl('ellipse', { class: 'pin-shadow', cx: 0, cy: 0, rx: 7, ry: 2.6 }, g);
      const body = svgEl('g', { class: 'pin-body' }, g);
      svgEl('path', { d: PIN_PATH }, body);
      svgEl('circle', { cx: 0, cy: -20.5, r: 4, class: 'pin-eye' }, body);
    }
    g.style.transform = `translate(${x}px, ${y}px)`;
    if (animate && first && !reducedMotion()) {
      g.style.transition = 'none';
      g.querySelector('.pin-body').animate(
        [{ translate: '0 -46px', scale: '0.7 1.2', opacity: 0 }, { translate: '0 0', scale: '1.2 0.8', opacity: 1, offset: 0.62 },
          { scale: '0.94 1.06', offset: 0.82 }, { translate: '0 0', scale: '1 1' }],
        { duration: 560, easing: 'cubic-bezier(.3,.6,.4,1)' });
      g.querySelector('.pin-shadow').animate([{ scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, offset: 0.62 }, { scale: 1 }], { duration: 560 });
      requestAnimationFrame(() => (g.style.transition = ''));
    }
  }

  setInteractive(on) {
    this.interactive = on;
    this.svg.classList.toggle('is-interactive', on);
  }

  #toUnit(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  #bindInput() {
    let dragging = false;
    this.svg.addEventListener('pointerdown', (e) => {
      if (!this.interactive) return;
      e.preventDefault();
      dragging = true;
      this.svg.setPointerCapture(e.pointerId);
      this.svg.classList.add('is-dragging');
      this.setPin(...this.#toUnit(e));
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!dragging || !this.interactive) return;
      this.setPin(...this.#toUnit(e), { animate: false });
    });
    const end = () => {
      dragging = false;
      this.svg.classList.remove('is-dragging');
    };
    this.svg.addEventListener('pointerup', end);
    this.svg.addEventListener('pointercancel', end);
    this.svg.addEventListener('keydown', (e) => {
      if (!this.interactive) return;
      const step = e.shiftKey ? 0.08 : 0.02;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        const p = this.pin ?? { x: 0.5, y: 0.5 };
        const [dx, dy] = this.pin ? moves[e.key] : [0, 0];
        this.setPin(p.x + dx, p.y + dy, { animate: !this.pin });
      } else if ((e.key === 'Enter' || e.key === ' ') && this.pin) {
        e.preventDefault();
        this.onSubmit?.();
      }
    });
  }

  // Reveal -------------------------------------------------------------------

  truth() {
    return this.round.words.find((w) => w.w === this.round.target);
  }

  /** Line from pin to truth, truth blooms, neighbours light up. */
  async reveal(points) {
    this.revealed = true;
    this.points = points;
    this.setInteractive(false);
    await this.#drawReveal(!reducedMotion());
  }

  async #drawReveal(animate) {
    const S = this.S;
    const t = this.truth();
    const tx = t.x * S;
    const ty = t.y * S;
    const g = this.revealG;
    g.replaceChildren();
    const ti = this.round.words.indexOf(t);
    this.dotEls[ti].classList.add('is-hidden');

    const near = this.round.near
      .map((w) => this.round.words.findIndex((x) => x.w === w))
      .filter((i) => i > 0);

    let line;
    if (this.pin) {
      const px = this.pin.x * S;
      const py = this.pin.y * S;
      line = svgEl('line', { x1: px, y1: py, x2: animate ? px : tx, y2: animate ? py : ty, class: 'reveal-line' }, g);
    }
    const rings = [0, 1].map(() => svgEl('circle', { cx: tx, cy: ty, r: 10, class: 'ring' }, g));
    const mark = svgEl('g', { class: 'truth', transform: `translate(${tx} ${ty})` }, g);
    const markInner = svgEl('g', {}, mark);
    svgEl('circle', { r: 8.5, class: 'truth-dot' }, markInner);
    svgEl('circle', { r: 2.6, class: 'truth-eye' }, markInner);

    // labels for target and its nearest words, placed around what's already there
    const fs = Math.max(11, Math.min(15, S / 30));
    const items = [{ text: t.w, x: tx, y: ty, gap: 13, ...FONTS.target(fs * 1.35), cls: 'label target', dot: this.dotBoxes[ti] }];
    const already = new Set(this.labelEls.map((el) => el.textContent));
    for (const i of near) {
      const w = this.round.words[i];
      this.dotEls[i].classList.add('is-near');
      if (!already.has(w.w)) items.push({ text: w.w, x: w.x * S, y: w.y * S, gap: 6, ...FONTS.label(fs), cls: 'label near', dot: this.dotBoxes[i] });
      else this.labelEls.find((el) => el.textContent === w.w).classList.add('near');
    }
    const placed = placeLabels(items, S, [...this.placed], this.dotBoxes);
    const texts = placed.map((it) => this.#drawLabel(it, g));
    g.appendChild(mark); // keep the marker above its own label halo

    if (!animate) return;

    if (line) {
      const [x1, y1] = [+line.getAttribute('x1'), +line.getAttribute('y1')];
      const dist = Math.hypot(tx - x1, ty - y1);
      const dur = 300 + Math.min(500, dist * 1.4);
      await new Promise((resolve) => {
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          line.setAttribute('x2', x1 + (tx - x1) * e);
          line.setAttribute('y2', y1 + (ty - y1) * e);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
    }

    markInner.animate(
      [{ scale: 0, opacity: 0, filter: 'brightness(2)' }, { scale: 1.35, opacity: 1, offset: 0.55 }, { scale: 1, filter: 'brightness(1)' }],
      { duration: 620, easing: SPRING, fill: 'backwards' });
    rings.forEach((ring, k) =>
      ring.animate([{ scale: 0.6, opacity: 0.7 }, { scale: 5.5, opacity: 0 }],
        { duration: 1300, delay: 80 + k * 260, easing: 'cubic-bezier(.1,.6,.3,1)', fill: 'both' }));
    if (this.points >= 900) this.#burst(tx, ty);

    texts.forEach((el, k) =>
      el.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }],
        { duration: 420, delay: 180 + k * 110, easing: OUT, fill: 'backwards' }));
    near.forEach((i, k) =>
      this.dotEls[i].animate([{ scale: 1 }, { scale: 2.2 }, { scale: 1 }], { duration: 500, delay: 200 + k * 110, easing: SPRING }));
    await new Promise((r) => setTimeout(r, 380));
  }

  #burst(x, y) {
    const g = svgEl('g', { class: 'burst' }, this.revealG);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + Math.random() * 0.3;
      const dist = 26 + Math.random() * 22;
      const c = svgEl('circle', { cx: x, cy: y, r: k % 3 ? 2.2 : 3.2, class: k % 2 ? 'spark a' : 'spark b' }, g);
      c.animate([{ translate: '0 0', opacity: 1 }, { translate: `${Math.cos(a) * dist}px ${Math.sin(a) * dist}px`, opacity: 0 }],
        { duration: 700 + Math.random() * 300, delay: 120, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' });
    }
  }
}
