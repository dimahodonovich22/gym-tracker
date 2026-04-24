// ====== STATE ======
const STORAGE_KEY = "gymtracker.v1";
const DEFAULT_STATE = {
  nextDayIndex: 0,
  sessions: [],         // completed + active
  activeSessionId: null,
  bodyWeights: [],      // [{date, weight}]
  settings: { unit: "kg" },
};
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const s = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_STATE), ...s };
  } catch { return structuredClone(DEFAULT_STATE); }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ====== UTIL ======
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const fmtDate = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtDateTime = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + ", " +
         d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
};
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

// ====== ROUTER ======
function route() {
  const hash = location.hash.slice(1) || "home";
  const [name, ...rest] = hash.split("/");
  const param = rest.join("/");
  const app = $("#app");
  app.innerHTML = "";
  ({
    home: renderHome,
    workout: renderWorkout,
    history: renderHistory,
    session: () => renderSessionDetail(param),
    prs: renderPRs,
    body: renderBody,
    program: renderProgram,
  }[name] || renderHome)(app);
  $$("nav.bottom a").forEach(a => {
    a.classList.toggle("active", a.dataset.route === name ||
      (name === "workout" && a.dataset.route === "home") ||
      (name === "session" && a.dataset.route === "history"));
  });
  window.scrollTo(0, 0);
  updateRestBar();
}
window.addEventListener("hashchange", route);

// ====== HOME ======
function renderHome(app) {
  const day = PROGRAM[state.nextDayIndex];
  const active = state.sessions.find(s => s.id === state.activeSessionId && !s.completed);
  const lastSession = [...state.sessions].filter(s => s.completed).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
  const recent = [...state.sessions].filter(s => s.completed).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
  const lastBW = state.bodyWeights[state.bodyWeights.length - 1];

  app.innerHTML = `
    <header class="top">
      <div class="header-title">
        <div class="logo">GT</div>
        <h1>GymTracker</h1>
      </div>
      <button class="btn sm ghost" onclick="location.hash='program'">Программа</button>
    </header>

    ${active ? `
      <div class="card accent">
        <div class="row between">
          <div>
            <div class="pill">Активная тренировка</div>
            <h2 style="margin-top:6px; margin-bottom:0">${esc(active.dayName)}</h2>
            <div class="small muted">Начата ${fmtDateTime(active.startedAt)}</div>
          </div>
        </div>
        <div class="row" style="margin-top:14px; gap:8px;">
          <button class="btn primary" style="flex:1" onclick="location.hash='workout'">Продолжить</button>
          <button class="btn danger sm" onclick="cancelActive()">Отменить</button>
        </div>
      </div>
    ` : `
      <div class="card accent">
        <div class="pill">Следующая тренировка</div>
        <h2 style="margin-top:6px">${esc(day.name)}</h2>
        <div class="small muted">${esc(day.block)} · ${day.exercises.length} упражнений</div>
        <button class="btn primary block" style="margin-top:14px" onclick="startWorkout()">Начать тренировку</button>
      </div>
    `}

    <div class="card">
      <div class="row between">
        <div>
          <div class="small muted">Вес тела</div>
          <div style="font-size:22px; font-weight:700">${lastBW ? lastBW.weight + " кг" : "—"}</div>
          ${lastBW ? `<div class="small muted">${fmtDate(lastBW.date)}</div>` : ""}
        </div>
        <button class="btn sm" onclick="openBodyWeightModal()">+ Записать</button>
      </div>
    </div>

    <h3>Недавние тренировки</h3>
    ${recent.length ? recent.map(s => `
      <div class="list-item" onclick="location.hash='session/${s.id}'">
        <div>
          <div class="title">${esc(s.dayName)}</div>
          <div class="sub">${fmtDateTime(s.startedAt)} · ${countSets(s)} подходов</div>
        </div>
        <div class="right">→</div>
      </div>
    `).join("") : `<div class="empty">Пока нет завершённых тренировок</div>`}
  `;
}

function countSets(session) {
  return session.exercises.reduce((n, e) => n + (e.sets?.filter(s => s.done).length || 0), 0);
}

