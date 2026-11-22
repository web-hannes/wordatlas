// Keep LAUNCH in sync with pipeline/build.py.
export const LAUNCH = '2026-11-01';
export const ROUNDS = 5;
export const MAX_POINTS = 1000;
export const SIGMA = 0.12; // points = 1000 * exp(-d / SIGMA); tune after playtesting

// Share squares and on-screen tiers, best first.
export const TIERS = [
  { min: 800, emoji: '🟩', name: 'spot', verdict: 'Spot on' },
  { min: 500, emoji: '🟨', name: 'close', verdict: 'Close' },
  { min: 200, emoji: '🟧', name: 'region', verdict: 'Right region' },
  { min: 0, emoji: '🟥', name: 'far', verdict: 'Off the map' },
];

export const tierFor = (points) => TIERS.find((t) => points >= t.min);
