import { LAUNCH, ROUNDS, tierFor } from './config.js';
import { contourLines, smoothPath } from './contours.js';
import { MapView } from './map.js';
import * as store from './store.js';
import {
  $, bind, countUp, fetchJSON, fmt, formatClock, msToUtcMidnight, puzzleNumber, reducedMotion, score, shiftDay,
  svgEl, utcToday, wait,
} from './util.js';

const today = utcToday();
const num = puzzleNumber(today);

const app = {
  mode: 'daily', // or 'practice'
  daily: null, // today's file
  day: today, // the puzzle being played; earlier days come from the archive
  data: null, // that day's file
  files: {}, // day files fetched so far
  last: null, // last day with a published file (from index.json)
  month: today.slice(0, 7), // month shown in the archive
  rounds: [],
  idx: 0,
  current: null,
  practice: { queue: [], played: 0, total: 0 },
  timer: 0,
};

const map = new MapView($('#game .map'), { onPin, onSubmit: confirm });
const confirmBtn = $('[data-action="confirm"]');
const nextBtn = $('[data-action="next"]');

// Screens -------------------------------------------------------------------

let screen = null;
async function show(id) {
  const next = document.getElementById(id);
  if (screen === next) return;
  if (screen) {
    if (!reducedMotion()) {
      await screen.animate([{ opacity: 1 }, { opacity: 0, translate: '0 -8px', scale: 0.985 }],
        { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished;
    }
    screen.hidden = true;
    screen.getAnimations().forEach((a) => a.cancel());
  }
  next.hidden = false;
  screen = next;
  document.body.dataset.screen = id;
  if (!reducedMotion()) {
    next.animate([{ opacity: 0, translate: '0 14px', scale: 0.985 }, { opacity: 1, translate: '0 0', scale: 1 }],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  clearInterval(app.timer);
}

// Intro ---------------------------------------------------------------------

function introArt() {
  // A made-up terrain: deterministic blobs, drawn once on load.
  const svg = $('.intro-topo');
  const S = 600;
  svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = [];
  for (const [cx, cy, n, s] of [[0.32, 0.38, 24, 0.12], [0.7, 0.62, 20, 0.1], [0.62, 0.24, 10, 0.07], [0.28, 0.76, 9, 0.08]]) {
    for (let k = 0; k < n; k++) pts.push({ x: cx + (rnd() - 0.5) * s * 2, y: cy + (rnd() - 0.5) * s * 2 });
  }
  const lines = contourLines(pts, { n: 64, h: 0.075, levels: 9, floor: 0 });
  const g = svgEl('g', {}, svg);
  for (const c of lines) {
    const p = svgEl('path', { d: smoothPath(c.points.map(([x, y]) => [x * S, y * S])), class: c.level % 4 === 0 ? 'index' : '' }, g);
    if (!reducedMotion()) {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len} ${len}`;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
        { duration: 1800, delay: 150 + c.level * 110, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'backwards' });
    }
  }
  const pin = svgEl('g', { class: 'intro-pin', transform: `translate(${0.33 * S} ${0.39 * S}) scale(2.2)` }, svg);
  const body = svgEl('g', {}, pin);
  svgEl('path', { d: 'M0 0C-2.6-7-10.5-12.4-10.5-20.5a10.5 10.5 0 1 1 21 0C10.5-12.4 2.6-7 0 0Z' }, body);
  svgEl('circle', { cx: 0, cy: -20.5, r: 4, class: 'pin-eye' }, body);
  if (!reducedMotion()) {
    body.animate([{ translate: '0 -60px', opacity: 0 }, { translate: '0 0', opacity: 1, scale: '1.15 .85', offset: 0.6 }, { scale: '.95 1.05', offset: 0.8 }, { translate: '0 0', scale: '1 1' }],
      { duration: 700, delay: 1300, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' });
  }
}

function showIntro() {
  if (!app.daily) return showEmpty();
  const guesses = store.getDay(today);
  const date = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  bind('kicker').textContent = `Puzzle #${num}, ${date}`;
  const play = $('#intro [data-action="play"]');
  const note = bind('intro-note');
  if (guesses.length >= ROUNDS) {
    play.textContent = "See today's result";
    note.textContent = 'You finished today’s map. A new one arrives at midnight UTC.';
  } else if (guesses.length) {
    play.textContent = `Continue with round ${guesses.length + 1}`;
    note.textContent = '';
  } else {
    play.textContent = 'Play today’s map';
    const { streak } = store.stats(today);
    note.textContent = streak ? `You’re on a ${streak}-day streak.` : '';
  }
  setProgress(null);
  show('intro');
}

function showEmpty(title, text) {
  if (title) bind('empty-title').textContent = title;
  if (text) bind('empty-text').textContent = text;
  setProgress(null);
  show('empty');
}

// Rounds --------------------------------------------------------------------

function setProgress(results) {
  const ol = $('.progress');
  if (!results) {
    ol.hidden = true;
    return;
  }
  ol.hidden = false;
  if (ol.children.length !== ROUNDS) {
    ol.replaceChildren(...Array.from({ length: ROUNDS }, () => document.createElement('li')));
  }
  [...ol.children].forEach((li, i) => {
    const r = results[i];
    li.className = r !== undefined ? `done tier-${tierFor(r).name}` : i === results.length ? 'current' : '';
    li.setAttribute('aria-label', r !== undefined ? `Round ${i + 1}: ${r} points` : `Round ${i + 1}`);
  });
}

async function loadDay(day) {
  return (app.files[day] ??= fetchJSON(`data/days/${day}.json`).catch((e) => {
    delete app.files[day];
    throw e;
  }));
}

async function startDay(day = today) {
  try {
    app.data = await loadDay(day);
  } catch {
    return showEmpty('That map didn’t load', 'Check your connection, then try again.');
  }
  app.mode = 'daily';
  app.day = day;
  app.rounds = app.data.rounds;
  const guesses = store.getDay(day);
  if (guesses.length >= ROUNDS) return showEnd();
  app.idx = guesses.length;
  await show('game');
  playRound(app.rounds[app.idx]);
}

const shortDate = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

async function startPractice() {
  app.mode = 'practice';
  if (!app.practice.queue.length) {
    try {
      const index = await fetchJSON('data/index.json');
      app.practice.queue = index.anchors.slice().sort(() => Math.random() - 0.5);
    } catch {
      return showEmpty('Practice maps didn’t load', 'Check your connection, then reload the page.');
    }
  }
  setProgress(null);
  await show('game');
  nextPractice();
}

async function nextPractice() {
  const anchor = app.practice.queue.shift();
  app.practice.queue.push(anchor);
  try {
    playRound(await fetchJSON(`data/rounds/${anchor}.json`));
  } catch {
    showEmpty('That map didn’t load', 'Check your connection, then try again.');
  }
}

function playRound(round) {
  app.current = round;
  const daily = app.mode === 'daily';
  const past = daily && app.day !== today;
  bind('round-label').textContent = !daily
    ? `Practice map ${app.practice.played + 1}`
    : past ? `#${puzzleNumber(app.day)}, ${shortDate(app.day)}, round ${app.idx + 1} of ${ROUNDS}` : `Round ${app.idx + 1} of ${ROUNDS}`;
  bind('anchor').textContent = round.anchor;
  bind('target').textContent = round.target;
  if (daily) setProgress(store.getDay(app.day).map((g) => g.p));

  $('.dock-place').hidden = false;
  $('.dock-result').hidden = true;
  confirmBtn.disabled = true;
  bind('hint').classList.remove('is-gone');

  if (!reducedMotion()) {
    $('.prompt-word').animate(
      [{ opacity: 0, translate: '0 28px', scale: 0.92, filter: 'blur(4px)' }, { opacity: 1, translate: '0 0', scale: 1, filter: 'blur(0)' }],
      { duration: 650, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' });
    $('.prompt-lead').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'backwards' });
  }
  map.load(round);
  map.setInteractive(true);
  map.svg.focus({ preventScroll: true });
}

function onPin() {
  confirmBtn.disabled = false;
  bind('hint').classList.add('is-gone');
}

async function confirm() {
  if (!map.pin || !map.interactive) return;
  const t = map.truth();
  const p = score(map.pin.x - t.x, map.pin.y - t.y);
  const tier = tierFor(p);
  map.setInteractive(false);
  confirmBtn.disabled = true;

  if (app.mode === 'daily') {
    store.addGuess(app.day, { x: +map.pin.x.toFixed(4), y: +map.pin.y.toFixed(4), p });
    setProgress(store.getDay(app.day).map((g) => g.p));
  } else {
    app.practice.played++;
    app.practice.total += p;
  }

  const revealing = map.reveal(p);
  await wait(450);
  $('.dock-place').hidden = true;
  const res = $('.dock-result');
  res.hidden = false;
  res.dataset.tier = tier.name;
  const last = app.mode === 'daily' && app.idx === ROUNDS - 1;
  nextBtn.textContent = app.mode === 'practice' ? 'Next map' : last ? 'See results' : 'Next round';
  const pts = bind('points');
  const verdict = bind('verdict');
  verdict.textContent = tier.verdict;
  if (!reducedMotion()) {
    res.animate([{ opacity: 0, translate: '0 18px' }, { opacity: 1, translate: '0 0' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    verdict.animate([{ opacity: 0, translate: '-6px 0' }, { opacity: 1, translate: '0 0' }], { duration: 300, delay: 700, fill: 'backwards' });
  }
  await countUp(pts, p, { duration: 300 + p * 0.5 });
  if (!reducedMotion()) {
    pts.animate([{ scale: 1 }, { scale: 1.28, rotate: '-3deg', offset: 0.35 }, { scale: 1, rotate: '0deg' }],
      { duration: 480, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
  await revealing;
  nextBtn.focus({ preventScroll: true });
}

async function next() {
  if (app.mode === 'practice') {
    await map.exit();
    return nextPractice();
  }
  if (app.idx >= ROUNDS - 1) return showEnd();
  await map.exit();
  app.idx++;
  playRound(app.rounds[app.idx]);
}

// Archive -------------------------------------------------------------------

/** Every day with a puzzle, from launch up to today. */
function archiveDays() {
  const end = app.last && app.last < today ? app.last : today;
  const days = [];
  for (let d = LAUNCH; d <= end; d = shiftDay(d, 1)) days.push(d);
  return days;
}

async function showArchive() {
  const days = archiveDays();
  const done = days.filter(store.isDone).length;
  bind('arc-sub').textContent = days.length <= 1
    ? 'Past maps collect here. Come back tomorrow to replay today’s if you miss it.'
    : `You’ve finished ${done} of ${days.length} maps. Past maps count toward your average but not your streak.`;
  const missed = days.some((d) => d !== today && !store.isDone(d));
  bind('random-day').hidden = !missed;
  app.month = today.slice(0, 7);
  setProgress(null);
  renderCalendar(0, false);
  await show('archive');
  animateCalendar(0);
}

function monthShift(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function renderCalendar(step = 0, animate = true) {
  const first = LAUNCH.slice(0, 7);
  const lastMonth = today.slice(0, 7);
  const next = monthShift(app.month, step);
  if (next < first || next > lastMonth) return;
  app.month = next;
  $('[data-action="month-prev"]').disabled = next <= first;
  $('[data-action="month-next"]').disabled = next >= lastMonth;

  const [y, m] = next.split('-').map(Number);
  bind('cal-month').textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const available = new Set(archiveDays());
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(Object.assign(document.createElement('span'), { className: 'cal-day is-blank' }));
  for (let dnum = 1; dnum <= count; dnum++) {
    const day = `${next}-${String(dnum).padStart(2, '0')}`;
    if (!available.has(day)) {
      const span = document.createElement('span');
      span.className = 'cal-day is-off';
      span.innerHTML = `<span class="cal-num">${dnum}</span>`;
      cells.push(span);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.day = day;
    b.className = 'cal-day';
    const g = store.getDay(day);
    const total = store.total(day);
    let sub = `#${puzzleNumber(day)}`;
    let label = `Puzzle ${puzzleNumber(day)}, ${shortDate(day)}`;
    if (store.isDone(day)) {
      b.classList.add('is-done');
      b.dataset.tier = tierFor(total / ROUNDS).name;
      sub = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
      label += `, ${fmt(total)} points`;
    } else if (g.length) {
      b.classList.add('is-partial');
      b.style.setProperty('--frac', g.length / ROUNDS);
      sub = `${g.length}/${ROUNDS}`;
      label += `, ${g.length} of ${ROUNDS} rounds played`;
    } else {
      label += ', not played';
    }
    if (day === today) {
      b.classList.add('is-today');
      label += ', today';
    }
    b.setAttribute('aria-label', label);
    b.innerHTML = `<span class="cal-num">${dnum}</span><span class="cal-sub">${sub}</span>`;
    cells.push(b);
  }
  bind('cal-grid').replaceChildren(...cells);
  if (animate) animateCalendar(step);
}

function animateCalendar(step) {
  if (reducedMotion()) return;
  const grid = bind('cal-grid');
  if (step) {
    grid.animate([{ opacity: 0, translate: `${step * 28}px 0` }, { opacity: 1, translate: '0 0' }],
      { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  [...grid.querySelectorAll('button.cal-day')].forEach((el, i) => {
    el.animate([{ opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1.06, offset: 0.6 }, { opacity: 1, scale: 1 }],
      { duration: 420, delay: (step ? 60 : 140) + i * 18, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'backwards' });
  });
}

// End -----------------------------------------------------------------------

function shareText() {
  const g = store.getDay(app.day);
  const total = g.reduce((s, x) => s + x.p, 0);
  return `Wordatlas #${puzzleNumber(app.day)} ${fmt(total)}/5000 ${g.map((x) => tierFor(x.p).emoji).join('')}`;
}

function renderStats(dl, s) {
  const items = [
    ['Played', s.played],
    ['Streak', s.streak],
    ['Average', fmt(s.average)],
    ['Best', fmt(s.best)],
  ];
  dl.replaceChildren(...items.map(([k, v]) => {
    const div = document.createElement('div');
    div.innerHTML = `<dt></dt><dd></dd>`;
    div.firstChild.textContent = k;
    div.lastChild.textContent = v;
    return div;
  }));
}

async function showEnd() {
  const g = store.getDay(app.day);
  const total = g.reduce((s, x) => s + x.p, 0);
  const isToday = app.day === today;
  setProgress(g.map((x) => x.p));
  bind('end-kicker').textContent = isToday
    ? `Puzzle #${num} complete`
    : `Puzzle #${puzzleNumber(app.day)} from ${shortDate(app.day)} complete`;
  bind('end-late').hidden = !store.isLate(app.day);
  $('.countdown').hidden = !isToday;
  const avg = total / ROUNDS;
  bind('end-verdict').textContent =
    avg >= 800 ? 'A natural cartographer.' : avg >= 500 ? 'You know your way around.' : avg >= 200 ? 'Some good finds out there.' : 'Mostly uncharted territory.';

  const ol = bind('rounds');
  ol.replaceChildren(...app.data.rounds.map((r, i) => {
    const p = g[i]?.p ?? 0;
    const tier = tierFor(p);
    const li = document.createElement('li');
    li.dataset.tier = tier.name;
    li.innerHTML = '<span class="er-tile"></span><span class="er-words"><b></b><small></small></span><span class="er-pts"></span>';
    li.querySelector('b').textContent = r.target;
    li.querySelector('small').textContent = `on the ${r.anchor} map`;
    li.querySelector('.er-pts').textContent = fmt(p);
    return li;
  }));
  renderStats(bind('stats'), store.stats(today));
  await show('end');

  const totalEl = bind('total');
  totalEl.textContent = '0';
  if (!reducedMotion()) {
    [...ol.children].forEach((li, i) => {
      li.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 380, delay: 250 + i * 110, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      li.querySelector('.er-tile').animate(
        [{ rotate: 'x 90deg', opacity: 0 }, { rotate: 'x -12deg', opacity: 1, offset: 0.7 }, { rotate: 'x 0deg' }],
        { duration: 520, delay: 300 + i * 110, easing: 'ease-out', fill: 'backwards' });
    });
  }
  countUp(totalEl, total, { duration: 1400 }).then(() => {
    if (!reducedMotion()) totalEl.animate([{ scale: 1 }, { scale: 1.12, offset: 0.35 }, { scale: 1 }], { duration: 460, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  });

  if (!isToday) return;
  const cd = bind('countdown');
  const tick = () => {
    const ms = msToUtcMidnight();
    cd.textContent = formatClock(ms);
    if (ms < 1000) setTimeout(() => location.reload(), 1500);
  };
  tick();
  app.timer = setInterval(tick, 1000);
}

async function share() {
  const text = shareText();
  const url = location.origin + location.pathname;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text: `${text}\n${url}` });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Result copied');
  } catch (e) {
    if (e?.name !== 'AbortError') toast(text, 6000);
  }
}

// Dialogs + toast -------------------------------------------------------------

function openDialog(id) {
  const d = document.getElementById(id);
  if (id === 'stats-dialog') {
    const s = store.stats(today);
    renderStats(bind('stats-dialog'), s);
    const buckets = [0, 0, 0, 0, 0];
    s.totals.forEach((t) => buckets[Math.min(4, Math.floor(t / 1000))]++);
    const max = Math.max(1, ...buckets);
    const h = bind('histo');
    h.replaceChildren(...buckets.map((n, i) => {
      const row = document.createElement('div');
      row.className = 'histo-row';
      row.innerHTML = `<span>${i}k–${i + 1}k</span><i class="${n ? '' : 'is-zero'}" style="--w:${n / max}"><b>${n}</b></i>`;
      return row;
    }));
    if (!s.played) h.insertAdjacentHTML('afterbegin', '<p class="histo-empty">Finish a daily map to start your record.</p>');
  }
  d.showModal();
}

function closeDialog(d) {
  if (reducedMotion()) return d.close();
  d.classList.add('is-closing');
  d.addEventListener('animationend', () => {
    d.classList.remove('is-closing');
    d.close();
  }, { once: true });
}

for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('submit', (e) => {
    e.preventDefault();
    closeDialog(d);
  });
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeDialog(d);
  });
  d.addEventListener('click', (e) => e.target === d && closeDialog(d));
}

let toastTimer;
function toast(msg, ms = 2200) {
  const el = $('.toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), ms);
}

// Wiring --------------------------------------------------------------------

const actions = {
  home: showIntro,
  play: () => startDay(today),
  archive: showArchive,
  'month-prev': () => renderCalendar(-1),
  'month-next': () => renderCalendar(1),
  'random-day': () => {
    const missed = archiveDays().filter((d) => !store.isDone(d) && d !== today);
    if (missed.length) startDay(missed[Math.floor(Math.random() * missed.length)]);
  },
  practice: startPractice,
  confirm,
  next,
  share,
  help: () => openDialog('help-dialog'),
  stats: () => openDialog('stats-dialog'),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action], [data-day]');
  if (b?.dataset.day) return startDay(b.dataset.day);
  if (b && actions[b.dataset.action] && !b.disabled) actions[b.dataset.action]();
});

async function boot() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  try {
    app.daily = await loadDay(today);
  } catch {
    app.daily = null;
  }
  fetchJSON('data/index.json').then((ix) => (app.last = ix.last)).catch(() => {});
  introArt();
  if (!app.daily) {
    return showEmpty(num < 1 ? 'Wordatlas starts soon' : 'No map for today yet',
      'Today’s puzzle isn’t published. Practice maps still work.');
  }
  showIntro();
}

boot();
