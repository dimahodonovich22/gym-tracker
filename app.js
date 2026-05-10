// ====== STATE ======
const STORAGE_KEY = "gymtracker.v1";
const DEFAULT_STATE = {
  nextDayIndex: 0,
  sessions: [],
  activeSessionId: null,
  bodyWeights: [],
  settings: { unit: "kg" },
};
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch { return structuredClone(DEFAULT_STATE); }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// ====== UTIL ======
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const fmtDate = iso => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
const fmtDateTime = iso => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" }) + ", " +
  new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}
function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay() || 7;
  if (day !== 1) x.setHours(-24 * (day - 1));
  x.setHours(0, 0, 0, 0);
  return x;
}

// ====== SCHEME HELPERS ======
function isCardio(ex) {
  if (!ex) return false;
  if (/кардио/i.test(ex.name)) return true;
  return /^\s*\d+(-\d+)?\s*мин\s*$/i.test(ex.scheme || "");
}
function hasDropset(ex) { return /дропсет/i.test(ex?.scheme || ""); }
function expectedSetsCount(ex) {
  const m = (ex?.scheme || "").match(/^\s*(\d+)\s*[×x]/);
  return m ? parseInt(m[1]) : null;
}
function pyramidReps(ex) {
  const m = (ex?.scheme || "").match(/^\s*(\d+)\s*[×x]\s*(\d+(?:-\d+)+)/);
  if (!m) return null;
  const parts = m[2].split("-").map(Number);
  if (parts.length === parseInt(m[1]) && parts.length >= 3) return parts;
  return null;
}
function repsHintForSet(ex, setIdx) {
  const p = pyramidReps(ex);
  if (p) return p[setIdx] != null ? String(p[setIdx]) : null;
  const m = (ex?.scheme || "").match(/^\s*\d+\s*[×x]\s*(.+)$/);
  if (!m) return null;
  return m[1].trim();
}

// ====== LAST-SESSION HINTS ======
function lastSessionSet(exName, setIdx) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (!s.completed || s.id === state.activeSessionId) continue;
    const ex = s.exercises.find(e => e.name === exName);
    if (!ex) continue;
    const working = (ex.sets || []).filter(x => x.done && x.type !== "warmup");
    if (working[setIdx]) return working[setIdx];
  }
  return null;
}
function findLastPerformance(name, excludeSessionId) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const s = state.sessions[i];
    if (s.id === excludeSessionId || !s.completed) continue;
    const ex = s.exercises.find(e => e.name === name);
    if (ex) {
      const sets = (ex.sets || []).filter(x => x.done && x.type !== "warmup");
      if (sets.length) return { date: s.startedAt, sets };
    }
    if (ex && isCardio(ex) && ex.cardio) return { date: s.startedAt, cardio: ex.cardio };
  }
  return null;
}

// ====== ROUTER ======
function route() {
  const hash = location.hash.slice(1) || "home";
  const [name, ...rest] = hash.split("/");
  const param = decodeURIComponent(rest.join("/"));
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
    exercise: () => renderExerciseHistory(param),
  }[name] || renderHome)(app);
  $$("nav.bottom a").forEach(a => {
    a.classList.toggle("active", a.dataset.route === name ||
      (name === "workout" && a.dataset.route === "home") ||
      (name === "session" && a.dataset.route === "history") ||
      (name === "exercise" && a.dataset.route === "prs"));
  });
  window.scrollTo(0, 0);
  updateRestBar();
}
window.addEventListener("hashchange", route);

