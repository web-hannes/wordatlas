// Progress lives in localStorage. Every access is guarded: private windows and
// blocked storage must never break the game, they just forget.
import { ROUNDS } from './config.js';
import { shiftDay, utcToday } from './util.js';

const KEY = 'wordatlas:v1';
const OLD_KEY = 'wherd:v1'; // the game's earlier name; progress is carried over once

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY));
    if (data && typeof data.days === 'object') return data;
  } catch {}
  return { days: {} };
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export const getDay = (day) => state.days[day]?.guesses ?? [];

export function addGuess(day, guess) {
  const entry = (state.days[day] ??= { guesses: [], on: utcToday() });
  if (entry.guesses.length >= ROUNDS) return;
  entry.guesses.push(guess);
  save();
}

export const isDone = (day) => getDay(day).length >= ROUNDS;

export const total = (day) => getDay(day).reduce((s, g) => s + g.p, 0);

// Played on its own date. Archive plays count for averages, not for streaks.
const onTime = (day) => isDone(day) && (state.days[day].on ?? day) === day;
export const isLate = (day) => isDone(day) && !onTime(day);

export function stats(today = utcToday()) {
  const done = Object.keys(state.days).filter(isDone).sort();
  const totals = done.map(total);
  const timely = done.filter(onTime);

  let streak = 0;
  let cursor = onTime(today) ? today : shiftDay(today, -1);
  while (onTime(cursor)) {
    streak++;
    cursor = shiftDay(cursor, -1);
  }

  let best = 0;
  let run = 0;
  timely.forEach((d, i) => {
    run = i > 0 && shiftDay(timely[i - 1], 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
  });

  return {
    played: done.length,
    streak,
    bestStreak: best,
    average: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0,
    best: totals.length ? Math.max(...totals) : 0,
    totals,
  };
}
