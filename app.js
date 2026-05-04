/* Lift — workout tracker. Vanilla JS, IndexedDB, Chart.js. */

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

// ============== storage (IndexedDB) ==============
const DB_NAME = 'lift-db';
const DB_VERSION = 1;
let dbPromise;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
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
  route: 'today',
  active: null, // active workout
  charts: [], // chart instances to destroy on rerender
};

// ============== router ==============
const routes = {
  today: renderToday,
  history: renderHistory,
  templates: renderTemplates,
  progress: renderProgress,
  body: renderBody,
};

async function navigate(route) {
  state.route = route;
  $$('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.route === route));
  // destroy charts before rerender
  state.charts.forEach(c => { try { c.destroy(); } catch(_){} });
  state.charts = [];
  await routes[route]();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const navbtn = e.target.closest('.navbtn');
  if (navbtn) navigate(navbtn.dataset.route);
});

// ============== modal ==============
function openModal(contentBuilder, opts = {}) {
  const root = $('#modal-root');
  root.innerHTML = '';
  const close = () => { root.innerHTML = ''; };
  const backdrop = el('div', { class: 'modal-backdrop', onclick: close });
  const sheet = el('div', { class: 'modal-sheet' });
  sheet.appendChild(el('div', { class: 'modal-handle' }));
  if (opts.title) sheet.appendChild(el('h2', {}, opts.title));
  contentBuilder({ sheet, close });
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

// ============== topbar helper ==============
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

// ============== TODAY view ==============
async function renderToday() {
  const view = $('#view');
  view.innerHTML = '';
  state.active = await Store.get('meta', 'activeWorkout');
  state.active = state.active ? state.active.value : null;

  if (state.active) {
    return renderActiveWorkout(view);
  }

  setTopbar({ title: 'Today', sub: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) });

  // Quick stats
  const workouts = await Store.list('workouts');
  workouts.sort((a,b) => b.date - a.date);
  const last7 = workouts.filter(w => Date.now() - w.date < 7*86400000).length;
  const totalSets = workouts.reduce((sum, w) => sum + w.exercises.reduce((s,e)=>s + e.sets.filter(x=>x.completed).length, 0), 0);
  const streak = computeStreak(workouts);

  view.appendChild(el('div', { class: 'stats' },
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(last7)), el('div', { class: 'l' }, 'This week')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(streak)), el('div', { class: 'l' }, 'Day streak')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(workouts.length)), el('div', { class: 'l' }, 'Total')),
  ));

  // Start workout actions
  view.appendChild(el('div', { class: 'section-h' }, el('h2', {}, 'Start a workout')));
  const templates = await Store.list('templates');
  templates.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

  const grid = el('div');
  if (templates.length === 0) {
    grid.appendChild(emptyState('🗒️', 'No templates yet', 'Create one in the Templates tab.'));
  } else {
    templates.forEach(t => {
      grid.appendChild(el('div', { class: 'row', onclick: () => startWorkoutFromTemplate(t) },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title' }, `${t.emoji || '🏋️'}  ${t.name}`),
          el('div', { class: 'row-sub' }, `${t.exercises.length} exercise${t.exercises.length === 1 ? '' : 's'}`)
        ),
        el('div', { class: 'row-arrow' }, '›')
      ));
    });
  }
  view.appendChild(grid);

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

function emptyState(emoji, title, body) {
  return el('div', { class: 'empty' },
    el('div', { class: 'emoji' }, emoji),
    el('h3', {}, title),
    el('p', {}, body)
  );
}

function computeStreak(workouts) {
  if (workouts.length === 0) return 0;
  const days = new Set(workouts.map(w => isoDay(w.date)));
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0,0,0,0);
  // Allow today missing if it's still early
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
  navigate('today');
}

async function startBlankWorkout() {
  const workout = {
    id: uid(),
    date: Date.now(),
    name: 'Workout',
    templateId: null,
    notes: '',
    exercises: []
  };
  await Store.put('meta', { key: 'activeWorkout', value: workout });
  navigate('today');
}

async function saveActive() {
  await Store.put('meta', { key: 'activeWorkout', value: state.active });
}

async function discardActive() {
  await Store.del('meta', 'activeWorkout');
  state.active = null;
  navigate('today');
}

async function finishActive() {
  // Drop empty sets that were never logged
  const w = state.active;
  w.exercises = w.exercises.map(ex => ({
    ...ex,
    sets: ex.sets.filter(s => s.completed || (s.reps !== '' || s.weight !== ''))
  })).filter(ex => ex.sets.length > 0);

  if (w.exercises.length === 0) {
    return toast('Log at least one set before finishing');
  }
  w.completedAt = Date.now();
  w.duration = w.completedAt - w.date;
  await Store.put('workouts', w);
  await Store.del('meta', 'activeWorkout');
  state.active = null;
  toast('Workout saved 🎉');
  navigate('today');
}