// ====== HOME ======
function renderHome(app) {
  const day = PROGRAM[state.nextDayIndex];
  const active = state.sessions.find(s => s.id === state.activeSessionId && !s.completed);
  const recent = state.sessions.filter(s => s.completed).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0, 3);
  const lastBW = state.bodyWeights.length ? state.bodyWeights[state.bodyWeights.length - 1] : null;

  // Weekly dashboard
  const mon = mondayOf(new Date());
  const weekSessions = state.sessions.filter(s => s.completed && new Date(s.startedAt) >= mon);
  const weekVolume = weekSessions.reduce((v, s) => v + sessionVolume(s), 0);
  const weekSets = weekSessions.reduce((n, s) => n + countSets(s), 0);

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
        <div class="pill">Активная тренировка</div>
        <h2 style="margin-top:6px; margin-bottom:0">${esc(active.dayName)}</h2>
        <div class="small muted">Начата ${fmtDateTime(active.startedAt)}</div>
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

    <div class="week-grid">
      <div class="stat">
        <div class="stat-v">${weekSessions.length}</div>
        <div class="stat-l">тренировок</div>
      </div>
      <div class="stat">
        <div class="stat-v">${weekSets}</div>
        <div class="stat-l">подходов</div>
      </div>
      <div class="stat">
        <div class="stat-v">${weekVolume > 999 ? (weekVolume/1000).toFixed(1)+"т" : weekVolume}</div>
        <div class="stat-l">тоннаж</div>
      </div>
    </div>
    <div class="small muted" style="text-align:center; margin-top:-4px; margin-bottom:16px">на этой неделе</div>

    <div class="card">
      <div class="row between">
        <div>
          <div class="small muted">Вес тела</div>
          <div style="font-size:22px; font-weight:700">${lastBW ? lastBW.weight + " кг" : "—"}</div>
          ${lastBW ? `<div class="small muted">${fmtDate(lastBW.date)}</div>` : ""}
        </div>
        <button class="btn sm" onclick="openBodyWeightModal()">${icon("plus",14)} Записать</button>
      </div>
    </div>

    <h3>Недавние тренировки</h3>
    ${recent.length ? recent.map(s => `
      <div class="list-item" onclick="location.hash='session/${s.id}'">
        <div>
          <div class="title">${esc(s.dayName)}</div>
          <div class="sub">${fmtDateTime(s.startedAt)} · ${countSets(s)} подходов</div>
        </div>
        <div class="right">${icon("chevronRight",18)}</div>
      </div>
    `).join("") : `<div class="empty">Пока нет завершённых тренировок</div>`}
  `;
}

function countSets(session) {
  return session.exercises.reduce((n, e) => n + (e.sets?.filter(s => s.done).length || 0), 0);
}
function sessionVolume(session) {
  let v = 0;
  for (const e of session.exercises) {
    for (const set of (e.sets || [])) {
      if (!set.done || set.type === "warmup") continue;
      v += (Number(set.weight) || 0) * (Number(set.reps) || 0);
      for (const d of (set.drops || [])) v += (Number(d.weight) || 0) * (Number(d.reps) || 0);
    }
  }
  return Math.round(v);
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
      sets: [],
      cardio: isCardio(e) ? { duration: "", type: "", hr: "" } : null,
      notes: "",
      done: false,
    })),
  };
  state.sessions.push(session);
  state.activeSessionId = session.id;
  save();
  location.hash = "workout";
  requestWakeLock();
}
function cancelActive() {
  if (!confirm("Отменить текущую тренировку? Данные будут удалены.")) return;
  state.sessions = state.sessions.filter(s => s.id !== state.activeSessionId);
  state.activeSessionId = null;
  save();
  releaseWakeLock();
  stopRest();
  stopSilentLoop();
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
      <button class="btn sm ghost" onclick="location.hash='home'">${icon("arrowLeft",16)} Назад</button>
      <button class="btn sm" onclick="finishWorkout()">Завершить</button>
    </header>
    <h1>${esc(s.dayName)}</h1>
    <div class="small muted">${esc(s.block)}</div>
    <div class="pill" style="margin-top:8px">${icon("calendar", 13)} ${fmtDateTime(s.startedAt)}</div>
    <div class="progress" style="margin-top:10px"><div style="width:${pct}%"></div></div>
    <div class="small muted" style="margin-top:6px">${doneEx} / ${s.exercises.length} упражнений</div>

    <div style="margin-top:20px">
      ${s.exercises.map((e, i) => renderExerciseCard(e, i, s)).join("")}
    </div>

    <button class="btn primary block" style="margin-top:20px" onclick="finishWorkout()">Завершить тренировку</button>
  `;
}

function setsDoneCount(ex) {
  if (isCardio(ex)) return ex.cardio?.duration ? 1 : 0;
  return (ex.sets || []).filter(x => x.done && x.type !== "warmup").length;
}

function renderExerciseCard(e, i, s) {
  const open = e._open;
  const last = findLastPerformance(e.name, s.id);
  const expectedSets = expectedSetsCount(e);
  const doneCount = setsDoneCount(e);
  const progressBadge = isCardio(e)
    ? (e.cardio?.duration ? `<span class="pill done">${icon("check",12)}</span>` : "")
    : (expectedSets ? `<span class="pill ${doneCount >= expectedSets ? "done" : ""}">${doneCount}/${expectedSets}</span>` : (doneCount ? `<span class="pill done">${doneCount}</span>` : ""));

  return `
    <div class="exercise ${e.done ? "done" : ""} ${open ? "open" : ""}" data-idx="${i}">
      <div class="ex-header" onclick="toggleExercise(${i})">
        <div class="num">${e.done ? icon("check",16) : i+1}</div>
        <div class="ex-title">
          <div class="n">${esc(e.name)}</div>
          <div class="meta">
            ${e.warmup ? `<span class="pill warm">Разминка</span>` : ""}
            <span class="pill">${esc(e.scheme)}</span>
            <span class="pill">Отдых: ${esc(e.rest)}</span>
            ${e.rir && e.rir !== "—" ? `<span class="pill rir">ЗДО ${esc(e.rir)}</span>` : ""}
            ${progressBadge}
          </div>
        </div>
        <div style="color:var(--muted)">${open ? icon("chevronDown",18) : icon("chevronRight",18)}</div>
      </div>
      <div class="ex-body">
        <div class="row" style="gap:6px; flex-wrap:wrap; margin-bottom:10px">
          ${e.video ? `<a href="${esc(e.video)}" target="_blank" rel="noopener" class="btn sm ghost">${icon("play",16)} Техника</a>` : ""}
          <button class="btn sm ghost" onclick="openReplaceModal(${i})">${icon("swap",16)} Заменить</button>
          <button class="btn sm ghost" onclick="location.hash='exercise/'+encodeURIComponent(${JSON.stringify(e.name)})">${icon("trending",16)} История</button>
        </div>
        ${last ? `<div class="small muted" style="margin-bottom:8px">Прошлая (${fmtDate(last.date)}): ${last.cardio
          ? (last.cardio.duration + " мин" + (last.cardio.type ? " · " + esc(last.cardio.type) : ""))
          : last.sets.map(x => `${x.weight}×${x.reps}`).join(", ")}</div>` : ""}

        ${isCardio(e) ? renderCardioBody(e, i) : renderSetsBody(e, i)}

        <textarea class="notes" placeholder="Заметки к упражнению…" onblur="updateNotes(${i}, this.value)">${esc(e.notes || "")}</textarea>

        <div class="ex-actions">
          ${e.done
            ? `<button class="btn sm" onclick="toggleExerciseDone(${i})">${icon("undo",16)} Отменить готово</button>`
            : `<button class="btn sm" onclick="toggleExerciseDone(${i})">${icon("check",16)} Готово</button>`}
        </div>
      </div>
    </div>
  `;
}

