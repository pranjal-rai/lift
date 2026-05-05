/* Lift — workout tracker. Vanilla JS, IndexedDB, Chart.js. v2 */

// ============== utility ==============
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v === false || v == null) {} else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
};
const fmtDate = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtDateShort = (ts) => {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const that = new Date(ts); that.setHours(0,0,0,0);
  const days = Math.round((today - that) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtNum = (n) => Number(n || 0).toLocaleString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const toast = (msg) => {
  const t = el('div', { class: 'toast' }, msg);
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), 1800);
};
const isoDay = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const pct01 = (v, max) => Math.max(0, Math.min(1, (v || 0) / (max || 1)));
const fmtMl = (ml) => ml >= 1000 ? (ml/1000).toFixed(2) + ' L' : ml + ' ml';

// ============== storage ==============
const DB_NAME = 'lift-db';
const DB_VERSION = 2;
let dbPromise;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1 stores
      if (!db.objectStoreNames.contains('workouts')) {
        const s = db.createObjectStore('workouts', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('bodyweight')) {
        const s = db.createObjectStore('bodyweight', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // v2 additions — daily trackers + body fat
      if (!db.objectStoreNames.contains('steps')) {
        // id = isoDay (one entry per day)
        db.createObjectStore('steps', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('macros')) {
        // id = isoDay
        db.createObjectStore('macros', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('water')) {
        // id = isoDay
        db.createObjectStore('water', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('bodyfat')) {
        const s = db.createObjectStore('bodyfat', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function tx(store, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(store, mode).objectStore(store);
}
const Store = {
  async list(store) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const out = [];
      const req = s.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); }
        else res(out);
      };
      req.onerror = () => rej(req.error);
    });
  },
  async get(store, key) {
    const s = await tx(store);
    return new Promise((res, rej) => {
      const r = s.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(store, value) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.put(value);
      r.onsuccess = () => res(value);
      r.onerror = () => rej(r.error);
    });
  },
  async del(store, key) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  },
  async clear(store) {
    const s = await tx(store, 'readwrite');
    return new Promise((res, rej) => {
      const r = s.clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
};

// Settings (stored in `meta` store, with defaults if unset)
const DEFAULTS = {
  stepsTarget: 10000,
  macroTargets: { calories: 2200, protein: 180, carbs: 220, fat: 70 },
  waterSettings: { glassSize: 250, target: 8 },
  weightGoal: null,
  bodyfatGoal: null
};
async function getSetting(key) {
  const r = await Store.get('meta', key);
  if (r) return r.value;
  return DEFAULTS[key] !== undefined ? DEFAULTS[key] : null;
}
async function setSetting(key, value) {
  return Store.put('meta', { key, value });
}

// ============== seeds ==============
const SEED_TEMPLATES = [
  {
    id: uid(), name: 'Push Day', emoji: '💪', createdAt: Date.now(),
    exercises: [
      { id: uid(), name: 'Bench Press', sets: 4, reps: '6-8' },
      { id: uid(), name: 'Overhead Press', sets: 3, reps: '8' },
      { id: uid(), name: 'Incline Dumbbell Press', sets: 3, reps: '10' },
      { id: uid(), name: 'Lateral Raise', sets: 3, reps: '12' },
      { id: uid(), name: 'Tricep Pushdown', sets: 3, reps: '12' }
    ]
  },
  {
    id: uid(), name: 'Pull Day', emoji: '🏋️', createdAt: Date.now(),
    exercises: [
      { id: uid(), name: 'Deadlift', sets: 3, reps: '5' },
      { id: uid(), name: 'Pull-Up', sets: 4, reps: '6-8' },
      { id: uid(), name: 'Barbell Row', sets: 3, reps: '8' },
      { id: uid(), name: 'Face Pull', sets: 3, reps: '12' },
      { id: uid(), name: 'Barbell Curl', sets: 3, reps: '10' }
    ]
  },
  {
    id: uid(), name: 'Leg Day', emoji: '🦵', createdAt: Date.now(),
    exercises: [
      { id: uid(), name: 'Back Squat', sets: 4, reps: '6-8' },
      { id: uid(), name: 'Romanian Deadlift', sets: 3, reps: '8' },
      { id: uid(), name: 'Leg Press', sets: 3, reps: '10' },
      { id: uid(), name: 'Leg Curl', sets: 3, reps: '12' },
      { id: uid(), name: 'Standing Calf Raise', sets: 4, reps: '12-15' }
    ]
  }
];

async function maybeSeed() {
  const seeded = await Store.get('meta', 'seeded');
  if (seeded) return;
  for (const t of SEED_TEMPLATES) await Store.put('templates', t);
  await Store.put('meta', { key: 'seeded', value: true });
}

// ============== state ==============
const state = {
  route: 'daily',
  active: null,
  charts: [],
};

// ============== router ==============
const routes = {
  daily: renderDaily,
  history: renderHistory,
  templates: renderTemplates,
  progress: renderProgress,
  body: renderBody,
};

async function navigate(route) {
  state.route = route;
  $$('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  state.charts.forEach(c => { try { c.destroy(); } catch(_){} });
  state.charts = [];
  await routes[route]();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const navbtn = e.target.closest('.navbtn');
  if (navbtn) navigate(navbtn.dataset.route);
});

// ============== modal / toast ==============
function openModal(contentBuilder, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const backdrop = el('div', { class: 'modal-backdrop', onclick: close });
  const sheet = el('div', { class: 'modal-sheet' });
  sheet.appendChild(el('div', { class: 'modal-handle' }));
  if (opts.title) sheet.appendChild(el('h2', {}, opts.title));
  const result = contentBuilder({ sheet, close });
  if (result && typeof result.then === 'function') result.catch(() => {});
  root.appendChild(backdrop);
  root.appendChild(sheet);
  return close;
}

function confirmDialog(message, onYes, yesLabel = 'Delete', danger = true) {
  openModal(({ sheet, close }) => {
    sheet.appendChild(el('p', { style: { color: 'var(--text-dim)', marginTop: '0' } }, message));
    sheet.appendChild(el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { close(); onYes(); } }, yesLabel)
    ));
  }, { title: 'Confirm' });
}

// ============== topbar / shared ==============
function setTopbar({ title, sub, actions = [] }) {
  const tb = $('#topbar');
  tb.innerHTML = '';
  const left = el('div');
  left.appendChild(el('h1', {}, title));
  if (sub) left.appendChild(el('div', { class: 'sub' }, sub));
  tb.appendChild(left);
  if (actions.length) {
    const r = el('div', { class: 'topbar-actions' });
    actions.forEach(a => r.appendChild(a));
    tb.appendChild(r);
  }
}

function emptyState(emoji, title, body) {
  return el('div', { class: 'empty' },
    el('div', { class: 'emoji' }, emoji),
    el('h3', {}, title),
    el('p', {}, body)
  );
}

function statTile(value, label) {
  return el('div', { class: 'stat' },
    el('div', { class: 'v' }, String(value)),
    el('div', { class: 'l' }, label)
  );
}

function labeled(text, input) {
  return el('label', { class: 'field' },
    el('span', {}, text),
    input
  );
}

function computeStreak(workouts) {
  if (workouts.length === 0) return 0;
  const days = new Set(workouts.map(w => isoDay(w.date)));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(isoDay(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(isoDay(cursor.getTime()))) return 0;
  }
  while (days.has(isoDay(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ============== DAILY view ==============
async function renderDaily() {
  const view = $('#view');
  view.innerHTML = '';
  const am = await Store.get('meta', 'activeWorkout');
  state.active = am ? am.value : null;

  if (state.active) return renderActiveWorkout(view);

  setTopbar({
    title: 'Daily',
    sub: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    actions: [
      el('button', { class: 'btn btn-icon btn-ghost', onclick: openSettingsSheet, title: 'Settings' }, '⚙')
    ]
  });

  const workouts = (await Store.list('workouts')).sort((a, b) => b.date - a.date);
  const last7 = workouts.filter(w => Date.now() - w.date < 7 * 86400000).length;
  const streak = computeStreak(workouts);

  view.appendChild(el('div', { class: 'stats' },
    statTile(last7, 'This week'),
    statTile(streak, 'Day streak'),
    statTile(workouts.length, 'Total')
  ));

  // Today's logs
  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, "Today's logs")));
  view.appendChild(await stepsTile());
  view.appendChild(await macrosTile());
  view.appendChild(await waterTile());

  // Workout section
  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Start a workout')));
  const templates = (await Store.list('templates')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (templates.length === 0) {
    view.appendChild(emptyState('🗒️', 'No templates yet', 'Create one in the Templates tab.'));
  } else {
    templates.forEach(t => view.appendChild(
      el('div', { class: 'row', onclick: () => startWorkoutFromTemplate(t) },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `${t.emoji || '🏋️'}  ${t.name}`),
          el('div', { class: 'row-sub' }, `${t.exercises.length} exercise${t.exercises.length === 1 ? '' : 's'}`)
        ),
        el('div', { class: 'row-arrow' }, '›')
      )
    ));
  }
  view.appendChild(el('button', {
    class: 'btn btn-block btn-ghost',
    style: { marginTop: '12px' },
    onclick: () => startBlankWorkout()
  }, '＋  Empty workout'));

  // Recent
  if (workouts.length > 0) {
    view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Recent')));
    workouts.slice(0, 3).forEach(w => view.appendChild(workoutRow(w)));
  }
}

// ============== Daily tracker tiles ==============
async function stepsTile() {
  const day = isoDay();
  const target = await getSetting('stepsTarget');
  const rec = await Store.get('steps', day);
  const count = rec ? rec.count : 0;
  const p = pct01(count, target);
  return el('div', { class: 'tile', onclick: () => editStepsForDay(day) },
    el('div', { class: 'tile-head' },
      el('div', { class: 'tile-title' }, '👟  Steps'),
      el('div', { class: 'tile-meta' }, count > 0 ? `${fmtNum(count)} / ${fmtNum(target)}` : 'Tap to log')
    ),
    el('div', { class: 'tile-bar' },
      el('div', { class: 'tile-bar-fill' + (count >= target ? ' done' : ''), style: { width: (p * 100).toFixed(0) + '%' } })
    )
  );
}

async function macrosTile() {
  const day = isoDay();
  const targets = await getSetting('macroTargets');
  const rec = await Store.get('macros', day);
  const cur = rec || { calories: 0, protein: 0, carbs: 0, fat: 0 };
  return el('div', { class: 'tile', onclick: () => editMacrosForDay(day) },
    el('div', { class: 'tile-head' },
      el('div', { class: 'tile-title' }, '🍽️  Macros'),
      el('div', { class: 'tile-meta' }, rec ? `${fmtNum(cur.calories)} kcal` : 'Tap to log')
    ),
    el('div', { class: 'macro-grid' },
      macroCell('Cal', cur.calories, targets.calories, ''),
      macroCell('Protein', cur.protein, targets.protein, 'g'),
      macroCell('Carbs', cur.carbs, targets.carbs, 'g'),
      macroCell('Fat', cur.fat, targets.fat, 'g')
    )
  );
}
function macroCell(label, value, target, unit) {
  const p = pct01(value, target);
  return el('div', { class: 'macro' },
    el('div', { class: 'macro-row' },
      el('div', { class: 'macro-l' }, label),
      el('div', { class: 'macro-v' }, `${fmtNum(value)} / ${fmtNum(target)}${unit}`)
    ),
    el('div', { class: 'macro-bar' },
      el('div', { class: 'macro-bar-fill', style: { width: (p * 100).toFixed(0) + '%' } })
    )
  );
}

async function waterTile() {
  const day = isoDay();
  const settings = await getSetting('waterSettings');
  const rec = await Store.get('water', day);
  const glasses = rec ? rec.glasses : 0;
  const ml = glasses * settings.glassSize;
  const dots = el('div', { class: 'water-dots' });
  for (let i = 0; i < settings.target; i++) {
    dots.appendChild(el('span', { class: 'dot ' + (i < glasses ? 'on' : 'off') }));
  }
  for (let i = settings.target; i < glasses; i++) {
    dots.appendChild(el('span', { class: 'dot extra' }));
  }
  return el('div', { class: 'tile water-tile' },
    el('div', { class: 'tile-head' },
      el('div', { class: 'tile-title' }, '💧  Water'),
      el('div', { class: 'tile-meta' }, `${glasses} / ${settings.target} · ${fmtMl(ml)}`)
    ),
    el('div', { class: 'water-row' },
      dots,
      el('div', { class: 'water-actions' },
        el('button', { class: 'btn btn-sm btn-ghost', onclick: (e) => { e.stopPropagation(); editWaterForDay(day); } }, 'Edit'),
        el('button', {
          class: 'btn btn-sm btn-primary water-add', onclick: async (e) => {
            e.stopPropagation();
            await logWaterGlass(day);
            navigate('daily');
          }
        }, '＋1')
      )
    )
  );
}

async function logWaterGlass(day) {
  const existing = await Store.get('water', day);
  const next = existing
    ? { ...existing, glasses: (existing.glasses || 0) + 1 }
    : { id: day, date: new Date(day + 'T12:00:00').getTime(), glasses: 1 };
  await Store.put('water', next);
}

// ============== Tracker editors ==============
function editStepsForDay(day) {
  openModal(async ({ sheet, close }) => {
    const rec = await Store.get('steps', day);
    const target = await getSetting('stepsTarget');
    const dateInput = el('input', { type: 'date', value: day });
    const countInput = el('input', { type: 'number', inputmode: 'numeric', placeholder: 'e.g. 8500', value: rec?.count ?? '' });
    const targetInput = el('input', { type: 'number', inputmode: 'numeric', placeholder: '10000', value: target });
    sheet.appendChild(labeled('Date', dateInput));
    sheet.appendChild(labeled('Steps for that day', countInput));
    sheet.appendChild(labeled('Daily step target', targetInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      rec ? el('button', { class: 'btn btn-danger', onclick: async () => {
        await Store.del('steps', rec.id); close(); toast('Deleted'); navigate(state.route);
      } }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const t = parseInt(targetInput.value);
        if (t > 0) await setSetting('stepsTarget', t);
        if (countInput.value !== '') {
          const c = parseInt(countInput.value);
          if (c >= 0) {
            const id = dateInput.value;
            await Store.put('steps', { id, date: new Date(id + 'T12:00:00').getTime(), count: c });
          }
        }
        close(); toast('Saved'); navigate(state.route);
      } }, 'Save')
    ));
    setTimeout(() => countInput.focus(), 60);
  }, { title: 'Steps' });
}