// ====== START / CANCEL WORKOUT ======
function startWorkout() {
  const day = PROGRAM[state.nextDayIndex];
  const session = {
    id: uid(),
    dayIndex: state.nextDayIndex,
    dayName: day.name,
    block: day.block,
    startedAt: new Date().toISOString(),
    completedAt: null,
    completed: false,
    exercises: day.exercises.map(e => ({
      name: e.name, warmup: e.warmup, scheme: e.scheme, rest: e.rest, rir: e.rir, video: e.video,
      sets: [], done: false,
    })),
  };
  state.sessions.push(session);
  state.activeSessionId = session.id;
  save();
  location.hash = "workout";
}
function cancelActive() {
  if (!confirm("Отменить текущую тренировку? Данные будут удалены.")) return;
  state.sessions = state.sessions.filter(s => s.id !== state.activeSessionId);
  state.activeSessionId = null;
  save();
  route();
}

// ====== WORKOUT VIEW ======
function currentSession() {
  return state.sessions.find(s => s.id === state.activeSessionId);
}

function renderWorkout(app) {
  const s = currentSession();
  if (!s) { location.hash = "home"; return; }
  const doneEx = s.exercises.filter(e => e.done).length;
  const pct = Math.round((doneEx / s.exercises.length) * 100);

  app.innerHTML = `
    <header class="top">
      <button class="btn sm ghost" onclick="location.hash='home'">← Назад</button>
      <button class="btn sm" onclick="finishWorkout()">Завершить</button>
    </header>
    <h1>${esc(s.dayName)}</h1>
    <div class="small muted">${esc(s.block)}</div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="small muted" style="margin-top:6px">${doneEx} / ${s.exercises.length} упражнений</div>

    <div style="margin-top:20px">
      ${s.exercises.map((e, i) => renderExerciseCard(e, i, s)).join("")}
    </div>

    <button class="btn primary block" style="margin-top:20px" onclick="finishWorkout()">
      Завершить тренировку
    </button>
  `;
}

function renderExerciseCard(e, i, s) {
  const open = e._open;
  const lastLogged = findLastPerformance(e.name, s.id);
  return `
    <div class="exercise ${e.done ? "done" : ""} ${open ? "open" : ""}" data-idx="${i}">
      <div class="ex-header" onclick="toggleExercise(${i})">
        <div class="num">${e.done ? "✓" : i+1}</div>
        <div class="ex-title">
          <div class="n">${esc(e.name)}</div>
          <div class="meta">
            ${e.warmup ? `<span class="pill warm">Разминка</span>` : ""}
            <span class="pill">${esc(e.scheme)}</span>
            <span class="pill">Отдых: ${esc(e.rest)}</span>
            ${e.rir && e.rir !== "—" ? `<span class="pill rir">ЗДО ${esc(e.rir)}</span>` : ""}
          </div>
        </div>
        <div style="color:var(--muted)">${open ? "▾" : "▸"}</div>
      </div>
      <div class="ex-body">
        ${e.video ? `<a href="${esc(e.video)}" target="_blank" rel="noopener" class="btn sm ghost" style="margin-bottom:10px">▶ Техника выполнения</a>` : ""}
        ${lastLogged ? `<div class="small muted" style="margin-bottom:8px">Прошлая: ${lastLogged}</div>` : ""}
        <div class="col-labels"><div>#</div><div>Вес (кг)</div><div>Повторы</div><div></div></div>
        ${(e.sets.length ? e.sets : [{weight:"",reps:"",done:false}]).map((set, si) => setRow(i, si, set)).join("")}
        ${e.sets.length && e.sets[e.sets.length-1].done ? setRow(i, e.sets.length, {weight:"",reps:"",done:false}) : ""}
        <div class="ex-actions">
          ${e.done
            ? `<button class="btn sm" onclick="toggleExerciseDone(${i})">Отменить готово</button>`
            : `<button class="btn sm" onclick="toggleExerciseDone(${i})">✓ Готово</button>`}
        </div>
      </div>
    </div>
  `;
}

function setRow(exIdx, setIdx, set) {
  return `
    <div class="set-row ${set.done ? "logged" : ""}" data-ex="${exIdx}" data-si="${setIdx}">
      <div class="idx">${setIdx + 1}</div>
      <input type="number" inputmode="decimal" step="0.5" placeholder="0" value="${set.weight ?? ""}" onchange="updateSet(${exIdx},${setIdx},'weight',this.value)">
      <input type="number" inputmode="numeric" step="1" placeholder="0" value="${set.reps ?? ""}" onchange="updateSet(${exIdx},${setIdx},'reps',this.value)">
      <div class="del" onclick="${set.done ? `unlogSet(${exIdx},${setIdx})` : `logSet(${exIdx},${setIdx})`}">${set.done ? "↺" : "✓"}</div>
    </div>
  `;
}