function renderSetsBody(e, i) {
  const pyr = pyramidReps(e);
  const hintBase = pyr ? null : repsHintForSet(e, 0);
  const expectedWorking = expectedSetsCount(e) || 1;
  const expectedRows = expectedWorking + (e.warmup ? 1 : 0);
  // Ensure at least expected rows exist visually (display placeholders)
  const rows = [];
  const actualSets = e.sets.slice();
  const showCount = Math.max(actualSets.length, expectedRows, actualSets.length && actualSets[actualSets.length-1].done ? actualSets.length + 1 : 1);
  for (let si = 0; si < showCount; si++) {
    rows.push(setRow(i, si, actualSets[si] || null, e));
  }
  return `
    <div class="col-labels"><div>#</div><div>Вес (кг)</div><div>Повторы</div><div></div></div>
    ${rows.join("")}
    ${hasDropset(e) && !e.sets.some(x => x.type === "dropset") ? `
      <button class="btn sm ghost" style="margin-top:6px; color:var(--warn)" onclick="addDropsetSet(${i})">${icon("plus",14)} Добавить дропсет</button>
    ` : ""}
  `;
}

function setRow(exIdx, setIdx, set, ex) {
  const s = set || { weight: "", reps: "", done: false, type: defaultSetType(ex, setIdx) };
  const isWarmup = s.type === "warmup";
  const isDrop = s.type === "dropset";
  // Working-set index (exclude warmup) for ghost placeholder + pyramid reps hint
  let workingIdx = 0;
  for (let k = 0; k < setIdx; k++) {
    const t = ex.sets[k]?.type || defaultSetType(ex, k);
    if (t !== "warmup") workingIdx++;
  }
  const ghost = isWarmup ? null : lastSessionSet(ex.name, workingIdx);
  const wPh = ghost?.weight != null && ghost.weight !== "" ? String(ghost.weight) : "0";
  const rPh = ghost?.reps != null && ghost.reps !== "" ? String(ghost.reps) : (repsHintForSet(ex, workingIdx) || "0");
  const label = isWarmup ? "Р" : (isDrop ? "D" : setIdx + 1);

  return `
    <div class="set-row ${s.done ? "logged" : ""} ${isWarmup ? "warmup" : ""} ${isDrop ? "dropset-row" : ""}" data-ex="${exIdx}" data-si="${setIdx}">
      <div class="idx ${isWarmup ? "warmup-idx" : ""} ${isDrop ? "drop-idx" : ""}" onclick="toggleSetType(${exIdx},${setIdx})" title="Переключить тип">${label}</div>
      <input type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(wPh)}" value="${s.weight ?? ""}" onchange="updateSet(${exIdx},${setIdx},'weight',this.value)">
      <input type="text" inputmode="numeric" autocomplete="off" placeholder="${esc(rPh)}" value="${s.reps ?? ""}" onchange="updateSet(${exIdx},${setIdx},'reps',this.value)" onblur="maybeAutoLog(${exIdx},${setIdx})" onkeydown="if(event.key==='Enter'){this.blur();}">
      <div class="del" onclick="${s.done ? `unlogSet(${exIdx},${setIdx})` : `logSet(${exIdx},${setIdx})`}">${s.done ? icon("undo",16) : icon("check",16)}</div>
      ${isDrop && s.drops ? renderDrops(exIdx, setIdx, s.drops) : ""}
      ${isDrop ? `<button class="btn sm ghost drop-add" onclick="addDrop(${exIdx},${setIdx})">+ drop</button>` : ""}
    </div>
  `;
}