function editMacrosForDay(day) {
  openModal(async ({ sheet, close }) => {
    const rec = await Store.get('macros', day);
    const targets = await getSetting('macroTargets');
    const dateInput = el('input', { type: 'date', value: day });
    const f = (val, ph) => el('input', { type: 'number', inputmode: 'decimal', placeholder: String(ph ?? ''), value: val ?? '' });
    const cInput = f(rec?.calories, targets.calories);
    const pInput = f(rec?.protein, targets.protein);
    const carbInput = f(rec?.carbs, targets.carbs);
    const fatInput = f(rec?.fat, targets.fat);
    const tcInput = f(targets.calories, 2200);
    const tpInput = f(targets.protein, 180);
    const tcarbInput = f(targets.carbs, 220);
    const tfatInput = f(targets.fat, 70);

    sheet.appendChild(labeled('Date', dateInput));
    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Day total (from MFP)')));
    sheet.appendChild(el('div', { class: 'macro-input-grid' },
      labeled('Calories', cInput),
      labeled('Protein (g)', pInput),
      labeled('Carbs (g)', carbInput),
      labeled('Fat (g)', fatInput)
    ));
    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Daily targets')));
    sheet.appendChild(el('div', { class: 'macro-input-grid' },
      labeled('Calories', tcInput),
      labeled('Protein (g)', tpInput),
      labeled('Carbs (g)', tcarbInput),
      labeled('Fat (g)', tfatInput)
    ));
    sheet.appendChild(el('div', { class: 'action-row' },
      rec ? el('button', { class: 'btn btn-danger', onclick: async () => {
        await Store.del('macros', rec.id); close(); toast('Deleted'); navigate(state.route);
      } }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        await setSetting('macroTargets', {
          calories: parseFloat(tcInput.value) || 0,
          protein: parseFloat(tpInput.value) || 0,
          carbs: parseFloat(tcarbInput.value) || 0,
          fat: parseFloat(tfatInput.value) || 0
        });
        const id = dateInput.value;
        const cal = parseFloat(cInput.value) || 0;
        const pr = parseFloat(pInput.value) || 0;
        const ca = parseFloat(carbInput.value) || 0;
        const fa = parseFloat(fatInput.value) || 0;
        if (cal || pr || ca || fa) {
          await Store.put('macros', {
            id, date: new Date(id + 'T12:00:00').getTime(),
            calories: cal, protein: pr, carbs: ca, fat: fa
          });
        }
        close(); toast('Saved'); navigate(state.route);
      } }, 'Save')
    ));
    setTimeout(() => cInput.focus(), 60);
  }, { title: 'Macros' });
}