function toggleExercise(i) {
  const s = currentSession();
  const wasOpen = s.exercises[i]._open;
  s.exercises.forEach(e => e._open = false);
  s.exercises[i]._open = !wasOpen;
  renderWorkout($("#app"));
}

function updateSet(ei, si, field, value) {
  const s = currentSession();
  const ex = s.exercises[ei];
  while (ex.sets.length <= si) ex.sets.push({ weight: "", reps: "", done: false });
  ex.sets[si][field] = value === "" ? "" : Number(value);
  save();
}
function logSet(ei, si) {
  const s = currentSession();
  const ex = s.exercises[ei];
  while (ex.sets.length <= si) ex.sets.push({ weight: "", reps: "", done: false });
  const set = ex.sets[si];
  if (set.weight === "" && set.reps === "") { toast("Введите вес или повторы"); return; }
  set.done = true;
  set.loggedAt = new Date().toISOString();
  ex._open = true;
  save();
  const secs = restToSeconds(ex.rest);
  if (secs > 0) startRest(secs, ex.name);
  renderWorkout($("#app"));
}
function unlogSet(ei, si) {
  const s = currentSession();
  const set = s.exercises[ei].sets[si];
  if (!set) return;
  set.done = false;
  s.exercises[ei]._open = true;
  save();
  renderWorkout($("#app"));
}
function toggleExerciseDone(i) {
  const s = currentSession();
  s.exercises[i].done = !s.exercises[i].done;
  if (s.exercises[i].done) s.exercises[i]._open = false;
  save();
  renderWorkout($("#app"));
}

function finishWorkout() {
  const s = currentSession();
  if (!s) return;
  const anyLogged = s.exercises.some(e => e.sets.some(x => x.done));
  if (!anyLogged && !confirm("Нет залогированных подходов. Всё равно завершить?")) return;
  s.completed = true;
  s.completedAt = new Date().toISOString();
  s.exercises.forEach(e => delete e._open);
  state.activeSessionId = null;
  state.nextDayIndex = (s.dayIndex + 1) % PROGRAM.length;
  save();
  stopRest();
  toast("Тренировка сохранена 💪");
  location.hash = "home";
}

// ====== REST TIMER ======
let restInterval = null;
let restEnd = null;
let restFor = "";

function startRest(seconds, label) {
  restEnd = Date.now() + seconds * 1000;
  restFor = label;
  clearInterval(restInterval);
  updateRestBar();
  restInterval = setInterval(updateRestBar, 250);
}
function stopRest() {
  clearInterval(restInterval);
  restInterval = null;
  restEnd = null;
  updateRestBar();
}
function updateRestBar() {
  const bar = $("#restBar");
  if (!bar) return;
  if (!restEnd) { bar.classList.add("hidden"); return; }
  const left = Math.max(0, Math.round((restEnd - Date.now()) / 1000));
  bar.classList.remove("hidden");
  $("#restTime").textContent = `${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`;
  $("#restLabel").textContent = restFor ? "Отдых · " + restFor : "Отдых";
  if (left <= 0) {
    stopRest();
    vibrate([300, 120, 300]);
    playBeep();
    toast("⏰ Отдых окончен");
  }
}
function addRest(s) { if (restEnd) restEnd += s * 1000; updateRestBar(); }
function skipRest() { stopRest(); }

function vibrate(p) { try { navigator.vibrate?.(p); } catch {} }
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  } catch {}
}

// ====== HISTORY ======
function renderHistory(app) {
  const sessions = state.sessions.filter(s => s.completed).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  app.innerHTML = `
    <header class="top"><h1>История</h1></header>
    ${sessions.length ? sessions.map(s => `
      <div class="list-item" onclick="location.hash='session/${s.id}'">
        <div>
          <div class="title">${esc(s.dayName)}</div>
          <div class="sub">${fmtDateTime(s.startedAt)} · ${countSets(s)} подходов</div>
        </div>
        <div class="right">→</div>
      </div>
    `).join("") : `<div class="empty">Нет завершённых тренировок</div>`}
  `;
}