function renderDrops(ei, si, drops) {
  return drops.map((d, di) => `
    <div class="drop-row">
      <div class="idx drop-idx">d${di+1}</div>
      <input type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${d.weight ?? ""}" onchange="updateDrop(${ei},${si},${di},'weight',this.value)">
      <input type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="${d.reps ?? ""}" onchange="updateDrop(${ei},${si},${di},'reps',this.value)">
      <div class="del" onclick="removeDrop(${ei},${si},${di})">${icon("x",14)}</div>
    </div>
  `).join("");
}

function renderCardioBody(e, i) {
  const c = e.cardio || { duration: "", type: "", hr: "" };
  return `
    <div class="cardio-box">
      <label>Длительность (мин)</label>
      <input type="number" inputmode="numeric" placeholder="${esc(e.scheme)}" value="${c.duration ?? ""}" onchange="updateCardio(${i},'duration',this.value)">
      <label>Тип</label>
      <select onchange="updateCardio(${i},'type',this.value)">
        <option value="">— выбрать —</option>
        ${["Дорожка","Велотренажёр","Эллипсоид","Гребля","Ходьба","Степпер","Другое"].map(t =>
          `<option ${c.type===t?"selected":""}>${t}</option>`).join("")}
      </select>
      <label>Средний пульс (опц.)</label>
      <input type="number" inputmode="numeric" placeholder="140" value="${c.hr ?? ""}" onchange="updateCardio(${i},'hr',this.value)">
    </div>
  `;
}

function defaultSetType(ex, si) {
  if (ex && ex.warmup && si === 0) return "warmup";
  return "working";
}

function toggleExercise(i) {
  const s = currentSession();
  const wasOpen = s.exercises[i]._open;
  s.exercises.forEach(e => e._open = false);
  s.exercises[i]._open = !wasOpen;
  renderWorkout($("#app"));
}