function editWaterForDay(day) {
  openModal(async ({ sheet, close }) => {
    const rec = await Store.get('water', day);
    const settings = await getSetting('waterSettings');
    const dateInput = el('input', { type: 'date', value: day });
    const glassesInput = el('input', { type: 'number', inputmode: 'numeric', placeholder: '0', value: rec?.glasses ?? 0 });
    const sizeInput = el('input', { type: 'number', inputmode: 'numeric', placeholder: '250', value: settings.glassSize });
    const targetInput = el('input', { type: 'number', inputmode: 'numeric', placeholder: '8', value: settings.target });
    sheet.appendChild(labeled('Date', dateInput));
    sheet.appendChild(labeled('Glasses for that day', glassesInput));
    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Settings')));
    sheet.appendChild(labeled('Glass size (ml)', sizeInput));
    sheet.appendChild(labeled('Daily target (glasses)', targetInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      rec ? el('button', { class: 'btn btn-danger', onclick: async () => {
        await Store.del('water', rec.id); close(); toast('Deleted'); navigate(state.route);
      } }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        await setSetting('waterSettings', {
          glassSize: parseInt(sizeInput.value) || 250,
          target: parseInt(targetInput.value) || 8
        });
        const id = dateInput.value;
        const g = parseInt(glassesInput.value) || 0;
        await Store.put('water', { id, date: new Date(id + 'T12:00:00').getTime(), glasses: g });
        close(); toast('Saved'); navigate(state.route);
      } }, 'Save')
    ));
    setTimeout(() => glassesInput.focus(), 60);
  }, { title: 'Water' });
}

function openSettingsSheet() {
  openModal(async ({ sheet, close }) => {
    const stepsTarget = await getSetting('stepsTarget');
    const macros = await getSetting('macroTargets');
    const water = await getSetting('waterSettings');

    const stepsInput = el('input', { type: 'number', inputmode: 'numeric', value: stepsTarget });
    const macroInputs = {
      calories: el('input', { type: 'number', inputmode: 'decimal', value: macros.calories }),
      protein: el('input', { type: 'number', inputmode: 'decimal', value: macros.protein }),
      carbs: el('input', { type: 'number', inputmode: 'decimal', value: macros.carbs }),
      fat: el('input', { type: 'number', inputmode: 'decimal', value: macros.fat })
    };
    const waterSize = el('input', { type: 'number', inputmode: 'numeric', value: water.glassSize });
    const waterTarget = el('input', { type: 'number', inputmode: 'numeric', value: water.target });

    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Steps')));
    sheet.appendChild(labeled('Daily target', stepsInput));

    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Macro targets')));
    sheet.appendChild(el('div', { class: 'macro-input-grid' },
      labeled('Calories', macroInputs.calories),
      labeled('Protein (g)', macroInputs.protein),
      labeled('Carbs (g)', macroInputs.carbs),
      labeled('Fat (g)', macroInputs.fat)
    ));

    sheet.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Water')));
    sheet.appendChild(labeled('Glass size (ml)', waterSize));
    sheet.appendChild(labeled('Daily target (glasses)', waterTarget));

    sheet.appendChild(el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        await setSetting('stepsTarget', parseInt(stepsInput.value) || 10000);
        await setSetting('macroTargets', {
          calories: parseFloat(macroInputs.calories.value) || 0,
          protein: parseFloat(macroInputs.protein.value) || 0,
          carbs: parseFloat(macroInputs.carbs.value) || 0,
          fat: parseFloat(macroInputs.fat.value) || 0
        });
        await setSetting('waterSettings', {
          glassSize: parseInt(waterSize.value) || 250,
          target: parseInt(waterTarget.value) || 8
        });
        close(); toast('Saved'); navigate(state.route);
      } }, 'Save')
    ));
  }, { title: 'Settings' });
}