function renderSessionDetail(id) {
  const s = state.sessions.find(x => x.id === id);
  const app = $("#app");
  if (!s) { app.innerHTML = `<div class="empty">Тренировка не найдена</div>`; return; }
  app.innerHTML = `
    <header class="top">
      <button class="btn sm ghost" onclick="location.hash='history'">← Назад</button>
      <button class="btn sm danger" onclick="deleteSession('${s.id}')">Удалить</button>
    </header>
    <h1>${esc(s.dayName)}</h1>
    <div class="small muted">${fmtDateTime(s.startedAt)} · ${esc(s.block)}</div>

    <div style="margin-top:20px">
      ${s.exercises.map((e, i) => `
        <div class="card">
          <div class="row between">
            <div style="flex:1">
              <div style="font-weight:600">${i+1}. ${esc(e.name)}</div>
              <div class="small muted">${esc(e.scheme)}${e.rir && e.rir !== "—" ? " · ЗДО " + esc(e.rir) : ""}</div>
            </div>
          </div>
          ${e.sets.filter(x=>x.done).length ? `
            <div style="margin-top:10px">
              ${e.sets.filter(x=>x.done).map((x, si) => `
                <div class="small" style="padding:4px 0; border-bottom:1px solid var(--line)">
                  <span class="muted">${si+1}.</span> ${x.weight || 0} кг × ${x.reps || 0}
                </div>
              `).join("")}
            </div>
          ` : `<div class="small muted" style="margin-top:6px">Нет залогированных подходов</div>`}
        </div>
      `).join("")}
    </div>
  `;
}
function deleteSession(id) {
  if (!confirm("Удалить эту тренировку?")) return;
  state.sessions = state.sessions.filter(s => s.id !== id);
  save();
  location.hash = "history";
}

// ====== PRs ======
function renderPRs(app) {
  const prs = {}; // name -> {weight, reps, date, e1rm}
  for (const s of state.sessions.filter(x=>x.completed)) {
    for (const e of s.exercises) {
      for (const set of e.sets) {
        if (!set.done || !set.weight || !set.reps) continue;
        const e1rm = set.weight * (1 + set.reps / 30);
        const prev = prs[e.name];
        if (!prev || e1rm > prev.e1rm) {
          prs[e.name] = { weight: set.weight, reps: set.reps, date: s.startedAt, e1rm };
        }
      }
    }
  }
  const arr = Object.entries(prs).sort((a,b)=>b[1].e1rm - a[1].e1rm);
  app.innerHTML = `
    <header class="top"><h1>Личные рекорды</h1></header>
    ${arr.length ? arr.map(([name, pr]) => `
      <div class="list-item">
        <div>
          <div class="title">${esc(name)}</div>
          <div class="sub">${fmtDate(pr.date)}</div>
        </div>
        <div class="right">
          <div style="font-weight:700; color:var(--text)">${pr.weight} × ${pr.reps}</div>
          <div class="sub">e1RM ≈ ${pr.e1rm.toFixed(1)} кг</div>
        </div>
      </div>
    `).join("") : `<div class="empty">Сделайте первую тренировку 💪</div>`}
  `;
}

function findLastPerformance(name, excludeSessionId) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.id === excludeSessionId) continue;
    if (!s.completed) continue;
    const ex = s.exercises.find(e => e.name === name);
    if (ex) {
      const sets = ex.sets.filter(x => x.done);
      if (sets.length) {
        return sets.map(x => `${x.weight}×${x.reps}`).join(", ");
      }
    }
  }
  return null;
}