function parseNum(value) {
  if (value === "" || value == null) return "";
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : "";
}
function updateSet(ei, si, field, value) {
  const s = currentSession();
  const ex = s.exercises[ei];
  while (ex.sets.length <= si) ex.sets.push({ weight: "", reps: "", done: false, type: defaultSetType(ex, ex.sets.length) });
  ex.sets[si][field] = parseNum(value);
  save();
}
function maybeAutoLog(ei, si) {
  const s = currentSession();
  const ex = s.exercises[ei];
  const set = ex.sets[si];
  if (!set || set.done) return;
  if (set.weight !== "" && set.weight != null && set.reps !== "" && set.reps != null) {
    // Autolog after short delay to allow user to tap ✓ manually if preferred
    setTimeout(() => {
      const cur = currentSession()?.exercises[ei]?.sets[si];
      if (cur && !cur.done && cur.weight !== "" && cur.reps !== "") logSet(ei, si);
    }, 150);
  }
}
function logSet(ei, si) {
  const s = currentSession();
  const ex = s.exercises[ei];
  while (ex.sets.length <= si) ex.sets.push({ weight: "", reps: "", done: false, type: defaultSetType(ex, ex.sets.length) });
  const set = ex.sets[si];
  if ((set.weight === "" || set.weight == null) && (set.reps === "" || set.reps == null)) {
    toast("Введите вес или повторы"); return;
  }
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
function toggleSetType(ei, si) {
  const s = currentSession();
  const ex = s.exercises[ei];
  while (ex.sets.length <= si) ex.sets.push({ weight: "", reps: "", done: false, type: "working" });
  const set = ex.sets[si];
  const order = ["working", "warmup", "dropset"];
  const idx = order.indexOf(set.type || "working");
  set.type = order[(idx + 1) % order.length];
  if (set.type === "dropset" && !set.drops) set.drops = [{ weight: "", reps: "" }];
  if (set.type !== "dropset") delete set.drops;
  ex._open = true;
  save();
  renderWorkout($("#app"));
}
function addDropsetSet(ei) {
  const s = currentSession();
  const ex = s.exercises[ei];
  ex.sets.push({ weight: "", reps: "", done: false, type: "dropset", drops: [{ weight: "", reps: "" }] });
  ex._open = true;
  save();
  renderWorkout($("#app"));
}
function addDrop(ei, si) {
  const s = currentSession();
  const set = s.exercises[ei].sets[si];
  if (!set.drops) set.drops = [];
  set.drops.push({ weight: "", reps: "" });
  s.exercises[ei]._open = true;
  save();
  renderWorkout($("#app"));
}
function updateDrop(ei, si, di, field, value) {
  const s = currentSession();
  const set = s.exercises[ei].sets[si];
  set.drops[di][field] = parseNum(value);
  save();
}
function removeDrop(ei, si, di) {
  const s = currentSession();
  const set = s.exercises[ei].sets[si];
  set.drops.splice(di, 1);
  if (!set.drops.length) delete set.drops;
  s.exercises[ei]._open = true;
  save();
  renderWorkout($("#app"));
}
function updateCardio(ei, field, value) {
  const s = currentSession();
  const ex = s.exercises[ei];
  if (!ex.cardio) ex.cardio = { duration: "", type: "", hr: "" };
  ex.cardio[field] = field === "type" ? value : parseNum(value);
  ex._open = true;
  save();
}
function updateNotes(ei, value) {
  const s = currentSession();
  s.exercises[ei].notes = value;
  save();
}
function toggleExerciseDone(i) {
  const s = currentSession();
  s.exercises[i].done = !s.exercises[i].done;
  if (s.exercises[i].done) s.exercises[i]._open = false;
  save();
  renderWorkout($("#app"));
}

// ====== REPLACE EXERCISE ======
function openReplaceModal(exIdx) {
  const s = currentSession();
  const cur = s.exercises[exIdx];
  const curInfo = MUSCLES[cur.name] || { primary: null, group: null };

  const tier = (name) => {
    const info = MUSCLES[name];
    if (!info) return 3;
    if (curInfo.primary && info.primary === curInfo.primary) return 0;
    if (curInfo.group && info.group === curInfo.group) return 1;
    return 2;
  };

  const candidates = Object.keys(VIDEOS)
    .filter(n => n !== cur.name)
    .sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b, "ru");
    });

  const TIER_LABELS = ["— Та же мышца —", "— Та же группа —", "— Остальные —", "— Остальные —"];
  let html = "";
  let lastTier = -1;
  for (const name of candidates) {
    const t = tier(name);
    const headerTier = t === 3 ? 2 : t;
    if (headerTier !== lastTier) {
      html += `<div class="list-header small muted" data-tier="${headerTier}" style="padding:8px 4px 4px; font-weight:600">${TIER_LABELS[headerTier]}</div>`;
      lastTier = headerTier;
    }
    html += `
      <div class="list-item" onclick="doReplace(${exIdx}, ${JSON.stringify(name).replace(/"/g, '&quot;')})">
        <div><div class="title small">${esc(name)}</div></div>
        <div class="right">${icon("chevronRight",18)}</div>
      </div>
    `;
  }

  const bg = $("#modalBg");
  bg.innerHTML = `
    <div class="modal">
      <div class="handle"></div>
      <h2>Заменить упражнение</h2>
      <div class="small muted" style="margin-bottom:10px">Текущее: ${esc(cur.name)}</div>
      <input type="text" id="replaceSearch" placeholder="Поиск…" oninput="filterReplace()">
      <div id="replaceList" style="margin-top:10px; max-height:55vh; overflow-y:auto">
        ${html}
      </div>
      <button class="btn ghost block" style="margin-top:12px" onclick="closeModal()">Отмена</button>
    </div>
  `;
  bg.classList.add("open");
  setTimeout(() => $("#replaceSearch")?.focus(), 50);
  window._replaceExIdx = exIdx;
}
function filterReplace() {
  const q = $("#replaceSearch").value.trim().toLowerCase();
  const list = $("#replaceList");
  if (!list) return;
  const children = Array.from(list.children);
  // First pass: show/hide list items based on search
  children.forEach(el => {
    if (el.classList.contains("list-item")) {
      el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
    }
  });
  // Second pass: hide headers whose section has no visible items
  children.forEach((el, i) => {
    if (!el.classList.contains("list-header")) return;
    let hasVisible = false;
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (next.classList.contains("list-header")) break;
      if (next.classList.contains("list-item") && next.style.display !== "none") {
        hasVisible = true;
        break;
      }
    }
    el.style.display = hasVisible ? "" : "none";
  });
}
function doReplace(exIdx, newName) {
  const s = currentSession();
  const ex = s.exercises[exIdx];
  ex.name = newName;
  ex.video = VIDEOS[newName] || null;
  ex._open = true;
  save();
  closeModal();
  renderWorkout($("#app"));
  toast("Заменено");
}

// ====== FINISH ======
function finishWorkout() {
  const s = currentSession();
  if (!s) return;
  const anyLogged = s.exercises.some(e => (e.sets||[]).some(x => x.done) || (e.cardio && e.cardio.duration));
  if (!anyLogged && !confirm("Нет залогированных подходов. Всё равно завершить?")) return;

  // Detect new PRs BEFORE marking completed (comparing against history excluding this session)
  const newPRs = detectNewPRs(s);

  s.completed = true;
  s.completedAt = new Date().toISOString();
  s.exercises.forEach(e => delete e._open);
  state.activeSessionId = null;
  state.nextDayIndex = (s.dayIndex + 1) % PROGRAM.length;
  save();
  stopRest();
  releaseWakeLock();
  stopSilentLoop();

  if (newPRs.length) {
    fireConfetti();
    toast(`Новый рекорд: ${newPRs[0].name}!`);
  } else {
    toast("Тренировка сохранена");
  }
  location.hash = "home";
}