// ============== Active workout ==============
async function saveActive() {
  await Store.put('meta', { key: 'activeWorkout', value: state.active });
}
async function discardActive() {
  await Store.del('meta', 'activeWorkout');
  state.active = null;
  navigate('daily');
}
async function finishActive() {
  const w = state.active;
  w.exercises = w.exercises.map(ex => ({
    ...ex,
    sets: ex.sets.filter(s => s.completed || (s.reps !== '' || s.weight !== ''))
  })).filter(ex => ex.sets.length > 0);
  if (w.exercises.length === 0) return toast('Log at least one set before finishing');
  w.completedAt = Date.now();
  w.duration = w.completedAt - w.date;
  await Store.put('workouts', w);
  await Store.del('meta', 'activeWorkout');
  state.active = null;
  toast('Workout saved 🎉');
  navigate('daily');
}

async function startWorkoutFromTemplate(t) {
  const workout = {
    id: uid(),
    date: Date.now(),
    name: t.name,
    templateId: t.id,
    notes: '',
    exercises: t.exercises.map(ex => ({
      id: uid(),
      name: ex.name,
      notes: '',
      sets: Array.from({ length: ex.sets || 3 }).map(() => ({
        id: uid(), reps: '', weight: '', completed: false
      })),
      targetReps: ex.reps || ''
    }))
  };
  await Store.put('meta', { key: 'activeWorkout', value: workout });
  navigate('daily');
}

async function startBlankWorkout() {
  const workout = {
    id: uid(), date: Date.now(), name: 'Workout', templateId: null, notes: '', exercises: []
  };
  await Store.put('meta', { key: 'activeWorkout', value: workout });
  navigate('daily');
}

async function renderActiveWorkout(view) {
  const w = state.active;
  setTopbar({
    title: w.name,
    sub: 'In progress · ' + fmtTime(w.date),
    actions: [
      el('button', {
        class: 'btn btn-sm btn-ghost', onclick: () => {
          confirmDialog('Discard this workout? Logged sets will be lost.', discardActive, 'Discard');
        }
      }, 'Cancel'),
      el('button', { class: 'btn btn-sm btn-primary', onclick: finishActive }, 'Finish')
    ]
  });
  view.appendChild(el('label', { class: 'field' },
    el('span', {}, 'Workout notes'),
    el('textarea', {
      placeholder: 'How did it feel? Pre-workout? Bodyweight today?',
      oninput: (e) => { w.notes = e.target.value; saveActive(); }
    }, w.notes || '')
  ));
  w.exercises.forEach((ex, i) => view.appendChild(exerciseCard(ex, i)));
  view.appendChild(el('button', {
    class: 'btn btn-block btn-ghost', style: { marginTop: '12px' },
    onclick: () => pickExerciseToAdd()
  }, '＋  Add exercise'));
  view.appendChild(el('div', { style: { height: '12px' } }));
}

function exerciseCard(ex, idx) {
  const card = el('div', { class: 'ex-card' });
  const head = el('div', { class: 'ex-head' },
    el('h3', {}, ex.name + (ex.targetReps ? `  ·  target ${ex.targetReps}` : '')),
    el('button', {
      class: 'btn-icon', onclick: () => {
        confirmDialog(`Remove "${ex.name}" from this workout?`, () => {
          state.active.exercises = state.active.exercises.filter(e => e.id !== ex.id);
          saveActive();
          navigate('daily');
        }, 'Remove');
      }
    }, '✕')
  );
  card.appendChild(head);
  card.appendChild(el('div', { class: 'set-header' },
    el('div', {}, '#'),
    el('div', {}, 'Weight'),
    el('div', {}, 'Reps'),
    el('div', {}, ''),
    el('div', {}, '')
  ));
  ex.sets.forEach((s, si) => card.appendChild(setRow(ex, s, si)));
  card.appendChild(el('button', {
    class: 'btn btn-sm btn-ghost', style: { marginTop: '6px', width: '100%' },
    onclick: () => {
      const last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ id: uid(), reps: last?.reps || '', weight: last?.weight || '', completed: false });
      saveActive();
      navigate('daily');
    }
  }, '＋  Add set'));
  card.appendChild(el('textarea', {
    placeholder: 'Notes (form cues, RPE, pain…)',
    style: { marginTop: '10px', minHeight: '40px' },
    oninput: (e) => { ex.notes = e.target.value; saveActive(); }
  }, ex.notes || ''));
  return card;
}

function setRow(ex, s, si) {
  const row = el('div', { class: 'set-row' + (s.completed ? ' done' : '') });
  row.appendChild(el('div', { class: 'set-num' }, String(si + 1)));
  row.appendChild(el('input', {
    type: 'number', inputmode: 'decimal', placeholder: '–',
    value: s.weight ?? '',
    oninput: (e) => { s.weight = e.target.value; saveActive(); }
  }));
  row.appendChild(el('input', {
    type: 'number', inputmode: 'numeric', placeholder: '–',
    value: s.reps ?? '',
    oninput: (e) => { s.reps = e.target.value; saveActive(); }
  }));
  row.appendChild(el('button', {
    class: 'check-btn' + (s.completed ? ' done' : ''),
    onclick: () => { s.completed = !s.completed; saveActive(); navigate('daily'); }
  }, '✓'));
  row.appendChild(el('button', {
    class: 'del-btn',
    onclick: () => {
      ex.sets = ex.sets.filter(x => x.id !== s.id);
      saveActive();
      navigate('daily');
    }
  }, '🗑'));
  return row;
}

async function pickExerciseToAdd() {
  const workouts = await Store.list('workouts');
  const templates = await Store.list('templates');
  const counts = new Map();
  workouts.forEach(w => w.exercises.forEach(ex => counts.set(ex.name, (counts.get(ex.name) || 0) + 1)));
  templates.forEach(t => t.exercises.forEach(ex => counts.set(ex.name, (counts.get(ex.name) || 0))));
  const all = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);

  openModal(({ sheet, close }) => {
    let filter = '';
    const search = el('input', { type: 'text', placeholder: 'Search or type new exercise…', autofocus: true });
    const list = el('div', { class: 'search-list' });
    const newBtn = el('button', { class: 'btn btn-primary btn-block', style: { marginTop: '8px' }, onclick: () => addExercise(search.value) }, 'Add new exercise');

    function addExercise(name) {
      name = (name || '').trim();
      if (!name) return toast('Enter an exercise name');
      state.active.exercises.push({
        id: uid(), name, notes: '',
        sets: [{ id: uid(), reps: '', weight: '', completed: false }]
      });
      saveActive();
      close();
      navigate('daily');
    }

    function rebuild() {
      list.innerHTML = '';
      const matches = all.filter(n => n.toLowerCase().includes(filter.toLowerCase())).slice(0, 30);
      matches.forEach(name => {
        list.appendChild(el('div', { class: 'row', onclick: () => addExercise(name) },
          el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, name)),
          el('div', { class: 'row-arrow' }, '＋')
        ));
      });
    }
    search.addEventListener('input', () => { filter = search.value; rebuild(); });
    sheet.appendChild(search);
    sheet.appendChild(newBtn);
    sheet.appendChild(list);
    rebuild();
    setTimeout(() => search.focus(), 50);
  }, { title: 'Add exercise' });
}

