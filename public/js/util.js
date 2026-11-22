import { LAUNCH, MAX_POINTS, SIGMA } from './config.js';

const DAY_MS = 86_400_000;

export const utcToday = () => new Date().toISOString().slice(0, 10);

export const dayIndex = (iso) => Math.round((Date.parse(iso) - Date.parse(LAUNCH)) / DAY_MS);

export const puzzleNumber = (iso) => dayIndex(iso) + 1;

export const shiftDay = (iso, n) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);

export function msToUtcMidnight() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [s / 3600, (s % 3600) / 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function score(dx, dy) {
  const d = Math.hypot(dx, dy);
  return Math.round(MAX_POINTS * Math.exp(-d / SIGMA));
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

/** Animate a number in `el` from `from` to `to`. Resolves when done. */
export function countUp(el, to, { from = 0, duration = 900 } = {}) {
  if (reducedMotion()) {
    el.textContent = fmt(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const bind = (name, root = document) => root.querySelector(`[data-bind="${name}"]`);

export function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}