function detectNewPRs(session) {
  // For each exercise in session, find best e1RM in session and compare to best in history (all other sessions)
  const newPRs = [];
  const history = state.sessions.filter(s => s.completed && s.id !== session.id);
  for (const ex of session.exercises) {
    const sets = (ex.sets || []).filter(x => x.done && x.type !== "warmup" && x.weight && x.reps);
    if (!sets.length) continue;
    const bestNow = Math.max(...sets.map(s => s.weight * (1 + s.reps / 30)));
    let bestHist = 0;
    for (const h of history) {
      const hex = h.exercises.find(e => e.name === ex.name);
      if (!hex) continue;
      for (const hs of (hex.sets || [])) {
        if (!hs.done || hs.type === "warmup" || !hs.weight || !hs.reps) continue;
        bestHist = Math.max(bestHist, hs.weight * (1 + hs.reps / 30));
      }
    }
    if (bestNow > bestHist + 0.1) newPRs.push({ name: ex.name, e1rm: bestNow });
  }
  return newPRs;
}

// ====== WAKE LOCK ======
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {});
    }
  } catch {}
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.activeSessionId) requestWakeLock();
});

// ====== REST TIMER + AUDIO ======
let restInterval = null;
let restEnd = null;
let restFor = "";
let audioCtx = null;
let silentAudio = null;

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
  // Start silent looped audio to keep iOS audio session alive when screen locks
  if (!silentAudio) {
    silentAudio = $("#silentAudio");
    if (silentAudio) {
      silentAudio.volume = 0.01;
      silentAudio.loop = true;
      silentAudio.play().catch(()=>{});
    }
  }
}
function stopSilentLoop() {
  if (silentAudio) { try { silentAudio.pause(); } catch {} }
}