// ============== HISTORY view ==============
async function renderHistory() {
  const view = $('#view');
  view.innerHTML = '';
  setTopbar({ title: 'History' });

  const workouts = (await Store.list('workouts')).sort((a, b) => b.date - a.date);

  if (workouts.length === 0) {
    view.appendChild(emptyState('📓', 'No workouts yet', 'Finish a workout and it will show up here.'));
    return;
  }

  const groups = new Map();
  workouts.forEach(w => {
    const k = new Date(w.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  });

  for (const [month, list] of groups) {
    view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, month)));
    list.forEach(w => view.appendChild(workoutRow(w)));
  }
}

function workoutRow(w) {
  const totalSets = w.exercises.reduce((s, ex) => s + ex.sets.length, 0);
  const totalVol = w.exercises.reduce((s, ex) => s + ex.sets.reduce((a, st) => a + (parseFloat(st.weight) || 0) * (parseInt(st.reps) || 0), 0), 0);
  const dur = w.duration ? Math.round(w.duration / 60000) : null;
  const sub = `${w.exercises.length} ex · ${totalSets} sets${totalVol ? ` · ${Math.round(totalVol).toLocaleString()} vol` : ''}${dur ? ` · ${dur} min` : ''}`;
  return el('div', { class: 'row', onclick: () => openWorkoutDetail(w) },
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, w.name || 'Workout'),
      el('div', { class: 'row-sub' }, fmtDateShort(w.date) + ' · ' + sub)
    ),
    el('div', { class: 'row-arrow' }, '›')
  );
}

function openWorkoutDetail(w) {
  openModal(({ sheet, close }) => {
    sheet.appendChild(el('div', { class: 'meta', style: { color: 'var(--text-dim)', marginTop: '-8px', marginBottom: '10px', fontSize: '13px' } },
      fmtDate(w.date) + ' · ' + fmtTime(w.date) + (w.duration ? ` · ${Math.round(w.duration / 60000)} min` : '')
    ));
    if (w.notes) sheet.appendChild(el('div', { class: 'notes-block' }, w.notes));

    w.exercises.forEach(ex => {
      const card = el('div', { class: 'card' });
      card.appendChild(el('h3', {}, ex.name));
      ex.sets.forEach((s, i) => {
        card.appendChild(el('div', { class: 'history-set' },
          el('div', {}, `Set ${i + 1}`),
          el('div', { class: 'reps' }, `${s.weight || '—'} × ${s.reps || '—'}${s.completed ? ' ✓' : ''}`)
        ));
      });
      if (ex.notes) card.appendChild(el('div', { class: 'notes-block' }, ex.notes));
      sheet.appendChild(card);
    });

    sheet.appendChild(el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-ghost', onclick: close }, 'Close'),
      el('button', {
        class: 'btn btn-danger', onclick: () => {
          confirmDialog('Delete this workout permanently?', async () => {
            await Store.del('workouts', w.id);
            close();
            toast('Deleted');
            navigate('history');
          }, 'Delete');
        }
      }, 'Delete')
    ));
  }, { title: w.name || 'Workout' });
}

// ============== TEMPLATES view ==============
async function renderTemplates() {
  const view = $('#view');
  view.innerHTML = '';
  setTopbar({
    title: 'Templates',
    actions: [el('button', { class: 'btn btn-sm btn-primary', onclick: () => editTemplate(null) }, '＋ New')]
  });

  const templates = (await Store.list('templates')).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  if (templates.length === 0) {
    view.appendChild(emptyState('🗒️', 'No templates', 'Build a template once, log it fast every time.'));
    return;
  }

  templates.forEach(t => {
    view.appendChild(el('div', { class: 'card' },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
        el('div', {},
          el('h3', {}, `${t.emoji || '🏋️'}  ${t.name}`),
          el('div', { class: 'meta' }, `${t.exercises.length} exercises`)
        ),
        el('div', { style: { display: 'flex', gap: '6px' } },
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => editTemplate(t) }, 'Edit'),
          el('button', { class: 'btn btn-sm btn-primary', onclick: () => startWorkoutFromTemplate(t) }, 'Start')
        )
      ),
      el('div', { style: { marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '4px' } },
        t.exercises.slice(0, 6).map(ex => el('span', { class: 'chip' }, ex.name)),
        t.exercises.length > 6 ? el('span', { class: 'chip' }, `+${t.exercises.length - 6} more`) : null
      )
    ));
  });
}

function editTemplate(existing) {
  const t = existing
    ? JSON.parse(JSON.stringify(existing))
    : { id: uid(), name: '', emoji: '🏋️', exercises: [], createdAt: Date.now() };

  openModal(({ sheet, close }) => {
    sheet.appendChild(el('label', { class: 'field' },
      el('span', {}, 'Name'),
      el('input', { type: 'text', placeholder: 'e.g. Push Day', value: t.name, oninput: (e) => t.name = e.target.value })
    ));
    sheet.appendChild(el('label', { class: 'field' },
      el('span', {}, 'Emoji (optional)'),
      el('input', { type: 'text', maxlength: '2', value: t.emoji || '', oninput: (e) => t.emoji = e.target.value })
    ));

    const exList = el('div');
    function rebuildList() {
      exList.innerHTML = '';
      t.exercises.forEach((ex, i) => {
        const row = el('div', { class: 'card', style: { padding: '10px 12px', marginBottom: '8px' } });
        row.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 60px 60px 32px', gap: '6px', alignItems: 'center' } },
          el('input', { type: 'text', placeholder: 'Exercise', value: ex.name, oninput: (e) => ex.name = e.target.value }),
          el('input', { type: 'number', placeholder: 'sets', value: ex.sets || '', oninput: (e) => ex.sets = parseInt(e.target.value) || 3 }),
          el('input', { type: 'text', placeholder: 'reps', value: ex.reps || '', oninput: (e) => ex.reps = e.target.value }),
          el('button', { class: 'del-btn', style: { width: '32px', height: '40px' }, onclick: () => { t.exercises.splice(i, 1); rebuildList(); } }, '🗑')
        ));
        exList.appendChild(row);
      });
      exList.appendChild(el('button', {
        class: 'btn btn-block btn-ghost',
        style: { marginTop: '8px' },
        onclick: () => { t.exercises.push({ id: uid(), name: '', sets: 3, reps: '8' }); rebuildList(); }
      }, '＋  Add exercise'));
    }
    sheet.appendChild(el('label', { class: 'field' },
      el('span', {}, 'Exercises'),
      exList
    ));
    rebuildList();

    sheet.appendChild(el('div', { class: 'action-row' },
      existing ? el('button', {
        class: 'btn btn-danger', onclick: () => {
          confirmDialog(`Delete template "${t.name}"?`, async () => {
            await Store.del('templates', t.id);
            close(); toast('Deleted'); navigate('templates');
          }, 'Delete');
        }
      }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          if (!t.name.trim()) return toast('Name your template');
          t.exercises = t.exercises.filter(ex => ex.name.trim());
          if (!t.exercises.length) return toast('Add at least one exercise');
          await Store.put('templates', t);
          close(); toast(existing ? 'Saved' : 'Template created'); navigate('templates');
        }
      }, 'Save')
    ));
  }, { title: existing ? 'Edit template' : 'New template' });
}