async function renderActiveWorkout(view) {
  const w = state.active;
  setTopbar({
    title: w.name,
    sub: 'In progress · ' + fmtTime(w.date),
    actions: [
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => {
        confirmDialog('Discard this workout? Logged sets will be lost.', discardActive, 'Discard');
      }}, 'Cancel'),
      el('button', { class: 'btn btn-sm btn-primary', onclick: finishActive }, 'Finish')
    ]
  });

  // Workout notes
  view.appendChild(el('label', { class: 'field' },
    el('span', {}, 'Workout notes'),
    el('textarea', {
      placeholder: 'How did it feel? Pre-workout? Bodyweight today?',
      oninput: (e) => { w.notes = e.target.value; saveActive(); }
    }, w.notes || '')
  ));

  // Exercises
  w.exercises.forEach((ex, i) => view.appendChild(exerciseCard(ex, i)));

  // Add exercise button
  view.appendChild(el('button', {
    class: 'btn btn-block btn-ghost', style: { marginTop: '12px' },
    onclick: () => pickExerciseToAdd()
  }, '＋  Add exercise'));

  view.appendChild(el('div', { style: { height: '12px' }}));
}

function exerciseCard(ex, idx) {
  const card = el('div', { class: 'ex-card' });

  const head = el('div', { class: 'ex-head' },
    el('h3', {}, ex.name + (ex.targetReps ? `  ·  target ${ex.targetReps}` : '')),
    el('button', { class: 'btn-icon', onclick: () => {
      confirmDialog(`Remove "${ex.name}" from this workout?`, () => {
        state.active.exercises = state.active.exercises.filter(e => e.id !== ex.id);
        saveActive();
        navigate('today');
      }, 'Remove');
    }}, '✕')
  );
  card.appendChild(head);

  // Set header
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
      navigate('today');
    }
  }, '＋  Add set'));

  // Notes per exercise
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
    onclick: () => { s.completed = !s.completed; saveActive(); navigate('today'); }
  }, '✓'));
  row.appendChild(el('button', {
    class: 'del-btn',
    onclick: () => {
      ex.sets = ex.sets.filter(x => x.id !== s.id);
      saveActive();
      navigate('today');
    }
  }, '🗑'));
  return row;
}

async function pickExerciseToAdd() {
  // Build a recent-exercise list from workouts + templates
  const workouts = await Store.list('workouts');
  const templates = await Store.list('templates');
  const counts = new Map();
  workouts.forEach(w => w.exercises.forEach(ex => counts.set(ex.name, (counts.get(ex.name) || 0) + 1)));
  templates.forEach(t => t.exercises.forEach(ex => counts.set(ex.name, (counts.get(ex.name) || 0))));
  const all = Array.from(counts.entries()).sort((a,b) => b[1] - a[1]).map(([name]) => name);

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
        sets: [ { id: uid(), reps: '', weight: '', completed: false } ]
      });
      saveActive();
      close();
      navigate('today');
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

  const workouts = await Store.list('workouts');
  workouts.sort((a,b) => b.date - a.date);

  if (workouts.length === 0) {
    view.appendChild(emptyState('📓', 'No workouts yet', 'Finish a workout and it will show up here.'));
    return;
  }

  // Group by month
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
  const totalVol = w.exercises.reduce((s, ex) => s + ex.sets.reduce((a, st) => a + (parseFloat(st.weight)||0) * (parseInt(st.reps)||0), 0), 0);
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
      fmtDate(w.date) + ' · ' + fmtTime(w.date) + (w.duration ? ` · ${Math.round(w.duration/60000)} min` : '')
    ));
    if (w.notes) sheet.appendChild(el('div', { class: 'notes-block' }, w.notes));

    w.exercises.forEach(ex => {
      const card = el('div', { class: 'card' });
      card.appendChild(el('h3', {}, ex.name));
      ex.sets.forEach((s, i) => {
        card.appendChild(el('div', { class: 'history-set' },
          el('div', {}, `Set ${i+1}`),
          el('div', { class: 'reps' }, `${s.weight || '—'} × ${s.reps || '—'}${s.completed ? ' ✓' : ''}`)
        ));
      });
      if (ex.notes) card.appendChild(el('div', { class: 'notes-block' }, ex.notes));
      sheet.appendChild(card);
    });

    sheet.appendChild(el('div', { class: 'action-row' },
      el('button', { class: 'btn btn-ghost', onclick: close }, 'Close'),
      el('button', { class: 'btn btn-danger', onclick: () => {
        confirmDialog('Delete this workout permanently?', async () => {
          await Store.del('workouts', w.id);
          close();
          toast('Deleted');
          navigate('history');
        }, 'Delete');
      }}, 'Delete')
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

  const templates = await Store.list('templates');
  templates.sort((a,b) => (a.createdAt||0) - (b.createdAt||0));

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
        t.exercises.slice(0,6).map(ex => el('span', { class: 'chip' }, ex.name)),
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
      existing ? el('button', { class: 'btn btn-danger', onclick: () => {
        confirmDialog(`Delete template "${t.name}"?`, async () => {
          await Store.del('templates', t.id);
          close(); toast('Deleted'); navigate('templates');
        }, 'Delete');
      }}, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        if (!t.name.trim()) return toast('Name your template');
        t.exercises = t.exercises.filter(ex => ex.name.trim());
        if (!t.exercises.length) return toast('Add at least one exercise');
        await Store.put('templates', t);
        close(); toast(existing ? 'Saved' : 'Template created'); navigate('templates');
      }}, 'Save')
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

  const workouts = await Store.list('workouts');
  workouts.sort((a,b) => a.date - b.date);

  if (workouts.length === 0) {
    view.appendChild(emptyState('📈', 'No data yet', 'Log a couple of workouts and your charts will start appearing here.'));
    return;
  }

  // Range selector
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
  const filtered = workouts.filter(w => w.date >= cutoff);

  // Body weight chart
  const bws = (await Store.list('bodyweight')).filter(b => b.date >= cutoff).sort((a,b) => a.date - b.date);
  view.appendChild(makeBodyWeightChart(bws));

  // Volume per workout chart
  view.appendChild(makeVolumeChart(filtered));

  // Per-exercise picker + chart
  view.appendChild(await makeExerciseSection(workouts, cutoff));
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
          data: workouts.map(w => w.exercises.reduce((s,ex) => s + ex.sets.reduce((a,st) => a + (parseFloat(st.weight)||0)*(parseInt(st.reps)||0), 0), 0)),
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
          // Epley 1RM estimate
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
          { label: 'Est. 1RM', data: series.map(s => Math.round(s.oneRm * 10) / 10), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.12)', fill: true, tension: 0.25, pointRadius: 2, borderDash: [4,4] }
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