function startRest(seconds, label) {
  ensureAudio();
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
    try { navigator.vibrate?.([300,120,300]); } catch {}
    playBeep();
    toast("Отдых окончен");
  }
}
function addRest(s) { if (restEnd) restEnd += s * 1000; updateRestBar(); }
function skipRest() { stopRest(); }
function playBeep() {
  try {
    const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.3;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.start(t0); o.stop(t0 + 0.25);
    }
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
          <div class="sub">${fmtDateTime(s.startedAt)} · ${countSets(s)} подх. · ${sessionVolume(s)} кг</div>
        </div>
        <div class="right">${icon("chevronRight",18)}</div>
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
      <button class="btn sm ghost" onclick="location.hash='history'">${icon("arrowLeft",16)} Назад</button>
      <button class="btn sm danger" onclick="deleteSession('${s.id}')">Удалить</button>
    </header>
    <h1>${esc(s.dayName)}</h1>
    <div class="small muted">${fmtDateTime(s.startedAt)} · ${esc(s.block)}</div>
    <div class="small muted">${countSets(s)} подходов · ${sessionVolume(s)} кг суммарно</div>

    <div style="margin-top:20px">
      ${s.exercises.map((e, i) => `
        <div class="card" onclick="location.hash='exercise/'+encodeURIComponent(${JSON.stringify(e.name)})" style="cursor:pointer">
          <div class="row between">
            <div style="flex:1">
              <div style="font-weight:600">${i+1}. ${esc(e.name)}</div>
              <div class="small muted">${esc(e.scheme)}${e.rir && e.rir !== "—" ? " · ЗДО " + esc(e.rir) : ""}</div>
            </div>
          </div>
          ${isCardio(e) && e.cardio ? `
            <div class="small" style="margin-top:8px">
              ${e.cardio.duration ? e.cardio.duration + " мин" : "—"}
              ${e.cardio.type ? " · " + esc(e.cardio.type) : ""}
              ${e.cardio.hr ? " · пульс " + e.cardio.hr : ""}
            </div>
          ` : (e.sets.filter(x=>x.done).length ? `
            <div style="margin-top:10px">
              ${e.sets.filter(x=>x.done).map((x, si) => `
                <div class="small" style="padding:4px 0; border-bottom:1px solid var(--line)">
                  <span class="muted">${x.type === "warmup" ? "Р" : (x.type === "dropset" ? "D" : si+1)}.</span>
                  ${x.weight || 0} кг × ${x.reps || 0}
                  ${x.drops ? " → " + x.drops.map(d => `${d.weight}×${d.reps}`).join(" → ") : ""}
                </div>
              `).join("")}
            </div>
          ` : `<div class="small muted" style="margin-top:6px">Нет залогированных подходов</div>`)}
          ${e.notes ? `<div class="small muted" style="margin-top:8px; font-style:italic">${icon("note",13)} ${esc(e.notes)}</div>` : ""}
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
  const prs = {};
  for (const s of state.sessions.filter(x=>x.completed)) {
    for (const e of s.exercises) {
      for (const set of (e.sets || [])) {
        if (!set.done || set.type === "warmup" || !set.weight || !set.reps) continue;
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
      <div class="list-item" onclick="location.hash='exercise/'+encodeURIComponent(${JSON.stringify(name)})">
        <div>
          <div class="title">${esc(name)}</div>
          <div class="sub">${fmtDate(pr.date)}</div>
        </div>
        <div class="right">
          <div style="font-weight:700; color:var(--text)">${pr.weight} × ${pr.reps}</div>
          <div class="sub">e1RM ≈ ${pr.e1rm.toFixed(1)} кг</div>
        </div>
      </div>
    `).join("") : `<div class="empty">Сделайте первую тренировку</div>`}
  `;
}

// ====== EXERCISE HISTORY ======
function renderExerciseHistory(name) {
  const app = $("#app");
  // Find all sessions with this exercise
  const entries = [];
  for (const s of state.sessions.filter(x => x.completed).sort((a,b)=>a.startedAt.localeCompare(b.startedAt))) {
    const ex = s.exercises.find(e => e.name === name);
    if (!ex) continue;
    const sets = (ex.sets || []).filter(x => x.done && x.type !== "warmup" && x.weight && x.reps);
    if (!sets.length && !ex.cardio?.duration) continue;
    const bestE1rm = sets.length ? Math.max(...sets.map(x => x.weight * (1 + x.reps / 30))) : 0;
    const bestSet = sets.length ? sets.reduce((a,b) => (b.weight * (1 + b.reps/30) > a.weight * (1 + a.reps/30) ? b : a)) : null;
    entries.push({ date: s.startedAt, sessionId: s.id, sets, cardio: ex.cardio, bestE1rm, bestSet, scheme: ex.scheme });
  }

  app.innerHTML = `
    <header class="top">
      <button class="btn sm ghost" onclick="history.back()">${icon("arrowLeft",16)} Назад</button>
    </header>
    <h1 style="font-size:20px">${esc(name)}</h1>
    <div class="small muted" style="margin-bottom:14px">${entries.length} тренировок в истории</div>

    ${entries.length ? `
      ${renderChart(entries)}
      <h3>Все тренировки</h3>
      ${entries.slice().reverse().map(e => `
        <div class="card" onclick="location.hash='session/${e.sessionId}'" style="cursor:pointer">
          <div class="row between">
            <div style="font-weight:600">${fmtDate(e.date)}</div>
            ${e.bestSet ? `<div class="small muted">Лучший: ${e.bestSet.weight}×${e.bestSet.reps} (e1RM ${e.bestE1rm.toFixed(1)})</div>` : ""}
          </div>
          <div class="small" style="margin-top:6px">
            ${e.cardio?.duration
              ? (e.cardio.duration + " мин" + (e.cardio.type ? " · " + esc(e.cardio.type) : ""))
              : e.sets.map(x => `${x.weight}×${x.reps}`).join(", ")}
          </div>
        </div>
      `).join("")}
    ` : `<div class="empty">Нет данных по этому упражнению</div>`}
  `;
}

function renderChart(entries) {
  const pts = entries.filter(e => e.bestE1rm).map(e => ({ x: new Date(e.date).getTime(), y: e.bestE1rm }));
  if (pts.length < 2) return "";
  const w = 320, h = 120, pad = 20;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const nx = v => pad + (v - xMin) / (xMax - xMin || 1) * (w - 2*pad);
  const ny = v => h - pad - (v - yMin) / (yMax - yMin || 1) * (h - 2*pad);
  const path = pts.map((p,i) => (i?"L":"M") + nx(p.x).toFixed(1) + "," + ny(p.y).toFixed(1)).join(" ");
  const dots = pts.map(p => `<circle cx="${nx(p.x).toFixed(1)}" cy="${ny(p.y).toFixed(1)}" r="3" fill="#ff8a5c"/>`).join("");
  return `
    <div class="card">
      <div class="small muted" style="margin-bottom:6px">Прогресс по e1RM (кг)</div>
      <svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">
        <path d="${path}" fill="none" stroke="#ff6a3d" stroke-width="2"/>
        ${dots}
        <text x="${pad}" y="${h-4}" fill="#8b93a1" font-size="10">${fmtDate(new Date(xMin).toISOString())}</text>
        <text x="${w-pad}" y="${h-4}" text-anchor="end" fill="#8b93a1" font-size="10">${fmtDate(new Date(xMax).toISOString())}</text>
        <text x="${pad}" y="${pad-4}" fill="#8b93a1" font-size="10">max ${yMax.toFixed(1)}</text>
      </svg>
    </div>
  `;
}

// ====== BODY WEIGHT ======
function renderBody(app) {
  const list = [...state.bodyWeights].sort((a,b)=>b.date.localeCompare(a.date));
  app.innerHTML = `
    <header class="top">
      <h1>Вес тела</h1>
      <button class="btn sm primary" onclick="openBodyWeightModal()">${icon("plus",14)} Записать</button>
    </header>
    ${list.length >= 2 ? renderBodyChart(list.slice().reverse()) : ""}
    ${list.length ? list.map(bw => `
      <div class="list-item">
        <div>
          <div class="title">${bw.weight} кг</div>
          <div class="sub">${fmtDate(bw.date)}</div>
        </div>
        <button class="btn sm ghost" onclick="deleteBW('${bw.date}')" style="color:var(--danger)">${icon("x",16)}</button>
      </div>
    `).join("") : `<div class="empty">Записей пока нет</div>`}
  `;
}
function renderBodyChart(list) {
  const pts = list.map(x => ({ x: new Date(x.date).getTime(), y: x.weight }));
  const w = 320, h = 120, pad = 20;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const nx = v => pad + (v - xMin) / (xMax - xMin || 1) * (w - 2*pad);
  const ny = v => h - pad - (v - yMin) / (yMax - yMin || 1) * (h - 2*pad);
  const path = pts.map((p,i) => (i?"L":"M") + nx(p.x).toFixed(1) + "," + ny(p.y).toFixed(1)).join(" ");
  return `
    <div class="card">
      <div class="small muted" style="margin-bottom:6px">График веса (кг)</div>
      <svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">
        <path d="${path}" fill="none" stroke="#ff6a3d" stroke-width="2"/>
        <text x="${pad}" y="${pad-4}" fill="#8b93a1" font-size="10">${yMax.toFixed(1)}</text>
        <text x="${pad}" y="${h-4}" fill="#8b93a1" font-size="10">${yMin.toFixed(1)}</text>
      </svg>
    </div>
  `;
}
function openBodyWeightModal() {
  const bg = $("#modalBg");
  bg.innerHTML = `
    <div class="modal">
      <div class="handle"></div>
      <h2>Записать вес тела</h2>
      <div class="stack" style="margin-top:16px">
        <input type="text" id="bwInput" inputmode="decimal" autocomplete="off" placeholder="75,5 кг" autofocus>
        <button class="btn primary block" onclick="saveBW()">Сохранить</button>
        <button class="btn ghost block" onclick="closeModal()">Отмена</button>
      </div>
    </div>
  `;
  bg.classList.add("open");
  setTimeout(() => $("#bwInput")?.focus(), 50);
}
function saveBW() {
  const raw = $("#bwInput").value;
  const v = parseFloat(String(raw).replace(",", "."));
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

// ====== PROGRAM ======
function renderProgram(app) {
  app.innerHTML = `
    <header class="top">
      <button class="btn sm ghost" onclick="location.hash='home'">${icon("arrowLeft",16)} Назад</button>
      <h1>Программа</h1>
      <div></div>
    </header>
    <div class="small muted" style="margin-bottom:16px">14 тренировок по кругу. Следующая: <b>День ${state.nextDayIndex + 1}</b></div>
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
    <button class="btn sm danger" onclick="resetAll()" style="margin-left:8px">Сбросить</button>
  `;
}
function jumpToDay(i) {
  if (!confirm(`Установить "День ${i+1}" как следующую?`)) return;
  state.nextDayIndex = i;
  save(); toast("Установлено"); route();
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
  if (!confirm("Удалить ВСЕ данные?")) return;
  if (!confirm("Точно? Действие необратимо.")) return;
  state = structuredClone(DEFAULT_STATE);
  save(); route(); toast("Сброшено");
}

// ====== CONFETTI ======
function fireConfetti() {
  const canvas = $("#confetti");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ["#ff6a3d","#ff8a5c","#3ecf8e","#f5a524","#ffffff"];
  const pieces = Array.from({length: 140}, () => ({
    x: innerWidth/2, y: innerHeight*0.35,
    vx: (Math.random()-0.5)*12, vy: Math.random()*-12 - 4,
    g: 0.35 + Math.random()*0.15,
    size: 4 + Math.random()*6,
    rot: Math.random()*Math.PI, vr: (Math.random()-0.5)*0.3,
    color: colors[Math.floor(Math.random()*colors.length)],
    life: 100 + Math.random()*60,
  }));
  canvas.style.display = "block";
  let frame = 0;
  function step() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive = false;
    for (const p of pieces) {
      if (p.life <= 0) continue;
      alive = true;
      p.life--; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size*0.6);
      ctx.restore();
    }
    frame++;
    if (alive && frame < 200) requestAnimationFrame(step);
    else { ctx.clearRect(0,0,canvas.width,canvas.height); canvas.style.display = "none"; }
  }
  step();
}

// ====== EXPOSE ======
Object.assign(window, {
  startWorkout, cancelActive, toggleExercise, updateSet, logSet, unlogSet,
  toggleSetType, toggleExerciseDone, finishWorkout, addRest, skipRest,
  maybeAutoLog, addDropsetSet, addDrop, updateDrop, removeDrop, updateCardio,
  updateNotes, openReplaceModal, filterReplace, doReplace,
  openBodyWeightModal, saveBW, deleteBW, closeModal,
  deleteSession, jumpToDay, exportData, importData, resetAll,
});

// Hydrate nav icons
$$("nav.bottom a[data-ico]").forEach(a => {
  const span = a.querySelector(".ico");
  if (span) span.innerHTML = icon(a.dataset.ico, 22);
});

// ====== BOOT ======
route();
// If there's an active session, keep screen awake
if (state.activeSessionId) requestWakeLock();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) {
          toast("Обновление доступно. Перезагрузите приложение.");
        }
      });
    });
  }).catch(() => {});
}