// ============== PROGRESS view ==============
const PROGRESS_RANGES = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: 'all', label: 'All', days: 100000 }
];

async function renderProgress() {
  const view = $('#view');
  view.innerHTML = '';
  setTopbar({ title: 'Progress' });

  const workouts = (await Store.list('workouts')).sort((a, b) => a.date - b.date);
  const bws = (await Store.list('bodyweight')).sort((a, b) => a.date - b.date);
  const stepsAll = (await Store.list('steps')).sort((a, b) => a.date - b.date);
  const macrosAll = (await Store.list('macros')).sort((a, b) => a.date - b.date);

  if (!workouts.length && !bws.length && !stepsAll.length && !macrosAll.length) {
    view.appendChild(emptyState('📈', 'No data yet', 'Log a workout, body weight, steps, or macros and your trends will appear here.'));
    return;
  }

  let rangeKey = (await Store.get('meta', 'progressRange'))?.value || '3m';
  const rangeWrap = el('div', { class: 'range-tabs' });
  PROGRESS_RANGES.forEach(r => {
    rangeWrap.appendChild(el('button', {
      class: r.key === rangeKey ? 'active' : '',
      onclick: async () => { await Store.put('meta', { key: 'progressRange', value: r.key }); navigate('progress'); }
    }, r.label));
  });
  view.appendChild(rangeWrap);

  const days = PROGRESS_RANGES.find(r => r.key === rangeKey).days;
  const cutoff = Date.now() - days * 86400000;

  view.appendChild(makeBodyWeightChart(bws.filter(b => b.date >= cutoff)));
  view.appendChild(makeVolumeChart(workouts.filter(w => w.date >= cutoff)));
  view.appendChild(await makeExerciseSection(workouts, cutoff));
  view.appendChild(makeStepsChart(stepsAll.filter(s => s.date >= cutoff), await getSetting('stepsTarget')));
  view.appendChild(makeCaloriesChart(macrosAll.filter(m => m.date >= cutoff), (await getSetting('macroTargets')).calories));
  view.appendChild(makeMacroGramsChart(macrosAll.filter(m => m.date >= cutoff)));
}

