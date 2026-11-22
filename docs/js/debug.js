// /debug.html?day=YYYY-MM-DD: every map of a day with all labels, target highlighted.
import { MapView } from './map.js';
import { fetchJSON, puzzleNumber, shiftDay, utcToday } from './util.js';

const params = new URLSearchParams(location.search);
const day = params.get('day') || utcToday();
const grid = document.querySelector('.dbg-grid');
const input = document.querySelector('input[type=date]');
input.value = day;
input.addEventListener('change', () => input.value && (location.search = `?day=${input.value}`));
document.querySelectorAll('[data-step]').forEach((a) => (a.href = `?day=${shiftDay(day, +a.dataset.step)}`));

await document.fonts.ready;
try {
  const data = await fetchJSON(`data/days/${day}.json`);
  document.title = `Wordatlas debug #${puzzleNumber(day)}`;
  data.rounds.forEach((r, i) => {
    const card = document.createElement('section');
    card.className = 'dbg-card';
    card.innerHTML = `<h2></h2><p></p><div class="sheet"><svg class="map"></svg></div>`;
    card.querySelector('h2').textContent = `${i + 1}. ${r.target} on the ${r.anchor} map`;
    const m = r.meta || {};
    card.querySelector('p').textContent =
      `${m.method?.toUpperCase()}, target overlap ${m.overlap}/5, layout keeps ${Math.round((m.preservation ?? 0) * 100)}% of neighbours. Nearest: ${r.near.join(', ')}`;
    grid.appendChild(card);
    new MapView(card.querySelector('svg')).load(r, { animate: false, debug: true });
  });
} catch (e) {
  grid.innerHTML = `<p class="dbg-err">No day file for ${day}. (${e.message})</p>`;
}