// ====== BODY WEIGHT ======
function renderBody(app) {
  const list = [...state.bodyWeights].sort((a,b)=>b.date.localeCompare(a.date));
  app.innerHTML = `
    <header class="top">
      <h1>Вес тела</h1>
      <button class="btn sm primary" onclick="openBodyWeightModal()">+ Записать</button>
    </header>
    ${list.length ? list.map((bw, i) => `
      <div class="list-item">
        <div>
          <div class="title">${bw.weight} кг</div>
          <div class="sub">${fmtDate(bw.date)}</div>
        </div>
        <button class="btn sm ghost" onclick="deleteBW('${bw.date}')" style="color:var(--danger)">✕</button>
      </div>
    `).join("") : `<div class="empty">Записей пока нет</div>`}
  `;
}
function openBodyWeightModal() {
  const bg = $("#modalBg");
  bg.innerHTML = `
    <div class="modal">
      <div class="handle"></div>
      <h2>Записать вес тела</h2>
      <div class="stack" style="margin-top:16px">
        <input type="number" id="bwInput" step="0.1" inputmode="decimal" placeholder="75.5 кг" autofocus>
        <button class="btn primary block" onclick="saveBW()">Сохранить</button>
        <button class="btn ghost block" onclick="closeModal()">Отмена</button>
      </div>
    </div>
  `;
  bg.classList.add("open");
  setTimeout(() => $("#bwInput")?.focus(), 50);
}
function saveBW() {
  const v = parseFloat($("#bwInput").value);
  if (!v || v < 20 || v > 400) { toast("Введите корректный вес"); return; }
  const today = new Date().toISOString().slice(0,10);
  state.bodyWeights = state.bodyWeights.filter(b => b.date.slice(0,10) !== today);
  state.bodyWeights.push({ date: new Date().toISOString(), weight: v });
  save();
  closeModal();
  toast("Сохранено");
  route();
}
function deleteBW(date) {
  state.bodyWeights = state.bodyWeights.filter(b => b.date !== date);
  save();
  route();
}
function closeModal() {
  $("#modalBg").classList.remove("open");
  $("#modalBg").innerHTML = "";
}

// ====== PROGRAM OVERVIEW ======
function renderProgram(app) {
  app.innerHTML = `
    <header class="top">
      <button class="btn sm ghost" onclick="location.hash='home'">← Назад</button>
      <h1>Программа</h1>
      <div></div>
    </header>
    <div class="small muted" style="margin-bottom:16px">
      14 тренировок по кругу. Текущая следующая: <b>День ${state.nextDayIndex + 1}</b>
    </div>
    ${PROGRAM.map((d, i) => `
      <div class="card" style="${i === state.nextDayIndex ? 'border-color:var(--accent)' : ''}">
        <div class="row between">
          <div style="font-weight:700">${esc(d.name)}</div>
          ${i === state.nextDayIndex ? '<span class="pill" style="color:var(--accent-2); border-color:var(--accent)">Следующая</span>' : ''}
        </div>
        <div class="small muted" style="margin-bottom:8px">${esc(d.block)}</div>
        ${d.exercises.map((e, k) => `
          <div class="small" style="padding:4px 0">
            <span class="muted">${k+1}.</span> ${esc(e.name)}
            <span class="muted">— ${esc(e.scheme)}</span>
          </div>
        `).join("")}
        <button class="btn sm ghost" style="margin-top:10px" onclick="jumpToDay(${i})">Установить как следующую</button>
      </div>
    `).join("")}

    <h3>Данные</h3>
    <button class="btn sm" onclick="exportData()">Экспорт JSON</button>
    <button class="btn sm" onclick="importData()" style="margin-left:8px">Импорт</button>
    <button class="btn sm danger" onclick="resetAll()" style="margin-left:8px">Сбросить всё</button>
  `;
}
function jumpToDay(i) {
  if (!confirm(`Установить "День ${i+1}" как следующую тренировку?`)) return;
  state.nextDayIndex = i;
  save();
  toast("Установлено");
  route();
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `gymtracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
function importData() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.onchange = () => {
    const f = input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!confirm("Заменить текущие данные импортированными?")) return;
        state = { ...DEFAULT_STATE, ...d };
        save(); route(); toast("Импортировано");
      } catch { toast("Не удалось прочитать файл"); }
    };
    r.readAsText(f);
  };
  input.click();
}
function resetAll() {
  if (!confirm("Удалить ВСЕ данные: историю, веса, прогресс программы?")) return;
  if (!confirm("Это точно? Действие необратимо.")) return;
  state = structuredClone(DEFAULT_STATE);
  save(); route(); toast("Сброшено");
}

// ====== EXPOSE ======
Object.assign(window, {
  startWorkout, cancelActive, toggleExercise, updateSet, logSet, unlogSet,
  toggleExerciseDone, finishWorkout, addRest, skipRest,
  openBodyWeightModal, saveBW, deleteBW, closeModal,
  deleteSession, jumpToDay, exportData, importData, resetAll,
});

// ====== BOOT ======
route();

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