function makeBodyWeightChart(bws) {
  const wrap = el('div', { class: 'chart-wrap' },
    el('h3', {}, 'Body weight'),
    el('div', { class: 'sub' }, bws.length ? `${bws.length} log${bws.length === 1 ? '' : 's'}` : 'No body weight logs in this range')
  );
  if (!bws.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'Log your weight from the Body tab.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'line',
      data: {
        labels: bws.map(b => fmtDateShort(b.date)),
        datasets: [{
          label: 'Body weight',
          data: bws.map(b => b.weight),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: chartOptions()
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function makeVolumeChart(workouts) {
  const wrap = el('div', { class: 'chart-wrap' },
    el('h3', {}, 'Workout volume'),
    el('div', { class: 'sub' }, 'Total weight × reps per session')
  );
  if (!workouts.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'No workouts in this range.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: workouts.map(w => fmtDateShort(w.date)),
        datasets: [{
          label: 'Volume',
          data: workouts.map(w => w.exercises.reduce((s, ex) => s + ex.sets.reduce((a, st) => a + (parseFloat(st.weight) || 0) * (parseInt(st.reps) || 0), 0), 0)),
          backgroundColor: 'rgba(255,106,61,0.65)',
          borderRadius: 6
        }]
      },
      options: chartOptions()
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

async function makeExerciseSection(workouts, cutoff) {
  const allExercises = new Set();
  workouts.forEach(w => w.exercises.forEach(ex => allExercises.add(ex.name)));
  const exList = Array.from(allExercises).sort();
  if (!exList.length) return el('div');

  const saved = (await Store.get('meta', 'progressExercise'))?.value;
  let chosen = exList.includes(saved) ? saved : exList[0];

  const wrap = el('div', { class: 'chart-wrap' });
  wrap.appendChild(el('h3', {}, 'Per-exercise progress'));
  wrap.appendChild(el('div', { class: 'sub' }, 'Top set & estimated 1RM'));

  const select = el('select', {
    onchange: async (e) => {
      chosen = e.target.value;
      await Store.put('meta', { key: 'progressExercise', value: chosen });
      navigate('progress');
    },
    style: { marginBottom: '12px' }
  });
  exList.forEach(n => {
    const opt = el('option', { value: n }, n);
    if (n === chosen) opt.selected = true;
    select.appendChild(opt);
  });
  wrap.appendChild(select);

  const series = [];
  workouts.forEach(w => {
    if (w.date < cutoff) return;
    w.exercises.filter(ex => ex.name === chosen).forEach(ex => {
      let topSet = null;
      let best1rm = 0;
      ex.sets.forEach(s => {
        const wt = parseFloat(s.weight) || 0;
        const r = parseInt(s.reps) || 0;
        if (wt && r) {
          const oneRm = wt * (1 + r / 30);
          if (oneRm > best1rm) best1rm = oneRm;
          if (!topSet || wt > topSet.wt) topSet = { wt, r };
        }
      });
      if (best1rm > 0) series.push({ date: w.date, topWeight: topSet.wt, oneRm: best1rm });
    });
  });

  if (!series.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'No data for this exercise in range.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.map(s => fmtDateShort(s.date)),
        datasets: [
          { label: 'Top set (weight)', data: series.map(s => s.topWeight), borderColor: '#ff6a3d', backgroundColor: 'rgba(255,106,61,0.15)', fill: false, tension: 0.25, pointRadius: 3 },
          { label: 'Est. 1RM', data: series.map(s => Math.round(s.oneRm * 10) / 10), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', fill: true, tension: 0.25, pointRadius: 2, borderDash: [4, 4] }
        ]
      },
      options: chartOptions(true)
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function makeStepsChart(items, target) {
  const wrap = el('div', { class: 'chart-wrap' },
    el('h3', {}, 'Steps'),
    el('div', { class: 'sub' }, items.length ? `Daily target ${fmtNum(target)}` : 'No step logs in this range')
  );
  if (!items.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'Log steps from the Daily tab.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map(i => fmtDateShort(i.date)),
        datasets: [{
          label: 'Steps',
          data: items.map(i => i.count),
          backgroundColor: items.map(i => i.count >= target ? 'rgba(52,211,153,0.7)' : 'rgba(96,165,250,0.65)'),
          borderRadius: 6
        }]
      },
      options: chartOptions()
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function makeCaloriesChart(items, target) {
  const wrap = el('div', { class: 'chart-wrap' },
    el('h3', {}, 'Calories'),
    el('div', { class: 'sub' }, items.length ? `Daily target ${fmtNum(target)} kcal` : 'No macro logs in this range')
  );
  if (!items.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'Log macros from the Daily tab.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: items.map(i => fmtDateShort(i.date)),
        datasets: [{
          label: 'Calories',
          data: items.map(i => i.calories),
          backgroundColor: 'rgba(255,106,61,0.65)',
          borderRadius: 6
        }]
      },
      options: chartOptions()
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function makeMacroGramsChart(items) {
  const wrap = el('div', { class: 'chart-wrap' },
    el('h3', {}, 'Macros (grams)'),
    el('div', { class: 'sub' }, 'Protein · Carbs · Fat — tap legend to toggle')
  );
  if (!items.length) {
    wrap.appendChild(el('div', { style: { padding: '12px', color: 'var(--text-faint)', fontSize: '13px' } }, 'No macro logs in this range.'));
    return wrap;
  }
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'line',
      data: {
        labels: items.map(i => fmtDateShort(i.date)),
        datasets: [
          { label: 'Protein', data: items.map(i => i.protein), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.1)', tension: 0.25, pointRadius: 2, fill: false },
          { label: 'Carbs', data: items.map(i => i.carbs), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', tension: 0.25, pointRadius: 2, fill: false },
          { label: 'Fat', data: items.map(i => i.fat), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.1)', tension: 0.25, pointRadius: 2, fill: false }
        ]
      },
      options: chartOptions(true)
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function chartOptions(showLegend = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: showLegend, labels: { color: '#8a93a0', boxWidth: 10, font: { size: 11 } } },
      tooltip: { backgroundColor: '#262b34', titleColor: '#fff', bodyColor: '#e7e9ec', borderColor: '#2a2f38', borderWidth: 1 }
    },
    scales: {
      x: { ticks: { color: '#5b6573', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
      y: { ticks: { color: '#5b6573', font: { size: 10 } }, grid: { color: '#1c2027' } }
    }
  };
}

// ============== BODY view ==============
async function renderBody() {
  const view = $('#view');
  view.innerHTML = '';
  setTopbar({
    title: 'Body',
    actions: [
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => logBodyFat() }, '＋ Fat%'),
      el('button', { class: 'btn btn-sm btn-primary', onclick: () => logBodyWeight() }, '＋ Weight')
    ]
  });
  await renderBodyWeightSection(view);
  view.appendChild(el('div', { style: { height: '8px' } }));
  await renderBodyFatSection(view);
}

async function renderBodyWeightSection(view) {
  const all = (await Store.list('bodyweight')).sort((a, b) => b.date - a.date);
  const goal = await getSetting('weightGoal');

  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Body weight')));

  if (!all.length) {
    view.appendChild(emptyState('⚖️', 'No weight logs', 'Tap "+ Weight" above to start tracking.'));
    view.appendChild(goalCard({ label: 'Weight goal', current: null, goal, suffix: '', onEdit: () => editGoal('weightGoal', null) }));
    return;
  }

  const latest = all[0], oldest = all[all.length - 1];
  const change = latest.weight - oldest.weight;

  view.appendChild(el('div', { class: 'stats' },
    statTile(latest.weight, 'Latest'),
    statTile((change >= 0 ? '+' : '') + change.toFixed(1), 'Change'),
    statTile(all.length, 'Logs')
  ));

  view.appendChild(goalCard({
    label: 'Weight goal',
    current: latest.weight,
    goal,
    suffix: '',
    onEdit: () => editGoal('weightGoal', latest.weight)
  }));

  const sorted = [...all].sort((a, b) => a.date - b.date);
  view.appendChild(simpleChart('Trend', sorted, b => b.weight, '#60a5fa', goal?.target));

  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'History')));
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    const prev = all[i + 1];
    const delta = prev ? b.weight - prev.weight : null;
    view.appendChild(el('div', { class: 'bw-row', onclick: () => editBodyWeight(b) },
      el('div', {},
        el('div', { style: { fontWeight: '600' } }, `${b.weight}`),
        el('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '2px' } }, fmtDate(b.date))
      ),
      el('div', { class: 'delta' + (delta == null ? '' : (delta > 0 ? ' up' : delta < 0 ? ' down' : '')) },
        delta == null ? 'first' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`
      )
    ));
  }
}

async function renderBodyFatSection(view) {
  const all = (await Store.list('bodyfat')).sort((a, b) => b.date - a.date);
  const goal = await getSetting('bodyfatGoal');

  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Body fat %')));

  if (!all.length) {
    view.appendChild(emptyState('📊', 'No body fat logs', 'Tap "+ Fat%" above to start tracking.'));
    view.appendChild(goalCard({ label: 'Body fat goal', current: null, goal, suffix: '%', onEdit: () => editGoal('bodyfatGoal', null) }));
    return;
  }

  const latest = all[0], oldest = all[all.length - 1];
  const change = latest.percent - oldest.percent;

  view.appendChild(el('div', { class: 'stats' },
    statTile(latest.percent + '%', 'Latest'),
    statTile((change >= 0 ? '+' : '') + change.toFixed(1) + '%', 'Change'),
    statTile(all.length, 'Logs')
  ));

  view.appendChild(goalCard({
    label: 'Body fat goal',
    current: latest.percent,
    goal,
    suffix: '%',
    onEdit: () => editGoal('bodyfatGoal', latest.percent)
  }));

  const sorted = [...all].sort((a, b) => a.date - b.date);
  view.appendChild(simpleChart('Trend', sorted, b => b.percent, '#f59e0b', goal?.target));

  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'History')));
  for (let i = 0; i < all.length; i++) {
    const b = all[i];
    const prev = all[i + 1];
    const delta = prev ? b.percent - prev.percent : null;
    view.appendChild(el('div', { class: 'bw-row', onclick: () => editBodyFat(b) },
      el('div', {},
        el('div', { style: { fontWeight: '600' } }, `${b.percent}%`),
        el('div', { style: { color: 'var(--text-faint)', fontSize: '12px', marginTop: '2px' } }, fmtDate(b.date))
      ),
      el('div', { class: 'delta' + (delta == null ? '' : (delta > 0 ? ' up' : delta < 0 ? ' down' : '')) },
        delta == null ? 'first' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`
      )
    ));
  }
}

function simpleChart(title, items, valueFn, color, targetVal) {
  const wrap = el('div', { class: 'chart-wrap' });
  wrap.appendChild(el('h3', {}, title));
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  setTimeout(() => {
    const datasets = [{
      label: title,
      data: items.map(valueFn),
      borderColor: color,
      backgroundColor: color + '26',
      fill: true, tension: 0.25, pointRadius: 3
    }];
    if (targetVal) {
      datasets.push({
        label: 'Goal',
        data: items.map(() => targetVal),
        borderColor: 'rgba(231,233,236,0.35)',
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false
      });
    }
    const c = new Chart(canvas, {
      type: 'line',
      data: { labels: items.map(b => fmtDateShort(b.date)), datasets },
      options: chartOptions(!!targetVal)
    });
    state.charts.push(c);
  }, 0);
  return wrap;
}

function goalCard({ label, current, goal, suffix = '', onEdit }) {
  if (!goal || !goal.target) {
    return el('div', { class: 'goal-card empty', onclick: onEdit },
      el('div', { class: 'goal-empty-row' },
        el('div', {},
          el('div', { class: 'goal-title' }, label),
          el('div', { class: 'goal-empty-sub' }, 'Tap to set a target')
        ),
        el('div', { class: 'goal-edit' }, '＋')
      )
    );
  }
  const delta = current != null ? (goal.target - current) : null;
  const absDelta = delta != null ? Math.abs(delta).toFixed(1) : null;
  const direction = delta == null ? '' : (Math.abs(delta) < 0.05 ? '✓' : (delta > 0 ? '↑' : '↓'));
  let dateLine = null;
  if (goal.targetDate) {
    const days = Math.round((new Date(goal.targetDate + 'T12:00:00').getTime() - Date.now()) / 86400000);
    dateLine = days > 0 ? `${days} day${days === 1 ? '' : 's'} until ${fmtDate(new Date(goal.targetDate + 'T12:00:00'))}`
      : days === 0 ? 'Target date is today'
        : `${-days} day${-days === 1 ? '' : 's'} past target`;
  }
  return el('div', { class: 'goal-card', onclick: onEdit },
    el('div', { class: 'goal-row' },
      el('div', { class: 'goal-stat' },
        el('div', { class: 'goal-l' }, 'Current'),
        el('div', { class: 'goal-v' }, current != null ? (current + suffix) : '—')
      ),
      el('div', { class: 'goal-arrow' }, direction),
      el('div', { class: 'goal-stat' },
        el('div', { class: 'goal-l' }, 'Target'),
        el('div', { class: 'goal-v accent' }, goal.target + suffix)
      ),
      delta != null ? el('div', { class: 'goal-stat' },
        el('div', { class: 'goal-l' }, 'To go'),
        el('div', { class: 'goal-v' }, absDelta + suffix)
      ) : null
    ),
    dateLine ? el('div', { class: 'goal-date' }, dateLine) : null
  );
}

function editGoal(key, currentValue) {
  openModal(async ({ sheet, close }) => {
    const goal = (await getSetting(key)) || { target: '', targetDate: '' };
    const targetInput = el('input', {
      type: 'number', inputmode: 'decimal', step: '0.1',
      value: goal.target || '',
      placeholder: currentValue != null ? `e.g. ${(currentValue - 5).toFixed(1)}` : ''
    });
    const dateInput = el('input', { type: 'date', value: goal.targetDate || '' });
    sheet.appendChild(labeled('Target value', targetInput));
    sheet.appendChild(labeled('Target date (optional)', dateInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      goal && goal.target ? el('button', {
        class: 'btn btn-danger', onclick: async () => {
          await Store.del('meta', key); close(); toast('Goal removed'); navigate('body');
        }
      }, 'Remove') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          const t = parseFloat(targetInput.value);
          if (!t || t <= 0) return toast('Enter a valid target');
          await setSetting(key, { target: t, targetDate: dateInput.value || null });
          close(); toast('Goal saved'); navigate('body');
        }
      }, 'Save')
    ));
    setTimeout(() => targetInput.focus(), 60);
  }, { title: 'Set goal' });
}

function logBodyWeight(existing) {
  const initial = existing || { id: uid(), date: Date.now(), weight: '' };
  openModal(({ sheet, close }) => {
    const dateInput = el('input', { type: 'date', value: isoDay(initial.date) });
    const weightInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'e.g. 175.5', value: initial.weight, autofocus: true });
    sheet.appendChild(labeled('Weight', weightInput));
    sheet.appendChild(labeled('Date', dateInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      existing ? el('button', {
        class: 'btn btn-danger', onclick: async () => {
          await Store.del('bodyweight', existing.id); close(); toast('Deleted'); navigate('body');
        }
      }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          const w = parseFloat(weightInput.value);
          if (!w || w <= 0) return toast('Enter a valid weight');
          const d = new Date(dateInput.value + 'T12:00:00');
          await Store.put('bodyweight', { id: initial.id, date: d.getTime(), weight: w });
          close(); toast('Logged'); navigate('body');
        }
      }, 'Save')
    ));
    setTimeout(() => weightInput.focus(), 60);
  }, { title: existing ? 'Edit weight' : 'Log body weight' });
}
function editBodyWeight(b) { logBodyWeight(b); }