// ============== BODY weight ==============
async function renderBody() {
  const view = $('#view');
  view.innerHTML = '';
  setTopbar({
    title: 'Body weight',
    actions: [el('button', { class: 'btn btn-sm btn-primary', onclick: () => logBodyWeight() }, '＋ Log')]
  });

  const all = await Store.list('bodyweight');
  all.sort((a,b) => b.date - a.date);

  if (!all.length) {
    view.appendChild(emptyState('⚖️', 'No body weight logs', 'Track your weight over time to see trends in Progress.'));
    view.appendChild(el('button', { class: 'btn btn-block btn-primary', onclick: () => logBodyWeight() }, 'Log first weight'));
    return;
  }

  // Quick stats
  const latest = all[0];
  const oldest = all[all.length - 1];
  const change = latest.weight - oldest.weight;
  view.appendChild(el('div', { class: 'stats' },
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(latest.weight)), el('div', { class: 'l' }, 'Latest')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, (change >= 0 ? '+' : '') + change.toFixed(1)), el('div', { class: 'l' }, 'Change')),
    el('div', { class: 'stat' }, el('div', { class: 'v' }, String(all.length)), el('div', { class: 'l' }, 'Logs')),
  ));

  // Trend chart
  const sorted = [...all].sort((a,b) => a.date - b.date);
  const wrap = el('div', { class: 'chart-wrap' });
  wrap.appendChild(el('h3', {}, 'Trend'));
  const canvas = el('canvas');
  wrap.appendChild(canvas);
  view.appendChild(wrap);
  setTimeout(() => {
    const c = new Chart(canvas, {
      type: 'line',
      data: {
        labels: sorted.map(b => fmtDateShort(b.date)),
        datasets: [{
          label: 'Weight',
          data: sorted.map(b => b.weight),
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.15)',
          fill: true, tension: 0.25, pointRadius: 3
        }]
      },
      options: chartOptions()
    });
    state.charts.push(c);
  }, 0);

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

function logBodyWeight(existing) {
  const today = new Date();
  const initial = existing || { id: uid(), date: Date.now(), weight: '' };
  openModal(({ sheet, close }) => {
    const dateInput = el('input', { type: 'date', value: isoDay(initial.date) });
    const weightInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'e.g. 175.5', value: initial.weight, autofocus: true });
    sheet.appendChild(el('label', { class: 'field' }, el('span', {}, 'Weight'), weightInput));
    sheet.appendChild(el('label', { class: 'field' }, el('span', {}, 'Date'), dateInput));
    sheet.appendChild(el('div', { class: 'action-row' },
      existing ? el('button', { class: 'btn btn-danger', onclick: async () => {
        await Store.del('bodyweight', existing.id); close(); toast('Deleted'); navigate('body');
      }}, 'Delete') : el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
      el('button', { class: 'btn btn-primary', onclick: async () => {
        const w = parseFloat(weightInput.value);
        if (!w || w <= 0) return toast('Enter a valid weight');
        const d = new Date(dateInput.value + 'T12:00:00');
        await Store.put('bodyweight', { id: initial.id, date: d.getTime(), weight: w });
        close(); toast('Logged'); navigate('body');
      }}, 'Save')
    ));
    setTimeout(() => weightInput.focus(), 60);
  }, { title: existing ? 'Edit weight' : 'Log body weight' });
}
function editBodyWeight(b) { logBodyWeight(b); }

// ============== boot ==============
(async () => {
  await openDB();
  await maybeSeed();
  await navigate('today');
})();

// Expose for debugging
window.Lift = { Store, state, navigate };