function logBodyFat(existing) {
  const initial = existing || { id: uid(), date: Date.now(), percent: '' };
  openModal(({ sheet, close }) => {
    const dateInput = el('input', { type: 'date', value: isoDay(initial.date) });
    const pctInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'e.g. 18.5', value: initial.percent, autofocus: true });
    sheet.appendChild(labeled('Body fat %', pctInput));
    sheet.appendChild(labeled('Date', dateInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      existing ? el('button', {
        class: 'btn btn-danger', onclick: async () => {
          await Store.del('bodyfat', existing.id); close(); toast('Deleted'); navigate('body');
        }
      }, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          const p = parseFloat(pctInput.value);
          if (!p || p <= 0) return toast('Enter a valid percent');
          const d = new Date(dateInput.value + 'T12:00:00');
          await Store.put('bodyfat', { id: initial.id, date: d.getTime(), percent: p });
          close(); toast('Logged'); navigate('body');
        }
      }, 'Save')
    ));
    setTimeout(() => pctInput.focus(), 60);
  }, { title: existing ? 'Edit body fat' : 'Log body fat' });
}
function editBodyFat(b) { logBodyFat(b); }

// ============== boot ==============
(async () => {
  await openDB();
  await maybeSeed();
  await navigate('daily');
})();

window.Lift = { Store, state, navigate };
