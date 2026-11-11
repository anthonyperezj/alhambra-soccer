const STORE_KEY = 'asl-mock-v8';
let state = loadState();
// Leagues added in Admin → Seasons are saved with the data and join DIVISIONS.
const DAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// The age in a youth division's name (U-9B → 9), for keeping youth divisions in age order.
const divAge = d => parseInt((String(d.name).match(/\d+/) || [0])[0], 10);
// Youth age groups: the built-in ones plus any added on the Seasons page (not separate youth leagues).
const isYouthAge = d => d.group === 'youth' && (!d.custom || d.ageGroup);
function addDivision(d) {
  if (!d.ageGroup) return DIVISIONS.push(d);
  let at = -1;
  DIVISIONS.forEach((x, i) => { if (isYouthAge(x) && divAge(x) <= divAge(d)) at = i; });
  if (at < 0) at = DIVISIONS.findIndex(isYouthAge) - 1;
  DIVISIONS.splice(at + 1, 0, d);
}
(state.leagues || []).forEach(addDivision);
queueMicrotask(() => { lastSaved = JSON.parse(JSON.stringify(state)); });
const customLeague = id => DIVISIONS.find(d => d.id === id && d.custom);
// Fields added or deleted in Admin → Fields. Closed fields stay listed but come off the schedule planner.
const BUILT_IN_FIELDS = { ...FIELDS };
applyFieldChanges();
function applyFieldChanges() {
  Object.keys(FIELDS).forEach(f => delete FIELDS[f]);
  Object.assign(FIELDS, BUILT_IN_FIELDS, state.addedFields || {});
  Object.keys(state.removedFields || {}).forEach(f => delete FIELDS[f]);
}
const isOpenField = f => !(state.fieldsClosed || {})[f];
const openFields = () => Object.keys(FIELDS).filter(isOpenField);
const ui = {
  div: DIVISIONS.some(d => d.id === readPref('asl-div')) ? readPref('asl-div') : '40', team: '', adminDiv: '40', adminFilter: 'needs', sheetTeam: readPref('asl-steam') || null,
  // the admin division picked last, brought back after a refresh (see keepAdminDiv)
  adminDivPref: readPref('asl-adiv'),
  boardDate: null, boardWeek: null, boardSection: 'youth', boardDays: {}, closedFields: new Set(), menuOpen: false, admin: readFlag('asl-admin'),
};

// ---------- storage ----------

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.matches) return resetOtherDivisions(addSeasons(moveFutsalFields(s)));
  } catch (e) {}
  return seedData();
}

// Saved data from before seasons existed: give every division its season name and an empty archive.
// Slots saved while "Other division…" was open kept the full list forever; back to the usual list.
function resetOtherDivisions(s) {
  Object.values(s.matchDays || {}).forEach(day => Object.values(day).forEach(sec =>
    Object.values(sec).forEach(rows => Array.isArray(rows) && rows.forEach(r => { delete r.allDivs; }))));
  return s;
}

function addSeasons(s) {
  s.seasons = s.seasons || {};
  DIVISIONS.forEach(d => { s.seasons[d.id] = s.seasons[d.id] || defaultSeason(d.id); });
  s.archive = s.archive || [];
  return s;
}

// Saved data from before futsal got its own fields: move those games and board slots over.
function moveFutsalFields(s) {
  const isFutsal = div => DIVISIONS.some(d => d.id === div && d.group === 'futsal');
  const moved = id => id.replace(/^el-sereno-park-field-(\d)$/, 'futsal-field-$1');
  const back = id => id.replace(/^futsal-field-(\d)$/, 'el-sereno-park-field-$1');
  s.matches.forEach(m => { m.field = isFutsal(m.div) ? moved(m.field) : back(m.field); });
  Object.entries(s.matchDays || {}).forEach(([date, day]) => {
    if (day.lengths) {
      s.gameLengths = s.gameLengths || {};
      s.gameLengths[date] = { ...(s.gameLengths[date] || {}), ...day.lengths };
      delete day.lengths;
    }
    if (day.futsal) day.futsal = Object.fromEntries(Object.entries(day.futsal).map(([f, rows]) => [moved(f), rows]));
  });
  return s;
}

function save() {
  recordChanges();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

// ---------- undo for anything in History ----------
// Every time the data is saved, what changed since the last save is attached to the History entry made
// for it (old and new values, path by path). Undo in History puts back the old values of just those
// paths, so later changes elsewhere are left alone. Lists of things with an id (games, players,
// schedule slots…) are matched by id. Counters, timestamps and History itself are not part of it.
const SKIP_KEYS = new Set(['log', 'updated', 'nextId', 'nextScorerId']);
let lastSaved = null;
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v !== null && typeof v === 'object';
const hasIds = list => list.length > 0 && list.every(x => isObj(x) && 'id' in x);

function diffState(a, b, path = [], out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b) && (hasIds(a) || hasIds(b)) && [...a, ...b].every(x => isObj(x) && 'id' in x)) {
    const inB = new Map(b.map(x => [x.id, x]));
    a.forEach((x, i) => {
      if (!inB.has(x.id)) out.push({ path: [...path, { id: x.id, i }], before: x });
      else diffState(x, inB.get(x.id), [...path, { id: x.id, i }], out);
    });
    const inA = new Set(a.map(x => x.id));
    b.forEach((x, i) => { if (!inA.has(x.id)) out.push({ path: [...path, { id: x.id, i }], after: x }); });
    return out;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => {
      if (!path.length && SKIP_KEYS.has(k)) return;
      diffState(a[k], b[k], [...path, k], out);
    });
    return out;
  }
  if (!sameJSON(a, b)) out.push({ path, before: a, after: b });
  return out;
}

// Every edit an admin makes shows in History, also small ones that have no message of their own (a goal
// typed in the Goleadores sheet, a player's name, a team picked on the planner…). Only saves right after
// the admin clicked or typed count, so updates the site makes by itself (opening a day on the planner) don't.
let lastUserAct = 0;
['pointerdown', 'keydown', 'change', 'input', 'submit'].forEach(ev => document.addEventListener(ev, () => { lastUserAct = Date.now(); }, true));
const AUTO_SKIP = new Set(['withdrawn', 'archivedTeams']);
function autoLogText(changes, prev, now) {
  const byId = (list, id) => (list || []).find(x => x.id === id);
  const out = new Map(); // one line per thing changed: key → text
  const add = (key, text) => { if (!out.has(key)) out.set(key, text); };
  // Planner slots that took a game's teams (a game booked or entered on another page) follow that game; the
  // game itself is what's described ("Game added", "Score…"), so those slots are left out.
  const rowKey = p => (isObj(p[4]) ? `${p[1]}|${p[2]}|${p[3]}|${p[4].id}` : '');
  const synced = new Set(changes.filter(c => c.path[0] === 'matchDays' && c.path[5] === 'mid').map(c => rowKey(c.path)));
  changes.forEach(c => {
    const [top, a, b, f, row, k] = c.path;
    if (AUTO_SKIP.has(top)) return;
    if (top === 'scorers' && isObj(a)) {
      const sc = byId(now.scorers, a.id) || byId(prev.scorers, a.id);
      if (!sc) return;
      const where = `${t('scorers')} · ${divName(sc.div)} · ${sc.team}`;
      if (!b) return add(`s${a.id}`, `${where}: ${c.after ? t('autoPlayerAdded') : t('autoPlayerRemoved')} ${sc.name}`);
      if (b === 'name') return add(`s${a.id}n`, `${where}: ${t('autoName')} “${c.before || ''}” → “${c.after || ''}”`);
      if (b === 'games' || b === 'goals') return add(`s${a.id}g`, `${where} · ${sc.name}: ${t('autoGoals')} ${byId(now.scorers, a.id)?.goals ?? 0}`);
      return add(`s${a.id}`, `${where} · ${sc.name}: ${t('autoEdited')}`);
    }
    if (top === 'matches' && isObj(a)) {
      const m = byId(now.matches, a.id) || byId(prev.matches, a.id);
      if (!m) return;
      const game = `${divName(m.div)} · ${fmtDate(m.date)}: ${m.home} ${t('vs')} ${m.away}`;
      if (!b) return add(`m${a.id}`, `${c.after ? t('autoGameAdded') : t('autoGameRemoved')} · ${game}`);
      if (b === 'hs' || b === 'as') return add(`m${a.id}s`, `${t('autoScore')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${m.home} ${m.hs ?? '–'}–${m.as ?? '–'} ${m.away}`);
      return add(`m${a.id}`, `${t('autoGameEdited')} · ${game}`);
    }
    if (top === 'matchDays') {
      // A day or field's empty time slots appearing is the site, not an edit.
      if (c.before === undefined && c.path.length <= 4) return;
      if (synced.has(rowKey(c.path)) || k === 'pinned' || k === 'mid') return;
      const r = isObj(row) && ((((now.matchDays || {})[a] || {})[b] || {})[f] || []).find(x => x.id === row.id);
      if (c.path.length === 5 && !(c.after || c.before || {}).home && !(c.after || c.before || {}).div) return;
      const place = `${t('scheduleBuilder')} · ${fmtDate(a)} · ${FIELDS[f] || f}`;
      // A slot that only has its division picked so far isn't a change yet; picking the teams is.
      if (r && !r.home && !r.away && c.before !== undefined && ['div', 'friendly', 'fdiv'].includes(k) && !c.before) return;
      if (r && ['home', 'away', 'div', 'friendly', 'fdiv'].includes(k)) {
        const who = r.home || r.away ? `${r.home || '—'} ${t('vs')} ${r.away || '—'}` : t('autoSlotCleared');
        return add(`d${a}${f}${row.id}`, `${place} · ${fromMin(r.t)}${r.friendly ? ` · ${t('friendly')}` : r.div ? ` · ${divName(r.div)}` : ''}: ${who}`);
      }
      if (k === 't') return add(`d${a}${f}t`, `${place}: ${t('autoTimes')}`);
      return;
    }
    if (top === 'teams' && a) {
      const was = (prev.teams || {})[a] || [], is = (now.teams || {})[a] || [];
      const plus = is.filter(x => !was.includes(x)), minus = was.filter(x => !is.includes(x));
      if (!plus.length && !minus.length) return;
      return add(`t${a}`, `${t('teams')} · ${divName(a)}: ${[...plus.map(x => `+ ${x}`), ...minus.map(x => `− ${x}`)].join(', ')}`);
    }
    const label = { rotation: t('rotation'), standingsHidden: t('hideFromStandings'), redCards: t('redCards'), gameLengths: t('gameLength'),
      fieldsClosed: t('fields'), offDays: t('daysOff'), seasons: t('seasons'), seasonGames: t('gamesInSeason'), settings: t('settings'),
      regButtons: t('regPageButtons'), regCards: t('regDivCards'), homePage: t('homePageNav'), ageChecks: t('ageChecks'), logos: t('teamLogos'), tableImage: t('tableImage'), scorerImage: `${t('tableImage')} · ${t('scorers')}`, tableImageByDiv: `${t('tableImage')} · ${t('standings')}`, scorerImageByDiv: `${t('tableImage')} · ${t('scorers')}`, scoresImageByDiv: `${t('tableImage')} · ${t('weeklyScores')}`, playoffs: t('playoffs'), copa: t('copa'), looseTimes: t('strictTimes'),
      strictTimes: t('strictTimes'), rotationOff: t('rotationAuto'), fieldsAdded: t('fields'), addedFields: t('fields'), leagues: t('seasons') }[top];
    if (!label) return;
    if (top === 'regButtons' && !a) {
      // The first edit makes the whole list at once: describe each group that differs.
      const was = prev.regButtons || {}, is = now.regButtons || {};
      Object.keys({ ...was, ...is }).filter(g => !sameJSON((was[g] || regDefaults(g)).map(b => [regLabel(b), b.url]), (is[g] || regDefaults(g)).map(b => [regLabel(b), b.url])))
        .forEach(g => add(`r${g}`, `${label} · ${g.startsWith('div:') ? divName(g.slice(4)) : t({ hero: 'regTitle', google: 'stepGoogle', contracts: 'stepParent', coaches: 'coaches' }[g] || 'register')}: ${(is[g] || []).map(b => regLabel(b) || '—').join(', ') || t('autoNoButtons')}`));
      if (Object.keys({ ...was, ...is }).length) return;
    }
    if (top === 'regButtons' && a) {
      const where = a.startsWith('div:') ? divName(a.slice(4)) : t({ hero: 'regTitle', google: 'stepGoogle', contracts: 'stepParent', coaches: 'coaches' }[a] || 'register');
      const list = ((now.regButtons || {})[a] || []).map(b => b.label || '—').join(', ');
      return add(`r${a}`, `${label} · ${where}: ${list || t('autoNoButtons')}`);
    }
    add(`x${top}${a || ''}`, `${label || top}${a && DIVISIONS.some(d => d.id === a) ? ` · ${divName(a)}` : ''}: ${t('autoEdited')}`);
  });
  const lines = [...out.entries()];
  return { key: lines.map(([k]) => k).join('|'), text: lines.slice(0, 3).map(([, v]) => v).join('; ') + (lines.length > 3 ? ` (+${lines.length - 3})` : '') };
}
// Keep one change per spot (the first "before", the last "after"), so a merged entry can still be undone.
function mergePatches(a, b) {
  const map = new Map();
  [...a, ...b].forEach(c => {
    const k = JSON.stringify(c.path.map(p => (isObj(p) ? p.id : p)));
    if (map.has(k)) map.get(k).after = c.after; else map.set(k, { ...c });
  });
  return [...map.values()].filter(c => !sameJSON(c.before, c.after));
}

// Parts kept where only signed-in admins can read them (js/cloud.js): never copied into History.
const PRIVATE_PARTS = new Set(['ageChecks']);
const publicDiff = (a, b) => diffState(a, b).filter(ch => !PRIVATE_PARTS.has(ch.path[0]));
function recordChanges() {
  const now = JSON.parse(JSON.stringify(state));
  if (lastSaved) {
    const known = new Set((lastSaved.log || []).map(e => e.id));
    const fresh = (state.log || []).filter(e => !known.has(e.id) && !e.patch);
    if (!fresh.length && ui.admin && Date.now() - lastUserAct < 3000) {
      const changes = publicDiff(lastSaved, now);
      const { key, text } = changes.length ? autoLogText(changes, lastSaved, now) : {};
      if (text && JSON.stringify(changes).length < 400000) {
        // Quick edits to the same thing by the same person (typing goals one by one) join one entry.
        const last = (state.log || [])[state.log.length - 1];
        if (last && last.auto && last.key === key && last.by === (whoName() || undefined) && !last.undone && Date.now() - Date.parse(last.at) < 90000) {
          last.patch = mergePatches(last.patch || [], changes);
          last.text = text;
          last.at = new Date().toISOString();
        } else {
          logAction(text);
          Object.assign(state.log[state.log.length - 1], { patch: changes, auto: true, key });
        }
        now.log = JSON.parse(JSON.stringify(state.log));
      }
    }
    if (fresh.length) {
      const changes = publicDiff(lastSaved, now);
      // Very large changes (like starting a season) keep their own undo instead.
      if (changes.length && JSON.stringify(changes).length < 400000) {
        fresh[fresh.length - 1].patch = changes;
        now.log = JSON.parse(JSON.stringify(state.log));
      }
    }
  }
  lastSaved = now;
}

// Walk a path; returns [parent, key] where key is a property name or an {id, i} list slot.
function resolvePath(root, path) {
  let node = root;
  for (const seg of path.slice(0, -1)) {
    node = isObj(seg) ? (Array.isArray(node) ? node.find(x => x.id === seg.id) : undefined) : node && node[seg];
    if (!isObj(node)) return [null, null];
  }
  return [node, path[path.length - 1]];
}
const readAt = (parent, key) => (isObj(key) ? (Array.isArray(parent) ? parent.find(x => x.id === key.id) : undefined) : parent[key]);

function undoPatch(entry) {
  const changes = entry.patch;
  // Only undo if those exact things haven't been changed again since.
  const blocked = changes.filter(c => {
    const [parent, key] = resolvePath(state, c.path);
    if (!parent) return c.after !== undefined;
    return !sameJSON(readAt(parent, key), c.after);
  });
  if (blocked.length) return t('undoBlocked');
  [...changes].reverse().forEach(c => {
    let [parent, key] = resolvePath(state, c.path);
    if (!parent) {
      // the place it lived is gone; rebuild plain objects along the way
      parent = state;
      c.path.slice(0, -1).forEach(seg => { if (!isObj(seg)) parent = parent[seg] = parent[seg] || {}; });
      key = c.path[c.path.length - 1];
    }
    if (isObj(key)) {
      const at = parent.findIndex(x => x.id === key.id);
      if (c.before === undefined) { if (at >= 0) parent.splice(at, 1); }
      else if (at >= 0) parent[at] = JSON.parse(JSON.stringify(c.before));
      else parent.splice(Math.min(key.i, parent.length), 0, JSON.parse(JSON.stringify(c.before)));
    } else if (c.before === undefined) delete parent[key];
    else parent[key] = JSON.parse(JSON.stringify(c.before));
  });
  // added leagues and fields live outside the saved data too
  for (let i = DIVISIONS.length - 1; i >= 0; i--) if (DIVISIONS[i].custom) DIVISIONS.splice(i, 1);
  (state.leagues || []).forEach(addDivision);
  applyFieldChanges();
  return '';
}

function readPref(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// Signing in lasts until Sign out (it's kept in localStorage, so closing the tab or browser keeps you in).
// A sign-in from before this, kept only for the tab, is carried over.
function readFlag(key) {
  try {
    if (sessionStorage.getItem(key) === '1' && localStorage.getItem(key) !== '1') localStorage.setItem(key, '1');
    return localStorage.getItem(key) === '1';
  } catch (e) { return false; }
}

function writeFlag(key, on) {
  try { on ? localStorage.setItem(key, '1') : localStorage.removeItem(key); sessionStorage.removeItem(key); } catch (e) {}
}

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const divName = id => {
  const d = DIVISIONS.find(x => x.id === id);
  return d ? (LANG === 'es' && d.es) || d.name : id;
};
const played = m => m.hs !== null && m.hs !== undefined;
const byDateTime = (a, b) => a.date.localeCompare(b.date) || toMin(a.time) - toMin(b.time);

function groupBy(list, key) {
  const out = new Map();
  list.forEach(x => {
    const k = key(x);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(x);
  });
  return out;
}

// Teams that left this season (Admin → Teams → Withdraw). They come off the table so everyone below
// moves up. What else happens is picked when withdrawing (see WITHDRAW_OPTS).
const withdrawnIn = div => Object.values(state.withdrawn || {}).filter(w => w.div === div);
// A withdrawn team's own players always come off Goleadores; these are the choices on top of that.
const WITHDRAW_OPTS = ['forfeitPlayed', 'forfeitLeft', 'dropGoals'];
// Older withdrawals only had "keep" or "void" (void: their played games don't count for anyone).
function wOpts(w) {
  if (w.opts) return w.opts;
  const v = w.mode === 'void';
  return { forfeitPlayed: false, forfeitLeft: false, dropGoals: false, hideScorers: false, wipePlayed: v };
}
// Games a withdrawn team still had left. They come off the schedule (so the fields are free) and are
// kept with the withdrawal, so they can count as forfeits and come back if the team does.
// A game a withdrawn team had left stops counting once its opponent has a real game booked that day
// instead (e.g. a new team took the withdrawn team's spot in the game rotation).
function stubReplaced(m, gone, matches) {
  // both teams withdrew: nobody plays it, nobody gets the 3–0
  if (gone.includes(m.home) && gone.includes(m.away)) return true;
  const other = gone.includes(m.home) ? m.away : m.home, left = gone.includes(m.home) ? m.home : m.away;
  if (matches.some(x => x.div === m.div && x.date === m.date && !x.forfeitBy && (x.home === other || x.away === other))) return true;
  // Its rotation spot went to another team: from today on, that team plays these games instead.
  if (matches === state.matches && m.date >= todayISO() && hasRotation(m.div) && !Object.values(rotationOf(m.div).numbers).includes(left)) return true;
  return false;
}
const forfeitStubs = (div, out = withdrawnIn(div), matches = state.matches) => {
  const gone = out.map(w => w.team);
  return out.flatMap(w => (w.left || []).filter(m => !stubReplaced(m, gone, matches)));
};

// The result that counts for a game: its score, or 3–0 to the other team when it was against a
// withdrawn team and that was picked. Games left count on the day they were scheduled.
// "Both teams" forfeited (e.g. a fight): each team loses 3–0, nobody gets points.
const BOTH = '__both';
const doubleForfeit = m => m.forfeitBy === BOTH;
function resultOf(m, out = withdrawnIn(m.div)) {
  // A team that couldn't play that week: 3–0 to the other team (from that day on), no goals for anyone.
  if (m.forfeitBy) {
    if (m.date > todayISO()) return null;
    if (doubleForfeit(m)) return { hs: 0, as: 0, forfeit: true, double: true };
    const homeLost = m.forfeitBy === m.home;
    return { hs: homeLost ? 0 : 3, as: homeLost ? 3 : 0, forfeit: true };
  }
  const wh = out.some(w => w.team === m.home), wa = out.some(w => w.team === m.away);
  if (wh !== wa) {
    const o = wOpts(out.find(w => w.team === (wh ? m.home : m.away)));
    if (m.left ? o.forfeitLeft && m.date <= todayISO() : played(m) && o.forfeitPlayed) {
      return { hs: wh ? 0 : 3, as: wh ? 3 : 0, forfeit: true };
    }
    if (o.wipePlayed) return null;
  }
  return played(m) && !m.left ? { hs: m.hs, as: m.as } : null;
}

// ---------- playoffs ----------
// Each division can start playoffs on its own (Admin → Playoffs): how many teams go in, seeded from the
// standings, whether ties go to penalties or the higher seed, one or two games a round, and a 3rd-place
// game. Playoff games are normal matches tagged with m.playoff = { round, slot, leg }; they never count in
// the standings, game numbers or Goleadores. The bracket is worked out from the seeds and those results.
const playoffsOf = div => (state.playoffs || {})[div] || null;
// The Copa: the teams that didn't make the playoffs (plus new teams) play their own tournament at the same
// time, as a knockout or as groups and then a knockout. Its games are tagged m.playoff = { cup: 'copa', … }.
const copaOf = div => (state.copa || {})[div] || null;
const cupOfGame = p => (p && p.cup) || 'playoffs';
// The knockout settings and order (seeds) for a bracket: the playoffs themselves, or the Copa's knockout.
const knockoutOf = (div, cup = 'playoffs') => (cup === 'copa' ? (copaOf(div) || {}).ko || null : playoffsOf(div));
// Teams only in the Copa (not in the division's team list), so the planner can book them.
const copaExtras = div => { const c = copaOf(div); return c ? c.teams.filter(x => !(state.teams[div] || []).includes(x)) : []; };
const ROUND_KEY = size => ({ 2: 'final', 4: 'semifinal', 8: 'quarterfinal', 16: 'roundOf16', 32: 'roundOf32' }[size] || 'firstRound');
// Standard bracket order, so 1 and 2 can only meet in the final: 8 → 1,8,4,5,2,7,3,6.
function bracketOrder(size) {
  let o = [1];
  while (o.length < size) { const n = o.length * 2; o = o.flatMap(x => [x, n + 1 - x]); }
  return o;
}
// Games per matchup can be set round by round (e.g. 1 for quarterfinals, 2 for semis, 1 for the final).
// Older setups had one rule for every round.
function legsFor(po, kind, key) {
  if (po.roundLegs) return po.roundLegs[key] || 1;
  return po.legs === 'two' ? 2 : po.legs === 'twoFinalOne' && !kind ? 2 : 1;
}
// Rounds that can be picked, and how many teams each first round takes (fewer than the most means byes).
const PLAYOFF_ROUNDS = ['roundOf16', 'quarterfinal', 'semifinal', 'final'];
const PLAYOFF_SIZES = { roundOf16: [9, 16], quarterfinal: [5, 8], semifinal: [3, 4], final: [2, 2] };
// The rounds a bracket of this many teams has, first to last, plus 3rd place.
function playoffRoundKeys(count) {
  let size = 1;
  while (size < count) size *= 2;
  const keys = [];
  for (; size >= 2; size /= 2) keys.push(ROUND_KEY(size));
  return keys;
}

function resolveNode(div, po, round, slot, A, B, kind, roundKey, cup = 'playoffs', matches = state.matches) {
  const n = { div, cup, round, slot, kind, key: `${round}-${slot}`, a: A.team, b: B.team, aSeed: A.seed, bSeed: B.seed, legs: legsFor(po, kind, roundKey) };
  n.games = matches.filter(m => m.div === div && m.playoff && cupOfGame(m.playoff) === cup && m.playoff.round === round && m.playoff.slot === slot).sort(byDateTime);
  // A bye: the team with no opponent goes straight through.
  if (A.bye || B.bye) {
    n.bye = true;
    const w = A.bye ? B : A;
    Object.assign(n, { winner: w.team, winnerSeed: w.seed });
    return n;
  }
  if (!n.a || !n.b) return n;
  const scored = n.games.filter(played);
  const out = po.out || [];
  if (scored.length < n.legs && (out.includes(n.a) || out.includes(n.b)) && !(out.includes(n.a) && out.includes(n.b))) {
    const [w, l] = out.includes(n.a) ? ['b', 'a'] : ['a', 'b'];
    return Object.assign(n, { walkover: true, winner: n[w], winnerSeed: n[`${w}Seed`], loser: n[l], loserSeed: n[`${l}Seed`] });
  }
  n.ga = scored.reduce((x, m) => x + (m.home === n.a ? m.hs : m.as), 0);
  n.gb = scored.reduce((x, m) => x + (m.home === n.b ? m.hs : m.as), 0);
  if (scored.length < n.legs) return n;
  let winner = n.ga > n.gb ? 'a' : n.gb > n.ga ? 'b' : '';
  if (!winner) {
    n.tied = true;
    const last = scored[scored.length - 1];
    const pick = (po.picks || {})[n.key];
    if (pick) winner = pick === n.a ? 'a' : 'b';
    else if (po.tie === 'seed') { winner = n.aSeed < n.bSeed ? 'a' : 'b'; n.bySeed = true; }
    else if (last.pens) {
      const [ph, pa] = last.pens;
      const homeWins = ph > pa;
      winner = (last.home === n.a) === homeWins ? 'a' : 'b';
      n.pens = last.home === n.a ? [ph, pa] : [pa, ph];
    }
  }
  if (winner) {
    const [w, l] = winner === 'a' ? ['a', 'b'] : ['b', 'a'];
    Object.assign(n, { winner: n[w], winnerSeed: n[`${w}Seed`], loser: n[l], loserSeed: n[`${l}Seed`] });
  }
  return n;
}

// `past` is an archived season ({ playoffs, copa, matches }) to draw its bracket instead of the current one.
function bracket(div, cup = 'playoffs', past = null) {
  const po = past ? (cup === 'copa' ? (past.copa || {}).ko : past.playoffs) : knockoutOf(div, cup);
  if (!po) return null;
  const matches = past ? past.matches : state.matches;
  const count = po.seeds.length;
  let size = 1;
  while (size < count) size *= 2;
  let line = bracketOrder(size).map(x => (x <= count ? { team: po.seeds[x - 1], seed: x } : { team: null, seed: null, bye: true }));
  const rounds = [];
  for (let r = 0; line.length > 1; r++) {
    const nodes = [];
    for (let i = 0; i < line.length; i += 2) nodes.push(resolveNode(div, po, r, i / 2, line[i], line[i + 1], line.length === 2 ? 'final' : '', ROUND_KEY(line.length), cup, matches));
    rounds.push({ round: r, size: line.length, key: ROUND_KEY(line.length), nodes });
    line = nodes.map(n => ({ team: n.winner || null, seed: n.winner ? n.winnerSeed : null }));
  }
  let third = null;
  if (po.third && rounds.length >= 2) {
    const semis = rounds[rounds.length - 2].nodes.filter(n => !n.bye);
    if (semis.length === 2) {
      third = resolveNode(div, po, 'third', 0, { team: semis[0].loser || null, seed: semis[0].loserSeed }, { team: semis[1].loser || null, seed: semis[1].loserSeed }, 'third', 'thirdPlace', cup, matches);
    }
  }
  const final = rounds.length ? rounds[rounds.length - 1].nodes[0] : null;
  return { po, cup, rounds, third, champion: final && final.winner };
}
const bracketNodes = b => (b ? [...b.rounds.flatMap(r => r.nodes), ...(b.third ? [b.third] : [])] : []);
const sameTeams = (n, m) => (n.a === m.home && n.b === m.away) || (n.a === m.away && n.b === m.home);

// "Semifinal", "Final · Leg 2", "3rd place", "Copa · Group A", "Copa · Semifinal" for a playoff or Copa game.
function roundLabel(div, p, withLeg = true) {
  const cup = cupOfGame(p);
  const pre = cup === 'copa' && !isTour(DIVISIONS.find(d => d.id === div)) ? `${t('copa')} · ` : '';
  if (p.group) return (copaOf(div) || {}).roundRobin ? `${pre}${t('roundRobinShort')}` : `${pre}${t('group')} ${p.group}`;
  const b = bracket(div, cup);
  if (!b) return t(cup === 'copa' ? 'copa' : 'playoffs');
  const legs = p.round === 'third' ? (b.third || {}).legs : ((b.rounds[p.round] || {}).nodes || [])[0]?.legs;
  const name = `${pre}${p.round === 'third' ? t('thirdPlace') : t((b.rounds[p.round] || {}).key || 'playoffs')}`;
  return withLeg && legs > 1 ? `${name} · ${t(p.leg === 1 ? 'leg1' : 'leg2')}` : name;
}
// The round name when a division only has playoff/Copa games on a date ('' on a regular game day).
function playoffDay(div, date) {
  const ms = state.matches.filter(m => m.div === div && m.date === date);
  if (!ms.length || !ms.every(m => m.playoff)) return '';
  return [...new Set(ms.map(m => roundLabel(div, m.playoff, false).replace(/ · [^·]+$/, s => (m.playoff.group ? '' : s))))].join(' / ');
}

// Copa group games between two teams.
const copaPairGames = (div, group, a, b) => state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && m.playoff.group === group
  && ((m.home === a && m.away === b) || (m.home === b && m.away === a)));
const openNode = (div, cup, m) => bracketNodes(bracket(div, cup)).find(x => !x.bye && x.a && x.b && sameTeams(x, m) && !x.winner && x.games.length < x.legs);

// Does a game's playoff/Copa tag still match its teams?
function tagFits(m) {
  const p = m.playoff;
  if (p.group) {
    const g = ((copaOf(m.div) || {}).groups || []).find(x => x.name === p.group);
    return !!g && g.teams.includes(m.home) && g.teams.includes(m.away);
  }
  const n = bracketNodes(bracket(m.div, cupOfGame(p))).find(x => x.round === p.round && x.slot === p.slot);
  return !!n && sameTeams(n, m);
}
// Tag a game booked on/after the first playoff (or Copa) day as the next game of the matchup it belongs to.
function tagPlayoff(m) {
  if (m.playoff && tagFits(m)) return;
  delete m.playoff;
  const po = playoffsOf(m.div), co = copaOf(m.div);
  if (po && m.date >= po.on) {
    const n = openNode(m.div, 'playoffs', m);
    if (n) { m.playoff = { round: n.round, slot: n.slot, leg: n.games.length + 1 }; return; }
  }
  if (co && m.date >= co.on) {
    if (co.ko) {
      const n = openNode(m.div, 'copa', m);
      if (n) m.playoff = { cup: 'copa', round: n.round, slot: n.slot, leg: n.games.length + 1 };
    } else if (co.groups) {
      const g = co.groups.find(x => x.teams.includes(m.home) && x.teams.includes(m.away));
      if (g && copaPairGames(m.div, g.name, m.home, m.away).length < (co.groupLegs || 1)) m.playoff = { cup: 'copa', group: g.name };
    }
  }
}
// Every knockout game a Copa or tournament will have, even before the group stage is over:
// [{ round, slot, key, name, legs, aLabel, bLabel, a, b }] — the labels say who it will be
// ("1st Group A", "Winner of Semifinal 1") and a / b are the teams once they're known.
const placeLabel = n => t('placeOrd').split('|')[n - 1] || `${n}`;
function koPlan(div) {
  const co = copaOf(div);
  if (!co || co.roundRobin || (!co.ko && !co.groups)) return [];
  const rules = co.ko || co;
  const b = co.ko ? bracket(div, 'copa') : null;
  let labels = [];
  if (co.ko) labels = co.ko.seeds;
  else for (let r = 0; r < (co.advance || 1); r++) co.groups.forEach(g => labels.push(`${placeLabel(r + 1)} ${t('group')} ${g.name}`));
  let size = 1;
  while (size < labels.length) size *= 2;
  let line = bracketOrder(size).map(x => (x <= labels.length ? labels[x - 1] : null));
  const out = [];
  for (let r = 0; line.length > 1; r++) {
    const key = ROUND_KEY(line.length), next = [];
    for (let i = 0; i < line.length; i += 2) {
      const slot = i / 2, A = line[i], B = line[i + 1];
      if (A === null || B === null) { next.push(A ?? B); continue; }
      const node = b && b.rounds[r] && b.rounds[r].nodes[slot];
      const name = `${t(key)}${line.length > 2 ? ` ${slot + 1}` : ''}`;
      out.push({ round: r, slot, key, name, legs: legsFor(rules, line.length === 2 ? 'final' : '', key), aLabel: A, bLabel: B, a: (node && node.a) || '', b: (node && node.b) || '' });
      next.push(`${t('winnerOf')} ${name}`);
    }
    line = next;
  }
  const semis = out.filter(n => n.key === 'semifinal');
  if (rules.third && semis.length === 2) {
    out.push({ round: 'third', slot: 0, key: 'thirdPlace', name: t('thirdPlace'), legs: legsFor(rules, 'third', 'thirdPlace'),
      aLabel: `${t('loserOf')} ${semis[0].name}`, bLabel: `${t('loserOf')} ${semis[1].name}`, a: (b && b.third && b.third.a) || '', b: (b && b.third && b.third.b) || '' });
  }
  return out;
}
const holdKey = (n, leg) => `${n.round}-${n.slot}-${leg}`;
const holdNode = r => { const [round, slot] = (r.hold.key || '').split('-'); return koPlan(r.hold.div).find(n => `${n.round}` === round && `${n.slot}` === slot); };
// What a saved slot shows: "1st Group A" / "2nd Group B" until the teams are known.
function holdLabels(r) {
  const n = r.hold && r.hold.key && holdNode(r);
  return n ? [n.a || n.aLabel, n.b || n.bLabel] : [t('koSlot'), ''];
}
function holdName(r) {
  const n = r.hold && r.hold.key && holdNode(r);
  if (!n) return t('koSlot');
  const leg = +r.hold.key.split('-')[2];
  return `${n.name}${n.legs > 1 ? ` · ${t(leg === 1 ? 'leg1' : 'leg2')}` : ''}`;
}
// Every saved knockout slot on the planner: [{ date, sec, field, r }].
const allHolds = () => Object.entries(state.matchDays || {}).flatMap(([date, day]) => Object.entries(day).flatMap(([sec, fields]) =>
  Object.entries(fields).flatMap(([field, rows]) => rows.filter(r => r.hold).map(r => ({ date, sec, field, r })))));
const groupsDone = (div, co) => co.groups.every(g => {
  const need = (g.teams.length * (g.teams.length - 1) / 2) * (co.groupLegs || 1);
  return state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && m.playoff.group === g.name && played(m)).length >= need;
});
// Knockout seeds from the group tables: winners first, then runners-up (A1, B1, A2, B2…).
function makeKo(div) {
  const co = copaOf(div);
  const tables = co.groups.map(g => copaGroupTable(div, g));
  const seeds = [];
  for (let r = 0; r < (co.advance || 1); r++) tables.forEach(tb => { if (tb[r]) seeds.push(tb[r].team); });
  co.ko = { seeds, tie: co.tie, roundLegs: co.roundLegs, third: co.third, picks: {} };
  touch(div);
}
// Turn a saved slot into the real game with these teams.
function fillHold({ date, field, r }, home, away) {
  const n = holdNode(r), leg = +r.hold.key.split('-')[2];
  const m = { id: state.nextId++, div: r.hold.div, date, time: fromMin(r.t), field, home, away, hs: null, as: null, goals: [] };
  if (n && sameTeams(n, m)) m.playoff = { cup: 'copa', round: n.round, slot: n.slot, leg };
  else tagPlayoff(m);
  state.matches.push(m);
  Object.assign(r, { div: m.div, home, away, mid: m.id, heldAs: r.hold.key });
  delete r.hold; delete r.hHome; delete r.hAway;
}
// With auto-pick on: once every group game has a score the knockout is drawn, and each saved slot whose
// teams are known gets them (it can still be changed on the planner like any game).
function fillHolds() {
  let changed = false;
  Object.keys(state.copa || {}).forEach(div => {
    const co = copaOf(div);
    if (co && co.groups && !co.roundRobin && !co.ko && rotationOn(div) && groupsDone(div, co)) {
      makeKo(div); changed = true;
      // Knockout games already booked (e.g. after a format change) go back to their matchups.
      state.matches.filter(m => m.div === div && !m.playoff).sort(byDateTime).forEach(m => tagPlayoff(m));
      logAction(`${t('koFromGroups')} · ${divName(div)} (${t('rotationAuto')})`);
    }
  });
  allHolds().forEach(h => {
    if (!h.r.hold.key || !rotationOn(h.r.hold.div)) return;
    const n = holdNode(h.r);
    if (!n || !n.a || !n.b) return;
    const leg = +h.r.hold.key.split('-')[2];
    if (state.matches.some(m => m.div === h.r.hold.div && m.playoff && m.playoff.cup === 'copa' && m.playoff.round === n.round && m.playoff.slot === n.slot && m.playoff.leg === leg)) return;
    const [home, away] = leg === 2 ? [n.b, n.a] : [n.a, n.b];
    fillHold(h, home, away); changed = true;
  });
  if (changed) save();
}
const koDivs = divs => divs.filter(d => koPlan(d.id).length);

// Who a team plays next in a knockout (playoffs first, then the Copa); '' if it's waiting, out or already booked.
function playoffOpponent(div, team) {
  for (const cup of ['playoffs', 'copa']) {
    const n = bracketNodes(bracket(div, cup)).find(x => !x.bye && x.a && x.b && (x.a === team || x.b === team) && !x.winner && x.games.length < x.legs);
    if (n) return n.a === team ? n.b : n.a;
  }
  return '';
}
// A Copa group's table, worked out like the standings.
function copaGroupTable(div, g) {
  const rows = new Map(g.teams.map(x => [x, { team: x, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }]));
  state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && m.playoff.group === g.name && played(m)).forEach(m => {
    const h = rows.get(m.home), a = rows.get(m.away);
    if (!h || !a) return;
    h.p++; a.p++; h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
    if (m.hs > m.as) { h.w++; a.l++; } else if (m.hs < m.as) { a.w++; h.l++; } else { h.d++; a.d++; }
  });
  return [...rows.values()].map(r => ({ ...r, gd: r.gf - r.ga, pts: r.w * 3 + r.d }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
}

// A team that wins 3–0 by forfeit and then plays as the replacement in another game that same day: the
// game it played counts for it instead of the forfeit win (the team that forfeited still takes the 0–3 loss).
const forfeitWinner = m => (m.forfeitBy === m.home ? m.away : m.home);
function forfeitSwap(m, list = state.matches) {
  if (!m.forfeitBy || doubleForfeit(m)) return null;
  const w = forfeitWinner(m);
  return list.find(x => x !== m && x.div === m.div && x.date === m.date && x.filler && x.fillerTeam === w && !x.countOnly && !x.fromFriendly) || null;
}
const fillsForForfeit = (x, list = state.matches) => !!x.filler && !x.countOnly && !x.fromFriendly
  && list.some(m => m.forfeitBy && !doubleForfeit(m) && m.div === x.div && m.date === x.date && forfeitWinner(m) === x.fillerTeam);

function standings(div, matches = state.matches, teams = state.teams[div], out = matches === state.matches ? withdrawnIn(div) : []) {
  const gone = new Set(out.map(w => w.team));
  const rows = new Map();
  const row = name => {
    if (!rows.has(name)) rows.set(name, { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, form: [] });
    return rows.get(name);
  };
  (teams || []).forEach(row);
  [...matches.filter(m => m.div === div && !m.playoff), ...forfeitStubs(div, out, matches)].sort(byDateTime).forEach(game => {
    // A team that forfeited keeps its 0–3 loss when a replacement team plays its game.
    const fg = game.filler && game.filler.regular && game.filler.gone;
    if (fg && game.date <= todayISO() && !gone.has(fg) && (teams || []).includes(fg)) { const g = row(fg); g.p++; g.l++; g.ga += 3; g.form.push('L'); }
    const r = resultOf(game, out);
    if (!r) return;
    const m = { ...game, ...r };
    // A guest "filler" team stands in for a withdrawn team: only the league team's side counts.
    const guest = () => ({ p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, form: [] });
    const counts = m.fillerCounts || fillsForForfeit(game, matches), skip = forfeitSwap(game, matches) ? forfeitWinner(game) : '';
    const h = (m.fillerTeam === m.home && !counts) || skip === m.home ? guest() : row(m.home), a = (m.fillerTeam === m.away && !counts) || skip === m.away ? guest() : row(m.away);
    h.p++; a.p++;
    if (m.double) { h.l++; a.l++; h.ga += 3; a.ga += 3; h.form.push('L'); a.form.push('L'); return; }
    h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
    if (m.hs > m.as) { h.w++; a.l++; h.form.push('W'); a.form.push('L'); }
    else if (m.hs < m.as) { a.w++; h.l++; a.form.push('W'); h.form.push('L'); }
    else { h.d++; a.d++; h.form.push('D'); a.form.push('D'); }
  });
  return [...rows.values()].filter(r => !gone.has(r.team))
    .map(r => ({ ...r, gd: r.gf - r.ga, pts: r.w * 3 + r.d, form: r.form.slice(-5) }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.team.localeCompare(y.team));
}

// Goleadores, leaving out what was picked when a team was withdrawn: goals scored against them
// (by game, using each team's game order) and their own players.
function leaders(div, scorers = state.scorers, past) {
  const out = past ? past.withdrawn || [] : withdrawnIn(div);
  const hide = new Set(out.map(w => w.team));
  const against = new Set(out.filter(w => wOpts(w).dropGoals).map(w => w.team));
  // Goals typed for a game whose score isn't on the site yet (saved but not published, or not entered) wait
  // with it, so Goleadores and the standings go up together. Columns line up with the team's games (G1 = first).
  const waiting = m => !past && m && !m.left && !m.forfeitBy && !played(m);
  const counted = s => {
    const games = colGames(div, s.team, past);
    const goals = s.games.reduce((n, g, i) => {
      const m = games[i];
      return n + ((m && against.has(m.home === s.team ? m.away : m.home)) || waiting(m) ? 0 : g || 0);
    }, 0);
    return goals === s.goals ? s : { ...s, goals };
  };
  // Most goals first; players tied on goals go in the order of their teams in the standings, then by name.
  let table = [];
  try { table = (past ? standings(div, past.matches, past.teams, past.withdrawn || []) : standings(div)).map(r => r.team); } catch (e) { table = []; }
  const place = team => { const i = table.indexOf(team); return i < 0 ? 999 : i; };
  return scorers.filter(s => s.div === div && !s.own && !hide.has(s.team)).map(counted).filter(s => s.goals > 0)
    .sort((a, b) => b.goals - a.goals || place(a.team) - place(b.team) || a.name.localeCompare(b.name));
}

// When a division's standings/goleadores last changed: an admin edit time, or else the latest result date.
function lastUpdated(div) {
  const edited = state.updated && state.updated[div];
  if (edited) return new Date(edited).toLocaleString(LANG === 'es' ? 'es-US' : 'en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const latest = state.matches.filter(m => m.div === div && played(m)).map(m => m.date).sort().pop();
  return latest ? fmtDate(latest, { month: 'long', day: 'numeric', year: 'numeric' }) : null;
}

const seasonName = div => (state.seasons && state.seasons[div]) || defaultSeason(div);

// A season marked "ended" in Admin → Seasons shows as final until the next season starts.
const seasonEnded = div => (state.seasonEnded || {})[div] || '';
function updatedNote(div) {
  const when = lastUpdated(div);
  const past = (state.archive || []).some(a => a.div === div);
  const ended = seasonEnded(div);
  // One text span next to the green dot, so on a phone it wraps like a sentence instead of in columns.
  return `<p class="updated"><span>${ended ? `<span class="final-tag">${t('finalTag')}</span> ` : ''}<b>${esc(seasonName(div))}</b>${ended
    ? ` · ${t('seasonEndedOn')} <b>${fmtDate(ended)}</b>` : when ? ` · ${t('lastUpdated')}: <b>${when}</b>` : ''}${past
    ? ` · <a href="#/archive" data-action="open-archive-div" data-for="${div}">${t('pastSeasons')} →</a>` : ''}</span></p>`;
}

function touch(div) {
  state.updated = state.updated || {};
  state.updated[div] = new Date().toISOString();
}

// First tap on a red × swaps it for "Remove? Yes / Cancel"; only "Yes" deletes.
function askConfirm(btn) {
  if (btn.nextElementSibling && btn.nextElementSibling.classList.contains('confirm-rm')) return;
  btn.hidden = true;
  const box = document.createElement('span');
  box.className = 'confirm-rm';
  // Deletes ask "Remove?"; other buttons can bring their own question and yes (data-ask, data-yes).
  box.innerHTML = `<span>${t(btn.dataset.ask || 'sure')}</span>
    <button type="button" class="btn btn-sm btn-danger">${t(btn.dataset.yes || 'yesRemove')}</button>
    <button type="button" class="btn btn-sm btn-outline" data-action="cancel-rm">${t('cancel')}</button>`;
  Object.assign(box.children[1].dataset, btn.dataset, { action: btn.dataset.confirm });
  btn.after(box);
}

// Fields grouped by where they are (the futsal fields are at El Sereno Park), each with its short label.
function locations() {
  const byPlace = new Map();
  Object.entries(FIELDS).forEach(([id, name]) => {
    const [where, field] = name.split(' – ');
    const place = where === 'Futsal' ? 'El Sereno Park' : where;
    const label = where === 'Futsal' ? field.replace('Field', 'Futsal') : field;
    if (!byPlace.has(place)) byPlace.set(place, { place, ids: [], labels: [] });
    byPlace.get(place).ids.push(id);
    byPlace.get(place).labels.push(label);
  });
  return [...byPlace.values()];
}

// Google Maps directions for a field's park or school: its saved address (Admin → Fields), or else a
// search for the place's name. The futsal fields are at El Sereno Park.
const placeOf = name => name.split(' – ')[0].replace(/^Futsal$/, 'El Sereno Park');
// The league's usual places, as written on the weekly schedule sheet.
const PLACE_INFO = {
  'Bitely ES': { name: 'Bitely Elementary School', address: '7589 Fern Ave Rosemead, CA 91770' },
  'El Sereno Park': { name: 'El Sereno Park', address: '4721 Klamath St Los Angeles, CA 90032' },
  'Franklin HS': { name: 'Franklin High School', address: '820 N. Ave 54 Los Angeles, CA 90042' },
  'Guardia Park': { name: 'Guardia Park', address: '4410 Garden Homes Ave Los Angeles, CA 90032' },
  'Rio de Los Angeles State Park': { name: 'Rio de Los Angeles Park', address: '1900 N San Fernando Rd Los Angeles, CA 90065' },
  'Contreras HS': { name: 'Miguel Contreras HS', address: '1255 Miramar St Los Angeles, CA 90026' },
};
const placeAddress = place => (state.placeAddresses || {})[place] || (PLACE_INFO[place] || {}).address || '';
function mapsLink(name) {
  const place = placeOf(name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeAddress(place) || place + ' Los Angeles')}`;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('has-undo');
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- history (Admin → History) ----------
// Admin changes are written to a log with the time. Deletions also keep what was deleted, so they can
// be put back from the History page later, without touching anything done since.
const LOG_MAX = 300;
const clone = x => JSON.parse(JSON.stringify(x));
function logAction(text, undo) {
  state.log = state.log || [];
  state.log.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), text, ...(whoName() ? { by: whoName() } : {}), ...(undo ? { undo } : {}) });
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
}

// Put back one deleted thing from the History page. Only adds back what's missing.
function restoreFromLog(entry) {
  const u = entry.undo;
  const has = (list, id) => list.some(x => x.id === id);
  if (u.type === 'scorer' && !has(state.scorers, u.scorer.id)) state.scorers.push(u.scorer);
  if (u.type === 'redcard' && !has(state.redCards || [], u.card.id)) state.redCards = [...(state.redCards || []), u.card];
  if (u.type === 'match' && !has(state.matches, u.match.id)) state.matches.push(u.match);
  if (u.type === 'team') {
    const list = state.teams[u.div] = state.teams[u.div] || [];
    if (!list.includes(u.name)) list.splice(Math.min(u.idx, list.length), 0, u.name);
    u.matches.forEach(m => { if (!has(state.matches, m.id)) state.matches.push(m); });
  }
  if (u.type === 'slot') {
    const sec = ((state.matchDays = state.matchDays || {})[u.date] = state.matchDays[u.date] || {})[u.section] = (state.matchDays[u.date][u.section] || {});
    const rows = sec[u.field] = sec[u.field] || [];
    if (!has(rows, u.row.id)) { rows.push(u.row); rows.sort((a, b) => a.t - b.t); }
    if (u.match && !has(state.matches, u.match.id)) state.matches.push(u.match);
  }
  if (u.type === 'field') {
    if (u.added) state.addedFields = { ...(state.addedFields || {}), [u.id]: u.name };
    else if (state.removedFields) delete state.removedFields[u.id];
    if (u.closed) state.fieldsClosed = { ...(state.fieldsClosed || {}), [u.id]: true };
    applyFieldChanges();
  }
  if (u.type === 'league' && !DIVISIONS.some(d => d.id === u.league.id)) {
    state.leagues = [...(state.leagues || []), u.league];
    addDivision(u.league);
    state.teams[u.league.id] = u.teams;
    state.matches.push(...u.matches);
    state.scorers.push(...u.scorers);
    state.archive = [...(state.archive || []), ...u.archive];
    state.seasons[u.league.id] = u.season;
    if (u.games) state.seasonGames = { ...(state.seasonGames || {}), [u.league.id]: u.games };
  }
  if (u.type === 'season') {
    const blocked = u.divs.map(x => seasonComebackBlocked(x.div)).filter(Boolean);
    if (blocked.length) return blocked.join(' · ');
    u.divs.forEach(x => bringBackSeason(x.div, x.archiveId, x.name, x.games));
  }
  if (['scorer', 'match', 'team'].includes(u.type)) touch(u.div || (u.scorer || u.match).div);
  entry.undone = new Date().toISOString();
  logAction(`${t('logRestored')}: ${entry.text}`);
}

// ---------- settings (Admin → Settings) ----------
// Things that used to be fixed: which fields each division usually plays on (the Schedule's division
// lists and field lists follow this) and how long its games are.
const settingsOf = () => (state.settings = state.settings || {});
function defaultLength(div) {
  if (groupOf(div) === 'futsal') return 45;
  return GAME_MINUTES[div] || 75;
}

// ---------- days off (holidays, etc.) ----------
// A division plays on a date: its weekday, or for a tournament division only the tournament's dates.
const isTour = d => !!(d && d.tournament);
const playsOn = (d, date) => (isTour(d) ? (d.dates || []).includes(date) : DAY_NUM[d.day] === dayOfWeek(date));

// Days the league doesn't play on purpose, for all divisions or some: { id, date, note, divs: [] = all }.
const offDays = () => state.offDays || [];
const offFor = (div, date) => offDays().find(o => o.date === date && ((!o.divs.length && !isTour(DIVISIONS.find(d => d.id === div))) || o.divs.includes(div)));
// Divisions of a section (playing that weekday) that are off on a date, and the note(s).
function sectionOff(date, sec) {
  const divs = DIVISIONS.filter(d => d.group === sec && playsOn(d, date));
  const off = divs.filter(d => offFor(d.id, date));
  return { all: divs.length > 0 && off.length === divs.length, divs: off, note: [...new Set(off.map(d => offFor(d.id, date).note).filter(Boolean))].join(' / ') };
}

function daysOffHTML() {
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  const list = [...offDays()].sort((a, b) => a.date.localeCompare(b.date));
  // "Everyone" means the divisions that play on that weekday (a Sunday never touches futsal).
  const playing = date => DIVISIONS.filter(d => !isTour(d) && DAY_NUM[d.day] === dayOfWeek(date));
  const groupsOn = date => [...new Set(playing(date).map(d => d.group))].map(g => t({ youth: 'youth', adult: 'adults', futsal: 'futsal' }[g])).join(', ');
  const who = o => (o.divs.length ? o.divs.map(divName).join(', ') : `${t('everyonePlaying')} (${groupsOn(o.date)})`);
  const draft = ui.dayOffDate || '';
  return `<form class="card settings-card" data-form="add-day-off">
      <h2>${t('daysOff')}</h2>
      <p class="note">${t('daysOffHelp')}</p>
      ${list.length ? `<ul class="admin-list">${list.map(o => `<li>
          <span class="grow"><b>${esc(fmtDate(o.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</b>${o.note ? ` · ${esc(o.note)}` : ''} <span class="muted">· ${esc(who(o))}</span></span>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-day-off" data-id="${o.id}" aria-label="${t('remove')}">×</button>
        </li>`).join('')}</ul>` : `<p class="muted">${t('noDaysOff')}</p>`}
      <div class="league-grid">
        <label class="field">${t('date')}<input class="input" type="date" name="date" required value="${draft}" data-change="day-off-date"></label>
        <label class="field">${t('dayOffNote')}<input class="input" name="note" placeholder="${t('dayOffNotePh')}" autocomplete="off"></label>
      </div>
      <fieldset class="po-rules"><legend>${t('whoIsOff')}</legend>
        <label class="radio-line"><input type="radio" name="who" value="all" checked data-change="day-off-who"> <span>${draft ? `${t('everyonePlaying')} (${groupsOn(draft) || '—'})` : t('allDivisions')}</span></label>
        <label class="radio-line"><input type="radio" name="who" value="some" data-change="day-off-who"> <span>${t('selectDivisions')}</span></label>
      </fieldset>
      <div class="day-off-divs" hidden>${groups.filter(([g]) => (draft ? playing(draft) : DIVISIONS).some(d => d.group === g)).map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
        ${(draft ? playing(draft) : DIVISIONS).filter(d => d.group === g).map(d => `<label class="check-pill"><input type="checkbox" name="divs" value="${d.id}"><span>${esc(divName(d.id))}</span></label>`).join('')}</fieldset>`).join('')}</div>
      ${draft && !playing(draft).length ? `<p class="warn">${t('nobodyPlaysThatDay')}</p>` : ''}
      <p class="warn" hidden></p>
      <button class="btn btn-gold" type="submit">＋ ${t('addDayOff')}</button>
    </form>`;
}

function addDayOff(form) {
  const date = form.date.value, note = form.note.value.trim();
  const some = form.querySelector('[name=who]:checked').value === 'some';
  const divs = some ? [...form.querySelectorAll('[name=divs]:checked')].map(c => c.value) : [];
  const warn = form.querySelector('.warn');
  if (!date) { warn.textContent = t('pickTime'); warn.hidden = false; return; }
  if (some && !divs.length) { warn.textContent = t('pickDivision'); warn.hidden = false; return; }
  state.offDays = [...offDays(), { id: `off${Date.now().toString(36)}`, date, note, divs }];
  ui.dayOffDate = '';
  logAction(`${t('dayOffAdded')}: ${fmtDate(date)}${note ? ` · ${note}` : ''} · ${divs.length ? divs.map(divName).join(', ') : t('allDivisions')}`);
  save(); render();
}

function pageAdminSettings() {
  const fieldIds = openFields();
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  const custom = settingsOf().fields || {};
  return adminShell('admin/settings', `
    <h1 class="page-title">${t('settings')}</h1>

    ${adminAccountsHTML()}

    ${daysOffHTML()}

    <form class="card settings-card" data-form="settings-fields">
      <h2>${t('usualSetupTitle')}</h2>
      <p class="note">${t('usualFieldsHelp')} ${t('usualLengthHelp')}</p>
      ${groups.map(([g, label]) => {
        const list = DIVISIONS.filter(d => d.group === g && !isTour(d));
        return list.length ? `<h3 class="settings-group">${t(label)}</h3>${list.map(d => `
          <div class="settings-row">
            <div class="settings-name"><b>${esc(divName(d.id))}</b>
              ${custom[d.id] ? `<p class="changed-note">${t('fieldsNotUsual')}</p>` : ''}</div>
            <div class="div-checks">${fieldIds.map(f => `<label class="check-pill small-pill"><input type="checkbox" name="f|${d.id}" value="${f}" ${divisionFields(d.id).includes(f) && divisionFields(d.id).length < fieldIds.length ? 'checked' : ''}><span>${esc(FIELDS[f])}</span></label>`).join('')}</div>
            <label class="len-line">${t('usualLength')}
              <input class="input" name="len|${d.id}" type="number" min="20" max="150" inputmode="numeric" value="${(settingsOf().lengths || {})[d.id] || ''}" placeholder="${customLeague(d.id) ? customLeague(d.id).length : defaultLength(d.id)}"> ${t('minutesShort')}
              <small class="muted">${t('leaveEmptyUsual')}</small></label>
          </div>`).join('')}` : '';
      }).join('')}
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" data-action="reset-settings" data-part="all">${t('backToDefault')}</button>
        <button type="submit" class="btn btn-gold">${t('save')}</button>
      </div>
    </form>`);
}

// Bring a division's archived season back as its current season. Only the most recent archived season,
// and only while the new season has no scores or goals yet, so nothing gets lost or mixed in.
function seasonComebackBlocked(div) {
  if (state.matches.some(m => m.div === div && played(m)) || state.scorers.some(x => x.div === div && x.goals > 0)) {
    return `${divName(div)}: ${t('bringBackBlocked')}`;
  }
  return '';
}
const latestArchive = div => [...(state.archive || [])].reverse().find(a => a.div === div);
function bringBackSeason(div, archiveId, name, games) {
  const a = archiveId && (state.archive || []).find(x => x.id === archiveId);
  if (a) {
    a.matches.forEach(m => { if (!state.matches.some(x => x.id === m.id)) state.matches.push(m); });
    a.scorers.forEach(sc => {
      const cur = state.scorers.find(x => x.id === sc.id);
      if (cur) Object.assign(cur, { games: [...sc.games], goals: sc.goals });
      else state.scorers.push({ ...sc, games: [...sc.games] });
    });
    const teams = state.teams[div] = state.teams[div] || [];
    a.teams.forEach(tm => { if (!teams.includes(tm)) teams.push(tm); });
    // Its withdrawn teams are withdrawn again (not archived) now that the season is back.
    (a.withdrawn || []).forEach(w => {
      state.withdrawn = { ...(state.withdrawn || {}), [`${div}|${w.team}`]: clone(w) };
      const at = (state.archivedTeams || {})[w.team];
      if (at && at.divs[div]) { delete at.divs[div]; if (!Object.keys(at.divs).length) delete state.archivedTeams[w.team]; }
    });
    state.archive = state.archive.filter(x => x.id !== a.id);
  }
  state.seasons[div] = (a && a.name) || name || state.seasons[div];
  const g = (a && a.games) || games;
  if (g) state.seasonGames = { ...(state.seasonGames || {}), [div]: g };
  touch(div);
}

// ---------- red cards (Admin → Red cards) ----------
// Each red card: who, which game, what the referee reported, and how many games they sit out.
// The return game is worked out from the team's schedule: the first game after the ones they miss.
const teamGamesAfter = (div, team, date) => state.matches
  .filter(m => m.div === div && (m.home === team || m.away === team) && m.date > date && !notRescheduled(m))
  .sort(byDateTime);

function redCardStatus(c) {
  const after = teamGamesAfter(c.div, c.team, c.date);
  const missed = after.slice(0, c.games);
  const served = missed.filter(m => played(m) || playedDate(m) < todayISO()).length;
  const back = after[c.games];
  return { served, done: served >= c.games, back };
}

// The same player (same division and team, name not case-sensitive) across their red cards. A card
// counts for "this season" while its game is still in the current season (not yet in the Archive).
const rcKey = c => `${c.div}|${c.team}|${c.player.trim().toLowerCase()}`;
const rcThisSeason = c => state.matches.some(m => m.id === c.matchId);
function rcSeasonCards(c) {
  return (state.redCards || []).filter(x => rcKey(x) === rcKey(c) && rcThisSeason(x)).sort((a, b) => a.date.localeCompare(b.date));
}

const rcGameLabel = (c, m) => `${t('game')} ${gameNumber(c.div, m.date)} · ${fmtDate(m.date)} · ${t('vs')} ${m.home === c.team ? m.away : m.home}`;

function rcTeamOptions(div, current) {
  return `<option value="" ${current ? '' : 'selected'} disabled>${t('chooseOne')}</option>${(state.teams[div] || []).map(tm =>
    `<option ${tm === current ? 'selected' : ''}>${esc(tm)}</option>`).join('')}`;
}
function rcGameOptions(div, team) {
  const games = state.matches.filter(m => m.div === div && (m.home === team || m.away === team) && m.date <= todayISO())
    .sort((a, b) => byDateTime(b, a));
  return `<option value="" selected disabled>${t('chooseOne')}</option>${games.map(m =>
    `<option value="${m.id}">${esc(rcGameLabel({ div, team }, m))}</option>`).join('')}`;
}
const rcPlayers = (div, team) => state.scorers.filter(x => x.div === div && x.team === team && !x.own).map(x => x.name);

function pageAdminRedCards() {
  // With a division picked, the cards can be narrowed to one team.
  const rcTeams = ui.rcDiv ? [...new Set([...(state.teams[ui.rcDiv] || []), ...(state.redCards || []).filter(c => c.div === ui.rcDiv).map(c => c.team)])].sort((a, b) => a.localeCompare(b)) : [];
  if (!rcTeams.includes(ui.rcTeam)) ui.rcTeam = '';
  const cards = [...(state.redCards || [])].filter(c => (!ui.rcDiv || c.div === ui.rcDiv) && (!ui.rcTeam || c.team === ui.rcTeam)).sort((a, b) => b.date.localeCompare(a.date));
  const withStatus = cards.map(c => ({ c, st: redCardStatus(c) }));
  const active = withStatus.filter(x => !x.st.done), served = withStatus.filter(x => x.st.done);
  const card = ({ c, st }) => {
    const m = state.matches.find(x => x.id === c.matchId);
    return `<article class="card rc-card ${st.done ? 'is-served' : ''}">
      <div class="rc-head">
        <span class="rc-icon" aria-hidden="true"></span>
        <div><b class="rc-player">${esc(c.player)}</b><span class="muted"> · ${esc(c.team)} · <span class="nowrap">${esc(divName(c.div))}</span></span></div>
        <span class="rc-tools">
          <button type="button" class="btn btn-sm btn-outline" data-action="rc-edit" data-id="${c.id}">${t('editGame')}</button>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-redcard" data-id="${c.id}" aria-label="${t('remove')}">×</button>
        </span>
      </div>
      <p class="rc-line"><span class="muted">${t('rcWhen')}:</span> ${m ? esc(rcGameLabel(c, m)) : fmtDate(c.date)}</p>
      ${rcThisSeason(c) ? (() => {
        const n = rcSeasonCards(c).indexOf(c) + 1;
        return `<p class="rc-line ${n > 1 ? 'rc-repeat-line' : ''}">${esc(t('rcNthSeason').replace('{nth}', (t('rcOrdinals')[n - 1] || `${n}.`)))}</p>`;
      })() : ''}
      ${c.reason ? `<p class="rc-line"><span class="muted">${t('refReport')}:</span> ${esc(c.reason)}</p>` : ''}
      ${c.staffNotes ? `<p class="rc-line"><span class="muted">${t('staffNotes')}:</span> ${esc(c.staffNotes)}</p>` : ''}
      <p class="rc-line"><span class="muted">${t('rcSuspension')}:</span> ${gamesCount(c.games)} · ${t('rcServed')} ${Math.min(st.served, c.games)} ${t('of')} ${c.games}</p>
      ${(c.changes || []).map(ch => `<p class="rc-line rc-change"><span class="muted">${t('rcChanged')} ${fmtDate(ch.on)}:</span> ${gamesCount(ch.from)} → ${gamesCount(ch.to)}${ch.note ? ` · ${esc(ch.note)}` : ''}</p>`).join('')}
      ${ui.rcEdit === c.id ? `<form class="rc-edit" data-form="rc-edit" data-id="${c.id}">
          <div class="league-grid">
            <label class="field">${t('rcGamesOut')}<input class="input" name="games" type="number" min="1" max="20" inputmode="numeric" value="${c.games}"></label>
            <label class="field">${t('rcChangeDate')}<input class="input" name="on" type="date" value="${todayISO()}"></label>
          </div>
          <label class="field">${t('rcChangeWhy')}<input class="input" name="note" autocomplete="off" placeholder="${t('rcChangeHint')}"></label>
          <label class="field">${t('staffNotes')}<textarea class="input" name="staffNotes" rows="2" placeholder="${t('staffNotesHint')}">${esc(c.staffNotes || '')}</textarea></label>
          <p class="warn" hidden></p>
          <div class="edit-actions">
            <button type="button" class="btn btn-sm btn-outline" data-action="rc-edit" data-id="${c.id}">${t('cancel')}</button>
            <button type="submit" class="btn btn-sm btn-gold">${t('saveChanges')}</button>
          </div>
        </form>` : ''}
    </article>`;
  };
  return adminShell('admin/redcards', `
    <h1 class="page-title">${t('redCards')}</h1>
    <p class="note">${t('redCardsHelp')}</p>
    <div class="toolbar rc-filter">
      <button class="pill ${ui.rcDiv ? '' : 'active'}" data-rc-div="">${t('allDivisions')}</button>
      ${divPills(ui.rcDiv || '', 'data-rc-div')}
    </div>

    <form class="card season-form" data-form="red-card">
      <h2>＋ ${t('addRedCard')}</h2>
      <div class="league-grid">
        <label class="field">${t('division')}<select class="select" name="div" data-change="rc-div">
          <option value="" ${ui.rcDiv ? '' : 'selected'} disabled>${t('chooseOne')}</option>
          ${DIVISIONS.map(d => `<option value="${d.id}" ${d.id === ui.rcDiv ? 'selected' : ''}>${esc(divName(d.id))}</option>`).join('')}</select></label>
        <label class="field">${t('team')}<select class="select" name="team" data-change="rc-team" ${ui.rcDiv ? addTeamAttrs(ui.rcDiv, 'rc-team') : 'disabled'}>${ui.rcDiv ? rcTeamOptions(ui.rcDiv, '') + addTeamOpt() : `<option value="">${t('chooseOne')}</option>`}</select></label>
        <label class="field">${t('player')}<input class="input" name="player" autocomplete="off" autocorrect="off" spellcheck="false"></label>
      </div>
      <div class="league-grid">
        <label class="field">${t('rcGame')}<select class="select" name="match" disabled><option value="">${t('chooseOne')}</option></select></label>
        <label class="field">${t('rcGamesOut')}<input class="input" name="games" type="number" min="1" max="20" inputmode="numeric" value="1"></label>
      </div>
      <label class="field">${t('refReport')}<textarea class="input" name="reason" rows="2" placeholder="${t('rcReasonHint')}"></textarea></label>
      <label class="field">${t('staffNotes')} <span class="muted small">(${t('optional')})</span><textarea class="input" name="staffNotes" rows="2" placeholder="${t('staffNotesHint')}"></textarea></label>
      <p class="warn" hidden></p>
      <button class="btn btn-gold" type="submit">${t('addRedCardBtn')}</button>
    </form>

    ${ui.rcDiv ? `<div class="rc-team-filter"><label class="field">${t('showTeam')}<select class="select" data-change="rc-filter-team" aria-label="${t('team')}"><option value="">${t('allTeams')}</option>${rcTeams.map(n => `<option ${n === ui.rcTeam ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>` : ''}
    ${ui.rcTeam ? teamBanner(ui.rcTeam, ui.rcDiv) : ''}
    <section class="reg-section">
      <h2 class="section-title">${t('rcActive')} <span class="muted">(${active.length})</span></h2>
      <div class="rc-grid">${active.map(card).join('') || empty(t('rcNoneActive'))}</div>
    </section>
    ${served.length ? `<section class="reg-section">
      <h2 class="section-title">${t('rcServedTitle')} <span class="muted">(${served.length})</span></h2>
      <div class="rc-grid">${served.map(card).join('')}</div>
    </section>` : ''}
`);
}

// ---------- Proof of Age (Admin → Proof of Age) ----------
// A coach asks to see a player's documents again. The report (player, their team, who reported it, when)
// waits under Pending; once the documents are checked it's finished with who checked them, their role,
// what was brought and whether the age was confirmed. Admin only: none of this shows on the site.
const PA_DOCS = ['paDocPassport', 'paDocBirth', 'paDocStateId', 'paDocOther'];
const paDocText = c => (c.check.doc === 'paDocOther' ? `${t('paDocOther')}: ${c.check.docOther || '—'}` : t(c.check.doc));
// Game days of a division as "Game 9 · Sun, Oct 25" (value = the date).
const paGameDays = div => [...new Set([...state.matches, ...forfeitStubs(div)].filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
const paGameLabel = (div, date) => `${t('game')} ${gameNumber(div, date)} · ${fmtDate(date)}`;
// A person's role: Coach, Assistant coach, or Other (typed in).
const PA_ROLES = ['paRoleCoach', 'paRoleAsst', 'paRoleOther'];
function paRoleFields(name, role, other) {
  return `<label class="field">${t('paRole')}<select class="select" name="${name}" data-change="pa-role">
      <option value="" ${role ? '' : 'selected'}>${t('chooseOne')}</option>
      ${PA_ROLES.map(k => `<option value="${k}" ${k === role ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
    <label class="field pa-role-other" ${role === 'paRoleOther' ? '' : 'hidden'}>${t('paRoleOtherWhat')}<input class="input" name="${name}Other" autocomplete="off" value="${esc(other || '')}"></label>`;
}
const paRoleText = (role, other) => (!role ? '' : role === 'paRoleOther' ? other || t('paRoleOther') : PA_ROLES.includes(role) ? t(role) : role);
function paTeamSelect(name, div, current, others) {
  const mine = [...(state.teams[div] || [])].sort((a, b) => a.localeCompare(b));
  // "Reported by" can also be a team from another division (listed after, with its division).
  const rest = others ? DIVISIONS.filter(d => d.id !== div).flatMap(d => (state.teams[d.id] || []).map(tm => [`${tm} (${divName(d.id)})`, tm, d.id])) : [];
  return `<select class="select" name="${name}" ${div ? '' : 'disabled'}>
    <option value="" ${current ? '' : 'selected'} ${others ? '' : 'disabled'}>${t(others ? 'paNotSure' : 'chooseOne')}</option>
    ${mine.map(tm => `<option value="${esc(tm)}" ${tm === current ? 'selected' : ''}>${esc(tm)}</option>`).join('')}
    ${rest.length ? `<optgroup label="${t('paOtherDivisions')}">${rest.map(([label, tm, d]) => `<option value="${esc(`${tm}|${d}`)}" ${`${tm}|${d}` === current ? 'selected' : ''}>${esc(label)}</option>`).join('')}</optgroup>` : ''}
  </select>`;
}
// The report fields (new report, or editing one).
// A label with "(optional)" kept on its own line, so the boxes in a row line up.
const paLbl = (k, optional) => `<span class="pa-lbl">${t(k)}${optional ? ` <span class="muted small">(${t('optional')})</span>` : ''}</span>`;
function paReportFields(c = {}) {
  const div = c.div || ui.paDiv || '';
  const days = div ? paGameDays(div) : [];
  return `<div class="pa-grid">
      <label class="field">${t('division')}<select class="select" name="div" data-change="pa-div">
        <option value="" ${div ? '' : 'selected'} disabled>${t('chooseOne')}</option>
        ${DIVISIONS.filter(d => !isTour(d)).map(d => `<option value="${d.id}" ${d.id === div ? 'selected' : ''}>${esc(divName(d.id))}</option>`).join('')}</select></label>
      <label class="field">${t('paPlayer')}<input class="input" name="player" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(c.player || '')}"></label>
      <label class="field">${t('paPlayerTeam')}${paTeamSelect('team', div, c.team, false)}</label>
      <label class="field">${t('paReportedBy')}${paTeamSelect('by', div, c.byDiv && c.byDiv !== div ? `${c.by}|${c.byDiv}` : c.by, true)}</label>
    </div>
    <div class="pa-grid">
      <label class="field">${paLbl('paReporterName', true)}<input class="input" name="reporter" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(c.reporter || '')}"></label>
      ${paRoleFields('reporterRole', c.reporterRole, c.reporterRoleOther)}
    </div>
    <div class="pa-grid">
      <label class="field">${paLbl('paGame', true)}<select class="select" name="game" data-change="pa-game" ${div ? '' : 'disabled'}>
        <option value="">—</option>${days.map(d => `<option value="${d}" ${d === c.gameDate ? 'selected' : ''}>${esc(paGameLabel(div, d))}</option>`).join('')}</select></label>
      <label class="field">${paLbl('paDate', true)}<input class="input" name="date" type="date" value="${esc(c.date || '')}"></label>
    </div>
    <label class="field">${paLbl('paRefReport', true)}<textarea class="input" name="refReport" rows="2" placeholder="${t('paNotesHint')}">${esc(c.refReport || c.notes || '')}</textarea></label>
    <label class="field">${paLbl('staffNotes', true)}<textarea class="input" name="staffNotes" rows="2" placeholder="${t('staffNotesHint')}">${esc(c.staffNotes || '')}</textarea></label>`;
}
// Who checked the documents and what they found.
function paCheckFields(ck = {}) {
  return `<div class="pa-grid">
      <label class="field">${t('paCheckedBy')}<input class="input" name="checker" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(ck.name || '')}"></label>
      ${paRoleFields('role', PA_ROLES.includes(ck.role) ? ck.role : ck.role ? 'paRoleOther' : '', PA_ROLES.includes(ck.role) ? ck.roleOther : ck.roleOther || ck.role)}
      <label class="field">${t('paStaff')}<input class="input" name="staff" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(ck.staff || '')}" placeholder="${t('paStaffHint')}"></label>
      <label class="field">${t('paDoc')}<select class="select" name="doc" data-change="pa-doc">
        <option value="" ${ck.doc ? '' : 'selected'} disabled>${t('chooseOne')}</option>
        ${PA_DOCS.map(k => `<option value="${k}" ${k === ck.doc ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
      <label class="field pa-doc-other" ${ck.doc === 'paDocOther' ? '' : 'hidden'}>${t('paDocOtherWhat')}<input class="input" name="docOther" autocomplete="off" value="${esc(ck.docOther || '')}"></label>
      <label class="field">${t('paResult')}<select class="select" name="result">
        <option value="" ${ck.result ? '' : 'selected'} disabled>${t('chooseOne')}</option>
        <option value="ok" ${ck.result === 'ok' ? 'selected' : ''}>${t('paConfirmed')}</option>
        <option value="no" ${ck.result === 'no' ? 'selected' : ''}>${t('paNotConfirmed')}</option></select></label>
      <label class="field">${t('paCheckedOn')}<input class="input" name="on" type="date" value="${esc(ck.on || todayISO())}"></label>
    </div>
    <label class="field">${paLbl('staffNotes', true)}<textarea class="input" name="checkNotes" rows="2">${esc(ck.notes || '')}</textarea></label>`;
}
function readPaReport(form) {
  const f = new FormData(form);
  const div = f.get('div'), player = (f.get('player') || '').trim(), team = f.get('team') || '';
  const byRaw = f.get('by') || '';
  const [by, byDiv] = byRaw.includes('|') ? byRaw.split('|') : [byRaw, byRaw ? div : ''];
  const gameDate = f.get('game') || '';
  const missing = [[div, 'division'], [player, 'paPlayer'], [team, 'paPlayerTeam']].filter(([ok]) => !ok).map(([, k]) => t(k));
  const reporterRole = f.get('reporterRole') || '';
  if (reporterRole === 'paRoleOther' && !(f.get('reporterRoleOther') || '').trim()) missing.push(t('paRoleOtherWhat'));
  return { missing, data: { div, player, team, by, byDiv, gameDate, date: f.get('date') || gameDate, notes: '',
    refReport: (f.get('refReport') || '').trim(), staffNotes: (f.get('staffNotes') || '').trim(),
    reporter: (f.get('reporter') || '').trim(), reporterRole, reporterRoleOther: reporterRole === 'paRoleOther' ? (f.get('reporterRoleOther') || '').trim() : '' } };
}
function readPaCheck(form) {
  const f = new FormData(form);
  const ck = { name: (f.get('checker') || '').trim(), role: f.get('role') || '', roleOther: (f.get('roleOther') || '').trim(), staff: (f.get('staff') || '').trim(),
    doc: f.get('doc') || '', docOther: (f.get('docOther') || '').trim(), result: f.get('result') || '', on: f.get('on') || todayISO(), notes: (f.get('checkNotes') || '').trim() };
  if (ck.role !== 'paRoleOther') delete ck.roleOther;
  const missing = [[ck.name, 'paCheckedBy'], [ck.role, 'paRole'], [ck.role !== 'paRoleOther' || ck.roleOther, 'paRoleOtherWhat'], [ck.staff, 'paStaff'],
    [ck.doc, 'paDoc'], [ck.doc !== 'paDocOther' || ck.docOther, 'paDocOtherWhat'], [ck.result, 'paResult']]
    .filter(([ok]) => !ok).map(([, k]) => t(k));
  if (ck.doc !== 'paDocOther') delete ck.docOther;
  return { missing, ck };
}
function pageAdminAgeChecks() {
  const all = (state.ageChecks || []).filter(c => !ui.paFilter || c.div === ui.paFilter);
  const order = id => DIVISIONS.findIndex(d => d.id === id);
  // grouped by division (in the usual division order), newest first inside each
  const byDiv = list => [...new Set(list.map(c => c.div))].sort((a, b) => order(a) - order(b))
    .map(div => `<h3 class="reg-group">${esc(divName(div))}</h3><div class="rc-grid">${list.filter(c => c.div === div).sort((a, b) => (b.date || b.added).localeCompare(a.date || a.added)).map(paCard).join('')}</div>`).join('');
  const pending = all.filter(c => !c.check), done = all.filter(c => c.check);
  return adminShell('admin/agechecks', `
    <h1 class="page-title">${t('ageChecks')}</h1>
    <p class="note">${t('ageChecksHelp')}</p>
    <div class="toolbar rc-filter">
      <button class="pill ${ui.paFilter ? '' : 'active'}" data-pa-div="">${t('allDivisions')}</button>
      ${divPills(ui.paFilter || '', 'data-pa-div')}
    </div>
    <form class="card season-form" data-form="pa-add">
      <h2 class="pa-form-title">${t('paNewReport')}</h2>
      ${paReportFields()}
      <p class="warn" hidden></p>
      <button class="btn btn-gold" type="submit">${t('paAdd')}</button>
    </form>
    <section class="reg-section">
      <h2 class="section-title">${t('paPending')} <span class="muted">(${pending.length})</span></h2>
      ${byDiv(pending) || empty(t('paNonePending'))}
    </section>
    ${done.length ? `<section class="reg-section">
      <h2 class="section-title">${t('paDone')} <span class="muted">(${done.length})</span></h2>
      ${byDiv(done)}
    </section>` : ''}`);
}
function paCard(c) {
  const when = [c.gameDate ? paGameLabel(c.div, c.gameDate) : '', c.date && c.date !== c.gameDate ? fmtDate(c.date) : ''].filter(Boolean).join(' · ');
  const by = c.by ? `${c.by}${c.byDiv && c.byDiv !== c.div ? ` (${divName(c.byDiv)})` : ''}` : t('paNotSure');
  const ck = c.check;
  return `<article class="card rc-card pa-card ${ck ? (ck.result === 'ok' ? 'pa-ok' : 'pa-no') : 'pa-pending'}">
      <div class="rc-head">
        <div><b class="rc-player">${esc(c.player)}</b><span class="muted"> · ${esc(c.team)} · <span class="nowrap">${esc(divName(c.div))}</span></span></div>
        <span class="rc-tools">
          ${ck ? `<span class="tag ${ck.result === 'ok' ? 'pa-tag-ok' : 'pa-tag-no'}">${t(ck.result === 'ok' ? 'paConfirmed' : 'paNotConfirmed')}</span>` : ''}
          <button type="button" class="btn btn-sm btn-outline" data-action="pa-edit-open" data-id="${c.id}">${t('editGame')}</button>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-agecheck" data-id="${c.id}" aria-label="${t('remove')}">×</button>
        </span>
      </div>
      <p class="rc-line"><span class="muted">${t('paReportedBy')}:</span> ${esc(by)}</p>
      ${c.reporter || c.reporterRole ? `<p class="rc-line"><span class="muted">${t('paReporter')}:</span> ${esc(c.reporter || '—')}${c.reporterRole ? ` (${esc(paRoleText(c.reporterRole, c.reporterRoleOther))})` : ''}</p>` : ''}
      ${when ? `<p class="rc-line"><span class="muted">${t('paWhen')}:</span> ${esc(when)}</p>` : ''}
      ${c.refReport || c.notes ? `<p class="rc-line"><span class="muted">${t('refReport')}:</span> ${esc(c.refReport || c.notes)}</p>` : ''}
      ${c.staffNotes ? `<p class="rc-line"><span class="muted">${t('staffNotes')}:</span> ${esc(c.staffNotes)}</p>` : ''}
      ${ck ? `<p class="rc-line"><span class="muted">${t('paCheckedBy')}:</span> ${esc(ck.name)}${ck.role ? ` (${esc(paRoleText(ck.role, ck.roleOther))})` : ''} · ${fmtDate(ck.on)}</p>
        ${ck.staff ? `<p class="rc-line"><span class="muted">${t('paStaff')}:</span> ${esc(ck.staff)}</p>` : ''}
        <p class="rc-line"><span class="muted">${t('paDoc')}:</span> ${esc(paDocText(c))}</p>
        ${ck.notes ? `<p class="rc-line"><span class="muted">${t('staffNotes')}:</span> ${esc(ck.notes)}</p>` : ''}` : ''}
      ${!ck && ui.paFinish !== c.id && ui.paEdit !== c.id ? `<div class="row-actions"><button type="button" class="btn btn-sm btn-gold" data-action="pa-finish-open" data-id="${c.id}">${t('paFinish')}</button></div>` : ''}
      ${ui.paFinish === c.id ? `<form class="rc-edit" data-form="pa-finish" data-id="${c.id}">
          ${paCheckFields()}
          <p class="warn" hidden></p>
          <div class="edit-actions"><button type="button" class="btn btn-sm btn-outline" data-action="pa-close">${t('cancel')}</button>
            <button type="submit" class="btn btn-sm btn-gold">${t('paFinishSave')}</button></div>
        </form>` : ''}
      ${ui.paEdit === c.id ? `<form class="rc-edit" data-form="pa-edit" data-id="${c.id}">
          ${paReportFields(c)}
          ${ck ? `<p class="field-label">${t('paCheckPart')}</p>${paCheckFields(ck)}` : ''}
          <p class="warn" hidden></p>
          <div class="edit-actions"><button type="button" class="btn btn-sm btn-outline" data-action="pa-close">${t('cancel')}</button>
            <button type="submit" class="btn btn-sm btn-gold">${t('saveChanges')}</button></div>
        </form>` : ''}
    </article>`;
}
function savePaForm(form, kind) {
  const warn = form.querySelector('.warn');
  const list = state.ageChecks || [];
  const c = kind === 'add' ? null : list.find(x => x.id === form.dataset.id);
  if (kind !== 'add' && !c) return;
  const rep = kind === 'finish' ? null : readPaReport(form);
  const chk = kind === 'finish' || (kind === 'edit' && c.check) ? readPaCheck(form) : null;
  const missing = [...(rep ? rep.missing : []), ...(chk ? chk.missing : [])];
  if (missing.length) { warn.textContent = `${t('fillIn')}: ${missing.join(', ')}`; warn.hidden = false; return; }
  if (kind === 'add') {
    const n = { id: `pa${Date.now().toString(36)}`, added: todayISO(), ...rep.data };
    state.ageChecks = [...list, n];
    logAction(`${t('ageChecks')} · ${divName(n.div)}: ${t('paLogAdded')} ${n.team}`);
    ui.paDiv = n.div;
  } else {
    if (rep) Object.assign(c, rep.data);
    if (chk) c.check = chk.ck;
    logAction(`${t('ageChecks')} · ${divName(c.div)}: ${kind === 'finish' ? t('paLogFinished') : t('paLogEdited')} (${c.team})`);
    state.ageChecks = [...list];
  }
  ui.paFinish = null; ui.paEdit = null;
  save(); render();
  return toast(kind === 'add' ? t('paAddedToast') : kind === 'finish' ? t('paFinishedToast') : t('saved'));
}

function addRedCard(form) {
  const f = new FormData(form);
  const warn = form.querySelector('.warn');
  const div = f.get('div'), team = f.get('team'), player = (f.get('player') || '').trim();
  const m = state.matches.find(x => x.id === +f.get('match'));
  const games = parseInt(f.get('games'), 10);
  const missing = [[div, 'division'], [team, 'team'], [player, 'player'], [m, 'rcGame'], [games >= 1 && games <= 20, 'rcGamesOut']]
    .filter(([ok]) => !ok).map(([, k]) => t(k));
  if (missing.length) { warn.textContent = `${t('fillIn')}: ${missing.join(', ')}`; warn.hidden = false; return; }
  const c = { id: `rc${Date.now().toString(36)}`, div, team, player, matchId: m.id, date: m.date, games, reason: (f.get('reason') || '').trim(), staffNotes: (f.get('staffNotes') || '').trim() };
  state.redCards = [...(state.redCards || []), c];
  logAction(`${t('rcAdded')} · ${divName(div)}: ${player} (${team}) · ${gamesCount(games)}`);
  save(); render();
  return toast(`${t('rcAdded')}: ${player}`);
}

function pageAdminHistory() {
  const log = [...(state.log || [])].reverse();
  const byDay = groupBy(log, e => e.at.slice(0, 10));
  return adminShell('admin/history', `
    <h1 class="page-title">${t('history')}</h1>
    <p class="note">${t('historyHelp')}</p>
    ${log.length ? [...byDay].map(([day, items]) => `
      <section class="history-day">
        <h3>${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>
        <ul class="history-list">${items.map(e => `<li class="${e.undone ? 'is-undone' : ''}">
          <span class="h-time">${new Date(e.at).toLocaleTimeString(LANG === 'es' ? 'es-MX' : 'en-US', { hour: 'numeric', minute: '2-digit' })}</span>
          <span class="h-text">${esc(e.text)}${e.by ? `<small class="h-by"> · ${esc(nameFromEmail(e.by))}</small>` : ''}</span>
          ${e.patch || e.undo ? e.undone
            ? `<span class="tag">${t('undoneTag')}</span>`
            : `<button type="button" class="btn btn-sm btn-outline" data-action="ask" data-confirm="log-undo" data-id="${e.id}"
                data-ask="${e.text.startsWith(`${t('logUndone')}:`) ? 'redoQ' : 'undoQ'}" data-yes="yesUndo">↶ ${t('undo')}</button>` : ''}
        </li>`).join('')}</ul>
      </section>`).join('') : empty(t('historyEmpty'))}`);
}

// ---------- undo for deletes ----------
// Every delete saves a copy of the data first; the message after it has an Undo button for a few
// seconds that puts everything back. (A blank Goleadores row just goes back where it was.)
let undoRestore = null;
function undoable(label, restore) {
  const snap = JSON.stringify(state);
  undoRestore = restore || (() => {
    state = JSON.parse(snap);
    for (let i = DIVISIONS.length - 1; i >= 0; i--) if (DIVISIONS[i].custom) DIVISIONS.splice(i, 1);
    (state.leagues || []).forEach(addDivision);
    applyFieldChanges();
    save(); render();
  });
  // Show it after the delete has finished (and replaced any message of its own).
  setTimeout(() => {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${esc(label)}</span><button type="button" class="toast-undo" data-action="undo">↶ ${t('undo')}</button>`;
    el.classList.add('show', 'has-undo');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.classList.remove('show', 'has-undo'); undoRestore = null; }, 7000);
  }, 0);
}

const LOGO = `<img class="logo" src="images/logo.png" alt="">`;

// ---------- shared components ----------

// Futsal has standings but no goleadores. An added league says whether it keeps goleadores.
const hasScorers = div => {
  const league = customLeague(div);
  if (league && league.scorers !== undefined) return league.scorers;
  const set = (state.scorersSet || {})[div];
  return set !== undefined ? set : groupOf(div) !== 'futsal';
};
const scorerDiv = div => (hasScorers(div) ? div : '40');

function divPills(active, attr = 'data-div', { scorers = false, tours = false } = {}) {
  const btn = d => `<button class="pill ${d.id === active ? 'active' : ''}" ${attr}="${d.id}">${esc(divName(d.id))}</button>`;
  const shown = d => !isTour(d) && (!scorers || hasScorers(d.id));
  const menu = (group, label, title) => {
    const list = DIVISIONS.filter(d => d.group === group && shown(d));
    if (!list.length) return '';
    const current = list.find(d => d.id === active);
    return `<details class="dd">
      <summary class="pill ${current ? 'active' : ''}">${t(label)}${current ? ' · ' + esc(divName(current.id).replace(/^Futsal /, '')) : ''} <span class="caret">▾</span></summary>
      <div class="dd-menu">
        <p class="dd-title">${t(title)}</p>
        <div class="dd-grid ${group}">${list.map(btn).join('')}</div>
      </div>
    </details>`;
  };
  return `<div class="picker">
    ${DIVISIONS.filter(d => d.group === 'adult' && shown(d)).map(btn).join('')}
    ${menu('youth', 'youth', 'youthDivisions')}
    ${menu('futsal', 'futsal', 'futsalDivisions')}
    ${tours ? toursMenu(active, attr, btn) : ''}
  </div>`;
}
// Tournaments: pick the tournament, then its division.
function toursMenu(active, attr, btn) {
  const list = [...tournaments()].sort((a, b) => b.dates[0].localeCompare(a.dates[0])).filter(x => tourDivs(x).length);
  if (!list.length) return '';
  const cur = DIVISIONS.find(d => d.id === active && isTour(d));
  const short = d => `<button class="pill ${d.id === active ? 'active' : ''}" ${attr}="${d.id}">${esc(d.short || divName(d.id))}</button>`;
  return `<details class="dd">
    <summary class="pill ${cur ? 'active' : ''}">${t('tournaments')}${cur ? ` · ${esc(divName(cur.id))}` : ''} <span class="caret">▾</span></summary>
    <div class="dd-menu tour-dd">${list.map(x => `<p class="dd-title">${esc(x.name)} <span class="muted">· ${esc(tourWhen(x))}</span></p>
      <div class="dd-grid">${tourDivs(x).map(short).join('')}</div>`).join('')}</div>
  </details>`;
}

// A postponed game stays under its game day (e.g. Game 3) but shows the date it was played.
const playedDate = m => m.playedOn || m.date;
// The most recent day this division plays, today included (last Sunday for most divisions).
function lastPlayDay(div) {
  const d = DIVISIONS.find(x => x.id === div);
  const today = todayISO();
  return addDays(today, -((dayOfWeek(today) - (DAY_NUM[d ? d.day : 'Sun'] ?? 0) + 7) % 7));
}
// A postponed game keeps its original slot on the schedule; the time and field it was really played
// at are kept separately (playedTime, playedField).
const shownTime = m => (m.postponed ? m.playedTime || '' : m.time);
const shownField = m => FIELDS[m.playedField || m.field] || m.playedField || m.field;
const postponedTag = m => (m.playedOn ? `<span class="tag postponed">${t('playedLater')}</span>`
  : m.postponed ? `<span class="tag postponed">${t('postponed')}</span>` : '');

function matchCard(game, showDiv) {
  // A game against a withdrawn team can count as a 3–0 forfeit.
  const r = resultOf(game);
  const m = r ? { ...game, ...r } : game;
  const done = !!r;
  const hw = done && m.hs > m.as, aw = done && m.as > m.hs;
  // Postponed with no new date yet: it stays under its game day and says the date is to be decided.
  const tbd = !m.left && notRescheduled(m);
  return `<article class="match ${done ? 'done' : 'upcoming'} ${tbd ? 'tbd' : ''}">
    <div class="match-meta">
      ${showDiv ? `<span class="tag">${esc(divName(m.div))}</span>` : ''}
      ${m.playoff ? `<span class="tag playoff-tag">${esc(roundLabel(m.div, m.playoff))}</span>` : ''}
      ${m.fromFriendly ? `<span class="tag filler-tag">${esc(friendlyCountTag(m))}</span>` : m.countOnly ? `<span class="tag filler-tag">${esc(countOnlyTag(m))}</span>` : m.fillerTeam ? `<span class="tag filler-tag">${t('fillerTag')}</span>` : ''}
      ${m.double ? `<span class="tag forfeit">${t('doubleForfeit')}</span>` : m.forfeit ? `<span class="tag forfeit">${t('forfeit')}</span>` : postponedTag(m)}
      <span>${tbd ? t('newDateTbd') : m.left ? fmtDate(m.date) : `${fmtDate(playedDate(m))}${shownTime(m) ? ` · ${esc(shownTime(m))}` : ''}`}</span>
      ${tbd || m.left ? '' : `<span class="field-name">${esc(shownField(m))}</span>`}
    </div>
    <div class="match-body">
      <span class="team home ${hw ? 'win' : ''}"><span class="team-in"><span class="tn">${esc(m.home)}</span>${publicLogo(m.home, false, m.div)}</span></span>
      ${m.double ? `<span class="score double-ff" title="${t('bothLose30')}"><b>L</b><i>–</i><b>L</b></span>` : done
        ? `<span class="score"><b>${m.hs}</b><i>–</i><b>${m.as}</b>${m.pens ? `<small class="pens">${t('pensShort')} ${m.pens[0]}–${m.pens[1]}</small>` : ''}</span>`
        : `<span class="score pending">${tbd ? 'TBD' : t('vs')}</span>`}
      <span class="team away ${aw ? 'win' : ''}"><span class="team-in">${publicLogo(m.away, false, m.div)}<span class="tn">${esc(m.away)}</span></span></span>
    </div>
    ${m.double ? `<p class="double-ff-note">${t('bothLose30')}</p>` : ''}
  </article>`;
}

function empty(msg) {
  return `<p class="empty">${esc(msg)}</p>`;
}

// ---------- public pages ----------

function formChips(form) {
  // the first one is the most recent game: underlined in its result's color
  return `<span class="form">${form.map((f, i) => `<i class="f-${f}${i === 0 ? ' latest' : ''}">${f === 'W' ? t('won') : f === 'D' ? t('drawn') : t('lost')}</i>`).join('')}</span>`;
}

// Small team logo for public pages. No logo means nothing is shown (a blank spacer in tables so names line up).
// A team's logo in a division: an upload for that division, then the built-in exception, then an upload
// for the name, then the built-in logo. '' anywhere along the way means "no logo".
function teamLogo(name, div) {
  const own = state.logos || {};
  const key = `${div}|${name}`;
  if (div && key in own) return own[key];
  if (name in own) return own[name];
  if (div && key in DIVISION_LOGOS) return DIVISION_LOGOS[key];
  if (div && key in LOGO_EXCEPTIONS) return LOGO_EXCEPTIONS[key];
  return TEAM_LOGOS[name] || '';
}

function publicLogo(name, spacer, div) {
  const logo = teamLogo(name, div);
  if (logo) return `<img class="mini-logo" src="${logo}" alt="">`;
  return spacer ? '<span class="mini-logo" aria-hidden="true"></span>' : '';
}

// Teams hidden from the standings (Teams → Edit team) still play and count, so every other team's numbers
// stay right; their row just isn't shown, and the places are numbered without them.
const hiddenFromStandings = div => new Set((state.standingsHidden || {})[div] || []);
const shownStandings = div => standings(div).filter(r => !hiddenFromStandings(div).has(r.team));
function standingsTable(div, compact, limit, past) {
  const rows = (past ? standings(div, past.matches, past.teams, past.withdrawn || []) : shownStandings(div)).slice(0, limit);
  const full = !compact;
  return `<div class="table-card">
    <table class="table standings">
      <thead><tr>
        <th>${t('pos')}</th><th class="left">${t('team')}</th><th>${t('played')}</th>
        ${full ? `<th>${t('won')}</th><th>${t('drawn')}</th><th>${t('lost')}</th><th class="hide-sm">${t('gf')}</th><th class="hide-sm">${t('ga')}</th>` : ''}
        <th>${t('gd')}</th><th>${t('pts')}</th><th class="hide-sm form-col">${t('form')}</th>
      </tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${['top', 'second', 'third'][i] || ''}">
        <td class="rank">${i + 1}</td><td class="left team-cell"><span class="team-with-logo">${publicLogo(r.team, true, div)}${esc(r.team)}</span></td><td>${r.p}</td>
        ${full ? `<td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td class="hide-sm">${r.gf}</td><td class="hide-sm">${r.ga}</td>` : ''}
        <td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td>
        <td class="hide-sm form-col">${formChips([...r.form].reverse())}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

// The top `limit` scorers, in Goleadores order (ties already go by the teams' places in the standings).
const topScorers = (all, limit) => all.slice(0, limit);

function scorerList(div, limit, past) {
  const all = past ? leaders(div, past.scorers, past) : leaders(div);
  const list = limit ? topScorers(all, limit) : all;
  const max = all[0] ? all[0].goals : 1;
  // Numbered 1, 2, 3… down the list, ties included.
  return list.length ? `<ol class="scorer-list ${limit ? 'compact' : ''}">${list.map((s, i) => {
    const r = i + 1;
    return `<li class="scorer ${r <= 3 ? 'podium p' + r : ''}">
      <span class="rank">${r}</span>
      <span class="who"><strong>${esc(s.name)}</strong><small class="team-with-logo">${publicLogo(s.team, false, div)}${esc(s.team)}</small>
        <span class="bar"><span style="width:${Math.round(s.goals / max * 100)}%"></span></span></span>
      <span class="goals">${s.goals}</span>
    </li>`;
  }).join('')}</ol>` : empty(t('noMatches'));
}

const TROPHY = `<svg class="trophy" viewBox="0 0 120 120" aria-hidden="true">
  <path d="M38 18h44v24c0 14-10 26-22 26S38 56 38 42Z" fill="#d4a72c"/>
  <path d="M38 27H25c0 14 8 22 17 22M82 27h13c0 14-8 22-17 22" fill="none" stroke="#d4a72c" stroke-width="6"/>
  <rect x="54" y="66" width="12" height="16" fill="#b8901f"/>
  <rect x="40" y="82" width="40" height="10" rx="2" fill="#d4a72c"/>
  <rect x="34" y="92" width="52" height="9" rx="2" fill="#7d600f"/>
</svg>`;

// ---------- Home page text (Admin → Home Page) ----------
// Each piece of text can be changed for each language (state.homePage.en / .es); an empty box uses the
// built-in text. The links are the same in both languages (state.homePage.links).
const HOME_TEXT = {
  heroTitle: () => 'LA Alhambra Soccer League', heroSub: () => t('heroSub'),
  btn1: () => t('viewStandings'), btn2: () => t('viewScorers'),
  regEyebrow: () => t('register'), regTitle2: () => t('regCardTitle'), regSub2: () => t('regCardSub'), regBtn: () => t('registerNow'),
  aboutEyebrow: () => t('aboutUs'), aboutTitle2: () => t('aboutCardTitle'), aboutSub2: () => t('aboutCardSub'), aboutBtn: () => t('learnMore'),
  leadersTitle: () => t('leadersTitle'), fieldsTitle: () => t('ourFields'),
};
const HOME_LINKS = { btn1: '#/standings', btn2: '#/scorers', regLink: '#/register', aboutLink: '#/about' };
const hp = k => ((state.homePage || {})[LANG] || {})[k] || HOME_TEXT[k]();
const hpLink = k => ((state.homePage || {}).links || {})[k] || HOME_LINKS[k];
const hrefAttrs = url => (url.startsWith('#') ? `href="${esc(url)}"` : `href="${esc(url)}" target="_blank" rel="noopener"`);
const homeLink = (k, cls, icon) => `<a class="${cls}" ${hrefAttrs(hpLink(k))}>${hp(k) === HOME_TEXT[k]() ? icon : ''}${esc(hp(k))}${hpLink(k).startsWith('#') ? '' : ' ↗'}</a>`;
function pageAdminHome() {
  const hpData = state.homePage || {};
  const mine = (hpData[LANG] || {}), links = hpData.links || {};
  const txt = (k, long) => `<label class="field">${t(`hp_${k}`)}${long
    ? `<textarea class="input" rows="3" data-change="hp-text" data-k="${k}" placeholder="${esc(HOME_TEXT[k]())}">${esc(mine[k] || '')}</textarea>`
    : `<input class="input" data-change="hp-text" data-k="${k}" value="${esc(mine[k] || '')}" placeholder="${esc(HOME_TEXT[k]())}">`}</label>`;
  const link = k => `<label class="field">${t('hp_link')}<input class="input" data-change="hp-link" data-k="${k}" value="${esc(links[k] || '')}" placeholder="${esc(HOME_LINKS[k])}"></label>`;
  const box = (title, inner) => `<section class="card hp-card"><h3>${t(title)}</h3><div class="hp-fields">${inner}</div></section>`;
  return adminShell('admin/homepage', `
    <h1 class="page-title">${t('homePageNav')}</h1>
    <p class="note">${t('hpHelp').replace('{lang}', LANG === 'es' ? 'Español' : 'English')} <a href="#/" target="_blank" rel="noopener">${t('hpView')} ↗</a></p>
    ${box('hp_banner', `${txt('heroTitle')}${txt('heroSub', true)}${txt('btn1')}${link('btn1')}${txt('btn2')}${link('btn2')}`)}
    ${box('hp_regCard', `${txt('regEyebrow')}${txt('regTitle2')}${txt('regSub2', true)}${txt('regBtn')}${link('regLink')}`)}
    ${box('hp_aboutCard', `${txt('aboutEyebrow')}${txt('aboutTitle2')}${txt('aboutSub2', true)}${txt('aboutBtn')}${link('aboutLink')}`)}
    ${box('hp_sections', `${txt('leadersTitle')}${txt('fieldsTitle')}`)}
    ${state.homePage ? `<div class="row-actions"><button type="button" class="btn btn-outline danger-outline" data-action="ask" data-confirm="hp-reset" data-ask="hpResetQ">${t('hpReset')}</button></div>` : ''}`);
}
function pageHome() {
  const d = ui.div;
  return `
  <section class="banner has-slides">
    ${bannerSlidesHTML()}
    <div class="wrap banner-inner">
      ${LOGO}
      <div>
        <h1>${esc(hp('heroTitle'))}</h1>
        <p class="lead">${esc(hp('heroSub'))}</p>
        <div class="actions">
          ${homeLink('btn1', 'btn btn-gold', '🏆 ')}
          ${homeLink('btn2', 'btn btn-ghost', '⚽ ')}
        </div>
      </div>
    </div>
  </section>
  <div class="wrap promo-grid">
    <a class="promo promo-register" ${hrefAttrs(hpLink('regLink'))}>
      <div class="promo-art">${TROPHY}${TROPHY}${TROPHY}</div>
      <div class="promo-text">
        <span class="eyebrow">${esc(hp('regEyebrow'))}</span>
        <h2>${esc(hp('regTitle2'))}</h2>
        <p>${esc(hp('regSub2'))}</p>
        <span class="btn btn-gold btn-sm">${esc(hp('regBtn'))} →</span>
      </div>
    </a>
    <a class="promo promo-about" ${hrefAttrs(hpLink('aboutLink'))}>
      <div class="promo-art pitch-art" aria-hidden="true"><span></span></div>
      <img class="promo-logo" src="images/logo.png" alt="">
      <div class="promo-text">
        <span class="eyebrow">${esc(hp('aboutEyebrow'))}</span>
        <h2>${esc(hp('aboutTitle2'))}</h2>
        <p>${esc(hp('aboutSub2'))}</p>
        <span class="btn btn-ghost btn-sm">${esc(hp('aboutBtn'))} →</span>
      </div>
    </a>
    ${instagramCard()}
  </div>
  <div class="wrap">
    <section class="leaders">
      <div class="section-head"><h2>${esc(hp('leadersTitle'))}</h2></div>
      ${divPills(d)}
      ${updatedNote(d)}
      <div class="leaders-grid ${hasScorers(d) ? '' : 'single'}">
        <div>
          <div class="mini-head"><h3>${t('standings')} · ${esc(divName(d))}</h3><a href="#/standings">${t('fullStandings')} →</a></div>
          ${standingsTable(d, true, 5)}
        </div>
        ${hasScorers(d) ? `<div>
          <div class="mini-head"><h3>${t('scorers')} · ${esc(divName(d))}</h3><a href="#/scorers">${t('allScorers')} →</a></div>
          ${scorerList(d, 5)}
        </div>` : ''}
      </div>
    </section>
  </div>
  <div class="wrap">
    <section>
      <div class="section-head"><h2>${esc(hp('fieldsTitle'))}</h2><a href="#/fields">${t('viewAll')} →</a></div>
      <div class="field-rows">${locations().map(loc => `<a class="field-row" target="_blank" rel="noopener" href="${mapsLink(loc.place)}">
        <span><strong>${esc(loc.place)}</strong><small class="muted">${esc(loc.labels.join(' · '))}${placeAddress(loc.place) ? ` · ${esc(placeAddress(loc.place))}` : ''}</small></span><span class="muted">${t('directions')} ↗</span></a>`).join('')}</div>
    </section>
  </div>`;
}

// Game day picker ("Game 9 · Sun, Oct 25, 2026") with ‹ › and "View all games", used on Scores and
// admin Enter scores. `key` is the ui field that remembers the choice; it opens on the latest game day.
// Public Scores only shows games once they have a score (postponed ones show as "to be determined").
const shownPublicly = m => played(m) || m.postponed || (m.forfeitBy && !!resultOf(m));
// Game days the picker lists: every one in admin; on the public page, only days with a game to show.
// Game numbers always count every game day.
// Forfeits from a withdrawn team's games left count too.
const pickerDays = (div, publicOnly) => [...new Set([...state.matches.filter(m => m.div === div && (!publicOnly || shownPublicly(m))),
  ...forfeitStubs(div).filter(m => !publicOnly || resultOf(m))].map(m => m.date))].sort();

function gameDayPicker(div, key, publicOnly = false) {
  const allDays = [...new Set([...state.matches, ...forfeitStubs(div)].filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
  const days = pickerDays(div, publicOnly);
  if (ui[key] !== 'all' && !days.includes(ui[key])) ui[key] = days.filter(d => d <= todayISO()).pop() || days[0] || 'all';
  const day = ui[key];
  const idx = days.indexOf(day);
  const label = (d, short) => `${allDays.includes(d) ? `${t('game')} ${allDays.indexOf(d) + 1}` : playoffDay(div, d) || t('playoffs')} · ${fmtDate(d, short
    ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  const attrs = `data-key="${key}" data-for="${div}" ${publicOnly ? 'data-public="1"' : ''}`;
  const html = days.length ? `<div class="day-picker">
      <button type="button" class="icon-btn" data-action="score-day" data-step="-1" ${attrs} ${day === 'all' || idx <= 0 ? 'disabled' : ''} aria-label="${t('previous')}">‹</button>
      <select class="select" data-change="score-day" ${attrs} aria-label="${t('gameDay')}">
        <option value="all" ${day === 'all' ? 'selected' : ''}>${t('viewAllGames')}</option>
        ${days.map(d => `<option value="${d}" ${d === day ? 'selected' : ''}>${esc(label(d, true))}</option>`).join('')}
      </select>
      <button type="button" class="icon-btn" data-action="score-day" data-step="1" ${attrs} ${day === 'all' || idx >= days.length - 1 ? 'disabled' : ''} aria-label="${t('next')}">›</button>
    </div>` : '';
  return { day, html, label: d => (allDays.includes(d) ? label(d).replace(`${t('game')} ${allDays.indexOf(d) + 1} ·`, `${t('game')} ${allDays.indexOf(d) + 1} ${t('of')} ${gameColumns(div)} ·`) : label(d)) };
}

function teamFilter(teams) {
  return `<select class="select" data-change="team" aria-label="${t('team')}">
    <option value="">${t('allTeams')}</option>
    ${teams.map(n => `<option ${n === ui.team ? 'selected' : ''}>${esc(n)}</option>`).join('')}
  </select>`;
}

function pageScores() {
  const teams = state.teams[ui.div] || [];
  const list = [...state.matches.filter(shownPublicly), ...forfeitStubs(ui.div).filter(m => resultOf(m))]
    .filter(m => m.div === ui.div && (!ui.team || m.home === ui.team || m.away === ui.team));
  const { day, html: picker, label: dayLabel } = gameDayPicker(ui.div, 'scoreDay', true);
  if (day !== 'all') {
    const games = list.filter(m => m.date === day).sort(byDateTime);
    return `
  <div class="wrap page">
    <h1 class="page-title">${t('scores')}</h1>
    <div class="toolbar">${divPills(ui.div)}${teamFilter(teams)}</div>
    ${picker}
    ${ui.team && teams.includes(ui.team) ? teamBanner(ui.team, ui.div) : ''}
    <h2 class="sub">${esc(dayLabel(day))}</h2>
    <div class="stack">${games.map(m => matchCard(m)).join('') || empty(t('noMatches'))}</div>
  </div>`;
  }
  const results = [...list].sort((a, b) => byDateTime(b, a));
  const days = items => [...groupBy(items, m => m.date)].map(([date, ms]) => `
    <div class="day">
      <h3 class="day-title">${esc(dayLabel(date).replace(` ${t('of')} ${gameColumns(ui.div)}`, ''))}</h3>
      <div class="stack">${ms.map(m => matchCard(m)).join('')}</div>
    </div>`).join('');
  return `
  <div class="wrap page">
    <h1 class="page-title">${t('scores')}</h1>
    <div class="toolbar">${divPills(ui.div)}${teamFilter(teams)}</div>
    ${picker}
    ${ui.team && teams.includes(ui.team) ? teamBanner(ui.team, ui.div) : ''}
    <h2 class="sub">${t('latest')}</h2>
    ${days(results) || empty(t('noMatches'))}
  </div>`;
}

function bracketNodeHTML(n, admin) {
  const line = (team, seed, side) => {
    const g = side === 'a' ? n.ga : n.gb;
    const win = n.winner && n.winner === team;
    return `<div class="br-team ${win ? 'win' : ''} ${n.winner && !win ? 'out' : ''}">
      ${seed ? `<span class="br-seed">${seed}</span>` : '<span class="br-seed"></span>'}
      <span class="br-name">${team ? `${publicLogo(team, false, n.div)}${esc(team)}` : `<span class="muted">${t(n.bye ? 'byeLabel' : 'tbd')}</span>`}</span>
      <span class="br-score">${g !== undefined && n.games.some(played) ? g : ''}</span>
    </div>`;
  };
  const legs = n.games.filter(played).map(m => `${m.home === n.a ? m.hs : m.as}–${m.home === n.a ? m.as : m.hs}`);
  const notes = [];
  if (n.bye) notes.push(t('byeLabel'));
  if (n.legs > 1 && legs.length) notes.push(`${t('legsLabel')}: ${legs.join(', ')}`);
  if (n.pens) notes.push(`${t('pensShort')} ${n.pens[0]}–${n.pens[1]}`);
  if (n.bySeed) notes.push(t('wonOnSeed'));
  if (n.walkover) notes.push(`${esc(n.loser)} ${t('tookOutShort')}`);
  const next = n.games.find(m => !played(m));
  if (next && !n.winner) notes.push(`${fmtDate(next.date)}${next.time ? ` · ${esc(next.time)}` : ''}`);
  let pick = '';
  if (admin && n.tied && !n.winner) {
    pick = `<label class="field br-pick">${t('whoAdvances')}<select class="select" data-change="po-pick" data-key="${n.key}" data-cup="${n.cup}">
      <option value="">${t('chooseOne')}</option>${[n.a, n.b].map(x => `<option>${esc(x)}</option>`).join('')}</select></label>`;
  }
  return `<div class="br-node ${n.bye ? 'bye' : ''}">
    ${line(n.a, n.aSeed, 'a')}${n.bye ? '' : line(n.b, n.bSeed, 'b')}
    ${notes.length ? `<p class="br-note">${notes.join(' · ')}</p>` : ''}${pick}
  </div>`;
}

function bracketHTML(div, admin, cup = 'playoffs', past = null) {
  const b = bracket(div, cup, past);
  if (!b) return empty(t(cup === 'copa' ? 'noCopaKo' : 'noPlayoffs'));
  // An archived season already shows its champions at the top of the page.
  return `${b.champion && !past ? `<p class="champion">${t('champion')}: <b>${esc(b.champion)}</b></p>` : ''}
    <div class="bracket">${b.rounds.map((r, i) => `<div class="br-col">
      <h3>${t(r.key)}</h3>
      ${r.nodes.map(n => bracketNodeHTML(n, admin)).join('')}
      ${i === b.rounds.length - 1 && b.third ? `<h3 class="br-third">${t('thirdPlace')}</h3>${bracketNodeHTML(b.third, admin)}` : ''}
    </div>`).join('')}</div>`;
}

// Round robin: the table leader once every game has a score.
function copaChampion(div) {
  const co = copaOf(div);
  if (!co) return '';
  if (co.ko) return (bracket(div, 'copa') || {}).champion || '';
  if (!co.roundRobin) return '';
  const g = co.groups[0];
  const need = (g.teams.length * (g.teams.length - 1) / 2) * (co.groupLegs || 1);
  const done = state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && m.playoff.group === g.name && played(m)).length;
  return done >= need ? copaGroupTable(div, g)[0].team : '';
}

// Copa groups: one small table per group, with how many of its games are done.
function copaGroupsHTML(div) {
  const co = copaOf(div);
  if (!co || !co.groups) return '';
  return `<div class="copa-groups">${co.groups.map(g => {
    const rows = copaGroupTable(div, g);
    const need = (g.teams.length * (g.teams.length - 1) / 2) * (co.groupLegs || 1);
    const done = state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && m.playoff.group === g.name && played(m)).length;
    return `<div class="card copa-group"><h3>${co.roundRobin ? t('tableWord') : `${t('group')} ${esc(g.name)}`} <span class="muted">${t('groupPlayed').replace('{x}', done).replace('{y}', need)}</span></h3>
      <table class="table standings compact-table"><thead><tr><th>${t('pos')}</th><th class="left">${t('team')}</th><th>${t('played')}</th><th>${t('gd')}</th><th>${t('pts')}</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${i < (co.roundRobin ? 1 : co.advance || 1) ? 'top' : ''}"><td class="rank">${i + 1}</td><td class="left team-cell"><span class="team-with-logo">${publicLogo(r.team, true, div)}${esc(r.team)}</span></td><td>${r.p}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`).join('')}</tbody></table>
    </div>`;
  }).join('')}</div>`;
}

// A division without playoffs yet: just say the regular season is still going.
function notStartedHTML(div) {
  const days = new Set(state.matches.filter(m => m.div === div && !m.playoff && played(m)).map(m => m.date)).size;
  return `<div class="card po-wait">
    <h2>${t('playoffsNotYet')}</h2>
    <p class="muted">${t('playoffsNotYetText')}${days ? ` <b>${t('game')} ${days} ${t('of')} ${gameColumns(div)}</b>.` : ''}</p>
    <a class="btn btn-outline btn-sm" href="#/standings">${t('standings')} →</a>
  </div>`;
}

function publicTournamentsHTML() {
  const list = [...tournaments()].sort((a, b) => b.dates[0].localeCompare(a.dates[0]));
  if (!list.length) return '';
  const tour = list.find(x => x.id === ui.pubTour) || list[0];
  const divs = tourDivs(tour);
  const cur = divs.find(d => d.id === ui.pubTourDiv) || divs[0];
  return `<section class="copa-section"><h2 class="section-title">${t('tournaments')}</h2>
    ${list.length > 1 ? `<div class="pills">${list.map(x => `<button class="pill ${x.id === tour.id ? 'active' : ''}" data-action="pub-tour" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : `<h3>${esc(tour.name)}</h3>`}
    <p class="muted">${esc(tourWhen(tour))}</p>
    <div class="pills">${divs.map(d => `<button class="pill ${d.id === cur.id ? 'active' : ''}" data-action="pub-tour-div" data-id="${d.id}">${esc(d.short || divName(d.id))}</button>`).join('')}</div>
    ${copaOf(cur.id) ? `<div class="updated-row cup-export">${exportButtons('tour', cur.id)}</div>` : ''}
    ${copaChampion(cur.id) ? `<p class="champion">${t('champion')}: <b>${esc(copaChampion(cur.id))}</b></p>` : ''}
    ${copaOf(cur.id) ? `${copaGroupsHTML(cur.id)}${copaOf(cur.id).ko ? bracketHTML(cur.id, false, 'copa') : ''}` : empty(t('tourComingSoon'))}
  </section>`;
}

// The Copa is its own section under the playoffs, for the division picked at the top — only once one is made.
function publicCopaHTML() {
  const div = ui.div;
  const co = copaOf(div);
  if (!co) return '';
  return `<section class="copa-section"><div class="updated-row"><h2 class="section-title">${t('copa')}</h2>${exportButtons('copa', div)}</div>
    ${co.roundRobin && copaChampion(div) ? `<p class="champion">${t('champion')}: <b>${esc(copaChampion(div))}</b></p>` : ''}${copaGroupsHTML(div)}${co.ko ? bracketHTML(div, false, 'copa') : ''}
  </section>`;
}

function pagePlayoffs() {
  return `
  <div class="wrap page">
    <h1 class="page-title">${t('playoffs')}</h1>
    <div class="toolbar">${divPills(ui.div)}</div>
    ${playoffsOf(ui.div) ? `<div class="updated-row cup-export">${exportButtons('playoffs')}</div>${bracketHTML(ui.div, false)}` : notStartedHTML(ui.div)}
    ${publicCopaHTML()}
    ${publicTournamentsHTML()}
  </div>`;
}

const cupTabs = () => `<div class="seg cup-tabs">${['playoffs', 'copa'].map(c => `<button class="${(ui.cupTab || 'playoffs') === c ? 'active' : ''}" data-action="cup-tab" data-cup="${c}">${t(c)}</button>`).join('')}</div>`;

function pageAdminPlayoffs() {
  if (ui.cupTab === 'copa') return pageAdminCopa();
  const div = ui.adminDiv;
  const po = playoffsOf(div);
  const rows = standings(div);
  if (!po) {
    const max = Math.min(16, rows.length);
    // Which rounds: checking one includes every round after it (a quarterfinal needs semis and a final).
    const ok = k => PLAYOFF_SIZES[k][0] <= max;
    let start = ui.poStart && ok(ui.poStart) ? ui.poStart : ok('semifinal') ? 'semifinal' : 'final';
    const [lo, hi] = PLAYOFF_SIZES[start];
    const size = Math.min(hi, max, Math.max(lo, ui.poSize || Math.min(hi, max)));
    const d = ui.poDraft || { tie: 'pens', roundLegs: {}, third: true };
    const firstDays = Array.from({ length: 10 }, (_, i) => addDays(lastPlayDay(div), 7 * (i + (lastPlayDay(div) < todayISO() ? 1 : 0))));
    const included = k => PLAYOFF_ROUNDS.indexOf(k) >= PLAYOFF_ROUNDS.indexOf(start);
    return adminShell('admin/playoffs', `
      <h1 class="page-title">${t('playoffs')}</h1>
      <div class="toolbar">${divPills(div, 'data-admin-div')}</div>
      ${cupTabs()}
      <p class="note">${t('playoffsHelp')}</p>
      ${rows.length < 2 ? empty(t('needTwoTeams')) : `<form class="card po-form" data-form="start-playoffs">
        <fieldset class="po-rounds"><legend>${t('whichRounds')}</legend>
          ${PLAYOFF_ROUNDS.map(k => `<label class="check-line ${ok(k) ? '' : 'disabled'}"><input type="checkbox" data-change="po-round" value="${k}"
            ${included(k) ? 'checked' : ''} ${k === 'final' || !ok(k) ? 'disabled' : ''}> ${t(k)}${ok(k) ? '' : ` <span class="muted">(${t('notEnoughTeams')})</span>`}</label>`).join('')}
          <label class="check-line"><input type="checkbox" name="third" data-change="po-third" ${d.third ? 'checked' : ''}> ${t('thirdQ')}</label>
        </fieldset>
        <div class="league-grid">
          <label class="field">${t('playoffTeams')}<select class="select" name="size" data-change="po-size">
            ${Array.from({ length: Math.min(hi, max) - lo + 1 }, (_, i) => lo + i).map(n => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label class="field">${t('firstPlayoffDay')}<select class="select" name="on">
            ${firstDays.map(x => `<option value="${x}" ${x === d.on ? 'selected' : ''}>${esc(fmtDate(x, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</option>`).join('')}</select></label>
        </div>
        ${size < PLAYOFF_SIZES[start][1] && start !== 'final' ? `<p class="note">${t('byesNote').replace('{n}', PLAYOFF_SIZES[start][1] - size)}</p>` : ''}
        ${playoffRulesHTML(d, size)}
        <h3>${t('seedsTitle')}</h3>
        <div class="po-seeds">${Array.from({ length: size }, (_, i) => `<label class="rot-slot"><span class="rot-n">${i + 1}</span>
          <select class="select" name="seed${i}">${rows.map(r => `<option ${r.team === rows[i].team ? 'selected' : ''}>${esc(r.team)}</option>`).join('')}</select></label>`).join('')}</div>
        <p class="warn" hidden></p>
        <button class="btn btn-gold" type="submit">${t('startPlayoffs')}</button>
      </form>`}`);
  }
  return adminShell('admin/playoffs', `
    <h1 class="page-title">${t('playoffs')}</h1>
    <div class="toolbar">${divPills(div, 'data-admin-div')}</div>
      ${cupTabs()}
    <p class="note">${t('playoffsStartedHelp')} ${esc(fmtDate(po.on))}.</p>
    ${bracketHTML(div, true)}
    <details class="card po-settings"><summary><b>${t('playoffSettings')}</b></summary>
      <form data-form="playoff-rules">${playoffRulesHTML(po, po.seeds.length)}<button class="btn btn-sm btn-gold" type="submit">${t('save')}</button></form>
    </details>
    <button type="button" class="btn btn-outline danger-outline" data-action="ask" data-confirm="cancel-playoffs">${t('cancelPlayoffs')}</button>`);
}

// ---------- Copa (admin) ----------
const GROUP_NAMES = ['A', 'B', 'C', 'D'];
// What's been filled in on the Copa form so far (kept when it redraws).
function copaDraft(div) {
  if (ui.copaDraft && ui.copaDraft.div === div) return ui.copaDraft;
  const inPO = new Set((playoffsOf(div) || {}).seeds || []);
  return { div, teams: standings(div).map(r => r.team).filter(x => !inPO.has(x)), extras: [], format: 'knockout', groupCount: 2, advance: 2,
    groupLegs: 1, tie: 'pens', roundLegs: {}, third: true, on: '', order: null, groupOf: null };
}
function readCopaDraft(form, div) {
  const d = { ...copaDraft(div) };
  const radio = n => (form.querySelector(`[name=${n}]:checked`) || {}).value;
  d.teams = [...form.querySelectorAll('[name=cteam]:checked')].map(x => x.value);
  d.format = radio('format') || d.format;
  if (form.on && !form.on.value) d.on = '';
  ['groupCount', 'advance', 'groupLegs'].forEach(k => { if (form[k]) d[k] = +form[k].value; });
  d.tie = radio('tie') || d.tie;
  d.third = form.third ? form.third.checked : d.third;
  d.on = form.on ? form.on.value : d.on;
  d.roundLegs = Object.fromEntries([...form.querySelectorAll('input[name^=legs_]:checked')].map(i => [i.name.slice(5), +i.value]));
  const ord = [...form.querySelectorAll('[name^=ord_]')];
  if (ord.length) d.order = ord.map(x => x.value);
  const grp = [...form.querySelectorAll('[name^=grp_]')];
  if (grp.length) d.groupOf = Object.fromEntries(grp.map(x => [x.dataset.team, x.value]));
  return d;
}
// Change format: the setup form starts from what the Copa / tournament has now (its teams, including ones
// added later, the groups, the seed order and the rules).
function draftFromCopa(div) {
  const co = copaOf(div);
  const all = standings(div).map(r => r.team);
  const out = (co.ko && co.ko.out) || [];
  const now = co.teams.filter(x => !out.includes(x));
  const rules = co.ko || co;
  return { div, teams: now.filter(x => all.includes(x)), extras: now.filter(x => !all.includes(x)),
    format: co.roundRobin ? 'roundRobin' : co.format === 'groups' ? 'groups' : 'knockout',
    groupCount: co.groups && !co.roundRobin ? co.groups.length : 2, advance: co.advance || 2, groupLegs: co.groupLegs || 1,
    tie: rules.tie || 'pens', roundLegs: rules.roundLegs || {}, third: !!rules.third, on: co.on,
    order: co.ko ? [...co.ko.seeds.filter(x => now.includes(x)), ...now.filter(x => !co.ko.seeds.includes(x))] : now,
    groupOf: co.groups && !co.roundRobin ? Object.fromEntries(co.groups.flatMap(g => g.teams.map(x => [x, g.name]))) : co.lastGroupOf || null };
}
// After a format change every game of the division is sorted again: a game between two teams of the same
// new group is that group's game, a game that fits a knockout matchup is that matchup's, anything else is
// left as an other game. Saved planner slots keep their place; one whose game no longer exists is
// emptied to pick again (and with no knockout at all it becomes an open slot).
function resortCopaGames(div) {
  const ms = state.matches.filter(m => m.div === div).sort(byDateTime);
  ms.forEach(m => { if (m.playoff && m.playoff.cup === 'copa') delete m.playoff; });
  ms.forEach(m => tagPlayoff(m));
  const plan = koPlan(div);
  allHolds().filter(h => h.r.hold.div === div).forEach(h => {
    if (!plan.length) { delete h.r.hold; delete h.r.hHome; delete h.r.hAway; return; }
    if (h.r.hold.key && !holdNode(h.r)) h.r.hold.key = '';
  });
}

// Teams in the Copa, in order: the order picked, then anyone new at the end.
function copaParts(div, d) {
  const all = standings(div).map(r => r.team);
  const parts = [...all.filter(x => d.teams.includes(x)), ...d.extras];
  const order = (d.order || []).filter(x => parts.includes(x));
  parts.forEach(x => { if (!order.includes(x)) order.push(x); });
  return order;
}
const copaKoCount = (d, parts) => (d.format === 'groups' ? Math.min(parts.length, d.groupCount * d.advance) : parts.length);
// Snake order into groups by default: A B B A A B …
function copaGroupOf(d, parts) {
  const out = {};
  parts.forEach((x, i) => {
    const lap = Math.floor(i / d.groupCount), k = i % d.groupCount;
    out[x] = (d.groupOf && GROUP_NAMES.slice(0, d.groupCount).includes(d.groupOf[x])) ? d.groupOf[x] : GROUP_NAMES[lap % 2 ? d.groupCount - 1 - k : k];
  });
  return out;
}

function pageAdminCopa() {
  const div = ui.adminDiv;
  const head = `<h1 class="page-title">${t('playoffs')}</h1>
    <div class="toolbar">${divPills(div, 'data-admin-div')}</div>
    ${cupTabs()}`;
  return adminShell('admin/playoffs', `${head}${copaBodyHTML(div)}`);
}

// The Copa's setup form or (once started) its groups and bracket. Tournaments use the same thing.
function copaBodyHTML(div) {
  const co = copaOf(div);
  const tw = k => t(isTour(DIVISIONS.find(x => x.id === div)) ? `${k}T` : k);
  if (co && ui.copaReformat !== div) {
    const koCount = co.ko ? co.ko.seeds.length : (co.groups || []).length * (co.advance || 1);
    const rules = co.ko || co;
    return `
      <p class="note">${tw('copaStartedHelp')} ${esc(fmtDate(co.on))}.</p>
      ${copaGroupsHTML(div)}
      ${co.roundRobin && copaChampion(div) ? `<p class="champion">${t('champion')}: <b>${esc(copaChampion(div))}</b></p>` : ''}
      ${co.groups && !co.ko && !co.roundRobin ? `<div class="card copa-ko-card"><p>${t('koFromGroupsNote').replace('{n}', co.advance || 1)}</p>
        <button type="button" class="btn btn-gold" data-action="copa-ko">${t('koFromGroups')}</button></div>` : ''}
      ${co.ko ? bracketHTML(div, true, 'copa') : ''}
      ${co.roundRobin ? '' : `<details class="card po-settings"><summary><b>${tw('copaRules')}</b></summary>
        <form data-form="playoff-rules" data-cup="copa">${playoffRulesHTML({ ...rules, seeds: Array(koCount).fill('') }, koCount)}<button class="btn btn-sm btn-gold" type="submit">${t('save')}</button></form>
      </details>`}
      ${copaEditTeamsHTML(div)}
      <div class="copa-reformat-row"><button type="button" class="btn btn-sm btn-outline" data-action="copa-reformat">${t('changeFormat')}</button>
        <span class="muted">${t('changeFormatHint')}</span></div>
      ${tourGamesHTML(div)}
      <button type="button" class="btn btn-outline danger-outline" data-action="ask" data-confirm="cancel-copa">${tw('cancelCopa')}</button>`;
  }
  const d = copaDraft(div);
  const all = standings(div).map(r => r.team);
  const inPO = new Set((playoffsOf(div) || {}).seeds || []);
  const parts = copaParts(div, d);
  const koCount = copaKoCount(d, parts);
  const tourDiv = DIVISIONS.find(x => x.id === div);
  const firstDays = isTour(tourDiv) ? tourDiv.dates : Array.from({ length: 10 }, (_, i) => addDays(lastPlayDay(div), 7 * (i + (lastPlayDay(div) < todayISO() ? 1 : 0))));
  const groupOf = copaGroupOf(d, parts);
  const maxGroups = Math.max(2, Math.min(4, Math.floor(parts.length / 2)));
  const sel = (name, opts, cur) => `<select class="select" name="${name}" data-change="copa-draft">${opts.map(([v, l]) => `<option value="${v}" ${+v === +cur || v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const reformat = co && ui.copaReformat === div;
  const scored = reformat && state.matches.some(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && played(m));
  return `
    ${reformat ? `<p class="note"><b>${t('changeFormat')}.</b> ${t('reformatHelp')}</p>` : `<p class="note">${tw('copaHelp')}</p>`}
    <form class="card po-form" data-form="start-copa" ${reformat ? 'data-reformat="1"' : ''}>
      <fieldset class="po-rounds"><legend>${tw('copaTeams')}</legend>
        <div class="copa-teams">${all.map(x => `<label class="check-line"><input type="checkbox" name="cteam" value="${esc(x)}" data-change="copa-draft" ${d.teams.includes(x) ? 'checked' : ''}> ${esc(x)}${inPO.has(x) ? ` <span class="muted">(${t('inPlayoffsTag')})</span>` : ''}</label>`).join('')}
        ${d.extras.map(x => `<span class="check-line copa-extra">${esc(x)} <span class="tag">${t('newTag')}</span><button type="button" class="icon-btn danger" data-action="copa-rm-team" data-name="${esc(x)}" aria-label="${t('remove')}">×</button></span>`).join('')}</div>
        <div class="copa-add"><input class="input" name="newTeam" placeholder="${t('newTeamPh')}" autocomplete="off"><button type="button" class="btn btn-sm btn-outline" data-action="copa-add-team">＋ ${t('addCopaTeam')}</button></div>
      </fieldset>
      <fieldset class="po-rules"><legend>${t('copaFormat')}</legend>
        ${[['knockout', t('fmtKnockout')], ['groups', t('fmtGroups')], ['roundRobin', t('fmtRoundRobin')]].map(([v, l]) => `<label class="radio-line"><input type="radio" name="format" value="${v}" data-change="copa-draft" ${d.format === v ? 'checked' : ''}> <span>${l}</span></label>`).join('')}
      </fieldset>
      ${d.format === 'roundRobin' ? `<div class="league-grid">
          <label class="field">${t('groupLegsQ')}${sel('groupLegs', [[1, t('oneGame')], [2, t('twoGames')]], d.groupLegs)}</label></div>` : ''}
      ${d.format === 'groups' ? `<div class="league-grid">
          <label class="field">${t('groupCount')}${sel('groupCount', Array.from({ length: maxGroups - 1 }, (_, i) => [i + 2, i + 2]), d.groupCount)}</label>
          <label class="field">${t('advanceQ')}${sel('advance', [[1, 1], [2, 2]], d.advance)}</label>
          <label class="field">${t('groupLegsQ')}${sel('groupLegs', [[1, t('oneGame')], [2, t('twoGames')]], d.groupLegs)}</label>
        </div>
        <h3>${t('groupsTitle')}</h3>
        <div class="po-seeds">${parts.map((x, i) => `<label class="rot-slot"><span class="team-with-logo grow">${esc(x)}</span>
          <select class="select narrow" name="grp_${i}" data-team="${esc(x)}" data-change="copa-draft">${GROUP_NAMES.slice(0, d.groupCount).map(g => `<option ${groupOf[x] === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`).join('')}</div>`
      : d.format === 'roundRobin' ? '' : `<h3>${t('seedsTitle')}</h3>
        <div class="po-seeds">${parts.map((x, i) => `<label class="rot-slot"><span class="rot-n">${i + 1}</span>
          <select class="select" name="ord_${i}">${parts.map(y => `<option ${y === x ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select></label>`).join('')}</div>`}
      ${d.format === 'roundRobin' ? '' : `<h3>${t(d.format === 'groups' ? 'copaKoRules' : 'copaRules')}</h3>
      <label class="check-line"><input type="checkbox" name="third" ${d.third ? 'checked' : ''}> ${t('thirdQ')}</label>
      ${playoffRulesHTML(d, koCount)}`}
      <label class="field">${tw('firstCopaDay')}<select class="select" name="on">
        ${firstDays.map(x => `<option value="${x}" ${x === d.on ? 'selected' : ''}>${esc(fmtDate(x, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</option>`).join('')}</select></label>
      ${scored ? `<label class="check-line reformat-ok"><input type="checkbox" name="okScores" required> ${t('reformatScoresOk')}</label>` : ''}
      <p class="warn" hidden></p>
      <div class="row-actions"><button class="btn btn-gold" type="submit">${reformat ? t('saveNewFormat') : tw('startCopa')}</button>
        ${reformat ? `<button type="button" class="btn btn-outline" data-action="copa-reformat-cancel">${t('cancel')}</button>` : ''}</div>
    </form>`;
}

// Edit teams after the Copa / tournament has started: rename or replace a team (it keeps its spot, games
// and results), move it to another group, take it out, or add a late team.
function copaTeamState(div, x) {
  const co = copaOf(div);
  const ms = state.matches.filter(m => m.div === div && (m.home === x || m.away === x));
  const group = (co.groups || []).find(g => g.teams.includes(x));
  const inKo = co.ko && co.ko.seeds.includes(x);
  const lost = inKo && bracketNodes(bracket(div, 'copa')).some(n => n.loser === x);
  const out = co.ko && (co.ko.out || []).includes(x);
  return { co, group, inKo, lost, out, playedGroup: ms.some(m => played(m) && m.playoff && m.playoff.group) };
}
const koScored = div => state.matches.some(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && !m.playoff.group && played(m));
function copaEditTeamsHTML(div) {
  const co = copaOf(div);
  const d = DIVISIONS.find(x => x.id === div);
  const src = (d && d.from && state.teams[d.from]) || [];
  const groupsOpen = co.groups && !co.ko;
  const canAdd = groupsOpen || (co.ko && co.format === 'knockout' && !koScored(div));
  const list = co.teams;
  const spot = x => {
    const st = copaTeamState(div, x);
    if (st.out) return t('tookOutShort');
    if (co.ko && st.inKo) return `${t('seedWord')} ${co.ko.seeds.indexOf(x) + 1}${st.lost ? ` · ${t('eliminated')}` : ''}`;
    return st.group ? (co.roundRobin ? t('roundRobinShort') : `${t('group')} ${st.group.name}`) : '';
  };
  return `<details class="card po-settings copa-edit" ${ui.copaEditOpen ? 'open' : ''} data-box="copa-edit">
    <summary><b>${t('editTeams')}</b> <span class="muted">${list.length} ${t('teamsWord')}</span></summary>
    <p class="note">${t('editTeamsHelp')}</p>
    <datalist id="copa-src-list">${src.filter(x => !list.includes(x)).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <ul class="admin-list copa-edit-list">${list.map(x => {
      const st = copaTeamState(div, x);
      const editing = ui.copaRename === x;
      const canMove = groupsOpen && !co.roundRobin && !st.playedGroup && co.groups.length > 1;
      const canOut = !st.out && !st.lost && (groupsOpen ? st.group && st.group.teams.length > 2 : st.inKo);
      return `<li class="copa-edit-row">
        <span class="grow"><span class="team-with-logo">${publicLogo(x, true, div)}<b>${esc(x)}</b></span> <span class="muted">· ${esc(spot(x))}</span></span>
        ${canMove ? `<select class="select narrow" data-change="copa-move" data-team="${esc(x)}" aria-label="${t('group')}">${co.groups.map(g => `<option ${g === st.group ? 'selected' : ''}>${g.name}</option>`).join('')}</select>` : ''}
        ${st.out ? '' : `<button type="button" class="btn btn-sm btn-outline" data-action="copa-rename-open" data-team="${esc(x)}">${t('replaceRename')}</button>`}
        ${canOut ? `<button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="copa-out" data-team="${esc(x)}"
          data-ask="${groupsOpen ? 'askOutGroup' : 'askOutKo'}" data-yes="yesTakeOut">${t('takeOut')}</button>` : ''}
        ${editing ? `<form class="copa-rename" data-form="copa-rename" data-team="${esc(x)}">
          <input class="input" name="to" list="copa-src-list" value="" placeholder="${esc(t('replacePh'))}" autocomplete="off" required>
          <button class="btn btn-sm btn-gold" type="submit">${t('save')}</button>
          <button type="button" class="link-btn small" data-action="copa-rename-open" data-team="">${t('cancel')}</button>
          <p class="note">${t('replaceHelp').replace('{x}', esc(x))}</p><p class="warn" hidden></p></form>` : ''}
      </li>`;
    }).join('')}</ul>
    ${canAdd ? `<form class="copa-add late-add" data-form="copa-late-team">
        <input class="input" name="name" list="copa-src-list" placeholder="${t('newTeamPh')}" autocomplete="off" required>
        ${groupsOpen && !co.roundRobin ? `<select class="select narrow" name="group" aria-label="${t('group')}">${co.groups.map(g => `<option>${g.name}</option>`).join('')}</select>` : ''}
        <button class="btn btn-sm btn-outline" type="submit">＋ ${t('addCopaTeam')}</button>
        <p class="warn" hidden></p>
      </form>
      ${co.ko ? `<p class="note">${t('lateKoNote')}</p>` : ''}`
      : `<p class="note">${t('noLateAdd')}</p>`}
  </details>`;
}
// Games the bracket changed under (a team added or taken out): their round/slot is worked out again.
function retagCopa(div) {
  state.matches.filter(m => m.div === div && m.playoff && m.playoff.cup === 'copa' && !m.playoff.group && !played(m)).forEach(m => { delete m.playoff; tagPlayoff(m); });
}
function copaTakeOut(div, x) {
  const co = copaOf(div);
  undoable(`${t('takeOut')}: ${x}`);
  if (co.groups && !co.ko) {
    // Its group games come off (scores too), so the table is only the teams still in.
    const g = co.groups.find(y => y.teams.includes(x));
    g.teams = g.teams.filter(y => y !== x);
    co.teams = co.teams.filter(y => y !== x);
    state.matches = state.matches.filter(m => !(m.div === div && (m.home === x || m.away === x) && m.playoff && m.playoff.group));
    // A team added just for the tournament comes off its team list too.
    const d = DIVISIONS.find(y => y.id === div);
    if (isTour(d) && !(state.teams[d.from] || []).includes(x)) state.teams[div] = (state.teams[div] || []).filter(y => y !== x);
  } else {
    // In the knockout the other team goes through; its games still to play come off.
    co.ko.out = [...new Set([...(co.ko.out || []), x])];
    state.matches = state.matches.filter(m => !(m.div === div && !played(m) && (m.home === x || m.away === x)));
  }
  touch(div);
  logAction(`${t('takeOut')} · ${divName(div)}: ${x}`);
}
function copaLateTeam(form) {
  const div = ui.adminDiv, co = copaOf(div);
  const name = form.name.value.trim();
  const warn = form.querySelector('.warn');
  if (!name) return;
  if (co.teams.some(y => y.toLowerCase() === name.toLowerCase())) { warn.textContent = t('alreadyIn'); warn.hidden = false; return; }
  undoable(`${t('addCopaTeam')}: ${name}`);
  co.teams = [...co.teams, name];
  if (co.groups && !co.ko) {
    const g = co.roundRobin ? co.groups[0] : co.groups.find(y => y.name === form.group.value);
    g.teams = [...g.teams, name];
  } else {
    co.ko.seeds = [...co.ko.seeds, name];
    retagCopa(div);
  }
  const d = DIVISIONS.find(x => x.id === div);
  if (isTour(d) && !(state.teams[div] || []).includes(name)) {
    state.teams[div] = [...(state.teams[div] || []), name];
    const logo = d.from && teamLogo(name, d.from);
    if (logo) state.logos = { ...(state.logos || {}), [`${div}|${name}`]: logo };
  }
  touch(div);
  logAction(`${t('addCopaTeam')} · ${divName(div)}: ${name}`);
  save(); render();
}
function copaRename(form) {
  const div = ui.adminDiv, co = copaOf(div);
  const from = form.dataset.team, to = form.to.value.trim();
  const warn = form.querySelector('.warn');
  if (!to || to === from) return;
  if (co.teams.some(y => y !== from && y.toLowerCase() === to.toLowerCase())) { warn.textContent = t('alreadyIn'); warn.hidden = false; return; }
  undoable(`${t('replaceRename')}: ${from} → ${to}`);
  renameTeam(div, from, to);
  const d = DIVISIONS.find(x => x.id === div);
  const logo = d && d.from && teamLogo(to, d.from);
  if (logo && !(state.logos || {})[`${div}|${to}`]) state.logos = { ...(state.logos || {}), [`${div}|${to}`]: logo };
  ui.copaRename = null;
  touch(div);
  logAction(`${t('replaceRename')} · ${divName(div)}: ${from} → ${to}`);
  save(); render();
}

// A tournament division's games with score entry (they don't show under the league divisions), in boxes
// that open with a click: by stage (Group A ▸ Game 1…, then Semifinals, Final) or by day and time.
// `pick` narrows them (Enter scores' Needs a score / Has a score).
const boxOpen = id => (ui.openBoxes || new Set()).has(id);
const box = (id, title, count, body) => `<details class="card tour-box" data-box="${esc(id)}" ${boxOpen(id) ? 'open' : ''}>
  <summary><b>${title}</b><span class="muted">${count}</span></summary><div class="tour-box-body">${body}</div></details>`;
// "Game 1", "Game 2"… in a group: a game's number is one more than the most either team had played before it.
function groupGameNumbers(games) {
  const seen = {}, out = new Map();
  [...games].sort(byDateTime).forEach(m => {
    const n = Math.max(seen[m.home] || 0, seen[m.away] || 0) + 1;
    out.set(m.id, n); seen[m.home] = n; seen[m.away] = n;
  });
  return out;
}
function heldLine({ date, field, r }) {
  const [a, b] = holdLabels(r);
  return `<div class="hold-line"><span class="tag held-tag">${t('koSaved')}</span>
    <span><b>${esc(holdName(r))}</b> · ${esc(a)} ${t('vs')} ${esc(b)} <small class="muted">— ${esc(fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' }))} · ${esc(fromMin(r.t))} · ${esc(FIELDS[field] || field)}</small></span></div>`;
}
function tourGamesHTML(div, pick = () => true, title = true) {
  if (!isTour(DIVISIONS.find(x => x.id === div))) return '';
  const all = state.matches.filter(m => m.div === div).sort(byDateTime);
  const games = all.filter(pick);
  const holds = allHolds().filter(h => h.r.hold.div === div && h.r.hold.key);
  const by = ui.tourGamesBy || 'stage';
  const co = copaOf(div) || {};
  // With Needs a score / Has a score on, only boxes that have something show.
  const narrow = !title && ui.adminFilter !== 'all';
  const done = l => `${l.filter(played).length}/${l.length} ${t('playedShort')}`;
  const rows = l => l.map(m => scoreRowHTML(m)).join('');
  let body = '';
  if (by === 'time') {
    const days = [...new Set([...games.map(m => m.date), ...holds.map(h => h.date)])].sort();
    body = days.map(d => {
      const ms = games.filter(m => m.date === d), hs = holds.filter(h => h.date === d);
      const times = [...new Set([...ms.map(m => toMin(m.time)), ...hs.map(h => h.r.t)])].sort((a, b) => a - b);
      return box(`${div}|t|${d}`, esc(fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric' })), done(ms),
        times.map(tm => box(`${div}|t|${d}|${tm}`, esc(fromMin(tm)), done(ms.filter(m => toMin(m.time) === tm)),
          rows(ms.filter(m => toMin(m.time) === tm)) + hs.filter(h => h.r.t === tm).map(heldLine).join(''))).join(''));
    }).join('');
  } else {
    // Groups (or the round robin table), each with its Game 1, Game 2…
    (co.groups || []).forEach(g => {
      const ms = games.filter(m => m.playoff && m.playoff.group === g.name);
      const nums = groupGameNumbers(all.filter(m => m.playoff && m.playoff.group === g.name));
      const max = Math.max(0, ...ms.map(m => nums.get(m.id)));
      if (narrow && !ms.length) return;
      body += box(`${div}|g|${g.name}`, co.roundRobin ? t('roundRobinShort') : `${t('group')} ${esc(g.name)}`, done(ms),
        Array.from({ length: max }, (_, i) => {
          const l = ms.filter(m => nums.get(m.id) === i + 1);
          return l.length ? box(`${div}|g|${g.name}|${i + 1}`, `${t('game')} ${i + 1}`, done(l), rows(l)) : '';
        }).join('') || `<p class="muted">${t('noGamesYet')}</p>`);
    });
    // Knockout rounds: Quarterfinals, Semifinals, Final, 3rd place — with any slot saved for them.
    const plan = koPlan(div);
    [...new Set(plan.map(n => n.key))].forEach(key => {
      const nodes = plan.filter(n => n.key === key);
      const ms = games.filter(m => m.playoff && !m.playoff.group && nodes.some(n => n.round === m.playoff.round && n.slot === m.playoff.slot));
      const hs = holds.filter(h => nodes.some(n => h.r.hold.key.startsWith(`${n.round}-${n.slot}-`)));
      if (narrow && !ms.length) return;
      body += box(`${div}|k|${key}`, t(key === 'thirdPlace' ? key : `${key}Plural`), done(ms), rows(ms) + hs.map(heldLine).join('')
        || nodes.map(n => `<div class="hold-line"><span class="muted">${esc(n.name)} · ${esc(n.a || n.aLabel)} ${t('vs')} ${esc(n.b || n.bLabel)} — ${t('notBookedYet')}</span></div>`).join(''));
    });
    // Anything without a stage (booked before the setup, or teams that don't fit it).
    const loose = games.filter(m => !m.playoff);
    if (loose.length) body += box(`${div}|other`, t('otherGames'), done(loose), rows(loose));
  }
  return `<section class="tour-games">${title ? `<h2 class="section-title">${t('tourGames')} <span class="muted">${all.length}</span></h2>` : ''}
    <div class="seg tour-by">${['stage', 'time'].map(k => `<button type="button" class="${by === k ? 'active' : ''}" data-action="tour-games-by" data-by="${k}">${t(k === 'stage' ? 'byStage' : 'byTime')}</button>`).join('')}</div>
    ${body || `<p class="note">${t(all.length ? 'noneHere' : 'tourGamesHelp')}</p>`}</section>`;
}

function startCopa(form) {
  const div = ui.adminDiv;
  const d = readCopaDraft(form, div);
  const parts = copaParts(div, d);
  if (!d.on) d.on = form.on.value;
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  if (parts.length < 2) return fail(t('copaNeedsTwo'));
  // A format change can be undone from the message after it, and remembers the groups (switching back to
  // groups puts everyone where they were).
  const prev = ui.copaReformat === div ? copaOf(div) : null;
  if (prev) undoable(t('formatChanged'));
  const base = { teams: parts, on: d.on, tie: d.tie, roundLegs: d.roundLegs, third: d.third };
  if (d.format === 'roundRobin') {
    state.copa = { ...(state.copa || {}), [div]: { ...base, format: 'groups', roundRobin: true, groups: [{ name: 'A', teams: parts }], advance: 0, groupLegs: d.groupLegs } };
  } else if (d.format === 'groups') {
    const groupOf = copaGroupOf(d, parts);
    const groups = GROUP_NAMES.slice(0, d.groupCount).map(name => ({ name, teams: parts.filter(x => groupOf[x] === name) }));
    if (groups.some(g => g.teams.length < 2)) return fail(t('needTwoPerGroup'));
    state.copa = { ...(state.copa || {}), [div]: { ...base, format: 'groups', groups, advance: d.advance, groupLegs: d.groupLegs } };
  } else {
    if (new Set(d.order || parts).size !== (d.order || parts).length) return fail(t('seedTwice'));
    state.copa = { ...(state.copa || {}), [div]: { ...base, format: 'knockout', ko: { seeds: copaParts(div, d), tie: d.tie, roundLegs: d.roundLegs, third: d.third, picks: {} } } };
  }
  ui.copaDraft = null;
  const reformat = ui.copaReformat === div;
  if (reformat) {
    const was = prev.groups && !prev.roundRobin ? Object.fromEntries(prev.groups.flatMap(g => g.teams.map(x => [x, g.name]))) : prev.lastGroupOf;
    if (was) state.copa[div].lastGroupOf = was;
    ui.copaReformat = null; resortCopaGames(div);
  }
  touch(div);
  logAction(`${t(reformat ? 'formatChanged' : 'copaStarted')} · ${divName(div)}: ${t({ knockout: 'fmtKnockout', groups: 'fmtGroups', roundRobin: 'fmtRoundRobin' }[d.format])} · ${parts.length} ${t('teamsWord')}`);
  save(); render();
}

function playoffRulesHTML(po, count) {
  const radio = (name, value, label) => `<label class="radio-line"><input type="radio" name="${name}" value="${value}" ${po[name] === value ? 'checked' : ''}> <span>${label}</span></label>`;
  const keys = [...playoffRoundKeys(count), 'thirdPlace'];
  const legs = key => legsFor(po, key === 'final' || key === 'thirdPlace' ? key : '', key);
  return `<div class="po-rules">
    <fieldset><legend>${t('tieRule')}</legend>${radio('tie', 'pens', t('tiePens'))}${radio('tie', 'seed', t('tieSeed'))}</fieldset>
    <fieldset><legend>${t('legsQ')}</legend>
      <div class="po-legs">${keys.map(k => `<div class="po-leg ${k === 'thirdPlace' ? 'third-legs' : ''}"><b>${t(k)}</b>
        <div class="seg">${[1, 2].map(n => `<label class="seg-radio"><input type="radio" name="legs_${k}" value="${n}" ${legs(k) === n ? 'checked' : ''}><span>${t(n === 1 ? 'oneGame' : 'twoGames')}</span></label>`).join('')}</div></div>`).join('')}</div>
      <p class="note">${t('legsNote')}</p>
    </fieldset>
    ${po.seeds ? `<label class="check-line"><input type="checkbox" name="third" ${po.third ? 'checked' : ''}> ${t('thirdQ')}</label>` : ''}
  </div>`;
}
const readRoundLegs = (form, count) => Object.fromEntries([...playoffRoundKeys(count), 'thirdPlace']
  .map(k => [k, +((form.querySelector(`[name="legs_${k}"]:checked`) || {}).value || 1)]));

function startPlayoffs(form) {
  const div = ui.adminDiv;
  const size = +form.size.value;
  const seeds = Array.from({ length: size }, (_, i) => form[`seed${i}`].value);
  const warn = form.querySelector('.warn');
  if (new Set(seeds).size !== seeds.length) { warn.textContent = t('seedTwice'); warn.hidden = false; return; }
  state.playoffs = { ...(state.playoffs || {}), [div]: {
    seeds, on: form.on.value, tie: form.querySelector('[name=tie]:checked').value, roundLegs: readRoundLegs(form, size),
    third: form.third.checked, picks: {},
  } };
  ui.poSize = null; ui.poStart = null; ui.poDraft = null;
  touch(div);
  logAction(`${t('playoffsStarted')} · ${divName(div)}: ${size} ${t('teamsWord')}`);
  save(); render();
}

function pageStandings() {
  return `
  <div class="wrap page">
    <h1 class="page-title">${t('standings')}</h1>
    <div class="toolbar">${divPills(ui.div)}</div>
    <div class="updated-row">${updatedNote(ui.div)}${exportButtons('standings')}</div>
    ${playoffsOf(ui.div) ? `<a class="po-banner" href="#/playoffs">${t('inPlayoffs')} →</a>` : ''}
    ${standingsTable(ui.div)}
  </div>`;
}

function pageScorers() {
  const d = scorerDiv(ui.div);
  return `
  <div class="wrap page">
    <h1 class="page-title">${t('scorers')}</h1>
    <div class="toolbar">${divPills(d, 'data-div', { scorers: true })}</div>
    <div class="updated-row">${updatedNote(d)}${exportButtons('scorers')}</div>
    ${scorerList(d, 5)}
  </div>`;
}

function pageFields() {
  return `
  <div class="wrap page">
    <h1 class="page-title">${t('fields')}</h1>
    <p class="lead muted">${t('fieldsSub')}</p>
    <div class="field-grid">${locations().map(loc => `<div class="field-card">
        <div class="pitch" aria-hidden="true"><span></span></div>
        <h3>${esc(loc.place)}</h3>
        ${placeAddress(loc.place) ? `<p class="muted field-address">${esc(placeAddress(loc.place))}</p>` : ''}
        <p class="field-labels">${loc.labels.map((l, i) => isOpenField(loc.ids[i])
          ? `<span class="chip">${esc(l)}</span>`
          : `<span class="chip closed" title="${t('tempClosed')}">${esc(l)} · ${t('tempClosed')}</span>`).join('')}</p>
        <a class="btn btn-sm btn-outline" target="_blank" rel="noopener" href="${mapsLink(loc.place)}">${t('directions')} ↗</a>
      </div>`).join('')}</div>
  </div>`;
}

// ---------- Register page buttons ----------
// Every button on the Register page belongs to a group (the top box, a step, a division's card, coaches).
// A group someone edited is saved in state.regButtons and replaces the built-in buttons; otherwise the
// built-in ones show (in the visitor's language). A link starting with # scrolls on the page.
function regDefaults(group) {
  const b = (label, url) => ({ id: `d-${group}-${label}`, label: '', key: label, url });
  if (group === 'hero') return [b('chooseDivision', '#reg-divisions'), b('readFirst', '#reg-before')];
  if (group === 'google') return [b('googleTutorial', REGISTRATION.googleTutorial), b('createGoogle', REGISTRATION.googleSignup)];
  if (group === 'contracts') return [{ id: 'd-contracts-en', label: 'Adult / Parent Contract (English)', url: REGISTRATION.contractEn }, { id: 'd-contracts-es', label: 'Contrato De Papás / Adultos (Español)', url: REGISTRATION.contractEs }];
  if (group === 'coaches') return [b('registerBtn', REGISTRATION.coaches)];
  if (group.startsWith('div:')) { const url = (REGISTRATION.forms[group.slice(4)] || [])[1]; return url ? [b('registerBtn', url)] : []; }
  return [];
}
const regButtons = group => ((state.regButtons || {})[group] || regDefaults(group));
const regLabel = b => b.label || (b.key ? t(b.key) : '');
function regButtonsHTML(group, cls = 'btn btn-gold btn-sm', extra = '') {
  const list = regButtons(group);
  const one = (b, i) => {
    const inPage = (b.url || '').startsWith('#');
    const c = group === 'hero' && i > 0 ? 'btn btn-ghost' : group === 'google' || group === 'contracts' ? '' : cls;
    return `<a ${c ? `class="${c}"` : ''} href="${esc(b.url || '#')}" ${inPage ? `data-scroll="${esc(b.url.slice(1))}"` : 'target="_blank" rel="noopener"'}>${esc(regLabel(b))}${inPage ? (group === 'hero' && i === 0 ? ' ↓' : '') : ' ↗'}</a>`;
  };
  return list.length ? `<span class="reg-btns ${extra}">${list.map(one).join('')}</span>` : group.startsWith('div:') ? `<span class="reg-soon">${t('formSoon')}</span>` : '';
}
// ---------- Register page division cards ----------
// Each division (and Coaches) is a card with a title, a description and one Register button. The built-in
// cards come from the leagues; admins can change a card's text and link (state.regCards.edits), add cards of
// their own (state.regCards.added) and take cards off the page (state.regCards.removed).
const REG_SECTIONS = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal'], ['coaches', 'coaches']];
const regCardsState = () => ({ edits: {}, added: [], removed: [], ...(state.regCards || {}) });
// The link a built-in card starts with (an older edit of its button counts).
const regStartUrl = group => (regButtons(group)[0] || {}).url || '';
function regCardDefaults(section) {
  if (section === 'coaches') return [{ id: 'coaches', title: t('coaches'), desc: '', url: regStartUrl('coaches') }];
  return DIVISIONS.filter(d => d.group === section).sort((a, b) => (section === 'youth' ? divAge(b) - divAge(a) : 0)).map(d => {
    const [years] = REGISTRATION.forms[d.id] || [];
    return { id: `div:${d.id}`, title: divName(d.id), desc: years ? `${years}${REGISTRATION.ageChart[d.id] ? ` · ${REGISTRATION.ageChart[d.id][0]}` : ''}` : '', url: regStartUrl(`div:${d.id}`) };
  });
}
function regCards(section) {
  const s = regCardsState();
  const mine = c => { const e = s.edits[c.id] || {}; return { ...c, ...e, title: e.title || c.title, def: c, builtIn: true }; };
  return [...regCardDefaults(section).filter(c => !s.removed.includes(c.id)).map(mine), ...s.added.filter(c => c.section === section)];
}
function regCardHTML(c) {
  const url = c.url || '', inPage = url.startsWith('#');
  return `<div class="reg-card">
      <span class="reg-name">${esc(c.title)}</span>
      ${c.desc ? `<span class="reg-years">${esc(c.desc)}</span>` : ''}
      ${url ? `<span class="reg-btns"><a class="btn btn-gold btn-sm" href="${esc(url)}" ${inPage ? `data-scroll="${esc(url.slice(1))}"` : 'target="_blank" rel="noopener"'}>${t('registerBtn')}${inPage ? '' : ' ↗'}</a></span>` : `<span class="reg-soon">${t('formSoon')}</span>`}
    </div>`;
}
function regCardEditHTML(c) {
  const f = (k, label, ph = '') => `<label class="field">${t(label)}<input class="input" data-change="reg-card" data-f="${k}" value="${esc(c[k] || '')}" placeholder="${esc(ph)}"></label>`;
  return `<section class="card reg-admin-card" data-reg-card="${esc(c.id)}">
      <div class="reg-card-fields">${f('title', 'regFieldTitle', c.def ? c.def.title : '')}${f('desc', 'regCardDesc', t('regCardDescPh'))}${f('url', 'regBtnLink', 'https://…')}</div>
      <p class="muted reg-card-note">${c.url ? `${t('regCardButton')}: <b>${t('registerBtn')}</b>` : t('regCardNoLink')}</p>
      <button type="button" class="link-btn small danger" data-action="ask" data-confirm="reg-card-rm" data-id="${esc(c.id)}" data-ask="regCardRmQ">${t('regCardRemove')}</button>
    </section>`;
}
// Admin → Register page: one box per group of buttons, each button's text and link, × and ＋.
function regEditHTML(group) {
  const list = regButtons(group);
  return `<div class="reg-edit" data-reg-group="${esc(group)}">
      ${list.map(b => `<div class="reg-edit-row" data-id="${esc(b.id)}">
        <input class="input" data-change="reg-btn" data-f="label" value="${esc(regLabel(b))}" placeholder="${t('regBtnText')}" aria-label="${t('regBtnText')}">
        <input class="input" data-change="reg-btn" data-f="url" value="${esc(b.url || '')}" placeholder="https://…" aria-label="${t('regBtnLink')}">
        <button type="button" class="icon-btn danger" data-action="reg-btn-rm" aria-label="${t('remove')}">×</button></div>`).join('') || `<p class="muted">${t(group.startsWith('div:') ? 'regNoButtonsDiv' : 'autoNoButtons')}</p>`}
      <button type="button" class="link-btn small" data-action="reg-btn-add">＋ ${t('regAddButton')}</button>
    </div>`;
}
function pageAdminRegister() {
  const box = (title, group, sub = '') => `<section class="card reg-admin-card"><h3>${esc(title)}${sub ? ` <span class="muted">${esc(sub)}</span>` : ''}</h3>${regEditHTML(group)}</section>`;
  return adminShell('admin/regpage', `
    <h1 class="page-title">${t('regPageButtons')}</h1>
    <p class="note">${t('regAdminHelp')} <a href="#/register" target="_blank" rel="noopener">${t('regViewPage')} ↗</a></p>
    ${box(t('regTopBox'), 'hero')}
    ${box(t('stepGoogle'), 'google', t('regStepNote'))}
    ${box(t('stepParent'), 'contracts', t('regStepNote'))}
    <h2 class="section-title">${t('chooseDivision')}</h2>
    <p class="note">${t('regCardsHelp')}</p>
    ${REG_SECTIONS.map(([sec, l]) => `<h3 class="reg-group">${t(l)}</h3>
      <div class="reg-admin-grid">${regCards(sec).map(regCardEditHTML).join('')}</div>
      <button type="button" class="btn btn-outline btn-sm reg-add-card" data-action="reg-card-add" data-section="${sec}">＋ ${t('regAddDivision')}</button>`).join('')}
    ${state.regButtons || state.regCards ? `<div class="row-actions"><button type="button" class="btn btn-outline danger-outline" data-action="ask" data-confirm="reg-reset" data-ask="regResetQ">${t('regReset')}</button></div>` : ''}`);
}
// Read a group's rows back from the page (the built-in buttons become the group's own list on first edit).
function saveRegGroup(box) {
  const group = box.dataset.regGroup;
  const before = regButtons(group);
  const list = [...box.querySelectorAll('.reg-edit-row')].map(row => {
    const was = before.find(b => b.id === row.dataset.id) || {};
    return { id: was.id && !was.id.startsWith('d-') ? was.id : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: row.querySelector('[data-f=label]').value.trim(), url: row.querySelector('[data-f=url]').value.trim() };
  });
  state.regButtons = { ...(state.regButtons || {}), [group]: list };
  save();
  render();
}

function pageRegister() {
  return `
  <div class="wrap page">
    <div class="register-card">
      <div class="reg-art" aria-hidden="true">${TROPHY}${TROPHY}${TROPHY}</div>
      <p class="eyebrow">${t('register')}</p>
      <h1>${t('regTitle')}</h1>
      <p class="lead">${t('regSub')}</p>
      <div class="actions">${regButtonsHTML('hero', 'btn btn-gold')}</div>
    </div>

    <section class="reg-section" id="reg-before">
      <h2 class="section-title">${t('readFirst')}</h2>
      <ol class="steps">
        <li><b>${t('stepGoogle')}</b><p>${t('stepGoogleText')}</p>
          <p class="step-links">${regButtonsHTML('google')}</p></li>
        <li><b>${t('stepPhoto')}</b><p>${t('stepPhotoText')}</p></li>
        <li><b>${t('stepParent')}</b><p>${t('stepParentText')}</p>
          <p class="step-links">${regButtonsHTML('contracts')}</p></li>
      </ol>
    </section>

    <section class="reg-section">
      <h2 class="section-title">${t('ageGroups')}</h2>
      <img class="reg-image" src="images/age-groups.jpg" alt="${t('ageGroups')}: U-5 6v6 2021–2023 (girls 2020), U-7 7v7 2020/2021 (2019), U-9 9v9 2018/2019 (2017), U-11 11v11 2016/2017 (2015), U-13 11v11 2014/2015 (2013), U-15 11v11 2012/2013 (2011), U-17 11v11 2010/2011 (2009), U-19 11v11 2008/2009" loading="lazy">
      <p class="note">${t('girlsNote')}</p>
    </section>

    <section class="reg-section" id="reg-divisions">
      <h2 class="section-title">${t('chooseDivision')}</h2>
      ${REG_SECTIONS.map(([sec, l]) => (regCards(sec).length ? `<h3 class="reg-group">${t(l)}</h3>
      <div class="reg-grid">${regCards(sec).map(regCardHTML).join('')}</div>` : '')).join('')}
    </section>

    <section class="reg-section" id="reg-docs">
      <h2 class="section-title">${t('proofOfAge')}</h2>
      <img class="reg-image" src="images/proof-of-age.jpg" alt="${t('option')} 1: ${t('docBirth')} + ${t('docSchoolId')}. ${t('option')} 2: ${t('docPassport')}. ${t('option')} 3: ${t('docCaId')}." loading="lazy">
      <p class="note">${t('docNote')}</p>
    </section>

    <section class="reg-section">
      <h2 class="section-title">${t('afterRegister')}</h2>
      <ul class="after-list">${t('afterItems').map(i => `<li>${i}</li>`).join('')}</ul>
    </section>

    <section class="reg-section contact-box">
      <h2 class="section-title">${t('questions')}</h2>
      <p>📞 <a href="tel:3238997156">323-899-7156</a> · ✉️ <a href="mailto:laalhambrasoccerleague@gmail.com">laalhambrasoccerleague@gmail.com</a> · <a class="contact-insta" href="${INSTAGRAM.url}" target="_blank" rel="noopener"><img src="images/instagram.png" alt="">${INSTAGRAM.handle}</a></p>
    </section>
  </div>`;
}

// ---------- photos ----------

// League photos for the home banner (images/photos/photo-NN.jpg, with a smaller -sm copy for phones).
const PHOTOS = Array.from({ length: 13 }, (_, i) => `images/photos/photo-${String(i + 1).padStart(2, '0')}`);

// Home banner: the league photos in a random order (new order each visit). Every 3 seconds the next one
// swipes in; visitors can also swipe or drag the banner, tap the ‹ › arrows or a dot to move themselves.
// Photos load a couple of turns ahead, and a move waits until its photo is ready so it never pops in.
const SLIDE_MS = 3000;
// The wide banner crops each photo; for the close-ups this picks what stays in view (photo number →
// how far down to look, and for some a slight zoom toward one spot). Others stay centered.
const SLIDE_FOCUS = {
  9: { y: '78%' },
  10: { y: '38%' },
  11: { y: '40%', zoom: 1.12, x: '62%' },
  12: { y: '30%' },
};
// Photos 1 and 2 look alike, so the shuffle never puts them next to each other (counting the wrap-around).
const APART = [[0, 1]];
function shufflePhotos() {
  for (;;) {
    const order = PHOTOS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const gap = (a, b) => { const d = Math.abs(order.indexOf(a) - order.indexOf(b)); return Math.min(d, order.length - d); };
    if (APART.every(([a, b]) => gap(a, b) > 1)) return order;
  }
}
const slideOrder = shufflePhotos();
let lastSlideMove = Date.now();
const slideAttrs = i => `srcset="${PHOTOS[i]}-sm.jpg 640w, ${PHOTOS[i]}.jpg 1600w" sizes="100vw"`;
function slideInner(i) {
  const f = SLIDE_FOCUS[i + 1];
  const style = f ? ` style="object-position: 50% ${f.y};${f.zoom ? ` transform: scale(${f.zoom}); transform-origin: ${f.x} ${f.y};` : ''}"` : '';
  return `<img class="main" alt="" draggable="false" ${slideAttrs(i)}${style}>`;
}
function bannerSlidesHTML() {
  const cur = ui.slide = ui.slide || 0;
  const near = k => [0, 1, 2, slideOrder.length - 1].some(d => k === (cur + d) % slideOrder.length);
  return `<div class="banner-slides" aria-hidden="true">${slideOrder.map((photo, k) =>
    `<div class="slide ${k === cur ? 'on' : ''}" data-i="${photo}">${near(k) ? slideInner(photo) : ''}</div>`).join('')}</div>
    <button type="button" class="slide-arrow prev" data-action="slide-step" data-step="-1" aria-label="${t('previous')}">‹</button>
    <button type="button" class="slide-arrow next" data-action="slide-step" data-step="1" aria-label="${t('next')}">›</button>
    <div class="slide-dots">${slideOrder.map((_, k) => `<button type="button" class="${k === cur ? 'on' : ''}" data-action="slide-go" data-k="${k}" aria-label="${t('photos')} ${k + 1}"></button>`).join('')}</div>`;
}

// Move the banner to slide k. Going back, the photo comes in from the left instead of the right.
function goToSlide(k, back) {
  const box = document.querySelector('.banner-slides');
  if (!box) return;
  const slides = box.children, n = slides.length;
  k = (k + n) % n;
  if (k === ui.slide) return;
  [k, (k + 1) % n, (k + 2) % n, (k - 1 + n) % n].forEach(j => { if (!slides[j].firstChild) slides[j].innerHTML = slideInner(+slides[j].dataset.i); });
  const img = slides[k].querySelector('.main');
  if (!img.complete || !img.naturalWidth) {
    lastSlideMove = Date.now();
    return img.addEventListener('load', () => goToSlide(k, back), { once: true });
  }
  [...slides].forEach(el => el.classList.remove('out', 'out-right', 'from-left'));
  const from = slides[ui.slide];
  if (back) {
    slides[k].classList.add('from-left');
    void slides[k].offsetWidth;
    slides[k].classList.remove('from-left');
  }
  from.classList.remove('on');
  from.classList.add(back ? 'out-right' : 'out');
  slides[k].classList.add('on');
  ui.slide = k;
  lastSlideMove = Date.now();
  document.querySelectorAll('.slide-dots button').forEach((d, i) => d.classList.toggle('on', i === k));
}
setInterval(() => {
  if (!document.hidden && Date.now() - lastSlideMove >= SLIDE_MS) goToSlide(ui.slide + 1);
}, 200);

// Swipe on phones, drag with the mouse on computers.
let slideTouch = null;
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.banner.has-slides') && !e.target.closest('a, button')) slideTouch = { x: e.clientX, y: e.clientY };
});
document.addEventListener('pointerup', e => {
  if (!slideTouch) return;
  const dx = e.clientX - slideTouch.x, dy = e.clientY - slideTouch.y;
  slideTouch = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) goToSlide(ui.slide + (dx < 0 ? 1 : -1), dx > 0);
});
document.addEventListener('pointercancel', () => { slideTouch = null; });

function pageAbout() {
  return `
  <div class="wrap page about">
    <div class="about-head">
      ${LOGO}
      <div><p class="eyebrow">${t('aboutUs')}</p><h1 class="page-title">LA Alhambra Soccer League</h1></div>
    </div>
    ${t('aboutText').map(p => `<p class="lead">${p}</p>`).join('')}
    <div class="actions">
      <a class="btn btn-gold" href="#/register">${t('registerNow')}</a>
      <a class="btn btn-outline" href="#/standings">${t('viewStandings')}</a>
    </div>
    <section class="reg-section contact-box">
      <h2 class="section-title">${t('contact')}</h2>
      <p>Alhambra, California · 📞 <a href="tel:3238997156">323-899-7156</a> · ✉️ <a href="mailto:laalhambrasoccerleague@gmail.com">laalhambrasoccerleague@gmail.com</a> · <a class="contact-insta" href="${INSTAGRAM.url}" target="_blank" rel="noopener"><img src="images/instagram.png" alt="">${INSTAGRAM.handle}</a></p>
    </section>
  </div>`;
}


// ---------- seasons & archive ----------

// Start a new season for some divisions: their finished games, final standings and goleadores go to the
// archive; standings, game numbers and goals start over. Teams, logos, player names and games already
// booked for future dates stay.
function startNewSeason(name, divs) {
  const today = todayISO();
  divs.forEach(div => {
    // Teams that withdrew this season go to Archived teams (and give up their rotation number).
    const ended = seasonName(div);
    withdrawnIn(div).forEach(w => {
      archiveTeam(w.team, div, ended);
      const rot = (state.rotation || {})[div];
      if (rot) Object.keys(rot.numbers).forEach(n => { if (rot.numbers[n] === w.team) delete rot.numbers[n]; });
    });
    const done = state.matches.filter(m => m.div === div && (played(m) || m.date < today));
    const scorers = state.scorers.filter(s => s.div === div && s.goals > 0);
    if (done.length || scorers.length) {
      state.archive.push({
        id: `${div}-${Date.now()}`, div, name: seasonName(div), archived: today, games: gameColumns(div),
        teams: [...(state.teams[div] || [])],
        matches: done.map(m => ({ ...m })),
        scorers: scorers.map(s => ({ ...s, games: [...s.games] })), scorerCols: 'league',
        withdrawn: withdrawnIn(div).map(w => ({ ...clone(w), left: (w.left || []).filter(m => m.date < today) })),
        ...(playoffsOf(div) ? { playoffs: clone(playoffsOf(div)), champion: (bracket(div) || {}).champion || '' } : {}),
        ...(copaOf(div) ? { copa: clone(copaOf(div)), copaChampion: (bracket(div, 'copa') || {}).champion || '' } : {}),
      });
    }
    state.matches = state.matches.filter(m => !done.includes(m));
    state.scorers.forEach(s => { if (s.div === div) { s.games = []; s.goals = 0; } });
    state.seasons[div] = name;
    if (state.updated) delete state.updated[div];
    if (state.seasonEnded) delete state.seasonEnded[div];
    if (state.playoffs) delete state.playoffs[div];
    if (state.copa) delete state.copa[div];
    Object.keys(state.withdrawn || {}).forEach(k => { if (state.withdrawn[k].div === div) delete state.withdrawn[k]; });
  });
  save();
}

// Seasons are managed per unit: all youth divisions together, every other division on its own.
function seasonUnits() {
  const youth = DIVISIONS.filter(isYouthAge).map(d => d.id);
  return [
    { key: 'youth', label: t('youth'), divs: youth },
    ...DIVISIONS.filter(d => !isYouthAge(d) && !isTour(d)).map(d => ({ key: d.id, label: divName(d.id), divs: [d.id] })),
  ];
}
const unitDivs = key => (seasonUnits().find(u => u.key === key) || { divs: [key] }).divs;

// Kinds of league for "Add a new league": the board section it goes in and its usual game length.
const LEAGUE_KINDS = {
  futsal: { group: 'futsal', length: 45 },
  varonil: { group: 'adult', length: 75 },
  femenil: { group: 'adult', length: 60 },
  '40': { group: 'adult', length: 70 },
  youth: { group: 'youth', length: 75 },
  other: { group: 'adult', length: 75 },
};
const kindLabel = l => (l.kind === 'other' ? l.kindName : l.kind === 'youth' ? divName(l.age)
  : l.kind === 'futsal' ? t('futsal') : divName(l.kind)) || '';

// Usual length and fields for a kind (youth: for the age group picked).
function leagueDefaults(kind, age) {
  if (kind === 'youth') return age ? { length: lengthFor('', age), fields: divisionFields(age) } : { length: '', fields: [] };
  const fields = kind === 'futsal' ? openFields().filter(f => FIELDS[f].startsWith('Futsal'))
    : ADULT_SLOTS[kind] ? divisionFields(kind) : [];
  return { length: LEAGUE_KINDS[kind].length, fields };
}

// Box on Admin → Seasons for adding a youth age group (like a U-9B). It joins Youth everywhere, in age
// order, and starts out like the age group it's based on: same fields, game length, season and games.
function ageGroupFormHTML(popup = false) {
  return `<form class="${popup ? '' : 'card '}season-form" data-form="new-age-group">
      <h2>＋ ${t('addAgeGroup')}</h2>
      <p class="note">${t('addAgeGroupHelp')}</p>
      <div class="league-grid">
        <label class="field">${t('ageGroupName')}<input class="input" name="name" autocomplete="off"></label>
        <label class="field">${t('ageGroupLike')}<select class="select" name="like" data-change="age-like">
          <option value="" selected disabled>${t('chooseOne')}</option>
          ${DIVISIONS.filter(isYouthAge).map(d => `<option value="${d.id}">${esc(divName(d.id))}</option>`).join('')}
        </select></label>
        <label class="field">${t('gameMinutes')}<input class="input" name="length" type="number" min="20" max="120" inputmode="numeric"></label>
      </div>
      <p class="field-label">${t('ageGroupFields')}</p>
      <div class="div-checks league-fields">${openFields().filter(f => !FIELDS[f].startsWith('Futsal')).map(f =>
        `<label class="check-pill"><input type="checkbox" name="fields" value="${f}" data-change="age-field"><span>${esc(FIELDS[f])}</span></label>`).join('')}</div>
      <p class="warn" hidden></p>
      ${popup ? `<div class="modal-actions">
          <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
          <button class="btn btn-gold" type="submit">${t('addAgeGroupBtn')}</button>
        </div>` : `<button class="btn btn-gold" type="submit">${t('addAgeGroupBtn')}</button>`}
    </form>`;
}

// "＋ New age group" from Start a new season or Add a new league: a pop-up, so those forms keep what's in them.
let ageGroupAdded = null;
function openAgeGroupDialog(onAdded) {
  ageGroupAdded = onAdded;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = ageGroupFormHTML(true);
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); ageGroupAdded = null; });
  dialog.showModal();
  dialog.querySelector('[name=name]').focus();
}

function addAgeGroup(form) {
  const name = form.querySelector('[name=name]').value.trim().replace(/\s+/g, ' ');
  const like = form.querySelector('[name=like]').value;
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  const length = parseInt(form.querySelector('[name=length]').value, 10);
  const fields = [...form.querySelectorAll('[name=fields]:checked')].map(i => i.value);
  const missing = [[name, 'ageGroupName'], [like, 'ageGroupLike'], [length >= 20 && length <= 120, 'gameMinutes'], [fields.length, 'ageGroupFields']]
    .filter(([ok]) => !ok).map(([, k]) => t(k));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}`);
  if (DIVISIONS.some(d => [d.name, d.es].some(n => n && n.toLowerCase() === name.toLowerCase()))) return fail(t('leagueExists'));
  const base = DIVISIONS.find(d => d.id === like);
  const group = {
    id: `L${Date.now().toString(36)}`, name, group: 'youth', day: base.day, custom: true, ageGroup: true, kind: 'youth', age: like,
    fields, start: '08:00', length, perField: 6,
  };
  state.leagues = state.leagues || [];
  state.leagues.push(group);
  addDivision(group);
  state.teams[group.id] = [];
  state.seasons[group.id] = seasonName(like);
  state.seasonGames = { ...(state.seasonGames || {}), [group.id]: gameColumns(like) };
  logAction(`${t('ageGroupAdded')}: ${name}`);
  save();
  const dialog = form.closest('dialog');
  if (dialog) { const done = ageGroupAdded; closeDialog(dialog); if (done) done(group); }
  else render();
  return toast(`${t('ageGroupAdded')}: ${name}`);
}

// ---------- tournaments ----------
// A tournament is one event (a day or a weekend) with one bracket per division picked. Each of those is a
// hidden division ({ tournament, dates }) with its own teams and its own format (knockout, groups then
// knockout, or round robin), so it books on the planner and prints on the schedule sheet like any division,
// but never shows in the league's standings, rotation or seasons.
const tournaments = () => state.tournaments || [];
const tourDivs = tour => DIVISIONS.filter(d => d.tournament === tour.id);
const tourDates = (from, to) => { const out = []; for (let d = from; d <= (to || from) && out.length < 14; d = addDays(d, 1)) out.push(d); return out; };

// Exact tournament days: chips for the days picked, a date box and "+ Add day". Works without redrawing the
// form, so the name and divisions picked so far stay.
const dateChip = d => `<span class="chip on tour-date" data-date="${d}">${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}
  <button type="button" class="chip-x" data-action="tour-rm-date" data-date="${d}" aria-label="${t('remove')}">×</button></span>`;
function tourDatePickerHTML(dates, tourId = '') {
  // Picking a date adds it right away; the days picked list underneath.
  return `<div class="field">${t('tourDays')}
    <div class="tour-date-add"><input class="input" type="date" name="pickDate" data-change="tour-pick-date" aria-label="${t('date')}">
      <button type="button" class="btn btn-sm btn-outline" data-action="tour-add-date" ${tourId ? `data-tour="${tourId}"` : ''}>＋ ${t('addDay')}</button></div>
    <input type="hidden" name="dates" value="${esc(JSON.stringify(dates))}">
    <div class="tour-dates">${dates.map(dateChip).join('') || `<span class="muted no-days">${t('noDaysYet')}</span>`}</div>
  </div>`;
}
function setFormDates(form, dates) {
  dates = [...new Set(dates)].sort();
  form.dates.value = JSON.stringify(dates);
  form.querySelector('.tour-dates').innerHTML = dates.map(dateChip).join('') || `<span class="muted no-days">${t('noDaysYet')}</span>`;
  return dates;
}

function newTournamentForm() {
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  return `<form class="card season-form league-form" data-form="new-tournament">
    <h2>＋ ${t('addTournament')}</h2>
    <p class="note">${t('addTournamentHelp')}</p>
    <div class="league-grid">
      <label class="field">${t('tourName')}<input class="input" name="name" autocomplete="off"></label>
    </div>
    ${tourDatePickerHTML([])}
    <p class="field-label">${t('tourDivisions')}</p>
    ${groups.map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
      ${DIVISIONS.filter(d => d.group === g && !isTour(d)).map(d => `<label class="check-pill"><input type="checkbox" name="divs" value="${d.id}"><span>${esc(divName(d.id))}</span></label>`).join('')}</fieldset>`).join('')}
    <p class="note">${t('tourDivisionsHelp')}</p>
    <p class="field-label">${t('tourGameSettings')}</p>
    <div class="league-grid">
      <label class="field">${t('tourLength')}<input class="input" type="number" name="length" min="10" max="120" step="5" inputmode="numeric" placeholder="${t('tourLengthPh')}"></label>
    </div>
    <div class="tour-switches">
      <label class="strict-toggle"><input type="checkbox" name="strict" checked><span class="switch" aria-hidden="true"></span><span>${t('strictTimes')}</span></label>
      <label class="strict-toggle"><input type="checkbox" name="auto" checked><span class="switch" aria-hidden="true"></span><span>${t('tourAuto')}</span></label>
    </div>
    <p class="note">${t('tourSwitchesHelp')}</p>
    <p class="warn" hidden></p>
    <button class="btn btn-gold" type="submit">${t('createTournament')}</button>
  </form>`;
}

function addTournament(form) {
  const name = form.name.value.trim();
  // A date typed in the box but not added yet counts too.
  const dates = [...new Set([...JSON.parse(form.dates.value || '[]'), ...(form.pickDate.value ? [form.pickDate.value] : [])])].sort();
  const from = dates[0];
  const picked = [...form.querySelectorAll('[name=divs]:checked')].map(c => c.value);
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; warn.scrollIntoView({ block: 'center' }); };
  if (!name || !from) return fail(`${t('fillIn')}: ${[!name && t('tourName'), !from && t('tourDays')].filter(Boolean).join(', ')}`);
  if (!picked.length) return fail(t('pickDivision'));
  const id = `tour${Date.now().toString(36)}`;
  const tour = { id, name, dates, created: todayISO() };
  state.tournaments = [...tournaments(), tour];
  state.leagues = state.leagues || [];
  picked.forEach(src => {
    const base = DIVISIONS.find(d => d.id === src);
    // Same group, fields and game length as the division it's for; its teams start as that division's teams.
    const league = { id: `${id}-${src}`, name: `${name} · ${divName(src)}`, short: divName(src), group: base.group, day: Object.keys(DAY_NUM).find(k => DAY_NUM[k] === dayOfWeek(from)) || 'Sun',
      custom: true, tournament: id, dates: [...dates], from: src, kind: 'other', kindName: t('tournament'), fields: divisionFields(src), start: base.start || (base.group === 'youth' ? '08:00' : base.group === 'futsal' ? '19:00' : '14:00'),
      length: +form.length.value || lengthFor('', src), perField: 6, scorers: false, loose: !form.strict.checked };
    if (!form.auto.checked) state.rotationOff = { ...(state.rotationOff || {}), [league.id]: true };
    state.leagues.push(league);
    addDivision(league);
    state.teams[league.id] = [...(state.teams[src] || [])];
    state.logos = state.logos || {};
    state.teams[league.id].forEach(n => { const l = teamLogo(n, src); if (l) state.logos[`${league.id}|${n}`] = l; });
    state.seasons[league.id] = name;
  });
  ui.tourId = id; ui.tourDiv = `${id}-${picked[0]}`;
  logAction(`${t('tourCreated')}: ${name} · ${picked.map(divName).join(', ')}`);
  save();
  // Open the new tournament (redraw even when already on the Tournaments page).
  if (location.hash === '#/admin/tournaments') render(); else location.hash = '#/admin/tournaments';
  window.scrollTo(0, 0);
  toast(`${t('tourCreated')}: ${name}`);
}

// After a division's days change: the tournament's days are every division's days together, and the
// division's bracket starts on its first day.
function syncTourDates(d) {
  const l = (state.leagues || []).find(x => x.id === d.id);
  if (l && l !== d) l.dates = d.dates;
  const tour = tournaments().find(x => x.id === d.tournament);
  if (tour) tour.dates = [...new Set(tourDivs(tour).flatMap(x => x.dates))].sort();
  const co = copaOf(d.id);
  if (co) co.on = d.dates[0];
}

function removeTournament(id) {
  const tour = tournaments().find(x => x.id === id);
  if (!tour) return;
  tourDivs(tour).forEach(d => {
    state.matches = state.matches.filter(m => m.div !== d.id);
    delete state.teams[d.id]; if (state.copa) delete state.copa[d.id]; if (state.seasons) delete state.seasons[d.id];
    state.leagues = (state.leagues || []).filter(l => l.id !== d.id);
    const i = DIVISIONS.findIndex(x => x.id === d.id);
    if (i >= 0) DIVISIONS.splice(i, 1);
  });
  state.tournaments = tournaments().filter(x => x.id !== id);
  logAction(`${t('tourRemoved')}: ${tour.name}`);
}

const tourWhen = tour => {
  const ds = tour.dates;
  const inRow = ds.every((d, i) => !i || d === addDays(ds[i - 1], 1));
  const f = (d, y) => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', ...(y ? { year: 'numeric' } : {}) });
  if (ds.length === 1) return f(ds[0], true);
  return inRow ? `${f(ds[0])} – ${f(ds[ds.length - 1], true)}` : ds.map((d, i) => f(d, i === ds.length - 1)).join(' · ');
};
// Where a tournament division stands: not set up, group stage, a knockout round, or its champion.
function tourStage(d) {
  const co = copaOf(d.id);
  if (!co) return t('tourNotSetUp');
  const champ = copaChampion(d.id);
  if (champ) return `${t('champion')}: ${champ}`;
  if (co.ko) return currentRound(bracket(d.id, 'copa'));
  return co.roundRobin ? t('roundRobinShort') : t('groupStage');
}

function tournamentsListHTML(admin) {
  const list = [...tournaments()].sort((a, b) => b.dates[0].localeCompare(a.dates[0]));
  if (!list.length) return admin ? `<p class="muted">${t('noTournaments')}</p>` : '';
  return `<div class="tour-list">${list.map(tour => `<div class="card tour-card">
      <div class="tour-head"><h3>${esc(tour.name)}</h3><span class="muted">${esc(tourWhen(tour))}</span>
        ${admin ? `<a class="btn btn-sm btn-gold" href="#/admin/tournaments" data-action="open-tour" data-id="${tour.id}">${t('openTournament')}</a>` : ''}</div>
      <ul class="tour-divs">${tourDivs(tour).map(d => `<li><b>${esc(d.short || divName(d.id))}</b> <span class="muted">· ${esc(tourStage(d))}${d.dates.length !== tour.dates.length ? ` · ${esc(d.dates.map(x => fmtDate(x, { weekday: 'short' })).join(' & '))}` : ''}</span></li>`).join('')}</ul>
    </div>`).join('')}</div>`;
}

function pageAdminTournaments() {
  const tour = tournaments().find(x => x.id === ui.tourId);
  if (!tour) {
    return adminShell('admin/tournaments', `<h1 class="page-title">${t('tournaments')}</h1>
      <p class="note">${t('tournamentsHelp')}</p>
      ${tournamentsListHTML(true)}
      ${newTournamentForm()}`);
  }
  const divs = tourDivs(tour);
  const cur = divs.find(d => d.id === ui.tourDiv) || divs[0];
  ui.adminDiv = cur.id;
  return adminShell('admin/tournaments', `
    <button type="button" class="link-btn" data-action="close-tour">← ${t('tournaments')}</button>
    <h1 class="page-title">${esc(tour.name)}</h1>
    <p class="lead muted">${esc(tourWhen(tour))}</p>

    <div class="pills tour-pills">${divs.map(d => `<button class="pill ${d.id === cur.id ? 'active' : ''}" data-action="tour-div" data-id="${d.id}">${esc(d.short || divName(d.id))}</button>`).join('')}</div>
    <p class="note">${t('tourDivHelp')}</p>
    <div class="card tour-div-days">
      <b>${t('daysThisDivision').replace('{d}', esc(cur.short || divName(cur.id)))}</b>
      <div class="tour-dates">${cur.dates.map(d => `<span class="chip on tour-date">${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}
        ${cur.dates.length > 1 ? `<button type="button" class="chip-x" data-action="ask" data-confirm="tour-div-rm-date" data-id="${cur.id}" data-date="${d}" data-ask="askRmTourDay" data-yes="yesRemove" aria-label="${t('remove')}">×</button>` : ''}</span>`).join('')}</div>
      <div class="tour-date-add"><input class="input" type="date" data-change="tour-div-add-date" data-id="${cur.id}" aria-label="${t('addDay')}">
        <span class="muted">${t('pickToAdd')}</span></div>
    </div>
    <div class="card tour-div-days">
      <b>${t('fieldsThisDivision').replace('{d}', esc(cur.short || divName(cur.id)))}</b>
      <div class="day-checks">${openFields().map(f => `<label class="check-pill"><input type="checkbox" data-change="tour-field" data-id="${cur.id}" value="${f}" ${cur.fields.includes(f) ? 'checked' : ''}><span>${esc(FIELDS[f])}</span></label>`).join('')}</div>
      <div><button type="button" class="btn btn-sm btn-outline" data-action="tour-new-field" data-id="${cur.id}">＋ ${t('newFieldOption')}</button></div>
    </div>
    <div class="card tour-div-days">
      <b>${t('gameSettingsFor').replace('{d}', esc(cur.short || divName(cur.id)))}</b>
      <div class="tour-switches">
        <label class="field inline-field">${t('tourLength')}<input class="input narrow" type="number" min="10" max="120" step="5" inputmode="numeric" value="${cur.length}" data-change="tour-length" data-id="${cur.id}"></label>
        <label class="strict-toggle"><input type="checkbox" data-change="tour-loose" data-id="${cur.id}" ${cur.loose ? '' : 'checked'}><span class="switch" aria-hidden="true"></span><span>${t('strictTimes')}</span></label>
        ${rotationSwitch(cur.id, t('tourAuto'))}
      </div>
      <p class="note">${t('tourSwitchesHelp')}</p>
    </div>
    <div class="tour-plan"><span class="muted">${t('bookIn')}</span>${cur.dates.map(d => `<a class="btn btn-sm btn-outline" href="#/admin/schedule" data-action="tour-to-board" data-date="${d}" data-section="${cur.group}">${t('scheduleBuilder')} · ${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))}</a>`).join('')}</div>
    ${copaBodyHTML(cur.id)}
    <div class="tour-danger"><button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="rm-tournament" data-ask="askRmTournament" data-id="${tour.id}">${t('removeTournament')}</button></div>`);
}

// Edit on Seasons: a league's (or division's) name, day, first game, game length, Goleadores and color.
// Built-in divisions keep their name and schedule; they change Goleadores and color.
function editLeagueHTML(key) {
  const l = customLeague(key);
  const divs = key === 'youth' ? DIVISIONS.filter(d => d.group === 'youth' && !d.custom) : key === 'futsal' ? DIVISIONS.filter(d => d.group === 'futsal' && !d.custom) : [DIVISIONS.find(d => d.id === key)];
  const goles = divs.every(d => hasScorers(d.id));
  const yn = (name, on) => `<span class="yes-no">
      <label class="check-pill"><input type="radio" name="${name}" value="yes" ${on ? 'checked' : ''}><span>${t('yes')}</span></label>
      <label class="check-pill"><input type="radio" name="${name}" value="no" ${on ? '' : 'checked'}><span>${t('no')}</span></label></span>`;
  let time = '';
  if (l) {
    const [hh, mm] = (l.start || '14:00').split(':').map(Number);
    time = `<div class="league-grid">
      <label class="field">${t('leagueName')}<input class="input" name="name" value="${esc(l.name)}" autocomplete="off"></label>
      <label class="field">${t('leagueDay')}<select class="select" name="day">${Object.keys(DAY_NUM).map(d => `<option value="${d}" ${d === l.day ? 'selected' : ''}>${esc(fmtDate(nextWeekday(d), { weekday: 'long' }))}</option>`).join('')}</select></label>
      <div class="field">${t('firstGame')}<span class="league-time">
        <input class="input" name="hour" type="number" min="1" max="12" inputmode="numeric" value="${(hh % 12) || 12}" aria-label="${t('time')}">:<input class="input" name="minute" type="number" min="0" max="59" inputmode="numeric" value="${String(mm).padStart(2, '0')}" aria-label="min">
        <label class="check-pill"><input type="radio" name="ampm" value="AM" ${hh < 12 ? 'checked' : ''}><span>AM</span></label>
        <label class="check-pill"><input type="radio" name="ampm" value="PM" ${hh >= 12 ? 'checked' : ''}><span>PM</span></label></span></div>
      <label class="field">${t('tourLength')}<input class="input" name="length" type="number" min="10" max="150" step="5" inputmode="numeric" value="${l.length}"></label>
    </div>`;
  }
  return `<form class="edit-league" data-form="edit-league" data-key="${key}" data-label="${esc(l ? l.name : key === 'youth' ? t('youth') : key === 'futsal' ? t('futsal') : divName(key))}">
    <h3>${t('editWord')}: ${esc(l ? l.name : key === 'youth' ? t('youth') : key === 'futsal' ? t('futsal') : divName(key))}</h3>
    ${time}
    <div class="field">${t('leagueScorers')} ${yn('scorers', goles)}<small class="muted">${t('leagueScorersHelp')}</small></div>
    <p class="warn" hidden></p>
    <div class="row-actions"><button class="btn btn-sm btn-gold" type="submit">${t('save')}</button>
      <button type="button" class="btn btn-sm btn-outline" data-action="edit-league" data-for="${key}">${t('cancel')}</button></div>
  </form>`;
}
function saveEditLeague(form) {
  const key = form.dataset.key, f = new FormData(form);
  const l = customLeague(key);
  const warn = form.querySelector('.warn');
  undoable(`${t('editWord')}: ${form.dataset.label}`);
  if (l) {
    const name = (f.get('name') || '').trim();
    const hour = parseInt(f.get('hour'), 10), minute = f.get('minute') === '' ? 0 : parseInt(f.get('minute'), 10);
    if (!name || !(hour >= 1 && hour <= 12) || !(minute >= 0 && minute <= 59)) { warn.textContent = `${t('fillIn')}: ${[!name && t('leagueName'), !(hour >= 1 && hour <= 12) && t('firstGame')].filter(Boolean).join(', ')}`; warn.hidden = false; return; }
    const d = DIVISIONS.find(x => x.id === key);
    const vals = { name, day: f.get('day'), start: minToHHMM((hour % 12 + (f.get('ampm') === 'PM' ? 12 : 0)) * 60 + minute), length: Math.max(10, parseInt(f.get('length'), 10) || l.length), scorers: f.get('scorers') === 'yes' };
    Object.assign(l, vals); if (d && d !== l) Object.assign(d, vals);
  } else {
    const divs = key === 'youth' ? DIVISIONS.filter(d => d.group === 'youth' && !d.custom) : key === 'futsal' ? DIVISIONS.filter(d => d.group === 'futsal' && !d.custom) : [{ id: key }];
    state.scorersSet = { ...(state.scorersSet || {}) };
    divs.forEach(d => { state.scorersSet[d.id] = f.get('scorers') === 'yes'; });
  }
  logAction(`${t('editWord')}: ${form.dataset.label} · ${t('leagueScorers')}: ${t(f.get('scorers') === 'yes' ? 'yes' : 'no')}`);
  ui.editLeague = null;
  save(); render();
  toast(t('saved'));
}

// Box on Admin → Seasons for starting a new league.
// Everything starts empty so nothing looks already chosen.
// The same form edits a league that was added: everything filled in, Save instead of Add.
function newLeagueForm(l = null) {
  const choose = `<option value="" ${l ? '' : 'selected'} disabled>${t('chooseOne')}</option>`;
  const sel = (a, b) => (l && a === b ? 'selected' : '');
  const chk = on => (l && on ? 'checked' : '');
  const [hh, mm] = l ? (l.start || '14:00').split(':').map(Number) : [null, null];
  const val = v => (l && v !== undefined && v !== null && v !== '' ? `value="${esc(v)}"` : '');
  return `<form class="card season-form league-form ${l ? 'edit-full' : ''}" data-form="${l ? 'edit-league-full' : 'new-league'}" ${l ? `data-key="${l.id}" data-scorers-touched="1" data-fields-touched="1"` : ''}>
      <h2>${l ? `${t('editWord')}: ${esc(l.name)}` : `＋ ${t('addLeague')}`}</h2>
      ${l ? '' : `<p class="note">${t('addLeagueHelp')}</p>`}
      <label class="field">${t('leagueName')}<input class="input" name="name" autocomplete="off" ${val(l && l.name)}></label>
      <div class="league-grid">
        <label class="field">${t('leagueType')}<select class="select" name="kind" data-change="league-kind">${choose}
          <option value="futsal" ${sel(l && l.kind, 'futsal')}>${t('futsal')}</option>
          ${['varonil', 'femenil', '40'].map(k => `<option value="${k}" ${sel(l && l.kind, k)}>${esc(divName(k))}</option>`).join('')}
          <option value="youth" ${sel(l && l.kind, 'youth')}>${t('youth')}</option>
          <option value="other" ${sel(l && l.kind, 'other')}>${t('otherKind')}</option>
        </select></label>
        <label class="field">${t('leagueDay')}<select class="select" name="day">${choose}${Object.keys(DAY_NUM).map(d =>
          `<option value="${d}" ${sel(l && l.day, d)}>${esc(fmtDate(nextWeekday(d), { weekday: 'long' }))}</option>`).join('')}</select></label>
        <label class="field">${t('leagueSeason')}<input class="input" name="season" autocomplete="off" ${val(l && seasonName(l.id))}></label>
      </div>
      <label class="field league-other" ${l && l.kind === 'other' ? '' : 'hidden'}>${t('otherKindName')}<input class="input" name="kindName" autocomplete="off" ${val(l && l.kindName)}></label>
      <div class="league-youth" ${l && l.kind === 'youth' ? '' : 'hidden'}>
        <p class="field-label">${t('leagueAge')}</p>
        <div class="div-checks">${DIVISIONS.filter(isYouthAge).map(d =>
          `<label class="check-pill"><input type="radio" name="age" value="${d.id}" data-change="league-age" ${chk(l && l.age === d.id)}><span>${esc(divName(d.id))}</span></label>`).join('')}</div>
        <button type="button" class="link-btn add-label-btn" data-action="new-age-group-for" data-target="league">＋ ${t('newAgeGroup')}</button>
      </div>
      <div class="field">${t('leagueScorers')}
        <span class="yes-no">
          <label class="check-pill"><input type="radio" name="scorers" value="yes" data-change="league-scorers" ${chk(l && hasScorers(l.id))}><span>${t('yes')}</span></label>
          <label class="check-pill"><input type="radio" name="scorers" value="no" data-change="league-scorers" ${chk(l && !hasScorers(l.id))}><span>${t('no')}</span></label>
        </span>
        <small class="muted">${t('leagueScorersHelp')}</small>
      </div>
      <p class="field-label">${t('leagueFields')}</p>
      <div class="div-checks league-fields">${[...new Set([...openFields(), ...(l ? l.fields || [] : []).filter(f => FIELDS[f])])].map(f => `<label class="check-pill"><input type="checkbox" name="fields" value="${f}" ${chk(l && (l.fields || []).includes(f))}><span>${esc(FIELDS[f])}</span></label>`).join('')}</div>
      <button type="button" class="link-btn add-label-btn" data-action="new-field-for-league">＋ ${t('newFieldOption')}</button>
      <div class="league-grid">
        <div class="field">${t('firstGame')}
          <span class="league-time">
            <input class="input" name="hour" type="number" min="1" max="12" inputmode="numeric" aria-label="${t('time')}" ${val(l ? (hh % 12) || 12 : '')}>:<input class="input" name="minute" type="number" min="0" max="59" inputmode="numeric" aria-label="${t('time')}" ${val(l ? String(mm).padStart(2, '0') : '')}>
            <label class="check-pill"><input type="radio" name="ampm" value="AM" ${chk(l && hh < 12)}><span>AM</span></label>
            <label class="check-pill"><input type="radio" name="ampm" value="PM" ${chk(l && hh >= 12)}><span>PM</span></label>
          </span>
        </div>
        <label class="field">${t('gameMinutes')}<input class="input" name="length" type="number" min="20" max="120" inputmode="numeric" ${val(l && l.length)}></label>
        <label class="field">${t('gamesPerField')}<input class="input" name="perField" type="number" min="1" max="12" inputmode="numeric" ${val(l && l.perField)}></label>
        <label class="field">${t('gamesInSeason')}<input class="input" name="games" type="number" min="1" max="40" inputmode="numeric" ${val(l && gameColumns(l.id))}></label>
      </div>
      <p class="warn" hidden></p>
      ${l ? `<div class="row-actions"><button class="btn btn-gold" type="submit">${t('save')}</button>
        <button type="button" class="btn btn-outline" data-action="edit-league" data-for="${l.id}">${t('cancel')}</button></div>`
        : `<button class="btn btn-gold" type="submit">${t('addLeagueBtn')}</button>`}
    </form>`;
}

// Reads the league form (adding or editing): the league's values, or null after saying what's missing.
function readLeagueForm(form, editingId = '') {
  const f = new FormData(form);
  const warn = form.querySelector('.warn');
  const name = f.get('name').trim();
  const season = f.get('season').trim();
  const fail = msg => { warn.textContent = msg; warn.hidden = false; return null; };
  const num = (key, lo, hi) => { const n = parseInt(f.get(key), 10); return n >= lo && n <= hi ? n : null; };
  const hour = num('hour', 1, 12);
  const minute = f.get('minute') === '' ? 0 : num('minute', 0, 59);
  const length = num('length', 20, 120), perField = num('perField', 1, 12), games = num('games', 1, 40);
  const missing = [
    [name, 'leagueName'], [f.get('kind'), 'leagueType'],
    [f.get('kind') !== 'youth' || f.get('age'), 'leagueAge'], [f.get('kind') !== 'other' || (f.get('kindName') || '').trim(), 'otherKindName'], [f.get('day'), 'leagueDay'], [season, 'leagueSeason'],
    [f.getAll('fields').length, 'leagueFields'], [hour !== null && minute !== null && f.get('ampm'), 'firstGame'],
    [f.get('scorers'), 'leagueScorers'], [length, 'gameMinutes'], [perField, 'gamesPerField'], [games, 'gamesInSeason'],
  ].filter(([ok]) => !ok).map(([, key]) => t(key));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}`);
  if (DIVISIONS.some(d => d.id !== editingId && [d.name, d.es].some(n => n && n.toLowerCase() === name.toLowerCase()))) return fail(t('leagueExists'));
  const h = hour % 12 + (f.get('ampm') === 'PM' ? 12 : 0);
  return { season, games, league: {
    name, group: LEAGUE_KINDS[f.get('kind')].group, day: f.get('day'),
    kind: f.get('kind'), kindName: f.get('kind') === 'other' ? f.get('kindName').trim() : '', age: f.get('kind') === 'youth' ? f.get('age') : '',
    fields: f.getAll('fields'), start: minToHHMM(h * 60 + minute), length, perField, scorers: f.get('scorers') === 'yes',
  } };
}
function saveLeagueEdit(form) {
  const id = form.dataset.key, l = customLeague(id);
  const r = readLeagueForm(form, id);
  if (!r) return;
  undoable(`${t('editWord')}: ${l.name}`);
  const d = DIVISIONS.find(x => x.id === id);
  Object.assign(l, r.league); if (d && d !== l) Object.assign(d, r.league);
  state.seasons[id] = r.season;
  state.seasonGames = { ...(state.seasonGames || {}), [id]: r.games };
  logAction(`${t('editWord')}: ${l.name}`);
  ui.editLeague = null;
  save(); render();
  toast(`${t('saved')}: ${l.name}`);
}

function addLeague(form) {
  const f = new FormData(form);
  const warn = form.querySelector('.warn');
  const name = f.get('name').trim();
  const season = f.get('season').trim();
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  const num = (key, lo, hi) => { const n = parseInt(f.get(key), 10); return n >= lo && n <= hi ? n : null; };
  const hour = num('hour', 1, 12);
  const minute = f.get('minute') === '' ? 0 : num('minute', 0, 59);
  const length = num('length', 20, 120), perField = num('perField', 1, 12), games = num('games', 1, 40);
  // Say exactly which boxes still need filling in.
  const missing = [
    [name, 'leagueName'], [f.get('kind'), 'leagueType'],
    [f.get('kind') !== 'youth' || f.get('age'), 'leagueAge'], [f.get('kind') !== 'other' || (f.get('kindName') || '').trim(), 'otherKindName'], [f.get('day'), 'leagueDay'], [season, 'leagueSeason'],
    [f.getAll('fields').length, 'leagueFields'], [hour !== null && minute !== null && f.get('ampm'), 'firstGame'],
    [f.get('scorers'), 'leagueScorers'], [length, 'gameMinutes'], [perField, 'gamesPerField'], [games, 'gamesInSeason'],
  ].filter(([ok]) => !ok).map(([, key]) => t(key));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}`);
  if (DIVISIONS.some(d => [d.name, d.es].some(n => n && n.toLowerCase() === name.toLowerCase()))) return fail(t('leagueExists'));
  const h = hour % 12 + (f.get('ampm') === 'PM' ? 12 : 0);
  const league = {
    id: `L${Date.now().toString(36)}`, name, group: LEAGUE_KINDS[f.get('kind')].group, day: f.get('day'), custom: true,
    kind: f.get('kind'), kindName: f.get('kind') === 'other' ? f.get('kindName').trim() : '', age: f.get('kind') === 'youth' ? f.get('age') : '',
    fields: f.getAll('fields'), start: minToHHMM(h * 60 + minute), length, perField, scorers: f.get('scorers') === 'yes',
  };
  state.leagues = state.leagues || [];
  state.leagues.push(league);
  DIVISIONS.push(league);
  state.teams[league.id] = [];
  state.seasons[league.id] = season;
  state.seasonGames = state.seasonGames || {};
  state.seasonGames[league.id] = games;
  logAction(`${t('leagueAdded')}: ${name}`);
  save(); render();
  return toast(`${t('leagueAdded')}: ${name}`);
}

// Deletes an added league with its teams, games, goleadores and past seasons.
function removeLeague(id) {
  const name = divName(id);
  logAction(`${t('leagueRemoved')}: ${name}`, { type: 'league', league: clone(customLeague(id)), teams: clone(state.teams[id] || []),
    matches: clone(state.matches.filter(m => m.div === id)), scorers: clone(state.scorers.filter(x => x.div === id)),
    archive: clone((state.archive || []).filter(a => a.div === id)), season: state.seasons[id], games: (state.seasonGames || {})[id] });
  state.leagues = (state.leagues || []).filter(l => l.id !== id);
  const i = DIVISIONS.findIndex(d => d.id === id);
  if (i >= 0) DIVISIONS.splice(i, 1);
  state.matches = state.matches.filter(m => m.div !== id);
  state.scorers = state.scorers.filter(s => s.div !== id);
  state.archive = (state.archive || []).filter(a => a.div !== id);
  ['teams', 'seasons', 'seasonGames', 'updated'].forEach(k => { if (state[k]) delete state[k][id]; });
  Object.values(state.matchDays || {}).forEach(day => Object.values(day).forEach(sec => Object.values(sec).forEach(rows =>
    rows.forEach(r => { if (r.div === id) Object.assign(r, { div: '', home: '', away: '', mid: null }); }))));
  if (ui.div === id) ui.div = '40';
  if (ui.adminDiv === id) ui.adminDiv = '40';
  ui.removeLeague = null;
  save(); render();
  return toast(`${t('leagueRemoved')}: ${name}`);
}

// The round a bracket is on now: the first one with a matchup still to decide.
function currentRound(b) {
  const r = b.rounds.find(x => x.nodes.some(n => !n.bye && !n.winner));
  return t(r ? r.key : 'final');
}
const playoffsLeft = div => {
  const po = playoffsOf(div) && bracket(div), co = copaOf(div);
  return (po && !po.champion) || (co && !(co.ko && (bracket(div, 'copa') || {}).champion));
};
// One division's stage, as short pieces: ["Playoffs · Semifinal", "Copa · Group stage"] or ["Champion: X"].
function divisionStage(div) {
  const out = [];
  if (playoffsOf(div)) {
    const b = bracket(div);
    out.push(b.champion ? `${t('champion')}: ${b.champion}` : `${t('playoffs')} · ${currentRound(b)}`);
  }
  const co = copaOf(div);
  if (co) {
    const b = co.ko && bracket(div, 'copa');
    out.push(b && b.champion ? `${t('copa')} · ${t('champion')}: ${b.champion}` : `${t('copa')} · ${b ? currentRound(b) : t('groupStage')}`);
  }
  if (!out.length) out.push(seasonEnded(div) ? t('seasonEndedShort') : t('regularSeason'));
  return out;
}
// The Stage cell: one division, or for Youth a short summary by age group.
function stageCell(divs) {
  const link = (div, html) => `<a class="stage-link" href="#/admin/playoffs" data-admin-div="${div}">${html}</a>`;
  if (divs.length === 1) {
    const st = divisionStage(divs[0]);
    const on = playoffsOf(divs[0]) || copaOf(divs[0]);
    return st.map(x => (on ? link(divs[0], esc(x)) : `<span class="muted">${esc(x)}</span>`)).join('<br>');
  }
  const done = divs.filter(d => playoffsOf(d) && bracket(d).champion);
  const going = divs.filter(d => playoffsOf(d) && !bracket(d).champion);
  const regular = divs.filter(d => !playoffsOf(d));
  const objs = id => id.map(x => DIVISIONS.find(d => d.id === x));
  const lines = [];
  if (going.length) lines.push(link(going[0], `${t('playoffs')}: ${esc(divRuns('youth', objs(going)))}`));
  if (done.length) lines.push(link(done[0], `${t('playoffsDone')}: ${esc(divRuns('youth', objs(done)))}`));
  if (regular.length) lines.push(`<span class="muted">${t('regularSeason')}${going.length || done.length ? `: ${esc(divRuns('youth', objs(regular)))}` : ''}</span>`);
  return lines.join('<br>');
}

function pageAdminSeasons() {
  const units = seasonUnits();
  const pending = ui.newSeason;
  const daysPlayed = u => Math.max(...u.divs.map(d => new Set(state.matches.filter(m => m.div === d && played(m) && !m.playoff && !m.fromFriendly).map(m => m.date)).size));
  const youthDivs = DIVISIONS.filter(isYouthAge);
  // "End season" marks the final standings; "Reopen" undoes it. Starting a new season clears it.
  const endCell = (key, divs) => divs.every(seasonEnded)
    ? `<span class="final-tag">${t('seasonEndedShort')} ${fmtDate(seasonEnded(divs[0]), { month: 'short', day: 'numeric' })}</span>
       <button type="button" class="link-btn" data-action="reopen-season" data-for="${key}">${t('reopenSeason')}</button>`
    : `<button type="button" class="btn btn-sm btn-end" data-action="ask" data-confirm="end-season" data-ask="${divs.some(playoffsLeft) ? 'endSeasonPlayoffsQ' : 'endSeasonQ'}" data-yes="yesEndSeason" data-for="${key}">${t('endSeason')}</button>`;
  const youthOn = !!pending && (pending.divs.includes('youth') || youthDivs.some(d => pending.divs.includes(d.id)));
  const unitLabel = k => (units.find(u => u.key === k) || { label: divName(k) }).label;
  // Youth shows as one row; ▾ opens each youth division in case one runs a different season.
  const same = (u, f) => u.divs.every(d => f(d) === f(u.divs[0]));
  const stepper = (key, n) => `<span class="stepper-cell">
            <button type="button" class="icon-btn" data-action="season-games" data-for="${key}" data-step="-1" aria-label="−1">−</button>
            <b>${n}</b>
            <button type="button" class="icon-btn" data-action="season-games" data-for="${key}" data-step="1" aria-label="+1">+</button>
          </span>`;
  const leagueRow = u => {
    // an added league's full form goes under the table (it's too wide for a table row on a phone)
    if (ui.editLeague === u.key && !customLeague(u.key)) return `<tr class="sub-row"><td colspan="6" class="left">${editLeagueHTML(u.key)}</td></tr>`;
    const l = customLeague(u.key);
    if (!l) return '';
    if (ui.removeLeague === l.id) return `<tr class="sub-row remove-row"><td colspan="6" class="left">
        <p>${t('removeLeague')} <b>${esc(l.name)}</b>? ${t('removeLeagueWarn')}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline btn-sm" data-action="cancel-remove-league">${t('cancel')}</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="confirm-remove-league">${t('yesRemove')}</button>
        </div></td></tr>`;
    return '';
  };
  const subRows = youthDivs.map(d => `<tr class="sub-row">
          <td class="left">${esc(divName(d.id))}${d.ageGroup ? `<small class="muted unit-range">${t('addedAgeGroup')} · <button type="button" class="link-btn" data-action="remove-league" data-for="${d.id}">${t('removeLeague')}</button></small>` : ''}</td>
          <td class="left">${esc(seasonName(d.id))}</td>
          <td>${stepper(d.id, gameColumns(d.id))}</td>
          <td>${daysPlayed({ divs: [d.id] })}</td>
          <td class="left stage-cell">${stageCell([d.id])}</td>
          <td>${endCell(d.id, [d.id])}</td>
        </tr>${d.ageGroup ? leagueRow({ key: d.id }) : ''}`).join('');
  return adminShell('admin/seasons', `
    <h1 class="page-title">${t('seasons')}</h1>
    <div class="table-card">
      <table class="table">
        <thead><tr><th class="left">${t('division')}</th><th class="left">${t('currentSeason')}</th><th>${t('gamesInSeason')}</th><th>${t('gamesPlayed')}</th><th class="left">${t('stage')}</th><th>${t('seasonStatus')}</th></tr></thead>
        <tbody>${units.map(u => `<tr>
          <td class="left">${u.key === 'youth'
            ? `<button type="button" class="unit-toggle" data-action="toggle-youth-seasons" aria-expanded="${!!ui.youthSeasonsOpen}"><b>${esc(u.label)}</b> <span class="caret">${ui.youthSeasonsOpen ? '▴' : '▾'}</span></button>`
            : `<b>${esc(u.label)}</b>`}${u.divs.length > 1 ? `<small class="muted unit-range">${esc(divName(u.divs[0]))} – ${esc(divName(u.divs[u.divs.length - 1]))}</small>` : ''}${customLeague(u.key)
            ? `<small class="muted unit-range">${t('addedLeague')}${kindLabel(customLeague(u.key)) ? ` · ${esc(kindLabel(customLeague(u.key)))}` : ''} · ${t(hasScorers(u.key) ? 'scorersOn' : 'scorersOff')} · ${esc(fmtDate(nextWeekday(customLeague(u.key).day), { weekday: 'long' }))} · <button type="button" class="link-btn" data-action="remove-league" data-for="${u.key}">${t('removeLeague')}</button></small>` : ''}
            <button type="button" class="link-btn small edit-unit" data-action="edit-league" data-for="${u.key}">${t(ui.editLeague === u.key ? 'close' : 'editWord')}</button></td>
          <td class="left">${same(u, seasonName) ? esc(seasonName(u.divs[0])) : `<span class="muted">${t('mixed')}</span>`}</td>
          <td>${stepper(u.key, same(u, gameColumns) ? gameColumns(u.divs[0]) : '–')}</td>
          <td>${daysPlayed(u)}</td>
          <td class="left stage-cell">${stageCell(u.divs)}</td>
          <td>${endCell(u.key, u.divs)}</td>
        </tr>${u.key === 'youth' && (ui.youthSeasonsOpen || (customLeague(ui.removeLeague) || {}).ageGroup) ? subRows : ''}${leagueRow(u)}`).join('')}</tbody>
      </table>
    </div>

    ${customLeague(ui.editLeague) ? `<div id="edit-league-box">${newLeagueForm(customLeague(ui.editLeague))}</div>` : ''}
    <form class="card season-form" data-form="new-season">
      <h2>${t('newSeasonTitle')}</h2>
      <p class="note">${t('newSeasonHelp')}</p>
      <label class="field">${t('newSeasonName')}<input class="input" name="name" required autocomplete="off" value="${esc(pending ? pending.name : '')}"></label>
      <label class="field">${t('newSeasonGames')}<input class="input season-games-input" name="games" type="number" min="1" max="40" inputmode="numeric" value="${pending && pending.games ? pending.games : ''}"></label>
      <p class="field-label">${t('seasonDivisions')}</p>
      <div class="div-checks">${units.map(u => `<label class="check-pill"><input type="checkbox" name="divs" value="${u.key}" ${u.key === 'youth' ? `data-change="season-youth" ${youthOn ? 'checked' : ''}` : pending && pending.divs.includes(u.key) ? 'checked' : ''}><span>${esc(u.label)}</span></label>`).join('')}</div>
      <div class="youth-pick" ${youthOn ? '' : 'hidden'}>
        <p class="field-label">${t('pickYouth')}</p>
        <div class="div-checks">${youthDivs.map(d => `<label class="check-pill"><input type="checkbox" name="youthDivs" value="${d.id}" ${!pending || pending.divs.includes('youth') || pending.divs.includes(d.id) ? 'checked' : ''}><span>${esc(divName(d.id))}</span></label>`).join('')}</div>
        <button type="button" class="link-btn add-label-btn" data-action="new-age-group-for" data-target="season">＋ ${t('newAgeGroup')}</button>
      </div>
      <p class="warn" hidden></p>
      ${pending ? `<div class="season-confirm">
          <p>${t('confirmSeason')} <b>${esc(pending.name)}</b>${pending.games ? ` (${pending.games} ${t('gamesWord')})` : ''}: ${pending.divs.filter(k => !(pending.divs.includes('youth') && groupOf(k) === 'youth')).map(k => `<b>${esc(unitLabel(k))}</b> (${esc(seasonName(unitDivs(k)[0]))} → ${t('archive')})`).join(', ')}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-outline" data-action="cancel-season">${t('cancel')}</button>
            <button type="button" class="btn btn-danger" data-action="confirm-season">${t('yesStart')}</button>
          </div>
        </div>`
      : `<button class="btn btn-gold" type="submit">${t('startSeason')}</button>`}
    </form>

    ${ageGroupFormHTML()}

    ${newLeagueForm()}

    <section class="reg-section"><h2 class="section-title">${t('tournaments')}</h2>
      ${tournamentsListHTML(true)}
      ${newTournamentForm()}</section>

    <section class="reg-section">
      <h2 class="section-title">${t('archivedSeasons')}</h2>
      ${archiveListHTML(true) || empty(t('noArchive'))}
    </section>`);
}

// Past seasons, newest first, grouped by season name.
function archiveListHTML(admin = false) {
  const byName = groupBy([...(state.archive || [])].reverse(), a => a.name);
  return [...byName].map(([name, items]) => `<div class="archive-season">
      <h3>${esc(name)}</h3>
      <div class="archive-divs">${items.map(a => `<span class="archive-item">
        <button type="button" class="pill" data-action="open-archive" data-id="${a.id}">${esc(divName(a.div))}</button>
        ${admin && latestArchive(a.div) === a ? `<button type="button" class="link-btn" data-action="ask" data-confirm="bring-back" data-ask="bringBackQ" data-yes="yesBringBack" data-id="${a.id}">↶ ${t('bringBack')}</button>` : ''}
      </span>`).join('')}</div>
    </div>`).join('');
}

function pageArchive() {
  const a = (state.archive || []).find(x => x.id === ui.archiveId);
  if (!a) {
    return `
  <div class="wrap page">
    <h1 class="page-title">${t('archive')}</h1>
    <p class="lead muted">${t('archiveSub')}</p>
    ${archiveListHTML() || empty(t('noArchive'))}
  </div>`;
  }
  const days = [...new Set(a.matches.filter(m => !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
  const champs = [a.champion && `${t('champion')}: <b>${esc(a.champion)}</b>`, a.copaChampion && `${t('copa')} · ${t('champion')}: <b>${esc(a.copaChampion)}</b>`].filter(Boolean);
  return `
  <div class="wrap page">
    <button type="button" class="link-btn" data-action="close-archive">← ${t('archive')}</button>
    <h1 class="page-title">${esc(a.name)} · ${esc(divName(a.div))}</h1>
    ${champs.length ? `<p class="champion">${champs.join(' · ')}</p>` : ''}
    ${a.playoffs ? `<h2 class="sub">${t('playoffs')}</h2>${bracketHTML(a.div, false, 'playoffs', a)}` : ''}
    ${a.copa && a.copa.ko ? `<h2 class="sub">${t('copa')}</h2>${bracketHTML(a.div, false, 'copa', a)}` : ''}
    <h2 class="sub">${t('standings')}</h2>
    ${standingsTable(a.div, false, undefined, a)}
    ${hasScorers(a.div) && a.scorers.length ? `<h2 class="sub">${t('scorers')}</h2>${scorerList(a.div, undefined, a)}` : ''}
    <h2 class="sub">${t('results')}</h2>
    ${[...days].reverse().map(d => `<div class="day">
      <h3 class="day-title">${t('game')} ${days.indexOf(d) + 1} · ${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h3>
      <div class="stack">${a.matches.filter(m => m.date === d && !m.playoff).sort(byDateTime).map(m => matchCard(m)).join('')}</div>
    </div>`).join('') || empty(t('noMatches'))}
  </div>`;
}

// ---------- admin ----------

// Admin menu names in Title Case ("Enter Scores"); Spanish keeps its usual capitals.
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
const navTitle = txt => (LANG === 'es' ? txt : txt.split(' ').map((w, i) => (i && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' '));
function adminShell(active, body) {
  // Grouped by how often they're used: every week, during the season, then setup.
  const groups = [
    ['navWeekly', [['admin', 'dashboard'], ['admin/scores', 'enterScores'], ['admin/schedule', 'scheduleBuilder'], ['admin/sheet', 'scheduleSheet'], ['admin/scorers', 'manageScorers'], ['admin/redcards', 'redCards'], ['admin/agechecks', 'ageChecks']]],
    ['navSeason', [['admin/teamgames', 'teamGames'], ['admin/teams', 'teams'], ['admin/rotation', 'rotation'], ['admin/playoffs', 'playoffs'], ['admin/tournaments', 'tournaments'], ['admin/seasons', 'seasons']]],
    ['navSetup', [['admin/fields', 'fields'], ['admin/settings', 'settings'], ['admin/history', 'history'], ['admin/table', 'tableImage'], ['admin/regpage', 'regPageButtons'], ['admin/homepage', 'homePageNav']]],
  ];
  // On a phone or tablet the list drops down from the ☰ in the black header, like the public site's menu.
  return `
  <div class="admin">
    <aside class="admin-nav ${ui.adminMenuOpen ? 'open' : ''}">
      ${groups.map(([g, l]) => `<p class="nav-group">${t(g)}</p>${l.map(([r, k]) => `<a href="#/${r}" class="${r === active ? 'active' : ''}">${navTitle(t(k))}</a>`).join('')}`).join('')}

      ${whoName() ? `<p class="signed-in">${t('signedInAs')} <b>${esc(whoName())}</b></p>` : ''}
      <a class="nav-view-site" href="#/" target="_blank" rel="noopener">${t('viewSite')} ↗</a>
      <button class="link-btn" data-action="signout">${t('signOut')}</button>
    </aside>
    <section class="admin-main">
      ${cloudOn() && CLOUD.user && !CLOUD.user.displayName && active !== 'admin/settings' ? `<div class="demo-banner name-banner"><span>${t('addYourName')}</span><a class="btn btn-sm btn-outline" href="#/admin/settings">${t('settings')} →</a></div>` : ''}
      ${cloudOn() ? '' : `<div class="demo-banner"><span>${t('demoBanner')}</span><button class="btn btn-sm btn-outline" data-action="reset">${t('resetDemo')}</button></div>`}
      ${body}
    </section>
  </div>`;
}

// ---------- admin accounts ----------
// Admins sign in with their own email and password (Admin → Settings → Admin accounts). Until the first
// account is added, the demo sign-in (any email) still works. Passwords are kept as a SHA-256 hash.
const admins = () => state.admins || [];
// A password box with a Show/Hide button next to it.
const pwInput = (name, autocomplete, required = false) => `<span class="pw-wrap"><input class="input" type="password" name="${name}" ${required ? 'required' : ''} autocomplete="${autocomplete}">
  <button type="button" class="btn btn-sm btn-outline pw-toggle" data-action="toggle-pw" aria-pressed="false">${t('showPassword')}</button></span>`;
async function hashPassword(email, password) {
  const data = new TextEncoder().encode(`${email.trim().toLowerCase()}|${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// A sign-in from before signing in lasted until Sign out (kept only for the tab) is carried over.
const readWho = () => {
  try {
    const old = sessionStorage.getItem('asl-admin-who');
    if (old && !localStorage.getItem('asl-admin-who')) localStorage.setItem('asl-admin-who', old);
    return localStorage.getItem('asl-admin-who') || '';
  } catch (e) { return ''; }
};
const writeWho = v => {
  try { v ? localStorage.setItem('asl-admin-who', v) : localStorage.removeItem('asl-admin-who'); sessionStorage.removeItem('asl-admin-who'); } catch (e) {}
};
// The name shown for whoever is signed in (an account's name, or the email used for the demo sign-in).
// Online (Firebase) sign-in is on: accounts live in Firebase instead of this browser.
const cloudOn = () => typeof CLOUD !== 'undefined' && CLOUD.on;
// History shows people's names, never their email. Names come from each admin's account ("Your name in
// History" in Settings), or from older "Admin added: Name (email)" lines; otherwise the part before the @.
function knownNames() {
  const map = {};
  (state.log || []).forEach(e => { const m = /^[^:]*: (.+) \((\S+@\S+)\)$/.exec(e.text || ''); if (m) map[m[2].toLowerCase()] = m[1]; });
  Object.entries(state.adminNames || {}).forEach(([k, v]) => { if (v) map[k.toLowerCase()] = v; });
  if (cloudOn() && CLOUD.user && CLOUD.user.displayName) map[CLOUD.user.email.toLowerCase()] = CLOUD.user.displayName;
  return map;
}
const nameFromEmail = who => (who && who.includes('@') ? knownNames()[who.toLowerCase()] || who.split('@')[0] : who || '');
// Emails written into History before: swap them for names (History is part of the shared league data).
function scrubLogEmails() {
  let changed = false;
  const names = knownNames();
  (state.log || []).forEach(e => {
    if (e.by && e.by.includes('@')) { e.by = names[e.by.toLowerCase()] || e.by.split('@')[0]; changed = true; }
    const clean = (e.text || '').replace(/ \(\S+@\S+\)$/, '');
    if (clean !== e.text) { e.text = clean; changed = true; }
  });
  if (state.adminNames) { delete state.adminNames; changed = true; }
  return changed;
}
function whoName() {
  const who = readWho();
  if (cloudOn()) return (CLOUD.user && CLOUD.user.displayName) || (state.adminNames || {})[who] || nameFromEmail(who);
  const a = admins().find(x => x.id === who);
  return a ? a.name : who;
}

async function signIn(form) {
  const email = form.email.value.trim();
  const warn = form.querySelector('.warn');
  if (admins().length) {
    const a = admins().find(x => x.email.toLowerCase() === email.toLowerCase());
    const ok = a && a.pwHash === await hashPassword(email, form.password.value);
    if (!ok) { warn.textContent = t('wrongLogin'); warn.hidden = false; return; }
    writeWho(a.id);
  } else writeWho(email);
  ui.admin = true; writeFlag('asl-admin', true);
  return render();
}

// Online: who's signed in, the name History shows for them, and changing their own password. Admins are
// added and removed in the Firebase console (sign-up from the site is turned off).
function myAccountHTML() {
  const email = readWho();
  return `<form class="card settings-card" data-form="my-account">
      <h2>${t('adminAccounts')}</h2>
      <p class="note">${t('adminsCloudHelp')}</p>
      <p>${t('signedInAs')} <b>${esc(email)}</b></p>
      <div class="league-grid">
        <label class="field">${t('yourName')}<input class="input" name="myName" value="${esc((CLOUD.user && CLOUD.user.displayName) || '')}" placeholder="${esc(t('yourNamePlaceholder'))}" autocomplete="off"></label>
        <label class="field">${t('newPasswordOptional')}${pwInput('newPassword', 'new-password')}</label>
      </div>
      <p class="warn" hidden></p>
      <button class="btn btn-gold" type="submit">${t('save')}</button>
    </form>`;
}
async function saveMyAccount(form) {
  const email = readWho(), name = form.myName.value.trim(), pw = form.newPassword.value;
  const warn = form.querySelector('.warn');
  if (pw && pw.length < 6) { warn.textContent = t('passwordShort'); warn.hidden = false; return; }
  if (name !== ((CLOUD.user && CLOUD.user.displayName) || '')) {
    try { await CLOUD.auth.currentUser.updateProfile({ displayName: name || null }); } catch (e) { warn.textContent = t('pwChangeFailed'); warn.hidden = false; return; }
    // Their earlier History lines (under their email) take the name too.
    (state.log || []).forEach(x => { if (x.by && x.by.toLowerCase() === email.toLowerCase()) x.by = name || email.split('@')[0]; });
    save();
  }
  if (pw) {
    try { await CLOUD.auth.currentUser.updatePassword(pw); }
    catch (e) { warn.textContent = t(e.code === 'auth/requires-recent-login' ? 'needsRecentLogin' : 'pwChangeFailed'); warn.hidden = false; return; }
    logAction(`${t('passwordChanged')}: ${whoName()}`);
    save();
  }
  render();
  toast(t('saved'));
}

function adminAccountsHTML() {
  if (cloudOn()) return myAccountHTML();
  const me = readWho();
  return `<form class="card settings-card" data-form="add-admin">
      <h2>${t('adminAccounts')}</h2>
      <p class="note">${t('adminAccountsHelp')}</p>
      ${admins().length ? `<ul class="admin-list">${admins().map(a => `<li>
          <span class="grow"><b>${esc(a.name)}</b> <span class="muted">· ${esc(a.email)}</span>${a.id === me ? ` <span class="tag">${t('you')}</span>` : ''}</span>
          <button type="button" class="btn btn-sm btn-outline" data-action="admin-password" data-id="${a.id}">${t('changePassword')}</button>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-admin" data-id="${a.id}" aria-label="${t('remove')}">×</button>
          ${ui.pwEdit === a.id ? `<div class="pw-edit" data-id="${a.id}">
            <label class="field">${t('newPasswordFor')} ${esc(a.name)}${pwInput('newPassword', 'new-password')}</label>
            <p class="warn" hidden></p>
            <div class="pw-edit-btns"><button type="button" class="btn btn-sm btn-gold" data-action="admin-password-save" data-id="${a.id}">${t('save')}</button>
              <button type="button" class="btn btn-sm btn-outline" data-action="admin-password-cancel">${t('cancel')}</button></div>
          </div>` : ''}
        </li>`).join('')}</ul>` : `<p class="muted">${t('noAdminsYet')}</p>`}
      <div class="league-grid">
        <label class="field">${t('adminName')}<input class="input" name="name" autocomplete="off"></label>
        <label class="field">${t('email')}<input class="input" type="email" name="email" autocomplete="off"></label>
        <label class="field">${t('password')}${pwInput('password', 'new-password')}</label>
      </div>
      <p class="warn" hidden></p>
      <button class="btn btn-gold" type="submit">＋ ${t('addAdmin')}</button>
    </form>`;
}

async function addAdmin(form) {
  // Enter in a Change password box saves that password instead of adding an admin.
  const box = document.activeElement && document.activeElement.closest('.pw-edit');
  if (box) return box.querySelector('[data-action=admin-password-save]').click();
  const name = form.name.value.trim(), email = form.email.value.trim(), password = form.password.value;
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  const missing = [[name, 'adminName'], [/^\S+@\S+\.\S+$/.test(email), 'email'], [password.length >= 6, 'password']].filter(([ok]) => !ok).map(([, k]) => t(k));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}${password && password.length < 6 ? ` (${t('passwordShort')})` : ''}`);
  if (admins().some(a => a.email.toLowerCase() === email.toLowerCase())) return fail(t('adminExists'));
  const first = !admins().length;
  const a = { id: `ad${Date.now().toString(36)}`, name, email, pwHash: await hashPassword(email, password) };
  state.admins = [...admins(), a];
  // The first account becomes whoever is signed in now, so nobody gets locked out.
  if (first) writeWho(a.id);
  logAction(`${t('adminAdded')}: ${name} (${email})`);
  save(); render();
  return toast(`${t('adminAdded')}: ${name}`);
}

function pageLogin() {
  return `
  <div class="wrap page narrow">
    <form class="login-card" data-form="login">
      ${LOGO}
      <h1>${t('signIn')}</h1>
      <label class="field">${t('email')}<input class="input" type="email" name="email" required autocomplete="username"></label>
      ${cloudOn() || admins().length ? `<label class="field">${t('password')}${pwInput('password', 'current-password', true)}</label>` : ''}
      <p class="warn" hidden></p>
      <button class="btn btn-gold btn-block" type="submit">${t('signIn')}</button>
      <p class="note">${t(cloudOn() || admins().length ? 'signInAccounts' : 'signInNote')}</p>
    </form>
  </div>`;
}

// Games that were played and still need a score. A postponed game with no new date yet isn't
// waiting on anyone; once it has the date it was played, it shows up again.
const notRescheduled = m => !played(m) && m.postponed && !m.playedOn;
function awaitingMatches() {
  const today = todayISO();
  return state.matches.filter(m => !played(m) && !m.forfeitBy && !notRescheduled(m) && playedDate(m) <= today).sort((a, b) => byDateTime(b, a));
}

// Awaiting scores grouped by division, oldest game day first; on the same day youth U-5 → U-19,
// then adults, futsal and added leagues.
// Each division gets a heading with its count, then its games under "Game 9 · Sunday, Nov 1" by game day.
function awaitingByDivision(list) {
  const byDivision = ['youth', 'adult', 'futsal'].flatMap(g => DIVISIONS.filter(d => d.group === g && !d.custom))
    .concat(DIVISIONS.filter(d => d.custom));
  // Oldest waiting game first (Wednesday futsal before that Sunday); same day keeps U-5 → U-19, adults…
  const oldest = d => list.filter(m => m.div === d.id).map(m => m.date).sort()[0] || '9999';
  const order = byDivision.map((d, i) => ({ d, i, first: oldest(d) }))
    .sort((a, b) => a.first.localeCompare(b.first) || a.i - b.i).map(x => x.d);
  return order.map(d => {
    const games = list.filter(m => m.div === d.id).sort(byDateTime);
    if (!games.length) return '';
    return `<section class="await-group">
      <h3 class="await-head"><span>${esc(divName(d.id))}</span><span class="muted">${gamesCount(games.length)}</span>
        <a href="#/admin/scores" data-admin-div="${d.id}">${t('enterScores')} →</a></h3>
      ${[...groupBy(games, m => m.date)].map(([date, list]) => `
        <p class="await-day"><b>${playoffDay(d.id, date) || `${t('game')} ${gameNumber(d.id, date)}`}</b> · ${fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        <div class="stack">${list.map(m => `
          <a class="todo" href="#/admin/scores" data-admin-div="${m.div}">
            <span class="todo-teams">${esc(m.home)} ${t('vs')} ${esc(m.away)}</span>
            <span class="muted">${m.playedOn ? `${t('playedOn')} ${fmtDate(m.playedOn)} · ` : ''}${esc(shownTime(m) || m.time)} · ${esc(shownField(m))}</span>
          </a>`).join('')}</div>`).join('')}
    </section>`;
  }).join('');
}

function pageAdminDash() {
  const today = todayISO();
  const awaiting = awaitingMatches();
  const next = state.matches.filter(m => !played(m) && m.date > today).sort(byDateTime)[0];
  const goals = state.matches.filter(played).reduce((n, m) => n + m.hs + m.as, 0);
  const teams = Object.values(state.teams).reduce((n, l) => n + l.length, 0);
  return adminShell('admin', `
    <h1 class="page-title">${t('dashboard')}</h1>
    <div class="stat-grid">
      <div class="stat ${awaiting.length ? 'alert' : ''}"><span>${t('awaiting')}</span><b>${awaiting.length}</b></div>
      <div class="stat"><span>${t('nextMatchday')}</span><b>${next ? fmtDate(next.date) : '—'}</b></div>
      <div class="stat"><span>${t('totalGoals')}</span><b>${goals}</b></div>
      <div class="stat"><span>${t('teamCount')}</span><b>${teams}</b></div>
    </div>
    <div class="section-head"><h2>${t('awaiting')}</h2><a href="#/admin/scores">${t('enterScores')} →</a></div>
    ${awaitingByDivision(awaiting) || empty(t('noAwaiting'))}
    ${dashTournamentsHTML()}
    ${postponedListHTML()}`);
}

// Tournaments that aren't over: each division's stage and its games, a click from Enter scores.
function dashTournamentsHTML() {
  const today = todayISO();
  const list = tournaments().filter(x => x.dates[x.dates.length - 1] >= addDays(today, -7) || tourDivs(x).some(d => !copaChampion(d.id)))
    .filter(x => x.dates[0] <= addDays(today, 30)).sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  if (!list.length) return '';
  return `<div class="section-head"><h2>${t('tournaments')}</h2><a href="#/admin/tournaments">${t('tournaments')} →</a></div>
    <div class="stack">${list.map(x => `<div class="card tour-dash"><b>${esc(x.name)}</b> <span class="muted">· ${esc(tourWhen(x))}</span>
      <div class="tour-dash-divs">${tourDivs(x).map(d => {
        const ms = state.matches.filter(m => m.div === d.id);
        const need = ms.filter(m => !played(m) && m.date <= today).length;
        return `<a class="todo" href="#/admin/scores" data-admin-div="${d.id}"><span class="tag">${esc(d.short || divName(d.id))}</span>
          <span class="todo-teams">${esc(tourStage(d))}</span>
          <span class="muted">${ms.filter(played).length}/${ms.length} ${t('playedShort')}${need ? ` · <b>${need} ${t('needsScore').toLowerCase()}</b>` : ''}</span></a>`;
      }).join('')}</div></div>`).join('')}</div>`;
}

// Postponed games that don't have a new date yet, so they aren't forgotten.
function postponedListHTML() {
  const list = state.matches.filter(notRescheduled).sort(byDateTime);
  if (!list.length) return '';
  return `<div class="section-head postponed-head"><h2>${t('postponedTitle')}</h2><span class="muted">${gamesCount(list.length)}</span>
      <a href="#/admin/scores" data-action="open-postponed" data-league="${list[0].div}">${t('enterPlayedInfo')} →</a></div>
    <p class="note">${t('postponedNote')}</p>
    <div class="stack">${list.map(m => `
      <a class="todo postponed-todo" href="#/admin/scores" data-action="open-postponed" data-league="${m.div}">
        <span class="tag">${esc(divName(m.div))}</span>
        <span class="todo-teams">${esc(m.home)} ${t('vs')} ${esc(m.away)}</span>
        <span class="muted">${t('game')} ${gameNumber(m.div, m.date)} · ${fmtDate(m.date)}</span>
      </a>`).join('')}</div>`;
}

// Penalty boxes on the last game of a playoff matchup when ties go to penalties.
function pensBoxHTML(m) {
  const po = m.playoff && !m.playoff.group && knockoutOf(m.div, cupOfGame(m.playoff));
  if (!po || po.tie !== 'pens') return '';
  const n = bracketNodes(bracket(m.div, cupOfGame(m.playoff))).find(x => x.round === m.playoff.round && x.slot === m.playoff.slot);
  if (!n || m.playoff.leg < n.legs) return '';
  return `<div class="pens-row"><span class="muted">${t('penaltiesIfTied')}</span>
    <input class="input score-in small" name="ph" type="number" min="0" inputmode="numeric" value="${scoreNow(m).pens ? scoreNow(m).pens[0] : ''}" aria-label="${t('penalties')} ${esc(m.home)}">
    <span class="dash">–</span>
    <input class="input score-in small" name="pa" type="number" min="0" inputmode="numeric" value="${scoreNow(m).pens ? scoreNow(m).pens[1] : ''}" aria-label="${t('penalties')} ${esc(m.away)}"></div>`;
}

// Scores have two steps. Save keeps the typed score on the game (m.draft) without showing it on the site;
// Publish puts it on the site (m.hs / m.as). The boxes show the saved score if there is one.
const scoreNow = m => (m.draft ? m.draft : played(m) ? { hs: m.hs, as: m.as, ...(m.pens ? { pens: m.pens } : {}) } : { hs: null, as: null });
const sameScore = (x, y) => x.hs === y.hs && x.as === y.as && JSON.stringify(x.pens || null) === JSON.stringify(y.pens || null);
// What the boxes say, or null while only one side is typed.
function readScoreForm(form) {
  const val = el => (el && el.value !== '' ? +el.value : null);
  const hs = val(form.hs), as = val(form.as);
  if ((hs === null) !== (as === null)) return null;
  const out = { hs, as };
  if (form.ph && hs !== null) {
    const ph = val(form.ph), pa = val(form.pa);
    if (ph !== null && pa !== null && ph !== pa) out.pens = [ph, pa];
  }
  return out;
}
const scoreText = (m, v) => `${divName(m.div)}: ${m.home} ${v.hs ?? '–'}–${v.as ?? '–'} ${m.away}`;
// Save without publishing. Returns the game, or null if nothing was saved.
function draftScoreForm(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id), v = readScoreForm(form);
  if (!m || !v) return null;
  const pub = played(m) ? { hs: m.hs, as: m.as, ...(m.pens ? { pens: m.pens } : {}) } : { hs: null, as: null };
  if (sameScore(v, pub) || (v.hs === null && !played(m))) {
    if (!m.draft) return null;
    delete m.draft; // back to what the site shows
  } else if (m.draft && sameScore(v, m.draft)) return null;
  else m.draft = v;
  logAction(`${t('logScoreDraft')} · ${scoreText(m, v)}`);
  return m;
}
// Publish: the boxes' score goes on the site. Returns the game, or null if nothing changed.
function applyScoreForm(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id), v = readScoreForm(form);
  if (!m || !v) return null;
  const pub = played(m) ? { hs: m.hs, as: m.as, ...(m.pens ? { pens: m.pens } : {}) } : { hs: null, as: null };
  if (sameScore(v, pub) && !m.draft) return null;
  m.hs = v.hs; m.as = v.as;
  if (v.pens) m.pens = v.pens; else delete m.pens;
  delete m.draft;
  logAction(`${t('logScorePublished')} · ${scoreText(m, v)}`);
  return m;
}
// Unpublish: the score comes off the site but stays saved (Not published), so it can go back up later.
// A score typed in the boxes is the one kept.
function unpublishScoreForm(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id);
  if (!m || !played(m)) return null;
  const typed = readScoreForm(form);
  const keep = typed && typed.hs !== null && scoreFormChanged(form) ? typed : m.draft || { hs: m.hs, as: m.as, ...(m.pens ? { pens: m.pens } : {}) };
  logAction(`${t('logScoreUnpublished')} · ${scoreText(m, { hs: m.hs, as: m.as })}`);
  m.draft = keep;
  m.hs = null; m.as = null; delete m.pens;
  return m;
}
// Published, nothing typed or saved since: the game's button says Unpublish instead of Publish.
const isPublishedClean = (m, form) => played(m) && !m.draft && !scoreFormChanged(form);
// A score row whose boxes differ from what's saved.
function scoreFormChanged(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id);
  if (!m || !form.hs) return false;
  const v = readScoreForm(form);
  return !v || !sameScore(v, scoreNow(m));
}
// The bar under the games: tick games (typing a score ticks its game), then Save or Publish them together.
const saveAllBarHTML = () => `<div class="save-all-bar" hidden>
  <label class="sab-all"><input type="checkbox" data-change="score-pick-all"><span>${t('selectAll')}</span></label>
  <span class="sab-count"></span>
  <span class="sab-btns"><button type="button" class="btn btn-outline" data-action="scores-bulk" data-mode="draft" disabled>${t('save')}</button>
  <button type="button" class="btn btn-gold" data-action="scores-bulk" data-mode="publish" disabled>${t('publish')}</button>
  <button type="button" class="btn btn-outline sab-unpub" data-action="scores-bulk" data-mode="unpublish" disabled>${t('unpublish')}</button></span></div>`;
const scorePicks = () => (ui.scorePicks = ui.scorePicks || new Set());
function refreshSaveAll() {
  const bar = document.querySelector('.save-all-bar');
  const forms = [...document.querySelectorAll('form.score-row')];
  forms.forEach(f => {
    f.classList.toggle('unsaved', scoreFormChanged(f));
    const box = f.querySelector('[data-change=score-pick]');
    if (box) box.checked = scorePicks().has(+f.dataset.id);
    const m = state.matches.find(x => x.id === +f.dataset.id), clean = !!m && isPublishedClean(m, f);
    const pub = f.querySelector('[data-action=score-publish]'), un = f.querySelector('[data-action=score-unpublish]');
    if (pub && un) { pub.hidden = clean; un.hidden = !clean; }
  });
  if (!bar) return;
  const picked = forms.filter(f => scorePicks().has(+f.dataset.id));
  bar.hidden = !forms.length;
  bar.querySelector('[data-change=score-pick-all]').checked = forms.length > 0 && picked.length === forms.length;
  bar.querySelectorAll('[data-action=scores-bulk]').forEach(b => { b.disabled = !picked.length; });
  const pickedLive = picked.some(f => played(state.matches.find(x => x.id === +f.dataset.id) || {}));
  bar.querySelector('[data-mode=unpublish]').disabled = !pickedLive;
  const unsaved = picked.filter(scoreFormChanged).length;
  bar.querySelector('.sab-count').textContent = picked.length
    ? `${t('pickedMany').replace('{n}', picked.length)}${unsaved ? ` · ${t(unsaved === 1 ? 'unsavedOne' : 'unsavedMany').replace('{n}', unsaved)}` : ''}`
    : t('pickNone');
}

// One game on Enter scores / Team games: score boxes, Edit, Notes, Delete and Postponed.
function scoreRowHTML(m) {
  if (m.forfeitBy) {
    const winner = m.forfeitBy === m.home ? m.away : m.home;
    return `<div class="forfeit-line"><span class="tag forfeit">${t(doubleForfeit(m) ? 'doubleForfeit' : 'forfeit')}</span>
      <span>${doubleForfeit(m) ? `<b>${esc(m.home)}</b> ${t('and')} <b>${esc(m.away)}</b> ${t('bothLose30Lower')}<small class="muted">` : `<b>${esc(winner)}</b> ${t('wins30')} <small class="muted">— ${esc(m.forfeitBy)} ${t('forfeitedWord')}`}${m.date > todayISO() ? ` (${t('countsOn')} ${fmtDate(m.date)})` : ''}</small></span>
      <button type="button" class="btn btn-sm btn-outline" data-action="ask" data-confirm="rm-forfeit-game" data-ask="${m.forfeitFrom ? 'askBackToGame' : 'askRmForfeit'}" data-yes="${m.forfeitFrom ? 'yesBack' : 'yesRemove'}" data-id="${m.id}">${t(m.forfeitFrom ? 'backToGame' : 'remove')}</button></div>`;
  }
  return `
      <form class="score-row ${played(m) ? '' : 'open'}" data-form="score" data-id="${m.id}" data-league="${m.div}">
        <div class="row-meta"><label class="pick-score" title="${t('selectGame')}"><input type="checkbox" data-change="score-pick" aria-label="${t('selectGame')}"></label>${m.draft ? `<span class="tag draft-tag">${t('notPublished')}${played(m) ? ` · ${t('onSite')} ${m.hs}–${m.as}` : ''}</span>` : ''}${m.fromFriendly ? `<span class="tag filler-tag">${esc(friendlyCountTag(m))}</span>` : m.countOnly ? `<span class="tag filler-tag">${esc(countOnlyTag(m))}</span>` : m.fillerTeam ? `<span class="tag filler-tag">${t('fillerTag')}: ${esc(m.fillerTeam)} · ${t('insteadOf')} ${esc((m.filler || {}).gone || '')}</span>` : ''}${m.playoff ? `<span class="tag playoff-tag">${esc(roundLabel(m.div, m.playoff))}</span>` : ''}${resultOf(m)?.forfeit ? `<span class="tag forfeit">${t('countsAsForfeit')}</span>` : ''}${postponedTag(m)} ${m.playedOn
          ? `${t('playedOn')} ${fmtDate(m.playedOn)}${m.playedTime ? ` · ${esc(m.playedTime)}` : ''} <span class="muted">(${t('gameDayOf')} ${fmtDate(m.date)} · ${esc(m.time)})</span>`
          : `${fmtDate(m.date)} · ${esc(m.time)}`} · ${esc(shownField(m))}</div>
        <div class="row-main">
          <span class="t-home"><span class="t-in"><span>${esc(m.home)}</span>${publicLogo(m.home, false, m.div)}</span></span>
          <input class="input score-in" name="hs" type="number" min="0" inputmode="numeric" value="${scoreNow(m).hs ?? ''}" aria-label="${esc(m.home)}">
          <span class="dash">–</span>
          <input class="input score-in" name="as" type="number" min="0" inputmode="numeric" value="${scoreNow(m).as ?? ''}" aria-label="${esc(m.away)}">
          <span class="t-away"><span class="t-in">${publicLogo(m.away, false, m.div)}<span>${esc(m.away)}</span></span></span>
        </div>
        <div class="row-actions">
          <button type="submit" class="btn btn-sm btn-outline">${t('save')}</button>
          <button type="button" class="btn btn-sm btn-gold" data-action="score-publish" ${played(m) && !m.draft ? 'hidden' : ''}>${t('publish')}</button>
          <button type="button" class="btn btn-sm btn-outline danger-outline" data-action="score-unpublish" ${played(m) && !m.draft ? '' : 'hidden'}>${t('unpublish')}</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="edit-game" data-id="${m.id}" aria-expanded="${ui.editGame === m.id}">${t('editGame')}</button>
          <button type="button" class="btn btn-sm btn-outline ${m.refReport || m.adminNotes ? 'has-notes' : ''}" data-action="toggle-notes" data-id="${m.id}" aria-expanded="${ui.notesOpen === m.id}">${t('notes')}${m.refReport || m.adminNotes ? ' •' : ''}</button>
          ${m.fillerTeam && !m.fromFriendly && !m.countOnly ? `<button type="button" class="btn btn-sm btn-outline" data-action="ask" data-confirm="filler-undo" data-ask="askBackToForfeit" data-yes="yesBack" data-id="${m.id}">${t('backToForfeit')}</button>` : ''}
          ${!played(m) && (!m.fillerTeam || m.countOnly) && !m.playoff && !m.fromFriendly ? `<button type="button" class="btn btn-sm btn-outline" data-action="forfeit-open" data-id="${m.id}" aria-expanded="${ui.forfeitGame === m.id}">${t('forfeitGameBtn')}</button>` : ''}
          <button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="rm-match" data-id="${m.id}">${t('deleteMatch')}</button>
        </div>
        ${pensBoxHTML(m)}
        ${ui.forfeitGame === m.id ? `<div class="pens-row"><span class="muted">${t('whoForfeited')}</span>${[m.home, m.away].map(x => `<button type="button" class="btn btn-sm btn-outline danger-outline" data-action="forfeit-game" data-id="${m.id}" data-team="${esc(x)}">${esc(x)}</button>`).join('')}
          <button type="button" class="btn btn-sm btn-outline danger-outline" data-action="forfeit-game" data-id="${m.id}" data-team="${BOTH}" title="${t('bothLose30')}">${t('bothTeams')}</button></div>` : ''}
        ${ui.editGame === m.id ? editGameHTML(m) : ''}
        ${ui.notesOpen === m.id ? notesHTML(m) : ''}
        <div class="postpone-row">
          <label class="check-pill"><input type="checkbox" name="postponed" data-change="postponed" ${m.postponed ? 'checked' : ''}><span>${t('postponed')}</span></label>
          ${m.refReport || m.adminNotes ? `<button type="button" class="has-notes-badge" data-action="toggle-notes" data-id="${m.id}" aria-expanded="${ui.notesOpen === m.id}">${t('hasNotes')}${m.refReport ? ` · ${t('refReport')}` : ''}${m.adminNotes ? ` · ${t('ourNotes')}` : ''}</button>` : ''}
        </div>
      </form>`;
}

// The team picked on Team games and Matchups (kept when switching between the two).
function adminTeam() {
  const teams = [...(state.teams[ui.adminDiv] || [])].sort((a, b) => a.localeCompare(b));
  if (!teams.includes(ui.adminTeam)) ui.adminTeam = teams[0] || '';
  return { teams, team: ui.adminTeam };
}
// A big header for the team picked in the list above it: logo, name, division and where it stands.
function teamBanner(team, div) {
  const rows = standings(div), i = rows.findIndex(r => r.team === team), r = rows[i];
  const ord = n => (LANG === 'es' ? `${n}.º` : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`);
  return `<div class="team-banner">
    ${teamLogo(team, div) ? `<img class="team-banner-logo" src="${teamLogo(team, div)}" alt="">` : ''}
    <div><h2>${esc(team)}</h2>
      <p class="muted">${esc(divName(div))}${r ? ` · ${ord(i + 1)} ${t('inStandings')} · ${r.w}${t('wonShort')} ${r.d}${t('drawnShort')} ${r.l}${t('lostShort')} · ${r.pts} ${t('pts')}` : ''}</p></div>
  </div>`;
}
function adminTeamPicker(teams, team) {
  return `<select class="select" data-change="admin-team" aria-label="${t('team')}">
    ${teams.map(n => `<option ${n === team ? 'selected' : ''}>${esc(n)}</option>`).join('')}
  </select>`;
}

// Who a team still has to play, in the order the game rotation has them (with the game number), then any
// the rotation doesn't reach before the season ends. Without rotation numbers it's just the list.
function rotationPlan(div, team, wanted) {
  const rot = rotationOf(div), me = rotationNumber(div, team);
  const out = [];
  if (me && hasRotation(div)) {
    // Game weeks this team already has a game booked or played (maybe not the rotation's opponent).
    const busy = new Set(teamGames(div, team).filter(m => !m.left).map(m => gameNumber(div, m.date)));
    for (let g = Math.max(1, nextGameNumber(div)); g <= gameColumns(div); g++) {
      if (busy.has(g)) continue;
      const pair = gameRound(div, g) ? rotationRound(rot.size, gameRound(div, g)).find(x => x.includes(me)) : null;
      const o = pair && (pair[0] === me ? pair[1] : pair[0]);
      const name = o && o <= rot.size ? rot.numbers[o] : '';
      if (name && wanted.includes(name) && !out.some(x => x.team === name)) out.push({ team: name, game: g });
    }
  }
  return [...out, ...wanted.filter(n => !out.some(x => x.team === n)).map(n => ({ team: n }))];
}

// One team: who it has played (with results), who it's booked to play, and who it still has to play.
// "Expand to edit" on the first two boxes shows those games with the same score entry as Enter scores.
function pageAdminTeamGames() {
  const { teams, team } = adminTeam();
  const div = ui.adminDiv;
  const games = team ? teamGames(div, team) : [];
  const opp = m => (m.home === team ? m.away : m.home);
  const gone = new Set(withdrawnIn(div).map(w => w.team));
  const played = games.filter(m => resultOf(m));
  const booked = games.filter(m => !resultOf(m) && !m.left);
  const met = new Set([...played, ...booked].map(opp));
  const toPlay = teams.filter(n => n !== team && !met.has(n));
  const plan = rotationPlan(div, team, toPlay);
  const result = m => {
    const r = resultOf(m);
    const mine = r.double ? 0 : m.home === team ? r.hs : r.as, theirs = r.double ? 3 : m.home === team ? r.as : r.hs;
    const k = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    return `<span class="form"><i class="f-${k}">${k === 'W' ? t('won') : k === 'D' ? t('drawn') : t('lost')}</i></span> <b>${mine}–${theirs}</b>${r.forfeit ? ` <span class="tag forfeit">${t('forfeit')}</span>` : ''}`;
  };
  const line = (m, right) => `<div class="matchup">
      <span class="team-with-logo">${publicLogo(opp(m), true, div)}<b>${esc(opp(m))}</b>${gone.has(opp(m)) ? ` <span class="tag">${t('withdrewTag')}</span>` : ''}</span>
      <span class="muted">${t('game')} ${gameNumber(div, m.date)} · ${fmtDate(m.date)}</span>
      <span class="matchup-right">${right}</span>
    </div>`;
  const open = ui.teamOpen || {};
  const box = (key, title, list, right, none) => `<section class="card ${open[key] && list.length ? 'wide' : ''}">
        <div class="box-head"><h2>${t(title)} <span class="count">${list.length}</span></h2>
          ${list.length ? `<button type="button" class="btn btn-sm btn-outline" data-action="team-expand" data-box="${key}" aria-expanded="${!!open[key]}">${t(open[key] ? 'collapse' : 'expandToEdit')}</button>` : ''}</div>
        ${!list.length ? `<p class="muted">${t(none)}</p>` : open[key]
          ? `<div class="stack">${list.map(m => `<p class="await-day"><b>${t('game')} ${gameNumber(m.div, m.date)}</b> · ${fmtDate(m.date, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
              ${m.left ? forfeitLine(m) : scoreRowHTML(m)}`).join('')}</div>`
          : list.map(m => line(m, right(m))).join('')}
      </section>`;
  return adminShell('admin/teamgames', `
    <h1 class="page-title">${t('teamGames')}</h1>
    <div class="toolbar">${divPills(div, 'data-admin-div')}${adminTeamPicker(teams, team)}</div>
    ${team ? teamBanner(team, div) : ''}
    <p class="note">${t('matchupsHelp')}</p>
    <div class="matchup-grid">
      ${box('played', 'alreadyPlayed', played, result, 'noneYet')}
      ${box('booked', 'bookedNext', booked, played_tag, 'noneBooked')}
      <section class="card">
        <h2>${t('stillToPlay')} <span class="count">${toPlay.length}</span></h2>
        ${plan.some(x => x.game) ? `<p class="note">${t('inRotationOrder')}</p>` : ''}
        ${plan.map(x => `<div class="matchup"><span class="team-with-logo">${publicLogo(x.team, true, div)}<b>${esc(x.team)}</b></span>
          <span class="muted">${x.game ? `${t('game')} ${x.game}` : hasRotation(div) && rotationNumber(div, team) ? t('notInRotationLeft') : ''}</span></div>`).join('') || `<p class="muted">${t('playedEveryone')}</p>`}
      </section>
    </div>`);
}
// A booked game that hasn't got a result: waiting for a score, postponed, or still coming up.
const played_tag = m => (notRescheduled(m) ? `<span class="tag postponed">${t('postponed')}</span>`
  : playedDate(m) <= todayISO() ? `<span class="tag">${t('needsScore')}</span>` : `<span class="muted">${esc(m.time)} · ${esc(shownField(m))}</span>`);

// ---------- friendlies in Enter scores ----------
// Friendlies are booked on the Schedule planner (a slot whose division is "Friendly"). They never show on the
// public site and never count, unless a team is checked under "Counts for": then the game becomes a real one
// for that team only (the other side plays as a guest, like a replacement game: nothing changes for them), or
// for both. The friendly keeps its slot on the planner; the counted game is kept apart (fromFriendly).
function friendliesOf(div) {
  const out = [];
  Object.entries(state.matchDays || {}).forEach(([date, day]) => Object.entries(day).forEach(([sec, fields]) => {
    if (!fields || typeof fields !== 'object') return;
    Object.entries(fields).forEach(([field, rows]) => (Array.isArray(rows) ? rows : []).forEach(r => {
      if (!isFriendly(date, r) || !r.home || !r.away || r.home === FRIENDLY_OUT || r.away === FRIENDLY_OUT) return;
      if ((r.fdiv || '') !== div && !(div === ui.adminDiv && !r.fdiv && !DIVISIONS.some(d => d.id === r.fdiv))) return;
      out.push({ date, sec, field, r });
    }));
  }));
  // Friendlies with no division picked show under every division, so they can still be found.
  return out.filter(f => f.r.fdiv === div || !f.r.fdiv).sort((a, b) => b.date.localeCompare(a.date) || a.r.t - b.r.t);
}
const findFriendly = el => {
  const box = el.closest('[data-frow]');
  const rows = (((state.matchDays || {})[box.dataset.date] || {})[box.dataset.sec] || {})[box.dataset.field] || [];
  return { box, date: box.dataset.date, field: box.dataset.field, r: rows.find(x => x.id === box.dataset.frow) };
};
function friendlyCountTag(m) {
  const c = m.fromFriendly.countFor || [];
  return c.length === 2 ? t('friendlyCountsBoth') : t('friendlyCountsFor').replace('{x}', c[0] === 'home' ? m.home : m.away);
}
// Make (or update, or remove) the real game behind a friendly that counts for one or both teams.
function syncFriendlyCount(date, field, r, div) {
  const want = (r.countFor || []).filter(side => (state.teams[div] || []).includes(r[side]));
  let m = r.countMid && state.matches.find(x => x.id === r.countMid);
  if (!want.length || r.home === r.away) {
    if (m) state.matches = state.matches.filter(x => x.id !== m.id);
    r.countMid = null;
    return;
  }
  const guest = want.length === 1 ? r[want[0] === 'home' ? 'away' : 'home'] : '';
  const fields = { div, date, time: fromMin(r.t), field, home: r.home, away: r.away,
    hs: Number.isInteger(r.fhs) ? r.fhs : null, as: Number.isInteger(r.fas) ? r.fas : null,
    fromFriendly: { row: r.id, countFor: want } };
  if (!m) { m = { id: state.nextId++, goals: [] }; state.matches.push(m); r.countMid = m.id; }
  Object.assign(m, fields);
  if (guest) m.fillerTeam = guest; else delete m.fillerTeam;
  touch(div);
}
function friendliesEditorHTML() {
  const div = ui.adminDiv;
  const list = friendliesOf(div);
  const teams = state.teams[div] || [];
  return `<p class="note">${t('friendliesHelp')}</p>
    ${list.length ? [...groupBy(list, f => f.date)].map(([date, group]) => {
      // "Game 3 · Sunday, Nov 8" when the division plays that day, otherwise just the date.
      const leagueDay = state.matches.some(m => m.div === div && m.date === date && !m.playoff && !m.fromFriendly);
      return `<section class="await-group friendly-group">
      <h3 class="await-head"><span>${leagueDay ? `${t('game')} ${gameNumber(div, date)} · ` : ''}${esc(fmtDate(date, { weekday: 'long', month: 'short', day: 'numeric' }))}</span>
        <span class="muted">${group.length} ${t(group.length === 1 ? 'friendlyOne' : 'friendlyMany')}</span></h3>
      <div class="stack">${group.map(({ date, sec, field, r }) => {
      const m = r.countMid && state.matches.find(x => x.id === r.countMid);
      const hs = m ? m.hs : r.fhs, as = m ? m.as : r.fas;
      const side = (s, name) => {
        const inDiv = teams.includes(name);
        return `<label class="check-pill ${inDiv ? '' : 'not-in-div'}" ${inDiv ? '' : `title="${esc(t('friendlyNotInDiv').replace('{div}', divName(div)))}"`}>
          <input type="checkbox" data-change="friendly-count" data-side="${s}" ${inDiv ? '' : 'data-needs-team="1"'} ${(r.countFor || []).includes(s) && inDiv ? 'checked' : ''}><span>${esc(name)}${inDiv ? '' : ` <small>＋ ${esc(divName(div))}</small>`}</span></label>`;
      };
      return `<div class="card friendly-card" data-frow="${esc(r.id)}" data-date="${date}" data-sec="${sec}" data-field="${esc(field)}">
        <div class="row-meta"><span class="tag">${t('friendly')}</span>${m ? `<span class="tag filler-tag">${esc(friendlyCountTag(m))}</span>` : ''}
          <span class="muted">${esc(fromMin(r.t))} · ${esc(FIELDS[field] || field)}${r.fdiv ? '' : ` · ${t('friendlyNoDiv')}`}</span></div>
        <div class="friendly-score">
          <span class="fs-team">${esc(r.home)}</span>
          <input class="input num" type="number" min="0" inputmode="numeric" data-change="friendly-score" data-side="fhs" value="${Number.isInteger(hs) ? hs : ''}" aria-label="${esc(r.home)}">
          <span class="fs-team">${esc(r.away)}</span>
          <input class="input num" type="number" min="0" inputmode="numeric" data-change="friendly-score" data-side="fas" value="${Number.isInteger(as) ? as : ''}" aria-label="${esc(r.away)}">
        </div>
        <div class="friendly-count"><span class="muted">${t('friendlyCountsLabel')}</span>${side('home', r.home)}${side('away', r.away)}</div>
      </div>`;
    }).join('')}</div></section>`;
    }).join('') : empty(t('noFriendlies'))}`;
}

function pageAdminScores() {
  const today = todayISO();
  const { day, html: picker, label: dayLabel } = gameDayPicker(ui.adminDiv, 'adminScoreDay');
  // One team's games (like the public Scores page): pick it and every game day shows.
  const divTeams = [...(state.teams[ui.adminDiv] || [])].sort((a, b) => a.localeCompare(b));
  if (!divTeams.includes(ui.adminScoreTeam)) ui.adminScoreTeam = '';
  const team = ui.adminScoreTeam;
  const ofTeam = m => !team || m.home === team || m.away === team;
  const teamSel = `<select class="select" data-change="admin-score-team" aria-label="${t('team')}"><option value="">${t('allTeams')}</option>${divTeams.map(n => `<option ${n === team ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const postponedCount = state.matches.filter(m => m.div === ui.adminDiv && m.postponed && !played(m)).length;
  const postponedTab = `<button class="${ui.adminFilter === 'postponed' ? 'active' : ''}" data-filter="postponed">${t('postponed')}${postponedCount ? `<span class="count">${postponedCount}</span>` : ''}</button>`
    + `<button class="${ui.adminFilter === 'friendlies' ? 'active' : ''}" data-filter="friendlies">${t('friendliesTab')}</button>`;
  const draftCount = state.matches.filter(m => m.div === ui.adminDiv && m.draft).length;
  const pubTab = `<button class="${ui.adminFilter === 'published' ? 'active' : ''}" data-filter="published">${t('publishedTab')}</button>`;
  const draftTab = `<button class="${ui.adminFilter === 'drafts' ? 'active' : ''}" data-filter="drafts">${t('draftsTab')}${draftCount ? `<span class="count">${draftCount}</span>` : ''}</button>`;
  if (ui.adminFilter === 'friendlies') {
    return adminShell('admin/scores', `
    <h1 class="page-title">${t('enterScores')}</h1>
    <div class="toolbar">
      ${divPills(ui.adminDiv, 'data-admin-div', { tours: true })}
      <div class="seg">
        <button data-filter="needs">${t('needsScore')}</button>
        <button data-filter="scored">${t('hasScore')}</button>
        <button data-filter="all">${t('all')}</button>
        ${pubTab}${draftTab}${postponedTab}
      </div>
    </div>
    ${friendliesEditorHTML()}`);
  }
  if (ui.adminFilter === 'postponed') {
    return adminShell('admin/scores', `
    <h1 class="page-title">${t('enterScores')}</h1>
    <div class="toolbar">
      ${divPills(ui.adminDiv, 'data-admin-div', { tours: true })}
      <div class="seg">
        <button data-filter="needs">${t('needsScore')}</button>
        <button data-filter="scored">${t('hasScore')}</button>
        <button data-filter="all">${t('all')}</button>
        ${pubTab}${draftTab}${postponedTab}
      </div>
    </div>
    ${postponedEditorHTML()}`);
  }
  if (isTour(DIVISIONS.find(d => d.id === ui.adminDiv))) {
    const pick = ui.adminFilter === 'needs' ? m => !played(m) && !m.forfeitBy && m.date <= today : ui.adminFilter === 'scored' ? m => played(m) || m.forfeitBy : () => true;
    return adminShell('admin/scores', `
    <h1 class="page-title">${t('enterScores')}</h1>
    <div class="toolbar">
      ${divPills(ui.adminDiv, 'data-admin-div', { tours: true })}
      <div class="seg">
        <button class="${ui.adminFilter === 'needs' ? 'active' : ''}" data-filter="needs">${t('needsScore')}</button>
        <button class="${ui.adminFilter === 'scored' ? 'active' : ''}" data-filter="scored">${t('hasScore')}</button>
        <button class="${ui.adminFilter === 'all' || ui.adminFilter === 'postponed' ? 'active' : ''}" data-filter="all">${t('all')}</button>
      </div>
    </div>
    ${tourGamesHTML(ui.adminDiv, pick, false)}
    ${saveAllBarHTML()}`);
  }
  let list = state.matches.filter(m => m.div === ui.adminDiv && (day === 'all' || m.date === day) && ofTeam(m));
  // A postponed game with no new date waits in the Postponed tab instead.
  if (ui.adminFilter === 'needs') list = list.filter(m => !played(m) && !m.forfeitBy && !notRescheduled(m) && m.date <= today);
  if (ui.adminFilter === 'scored') list = list.filter(m => played(m) || m.forfeitBy);
  if (ui.adminFilter === 'drafts') list = list.filter(m => m.draft);
  if (ui.adminFilter === 'published') list = list.filter(m => played(m) && !m.forfeitBy);
  list.sort((a, b) => byDateTime(b, a));
  // Games a withdrawn team had left: nothing to type, so not under "Needs score".
  const noStubs = ['needs', 'drafts', 'published'].includes(ui.adminFilter);
  const forfeitsShown = noStubs ? ''
    : forfeitStubs(ui.adminDiv).filter(m => (day === 'all' || m.date === day) && ofTeam(m)).sort((a, b) => byDateTime(b, a)).map(m => forfeitLine(m)).join('');
  // All game days at once: each day under its own "Game 3 · Sunday, November 1, 2026" heading.
  const byDay = () => [...groupBy([...list, ...(noStubs ? [] : forfeitStubs(ui.adminDiv).filter(ofTeam))].sort((a, b) => byDateTime(b, a)), m => m.date)]
    .map(([d, ms]) => `<h3 class="day-title">${esc(dayLabel(d).replace(` ${t('of')} ${gameColumns(ui.adminDiv)}`, ''))}</h3>${ms.map(m => (m.left ? forfeitLine(m) : scoreRowHTML(m))).join('')}`).join('');
  return adminShell('admin/scores', `
    <h1 class="page-title">${t('enterScores')}</h1>
    <div class="toolbar">
      ${divPills(ui.adminDiv, 'data-admin-div', { tours: true })}${teamSel}
      <div class="seg">
        <button class="${ui.adminFilter === 'needs' ? 'active' : ''}" data-filter="needs">${t('needsScore')}</button>
        <button class="${ui.adminFilter === 'scored' ? 'active' : ''}" data-filter="scored">${t('hasScore')}</button>
        <button class="${ui.adminFilter === 'all' ? 'active' : ''}" data-filter="all">${t('all')}</button>
        ${pubTab}${draftTab}${postponedTab}
      </div>
    </div>
    <p class="note">${t('scoresSaveHelp')}</p>
    ${picker}
    ${team ? teamBanner(team, ui.adminDiv) : ''}
    <div class="stack">${day === 'all' && (list.length || forfeitsShown) ? byDay() : `${list.map(m => scoreRowHTML(m)).join('') || (forfeitsShown ? '' : empty(t(ui.adminFilter === 'published' ? 'noPublished' : ui.adminFilter === 'drafts' ? 'noDrafts' : ui.adminFilter === 'scored' ? 'noScoredYet' : ui.adminFilter === 'needs' ? 'noAwaiting' : 'noMatches')))}
      ${forfeitsShown}`}
    </div>
    ${saveAllBarHTML()}
    ${day !== 'all' ? addGameHTML(day) : ''}`);
}

// Postponed tab: the chosen division's postponed games without a score, oldest first. Each one takes
// the date, time and field it was played at and the score, in one place.
function postponedEditorHTML() {
  const list = state.matches.filter(m => m.div === ui.adminDiv && m.postponed && !played(m)).sort(byDateTime);
  if (!list.length) return empty(t('noPostponed'));
  return `<p class="note">${t('postponedTabHelp')}</p>
    <div class="stack">${list.map(m => {
      const time = m.playedTime ? toMin(m.playedTime) : null;
      const h = time === null ? '' : (Math.floor(time / 60) % 12) || 12;
      const min = time === null ? '' : String(time % 60).padStart(2, '0');
      const pm = time === null ? null : time >= 12 * 60;
      const usual = divisionFields(m.div);
      const field = m.playedField || m.field;
      const fields = usual.includes(field) || !FIELDS[field] ? usual : [...usual, field];
      const last = lastPlayDay(m.div);
      return `<form class="card postponed-card" data-form="postponed-game" data-id="${m.id}" data-league="${m.div}">
        <div class="row-meta"><span class="tag">${esc(divName(m.div))}</span> <b>${t('game')} ${gameNumber(m.div, m.date)}</b>
          · ${t('originally')} ${fmtDate(m.date)} · ${esc(m.time)} · ${esc(FIELDS[m.field] || m.field)}</div>
        <div class="row-main">
          <span class="t-home">${esc(m.home)}</span>
          <input class="input score-in" name="hs" type="number" min="0" inputmode="numeric" aria-label="${esc(m.home)}">
          <span class="dash">–</span>
          <input class="input score-in" name="as" type="number" min="0" inputmode="numeric" aria-label="${esc(m.away)}">
          <span class="t-away">${esc(m.away)}</span>
        </div>
        <div class="league-grid">
          <div class="field">${t('playedOnLabel')}
            <input class="input" type="date" name="playedOn" value="${m.playedOn || ''}" min="${addDays(m.date, 1)}">
            ${last > m.date ? `<button type="button" class="link-btn" data-action="use-last-day" data-day="${last}">${t('useDay')} ${fmtDate(last, { weekday: 'short', month: 'short', day: 'numeric' })}</button>` : ''}
          </div>
          <div class="field">${t('time')}
            <span class="league-time">
              <input class="input" name="hour" type="number" min="1" max="12" inputmode="numeric" value="${h}" aria-label="${t('time')}">:<input class="input" name="minute" type="number" min="0" max="59" inputmode="numeric" value="${min}" aria-label="min">
              <label class="check-pill"><input type="radio" name="ampm" value="AM" ${pm === false ? 'checked' : ''}><span>AM</span></label>
              <label class="check-pill"><input type="radio" name="ampm" value="PM" ${pm ? 'checked' : ''}><span>PM</span></label>
            </span>
          </div>
          <label class="field">${t('field')}<select class="select" name="field" data-change="add-game-field">${fields.map(f =>
            `<option value="${f}" ${f === field ? 'selected' : ''}>${esc(FIELDS[f])}</option>`).join('')}${
            fields.length < openFields().length ? `<option value="__other">${t('otherField')}</option>` : ''}</select></label>
        </div>
        <p class="warn" hidden></p>
        <div class="row-actions">
          <button type="submit" class="btn btn-sm btn-gold">${t('save')}</button>
          <button type="button" class="btn btn-sm btn-outline" data-action="unpostpone" data-id="${m.id}">${t('notPostponed')}</button>
        </div>
      </form>`;
    }).join('')}</div>`;
}

function savePostponed(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id);
  const f = new FormData(form);
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  const date = f.get('playedOn');
  const hour = parseInt(f.get('hour'), 10), minute = f.get('minute') === '' ? 0 : parseInt(f.get('minute'), 10);
  const hasTime = f.get('hour') !== '';
  const hs = f.get('hs') === '' ? null : +f.get('hs'), as = f.get('as') === '' ? null : +f.get('as');
  const missing = [];
  if (!date) missing.push(t('playedOnLabel'));
  if (hasTime && !(hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59 && f.get('ampm'))) missing.push(t('time'));
  if ((hs === null) !== (as === null)) missing.push(t('score'));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}`);
  m.playedOn = date;
  m.playedTime = hasTime ? fromMin((hour % 12 + (f.get('ampm') === 'PM' ? 12 : 0)) * 60 + minute) : null;
  m.playedField = f.get('field') && f.get('field') !== m.field ? f.get('field') : null;
  if (hs !== null) { m.hs = hs; m.as = as; touch(m.div); }
  logAction(`${t('logPlayedLater')} · ${divName(m.div)}: ${m.home} ${hs ?? '–'}–${as ?? '–'} ${m.away} · ${fmtDate(date)}`);
  save(); render();
  return toast(hs !== null ? `${t('saved')}: ${m.home} ${hs}–${as} ${m.away}` : `${t('playedOn')} ${fmtDate(date)}: ${m.home} ${t('vs')} ${m.away}`);
}

// "Notes" on a game in Enter scores (admin only, never shown on the public site): what the referee
// reported, and the league's own notes, kept in separate boxes.
function notesHTML(m) {
  return `<div class="game-notes">
      <label class="field">${t('refReport')}<textarea class="input" name="refReport" rows="3" placeholder="${t('refReportHint')}">${esc(m.refReport || '')}</textarea></label>
      <label class="field">${t('ourNotes')}<textarea class="input" name="adminNotes" rows="3" placeholder="${t('ourNotesHint')}">${esc(m.adminNotes || '')}</textarea></label>
      <div class="edit-actions">
        <span class="muted small">${m.notesAt ? `${t('lastSaved')} ${new Date(m.notesAt).toLocaleString(LANG === 'es' ? 'es-MX' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
        <button type="button" class="btn btn-sm btn-outline" data-action="toggle-notes" data-id="${m.id}">${t('close')}</button>
        <button type="button" class="btn btn-sm btn-gold" data-action="save-notes" data-id="${m.id}">${t('saveNotes')}</button>
      </div>
    </div>`;
}

// "✎ Edit" on a game in Enter scores: change its teams, time and field when the schedule changed on paper.
function editGameHTML(m) {
  const time = toMin(m.time);
  const teams = state.teams[m.div] || [];
  const teamSelect = (name, current) => `<select class="select" name="${name}" ${addTeamAttrs(m.div, `edit|${m.id}|${name}`)} aria-label="${t(name === 'ehome' ? 'homeTeam' : 'awayTeam')}">${
    (teams.includes(current) ? teams : [current, ...teams]).map(tm => `<option ${tm === current ? 'selected' : ''}>${esc(tm)}</option>`).join('')}${addTeamOpt()}</select>`;
  const usual = divisionFields(m.div);
  const fields = usual.includes(m.field) || !FIELDS[m.field] ? usual : [...usual, m.field];
  return `<div class="edit-game">
      <label class="field">${t('homeTeam')}${teamSelect('ehome', m.home)}</label>
      <label class="field">${t('awayTeam')}${teamSelect('eaway', m.away)}</label>
      <div class="field">${t('time')}
        <span class="league-time">
          <input class="input" name="eh" type="number" min="1" max="12" inputmode="numeric" value="${(Math.floor(time / 60) % 12) || 12}" aria-label="${t('time')}">:<input class="input" name="em" type="number" min="0" max="59" inputmode="numeric" value="${String(time % 60).padStart(2, '0')}" aria-label="min">
          <label class="check-pill"><input type="radio" name="eap" value="AM" ${time < 720 ? 'checked' : ''}><span>AM</span></label>
          <label class="check-pill"><input type="radio" name="eap" value="PM" ${time >= 720 ? 'checked' : ''}><span>PM</span></label>
        </span>
      </div>
      <label class="field">${t('field')}<select class="select" name="efield" data-change="add-game-field">${fields.map(f =>
        `<option value="${f}" ${f === m.field ? 'selected' : ''}>${esc(FIELDS[f])}</option>`).join('')}${
        fields.length < openFields().length ? `<option value="__other">${t('otherField')}</option>` : ''}</select></label>
      ${m.fromFriendly || m.filler || (m.fillerTeam && !m.countOnly) ? '' : `<div class="field counts-for">${t('countsForLabel')}
        <span class="day-checks">${['home', 'away'].map(side => `<label class="check-pill"><input type="checkbox" name="ecount_${side}" ${m.countOnly && m.fillerTeam === m[side] ? '' : 'checked'}><span>${esc(m[side])}</span></label>`).join('')}</span>
        <small class="muted">${t('countsForHelp')}</small></div>`}
      ${m.filler && !m.countOnly && (state.teams[m.div] || []).includes(m.fillerTeam) ? `<div class="field counts-for">${t('countsForLabel')}
        <span class="day-checks"><label class="check-pill"><input type="checkbox" checked disabled><span>${esc(m.home === m.fillerTeam ? m.away : m.home)}</span></label><label class="check-pill"><input type="checkbox" name="ecount_filler" ${m.fillerCounts ? 'checked' : ''}><span>${esc(m.fillerTeam)} (${t('fillerTag').toLowerCase()})</span></label></span>
        <small class="muted">${t('fillerCountsHelp')}</small></div>` : ''}
      <p class="warn" hidden></p>
      <div class="edit-actions">
        <button type="button" class="btn btn-sm btn-outline" data-action="cancel-edit-game">${t('cancel')}</button>
        <button type="button" class="btn btn-sm btn-gold" data-action="save-edit-game" data-id="${m.id}">${t('saveChanges')}</button>
      </div>
    </div>`;
}

// Save a game's new teams, time and field. Its old slot on the Schedule page is left open, and the game
// moves to its new field and time there. Warns (but still saves) if it now overlaps another game.
// "Counts for ATLANTE only": the game counts for one of its teams (m.countOnly; m.fillerTeam is the one left out)
const countOnlyTag = m => t('countsOnlyFor').replace('{t}', m.fillerTeam === m.home ? m.away : m.home);
function saveEditGame(form) {
  const m = state.matches.find(x => x.id === +form.dataset.id);
  const h = parseInt(form.eh.value, 10), mi = form.em.value === '' ? 0 : parseInt(form.em.value, 10);
  const ap = (form.querySelector('[name=eap]:checked') || {}).value;
  const field = form.efield.value;
  const home = form.ehome.value, away = form.eaway.value;
  const warn = form.querySelector('.edit-game .warn');
  if (home === away) { warn.textContent = t('sameTeam'); warn.hidden = false; return; }
  if (!(h >= 1 && h <= 12 && mi >= 0 && mi <= 59 && ap) || !FIELDS[field]) {
    warn.textContent = `${t('fillIn')}: ${t(!FIELDS[field] ? 'field' : 'time')}`; warn.hidden = false; return;
  }
  const start = (h % 12 + (ap === 'PM' ? 12 : 0)) * 60 + mi;
  const day = (state.matchDays || {})[m.date];
  if (day) Object.values(day).forEach(sec => Object.values(sec).forEach(rows => rows.forEach(r => {
    if (r.mid === m.id) Object.assign(r, { mid: null, home: '', away: '' });
  })));
  // Counts for: a game can count for only one of its teams (the other team's standings leave it out)
  const ch = form.querySelector('[name=ecount_home]'), ca = form.querySelector('[name=ecount_away]');
  if (ch && ca && !ch.checked && !ca.checked) { warn.textContent = t('countsForNone'); warn.hidden = false; return; }
  if (played(m) && (home !== m.home || away !== m.away)) touch(m.div);
  // a replacement game can count for the replacement team too, once it's a league team
  const cf = form.querySelector('[name=ecount_filler]');
  const countsWas = !!m.fillerCounts;
  if (cf) { if (cf.checked) m.fillerCounts = true; else delete m.fillerCounts; if (countsWas !== cf.checked) touch(m.div); }
  const wasOnly = m.countOnly ? m.fillerTeam : '';
  Object.assign(m, { home, away, time: fromMin(start), field });
  if (ch && ca) {
    const out = !ch.checked ? home : !ca.checked ? away : '';
    if (out) { m.fillerTeam = out; m.countOnly = true; } else if (m.countOnly) { delete m.fillerTeam; delete m.countOnly; }
    if ((out || '') !== wasOnly) touch(m.div);
  }
  const clashes = findConflicts({ date: m.date, start, field, div: m.div, teams: [home, away], ignore: m.id });
  logAction(`${t('logGameEdited')} · ${divName(m.div)}: ${home} ${t('vs')} ${away} · ${fmtDate(m.date)} ${m.time} · ${FIELDS[field]}${m.countOnly ? ` · ${countOnlyTag(m)}` : ''}${cf && countsWas !== cf.checked ? ` · ${t(cf.checked ? 'friendlyNowCounts' : 'friendlyNoLongerCounts')} ${m.fillerTeam}` : ''}`);
  ui.editGame = null;
  save(); render();
  return toast(clashes.length
    ? `${t('editOverlap')}: ${clashes.map(({ m: x }) => `${x.home} ${t('vs')} ${x.away} (${x.time})`).join(', ')}`
    : `${t('saved')}: ${m.home} ${t('vs')} ${m.away} · ${m.time} · ${FIELDS[field]}`);
}

// "+ Add a game" under a game day, for a game that was never on the schedule (e.g. a make-up game).
function addGameHTML(day) {
  const n = gameNumber(ui.adminDiv, day);
  if (!ui.addGameOpen) {
    return `<button type="button" class="btn btn-outline add-game-btn" data-action="open-add-game">＋ ${t('addGameTo')} ${t('game')} ${n}</button>`;
  }
  const teams = state.teams[ui.adminDiv] || [];
  const teamSelect = name => `<select class="select" name="${name}" required ${addTeamAttrs(ui.adminDiv, `addgame|${name}`)}><option value="">${t('chooseTeam')}</option>${teams.map(tm => `<option>${esc(tm)}</option>`).join('')}${addTeamOpt()}</select>`;
  return `<form class="card add-game" data-form="add-game" data-day="${day}">
      <h2>＋ ${t('addGameTo')} ${t('game')} ${n} <span class="muted">· ${fmtDate(day)}</span></h2>
      <div class="add-game-teams">${teamSelect('home')}<span class="dash">${t('vs')}</span>${teamSelect('away')}</div>
      <div class="league-grid">
        <label class="field">${t('playedOnLabel')}<input class="input" type="date" name="playedOn" value="${lastPlayDay(ui.adminDiv)}" min="${day}"></label>
        <label class="field">${t('field')}<select class="select" name="field" data-change="add-game-field">${divisionFields(ui.adminDiv).map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')}${
          divisionFields(ui.adminDiv).length < openFields().length ? `<option value="__other">${t('otherField')}</option>` : ''}</select></label>
        <div class="field">${t('score')}<span class="add-game-score">
          <input class="input score-in" name="hs" type="number" min="0" inputmode="numeric" aria-label="${t('homeTeam')}">
          <span class="dash">–</span>
          <input class="input score-in" name="as" type="number" min="0" inputmode="numeric" aria-label="${t('awayTeam')}"></span></div>
      </div>
      <p class="warn" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" data-action="close-add-game">${t('cancel')}</button>
        <button type="submit" class="btn btn-gold">${t('addGameBtn')}</button>
      </div>
    </form>`;
}


// Usual start times ("HH:MM", 24h) for a field, so admins can tap instead of typing.
const LITTLE_KIDS_FIELD = 'Bitely ES – Field 0';
// Futsal plays on two side-by-side fields (1 and 2), 45-minute games.
const FUTSAL_SLOTS = {
  fwednesdays: ['19:00', '19:45', '20:30', '21:15'],
  fthursdays: ['20:15', '21:00'],
};
// Adult divisions each have their own fields: 40+ games run 1h10, Femenil 1h.
const ADULT_SLOTS = {
  '40': {
    'Bitely ES – Field 1': ['14:20', '15:30'],
    'Bitely ES – Field 3': ['13:30', '14:20', '15:30'],
    'El Sereno Park – Field 1': ['14:20', '15:30'],
  },
  femenil: {
    'Bitely ES – Field 2': ['14:30', '15:30'],
    'El Sereno Park – Field 2': ['14:30', '15:30'],
  },
  varonil: {
    'Rio de Los Angeles State Park – Field 1': ['14:00', '15:15', '16:30', '17:45', '19:00'],
  },
};

const groupOf = div => (DIVISIONS.find(d => d.id === div) || {}).group;

// How long a game lasts, used to tell whether two bookings overlap.
const GAME_MINUTES = { '40': 70, femenil: 60, varonil: 75, u5: 45, u7: 60 };
// Bitely Field 2 youth games run 70 min; Field 0 is U-7 (1 hr) or U-5 (45 min).
function lengthFor(field, div) {
  const name = FIELDS[field];
  const set = (state.settings && state.settings.lengths || {})[div];
  if (set) return set;
  const league = customLeague(div);
  if (league) return league.length;
  if (groupOf(div) === 'futsal') return 45;
  if (name === LITTLE_KIDS_FIELD) return div === 'u5' ? 45 : 60;
  if (GAME_MINUTES[div]) return GAME_MINUTES[div];
  return name === 'Bitely ES – Field 2' ? 70 : 75;
}
const hhmm = v => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };

// A day's game length can be changed per field (Field 0 keeps U-5 and U-7 separate).
// Bitely 0 keeps separate U-5 and U-7 lengths; anyone else playing there (e.g. a tournament) has its own.
const lengthKey = (field, div) => (FIELDS[field] === LITTLE_KIDS_FIELD && (div === 'u5' || div === 'u7') ? div : 'all');
function durationFor(date, section, field, div) {
  const set = state.gameLengths && state.gameLengths[date];
  return (set && set[`${section}|${field}|${lengthKey(field, div)}`]) || lengthFor(field, div);
}
const fmtLen = min => [Math.floor(min / 60) ? `${Math.floor(min / 60)}h` : '', min % 60 ? `${min % 60}m` : ''].filter(Boolean).join(' ');

// Matches that clash with a booking: same field at an overlapping time (any division),
// or one of the same teams already playing at that time.
function findConflicts({ date, start, field, div, teams, ignore }) {
  const end = start + durationFor(date, groupOf(div), field, div);
  return state.matches.filter(m => {
    if (m.date !== date || m.id === ignore) return false;
    const s = toMin(m.time);
    if (!(start < s + durationFor(m.date, groupOf(m.div), m.field, m.div) && s < end)) return false;
    return m.field === field || (m.div === div && teams.some(n => n && (n === m.home || n === m.away)));
  }).map(m => ({ m, why: m.field === field ? 'field' : 'team' }));
}

const OLDER_YOUTH_FIELDS = ['Bitely ES – Field 1', 'El Sereno Park – Field 1', 'Franklin HS – Field 1', 'Guardia Park – Field 1'];
const YOUTH_FIELDS = {
  u5: [LITTLE_KIDS_FIELD],
  u7: [LITTLE_KIDS_FIELD],
  u9: ['Bitely ES – Field 2', 'Bitely ES – Field 3', 'El Sereno Park – Field 2', 'Rio de Los Angeles State Park – Field 2'],
  u11: ['Bitely ES – Field 3', 'Guardia Park – Field 1', 'El Sereno Park – Field 2', 'Rio de Los Angeles State Park – Field 2'],
  u13: [...OLDER_YOUTH_FIELDS, 'Rio de Los Angeles State Park – Field 2'],
  u15: OLDER_YOUTH_FIELDS, u17: OLDER_YOUTH_FIELDS, u19: OLDER_YOUTH_FIELDS,
};

// Fields a division normally plays on; the schedule form lists only these unless "Other field…" is picked.
function divisionFields(div) {
  // Admin → Settings can change a division's usual fields (an empty list means every field).
  const chosen = (state.settings && state.settings.fields || {})[div];
  if (chosen) { const open = chosen.filter(isOpenField); return open.length ? open : openFields(); }
  return defaultDivisionFields(div);
}

function defaultDivisionFields(div) {
  const all = openFields();
  const league = customLeague(div);
  if (league) return league.fields.length ? league.fields.filter(isOpenField) : all;
  const named = names => all.filter(id => names.includes(FIELDS[id]));
  let list;
  if (YOUTH_FIELDS[div]) list = named(YOUTH_FIELDS[div]);
  else if (groupOf(div) === 'adult') list = named(Object.keys(ADULT_SLOTS[div] || {}));
  else if (groupOf(div) === 'futsal') list = named(['Futsal – Field 1', 'Futsal – Field 2']);
  else list = [];
  return list.length ? list : all;
}


function nextWeekday(dayName) {
  const target = DAY_NUM[dayName] ?? 0;
  const d = new Date();
  const diff = ((target - d.getDay()) + 7) % 7 || 7;
  return addDays(todayISO(), diff);
}

// ---------- Admin → Fields ----------

// A field with games on record (this season or archived) can only be closed, not deleted.
const fieldHasGames = f => state.matches.some(m => m.field === f)
  || (state.archive || []).some(a => (a.matches || []).some(m => m.field === f));
const fieldPlaces = () => [...new Set(Object.values(FIELDS).map(n => n.split(' – ')[0]))].sort();

function pageAdminFields() {
  const add = ui.addFieldForm || {};
  return adminShell('admin/fields', `
    <h1 class="page-title">${t('fields')}</h1>
    <p class="note">${t('fieldsHelp')}</p>
    <div class="field-admin-grid">${locations().map(loc => `<div class="card field-admin">
        <h2>${esc(loc.place)}</h2>
        ${ui.editAddress === loc.place
          ? `<form class="address-form" data-form="place-address" data-place="${esc(loc.place)}">
              <input class="input" name="address" autocomplete="off" value="${esc(placeAddress(loc.place))}" aria-label="${t('address')}">
              <button type="button" class="btn btn-sm btn-outline" data-action="cancel-address">${t('cancel')}</button>
              <button type="submit" class="btn btn-sm btn-gold">${t('save')}</button>
            </form>`
          : `<p class="fa-address">${placeAddress(loc.place) ? esc(placeAddress(loc.place)) : `<span class="muted">${t('noAddress')}</span>`}
              <button type="button" class="link-btn" data-action="edit-address" data-place="${esc(loc.place)}">${t(placeAddress(loc.place) ? 'editAddress' : 'addAddress')}</button></p>`}
        <ul>${loc.ids.map((f, i) => `<li class="${isOpenField(f) ? '' : 'is-closed'}">
          <span class="fa-name">${esc(loc.labels[i])}</span>
          <span class="tag ${isOpenField(f) ? 'open-tag' : 'closed-tag'}">${t(isOpenField(f) ? 'openNow' : 'closedNow')}</span>
          <span class="fa-actions">
            <button type="button" class="btn btn-sm btn-outline" data-action="toggle-field" data-id="${f}">${t(isOpenField(f) ? 'closeField' : 'reopenField')}</button>
            ${fieldHasGames(f)
              ? `<button type="button" class="btn btn-sm btn-outline danger-outline" data-action="field-has-games">${t('deleteField')}</button>`
              : `<button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="rm-field" data-id="${f}">${t('deleteField')}</button>`}
          </span>
        </li>`).join('')}</ul>
      </div>`).join('')}</div>

    ${addFieldFormHTML()}`);
}

// The "Add a field" form: on the Fields page, and in a pop-up from the Schedule page and the
// Add a new league box so nothing you've filled in there is lost.
function addFieldFormHTML(popup = false) {
  const add = popup ? {} : ui.addFieldForm || {};
  return `<form class="${popup ? '' : 'card '}season-form" data-form="add-field">
      <h2>＋ ${t('addFieldTitle')}</h2>
      <div class="league-grid">
        <label class="field">${t('fieldLocation')}<select class="select" name="place" data-change="field-place">
          <option value="" ${add.place ? '' : 'selected'} disabled>${t('chooseOne')}</option>
          ${fieldPlaces().map(p => `<option ${add.place === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          <option value="__new" ${add.place === '__new' ? 'selected' : ''}>${t('newLocation')}</option>
        </select></label>
        <label class="field new-place" ${add.place === '__new' ? '' : 'hidden'}>${t('locationName')}<input class="input" name="newPlace" autocomplete="off"></label>
        <label class="field new-place" ${add.place === '__new' ? '' : 'hidden'}>${t('address')}<input class="input" name="address" autocomplete="off"></label>
      </div>
      <div class="field">${t('fieldLabel')}
        <div class="label-list"><input class="input" name="label" autocomplete="off" aria-label="${t('fieldLabel')}"></div>
        <button type="button" class="link-btn add-label-btn" data-action="add-label-row">＋ ${t('addAnotherField')}</button>
      </div>
      <p class="field-label">${t('whoPlaysHere')}</p>
      ${[['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']].map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
        ${DIVISIONS.filter(d => d.group === g && !isTour(d)).map(d => `<label class="check-pill"><input type="checkbox" name="playdivs" value="${d.id}"><span>${esc(divName(d.id))}</span></label>`).join('')}</fieldset>`).join('')}
      <p class="note">${t('whoPlaysHereHelp')}</p>
      <p class="warn" hidden></p>
      ${popup ? `<div class="modal-actions">
          <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
          <button class="btn btn-gold" type="submit">${t('addFieldBtn')}</button>
        </div>` : `<button class="btn btn-gold" type="submit">${t('addFieldBtn')}</button>`}
    </form>`;
}

// Opens "Add a field" in a pop-up; onAdded gets the new field ids. The page underneath isn't redrawn.
let fieldAdded = null;
function openFieldDialog(onAdded) {
  fieldAdded = onAdded;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = addFieldFormHTML(true);
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); fieldAdded = null; });
  dialog.showModal();
  dialog.querySelector('[name=place]').focus();
}

function addField(form) {
  const f = new FormData(form);
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  const place = (f.get('place') === '__new' ? f.get('newPlace') || '' : f.get('place') || '').trim().replace(/\s+/g, ' ');
  // One or more field names; a plain number like "3" becomes "Field 3".
  const labels = f.getAll('label').map(l => l.trim().replace(/\s+/g, ' ')).filter(Boolean)
    .map(l => (/^\d+$/.test(l) ? `Field ${l}` : l));
  const isNew = f.get('place') === '__new';
  const address = (f.get('address') || '').trim();
  const missing = [[place, isNew ? 'locationName' : 'fieldLocation'], [!isNew || address, 'address'], [labels.length, 'fieldLabel']]
    .filter(([ok]) => !ok).map(([, k]) => t(k));
  if (missing.length) return fail(`${t('fillIn')}: ${missing.join(', ')}`);
  const names = labels.map(l => `${place} – ${l}`);
  if (new Set(names.map(n => n.toLowerCase())).size < names.length) return fail(t('fieldTwice'));
  const taken = names.filter(name => Object.values(FIELDS).some(n => n.toLowerCase() === name.toLowerCase()));
  if (taken.length) return fail(`${t('fieldExists')} (${taken.join(', ')})`);
  state.addedFields = state.addedFields || {};
  const ids = names.map(name => {
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    while (FIELDS[id] || state.addedFields[id]) id += '-x';
    state.addedFields[id] = name;
    if (state.removedFields) delete state.removedFields[id];
    return id;
  });
  if (isNew) state.placeAddresses = { ...(state.placeAddresses || {}), [place]: address };
  applyFieldChanges();
  // The divisions checked get the new field(s) as one of their usual fields (Settings → usual fields).
  const plays = f.getAll('playdivs');
  if (plays.length) {
    state.settings = state.settings || {};
    state.settings.fields = { ...(state.settings.fields || {}) };
    plays.forEach(div => { state.settings.fields[div] = [...new Set([...divisionFields(div), ...ids])]; });
  }
  logAction(`${t(names.length > 1 ? 'fieldsAdded' : 'fieldAdded')}: ${place} – ${labels.join(', ')}${plays.length ? ` · ${plays.map(divName).join(', ')}` : ''}`);
  ui.addFieldForm = null;
  save();
  const dialog = form.closest('dialog');
  if (dialog) { const done = fieldAdded; closeDialog(dialog); if (done) done(ids); }
  else render();
  return toast(`${t(names.length > 1 ? 'fieldsAdded' : 'fieldAdded')}: ${place} – ${labels.join(', ')}`);
}

function deleteField(id) {
  const name = FIELDS[id];
  if (!name || fieldHasGames(id)) return;
  logAction(`${t('fieldDeleted')}: ${name}`, { type: 'field', id, name, added: !!(state.addedFields && state.addedFields[id]), closed: !isOpenField(id) });
  if (state.addedFields && state.addedFields[id]) delete state.addedFields[id];
  else state.removedFields = { ...(state.removedFields || {}), [id]: name };
  if (state.fieldsClosed) delete state.fieldsClosed[id];
  Object.values(state.matchDays || {}).forEach(day => Object.values(day).forEach(sec => { delete sec[id]; }));
  applyFieldChanges();
  save(); render();
  return toast(`${t('fieldDeleted')}: ${name}`);
}

function pageAdminSchedule() {
  return adminShell('admin/schedule', `<h1 class="page-title">${t('scheduleBuilder')}</h1>${matchDayHTML()}`);
}

// ---------- match day board (every field's time slots for one date, ready to fill) ----------
// A day has sections: youth in the morning, adults (Varonil, Femenil, 40+) in the afternoon,
// and futsal on its weeknights. Each section keeps its own slots per field.

const dayOfWeek = date => new Date(`${date}T12:00`).getDay();
const minToHHMM = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
let rowSeq = 0;
const newRow = (t, pinned, div = '') => ({ id: `r${Date.now().toString(36)}${rowSeq++}`, t, pinned, div, home: '', away: '', mid: null });

function daySections(date) {
  const dow = dayOfWeek(date);
  return ['youth', 'adult', 'futsal'].filter(sec => DIVISIONS.some(d => d.group === sec && playsOn(d, date)));
}
// Week days (0 = Sunday) a section plays on, e.g. futsal → Wednesday and Thursday. With `week` (its Sunday),
// days of a tournament that week are added (a Saturday tournament gets a Saturday button that week only).
const sectionDays = (sec, week) => [...new Set([
  ...DIVISIONS.filter(d => d.group === sec && !isTour(d)).map(d => DAY_NUM[d.day]),
  ...(week ? DIVISIONS.filter(d => d.group === sec && isTour(d)).flatMap(d => d.dates.filter(x => x >= week && x <= addDays(week, 6)).map(dayOfWeek)) : []),
])].sort((a, b) => a - b);

// Divisions of a section that can be booked on a field on this date.
function boardDivisions(date, section, field) {
  const dow = dayOfWeek(date);
  // A division on a day off (Settings → Days off) doesn't get slots that day.
  return DIVISIONS.filter(d => d.group === section && divisionFields(d.id).includes(field) && playsOn(d, date) && !offFor(d.id, date));
}

function adultTimes(field) {
  const out = [];
  Object.entries(ADULT_SLOTS).forEach(([div, byField]) => (byField[FIELDS[field]] || []).forEach(tm => out.push([hhmm(tm), div])));
  return out.sort((a, b) => a[0] - b[0]);
}

// Usual slots: youth chained from 8:00 (ending before that field's adult games),
// adults at their set start times, futsal at 8:15 PM.
function templateRows(date, section, field) {
  const divs = boardDivisions(date, section, field);
  if (!divs.length) return [];
  if (divs.every(d => d.custom)) {
    const l = divs[0];
    return Array.from({ length: l.perField }, (_, i) => newRow(hhmm(l.start) + i * l.length, i === 0, l.id));
  }
  if (section === 'futsal') return (FUTSAL_SLOTS[divs[0].id] || []).map((tm, i) => newRow(hhmm(tm), i === 0, divs[0].id));
  if (section === 'adult') return adultTimes(field).map(([t, div]) => newRow(t, true, div));
  const name = FIELDS[field];
  const preset = divs.length === 1 ? divs[0].id : '';
  const count = name === LITTLE_KIDS_FIELD ? 8 : name === 'Bitely ES – Field 2' ? 5 : 6;
  const stop = adultTimes(field)[0]?.[0] ?? Infinity;
  const rows = [];
  for (let i = 0, t = 8 * 60; i < count; i++) {
    const len = lengthFor(field, preset);
    if (t + len > stop) break;
    rows.push(newRow(t, i === 0, preset));
    t += len;
  }
  return rows;
}

// Fields taken off the planner for one day only (Remove for this day); "+ Add a field" puts them back.
const hiddenOn = (date, sec) => (((state.dayHiddenFields || {})[date] || {})[sec] || []);
function setHiddenOn(date, sec, list) {
  state.dayHiddenFields = { ...(state.dayHiddenFields || {}) };
  state.dayHiddenFields[date] = { ...(state.dayHiddenFields[date] || {}), [sec]: list };
}

function boardDay(date) {
  state.matchDays = state.matchDays || {};
  const day = state.matchDays[date] = state.matchDays[date] || {};
  daySections(date).forEach(sec => {
    if (!day[sec] || !Object.keys(day[sec]).length) day[sec] = Object.fromEntries(Object.keys(FIELDS).map(f => [f, templateRows(date, sec, f)]));
    // A field that gets used later (e.g. a tournament division picks Bitely 0) gets its usual time slots then.
    Object.keys(FIELDS).forEach(f => {
      if (!(day[sec][f] || []).length && isOpenField(f) && boardDivisions(date, sec, f).length && !hiddenOn(date, sec).includes(f)) day[sec][f] = templateRows(date, sec, f);
      // Open slots follow who plays that day: a division that isn't playing (day off) comes off, and when
      // only one division uses the field that day (e.g. a tournament), it's filled in. A division picked by
      // hand (e.g. from "Other division…") stays.
      const ok = boardDivisions(date, sec, f).map(d => d.id);
      (day[sec][f] || []).forEach(r => {
        if (r.mid || r.friendly || r.picked || rowTaken(date, r)) return;
        if (r.div && !ok.includes(r.div)) r.div = '';
        if (!r.div && ok.length === 1) r.div = ok[0];
      });
    });
  });
  // Stay in step with matches added or deleted on other pages.
  const linked = new Set();
  Object.values(day).forEach(sec => Object.values(sec).forEach(rows => rows.forEach(r => {
    if (r.mid && !state.matches.some(m => m.id === r.mid && m.date === date && !m.forfeitBy)) Object.assign(r, { mid: null, home: '', away: '' });
    if (r.mid) linked.add(r.mid);
  })));
  state.matches.filter(m => m.date === date && !linked.has(m.id) && !m.forfeitBy && !m.fromFriendly).forEach(m => {
    const sec = day[groupOf(m.div)] = day[groupOf(m.div)] || {};
    const rows = sec[m.field] = sec[m.field] || [];
    const t = toMin(m.time);
    let r = rows.find(x => !x.mid && !x.friendly && x.t === t);
    if (!r) { r = newRow(t, true); rows.push(r); rows.sort((a, b) => a.t - b.t); }
    Object.assign(r, { div: m.div, home: m.home, away: m.away, mid: m.id, pinned: r.pinned || played(m) });
  });
  return day;
}

// First slot of a section on the board's date (8:00 AM youth, 2:00 PM adults, 7:00 PM Wednesday futsal…).
function sectionStart(section) {
  const dow = dayOfWeek(ui.boardDate);
  const d = DIVISIONS.find(x => x.group === section && playsOn(x, ui.boardDate));
  if (d && d.custom) return hhmm(d.start);
  if (section === 'futsal') return hhmm((FUTSAL_SLOTS[d ? d.id : 'fthursdays'] || ['20:15'])[0]);
  return section === 'adult' ? 14 * 60 : 8 * 60;
}

const boardRows = (section, field) => state.matchDays[ui.boardDate][section][field];

// Unpinned slots start when the slot before them ends; booked matches move with them.
// "Fix overlapping times" is on for every field unless switched off for that field on that day.
// A tournament can start with it off on its fields (set when it's made, or on its page).
const strictFor = (section, field) => {
  const v = ((state.looseTimes || {})[ui.boardDate] || {})[`${section}|${field}`];
  if (v !== undefined) return !v;
  return !DIVISIONS.some(d => d.group === section && isTour(d) && d.loose && playsOn(d, ui.boardDate) && (d.fields || []).includes(field));
};

// Each slot starts when the one before it ends. A time you typed (or the field's usual time) stays, unless
// strict mode is on and it would start before the previous game ends; then it's pushed later, and it goes
// back to its own time once the game before it is shorter again. Games with a score never move.
// Returns true if anything moved.
function reflow(section, field) {
  const rows = boardRows(section, field);
  let moved = false;
  rows.forEach((r, i) => {
    const m = r.mid && state.matches.find(x => x.id === r.mid);
    if (i > 0 && !(m && played(m))) {
      const end = rows[i - 1].t + durationFor(ui.boardDate, section, field, rowDiv(rows[i - 1]));
      if (r.pinned && r.base === undefined) r.base = r.t;
      const t = !r.pinned ? end : strictFor(section, field) ? Math.max(r.base, end) : r.base;
      if (t !== r.t) { r.t = t; moved = true; }
    }
    if (m && !played(m)) m.time = fromMin(r.t);
  });
  return moved;
}

// ---------- friendlies ----------
// A friendly only lives on the schedule planner, to show the field is taken. It never becomes a match, so it
// isn't on Scores, standings, Goleadores, game numbers, the rotation or Awaiting scores. A slot is a friendly
// when "Friendly" is picked as its division, or when the whole day is switched to friendlies.
const friendlyDay = date => !!(state.friendlyDays || {})[date];
// On a friendlies day every slot is a friendly, except league games already booked and any slot changed
// back to "League game" by hand.
const isFriendly = (date, r) => !r.hold && (!!r.friendly || (friendlyDay(date) && !r.mid && !r.league));
const FRIENDLY_OUT = '__out';
// The division whose game length a slot uses (a friendly uses the one picked for it, if any).
const rowDiv = r => (r.friendly ? (DIVISIONS.some(d => d.id === r.fdiv) ? r.fdiv : '') : r.div);
const rowTaken = (date, r) => !!r.mid || !!r.hold || (isFriendly(date, r) && !!(r.home || r.away));
const friendliesOn = (date, sec) => Object.values((boardDay(date) || {})[sec] || {}).flat().filter(r => isFriendly(date, r) && (r.home || r.away)).length;

// A slot with a division and two different teams is a booked match; anything less is just an open slot.
function syncRow(date, field, r) {
  if (r.hold) return;
  const m = r.mid && state.matches.find(x => x.id === r.mid);
  if (m && played(m)) return;
  if (isFriendly(date, r)) {
    // A slot turned into a friendly lets go of any league game it had.
    if (m) state.matches = state.matches.filter(x => x.id !== m.id);
    r.mid = null;
    return;
  }
  const ready = r.div && r.home && r.away && r.home !== r.away;
  // A team picked from "Withdrawn / hidden" that isn't in the league (one that only played as a replacement)
  // plays as a guest: only the league team's side of the game counts.
  const league = state.teams[r.div] || [], gone = new Set(withdrawnIn(r.div || '').map(w => w.team));
  const isGuest = x => !!x && !league.includes(x) && !gone.has(x) && !copaExtras(r.div).includes(x);
  const guest = ready ? (isGuest(r.home) ? r.home : isGuest(r.away) ? r.away : '') : '';
  if (ready && m) {
    Object.assign(m, { div: r.div, home: r.home, away: r.away, field, date, time: fromMin(r.t) });
    if (guest) { m.fillerTeam = guest; delete m.countOnly; }
    else if (m.countOnly && ![m.home, m.away].includes(m.fillerTeam)) { delete m.fillerTeam; delete m.countOnly; }
    else if (m.fillerTeam && !m.filler && !m.countOnly) delete m.fillerTeam;
    tagPlayoff(m);
  } else if (ready) {
    const nm = { id: state.nextId++, div: r.div, date, time: fromMin(r.t), field, home: r.home, away: r.away, hs: null, as: null, goals: [], ...(guest ? { fillerTeam: guest } : {}) };
    tagPlayoff(nm);
    state.matches.push(nm);
    r.mid = nm.id;
  } else if (m) {
    state.matches = state.matches.filter(x => x.id !== m.id);
    r.mid = null;
  }
}

function rowStatus(date, field, r) {
  if (isFriendly(date, r)) return { status: r.home || r.away ? `<span class="tag friendly-tag">${t('friendly')}</span>` : '', clash: false };
  const m = r.mid && state.matches.find(x => x.id === r.mid);
  if (!m) return { status: '', clash: false };
  if (played(m)) return { status: `<span class="final-tag" title="${t('final')}">${m.hs}–${m.as}</span>`, clash: false };
  const list = findConflicts({ date, start: r.t, field, div: r.div, teams: [r.home, r.away], ignore: m.id });
  if (!list.length) return { status: `<span class="ok-tag">${t('okTag')}</span>`, clash: false };
  const tip = list.map(({ m: c, why }) => `${t(why === 'field' ? 'conflictField' : 'conflictTeam')} ${divName(c.div)} · ${c.home} ${t('vs')} ${c.away} · ${c.time}`).join('\n');
  return { status: `<span class="warn-tag" title="${esc(tip)}">${t('clashTag')}</span>`, clash: true };
}

function boardRow(date, section, field, r, divs) {
  const m = r.mid && state.matches.find(x => x.id === r.mid);
  const locked = m && played(m);
  const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  // A filler (guest) team booked in this slot shows by name even though it isn't one of the division's teams.
  const guest = m && m.fillerTeam ? [m.fillerTeam] : [];
  let teams = r.div ? [...(state.teams[r.div] || []), ...copaExtras(r.div), ...guest].sort((a, b) => a.localeCompare(b)) : [];
  // A group picked in the Round column narrows the lists to that group (keeping anyone already booked).
  const stage = rowRound(r);
  const grp = stage.startsWith('g:') && ((copaOf(r.div) || {}).groups || []).find(g => g.name === stage.slice(2));
  if (grp) teams = teams.filter(x => grp.teams.includes(x) || x === r.home || x === r.away);
  // Teams hidden from the standings, withdrawn teams and replacement-only teams are listed in their own section.
  const off = r.div && !grp ? [...new Set([...teams.filter(x => hiddenFromStandings(r.div).has(x)), ...guest,
    ...withdrawnIn(r.div).map(w => w.team), ...hiddenTeams(r.div).filter(h => h.kind === 'replacement').map(h => h.team)])].sort((a, b) => a.localeCompare(b)) : [];
  const main = teams.filter(x => !off.includes(x));
  const teamSel = (cls, cur) => `<select class="select ${cls}" ${locked || !r.div ? 'disabled' : addTeamAttrs(r.div, `board|${r.id}|${cls}`)}>${opt('', cur, r.div ? t('chooseTeam') : '—')}${main.map(n => opt(n, cur)).join('')}${
    off.length ? `<optgroup label="${t('withdrawnHidden')}">${off.map(n => opt(n, cur)).join('')}</optgroup>` : ''}${r.div && !locked ? addTeamOpt() : ''}</select>`;
  const { status, clash } = rowStatus(date, field, r);
  // The field's usual divisions, or the whole section (youth, adults or futsal) after "Other division…";
  // always include the one booked.
  const sectionDivs = DIVISIONS.filter(d => d.group === section);
  const hasMore = sectionDivs.some(d => !divs.includes(d));
  let divOptions = r.allDivs ? sectionDivs : divs;
  if (r.div && !divOptions.some(d => d.id === r.div)) divOptions = [...divOptions, DIVISIONS.find(d => d.id === r.div)];
  if (r.hold) return boardRoundCol && tourCopa(DIVISIONS.find(d => d.id === r.hold.div)) ? holdRowCols(date, section, field, r, opt, divOptions) : holdRow(date, section, field, r, opt, divOptions);
  if (isFriendly(date, r)) return friendlyRow(date, section, field, r, opt, status);
  const ko = !locked && koDivs(divOptions.filter(d => !tourCopa(d))).length ? `<option value="__ko">${t('koSlotOption')}</option>` : '';
  const rd = DIVISIONS.find(d => d.id === r.div);
  const round = boardRoundCol ? `<td>${tourCopa(rd) ? `<select class="select b-round" ${locked ? 'disabled' : ''} aria-label="${t('roundCol')}">${roundOptions(r.div, rowRound(r), opt)}</select>` : ''}</td>` : '';
  return `<tr class="${m ? 'booked' : ''} ${clash ? 'clash' : ''}" data-row="${r.id}" data-field="${field}" data-section="${section}">
    <td class="b-time-cell">${timePicker(r.t, locked)}</td>
    <td><select class="select b-div" ${locked ? 'disabled' : ''} aria-label="${t('division')}">${opt('', r.div, '—')}${divOptions.map(d => opt(d.id, r.div, boardDivLabel(d))).join('')}${r.allDivs || !hasMore ? '' : `<option value="__other">${t('otherDivision')}</option>`}${ko}<option value="__friendly">${t('friendlyOption')}</option></select></td>
    ${round}
    <td>${teamSel('b-home', r.home)}</td>
    <td>${teamSel('b-away', r.away)}</td>
    <td class="b-status">${status}</td>
    <td><button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-slot-row" aria-label="${t('remove')}">×</button></td>
  </tr>`;
}

// Tournament slots get a Round column: Group A / Group B (or Round robin), then the knockout games
// (Semifinal 1, Final…). Picking a knockout game saves the slot for it; picking a group narrows the teams.
let boardRoundCol = false;
// "U-13 · Thanksgiving Cup" on the planner, so the division still shows when the list is narrow.
const boardDivLabel = d => (isTour(d) ? `${d.short || divName(d.id)} · ${(tournaments().find(x => x.id === d.tournament) || {}).name || ''}` : divName(d.id));
const tourCopa = d => !!d && isTour(d) && !!copaOf(d.id);
function roundOptions(div, cur, opt) {
  const co = copaOf(div);
  const groups = (co.groups || []).map(g => opt(`g:${g.name}`, cur, co.roundRobin ? t('roundRobinShort') : `${t('group')} ${g.name}`)).join('');
  const ko = koPlan(div).flatMap(n => Array.from({ length: n.legs }, (_, i) => opt(`k:${holdKey(n, i + 1)}`, cur, `${n.name}${n.legs > 1 ? ` · ${t(i ? 'leg2' : 'leg1')}` : ''}`))).join('');
  return `${opt('', cur, t('roundPick'))}${groups ? `<optgroup label="${t('groupStage')}">${groups}</optgroup>` : ''}${ko ? `<optgroup label="${t('koStage')}">${ko}</optgroup>` : ''}`;
}
// Which round a booked slot is in: what was picked, else the game's own tag.
function rowRound(r) {
  if (r.hold) return r.hold.key ? `k:${r.hold.key}` : '';
  const m = r.mid && state.matches.find(x => x.id === r.mid);
  if (m && m.playoff && m.playoff.cup === 'copa') return m.playoff.group ? `g:${m.playoff.group}` : `k:${m.playoff.round}-${m.playoff.slot}-${m.playoff.leg || 1}`;
  return r.stage || '';
}
// A saved knockout slot in a table with the Round column: the teams are lists whose first line says who it
// will be ("1st Group A"); they fill themselves with auto-pick on, or pick them.
function holdRowCols(date, section, field, r, opt, divOptions) {
  const n = r.hold.key && holdNode(r);
  const [la, lb] = n ? [n.aLabel, n.bLabel] : [t('chooseTeam'), t('chooseTeam')];
  const teams = [...(state.teams[r.hold.div] || []), ...copaExtras(r.hold.div)].sort((a, b) => a.localeCompare(b));
  const pick = (cls, cur, label) => `<select class="select ${cls}" ${n ? '' : 'disabled'}>${opt('', cur, label)}${teams.map(x => opt(x, cur)).join('')}</select>`;
  const divs = divOptions.some(d => d.id === r.hold.div) ? divOptions : [...divOptions, DIVISIONS.find(d => d.id === r.hold.div)].filter(Boolean);
  return `<tr class="held" data-row="${r.id}" data-field="${field}" data-section="${section}">
    <td class="b-time-cell">${timePicker(r.t, false)}</td>
    <td><select class="select b-div" aria-label="${t('division')}">${divs.map(d => opt(d.id, r.hold.div, boardDivLabel(d))).join('')}<option value="__friendly">${t('friendlyOption')}</option></select></td>
    <td><select class="select b-round" aria-label="${t('roundCol')}">${roundOptions(r.hold.div, rowRound(r), opt)}</select></td>
    <td>${pick('b-hhome', r.hHome || '', la)}</td>
    <td>${pick('b-hhaway', r.hAway || '', lb)}</td>
    <td class="b-status"><span class="tag held-tag" title="${esc(rotationOn(r.hold.div) ? t('koWaitAuto') : t('koWaitManual'))}">${t('koSaved')}</span></td>
    <td><button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-slot-row" aria-label="${t('remove')}">×</button></td>
  </tr>`;
}

// A slot saved for a knockout game: which division and which game (Semifinal 1, Final…), with who it will be
// ("1st Group A vs 2nd Group B"). With auto-pick on the teams go in by themselves once they're known;
// with it off (or to pick others) the two team lists pick them.
function holdRow(date, section, field, r, opt, divOptions) {
  const divs = koDivs(divOptions.some(d => d.id === r.hold.div) ? divOptions : [...divOptions, DIVISIONS.find(d => d.id === r.hold.div)].filter(Boolean));
  const plan = koPlan(r.hold.div);
  const elsewhere = new Set(allHolds().filter(h => h.r !== r && h.r.hold.div === r.hold.div).map(h => h.r.hold.key));
  const games = plan.flatMap(n => Array.from({ length: n.legs }, (_, i) => {
    const k = holdKey(n, i + 1);
    const booked = state.matches.some(m => m.div === r.hold.div && m.playoff && m.playoff.cup === 'copa' && m.playoff.round === n.round && m.playoff.slot === n.slot && m.playoff.leg === i + 1);
    const label = `${n.name}${n.legs > 1 ? ` · ${t(i ? 'leg2' : 'leg1')}` : ''} — ${n.a || n.aLabel} ${t('vs')} ${n.b || n.bLabel}${elsewhere.has(k) || booked ? ` (${t('alreadySaved')})` : ''}`;
    return opt(k, r.hold.key, label);
  })).join('');
  const n = r.hold.key && holdNode(r);
  const teams = [...(state.teams[r.hold.div] || []), ...copaExtras(r.hold.div)].sort((a, b) => a.localeCompare(b));
  const pick = (cls, cur) => `<select class="select ${cls}">${opt('', cur, t('chooseTeam'))}${teams.map(x => opt(x, cur)).join('')}</select>`;
  const auto = rotationOn(r.hold.div);
  return `<tr class="held" data-row="${r.id}" data-field="${field}" data-section="${section}">
    <td class="b-time-cell">${timePicker(r.t, false)}</td>
    <td><select class="select b-hdiv" aria-label="${t('division')}">${divs.map(d => opt(d.id, r.hold.div, `${d.short || divName(d.id)} · ${t('koShort')}`)).join('')}${opt('__league', '', `← ${t('leagueGame')}`)}</select></td>
    <td colspan="2"><select class="select b-hgame" aria-label="${t('koWhichGame')}">${opt('', r.hold.key || '', t('koWhichGame'))}${games}</select>
      ${n ? `<div class="hold-teams">${n.a && n.b
        ? (auto ? `<span class="muted">${t('koFillsItself')}</span>` : `<span class="muted">${t('koTeamsKnown')}: <b>${esc(n.a)} ${t('vs')} ${esc(n.b)}</b></span>`)
        : `<span class="muted">${auto ? t('koWaitAuto') : t('koWaitManual')}</span>`}
        ${!auto ? `<span class="hold-pick">${pick('b-hhome', r.hHome || '')}<span class="muted">${t('vs')}</span>${pick('b-hhaway', r.hAway || '')}</span>`
          : !(n.a && n.b) ? `<details class="hold-manual" ${r.hHome || r.hAway ? 'open' : ''}><summary class="link-btn small">${t('koPickMyself')}</summary>
            <span class="hold-pick">${pick('b-hhome', r.hHome || '')}<span class="muted">${t('vs')}</span>${pick('b-hhaway', r.hAway || '')}</span></details>` : ''}</div>` : ''}</td>
    <td class="b-status"><span class="tag held-tag">${t('koSaved')}</span></td>
    <td><button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-slot-row" aria-label="${t('remove')}">×</button></td>
  </tr>`;
}

// "⏱ Game length" for a field on this day, with −/+ in 5-minute steps and Reset.
function lengthTool(date, section, field, rows) {
  // Bitely 0 shows U-5 / U-7 when they play there that day, and one length for anyone else.
  const here = [...new Set([...boardDivisions(date, section, field).map(d => d.id), ...rows.map(r => r.div).filter(Boolean)])];
  const little = FIELDS[field] === LITTLE_KIDS_FIELD;
  const keys = little
    ? [...['u5', 'u7'].filter(k => here.includes(k)).map(k => [k, divName(k)]), ...(here.some(d => d !== 'u5' && d !== 'u7') || !here.length ? [['all', here.includes('u5') || here.includes('u7') ? t('others') : '']] : [])]
    : [['all', '']];
  const sampleDiv = k => (k === 'all' ? (rows.find(r => r.div && (!little || (r.div !== 'u5' && r.div !== 'u7'))) || {}).div || here.find(d => !little || (d !== 'u5' && d !== 'u7')) || '' : k);
  const lengths = (state.gameLengths && state.gameLengths[date]) || {};
  const id = `${section}|${field}`;
  const summary = keys.map(([k, label]) => `${label ? label + ' ' : ''}${fmtLen(durationFor(date, section, field, sampleDiv(k)))}`).join(' · ');
  const open = ui.openLength === id;
  const differs = k => lengths[`${id}|${k}`] && lengths[`${id}|${k}`] !== lengthFor(field, sampleDiv(k));
  return `<button type="button" class="link-btn small ${keys.some(([k]) => differs(k)) ? 'changed' : ''}" data-action="toggle-length" data-id="${id}">${t('gameLength')}: ${summary}</button>
    ${open ? `<div class="len-editor">${keys.map(([k, label]) => `<span class="len-row" data-section="${section}" data-field="${field}" data-k="${k}" data-div="${sampleDiv(k)}">
      ${label ? `<b>${label}</b>` : ''}
      <button type="button" class="icon-btn" data-action="len-step" data-step="-5" aria-label="−5">−</button>
      <span class="len-value">${fmtLen(durationFor(date, section, field, sampleDiv(k)))}</span>
      <button type="button" class="icon-btn" data-action="len-step" data-step="5" aria-label="+5">+</button>
      ${differs(k) ? `<button type="button" class="link-btn small" data-action="len-reset">${t('resetLength')}</button>` : ''}
    </span>`).join('')}</div>` : ''}`;
}

function boardFieldHTML(date, section, field) {
  const rows = boardRows(section, field);
  const divs = boardDivisions(date, section, field);
  const key = `${section}|${field}`;
  boardRoundCol = [...divs, ...rows.map(r => DIVISIONS.find(d => d.id === (r.hold ? r.hold.div : r.div)))].some(tourCopa);
  return `<details class="board-field" data-key="${key}" ${ui.closedFields.has(key) ? '' : 'open'}>
    <summary><b>${esc(FIELDS[field])}</b>${isOpenField(field) ? '' : ` <span class="tag closed-tag">${t('closedNow')}</span>`}<span class="muted">${rows.filter(r => rowTaken(date, r)).length} / ${rows.length} ${t('booked')}</span></summary>
    <div class="board-wrap"><table class="board">
      <thead><tr><th>${t('time')}</th><th>${t('division')}</th>${boardRoundCol ? `<th>${t('roundCol')}</th>` : ''}<th>${t('homeTeam')}</th><th>${t('awayTeam')}</th><th></th><th></th></tr></thead>
      <tbody>${rows.map(r => boardRow(date, section, field, r, divs.length ? divs : DIVISIONS.filter(d => d.group === section))).join('')}</tbody>
    </table></div>
    <div class="field-tools">
      <button type="button" class="link-btn small" data-action="add-slot-row" data-section="${section}" data-field="${field}">＋ ${t('addSlot')}</button>
      ${lengthTool(date, section, field, rows)}
      <button type="button" class="link-btn small danger-link" data-action="ask" data-confirm="hide-field-day" data-section="${section}" data-field="${field}" data-ask="askHideField" data-yes="yesRemove">${t('removeForDay')}</button>
      <label class="strict-toggle" title="${t(strictFor(section, field) ? 'strictOn' : 'strictOff')}">
        <input type="checkbox" data-change="strict" data-section="${section}" data-field="${field}" ${strictFor(section, field) ? 'checked' : ''}>
        <span class="switch" aria-hidden="true"></span><span>${t('strictTimes')}</span></label>
    </div>
  </details>`;
}

const SECTION_TITLE = { youth: 'youthMorning', adult: 'adultAfternoon', futsal: 'futsalNight' };

function boardListHTML() {
  const date = ui.boardDate;
  const day = boardDay(date);
  if (day[ui.boardSection]) {
    const moved = Object.keys(day[ui.boardSection]).map(f => reflow(ui.boardSection, f)).some(Boolean);
    if (moved) save();
  }
  const booked = state.matches.filter(m => m.date === date).length;
  const countOf = sec => state.matches.filter(m => m.date === date && groupOf(m.div) === sec).length;
  day[ui.boardSection] = day[ui.boardSection] || {};
  const friendlies = friendliesOn(date, ui.boardSection);
  return `<p class="day-count"><b>${booked}</b> ${t(booked === 1 ? 'matchBooked' : 'matchesBooked')}${friendlies ? ` · <b>${friendlies}</b> ${t(friendlies === 1 ? 'friendlyOne' : 'friendlyMany')}` : ''}</p>
    ${[ui.boardSection].map(sec => {
      // A field shows when a division playing that day uses it, something is booked on it, or it was added by hand.
      const shown = Object.keys(FIELDS).filter(f => {
        const rows = day[sec][f] || [];
        if (!rows.length || hiddenOn(date, sec).includes(f)) return false;
        if (rows.some(r => rowTaken(date, r) || r.added)) return true;
        return isOpenField(f) && boardDivisions(date, sec, f).length > 0;
      });
      const others = openFields().filter(f => !shown.includes(f));
      const count = countOf(sec);
      return `<section class="board-section ${sec}">
        <h2 class="board-section-title">${t(SECTION_TITLE[sec])}<span class="muted">${count} ${t(count === 1 ? 'matchLabel' : 'matchesLabel')}</span></h2>
        ${shown.map(f => boardFieldHTML(date, sec, f)).join('') || empty(t('noSlots'))}
        <select class="select add-field" data-change="add-field" data-section="${sec}" aria-label="${t('addField')}">
          <option value="">＋ ${t('addField')}</option>${others.map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')}
          <option value="__new">＋ ${t('newFieldOption')}</option></select>
      </section>`;
    }).join('') || empty(t('noSlots'))}`;
}

// The board works a week at a time: Youth and Adults play that Sunday, Futsal that Wednesday or Thursday.
const sundayOf = date => addDays(date, -dayOfWeek(date));

// Which game of the season a date is for a division: its place among the division's game days,
// counting ahead for a date that has no games yet (same numbering as the Scores page).
function gameNumber(div, date) {
  const days = [...new Set([...state.matches, ...forfeitStubs(div)].filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
  const i = days.indexOf(date);
  return i >= 0 ? i + 1 : days.filter(d => d < date).length + 1;
}

// A game a withdrawn team had left, shown on its game day without a field or time:
// "Game 10 · Troncos FC vs Mountain View FC — Mountain View FC withdrew · Troncos FC wins 3–0".
function forfeitLine(m, showDiv) {
  const w = withdrawnIn(m.div).find(x => x.team === m.home || x.team === m.away);
  if (!w) return '';
  const winner = w.team === m.home ? m.away : m.home;
  const counts = wOpts(w).forfeitLeft;
  return `<div class="forfeit-line">
    <span class="tag forfeit">${t(counts ? 'forfeit' : 'cancelled')}</span>
    <span><b>${showDiv ? `${esc(divName(m.div))} · ` : ''}${t('game')} ${gameNumber(m.div, m.date)}</b> · ${esc(m.home)} ${t('vs')} ${esc(m.away)}
      <small class="muted">— ${esc(w.team)} ${t('withdrew')}${counts ? ` · ${esc(winner)} ${t('wins30')}${m.date > todayISO() ? ` (${t('countsOn')} ${fmtDate(m.date)})` : ''}` : ` · ${t('doesntCount')}`}</small></span>
  </div>`;
}

// The schedule planner's own section at the bottom for that day's forfeits. Each week a team that
// would have played a withdrawn team can be put here: no field, and the other team wins 3–0.
function forfeitBoxHTML() {
  const date = ui.boardDate;
  const divs = DIVISIONS.filter(d => d.group === ui.boardSection && playsOn(d, date));
  if (!divs.length) return '';
  const list = divs.flatMap(d => forfeitStubs(d.id)).filter(m => m.date === date);
  // forfeits, and forfeits that got a replacement team (they stay listed, so what happened isn't lost)
  const regular = state.matches.filter(m => (m.forfeitBy || m.filler) && m.date === date && divs.some(d => d.id === m.div)).sort(byDateTime);
  const teamOptions = (div, cur) => `<option value="">${t('chooseTeam')}</option>${[...(state.teams[div] || [])].sort((x, y) => x.localeCompare(y))
    .map(n => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  const goneOptions = (div, cur) => withdrawnIn(div).map(w => `<option ${w.team === cur ? 'selected' : ''}>${esc(w.team)}</option>`).join('');
  const addDiv = divs.some(d => d.id === ui.forfeitDiv) ? ui.forfeitDiv : divs[0].id;
  const gone = withdrawnIn(addDiv);
  // The team that forfeits: any team in the division, plus teams that withdrew.
  const loserOptions = `<option value="">${t('chooseTeam')}</option>${[...(state.teams[addDiv] || [])].sort((x, y) => x.localeCompare(y)).map(n => `<option>${esc(n)}</option>`).join('')}${
    gone.length ? `<optgroup label="${t('withdrewGroup')}">${gone.map(w => `<option value="${esc(w.team)}">${esc(w.team)} (${t('withdrewTag')})</option>`).join('')}</optgroup>` : ''}`;
  return `<section class="forfeit-box">
      <div class="forfeit-head">
        <h2 class="section-title">${t('forfeitsToday')} <span class="muted">${list.length + regular.length}</span></h2>
        <button type="button" class="btn btn-sm btn-gold" data-action="forfeit-add-open" aria-expanded="${!!ui.forfeitAddOpen}">＋ ${t('addForfeit')}</button>
      </div>
      <p class="note">${t('forfeitsTodayHelp')}</p>
      ${ui.forfeitAddOpen ? `<form class="forfeit-row forfeit-add" data-form="add-forfeit">
        <label class="field">${t('division')}<select class="select" name="div" data-change="forfeit-div">${divs.map(d => `<option value="${d.id}" ${d.id === addDiv ? 'selected' : ''}>${esc(divName(d.id))}</option>`).join('')}</select></label>
        <label class="field">${t('forfeitingTeam')}<select class="select" name="loser">${loserOptions}</select></label>
        <label class="field">${t('winsTeam')}<select class="select" name="winner">${teamOptions(addDiv, '')}</select></label>
        <label class="check-pill both-ff"><input type="checkbox" name="both"><span>${t('bothForfeitCheck')}</span></label>
        <div class="forfeit-add-actions">
          <button type="button" class="btn btn-sm btn-outline" data-action="forfeit-add-open">${t('cancel')}</button>
          <button class="btn btn-sm btn-gold" type="submit">${t('addForfeit')}</button>
        </div>
        <p class="warn" hidden></p>
      </form>` : ''}
      ${forfeitGroups(divs, list, regular, m => {
        const w = withdrawnIn(m.div).find(x => x.team === m.home || x.team === m.away);
        const other = w.team === m.home ? m.away : m.home;
        const counts = wOpts(w).forfeitLeft;
        return `<div class="forfeit-row" data-mid="${m.id}">
          <span class="tag forfeit">${t(counts ? 'forfeit' : 'cancelled')}</span>
          <b>${t('game')} ${gameNumber(m.div, m.date)}</b>
          <select class="select" data-change="forfeit-team" aria-label="${t('team')}">${teamOptions(m.div, other)}</select>
          <span class="muted">${t('vs')}</span>
          <select class="select" data-change="forfeit-gone" aria-label="${t('withdrawnTitle')}">${goneOptions(m.div, w.team)}</select>
          <small class="muted">${counts ? `${esc(other)} ${t('wins30')}` : t('doesntCount')}</small>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-forfeit" data-ask="askRmForfeit" data-mid="${m.id}" aria-label="${t('remove')}">×</button>
          <button type="button" class="link-btn replacement-btn" data-action="filler-open" data-mid="${m.id}" aria-expanded="${ui.fillerFor === m.id}">＋ ${t('fillerBtn')}</button>
        </div>
        ${ui.fillerFor === m.id ? fillerFormHTML(m, other) : ''}`;
      }, m => {
        if (m.filler) {
          // a forfeit with a replacement team playing instead
          const stays = m.home === m.fillerTeam ? m.away : m.home;
          return `<div class="forfeit-row replaced-row" data-mid="${m.id}">
            <span class="tag filler-tag">${t('fillerTag')}</span>
            <b>${t('game')} ${gameNumber(m.div, m.date)}</b>
            <span><b>${esc(stays)}</b> ${t('vs')} <b>${esc(m.fillerTeam)}</b> <span class="muted">· ${t('insteadOf')} ${esc(m.filler.gone)} (${t('forfeitedWord')})${fillsForForfeit(m) ? ` · ${esc(t('fillerCountsFor').replace('{t}', m.fillerTeam))}` : ''} · ${esc(m.time)}${m.field ? ` · ${esc(FIELDS[m.field] || m.field)}` : ''}</span></span>
            <span class="replaced-actions">
              <button type="button" class="link-btn replacement-btn" data-action="filler-open" data-mid="${m.id}" aria-expanded="${ui.fillerFor === m.id}">${t('editWord')}</button>
              <button type="button" class="link-btn replacement-btn" data-action="ask" data-confirm="filler-undo" data-ask="askBackToForfeit" data-yes="yesBack" data-id="${m.id}">${t('backToForfeit')}</button>
            </span>
          </div>
          ${ui.fillerFor === m.id ? fillerFormHTML(m, stays) : ''}`;
        }
        const winner = m.forfeitBy === m.home ? m.away : m.home;
        return `<div class="forfeit-row" data-mid="${m.id}">
          <span class="tag forfeit">${t(doubleForfeit(m) ? 'doubleForfeit' : 'forfeit')}</span>
          <b>${t('game')} ${gameNumber(m.div, m.date)}</b>
          <span>${doubleForfeit(m) ? `<b>${esc(m.home)}</b> ${t('and')} <b>${esc(m.away)}</b> ${t('bothLose30Lower')}<span class="muted">` : `<b>${esc(winner)}</b> ${t('wins30')} <span class="muted">· ${esc(m.forfeitBy)} ${t('forfeitedWord')}`}${m.forfeitFrom ? ` · ${t('wasBooked')} ${esc(m.forfeitFrom.time)}` : ''}${forfeitSwap(m) ? ` · ${esc(t('forfeitNotCounted').replace('{t}', winner))}` : ''}</span></span>
          <button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-forfeit-game" data-ask="${m.forfeitFrom ? 'askBackToGame' : 'askRmForfeit'}" data-yes="${m.forfeitFrom ? 'yesBack' : 'yesRemove'}" data-id="${m.id}" aria-label="${t(m.forfeitFrom ? 'backToGame' : 'remove')}" title="${t(m.forfeitFrom ? 'backToGame' : 'remove')}">×</button>
          ${doubleForfeit(m) ? '' : `<button type="button" class="link-btn replacement-btn" data-action="filler-open" data-mid="${m.id}" aria-expanded="${ui.fillerFor === m.id}">＋ ${t('fillerBtn')}</button>`}
        </div>
        ${ui.fillerFor === m.id && !doubleForfeit(m) ? fillerFormHTML(m, winner) : ''}`;
      })}
    </section>`;
}
// The day's forfeits under a header for each division (like Awaiting scores on the dashboard), U-5 → U-19, …
function forfeitGroups(divs, stubs, regular, stubRow, regularRow) {
  return divs.map(d => {
    const a = stubs.filter(m => m.div === d.id), b = regular.filter(m => m.div === d.id);
    if (!a.length && !b.length) return '';
    const n = a.length + b.length;
    return `<section class="await-group forfeit-group">
      <h3 class="await-head"><span>${esc(divName(d.id))}</span><span class="muted">${n} ${t(n === 1 ? 'forfeitWord' : 'forfeitsWord')}</span></h3>
      ${a.map(stubRow).join('')}${b.map(regularRow).join('')}
    </section>`;
  }).join('');
}

// Play a guest team instead of the forfeit: its name, and the field and time it plays on.
function fillerFormHTML(m, team) {
  // Editing a replacement game: the form starts with its team, field and time.
  const edit = !!m.filler;
  // The division's usual fields first; "Other field…" opens the rest, like Add a game.
  const fields = divisionFields(m.div).filter(f => FIELDS[f] && isOpenField(f));
  if (edit && m.field && !fields.includes(m.field)) fields.push(m.field);
  const field = edit && m.field ? m.field : fields[0];
  const times = edit ? editSlots(m, field) : openSlots(field);
  const cur = edit ? toMin(m.time) : null;
  const known = edit && replacementNames(m).includes(m.fillerTeam);
  return `<form class="forfeit-row filler-form" data-form="filler" data-mid="${m.id}" data-league="${m.div}">
    <span class="muted">${esc(team)} ${t('vs')}</span>
    ${replacementSelectHTML(m, false, known ? m.fillerTeam : '')}
    <input class="input" name="name" placeholder="${t('fillerName')}" autocomplete="off" ${edit ? (known ? 'hidden' : `value="${esc(m.fillerTeam)}"`) : ''}>
    <select class="select" name="field" data-change="filler-field" aria-label="${t('field')}">${fields.map(f => `<option value="${f}" ${f === field ? 'selected' : ''}>${esc(FIELDS[f])}</option>`).join('')}${
      fields.length < openFields().length ? `<option value="__other">${t('otherField')}</option>` : ''}</select>
    <select class="select" name="time" data-change="filler-time" aria-label="${t('time')}">${fillerTimeOptions(times, cur)}</select>
    <input class="input" type="time" name="customTime" aria-label="${t('time')}" ${times.length ? 'hidden' : ''}>
    ${edit && (state.teams[m.div] || []).includes(m.fillerTeam) ? `<label class="check-pill filler-counts"><input type="checkbox" name="counts" ${m.fillerCounts ? 'checked' : ''}><span>${esc(t('fillerCountsToo').replace('{t}', m.fillerTeam))}</span></label>` : ''}
    <button class="btn btn-sm btn-gold" type="submit">${t(edit ? 'save' : 'fillerBook')}</button>
    ${edit ? `<button class="btn btn-sm btn-outline" type="button" data-action="filler-open" data-mid="${m.id}">${t('cancel')}</button>` : ''}
    <p class="warn" hidden></p>
    <p class="note">${t('fillerHelp')}</p>
  </form>`;
}
// Names the replacement menu lists for a game (to know whether a replacement typed by hand is in it).
const replacementNames = m => [...hiddenTeams(m.div).map(h => h.team), ...(state.teams[m.div] || []).filter(n => ![m.home, m.away].includes(n) || n === m.fillerTeam)];
// Open times on a field, plus the replacement game's own time when it's on that field.
const editSlots = (m, field) => {
  const own = m.field === field ? [toMin(m.time)] : [];
  return [...new Set([...openSlots(field), ...own])].sort((a, b) => a - b);
};
// Who plays as the replacement: type a new name, a team used as a replacement before, or any league team.
// Whoever it is, only our team's result counts; the replacement team never goes in the standings.
// The list starts with this division's teams; "Show other teams…" opens every division's.
function replacementSelectHTML(m, all = false, cur = '') {
  const busy = [m.home, m.away].filter(n => !(m.filler && n === m.fillerTeam));
  const used = hiddenTeams(m.div).map(h => h.team);
  const opt = n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}</option>`;
  const divs = DIVISIONS.filter(d => (state.teams[d.id] || []).length && (all || d.id === m.div));
  return `<select class="select" name="pick" data-change="filler-pick" aria-label="${t('fillerName')}">
      <option value="__new">${t('typeNewTeam')}</option>
      ${used.length ? `<optgroup label="${t('usedBefore')}">${used.map(opt).join('')}</optgroup>` : ''}
      ${divs.map(d => `<optgroup label="${esc(divName(d.id))}">${[...state.teams[d.id]].filter(n => !(d.id === m.div && busy.includes(n))).sort((a, b) => a.localeCompare(b)).map(opt).join('')}</optgroup>`).join('')}
      ${all ? '' : `<option value="__more">${t('showOtherTeams')}</option>`}
    </select>`;
}
function replacementPickHTML(m) {
  return `${replacementSelectHTML(m)}
    <input class="input" name="name" placeholder="${t('fillerName')}" autocomplete="off">`;
}
// Replacement teams in a division (and Copa-only teams): they play games but never show in the standings.
function hiddenTeams(div) {
  const league = state.teams[div] || [];
  const out = new Map();
  state.matches.filter(m => m.div === div && m.fillerTeam && !league.includes(m.fillerTeam)).forEach(m => {
    const h = out.get(m.fillerTeam) || { team: m.fillerTeam, kind: 'replacement', games: 0 };
    h.games++;
    out.set(m.fillerTeam, h);
  });
  copaExtras(div).forEach(x => { if (!out.has(x)) out.set(x, { team: x, kind: 'copaOnly', games: 0 }); });
  return [...out.values()].sort((a, b) => a.team.localeCompare(b.team));
}

// Times still open on a field that day (from the schedule planner), so a replacement can't double-book it.
const openSlots = field => ((boardDay(ui.boardDate)[ui.boardSection] || {})[field] || []).filter(r => !rowTaken(ui.boardDate, r)).map(r => r.t);
const fillerTimeOptions = (times, cur = null) => `${times.map(x => `<option value="${x}" ${x === cur ? 'selected' : ''}>${fromMin(x)}</option>`).join('')}<option value="__other">${t('otherTime')}</option>`;

function bookFiller(form) {
  const id = +form.dataset.mid;
  const f = findForfeit(id);
  const ed = !f && state.matches.find(x => x.id === id && x.filler);
  if (ed) return editFiller(form, ed);
  const reg = !f && state.matches.find(x => x.id === id && x.forfeitBy);
  if (!f && !reg) return;
  const name = form.pick.value === '__new' ? form.name.value.trim() : form.pick.value;
  if (!name) return form.name.focus();
  const loser = f ? f.w.team : reg.forfeitBy;
  const src = f ? f.m : reg;
  const team = src.home === loser ? src.away : src.home;
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  let start;
  if (form.time.value === '__other') {
    if (!form.customTime.value) return fail(t('pickTime'));
    const [hh, mm] = form.customTime.value.split(':').map(Number);
    start = hh * 60 + mm;
  } else start = +form.time.value;
  // Nothing else on that field at that time (games or friendlies), and our team isn't already playing then.
  const field = form.field.value, div = src.div, date = src.date;
  const len = durationFor(date, groupOf(div), field, div);
  const clash = findConflicts({ date, start, field, div, teams: [team], ignore: reg ? reg.id : undefined });
  const sec = groupOf(div);
  const busyRow = ((boardDay(date)[sec] || {})[field] || []).find(r => !r.mid && rowTaken(date, r)
    && start < r.t + durationFor(date, sec, field, rowDiv(r)) && r.t < start + len);
  if (clash.length) {
    const c = clash[0].m;
    return fail(`${t(clash[0].why === 'field' ? 'conflictField' : 'conflictTeam')} ${divName(c.div)} · ${c.home} ${t('vs')} ${c.away} · ${c.time}`);
  }
  if (busyRow) return fail(`${t('conflictField')} ${t('friendly')} · ${fromMin(busyRow.t)}`);
  let m;
  if (f) {
    m = { id: state.nextId++, div, date, time: fromMin(start), field, home: team, away: name,
      hs: null, as: null, goals: [], fillerTeam: name, filler: { gone: loser, stub: clone(f.m) } };
    f.w.left.splice(f.i, 1);
    state.matches.push(m);
  } else {
    // The same game becomes the replacement game (it can go back to the forfeit later).
    m = reg;
    m.filler = { gone: loser, regular: { home: m.home, away: m.away, forfeitFrom: m.forfeitFrom || null } };
    Object.assign(m, { time: fromMin(start), field, home: team, away: name, fillerTeam: name, hs: null, as: null });
    delete m.forfeitBy; delete m.forfeitFrom;
  }
  ui.fillerFor = null;
  touch(m.div);
  logAction(`${t('fillerBooked')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${team} ${t('vs')} ${name} (${t('insteadOf')} ${loser})`);
  save(); render();
}

// Change a replacement game's team, field or time (the forfeit it replaced stays saved for Back to 3–0).
function editFiller(form, m) {
  const name = form.pick.value === '__new' ? form.name.value.trim() : form.pick.value;
  if (!name) return form.name.focus();
  const team = m.home === m.fillerTeam ? m.away : m.home;
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  if (name === team) return fail(t('fillerSameTeam'));
  let start;
  if (form.time.value === '__other') {
    if (!form.customTime.value) return fail(t('pickTime'));
    const [hh, mm] = form.customTime.value.split(':').map(Number);
    start = hh * 60 + mm;
  } else start = +form.time.value;
  const field = form.field.value, div = m.div, date = m.date, sec = groupOf(div);
  const len = durationFor(date, sec, field, div);
  const clash = findConflicts({ date, start, field, div, teams: [team], ignore: m.id });
  const busyRow = ((boardDay(date)[sec] || {})[field] || []).find(r => !r.mid && rowTaken(date, r)
    && start < r.t + durationFor(date, sec, field, rowDiv(r)) && r.t < start + len);
  if (clash.length) {
    const c = clash[0].m;
    return fail(`${t(clash[0].why === 'field' ? 'conflictField' : 'conflictTeam')} ${divName(c.div)} · ${c.home} ${t('vs')} ${c.away} · ${c.time}`);
  }
  if (busyRow) return fail(`${t('conflictField')} ${t('friendly')} · ${fromMin(busyRow.t)}`);
  const before = `${m.fillerTeam} · ${m.time}`;
  // The planner's slot lets go of the game; the planner puts it back in its (new) place.
  Object.values(boardDay(date)[sec] || {}).forEach(rows => rows.forEach(r => { if (r.mid === m.id) Object.assign(r, { mid: null, home: '', away: '' }); }));
  if (m.home === m.fillerTeam) m.home = name; else m.away = name;
  Object.assign(m, { fillerTeam: name, time: fromMin(start), field });
  // a league team playing as the replacement can have the game count for it too
  const counts = !!(form.counts && form.counts.checked && (state.teams[m.div] || []).includes(name));
  const countsBefore = !!m.fillerCounts;
  if (counts) m.fillerCounts = true; else delete m.fillerCounts;
  ui.fillerFor = null;
  touch(m.div);
  logAction(`${t('fillerEdited')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${team} ${t('vs')} ${name} · ${m.time} (${t('fillerWas')} ${before})${counts !== countsBefore ? ` · ${t(counts ? 'friendlyNowCounts' : 'friendlyNoLongerCounts')} ${name}` : ''}`);
  save(); render();
}

// Where a forfeit lives: the withdrawal it belongs to and its place in that list.
function findForfeit(id) {
  for (const w of Object.values(state.withdrawn || {})) {
    const i = (w.left || []).findIndex(m => m.id === id);
    if (i >= 0) return { w, i, m: w.left[i] };
  }
  return null;
}
const hasGameOn = (div, team, date, skip) => [...state.matches, ...forfeitStubs(div)]
  .some(m => m.id !== skip && m.div === div && m.date === date && (m.home === team || m.away === team));

function addForfeit(form) {
  const div = form.div.value, loser = form.loser.value, winner = form.winner.value, date = ui.boardDate;
  // "Both teams forfeit": each loses 3–0 (a team that withdrew can't be part of one).
  const both = !!(form.both && form.both.checked) && !state.withdrawn[`${div}|${loser}`];
  const warn = form.querySelector('.warn');
  const fail = msg => { warn.textContent = msg; warn.hidden = false; };
  if (!loser || !winner) return fail(t('pickTeams'));
  if (loser === winner) return fail(t('sameTeam'));
  const w = state.withdrawn[`${div}|${loser}`];
  if (w) {
    // A team that withdrew: kept with the withdrawal, like before.
    if (hasGameOn(div, winner, date)) return fail(`${winner} ${t('alreadyPlaysToday')}`);
    w.left = [...(w.left || []), { id: state.nextId++, div, date, time: '12:00 PM', field: '', home: winner, away: loser, hs: null, as: null, left: true }];
  } else {
    // Their game that day, if it's booked, becomes the forfeit (the field frees up); otherwise a new one.
    const booked = state.matches.find(m => m.div === div && m.date === date && !played(m) && !m.forfeitBy
      && ((m.home === winner && m.away === loser) || (m.home === loser && m.away === winner)));
    if (booked) Object.assign(booked, { forfeitBy: both ? BOTH : loser, forfeitFrom: { field: booked.field, time: booked.time }, field: '' });
    else {
      const busy = [winner, loser].find(x => hasGameOn(div, x, date));
      if (busy) return fail(`${busy} ${t('alreadyPlaysToday')}`);
      state.matches.push({ id: state.nextId++, div, date, time: '12:00 PM', field: '', home: winner, away: loser, hs: null, as: null, goals: [], forfeitBy: both ? BOTH : loser });
    }
  }
  ui.forfeitDiv = div;
  ui.forfeitAddOpen = false;
  touch(div);
  logAction(`${t('forfeitAdded')} · ${divName(div)} · ${fmtDate(date)}: ${both ? `${winner} ${t('and')} ${loser} ${t('bothLose30Lower')}` : `${winner} ${t('wins30')} (${loser} ${t('forfeitedWord')})`}`);
  save(); render();
}

// "Game 3" when every division in the section is on the same game, otherwise one per division.
// "Game 3 of 15" next to the date. When divisions are on different games (one group's day was moved),
// one tag per game number with the divisions under it: "Game 3 · U-13 – U-19", "Game 4 · U-5 – U-11".
// Once games are booked, divisions with nothing booked that day (a bye, a moved day) are left out.
function gameNumbersHTML(date, section) {
  const dow = dayOfWeek(date);
  const all = DIVISIONS.filter(d => d.group === section && playsOn(d, date) && (!offFor(d.id, date) || state.matches.some(m => m.div === d.id && m.date === date)));
  const booked = all.filter(d => state.matches.some(m => m.div === d.id && m.date === date));
  const divs = booked.length ? booked : all;
  if (!divs.length) return '';
  const of = (n, total) => (typeof n === 'string' ? n : `${t('game')} ${n} ${t('of')} ${total}`);
  const groups = [];
  divs.forEach(d => {
    const n = playoffDay(d.id, date) || (isTour(d) ? (tournaments().find(x => x.id === d.tournament) || {}).name || t('tournament') : gameNumber(d.id, date)), total = gameColumns(d.id);
    const g = groups.find(x => x.n === n && x.total === total);
    if (g) g.divs.push(d); else groups.push({ n, total, divs: [d] });
  });
  // Everyone on the same game: just the number.
  if (groups.length === 1 && divs.length === all.length) {
    return `<span class="game-tag">${of(groups[0].n, groups[0].total)}</span>`;
  }
  return `<span class="game-tags">${groups.sort((x, y) => x.n - y.n).map(g =>
    `<span class="game-tag stacked"><b>${of(g.n, g.total)}</b><small>${esc(divRuns(section, g.divs))}</small></span>`).join('')}</span>`;
}

// "U-5 – U-11" for youth divisions in a row (with commas between separate runs); adults by name.
function divRuns(section, divs) {
  if (section !== 'youth') return divs.map(d => divName(d.id)).join(', ');
  const order = DIVISIONS.filter(d => d.group === 'youth').map(d => d.id);
  const runs = [];
  divs.map(d => order.indexOf(d.id)).sort((x, y) => x - y).forEach(i => {
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]);
  });
  return runs.map(([x, y]) => (x === y ? divName(order[x]) : `${divName(order[x])} – ${divName(order[y])}`)).join(', ');
}

// ---------- move a day's games to another day (rain, field problems…) ----------

const gamesCount = n => `${n} ${t(n === 1 ? 'gameOne' : 'gameMany')}`;
const unplayedOn = date => state.matches.filter(m => m.date === date && !played(m));
// Divisions the move covers: null means all of them.
const movingDivs = () => (ui.moveDay.mode === 'pick' ? ui.moveDay.divs : null);

function moveDayHTML() {
  const { from, to, push, mode, divs } = ui.moveDay;
  const all = unplayedOn(from);
  const scope = movingDivs();
  const games = scope ? all.filter(m => scope.includes(m.div)) : all;
  const waiting = to && to !== from ? unplayedOn(to).filter(m => !scope || scope.includes(m.div)).length : 0;
  const nice = d => fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' });
  const countOf = id => all.filter(m => m.div === id).length;
  // Every division that plays this weekday (or has a game here), even before games are booked.
  const playsHere = d => playsOn(d, from) || countOf(d.id);
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']]
    .map(([g, label]) => [label, DIVISIONS.filter(d => d.group === g && playsHere(d))]).filter(([, list]) => list.length);
  return `<form class="card move-day" data-form="move-day">
      <h2>${t('moveDayTitle')}</h2>
      <p>${all.length ? t('moveDayCount').replace('{n}', `<b>${gamesCount(all.length)}</b>`).replace('{day}', `<b>${esc(nice(from))}</b>`)
        : `<span class="warn-note">${t('nothingToMove')}</span>`}</p>
      <div class="seg move-mode">
        <button type="button" class="${mode === 'pick' ? '' : 'active'}" data-action="move-mode" data-mode="all">${t('allDivisions')}</button>
        <button type="button" class="${mode === 'pick' ? 'active' : ''}" data-action="move-mode" data-mode="pick">${t('selectDivisions')} <span class="caret">${mode === 'pick' ? '▴' : '▾'}</span></button>
      </div>
      ${mode === 'pick' ? `<div class="move-divs">${groups.map(([label, list]) => `<div>
          <p class="field-label">${t(label)}</p>
          <div class="div-checks">${list.map(d => `<label class="check-pill"><input type="checkbox" name="mdivs" value="${d.id}" data-change="move-day-div" ${divs.includes(d.id) ? 'checked' : ''}><span>${esc(divName(d.id))} <small>(${countOf(d.id)})</small></span></label>`).join('')}</div>
        </div>`).join('')}
        <p class="muted small">${t('movingNow').replace('{n}', gamesCount(games.length))}</p>
      </div>` : ''}
      <label class="field">${t('moveTo')}<select class="select sheet-day-select" name="to" data-change="move-day-to">
        ${moveTargets(from, to).map(d => `<option value="${d}" ${d === to && !ui.moveOther ? 'selected' : ''}>${esc(sheetDayLabel(d, ui.boardSection))}</option>`).join('')}
        <option value="__other" ${ui.moveOther ? 'selected' : ''}>${t('otherDayOption')}</option>
      </select>${ui.moveOther ? `<input class="input other-day" type="date" name="toCustom" value="${to}" min="${addDays(from, 1)}" data-change="move-day-to" aria-label="${t('date')}">` : ''}</label>
      ${waiting ? `<div class="move-choice">
          <p class="warn-note">${t(scope ? 'targetHasGamesDivs' : 'targetHasGames').replace('{n}', gamesCount(waiting)).replace('{day}', esc(nice(to)))}</p>
          <label class="radio-line"><input type="radio" name="push" value="1" ${push !== false ? 'checked' : ''}> <span><b>${t('pushSeason')}</b><small class="muted">${t(scope ? 'pushSeasonHelpDivs' : 'pushSeasonHelp')}</small></span></label>
          <label class="radio-line"><input type="radio" name="push" value="0" ${push === false ? 'checked' : ''}> <span><b>${t('sameDayAnyway')}</b><small class="muted">${t('sameDayAnywayHelp')}</small></span></label>
        </div>` : ''}
      <p class="muted small">${t('moveDayNote')}</p>
      <p class="warn" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" data-action="close-move-day">${t('cancel')}</button>
        <button type="submit" class="btn btn-gold" ${games.length ? '' : 'disabled'}>${t('moveGames')}</button>
      </div>
    </form>`;
}

// Keep what's typed or picked in the move box when it redraws.
// Where a day's games can move: the same weekday for the next couple of months (game-day list like the others).
function moveTargets(from, to) {
  const out = [];
  for (let i = 1; i <= 10; i++) out.push(addDays(from, 7 * i));
  if (to && !out.includes(to)) out.push(to);
  return out.sort();
}

function readMoveForm(form) {
  const push = form.querySelector('[name=push]:checked');
  // "Other day (calendar)…" opens a date box; picking a date there sets the day.
  if (form.toCustom && form.toCustom.value && form.toCustom === document.activeElement) { ui.moveDay.to = form.toCustom.value; ui.moveOther = false; }
  else if (form.to.value === '__other') ui.moveOther = true;
  else { ui.moveDay.to = form.to.value || ui.moveDay.to; ui.moveOther = false; }
  if (push) ui.moveDay.push = push.value !== '0';
  ui.moveDay.divs = [...form.querySelectorAll('[name=mdivs]:checked')].map(i => i.value);
}

// Moves a day's unplayed games (all divisions, or just `divs`) and their schedule slots to another date.
// Games that already have a score stay. Each game goes into the open slot at its time on the new day,
// or gets its own slot; what it leaves behind is an open slot, so the other games keep their times.
function moveDay(from, to, divs) {
  const games = unplayedOn(from).filter(m => !divs || divs.includes(m.div));
  const ids = new Set(games.map(m => m.id));
  const src = (state.matchDays || {})[from];
  if (src) {
    const dest = boardDay(to);
    Object.entries(src).forEach(([sec, fields]) => {
      dest[sec] = dest[sec] || {};
      Object.entries(fields).forEach(([f, rows]) => {
        const target = dest[sec][f] = dest[sec][f] || [];
        if (!divs && !target.length) {
          target.push(...rows.filter(r => !r.mid || ids.has(r.mid)).map(r => ({ ...r })));
          return;
        }
        rows.filter(r => ids.has(r.mid)).forEach(r => {
          const slot = target.find(x => !x.mid && x.t === r.t);
          if (slot) Object.assign(slot, { div: r.div, home: r.home, away: r.away, mid: r.mid });
          else {
            // Open slots it overlaps make room, so the game keeps its time and nothing gets pushed.
            const end = r.t + durationFor(to, sec, f, r.div);
            const clear = x => x.mid || x.t >= end || x.t + durationFor(to, sec, f, x.div) <= r.t;
            target.splice(0, target.length, ...target.filter(clear), { ...r, pinned: true, base: r.t });
          }
          Object.assign(r, { div: divs ? r.div : '', home: '', away: '', mid: null });
        });
        target.sort((a, b) => a.t - b.t);
      });
    });
    if (!divs) delete state.matchDays[from];
  }
  games.forEach(m => { m.date = to; });
  if (!divs) {
    ['gameLengths', 'looseTimes'].forEach(k => {
      if (state[k] && state[k][from]) { state[k][to] = { ...state[k][from], ...(state[k][to] || {}) }; delete state[k][from]; }
    });
  }
}

// "Push the season back": this day and every later one on the same weekday move by the same
// number of days (for the chosen divisions), latest first so nothing lands on a day that hasn't moved yet.
function pushSeason(from, to, divs) {
  const delta = Math.round((new Date(`${to}T12:00`) - new Date(`${from}T12:00`)) / 864e5);
  const dow = dayOfWeek(from);
  const gameDays = state.matches.filter(m => !played(m) && (!divs || divs.includes(m.div))).map(m => m.date);
  const dates = [...new Set([...gameDays, ...(divs ? [] : Object.keys(state.matchDays || {}))])]
    .filter(d => d >= from && dayOfWeek(d) === dow).sort().reverse();
  dates.forEach(d => moveDay(d, addDays(d, delta), divs));
}

function matchDayHTML() {
  if (!ui.boardWeek) ui.boardWeek = nextWeekday('Sun');
  const days = sectionDays(ui.boardSection, ui.boardWeek);
  if (!days.includes(ui.boardDays[ui.boardSection])) ui.boardDays[ui.boardSection] = days[0] ?? 0;
  const offset = ui.boardDays[ui.boardSection];
  ui.boardDate = addDays(ui.boardWeek, offset);
  const count = (date, sec) => state.matches.filter(m => m.date === date && groupOf(m.div) === sec).length;
  const counts = Object.fromEntries(['youth', 'adult', 'futsal'].map(sec =>
    [sec, sectionDays(sec, ui.boardWeek).reduce((n, o) => n + count(addDays(ui.boardWeek, o), sec), 0)]));
  return `
    <div class="seg section-switch">${['youth', 'adult', 'futsal'].map(sec =>
      `<button class="${sec === ui.boardSection ? 'active' : ''} ${sec}" data-action="board-section" data-section="${sec}">${t(SECTION_TITLE[sec] + 'Short')}<span class="count">${counts[sec]}</span></button>`).join('')}</div>
    ${days.length > 1 ? `<div class="seg night-switch ${ui.boardSection}">${days.map(o =>
      `<button class="${o === offset ? 'active' : ''}" data-action="board-day" data-offset="${o}">${esc(fmtDate(addDays(ui.boardWeek, o), { weekday: 'long' }))}</button>`).join('')}</div>` : ''}
    <div class="day-bar">
      <select class="select sheet-day-select board-day-select" data-change="board-date" aria-label="${t('date')}">
        ${sheetDays(ui.boardSection, dayOfWeek(ui.boardDate), ui.boardDate).map(d => `<option value="${d}" ${d === ui.boardDate ? 'selected' : ''}>${esc(sheetDayLabel(d, ui.boardSection))}</option>`).join('')}
        <option value="__other">${t('otherDayOption')}</option>
      </select>
      ${ui.otherDay === 'board-date' ? `<input class="input other-day" type="date" data-change="board-date" value="${ui.boardDate}" aria-label="${t('date')}">` : ''}
      <b class="day-name">${fmtDate(ui.boardDate, { weekday: 'long', month: 'long', day: 'numeric' })}</b>
      ${friendlyDay(ui.boardDate) && !state.matches.some(m => m.date === ui.boardDate) ? '' : gameNumbersHTML(ui.boardDate, ui.boardSection)}
      <label class="strict-toggle friendly-day-toggle" title="${t('friendlyDayHelp')}">
        <input type="checkbox" data-change="friendly-day" ${friendlyDay(ui.boardDate) ? 'checked' : ''}>
        <span class="switch" aria-hidden="true"></span><span>${t('friendlyDay')}</span></label>
      <button type="button" class="btn btn-sm btn-outline move-day-btn" data-action="open-move-day">${t('moveDay')}</button>
      <a class="btn btn-sm btn-gold" href="#/admin/sheet" data-action="board-to-sheet">${t('makeSheet')}</a>
    </div>
    ${ui.moveDay && ui.moveDay.from === ui.boardDate ? moveDayHTML() : ''}
    ${(() => {
      const off = sectionOff(ui.boardDate, ui.boardSection);
      // Games already booked for divisions that are off that day: say so, so they can be moved.
      const stuck = state.matches.filter(m => m.date === ui.boardDate && off.divs.some(d => d.id === m.div)).length;
      // "No Winter 2026 season games: Thanksgiving weekend", then which divisions, then any tournament still on.
      const tourOn = DIVISIONS.filter(d => d.group === ui.boardSection && isTour(d) && playsOn(d, ui.boardDate));
      // One line per season: "No Winter 2026 season games: U-5 – U-19".
      const bySeason = new Map();
      off.divs.forEach(d => bySeason.set(seasonName(d.id), [...(bySeason.get(seasonName(d.id)) || []), d]));
      const which = l => (ui.boardSection === 'youth' ? divRuns('youth', l) : l.map(d => divName(d.id)).join(', '));
      return off.divs.length ? `<div class="off-note">${off.note ? `<b>${esc(off.note)}</b>` : `<b>${t('dayOffShort')}</b>`}
        ${[...bySeason].map(([sn, l]) => `<div>${esc(t('noSeasonGames').replace('{s}', sn))}: <b>${esc(which(l))}</b></div>`).join('')}
        ${tourOn.length ? `<div>${esc(t('tourStillOn').replace('{x}', tourText(tourOn)))}</div>` : ''}${stuck ? `<div><b>${t('stillBooked').replace('{n}', stuck)}</b></div>` : ''}</div>` : '';
    })()}
    ${friendlyDay(ui.boardDate) ? `<p class="friendly-note"><b>${t('friendlyDay')}:</b> ${t('friendlyDayNote')}${state.matches.some(m => m.date === ui.boardDate) ? ` ${t('friendlyDayLeague')}` : ''}</p>` : ''}
    ${(() => {
      const divs = DIVISIONS.filter(d => d.group === ui.boardSection && playsOn(d, ui.boardDate) && hasRotation(d.id));
      return divs.length ? `<div class="rot-toggles"><span class="muted">${t('rotationAuto')}:</span>${divs.map(d => rotationSwitch(d.id, esc(divName(d.id)))).join('')}</div>` : '';
    })()}
    <p class="note">${t('boardHelp')}</p>

    <div class="board-list">${boardListHTML()}</div>
    ${forfeitBoxHTML()}`;
}

// Redraw the board after a change, then move focus to the next box so filling a day is quick.
function redrawBoard(rowId, nextCls) {
  document.querySelector('.board-list').innerHTML = boardListHTML();
  const tr = rowId && document.querySelector(`.board tr[data-row="${rowId}"]`);
  if (!tr) return;
  const next = nextCls === 'next-row'
    ? tr.nextElementSibling && tr.nextElementSibling.querySelector('.b-div:not([disabled])')
    : tr.querySelector(`.${nextCls}:not([disabled])`);
  if (next) next.focus();
}

// ---------- schedule sheet (the printable page for each game day) ----------
// Built from the schedule planner: one block per field with its address, then every time slot with the
// teams, division and referee. Youth, adults and futsal each get their own page.
const SHEET_PLACE_ORDER = ['Bitely ES', 'El Sereno Park', 'Franklin HS', 'Guardia Park', 'Rio de Los Angeles State Park', 'Contreras HS', 'Futsal'];
const shortTime = min => fromMin(min).replace(/\s?(AM|PM)$/i, '');
const sheetDate = date => { const [y, m, d] = date.split('-'); return `${+m}/${+d}/${y.slice(2)}`; };

function sheetFieldTitle(field) {
  const name = FIELDS[field] || field;
  const [place, num] = name.split(' – ');
  const info = PLACE_INFO[placeOf(name)] || { name: placeOf(name) };
  const several = Object.values(FIELDS).filter(n => n.split(' – ')[0] === place).length > 1;
  const n = (num || '').replace(/^Field\s*/i, '');
  return `${place === 'Futsal' ? `Futsal (#${n})` : info.name}${several && place !== 'Futsal' && n ? ` (#${n})` : ''} ${placeAddress(placeOf(name))}`;
}

// "Youth – Jornada #3" or, for adults, one line per division playing that day.
// "Thanksgiving Cup: U-9, U-13" for tournament divisions.
function tourText(divs) {
  const by = new Map();
  divs.forEach(d => { const tour = tournaments().find(x => x.id === d.tournament); const k = tour ? tour.name : t('tournament'); by.set(k, [...(by.get(k) || []), d.short || divName(d.id)]); });
  return [...by].map(([k, l]) => `${k}: ${l.join(', ')}`).join(' · ');
}

function sheetTitles(date, sec) {
  const divs = DIVISIONS.filter(d => d.group === sec && state.matches.some(m => m.div === d.id && m.date === date));
  if (!divs.length) return [friendlyDay(date) ? t('friendlyMany').toUpperCase() : (sec === 'youth' ? 'YOUTH' : '')];
  if (sec === 'youth') {
    // Youth divisions can be on different stages the same Sunday: regular games for some, playoffs for others.
    const post = divs.filter(d => playoffDay(d.id, date));
    const regular = divs.filter(d => !post.includes(d));
    const tours = post.filter(isTour), po = post.filter(d => !isTour(d));
    if (!regular.length && !po.length) return [tourText(tours).toUpperCase()];
    if (!regular.length) return [`YOUTH - ${t('playoffs').toUpperCase()}`, ...(tours.length ? [tourText(tours).toUpperCase()] : [])];
    const counts = {};
    regular.forEach(d => { const n = gameNumber(d.id, date); counts[n] = (counts[n] || 0) + 1; });
    const n = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return [`YOUTH - JORNADA #${n}`, ...(po.length ? [`${t('playoffs').toUpperCase()}: ${divRuns('youth', po).toUpperCase()}`] : []), ...(tours.length ? [tourText(tours).toUpperCase()] : [])];
  }
  // Same order as the league's sheet: Varonil, then Femenil / 40+ on the next line.
  const order = ['varonil', 'femenil', '40'];
  const lines = divs.sort((a, b) => ((order.indexOf(a.id) + 1) || 99) - ((order.indexOf(b.id) + 1) || 99))
    .map(d => `${divName(d.id).toUpperCase()} - ${playoffDay(d.id, date) ? playoffDay(d.id, date).toUpperCase() : `JORNADA #${gameNumber(d.id, date)}`}`);
  return lines.length > 1 ? [lines[0], lines.slice(1).join(' / ')] : lines;
}

// Referees for a field on a game day: a list of { name, times }. The first one with no times picked takes
// every game nobody else has; otherwise each takes the game times picked for them (one ref per game).
function fieldRefs(date, key) {
  const v = ((state.sheetRefs || {})[date] || {})[key];
  if (!v) return [];
  return typeof v === 'string' ? [{ name: v, times: null }] : v;
}
function refCovers(list, i, time) {
  const e = list[i];
  if (e.times) return e.times.includes(time);
  return list.findIndex(x => !x.times) === i && !list.some((x, j) => j !== i && x.times && x.times.includes(time));
}
const refFor = (date, key, time) => {
  const list = fieldRefs(date, key);
  const i = list.findIndex((e, k) => refCovers(list, k, time));
  return i >= 0 ? list[i].name : '';
};
function setFieldRefs(date, key, list) {
  state.sheetRefs = { ...(state.sheetRefs || {}) };
  state.sheetRefs[date] = { ...(state.sheetRefs[date] || {}), [key]: list };
  ui.refsOpen = true;
  save(); render();
}

// Futsal has its own look (the league's futsal sheet): the name centered by the logo, JORNADA #N in red,
// the weekday and date in gold, then each court with its address and HOME | time | AWAY rows. Open time
// slots stay as blank rows, like the paper sheet. No referee.
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function futsalSheetHTML(date, day, fields) {
  const divs = DIVISIONS.filter(d => d.group === 'futsal' && state.matches.some(m => m.div === d.id && m.date === date));
  const numbers = [...new Set(divs.map(d => playoffDay(d.id, date).toUpperCase() || `JORNADA #${gameNumber(d.id, date)}`))];
  const title = numbers.length ? numbers.join(' / ') : friendlyDay(date) ? t('friendlyMany').toUpperCase() : '';
  const court = f => {
    const name = FIELDS[f] || f;
    const n = (name.split(' – ')[1] || '').replace(/^Field\s*/i, '');
    return `${(PLACE_INFO[placeOf(name)] || { name: placeOf(name) }).name} #${n} ${placeAddress(placeOf(name)).replace(/,/g, '')}`;
  };
  return `<article class="sheet-page futsal-sheet">
    <header class="fs-head">
      ${LOGO}
      <div><h2>LA ALHAMBRA SOCCER LEAGUE</h2>
        ${title ? `<p class="fs-jornada">${esc(title)}</p>` : ''}
        <p class="fs-date">${WEEKDAY_EN[dayOfWeek(date)]} ${sheetDate(date)}</p></div>
    </header>
    ${fields.length ? fields.map(f => `<table class="fs-table">
      <colgroup><col class="c-team"><col class="c-gap"><col class="c-time"><col class="c-gap"><col class="c-team"></colgroup>
      <tr class="fs-field"><th colspan="5">${esc(court(f))}</th></tr>
      ${day[f].map(r => (rowTaken(date, r) ? r : { t: r.t })).map(r => `<tr>${sheetCell(date, 'futsal', `${f}|${r.t}|home`, r.home || '')}<td></td>${sheetCell(date, 'futsal', `${f}|${r.t}|time`, shortTime(r.t))}<td></td>${sheetCell(date, 'futsal', `${f}|${r.t}|away`, r.away || '')}</tr>`).join('')}
    </table>`).join('') : `<p class="empty">${t('sheetEmpty')}</p>`}
  </article>`;
}

// A friendly on the sheet shows the division it's played in: the one picked for it, or the division its
// teams are in (in this section first).
function sheetFriendlyDiv(r, sec) {
  const own = [r.fdiv, r.div].find(x => DIVISIONS.some(d => d.id === x));
  if (own) return own;
  const names = [r.home, r.away].filter(Boolean).map(n => n.toLowerCase());
  const has = d => (state.teams[d.id] || []).some(n => names.includes(n.toLowerCase()));
  const d = DIVISIONS.find(x => x.group === sec && has(x)) || DIVISIONS.find(has);
  return d ? d.id : '';
}
// Words typed on the sheet itself (Edit sheet): kept for that day and section, in place of what the
// planner gives. While editing, each box can be typed in; leaving a box saves it.
const sheetEdits = (date, sec) => (((state.sheetEdits || {})[date] || {})[sec] || {});
function sheetCell(date, sec, key, text, tag = 'td', cls = '', attrs = '') {
  const ed = sheetEdits(date, sec), mine = Object.prototype.hasOwnProperty.call(ed, key);
  const on = ui.sheetEdit && ui.sheetLive;
  const c = [cls, on && mine ? 'sheet-edited' : ''].filter(Boolean).join(' ');
  return `<${tag}${c ? ` class="${c}"` : ''} ${attrs}${on ? ` contenteditable="true" spellcheck="false" data-sheet-cell="${esc(key)}" data-def="${esc(text)}"` : ''}>${esc(mine ? ed[key] : text)}</${tag}>`;
}
function saveSheetCell(c) {
  const date = ui.sheetDate, sec = ui.sheetSection || 'youth', key = c.dataset.sheetCell;
  const v = c.textContent.replace(/\s+/g, ' ').trim(), ed = sheetEdits(date, sec);
  const was = Object.prototype.hasOwnProperty.call(ed, key) ? ed[key] : c.dataset.def;
  if (v === was) return;
  const next = { ...ed };
  if (v === c.dataset.def) delete next[key]; else next[key] = v;
  const all = { ...(state.sheetEdits || {}) }, day = { ...(all[date] || {}) };
  if (Object.keys(next).length) day[sec] = next; else delete day[sec];
  if (Object.keys(day).length) all[date] = day; else delete all[date];
  state.sheetEdits = all;
  c.classList.toggle('sheet-edited', v !== c.dataset.def);
  logAction(`${t('scheduleSheet')} · ${fmtDate(date)}: ${was || '—'} → ${v || '—'}`);
  save();
}
document.addEventListener('focusout', e => { const c = e.target.closest && e.target.closest('[data-sheet-cell]'); if (c) saveSheetCell(c); });
document.addEventListener('keydown', e => {
  const c = e.target.closest && e.target.closest('[data-sheet-cell]');
  if (!c) return;
  if (e.key === 'Enter') { e.preventDefault(); c.blur(); }
  if (e.key === 'Escape') { c.textContent = (sheetEdits(ui.sheetDate, ui.sheetSection || 'youth')[c.dataset.sheetCell] ?? c.dataset.def); c.blur(); }
});

function sheetHTML(date, sec) {
  const day = boardDay(date)[sec] || {};
  const refs = ((state.sheetRefs || {})[date] || {});
  const fields = Object.keys(day).filter(f => (day[f] || []).some(r => rowTaken(date, r)))
    .sort((a, b) => {
      // a field that was deleted since keeps its id as its name
      const na = FIELDS[a] || a, nb = FIELDS[b] || b;
      const pa = SHEET_PLACE_ORDER.indexOf(na.split(' – ')[0]), pb = SHEET_PLACE_ORDER.indexOf(nb.split(' – ')[0]);
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || na.localeCompare(nb);
    });
  if (sec === 'futsal') return futsalSheetHTML(date, day, fields);
  const divLabel = (r) => {
    const d = DIVISIONS.find(x => x.id === (isFriendly(date, r) ? sheetFriendlyDiv(r, sec) : r.hold ? r.hold.div : r.div));
    return d ? (isTour(d) ? d.short || divName(d.id) : divName(d.id)).toUpperCase() : '';
  };
  const cell = (key, text, cls = '') => sheetCell(date, sec, key, text, 'td', cls);
  return `<article class="sheet-page">
    <header class="sheet-head">
      <div class="sheet-brand">${LOGO}<span>LA ALHAMBRA<b>SOCCER LEAGUE</b></span></div>
      <div class="sheet-title">${sheetTitles(date, sec).map((x, i) => sheetCell(date, sec, `title|${i}`, x, 'div')).join('')}</div>
      <div class="sheet-date"><b>DATE</b><span>${sheetDate(date)}</span></div>
    </header>
    ${fields.length ? `<table class="sheet-table">
      <colgroup><col class="c-team"><col class="c-time"><col class="c-gap"><col class="c-team"><col class="c-div"><col class="c-ref"></colgroup>
      ${fields.map(f => `<tbody>
        <tr class="sheet-field">${sheetCell(date, sec, `${f}|field`, sheetFieldTitle(f), 'th', '', 'colspan="4"')}<th>DIVISION</th><th>ARBITRO</th></tr>
        ${day[f].filter(r => rowTaken(date, r)).map(r => {
          const taken = true;
          const [h, a] = r.hold ? holdLabels(r) : [r.home || '', r.away || ''];
          const k = `${f}|${r.t}|`;
          return `<tr>${cell(k + 'home', taken ? h : '')}${cell(k + 'time', shortTime(r.t), 't')}<td></td>${cell(k + 'away', taken ? a : '')}
            ${cell(k + 'div', taken ? divLabel(r) : '', 'd')}${cell(k + 'ref', taken ? refFor(date, `${sec}|${f}`, r.t) : '', 'd')}</tr>`;
        }).join('')}
      </tbody>`).join('')}
    </table>` : `<p class="empty">${t('sheetEmpty')}</p>`}
  </article>`;
}

// Pictures and PDFs are made right here, no print window: each page is drawn off screen, turned into a
// picture, and saved as a PNG or put in a letter-size PDF (one page each).
const exportLibs = async () => {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
};
const safeName = x => x.replace(/[\\/:*?"<>|]/g, '-');
// `bg` null = a see-through background (for a table cut out to drop into slides).
// A team name too long for its picture gets smaller text (only that name), so the table stays inside the
// picture's width. Runs on the preview and on the copy drawn for saving.
function fitLongNames(root) {
  const textW = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
  // Standings picture: the team column stays 3 in wide; a longer name gets smaller text to fit in it
  root.querySelectorAll('.table-img td.ti-team').forEach(c => {
    const cs = getComputedStyle(c), room = 288 - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const f0 = parseFloat(cs.fontSize);
    for (let f = f0; textW(c) > room && f > f0 * 0.35; ) { f *= 0.95; c.style.fontSize = `${f}px`; }
  });
  root.querySelectorAll('.table-img table, .export-card .table').forEach(table => {
    const box = table.closest('.table-img') || table.closest('.table-card') || table.parentElement;
    const cs = getComputedStyle(box);
    const room = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const cells = [...table.querySelectorAll('td.ti-team, td.team-cell')];
    if (!cells.length || table.scrollWidth <= room + 0.5) return;
    // the room the name column can have: the picture's width minus every other column
    const colW = Math.max(...cells.map(c => c.getBoundingClientRect().width));
    const avail = Math.max(60, room - (table.scrollWidth - colW) - 2);
    const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
    // In rounds, so every long name is narrowed before any is measured for wrapping (the column is as wide
    // as its widest name).
    const inner = c => avail - (parseFloat(getComputedStyle(c).paddingLeft) || 0) - (parseFloat(getComputedStyle(c).paddingRight) || 0);
    const long = cells.filter(c => textW(c) > inner(c)).map(c => ({ c, f0: parseFloat(getComputedStyle(c).fontSize) }));
    // 1) smaller text on one line, down to about 70%
    long.forEach(x => {
      Object.assign(x.c.style, { width: `${avail}px`, maxWidth: `${avail}px`, whiteSpace: 'nowrap' });
      x.f = x.f0;
      // always on one line: a long name only gets smaller (down to about a third of its size)
      while (textW(x.c) > inner(x.c) && x.f > x.f0 * 0.35) { x.f *= 0.95; x.c.style.fontSize = `${x.f}px`; }
    });
  });
  // Goleadores picture: a player or team name wider than its space gets smaller instead of being cut off
  root.querySelectorAll('.scorer-img .si-who strong, .scorer-img .si-who small').forEach(el => {
    const f0 = parseFloat(getComputedStyle(el).fontSize);
    for (let f = f0; el.scrollWidth > el.clientWidth + 0.5 && f > f0 * 0.5; f *= 0.94) el.style.fontSize = `${f}px`;
  });
}
async function snapPages(html, scale = 2, bg = '#ffffff') {
  const stage = document.createElement('div');
  stage.className = 'export-stage';
  stage.innerHTML = html;
  document.body.appendChild(stage);
  await Promise.all([...stage.querySelectorAll('img')].map(img => (img.complete ? null : new Promise(ok => { img.onload = img.onerror = ok; }))));
  if (document.fonts) await document.fonts.ready;
  fitLongNames(stage);
  const out = [];
  try { for (const el of stage.children) out.push(await html2canvas(el, { scale, backgroundColor: bg, useCORS: true })); }
  finally { stage.remove(); }
  return out;
}
// Files are saved from a blob: link (a data: link stops working past a couple of MB).
const pngBlob = canvas => new Promise(ok => canvas.toBlob(ok, 'image/png'));
// A browser only lets a page save a file a few seconds after a click. Quick saves go straight away; a big
// one (the sharp post pictures, a .zip) shows a Download button when it's ready, and that click saves it.
let exportStart = 0;
function downloadUrl(href, name) {
  if (Date.now() - exportStart < 4000) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  document.querySelector('.dl-ready')?.remove();
  const bar = document.createElement('div');
  bar.className = 'dl-ready';
  bar.innerHTML = `<span>${t('fileReady')}: <b>${esc(name)}</b></span>
    <a class="btn btn-gold" download="${esc(name)}">${t('downloadWord')}</a>
    <button type="button" class="icon-btn" aria-label="${t('close')}">×</button>`;
  bar.querySelector('a').href = href;
  bar.querySelector('a').addEventListener('click', () => setTimeout(() => bar.remove(), 300));
  bar.querySelector('button').addEventListener('click', () => bar.remove());
  document.body.appendChild(bar);
  bar.querySelector('a').focus();
}
async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60000);
}
async function downloadPng(canvas, name) { await downloadBlob(await pngBlob(canvas), name); }
// `margin` in inches: the schedule sheet fills the page, a standings card gets a white border.
function downloadPdf(canvases, name, margin = 0) {
  const pdf = new window.jspdf.jsPDF({ unit: 'in', format: 'letter' });
  canvases.forEach((c, i) => {
    if (i) pdf.addPage();
    const ratio = c.height / c.width;
    const w = Math.min(8.5 - 2 * margin, (11 - 2 * margin) / ratio), h = w * ratio;
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', (8.5 - w) / 2, margin, w, h);
  });
  pdf.save(name);
}
async function exportWith(btn, work) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t(btn.dataset.as === 'png' ? 'makingImage' : 'makingPdf');
  exportStart = Date.now();
  try { await exportLibs(); await work(); } catch (err) { toast(t(btn.dataset.as === 'png' ? 'imageFailed' : 'pdfFailed')); }
  btn.disabled = false; btn.textContent = label;
}
const fileDate = d => sheetDate(d).replace(/\//g, '-');

// Standings / Goleadores as a card to share: the league's logo and name, the division, the season and
// when it was updated, then the table or list.
// Playoffs, the Copa and a tournament division get the same card with their bracket (and Copa groups).
const exportTitle = (what, div) => {
  const d = DIVISIONS.find(x => x.id === div);
  if (what === 'tour') return `${(tournaments().find(x => x.id === d.tournament) || {}).name || t('tournament')} · ${d.short || divName(div)}`;
  return `${t({ standings: 'standings', scorers: 'scorers', playoffs: 'playoffs', copa: 'copa' }[what])} · ${divName(div)} · ${seasonName(div)}`;
};
// The same top as the league's posts, on white: logo and "LA ALHAMBRA / SOCCER LEAGUE" on the left, what
// it is and the season in the middle, the division big on the right.
// Which game a division's standings are through ("Game 2"): the latest game day with a score in (0 = none yet).
function gameThrough(div) {
  const last = state.matches.filter(m => m.div === div && !m.playoff && played(m)).map(m => m.date).sort().pop();
  return last ? gameNumber(div, last) : 0;
}
function exportHeadHTML(what, div) {
  const d = DIVISIONS.find(x => x.id === div) || {};
  const tour = what === 'tour' ? tournaments().find(x => x.id === d.tournament) || {} : null;
  const title = tour ? tour.name || t('tournament') : t({ standings: 'standings', scorers: 'scorers', playoffs: 'playoffs', copa: 'copa' }[what]);
  // "Winter 2026" → "Winter 2026 season"; a name that already says it ("Season 7") stays as it is.
  const sn = seasonName(div);
  const sub = tour ? (tour.dates ? tourWhen(tour) : '') : /season|temporada/i.test(sn) ? sn : t('seasonLine').replace('{s}', sn);
  const label = (tour ? d.short || divName(div) : divName(div)).toUpperCase();
  const game = what === 'standings' || what === 'scorers' ? gameThrough(div) : 0;
  return `<header class="export-head ${what === 'standings' ? 'eh-big' : ''}">${LOGO}<div class="eh-brand"><span>LA ALHAMBRA</span><span>SOCCER LEAGUE</span></div>
    ${what === 'standings' ? '<div class="eh-gap"></div>' : `<div class="eh-center"><b class="${title.length > 14 ? 'long' : ''}">${esc(title.toUpperCase())}</b>${sub ? `<span>${esc(sub.toUpperCase())}</span>` : ''}</div>`}
    <div class="eh-right"><div class="eh-div ${label.length > 9 ? 'long' : label.length > 5 ? 'mid' : ''}">${esc(label)}</div>${game ? `<div class="eh-game">${esc(`${t('game')} ${game}`.toUpperCase())}</div>` : ''}</div></header>`;
}
function exportCardHTML(what, div) {
  const co = copaOf(div);
  const body = what === 'standings' ? standingsTable(div) : what === 'scorers' ? scorerList(div, 5)
    : what === 'playoffs' ? bracketHTML(div, false)
    : `${what === 'tour' && copaChampion(div) && !co.ko ? `<p class="champion">${t('champion')}: <b>${esc(copaChampion(div))}</b></p>` : ''}${copaGroupsHTML(div)}${co && co.ko ? bracketHTML(div, false, 'copa') : ''}`;
  return `<div class="export-card ${what === 'standings' || what === 'scorers' ? what : 'cup'}">
    ${exportHeadHTML(what, div)}
    ${body}
  </div>`;
}
const exportButtons = (what, div = '') => `<div class="export-btns">
  <button type="button" class="btn btn-sm btn-outline" data-action="export-card" data-what="${what}" data-as="png" ${div ? `data-pdiv="${div}"` : ''}>${t('saveImage')}</button>
</div>`;
// A 4×5 picture (2160 × 2700, sharp when zoomed; Instagram shrinks it itself): the whole card fits inside,
// centered on white.
const EXPORT_SCALE = 4;
function fourByFive(c) {
  const out = document.createElement('canvas');
  out.width = 2160; out.height = 2700;
  const g = out.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, out.width, out.height);
  const k = Math.min(out.width / c.width, out.height / c.height);
  const w = c.width * k, h = c.height * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, (out.width - w) / 2, (out.height - h) / 2, w, h);
  return out;
}
// ---------- Standings / Goleadores post (the website's "Save as image") ----------
// 4×5: the division's color background, the league header, and the same table as Admin → Save Image
// (with that division's settings), centered.
const POST_BG = { varonil: 'varonil', femenil: 'femenil', 40: '40' };
const postBg = div => `images/bg/${POST_BG[div] || (groupOf(div) === 'youth' ? 'youth' : groupOf(div) === 'futsal' ? 'futsal' : 'varonil')}.jpg`;
// Two pieces, drawn separately so each can fill the picture: the header (at its usual 760 px design width)
// and the table (at its Save Image size).
const postHeadHTML = (what, div) => `<div class="post-block" style="width:760px">${exportHeadHTML(what, div)}</div>`;
const postTableHTML = (what, div) => `<div class="post-block">${what === 'scorers' ? scorerImageHTML(div) : tableImageHTML(div)}</div>`;
const loadImg = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });
// 2160 × 2700: the background fills it; the header goes across the top part and the table as big as fits
// under it.
async function postCanvas(head, table, bgSrc) {
  const out = document.createElement('canvas');
  out.width = 2160; out.height = 2700;
  const g = out.getContext('2d');
  try {
    const bg = await loadImg(bgSrc);
    const k = Math.max(out.width / bg.width, out.height / bg.height);
    g.drawImage(bg, (out.width - bg.width * k) / 2, (out.height - bg.height * k) / 2, bg.width * k, bg.height * k);
  } catch (e) { g.fillStyle = '#10233f'; g.fillRect(0, 0, out.width, out.height); }
  g.imageSmoothingQuality = 'high';
  // The picture is 4 × 5 inches (540 px an inch): the header starts 0.5 in from the top (not centered),
  // with the same room kept free at the bottom.
  const top = out.height / 10, maxW = out.width * 0.88, maxH = out.height - top * 2, gap = out.height * 0.03;
  const hk = maxW / head.width, hw = head.width * hk, hh = head.height * hk;
  const tk = Math.min(maxW / table.width, (maxH - hh - gap) / table.height), tw = table.width * tk, th = table.height * tk;
  g.drawImage(head, (out.width - hw) / 2, top, hw, hh);
  // a black drop shadow around the table
  g.save();
  Object.assign(g, { shadowColor: 'rgba(0, 0, 0, 0.85)', shadowBlur: 60, shadowOffsetX: 0, shadowOffsetY: 18 });
  g.drawImage(table, (out.width - tw) / 2, top + hh + gap, tw, th);
  g.restore();
  return out;
}
// Saved pictures are named "[Division] [Game #] [Table type]", e.g. "40+ Game 9 Standings.png".
const picName = (div, game, type) => safeName(`${divName(div)}${game ? ` ${t('game')} ${game}` : ''} ${type}`);
function exportCard(btn) {
  const { what, as } = btn.dataset;
  const div = btn.dataset.pdiv || (what === 'scorers' ? scorerDiv(ui.div) : ui.div);
  return exportWith(btn, async () => {
    if (what === 'scoresImg') {
      const date = ui.tiDate;
      const [c] = await snapPages(scoresImageHTML(div, date), EXPORT_SCALE, null);
      return downloadPng(c, `${picName(div, gameNumber(div, date), t('scoresWord'))}.png`);
    }
    if (what === 'table' || what === 'scorerTable') {
      // Just the table, cut out with a see-through background, at its own size.
      const sc = what === 'scorerTable';
      const [c] = await snapPages(sc ? scorerImageHTML(div) : tableImageHTML(div), EXPORT_SCALE, null);
      return downloadPng(c, `${picName(div, gameThrough(div), t(sc ? 'scorers' : 'standings'))}.png`);
    }
    if (what === 'standings' || what === 'scorers') {
      const [head] = await snapPages(postHeadHTML(what, div), EXPORT_SCALE, null);
      const [table] = await snapPages(postTableHTML(what, div), EXPORT_SCALE, null);
      return downloadPng(await postCanvas(head, table, postBg(div)), `${picName(div, gameThrough(div), t(what))}.png`);
    }
    const [c] = await snapPages(exportCardHTML(what, div), EXPORT_SCALE);
    // "U-11 Game 2 Standings", "U-11 Game 2 Goleadores"; cups: "U-11 Playoffs", a tournament by its own title.
    const name = what === 'standings' || what === 'scorers' ? picName(div, gameThrough(div), t(what))
      : what === 'tour' ? safeName(exportTitle(what, div).replace(/ · /g, ' '))
      : picName(div, 0, t(what === 'copa' ? 'copa' : 'playoffs'));
    if (as === 'png') downloadPng(fourByFive(c), `${name}.png`); else downloadPdf([c], `${name}.pdf`, 0.5);
  });
}

// The schedule sheet: this page as a picture, or the whole day (youth and adults) in one PDF.
function sheetExport(btn) {
  const date = ui.sheetDate || ui.boardDate, sec = ui.sheetSection || 'youth';
  const secs = btn.dataset.whole ? ['youth', 'adult'].filter(x => sheetHasGames(date, x)) : [sec];
  return exportWith(btn, async () => {
    const pages = await snapPages(secs.map(x => sheetHTML(date, x).replace('class="sheet-page', 'class="sheet-page capturing')).join(''));
    const label = secs.length > 1 ? t('wholeDayShort') : t(SECTION_TITLE[sec] + 'Short');
    const name = `Alhambra schedule ${label} ${fileDate(date)}`;
    if (btn.dataset.as === 'png') downloadPng(pages[0], `${name}.png`); else downloadPdf(pages, `${name}.pdf`);
  });
}
const sheetHasGames = (date, sec) => Object.values(boardDay(date)[sec] || {}).some(rows => rows.some(r => rowTaken(date, r)));

// "Save as PDF" makes the file right here (a picture of the letter page in a PDF), no print window.
const loadScript = src => (document.querySelector(`script[src="${src}"]`) ? Promise.resolve()
  : new Promise((ok, fail) => { const tag = document.createElement('script'); tag.src = src; tag.onload = ok; tag.onerror = fail; document.head.appendChild(tag); }));
async function saveSheetPdf(btn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t('makingPdf');
  try {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const page = document.querySelector('.sheet-page');
    const zoom = page.style.zoom;
    page.style.zoom = ''; page.classList.add('capturing');
    const canvas = await html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    page.style.zoom = zoom; page.classList.remove('capturing');
    const pdf = new window.jspdf.jsPDF({ unit: 'in', format: 'letter' });
    const ratio = canvas.height / canvas.width;
    const w = Math.min(8.5, 11 / ratio), h = w * ratio;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (8.5 - w) / 2, 0, w, h);
    const date = ui.sheetDate || ui.boardDate, sec = ui.sheetSection || 'youth';
    pdf.save(`Alhambra schedule ${t(SECTION_TITLE[sec] + 'Short')} ${sheetDate(date).replace(/\//g, '-')}.pdf`);
  } catch (err) {
    toast(t('pdfFailed'));
  }
  btn.disabled = false; btn.textContent = label;
}

// The days a section plays come from its divisions (Sunday for youth and adults, Wednesday and Thursday
// for futsal, plus any day an added league plays). This snaps a date to one of them in the same week.
function sheetDayFor(date, sec, dow) {
  const days = sectionDays(sec, sundayOf(date));
  if (!days.length) return sundayOf(date);
  const want = days.includes(dow) ? dow : days.includes(dayOfWeek(date)) ? dayOfWeek(date) : days[0];
  return addDays(sundayOf(date), want);
}

// The game days to pick from, on this section's day: every week from the season's first game to one week
// past the last day with anything booked, so the list stays short instead of a tiny calendar.
const WEEKDAY_NAME = dw => fmtDate(addDays('2026-11-01', dw), { weekday: 'long' });
function sheetDays(sec, dow, current = ui.sheetDate) {
  const pick = d => sheetDayFor(d, sec, dow);
  // Days with something on them: league games, or friendlies on the planner.
  const booked = [...state.matches.filter(m => groupOf(m.div) === sec).map(m => m.date),
    ...Object.keys(state.matchDays || {}).filter(d => friendliesOn(d, sec) > 0)].filter(d => pick(d) === d).sort();
  const upcoming = pick(todayISO()) < todayISO() ? addDays(pick(todayISO()), 7) : pick(todayISO());
  // From the first game of the season (or this week if there's none) to one week past whatever is booked last.
  const from = booked[0] && booked[0] < upcoming ? booked[0] : upcoming;
  const to = addDays([booked[booked.length - 1] || upcoming, upcoming].sort().pop(), 7);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 7)) out.push(d);
  if (current && !out.includes(current)) out.push(current);
  return out.sort();
}
// "Game 3" (adults name each division: "Varonil Game 3 · 40+ Game 10"), "Friendlies day", or, for a week with
// nothing, "No games (didn't play)" once it's past and "Nothing booked yet" before.
function sheetDayLabel(d, sec) {
  const order = ['varonil', 'femenil', '40'];
  const divs = DIVISIONS.filter(x => x.group === sec && state.matches.some(m => m.div === x.id && m.date === d))
    .sort((a, b) => ((order.indexOf(a.id) + 1) || 99) - ((order.indexOf(b.id) + 1) || 99));
  const nums = divs.map(x => [x, playoffDay(x.id, d) || gameNumber(x.id, d)]);
  const same = new Set(nums.map(([, n]) => n)).size === 1;
  const friendlies = friendliesOn(d, sec) > 0 || friendlyDay(d);
  let what;
  if (nums.length && sec !== 'adult' && (same || sec === 'youth')) {
    // youth: the game most divisions are on (like the sheet's title), then any divisions in the playoffs
    const reg = nums.filter(([, n]) => typeof n === 'number'), post = nums.filter(([, n]) => typeof n !== 'number');
    const counts = {};
    reg.forEach(([, n]) => { counts[n] = (counts[n] || 0) + 1; });
    const top = reg.length ? `${t('game')} ${Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0]}` : '';
    // Playoff divisions by age range; tournament divisions under the tournament's name.
    const po = post.filter(([x]) => !isTour(x)), tr = post.filter(([x]) => isTour(x));
    const postText = [po.length ? (sec === 'youth' ? `${t('playoffs')}: ${divRuns('youth', po.map(([x]) => x))}` : po[0][1]) : '', tourText(tr.map(([x]) => x))].filter(Boolean).join(' · ');
    what = [top, postText].filter(Boolean).join(' · ');
  } else if (nums.length) what = nums.map(([x, n]) => `${divName(x.id)} ${typeof n === 'string' ? n : `${t('game')} ${n}`}`).join(' · ');
  const tourToday = DIVISIONS.filter(x => x.group === sec && isTour(x) && playsOn(x, d) && !divs.includes(x));
  if (tourToday.length) what = [what, tourText(tourToday)].filter(Boolean).join(' · ');
  if (friendlies) what = what ? `${what} + ${t('friendlyMany')}` : t('friendlyDay');
  const off = sectionOff(d, sec);
  if (!what && off.all) what = `${t('dayOffShort')}${off.note ? ` — ${off.note}` : ''}`;
  else if (off.divs.length && !off.all) {
    // Every league division off (a tournament day on a holiday): just "league off"; otherwise list them.
    const league = DIVISIONS.filter(x => x.group === sec && !isTour(x) && playsOn(x, d));
    const allLeague = league.length && league.every(x => off.divs.includes(x));
    what = `${what || t('nothingBookedYet')} · ${allLeague ? `${t('leagueOff')}${off.note ? ` (${off.note})` : ''}` : `${t('offWord')}: ${off.divs.map(x => divName(x.id)).join(', ')}`}`;
  }
  if (!what) what = d < todayISO() ? t('noGamesPlayed') : t('nothingBookedYet');
  const thisWeek = d === sheetDayFor(todayISO(), sec, dayOfWeek(d));
  return `${fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} — ${what}${thisWeek ? ` · ${t('thisWeek')}` : ''}`;
}

// ---------- Admin → Standings table (just the table, as a picture for slides) ----------
// The size and columns are set here and kept for every week; the picture has a see-through background.
const TABLE_COLS = [['rank', '#'], ['logo', 'logoCol'], ['p', 'played'], ['w', 'won'], ['d', 'drawn'], ['l', 'lost'], ['gf', 'gf'], ['ga', 'ga'], ['gd', 'gd'], ['pts', 'pts'], ['form', 'form']];
// The titles row's fill and text colors, and a thin empty row at the bottom
// in the titles row's color (like a row with 0.3 pt text in a spreadsheet).
const IMG_LOOK = { headFill: '#faf8f2', headColor: '#000000', bottomRow: true, bottomHeight: 4, font: 'Inter', bold: false };
// Fonts the pictures can use (loaded in index.html, or on every computer).
const IMG_FONTS = ['Inter', 'Oswald', 'Montserrat', 'Roboto', 'Roboto Condensed', 'Rajdhani', 'Bebas Neue', 'Bangers', 'Arial', 'Georgia'];
const imgFontCSS = o => `font-family:'${IMG_FONTS.includes(o.font) ? o.font : 'Inter'}', system-ui, sans-serif;`;
// The titles row has its own font (Bangers unless another is picked).
const imgHeadFont = o => `--hfont:'${IMG_FONTS.includes(o.headFont) ? o.headFont : 'Bangers'}';${o.headFontSize > 0 ? `--hfsize:${o.headFontSize}px;` : ''}`;
// headHeight 0 = the titles row sizes itself; spaceBelow = empty space under the table inside the picture.
const TABLE_DEFAULTS = { unit: 'in', autoFit: true, width: 760, height: 0, rowHeight: 36, fontSize: 14, logoSize: 26, headerRow: true, headHeight: 0, spaceBelow: 0, formCount: 5, ...IMG_LOOK, cols: ['rank', 'logo', 'p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts'] };
// The Goleadores picture works the same way, with how many players show and each column's width (0 = auto).
// Its rows look like the Goleadores list on the site: rank, the player with their team and logo under the
// name, the bar, and the goals.
const SCORER_COLS = [['rank', '#'], ['team', 'team'], ['logo', 'logoCol'], ['bar', 'progressBar']];
const SCORER_IMG_DEFAULTS = { unit: 'in', autoFit: true, width: 640, height: 0, rowHeight: 64, fontSize: 16, logoSize: 20, headerRow: true, headHeight: 0, spaceBelow: 0, count: 5,
  ...IMG_LOOK, colWidths: { rank: 0, name: 0, goals: 0 }, cols: ['rank', 'team', 'logo', 'bar'] };
const SCORER_GAP = 6;
// The week's scores picture: each game as logo · score · vs · score · logo. Up to 6 games in one column;
// more go in two even columns, with an odd last game centered under them. The score boxes' color is set here.
// Each game's row has its own width and height; the picture is one or two rows wide.
const SCORES_IMG_DEFAULTS = { unit: 'in', rowWidth: 640, rowHeight: 130, logoPct: 84, scoreFill: '#8b2a12', scoreColor: '#ffffff' };
const imgKey = kind => ({ scorers: 'scorerImage', scores: 'scoresImage' }[kind] || 'tableImage');
// Each division keeps its own picture settings (state.tableImageByDiv[div]…); a division not set yet starts
// from the settings used before divisions had their own, then the defaults.
const imgDefaults = kind => (kind === 'scorers' ? SCORER_IMG_DEFAULTS : kind === 'scores' ? SCORES_IMG_DEFAULTS : TABLE_DEFAULTS);
const imgSet = (kind = 'standings', div = ui.adminDiv) => {
  const d = imgDefaults(kind), o = { ...(state[imgKey(kind)] || {}), ...((state[`${imgKey(kind)}ByDiv`] || {})[div] || {}) };
  return { ...d, ...o, ...(d.colWidths ? { colWidths: { ...d.colWidths, ...(o.colWidths || {}) } } : {}) };
};
const tableSet = div => imgSet('standings', div);
function setImg(kind, o, div = ui.adminDiv) {
  const key = `${imgKey(kind)}ByDiv`;
  state[key] = { ...(state[key] || {}), [div]: o };
  save();
}
const imgLookVars = (o, used) => `--hfill:${o.headFill};--hcolor:${o.headColor};--bottom:${used.botH}px;${imgFontCSS(o)}${imgHeadFont(o)}`;
const scorerImgRows = div => topScorers(leaders(div), imgSet('scorers', div).count);
// With Auto-fit on, a set Height decides the rows (and logos/text shrink to fit); with it off your sizes
// stay as typed and the picture is still the Height tall (see-through under the table, or cut if longer).
function tableUsed(div, kind = 'standings') {
  const sc = kind === 'scorers';
  const o = imgSet(kind, div), n = (sc ? scorerImgRows(div) : shownStandings(div)).length, fit = o.height > 0 && o.autoFit;
  const headH = o.headerRow ? (o.headHeight > 0 ? o.headHeight : Math.round(o.fontSize * 2.3)) : 0;
  const botH = o.bottomRow ? o.bottomHeight : 0;
  // the Goleadores rows are separate boxes with a little space between them (and the titles and bottom rows)
  const extra = sc ? SCORER_GAP * Math.max(0, n - 1 + (o.headerRow ? 1 : 0) + (o.bottomRow ? 1 : 0)) : 2;
  const rowH = fit && n ? Math.max(12, (o.height - headH - botH - extra - o.spaceBelow) / n) : o.rowHeight;
  return { headH, rowH, botH, fit, natural: headH + n * o.rowHeight + botH + extra + o.spaceBelow,
    logo: fit ? Math.max(8, Math.min(o.logoSize, sc ? Math.floor(rowH * 0.34) : rowH - 6)) : o.logoSize,
    font: fit ? Math.max(8, Math.min(o.fontSize, Math.floor(rowH * (sc ? 0.3 : 0.62)))) : o.fontSize };
}
// The W/D/L boxes on the picture follow the text size, but never take more than about 60% of a row's
// height (so short rows don't get crowded) and leave room for the underline.
const formChip = (font, rowH) => Math.max(6, Math.round(Math.min(font * 1.05, rowH * 0.6) * 10) / 10);
function tableImageHTML(div) {
  const o = tableSet(div), on = k => o.cols.includes(k);
  const rows = shownStandings(div);
  const used = tableUsed(div);
  const head = k => ({ rank: '#', logo: '', p: t('imgPlayed'), w: t('won'), d: t('drawn'), l: t('lost'), gf: t('gf'), ga: t('ga'), gd: t('gd'), pts: t('imgPts'), form: t('form') }[k]);
  const stats = ['p', 'w', 'd', 'l', 'gf', 'ga', 'gd', 'pts', 'form'].filter(on);
  // Form on the picture: the latest game first (left), then the ones before it
  const val = (r, k) => (k === 'gd' ? `${r.gd}` : k === 'form' ? formChips(r.form.slice(-o.formCount).reverse()) : r[k]);
  // A height picked for the whole table: the rows share it (the titles row keeps its size), and logos and
  // text get smaller if the rows are too thin for them.
  const { headH, rowH } = used;
  const fixed = o.height > 0 ? `height:${o.height}px;` : '';
  const ncols = (on('rank') ? 1 : 0) + (on('logo') ? 1 : 0) + 1 + stats.length;
  return `<div class="table-img ${fixed ? 'fixed' : ''} ${used.fit ? 'fit' : ''} ${o.bold ? 'bold' : ''}" style="width:${o.width}px;${fixed}padding-bottom:${o.spaceBelow}px;font-size:${used.font}px;--row:${rowH}px;--head:${headH}px;--logo:${used.logo}px;--chip:${formChip(used.font, rowH)}px;--formw:${Math.round(formChip(used.font, rowH) * (o.formCount + (o.formCount - 1) * 0.14))}px;${imgLookVars(o, used)}">
    <table class="ti-cols">
      <colgroup>${on('rank') ? '<col class="c-rank">' : ''}${on('logo') ? '<col class="c-logo">' : ''}<col class="c-team">${stats.map(k => `<col class="${k === 'form' ? 'c-form' : 'c-stat'}">`).join('')}</colgroup>
      ${o.headerRow ? `<thead><tr>${on('rank') ? `<th class="ti-rank">#</th>` : ''}<th class="ti-team" colspan="${on('logo') ? 2 : 1}">${t('team')}</th>${stats.map(k => `<th class="${k === 'form' ? 'ti-form' : ''}">${head(k)}</th>`).join('')}</tr></thead>` : ''}
      <tbody>${rows.map((r, i) => `<tr class="${['top', 'second', 'third'][i] || ''}">
        ${on('rank') ? `<td class="ti-rank">${i + 1}</td>` : ''}${on('logo') ? `<td class="ti-logo">${teamLogo(r.team, div) ? `<img src="${teamLogo(r.team, div)}" alt="">` : ''}</td>` : ''}
        <td class="ti-team">${esc(r.team)}</td>${stats.map(k => `<td class="${k === 'pts' ? 'ti-pts' : k === 'form' ? 'ti-form' : ''}">${val(r, k)}</td>`).join('')}
      </tr>`).join('')}</tbody>
      ${o.bottomRow ? `<tfoot><tr><td class="ti-bottom" colspan="${ncols}"></td></tr></tfoot>` : ''}
    </table></div>`;
}
// The Goleadores picture: rank, player, team (with logo) and goals, like the standings picture.
function scorerImageHTML(div) {
  const o = imgSet('scorers', div), on = k => o.cols.includes(k), w = o.colWidths;
  const rows = scorerImgRows(div), all = leaders(div), max = all[0] ? all[0].goals : 1;
  const used = tableUsed(div, 'scorers');
  const fixed = o.height > 0 ? `height:${o.height}px;` : '';
  // columns: rank · player · goals (a typed width wins; otherwise the player takes the room)
  const grid = `${on('rank') ? `${w.rank > 0 ? `${w.rank}px` : '2.4em'} ` : ''}${w.name > 0 ? `${w.name}px` : 'minmax(0,1fr)'} ${w.goals > 0 ? `${w.goals}px` : w.name > 0 ? '1fr' : 'auto'}`;
  return `<div class="table-img scorer-img ${fixed ? 'fixed' : ''} ${used.fit ? 'fit' : ''} ${o.bold ? 'bold' : ''}" style="width:${o.width}px;${fixed}padding-bottom:${o.spaceBelow}px;font-size:${used.font}px;--row:${used.rowH}px;--head:${used.headH}px;--logo:${used.logo}px;--gap:${SCORER_GAP}px;--grid:${grid};${imgLookVars(o, used)}">
    ${o.headerRow ? `<div class="si-head">${on('rank') ? '<span class="si-rank">#</span>' : ''}<span>${t('player')}</span><span class="si-goals">${t('goalsWord')}</span></div>` : ''}
    ${rows.map((sc, i) => {
      const r = i + 1, logo = on('logo') && teamLogo(sc.team, div);
      return `<div class="si-row ${r <= 3 ? `si-p${r}` : ''}">
        ${on('rank') ? `<span class="si-rank"><b>${r}</b></span>` : ''}
        <span class="si-who"><strong>${esc(sc.name)}</strong>${on('team') ? `<small>${logo ? `<img src="${logo}" alt="">` : ''}${esc(sc.team)}</small>` : ''}${on('bar') ? `<span class="si-bar"><span style="width:${Math.round(sc.goals / max * 100)}%"></span></span>` : ''}</span>
        <span class="si-goals">${sc.goals}</span></div>`;
    }).join('')}
    ${o.bottomRow ? '<div class="si-bottom"></div>' : ''}</div>`;
}
// Game days in a division that have at least one result, newest first.
function scoreDays(div) {
  const all = [...state.matches, ...forfeitStubs(div)].filter(m => m.div === div && !m.fromFriendly && resultOf(m));
  return [...new Set(all.map(m => m.date))].sort().reverse();
}
const scoreDayGames = (div, date) => [...state.matches, ...forfeitStubs(div)]
  .filter(m => m.div === div && m.date === date && !m.fromFriendly && resultOf(m)).sort(byDateTime);
function scoresImageHTML(div, date) {
  const o = imgSet('scores', div), games = scoreDayGames(div, date);
  const two = games.length > 6;
  // a row is logo 1 · score .92 · vs 1.02 · score .92 · logo 1; text and gaps follow the row's size
  const colW = o.rowWidth, H = o.rowHeight;
  const S = Math.min(H, colW / 4.86);
  const colGap = two ? Math.round(H * 0.3) : 0;
  const width = two ? colW * 2 + colGap : colW;
  const box = (team) => { const logo = teamLogo(team, div); return `<span class="sx-logo">${logo ? `<img src="${logo}" alt="">` : `<b>${esc(team)}</b>`}</span>`; };
  const row = m => {
    const r = resultOf(m), dbl = r.double;
    return `<div class="sx-row">${box(m.home)}<span class="sx-num">${dbl ? 'L' : r.hs}</span><span class="sx-vs">vs</span><span class="sx-num">${dbl ? 'L' : r.as}</span>${box(m.away)}</div>`;
  };
  const half = Math.floor(games.length / 2);
  const body = !two ? `<div class="sx-col">${games.map(row).join('')}</div>`
    : `<div class="sx-cols"><div class="sx-col">${games.slice(0, half).map(row).join('')}</div><div class="sx-col">${games.slice(half, half * 2).map(row).join('')}</div></div>
       ${games.length % 2 ? `<div class="sx-last">${row(games[games.length - 1])}</div>` : ''}`;
  return `<div class="scores-img ${two ? 'two' : ''}" style="width:${width}px;--s:${S}px;--h:${H}px;--lp:${Math.max(20, Math.min(100, o.logoPct || 84))}%;--colw:${colW}px;--colgap:${colGap}px;--fill:${o.scoreFill};--num:${o.scoreColor}">
    ${games.length ? body : `<p class="sx-none">${t('noScoresThatDay')}</p>`}</div>`;
}
const tiSizeText = o => {
  const f = px => (o.unit === 'in' ? `${+(px / 96).toFixed(2)} in` : `${px} px`);
  return `${t('ti_preview')}: ${f(o.width)} × ${o.height > 0 ? f(o.height) : t('ti_auto')} · ${t('ti_saved4x')}`;
};
// The preview can be zoomed (only on screen; the saved picture keeps its real size). "Fit" shows it whole.
const TI_ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
const tiPreview = html => `<div class="ti-zoom" role="group" aria-label="${t('zoom')}">
    <button type="button" class="btn btn-sm btn-outline" data-action="ti-zoom" data-z="out" aria-label="${t('zoomOut')}">−</button>
    <span class="ti-zoom-val"></span>
    <button type="button" class="btn btn-sm btn-outline" data-action="ti-zoom" data-z="in" aria-label="${t('zoomIn')}">+</button>
    <button type="button" class="btn btn-sm ${(ui.tiZoom || 'fit') === 'fit' ? 'btn-gold' : 'btn-outline'}" data-action="ti-zoom" data-z="fit">${t('zoomFit')}</button>
    <button type="button" class="btn btn-sm ${ui.tiZoom === 1 ? 'btn-gold' : 'btn-outline'}" data-action="ti-zoom" data-z="1">100%</button>
  </div>
  <div class="ti-preview"><div class="ti-zoomed">${html}</div></div>`;
function fitTiPreview() {
  const box = document.querySelector('.ti-preview'), inner = box && box.querySelector('.ti-zoomed');
  if (!inner) return;
  inner.style.zoom = 1;
  fitLongNames(inner);
  const pic = inner.firstElementChild;
  const room = box.clientWidth - 28; // the preview's padding
  const fit = pic && pic.offsetWidth ? Math.min(1, room / pic.offsetWidth) : 1;
  const z = ui.tiZoom === undefined || ui.tiZoom === 'fit' ? fit : ui.tiZoom;
  inner.style.zoom = z;
  ui.tiZoomNow = z;
  document.querySelector('.ti-zoom-val').textContent = `${Math.round(z * 100)}%`;
}
window.addEventListener('resize', () => { if (document.querySelector('.ti-preview')) fitTiPreview(); });
const tiKindNow = () => (['scorers', 'scores'].includes(ui.tiKind) ? ui.tiKind : 'standings');
const TI_KINDS = [['standings', 'standings'], ['scorers', 'scorers'], ['scores', 'weeklyScores']];
const hexField = (o, k) => `<label class="field">${t(`ti_${k}`)}<span class="hex-input"><span class="hex-swatch" style="background:${esc(o[k])}"></span>
  <input class="input" type="text" value="${esc(o[k].toUpperCase())}" data-change="ti-color" data-k="${k}" maxlength="7" spellcheck="false" autocapitalize="characters" placeholder="#000000"></span></label>`;
function pageScoresImage() {
  const div = ui.adminDiv, o = imgSet('scores', div), days = scoreDays(div);
  if (!days.includes(ui.tiDate)) ui.tiDate = days[0];
  const date = ui.tiDate, n = date ? scoreDayGames(div, date).length : 0;
  const inch = o.unit === 'in', show = px => (inch ? +(px / 96).toFixed(2) : Math.round(px));
  return adminShell('admin/table', `
    <h1 class="page-title">${t('tableImage')}</h1>
    <div class="seg ti-kind">${TI_KINDS.map(([k, l]) => `<button type="button" class="${k === 'scores' ? 'active' : ''}" data-action="ti-kind" data-kind="${k}">${t(l)}</button>`).join('')}</div>
    <p class="note">${t('scoresImageHelp')}</p>
    <div class="toolbar">${divPills(div, 'data-admin-div')}</div>
    <div class="card ti-settings">
      <div class="seg ti-unit">${['in', 'px'].map(u => `<button type="button" class="${o.unit === u ? 'active' : ''}" data-action="ti-unit" data-unit="${u}">${t(u === 'in' ? 'ti_inches' : 'ti_pixels')}</button>`).join('')}</div>
      <div class="league-grid">
        <label class="field">${t('gameDay')}<select class="select" data-change="ti-date">${days.map(d => `<option value="${d}" ${d === date ? 'selected' : ''}>${t('game')} ${gameNumber(div, d)} · ${esc(fmtDate(d))}</option>`).join('') || `<option>${t('noScoresYet')}</option>`}</select></label>
        ${[['rowWidth', 200, 1600], ['rowHeight', 20, 400]].map(([k, lo, hi]) => `<label class="field">${t(`ti_${k}`)}<span class="len-input"><input class="input" type="number" min="${inch ? 0 : lo}" max="${inch ? +(hi / 96).toFixed(2) : hi}" step="${inch ? 0.01 : 1}" value="${show(o[k])}" data-change="ti-set" data-k="${k}" data-unit="${o.unit}"> ${inch ? 'in' : 'px'}</span></label>`).join('')}
        <label class="field">${t('ti_logoPct')}<span class="len-input"><input class="input" type="number" min="20" max="100" step="1" value="${o.logoPct || 84}" data-change="ti-pct" data-k="logoPct"> %</span></label>
        ${hexField(o, 'scoreFill')}${hexField(o, 'scoreColor')}
      </div>
      <p class="note">${t('ti_perDiv').replace('{div}', divName(div)).replace(/^./, x => x.toUpperCase())}. ${t(n > 6 ? 'scoresTwoCols' : 'scoresOneCol').replace('{n}', n)} · ${t('ti_preview')}: ${(px => (inch ? `${+(px / 96).toFixed(2)} in` : `${Math.round(px)} px`))(n > 6 ? o.rowWidth * 2 + Math.round(o.rowHeight * 0.3) : o.rowWidth)} ${t('wideWord')}</p>
      <div class="row-actions">
        <button type="button" class="btn btn-gold" data-action="export-card" data-what="scoresImg" data-as="png" data-pdiv="${div}" ${n ? '' : 'disabled'}>${t('saveScoresImage')}</button>
        <button type="button" class="btn btn-outline" data-action="ti-reset">${t('backToDefault')}</button>
      </div>
    </div>
    ${tiPreview(date ? scoresImageHTML(div, date) : empty(t('noScoresYet')))}`);
}
function pageAdminTable() {
  if (ui.tiKind === 'scores') return pageScoresImage();
  const kind = ui.tiKind === 'scorers' ? 'scorers' : 'standings';
  if (kind === 'scorers') ui.adminDiv = scorerDiv(ui.adminDiv);
  const div = ui.adminDiv, o = imgSet(kind, div);
  const used = tableUsed(div, kind);
  const usedOf = { rowHeight: Math.round(used.rowH), logoSize: Math.round(used.logo), fontSize: used.font };
  // Every size can be typed in inches, like Google Slides shows a box's size (1 inch = 96 px), or in pixels.
  const inch = o.unit === 'in';
  const show = px => (inch ? +(px / 96).toFixed(2) : Math.round(px));
  const unit = inch ? 'in' : 'px';
  // Font size on the inches side is in points, like Google Slides (1 pt = 1/72 inch); the picture keeps
  // that size when it's dropped into a box of the Width × Height.
  const num = (k, lo, hi) => {
    const pt = inch && k === 'fontSize';
    const u = pt ? 'pt' : unit, sh = px => (pt ? +(px * 0.75).toFixed(1) : show(px));
    const auto = used.fit && k === 'rowHeight', smaller = used.fit && usedOf[k] !== undefined && usedOf[k] < o[k];
    return `<label class="field">${t(`ti_${k}`)}<span class="len-input"><input class="input" type="number" min="${pt ? 6 : inch ? 0 : lo}" max="${pt ? hi * 0.75 : inch ? +(hi / 96).toFixed(2) : hi}" step="${pt ? 0.5 : inch ? 0.01 : 1}"
      value="${sh(auto ? usedOf[k] : o[k])}" data-change="ti-set" data-k="${k}" data-unit="${pt ? 'pt' : o.unit}" ${auto ? 'disabled' : ''}> ${u}</span>
      ${auto ? `<small class="ti-used">${t('ti_setByHeight')}</small>` : smaller ? `<small class="ti-used">${t('ti_usingSmaller').replace('{n}', `${sh(usedOf[k])} ${u}`)}</small>` : ''}</label>`;
  };
  // Sizes where 0 means automatic (titles row) or none (space below), and each column's width.
  const opt = (k, lo, hi, zeroKey, val = o[k], data = `data-k="${k}"`) => `<label class="field">${t(`ti_${k.startsWith('col:') ? 'colWidth' : k}`).replace('{c}', k.startsWith('col:') ? t({ rank: 'rankCol', name: 'player', team: 'team', goals: 'goalsWord' }[k.slice(4)]).replace(/^./, x => x.toUpperCase()) : '')}
    <span class="len-input"><input class="input" type="number" min="0" max="${inch ? +(hi / 96).toFixed(2) : hi}" step="${inch ? 0.01 : 1}" value="${val > 0 ? show(val) : ''}" placeholder="${t(zeroKey)}" data-change="ti-set" ${data} data-unit="${o.unit}"> ${unit}</span></label>`;
  // Height: the table's real height when it's automatic (fits the teams), or the one typed.
  const box = (k, lo, hi) => {
    const autoH = k === 'height' && !(o.height > 0);
    return `<label class="field">${t(`ti_${k}`)}<span class="len-input"><input class="input ${autoH ? 'auto-val' : ''}" type="number" min="${inch ? 0 : lo}" max="${inch ? +(hi / 96).toFixed(2) : hi}" step="${inch ? 0.01 : 10}"
      value="${show(autoH ? used.natural : o[k])}" data-change="ti-set" data-k="${k}" data-unit="${o.unit}"> ${unit}</span>
      ${k === 'height' ? (autoH ? `<small class="ti-used muted-used">${t('ti_heightIsAuto')}</small>` : `<button type="button" class="link-btn small" data-action="ti-height-auto">${t('ti_backToAuto')}</button>`) : ''}</label>`;
  };
  return adminShell('admin/table', `
    <h1 class="page-title">${t('tableImage')}</h1>
    <div class="seg ti-kind">${TI_KINDS.map(([k, l]) => `<button type="button" class="${kind === k ? 'active' : ''}" data-action="ti-kind" data-kind="${k}">${t(l)}</button>`).join('')}</div>
    <p class="note">${t(kind === 'scorers' ? 'scorerImageHelp' : 'tableImageHelp')}</p>
    <div class="toolbar">${divPills(div, 'data-admin-div', { scorers: kind === 'scorers' })}</div>
    <div class="card ti-settings">
      <div class="seg ti-unit">${['in', 'px'].map(u => `<button type="button" class="${o.unit === u ? 'active' : ''}" data-action="ti-unit" data-unit="${u}">${t(u === 'in' ? 'ti_inches' : 'ti_pixels')}</button>`).join('')}</div>
      <div class="league-grid">${box('width', 400, 1600)}${box('height', 0, 2400)}${num('rowHeight', 12, 80)}${num('fontSize', 9, 32)}${num('logoSize', 12, 70)}${opt('headHeight', 0, 120, 'ti_headAuto')}${opt('spaceBelow', 0, 600, 'ti_none')}</div>
      <p class="note">${t('ti_heightHelp')}</p>
      <label class="strict-toggle ti-autofit"><input type="checkbox" data-change="ti-autofit" ${o.autoFit ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span>${t('ti_autoFit')}</span></label>
      <p class="note">${t(o.autoFit ? 'ti_autoFitOn' : 'ti_autoFitOff')}</p>
      ${o.height > 0 && !o.autoFit && used.natural > o.height ? `<p class="warn">${t('ti_tooTall')}</p>` : ''}
      <p class="field-label">${t('ti_columns')}</p>
      <div class="day-checks">${(kind === 'scorers' ? SCORER_COLS : TABLE_COLS).map(([k, label]) => `<label class="check-pill"><input type="checkbox" data-change="ti-col" value="${k}" ${o.cols.includes(k) ? 'checked' : ''}><span>${k === 'rank' ? '#' : t(label)}</span></label>`).join('')}
        <label class="check-pill"><input type="checkbox" data-change="ti-header" ${o.headerRow ? 'checked' : ''}><span>${t('ti_headerRow')}</span></label></div>
      <div class="league-grid ti-look">
        <label class="field">${t('ti_font')}<select class="select" data-change="ti-font">${IMG_FONTS.map(f => `<option ${f === o.font ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
        <label class="field">${t('ti_headFont')}<select class="select" data-change="ti-font" data-k="headFont">${IMG_FONTS.map(f => `<option ${f === (IMG_FONTS.includes(o.headFont) ? o.headFont : 'Bangers') ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></label>
        <label class="field">${t('ti_headFontSize')}<span class="len-input"><input class="input" type="number" min="${inch ? 4.5 : 6}" max="${inch ? 48 : 64}" step="${inch ? 0.5 : 1}" value="${o.headFontSize > 0 ? (inch ? +(o.headFontSize * 0.75).toFixed(1) : Math.round(o.headFontSize)) : ''}" placeholder="${t('ti_auto2')}" data-change="ti-set" data-k="headFontSize" data-unit="${inch ? 'pt' : 'px'}"> ${inch ? 'pt' : 'px'}</span></label>
      </div>
      <div class="day-checks"><label class="check-pill"><input type="checkbox" data-change="ti-flag" data-k="bold" ${o.bold ? 'checked' : ''}><span>${t('ti_bold')}</span></label></div>
      <p class="field-label">${t('ti_lookRows')}</p>
      <div class="league-grid ti-look">
        ${hexField(o, 'headFill')}${hexField(o, 'headColor')}
        ${o.bottomRow ? num('bottomHeight', 1, 60) : ''}
      </div>
      <div class="day-checks">
        <label class="check-pill"><input type="checkbox" data-change="ti-flag" data-k="bottomRow" ${o.bottomRow ? 'checked' : ''}><span>${t('ti_bottomRow')}</span></label>
      </div>
      ${kind === 'standings' && o.cols.includes('form') ? `<label class="field ti-small">${t('ti_formCount')}<select class="select" data-change="ti-count" data-k="formCount">${[1, 2, 3, 4, 5].map(n => `<option ${o.formCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}
      ${kind === 'scorers' ? `<div class="league-grid">
        <label class="field">${t('ti_count')}<select class="select" data-change="ti-count" data-k="count">${Array.from({ length: 20 }, (_, i) => i + 1).map(n => `<option ${o.count === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${['rank', 'name', 'goals'].filter(c => c !== 'rank' || o.cols.includes(c)).map(c => opt(`col:${c}`, 0, 800, 'ti_auto2', o.colWidths[c], `data-k="col:${c}"`)).join('')}</div>
        <p class="note">${t('ti_colWidthHelp')}</p>` : ''}
      <div class="row-actions">
        <button type="button" class="btn btn-gold" data-action="export-card" data-what="${kind === 'scorers' ? 'scorerTable' : 'table'}" data-as="png" data-pdiv="${div}">${t('saveTableOnly')}</button>
        <button type="button" class="btn btn-outline" data-action="ti-reset">${t('backToDefault')}</button>
      </div>
    </div>
    <p class="muted ti-size">${tiSizeText(o)} · ${t('ti_perDiv').replace('{div}', divName(div))}</p>
    ${tiPreview(kind === 'scorers' ? scorerImageHTML(div) : tableImageHTML(div))}`);
}

function pageAdminSheet() {
  const sec = ui.sheetSection || 'youth';
  const date = ui.sheetDate = sheetDayFor(ui.sheetDate || ui.boardDate || todayISO(), sec);
  const day = boardDay(date)[sec] || {};
  const fields = Object.keys(day).filter(f => (day[f] || []).some(r => rowTaken(date, r)));
  const refs = ((state.sheetRefs || {})[date] || {});
  return adminShell('admin/sheet', `
    <div class="no-print">
      <h1 class="page-title">${t('scheduleSheet')}</h1>
      <p class="note">${t('scheduleSheetHelp')}</p>
      <div class="sheet-bar">
        <div class="seg section-switch sheet-sections">${['youth', 'adult', 'futsal'].map(x => `<button class="${x === sec ? 'active' : ''} ${x}" data-action="sheet-section" data-section="${x}">${t(SECTION_TITLE[x] + 'Short')}</button>`).join('')}</div>
        ${sectionDays(sec, sundayOf(date)).length > 1 ? `<div class="seg sheet-days ${sec}">${sectionDays(sec, sundayOf(date)).map(dw => `<button class="${dayOfWeek(date) === dw ? 'active' : ''}" data-action="sheet-futsal-day" data-dow="${dw}">${esc(WEEKDAY_NAME(dw))}</button>`).join('')}</div>` : ''}
        <div class="sheet-week">
          <select class="select sheet-day-select" data-change="sheet-date" aria-label="${t('date')}">
            ${sheetDays(sec, dayOfWeek(date)).map(d => `<option value="${d}" ${d === date ? 'selected' : ''}>${esc(sheetDayLabel(d, sec))}</option>`).join('')}
            <option value="__other">${t('otherDayOption')}</option>
      </select>
      ${ui.otherDay === 'sheet-date' ? `<input class="input other-day" type="date" data-change="sheet-date" value="${date}" aria-label="${t('date')}">` : ''}
        </div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-gold" data-action="print-sheet">${t('printOnly')}</button>
        <button type="button" class="btn btn-gold" data-action="pdf-sheet">${t('savePdf')}</button>
        <button type="button" class="btn btn-outline" data-action="sheet-export" data-as="png">${t('saveImage')}</button>
        ${sec !== 'futsal' && ['youth', 'adult'].every(x => sheetHasGames(date, x)) ? `<button type="button" class="btn btn-outline" data-action="sheet-export" data-as="pdf" data-whole="1" title="${t('wholeDayHelp')}">${t('wholeDayPdf')}</button>` : ''}
        <a class="btn btn-outline" href="#/admin/schedule" data-action="sheet-to-board">${t('editInPlanner')}</a>
        <button type="button" class="btn ${ui.sheetEdit ? 'btn-gold' : 'btn-outline'}" data-action="sheet-edit" aria-pressed="${!!ui.sheetEdit}">${t(ui.sheetEdit ? 'sheetEditDone' : 'sheetEditBtn')}</button>
        ${Object.keys(sheetEdits(date, sec)).length ? `<button type="button" class="btn btn-outline" data-action="ask" data-confirm="sheet-edits-reset" data-ask="askSheetReset" data-yes="yesReset">${t('sheetEditReset')}</button>` : ''}
      </div>
      ${ui.sheetEdit ? `<p class="note">${t('sheetEditHelp')}</p>` : ''}
      ${fields.length && sec !== 'futsal' ? `<details class="card sheet-refs" ${ui.refsOpen ? 'open' : ''}><summary data-action="refs-toggle"><b>${t('referees')}</b> <span class="muted">${t('refereesHelp')}</span></summary>
        ${fields.map(f => {
          const key = `${sec}|${f}`;
          const times = day[f].filter(r => rowTaken(date, r)).map(r => r.t);
          const list = fieldRefs(date, key).length ? fieldRefs(date, key) : [{ name: '', times: null }];
          return `<div class="ref-field"><b>${esc(FIELDS[f])}</b>
            ${list.map((e, i) => `<div class="ref-line">
              <input class="input" data-change="sheet-ref" data-key="${key}" data-i="${i}" value="${esc(e.name)}" placeholder="${t('refName')}" autocomplete="off">
              <div class="ref-chips">${times.map(tm => `<button type="button" class="chip ${refCovers(list, i, tm) ? 'on' : ''}" data-action="ref-chip" data-key="${key}" data-i="${i}" data-t="${tm}" aria-pressed="${refCovers(list, i, tm)}">${shortTime(tm)}</button>`).join('')}</div>
              ${list.length > 1 ? `<button type="button" class="icon-btn danger" data-action="ref-rm" data-key="${key}" data-i="${i}" aria-label="${t('remove')}">×</button>` : ''}
            </div>`).join('')}
            <button type="button" class="link-btn small" data-action="ref-add" data-key="${key}">＋ ${t('addReferee')}</button>
          </div>`;
        }).join('')}
      </details>` : ''}
    </div>
    <div class="sheet-scroll ${ui.sheetEdit ? 'sheet-editing' : ''}">${(ui.sheetLive = true, '')}${sheetHTML(date, sec)}${(ui.sheetLive = false, '')}</div>`);
}

// ---------- game rotation (rol de juegos) ----------
// The usual round robin: 1 stays put and the others turn one place each game, so with 8 teams Game 1 is
// 1–8, 2–7, 3–6, 4–5 and Game 2 is 1–7, 8–6, 2–5, 3–4 (the same as the league's sheet). With an odd
// number of teams the extra number means that team rests. Once everyone has met it starts over (ida y vuelta).
function rotationRound(size, game) {
  const k = size % 2 ? size + 1 : size;
  if (k < 2) return [];
  const r = (game - 1) % (k - 1);
  const others = Array.from({ length: k - 1 }, (_, i) => i + 2);
  const c = others.map((_, i) => others[(((i - r) % (k - 1)) + (k - 1)) % (k - 1)]);
  const top = [1, ...c.slice(0, k / 2 - 1)];
  const bottom = c.slice(k / 2 - 1).reverse();
  return top.map((n, i) => [n, bottom[i]]);
}
// How many different rounds a rotation has (an odd number of teams adds a rest spot), and which round each
// game uses: normally Game N plays Round N (repeating), but a game can be set to another round
// (state.rotation[div].rounds[g]), like picking rounds out of order when scheduling.
const roundCount = size => Math.max(1, (size % 2 ? size + 1 : size) - 1);
const usualRound = (size, g) => ((g - 1) % roundCount(size)) + 1;
// Every game week's round: a week with a round picked keeps it; the others take the next round not used
// yet, so picking Round 11 for Game 4 moves the rounds after it along (Game 5 → Round 4…). Once every round
// has been used, it starts over.
// A week whose next round is already picked by a later week (in the same pass through the rounds) shows
// "Round TBD" (0) until a round is picked for it, instead of playing that round twice.
// Rounds held for later (state.rotation[div].held): automatic weeks skip them; they stay "TBD" until a week
// is given that round.
function seasonRounds(div, rounds = rotationOf(div).rounds || {}) {
  const out = [0], used = new Set(), n = gameColumns(div);
  const picked = new Set(Object.values(rounds));
  const held = new Set((rotationOf(div).held || []).filter(r => !picked.has(r)));
  for (let g = 1; g <= n; g++) {
    const count = roundCount(rotationAt(div, g).size);
    if (used.size + [...held].filter(x => !used.has(x)).length >= count) used.clear();
    let r = rounds[g] ? ((rounds[g] - 1) % count) + 1 : 0;
    if (!r) {
      const free = x => !used.has(x) && !held.has(x);
      r = 1; while (!free(r) && r <= count) r++;
      if (r > count) { used.clear(); r = 1; while (held.has(r) && r <= count) r++; if (r > count) { out[g] = 0; continue; } }
      // picked by a later week before the rounds start over?
      const left = count - used.size;
      const later = Object.keys(rounds).map(Number).filter(x => x > g && x <= g + left);
      if (later.some(x => ((rounds[x] - 1) % count) + 1 === r)) { out[g] = 0; continue; }
    }
    used.add(r); out[g] = r;
  }
  return out;
}
const gameRound = (div, g) => { const sr = seasonRounds(div); return g < sr.length ? sr[g] : g; };
// A division's rotation: how many numbers, and which team has each number.
const rotationOf = div => (state.rotation || {})[div] || { size: (state.teams[div] || []).length, numbers: {} };
// Changing the rotation (a team added, a number changed, more numbers) only counts from the coming game day
// on: the games before it keep the rotation they were played with.
function freezePastRotation(div) {
  const rot = (state.rotation || {})[div];
  if (!rot) return;
  const next = nextGameNumber(div);
  rot.past = rot.past || {};
  for (let g = 1; g < next; g++) if (!rot.past[g]) rot.past[g] = { size: rot.size, numbers: { ...rot.numbers } };
}
const rotationAt = (div, g) => {
  const rot = rotationOf(div), snap = (rot.past || {})[g];
  return snap ? { ...snap, numbers: currentNames(div, snap.numbers) } : rot;
};
// A name saved before a team was renamed only in capitals ("Puebla" → "PUEBLA") reads as today's name.
function currentNames(div, numbers) {
  const now = [...(state.teams[div] || []), ...withdrawnIn(div).map(w => w.team)];
  const fix = nm => (now.includes(nm) ? nm : now.find(x => x.toLowerCase() === String(nm).toLowerCase()) || nm);
  return Object.fromEntries(Object.entries(numbers).map(([k, v]) => [k, fix(v)]));
}
const rotationNumber = (div, team) => +(Object.entries(rotationOf(div).numbers).find(([, n]) => n === team) || [])[0] || 0;
// Who a team plays on a date by the rotation: a team name, 'rest', or '' when it isn't set up.
function rotationOpponent(div, date, team) {
  const g = gameNumber(div, date), rot = rotationAt(div, g);
  const me = +(Object.entries(rot.numbers).find(([, n]) => n === team) || [])[0] || 0;
  if (!me) return '';
  const rd = gameRound(div, g);
  if (!rd) return ''; // Round TBD: no suggestion until a round is picked
  const pair = rotationRound(rot.size, rd).find(p => p.includes(me));
  if (!pair) return '';
  const other = pair[0] === me ? pair[1] : pair[0];
  return other > rot.size ? 'rest' : rot.numbers[other] || '';
}
// Auto-pick on the planner can be turned off per division (for weeks that don't follow the rotation).
const rotationOn = div => !(state.rotationOff || {})[div];
const hasRotation = div => Object.keys(rotationOf(div).numbers).length > 0;
const rotationSwitch = (div, label) => `<label class="strict-toggle" title="${t(rotationOn(div) ? 'rotationAutoOn' : 'rotationAutoOff')}">
    <input type="checkbox" data-change="rot-auto" data-rdiv="${div}" ${rotationOn(div) ? 'checked' : ''}>
    <span class="switch" aria-hidden="true"></span><span>${label}</span></label>`;

// The game number coming up for a division (today if it plays today).
const nextGameNumber = div => {
  const last = lastPlayDay(div);
  return gameNumber(div, last === todayISO() ? last : addDays(last, 7));
};

// The date of a division's Game N: the day it was played/booked, or (for games not booked yet) counted a
// week at a time from the last game day, marked "about".
function rotGameDate(div, g) {
  const days = [...new Set(state.matches.filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
  const short = d => fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
  if (g <= days.length) return short(days[g - 1]);
  // Count forward a week at a time from the last game day, skipping days off.
  let d = days[days.length - 1] || addDays(lastPlayDay(div), -7);
  // an expected date is never one already gone by (a week with no games doesn't count as a game)
  const today = todayISO();
  for (let k = days.length; k < g; k++) { d = addDays(d, 7); while (d < today || offFor(div, d)) d = addDays(d, 7); }
  return `${t('aboutDate')} ${short(d)}`;
}

// Every round of the rotation and where it falls this season: played (green), coming up (gold) or not
// played at all (red).
function roundTrackerHTML(div, next) {
  const sr = seasonRounds(div), count = roundCount(rotationOf(div).size);
  const games = r => sr.map((x, g) => (x === r && g ? g : 0)).filter(Boolean);
  return `<section class="card rot-tracker"><h2>${t('rotRoundsTitle')}</h2><div class="rot-chips">${Array.from({ length: count }, (_, i) => i + 1).map(r => {
    const gs = games(r), played = gs.filter(g => g < next), coming = gs.filter(g => g >= next);
    const isHeld = (rotationOf(div).held || []).includes(r) && !coming.length;
    const cls = played.length ? 'played' : coming.length ? 'coming' : isHeld ? 'held' : 'not-played';
    const label = played.length ? `${t('rotPlayedTag')} · ${played.map(g => `${t('game')} ${g}`).join(', ')}` : coming.length ? `${t('game')} ${coming[0]}` : isHeld ? t('rotHeldTag') : t('rotNotPlayed');
    const canHold = !played.length;
    return `<span class="rot-chip ${cls}"><b>${t('roundWord')} ${r}</b><small>${esc(label)}${played.length && coming.length ? ` · ${t('rotAgainIn')} ${t('game')} ${coming[0]}` : ''}</small>
      ${canHold ? `<button type="button" class="link-btn small" data-action="rot-hold" data-r="${r}">${t(isHeld ? 'rotRelease' : 'rotHold')}</button>` : ''}</span>`;
  }).join('')}</div></section>`;
}
// One past game on the chart uses other numbers than the ones set now.
function pastDiffersAt(div, g) {
  const rot = rotationOf(div), sn = (rot.past || {})[g], key = nums => JSON.stringify(Object.entries(nums).sort(([a], [b]) => a - b));
  return !!sn && (sn.size !== rot.size || key(currentNames(div, sn.numbers)) !== key(rot.numbers));
}
// Some past game on the chart uses other numbers than the ones set now.
function pastDiffers(div) {
  const rot = rotationOf(div), key = nums => JSON.stringify(Object.entries(nums).sort(([a], [b]) => a - b));
  return Object.values(rot.past || {}).some(sn => sn.size !== rot.size || key(currentNames(div, sn.numbers)) !== key(rot.numbers));
}
function pageAdminRotation() {
  const div = ui.adminDiv;
  const rot = rotationOf(div);
  // Withdrawn teams keep their number, so their opponents still show as forfeits.
  const teams = [...(state.teams[div] || []), ...withdrawnIn(div).map(w => w.team)].sort((a, b) => a.localeCompare(b));
  const name = n => rot.numbers[n] || '';
  const gone = new Set(withdrawnIn(div).map(w => w.team));
  // Only active teams need a number; a withdrawn team can keep one so its games show as forfeits.
  const missing = teams.filter(tm => !gone.has(tm) && !rotationNumber(div, tm));
  const next = nextGameNumber(div);
  // A rest spot in a coming game can take a new team (it gets that spot's number from the coming game on).
  const restAdd = g => (g >= next && rot.size % 2 ? ` <button type="button" class="link-btn small" data-action="rot-add-rest">＋ ${t('addTeamHere')}</button>` : '');
  const cell = (n, at = rot, g = 0) => { const nm = at.numbers[n] || ''; return n > at.size ? `<span class="rot-n rest">–</span><span class="muted">${t('rests')}</span>${at === rot ? restAdd(g) : ''}`
    : `<span class="rot-n">${n}</span><span class="${nm ? '' : 'muted'}">${esc(nm || t('notSet'))}${gone.has(nm) ? ` <span class="tag">${t('withdrewTag')}</span>` : ''}</span>`; };
  return adminShell('admin/rotation', `
    <h1 class="page-title">${t('rotation')}</h1>
    <div class="toolbar">${divPills(div, 'data-admin-div')}</div>
    <p class="note">${t('rotationHelp')}</p>
    <section class="card rot-numbers">
      <div class="box-head"><h2>${t('teamNumbers')}</h2>
        ${rotationSwitch(div, t('rotationAuto'))}
        <label class="field inline">${t('howManyNumbers')} <input class="input" type="number" min="2" max="30" value="${rot.size}" data-change="rot-size"></label>
        <span class="field inline">${t('gamesInSeason')} <span class="stepper-cell">
          <button type="button" class="icon-btn" data-action="season-games" data-for="${div}" data-step="-1" aria-label="−1">−</button>
          <b>${gameColumns(div)}</b>
          <button type="button" class="icon-btn" data-action="season-games" data-for="${div}" data-step="1" aria-label="+1">+</button></span></span></div>
      <div class="rot-pick" style="--rows:${Math.ceil(rot.size / 2)}">${Array.from({ length: rot.size }, (_, i) => i + 1).map(n => `<label class="rot-slot"><span class="rot-n">${n}</span>
        <select class="select" data-change="rot-num" data-n="${n}" ${addTeamAttrs(div, `rot|${n}`)} aria-label="${t('number')} ${n}">
          <option value="">${t('chooseTeam')}</option>
          ${teams.filter(tm => !gone.has(tm)).map(tm => `<option ${tm === name(n) ? 'selected' : ''}>${esc(tm)}</option>`).join('')}
          ${gone.size ? `<optgroup label="${t('withdrewGroup')}">${[...gone].map(tm => `<option value="${esc(tm)}" ${tm === name(n) ? 'selected' : ''}>${esc(tm)} (${t('withdrewTag')})</option>`).join('')}</optgroup>` : ''}
          ${addTeamOpt()}
        </select></label>`).join('')}</div>
      <p class="note">${t('rotPastTooOff')}</p>
      ${missing.length ? `<p class="warn">${t('noNumberYet')}: ${missing.map(esc).join(', ')}</p>` : ''}
      <div class="row-actions">
        ${missing.length ? `<button type="button" class="btn btn-sm btn-outline" data-action="rot-fill">${t('fillEmptyNumbers')}</button>` : ''}
        ${rot.size % 2 && Object.keys(rot.numbers).length ? `<button type="button" class="btn btn-sm btn-outline" data-action="rot-add-rest">＋ ${t('addTeamRest')}</button>` : ''}
        <button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="rot-clear">${t('clearNumbers')}</button>
      </div>
    </section>
    ${(() => { const sr = seasonRounds(div); ui.rotSeason = sr; ui.rotPlayed = {}; for (let g = 1; g < next; g++) (ui.rotPlayed[sr[g]] = ui.rotPlayed[sr[g]] || []).push(g); return ''; })()}
    ${roundTrackerHTML(div, next)}
    <div class="rot-grid">${rotRoundBoxes(div, next).map(({ r, c, g }) => {
      // one box per round: its matchups never change; the header says which week plays it (or TBD)
      const key = `${r}.${c}`, open = ui.rotEditR === key && ui.rotDraft && ui.rotDraft.key === key;
      const held = !g && (rot.held || []).includes(r);
      // while editing, the box shows the changes (not saved until Save)
      const at = open ? { size: ui.rotDraft.size, numbers: ui.rotDraft.numbers } : g ? rotationAt(div, g) : rot;
      const dirty = open && rotDraftDirty(div);
      const snap = g && (rot.past || {})[g];
      const chosen = g && Object.entries(rot.rounds || {}).some(([x, v]) => +x === g && v === r);
      const status = g ? `<span class="rot-game-name">${t('game')} ${g}</span><span class="muted">${rotGameDate(div, g)}</span>${g === next ? `<span class="tag">${t('nextGame')}</span>` : g < next ? `<span class="tag rot-played-tag">${t('rotPlayedTag')}</span>` : ''}`
        : `<span class="rot-game-name">${t('rotGameTbd')}</span><span class="muted">${t('rotDateTbd')}</span>`;
      const weeks = Array.from({ length: gameColumns(div) }, (_, i) => i + 1);
      return `<div class="rot-game ${g === next ? 'next' : ''} ${chosen ? 'moved' : ''} ${!g ? 'tbd-box' : ''} ${open ? 'editing' : ''}">
        <div class="rot-head"><b>#${r}</b>${status}
          <span class="rot-head-tools"><span class="rot-round-tag ${chosen ? 'changed' : ''} ${g ? '' : 'tbd'}">${t('roundWord')} ${r}</span>
          <button type="button" class="btn btn-sm btn-outline rot-edit-btn" data-action="rot-round-edit" data-key="${key}">${open ? t('doneBtn') : t('editGame')}</button></span></div>
        ${open ? `<div class="rot-game-edit">
          <label class="field">${t('rotPlayedInWeek')}<select class="select" data-change="rot-draft-week">
            <option value="auto" ${ui.rotDraft.week === 'auto' ? 'selected' : ''}>${t('rotWeekAuto')}</option>
            <option value="tbd" ${ui.rotDraft.week === 'tbd' ? 'selected' : ''}>${t('rotWeekTbd')}</option>
            ${weeks.map(w => { const other = ui.rotSeason[w]; return `<option value="g:${w}" ${ui.rotDraft.week === `g:${w}` ? 'selected' : ''}>${t('game')} ${w} · ${esc(rotGameDate(div, w))}${w < next ? ` · ${t('rotPlayedTag')}` : ''}${other && other !== r ? ` · ${t('roundWord')} ${other} ${t('rotNow')}` : ''}</option>`; }).join('')}</select></label>
          <p class="muted small rot-auto-help">${t('rotWeekHelp')}</p>
          <button type="button" class="btn btn-sm btn-outline" data-action="rot-nums-toggle" data-g="${key}" aria-expanded="${ui.rotNumsG === key}">${t('rotEditNumbers')} ${ui.rotNumsG === key ? '▴' : '▾'}</button>
          ${ui.rotNumsG === key ? `<div class="rot-game-nums">
            <p class="muted small">${t('rotDraftNumsHelp')}</p>
            <label class="field inline rot-game-size">${t('rotGameSize')} <input class="input" type="number" min="2" max="30" inputmode="numeric" value="${at.size}" data-change="rot-draft-size"></label>
            <div class="rot-pick rot-pick-game" style="--rows:${Math.ceil(at.size / 2)}">${Array.from({ length: at.size }, (_, i) => i + 1).map(n => `<label class="rot-slot"><span class="rot-n">${n}</span>
              <select class="select" data-change="rot-draft-num" data-n="${n}" aria-label="${t('number')} ${n}">
                <option value="">${t('chooseTeam')}</option>
                ${[...new Set([...teams, ...Object.values(at.numbers)])].map(tm => `<option value="${esc(tm)}" ${tm === at.numbers[n] ? 'selected' : ''}>${esc(tm)}${gone.has(tm) ? ` (${t('withdrewTag')})` : ''}</option>`).join('')}
              </select></label>`).join('')}</div>
          </div>` : ''}
          <div class="row-actions rot-draft-actions">
            ${dirty ? `<span class="tag draft-tag">${t('rotNotSaved')}</span>` : ''}
            <button type="button" class="btn btn-sm btn-outline" data-action="rot-round-edit" data-key="${key}">${t('cancel')}</button>
            <button type="button" class="btn btn-sm btn-gold" data-action="rot-draft-save" ${dirty ? '' : 'disabled'}>${t('save')}</button>
          </div>
        </div>` : ''}
        ${rotationRound(at.size, r).map(([a, b]) => `<div class="rot-pair"><span>${cell(a, at, g || next)}</span><i>${t('vs')}</i><span>${cell(b, at, g || next)}</span></div>`).join('')}
      </div>`;
    }).join('')}</div>`);
}
// Rotation edits wait in a draft (ui.rotDraft) until Save. Week first; numbers and how many go on the Next
// game and every game after it (games already played keep theirs).
function rotDraftStart(div, key) {
  const box = rotRoundBoxes(div, nextGameNumber(div)).find(b => `${b.r}.${b.c}` === key);
  if (!box) return null;
  // the numbers to edit are the ones the Next game and later use (Save only changes those), so an old
  // played game's numbers (maybe with a team's old name) are never copied forward
  const rot = rotationOf(div), next = nextGameNumber(div);
  const at = box.g && box.g >= next ? rotationAt(div, box.g) : { size: rot.size, numbers: currentNames(div, rot.numbers) };
  const chosen = box.g && Object.entries(rot.rounds || {}).some(([x, v]) => +x === box.g && v === box.r);
  const week = chosen ? `g:${box.g}` : (!box.g && (rot.held || []).includes(box.r)) ? 'tbd' : 'auto';
  return { key, r: box.r, g: box.g, week, startWeek: week, size: at.size, numbers: { ...at.numbers }, startSize: at.size, startNumbers: { ...at.numbers } };
}
function rotDraftDirty() {
  const d = ui.rotDraft;
  if (!d) return false;
  const key = nums => JSON.stringify(Object.entries(nums).sort(([a], [b]) => a - b));
  return d.week !== d.startWeek || d.size !== d.startSize || key(d.numbers) !== key(d.startNumbers);
}
// The round boxes in order: Round 1, 2, 3… with the week each is played in; when the season goes round
// again, the rounds played a second time follow.
function rotRoundBoxes(div, next) {
  const sr = ui.rotSeason || seasonRounds(div), count = roundCount(rotationOf(div).size);
  const byRound = {};
  for (let g = 1; g < sr.length; g++) if (sr[g]) (byRound[sr[g]] = byRound[sr[g]] || []).push(g);
  const out = [];
  for (let r = 1; r <= count; r++) out.push({ r, c: 0, g: (byRound[r] || [])[0] || 0 });
  for (let c = 1; Object.values(byRound).some(l => l.length > c); c++)
    for (let r = 1; r <= count; r++) if ((byRound[r] || [])[c]) out.push({ r, c, g: byRound[r][c] });
  return out;
}

// After a team is picked on the planner, put in its opponent from the rotation (Admin → Game rotation).
function fillFromRotation(r, side) {
  const team = r[side];
  if (!team || !r.div) return '';
  // In the playoffs the opponent comes from the bracket instead of the rotation.
  const po = playoffsOf(r.div), co = copaOf(r.div);
  if ((po && ui.boardDate >= po.on) || (co && ui.boardDate >= co.on)) {
    const opp = playoffOpponent(r.div, team);
    if (!opp) return '';
    r[side === 'home' ? 'away' : 'home'] = opp;
    return 'next-row';
  }
  if (!rotationOn(r.div)) return '';
  const other = rotationOpponent(r.div, ui.boardDate, team);
  if (!other) return '';
  const game = gameNumber(r.div, ui.boardDate);
  if (other === 'rest') { toast(`${t('game')} ${game}: ${team} ${t('restsThisGame')}`); return ''; }
  if (withdrawnIn(r.div).some(w => w.team === other)) { toast(`${t('game')} ${game}: ${team} ${t('vs')} ${other} — ${t('rotationForfeit')}`); return ''; }
  if (!(state.teams[r.div] || []).includes(other)) return '';
  r[side === 'home' ? 'away' : 'home'] = other;
  return 'next-row';
}

// A withdrawn team that still has its rotation number: on every game day from its withdrawal on (the
// booked ones and the coming one), whoever the rotation pairs it with gets that game as a forfeit
// automatically, unless that team already has a real game that day.
function syncRotationForfeits() {
  let changed = false;
  Object.values(state.withdrawn || {}).forEach(w => {
    const div = w.div;
    if (!hasRotation(div)) return;
    const po = playoffsOf(div);
    const booked = [...new Set(state.matches.filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))];
    const last = lastPlayDay(div), coming = last >= todayISO() ? last : addDays(last, 7);
    const days = [...new Set([...booked, coming])].filter(d => d >= (w.on || '') && (!po || d < po.on) && gameNumber(div, d) <= gameColumns(div));
    days.forEach(date => {
      const g = gameNumber(div, date), at = rotationAt(div, g);
      const me = +(Object.entries(at.numbers).find(([, n]) => n === w.team) || [])[0] || 0;
      if (!me) return;
      const rd = gameRound(div, g);
      if (!rd) return;
      const pair = rotationRound(at.size, rd).find(p => p.includes(me));
      const otherN = pair && (pair[0] === me ? pair[1] : pair[0]);
      const other = otherN && otherN <= at.size ? at.numbers[otherN] : '';
      if (!other || withdrawnIn(div).some(x => x.team === other)) return;
      if ((w.left || []).some(m => m.date === date && (m.home === w.team || m.away === w.team))) return;
      if (state.matches.some(m => m.div === div && m.date === date && !m.forfeitBy && !m.fromFriendly && (m.home === other || m.away === other))) return;
      w.left = [...(w.left || []), { id: state.nextId++, div, date, time: '12:00 PM', field: '', home: other, away: w.team, hs: null, as: null, left: true, auto: true }];
      changed = true;
    });
  });
  if (changed) save();
}

// pastToo: the earlier games on the chart take the same numbers as well, so the whole chart follows them
// (only the chart; games already booked or played keep their teams and scores).
function setRotation(div, rot, text, pastToo) {
  freezePastRotation(div);
  const past = pastToo ? {} : { ...(rotationOf(div).past || {}) };
  rot = { rounds: rotationOf(div).rounds, ...rot, past };
  if (!rot.rounds) delete rot.rounds;
  // A withdrawn team whose number now goes to another team: the games it still had (from today on) aren't
  // forfeits anymore; the new team plays them. Games already past keep their 3–0.
  const before = rotationOf(div).numbers;
  withdrawnIn(div).forEach(w => {
    const had = Object.keys(before).some(n => before[n] === w.team), has = Object.values(rot.numbers).includes(w.team);
    if (had && !has) w.left = (w.left || []).filter(m => m.date < todayISO());
  });
  state.rotation = { ...(state.rotation || {}), [div]: rot };
  logAction(`${t('rotation')} · ${divName(div)}: ${text}`);
  save(); render();
}

function boardChange(el) {
  const tr = el.closest('tr');
  const { field, section } = tr.dataset;
  const rows = boardRows(section, field);
  const r = rows.find(x => x.id === tr.dataset.row);
  let next = null;
  if (el.matches('.b-div') && el.value === '__ko') {
    const divs = koDivs(boardDivisions(ui.boardDate, section, field).length ? boardDivisions(ui.boardDate, section, field) : DIVISIONS.filter(d => d.group === section));
    const div = divs.some(d => d.id === r.div) ? r.div : (divs[0] || {}).id;
    const m = r.mid && state.matches.find(x => x.id === r.mid);
    if (m && !played(m)) state.matches = state.matches.filter(x => x.id !== m.id);
    Object.assign(r, { mid: null, home: '', away: '', div, hold: { div, key: '' } });
    delete r.friendly; delete r.allDivs;
    reflow(section, field); save();
    return redrawBoard(r.id, 'b-hgame');
  }
  if (el.matches('.b-round')) {
    const v = el.value;
    if (v.startsWith('k:')) {
      // A knockout game: the slot is saved for it (a game booked there comes off unless it has a score).
      const m = r.mid && state.matches.find(x => x.id === r.mid);
      if (m && played(m)) return redrawBoard(r.id);
      if (m) state.matches = state.matches.filter(x => x.id !== m.id);
      const div = r.hold ? r.hold.div : r.div;
      Object.assign(r, { mid: null, home: '', away: '', div, hold: { div, key: v.slice(2) } });
      delete r.stage; delete r.hHome; delete r.hAway;
      logAction(`${t('koSaved')} · ${divName(div)} · ${fmtDate(ui.boardDate)} ${fromMin(r.t)}: ${holdName(r)}`);
      reflow(section, field); save(); fillHolds();
      return redrawBoard(r.id, 'b-hhome');
    }
    // A group (or nothing): back to an ordinary slot; teams not in that group come off.
    if (r.hold) { const div = r.hold.div; delete r.hold; delete r.hHome; delete r.hAway; r.div = div; }
    r.stage = v;
    const g = v && ((copaOf(r.div) || {}).groups || []).find(x => x.name === v.slice(2));
    if (g) { if (!g.teams.includes(r.home)) r.home = ''; if (!g.teams.includes(r.away)) r.away = ''; }
    syncRow(ui.boardDate, field, r); save();
    return redrawBoard(r.id, 'b-home');
  }
  if (r.hold && el.matches('.b-div')) {
    // Another division (or a friendly) for a saved slot: it's an ordinary slot again.
    delete r.hold; delete r.hHome; delete r.hAway; delete r.stage;
  }
  if (r.hold && el.matches('.b-hdiv')) {
    if (el.value === '__league') { const div = r.hold.div; delete r.hold; delete r.hHome; delete r.hAway; r.div = div; save(); return redrawBoard(r.id, 'b-home'); }
    Object.assign(r, { div: el.value, hold: { div: el.value, key: '' } });
    reflow(section, field); save();
    return redrawBoard(r.id, 'b-hgame');
  }
  if (r.hold && el.matches('.b-hgame')) {
    r.hold.key = el.value;
    logAction(`${t('koSaved')} · ${divName(r.hold.div)} · ${fmtDate(ui.boardDate)} ${fromMin(r.t)}: ${holdName(r)}`);
    save(); fillHolds();
    return redrawBoard(r.id, 'b-hhome');
  }
  if (r.hold && el.matches('.b-hhome, .b-hhaway')) {
    r[el.matches('.b-hhome') ? 'hHome' : 'hAway'] = el.value;
    if (r.hHome && r.hAway && r.hHome !== r.hAway) fillHold({ date: ui.boardDate, field, r }, r.hHome, r.hAway);
    save();
    return redrawBoard(r.id, el.matches('.b-hhome') ? 'b-hhaway' : 'next-row');
  }
  if (el.matches('.b-div') && el.value === '__friendly') {
    Object.assign(r, { friendly: true, fdiv: friendlyDiv(r), div: '', home: '', away: '' });
    delete r.league;
    delete r.allDivs;
    reflow(section, field); syncRow(ui.boardDate, field, r); save();
    return redrawBoard(r.id, 'b-fdiv');
  }
  if (el.matches('.b-fdiv')) {
    Object.assign(r, { friendly: true, fdiv: el.value, home: '', away: '', homeTyped: false, awayTyped: false });
    reflow(section, field); save();
    return redrawBoard(r.id, 'b-home');
  }
  if (isFriendly(ui.boardDate, r) && el.matches('.b-home, .b-away')) {
    // On a friendlies day an open slot becomes a friendly as soon as something is typed in it.
    const side = el.matches('.b-home') ? 'home' : 'away';
    Object.assign(r, { friendly: true, fdiv: friendlyDiv(r) });
    if (el.value === '__type') {
      r[`${side}Typed`] = true; r[side] = '';
      save();
      return redrawBoard(r.id, `b-${side}`);
    }
    r[side] = ensureFriendlyTeam(friendlyDiv(r), el.value.trim());
    syncRow(ui.boardDate, field, r); save();
    return redrawBoard(r.id, el.matches('.b-home') ? 'b-away' : 'next-row');
  }
  if (el.matches('.b-div') && isFriendly(ui.boardDate, r)) {
    // "← League game": this one slot is a real game, even on a friendlies day.
    const fdiv = friendlyDiv(r);
    delete r.friendly; delete r.fdiv; delete r.homeTyped; delete r.awayTyped;
    Object.assign(r, { home: '', away: '', div: fdiv === FRIENDLY_OUT ? '' : fdiv });
    if (friendlyDay(ui.boardDate)) r.league = true;
    reflow(section, field); save();
    return redrawBoard(r.id, r.div ? 'b-home' : 'b-div');
  }
  if (el.matches('.b-div') && el.value === '__other') {
    r.allDivs = true;
    save();
    return redrawBoard(r.id, 'b-div');
  }
  if (el.matches('.b-div')) {
    // "Other division…" only opens the full list for picking; once one is picked the slot goes back to
    // the field's usual divisions (plus the one picked) with "Other division…" at the bottom again.
    delete r.allDivs; delete r.stage;
    r.div = el.value;
    if (r.div) r.picked = true; else delete r.picked;
    if (![...(state.teams[r.div] || []), ...copaExtras(r.div)].includes(r.home)) r.home = '';
    if (![...(state.teams[r.div] || []), ...copaExtras(r.div)].includes(r.away)) r.away = '';
    next = 'b-home';
  } else if (el.matches('.b-home')) { r.home = el.value; next = 'b-away'; next = fillFromRotation(r, 'home') || next; }
  else { r.away = el.value; next = 'next-row'; if (!r.home) fillFromRotation(r, 'away'); }
  reflow(section, field);
  syncRow(ui.boardDate, field, r);
  save();
  redrawBoard(r.id, next);
}

// A friendly slot: "Friendly" with a second list for which division the teams are from (it starts on the
// slot's division, since it's usually our own teams). Each team is picked from that division's list, or
// "Type a team name…" swaps in a box for any name (outside teams always get the box).
const friendlyDiv = r => r.fdiv || r.div || FRIENDLY_OUT;
// A new team typed in for a friendly joins that division right away, hidden from the standings, so it has a
// team page (Teams → Withdrawn / hidden) and the friendly can count for it later. A name that's already a team
// there (in any capitals) uses that team.
function ensureFriendlyTeam(div, name) {
  if (!name || !DIVISIONS.some(d => d.id === div && !isTour(d))) return name;
  const list = state.teams[div] = state.teams[div] || [];
  const same = list.find(n => n.toLowerCase() === name.toLowerCase());
  if (same) return same;
  list.push(name);
  state.standingsHidden = { ...(state.standingsHidden || {}), [div]: [...hiddenFromStandings(div), name] };
  logAction(`${t('logTeamAdded')}: ${name} · ${divName(div)} · ${t('hiddenFromStandingsTag')} (${t('friendly')})`);
  toast(`${name}: ${t('friendlyTeamMade').replace('{div}', divName(div))}`);
  return name;
}
function friendlyRow(date, section, field, r, opt, status) {
  const fdiv = friendlyDiv(r);
  const teams = DIVISIONS.some(d => d.id === fdiv) ? [...(state.teams[fdiv] || [])].sort((a, b) => a.localeCompare(b)) : [];
  const teamBox = (cls, side, cur) => {
    const typed = !teams.length || r[`${side}Typed`] || (cur && !teams.includes(cur));
    if (typed) {
      return `<div class="typed-team"><input class="input ${cls}" value="${esc(cur || '')}" placeholder="${t('typeTeam')}" autocomplete="off">
        ${teams.length ? `<button type="button" class="link-btn small" data-action="friendly-list" data-side="${side}" title="${t('backToList')}">${t('backToList')}</button>` : ''}</div>`;
    }
    return `<select class="select ${cls}">${opt('', cur, t('chooseTeam'))}${teams.map(n => opt(n, cur)).join('')}<option value="__type">${t('typeTeamOption')}</option></select>`;
  };
  return `<tr class="friendly ${rowTaken(date, r) ? 'booked' : ''}" data-row="${r.id}" data-field="${field}" data-section="${section}">
    <td class="b-time-cell">${timePicker(r.t, false)}</td>
    <td><div class="friendly-div">
      <select class="select b-div" aria-label="${t('division')}">${opt('__friendly', '__friendly', t('friendly'))}${opt('', '__friendly', `← ${t('leagueGame')}`)}</select>
      <select class="select b-fdiv" aria-label="${t('friendlyFrom')}">
        ${DIVISIONS.map(d => opt(d.id, fdiv, boardDivLabel(d))).join('')}
        ${opt(FRIENDLY_OUT, fdiv, t('outsideTeams'))}
      </select></div></td>
    ${boardRoundCol ? '<td></td>' : ''}
    <td>${teamBox('b-home', 'home', r.home)}</td>
    <td>${teamBox('b-away', 'away', r.away)}</td>
    <td class="b-status">${status}</td>
    <td><button type="button" class="icon-btn danger" data-action="ask" data-confirm="rm-slot-row" aria-label="${t('remove')}">×</button></td>
  </tr>`;
}

// Time box like the browser's, in three parts (hour, minutes, AM/PM) that never jump to the
// next part on their own. Hour and minutes take up to two digits; ↑/↓ nudge them.
function timePicker(time, disabled) {
  const h24 = Math.floor(time / 60), m = time % 60;
  const dis = disabled ? 'disabled' : '';
  return `<span class="tpick">
    <input class="tp-h" inputmode="numeric" maxlength="2" value="${h24 % 12 || 12}" ${dis} aria-label="${t('time')}"><b>:</b><input class="tp-m" inputmode="numeric" maxlength="2" value="${String(m).padStart(2, '0')}" ${dis} aria-label="min">
    <span class="tp-ap">${h24 >= 12 ? 'PM' : 'AM'}</span>
  </span>`;
}

// Read the three parts; null if the hour or minutes aren't valid.
function pickerMinutes(cell) {
  const h = parseInt(cell.querySelector('.tp-h').value, 10);
  const m = parseInt(cell.querySelector('.tp-m').value || '0', 10);
  if (!(h >= 1 && h <= 12) || !(m >= 0 && m <= 59)) return null;
  const pm = cell.querySelector('.tp-ap').textContent === 'PM';
  return ((h % 12) + (pm ? 12 : 0)) * 60 + m;
}

// AM/PM follows the hour typed, so the numbers you enter are kept: youth 7–11 is morning, adults 8–11,
// futsal is always evening; everything else is afternoon.
function guessAmPm(cell, section) {
  const h = parseInt(cell.querySelector('.tp-h').value, 10);
  const morning = section === 'youth' ? h >= 7 && h <= 11 : section === 'adult' ? h >= 8 && h <= 11 : false;
  cell.querySelector('.tp-ap').textContent = morning ? 'AM' : 'PM';
}

function commitTimeBox(input) {
  const tr = input.closest('tr');
  const cell = input.closest('.b-time-cell');
  const r = boardRows(tr.dataset.section, tr.dataset.field).find(x => x.id === tr.dataset.row);
  guessAmPm(cell, tr.dataset.section);
  const time = pickerMinutes(cell);
  if (time === null) {
    cell.querySelector('.tpick').outerHTML = timePicker(r.t, false);
    return;
  }
  if (input.matches('.tp-m')) input.value = String(time % 60).padStart(2, '0');
  setRowTime(tr, time);
}

// Set a slot's time; the slots after it follow (earlier or later). Updates in place unless the order changed.
function setRowTime(tr, time) {
  const { field, section } = tr.dataset;
  const rows = boardRows(section, field);
  const r = rows.find(x => x.id === tr.dataset.row);
  if (time === r.t) return;
  const order = rows.map(x => x.id).join();
  r.t = r.base = time;
  r.pinned = true;
  rows.sort((a, b) => a.t - b.t);
  // Every slot after this one follows from the new time, earlier or later.
  rows.slice(rows.indexOf(r) + 1).forEach(x => { x.pinned = false; });
  reflow(section, field);
  syncRow(ui.boardDate, field, r);
  save();
  if (rows.map(x => x.id).join() === order) patchBoardTimes(section, field);
  else redrawBoard();
}

// Refresh times, pins and ✓/⚠ marks without rebuilding the board, so a box you just clicked keeps focus.
function patchBoardTimes(section, field) {
  boardRows(section, field).forEach(r => {
    const tr = document.querySelector(`.board tr[data-row="${r.id}"]`);
    if (!tr) return;
    const cell = tr.querySelector('.b-time-cell');
    const hour = cell.querySelector('.tp-h');
    if (document.activeElement && cell.contains(document.activeElement)) {
      cell.querySelector('.tp-ap').textContent = r.t >= 12 * 60 ? 'PM' : 'AM';
    } else {
      cell.querySelector('.tpick').outerHTML = timePicker(r.t, hour.disabled);
    }
    const { status, clash } = rowStatus(ui.boardDate, field, r);
    tr.querySelector('.b-status').innerHTML = status;
    tr.classList.toggle('clash', clash);
  });
}

// Hour/minute boxes: digits only, whole value selected on click so typing replaces it,
// Enter saves, ↑/↓ nudge (minutes by 5).
let keepTimeSelection = null;
document.addEventListener('focusin', e => {
  if (!e.target.matches || !e.target.matches('.tpick input')) return;
  e.target.select();
  keepTimeSelection = e.target;
});
document.addEventListener('mouseup', e => {
  if (e.target === keepTimeSelection) e.preventDefault();
  keepTimeSelection = null;
});
document.addEventListener('input', e => {
  if (e.target.matches && e.target.matches('.tpick input')) e.target.value = e.target.value.replace(/\D/g, '');
});
document.addEventListener('keydown', e => {
  if (!e.target.matches || !e.target.matches('.tpick input')) return;
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = e.key === 'ArrowUp' ? 1 : -1;
    const box = e.target;
    const v = parseInt(box.value, 10) || 0;
    box.value = box.matches('.tp-h') ? ((v - 1 + step + 12) % 12) + 1 : String((Math.round(v / 5) * 5 + step * 5 + 60) % 60).padStart(2, '0');
    box.select();
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

function pageAdminTeams() {
  const teams = state.teams[ui.adminDiv] || [];
  // Teams kept off the standings (not official yet) are listed below with the withdrawn ones.
  const offTable = hiddenFromStandings(ui.adminDiv);
  return adminShell('admin/teams', `
    <h1 class="page-title">${t('teams')}</h1>
    <div class="toolbar">${divPills(ui.adminDiv, 'data-admin-div', { tours: true })}</div>
    ${isTour(DIVISIONS.find(d => d.id === ui.adminDiv)) ? `<p class="note">${t('tourTeamsNote')} <a href="#/admin/tournaments" data-action="open-tour" data-id="${DIVISIONS.find(d => d.id === ui.adminDiv).tournament}">${t('openTournament')} →</a></p>` : ''}
    <div class="team-list">${teams.map((n, i) => {
      if (offTable.has(n)) return '';
      return `<div class="team-item">${teamBadge(n, false, ui.adminDiv)}
        <span class="grow"><strong>${esc(n)}</strong></span>
        <button class="icon-btn" data-action="edit-team" data-idx="${i}" aria-label="${t('editTeam')}" title="${t('editTeam')}">✎</button>
        <button class="icon-btn danger" data-action="ask" data-confirm="rm-team" data-idx="${i}" aria-label="${t('remove')}">×</button></div>`;
    }).join('')}</div>
    <button type="button" class="btn btn-gold add-team-btn" data-action="open-add-team">＋ ${t('addTeam')}</button>
    ${withdrawnIn(ui.adminDiv).length || hiddenTeams(ui.adminDiv).length || offTable.size ? `<section class="reg-section">
      <h2 class="section-title">${t('withdrawnHidden')}</h2>
      <p class="note">${t('withdrawnHiddenHelp')}</p>
      <div class="team-list hidden-list">${teams.map((n, i) => (offTable.has(n) ? `<div class="team-item is-withdrawn">${teamBadge(n, false, ui.adminDiv)}
        <span class="grow"><strong>${esc(n)}</strong><small class="muted"> · ${t('hiddenFromStandingsTag')}</small></span>
        <button class="icon-btn" data-action="edit-team" data-idx="${i}" aria-label="${t('editTeam')}" title="${t('editTeam')}">✎</button>
        <button class="btn btn-sm btn-outline" data-action="show-standings" data-team="${esc(n)}">${t('showInStandings')}</button>
        <button class="icon-btn danger" data-action="ask" data-confirm="rm-team" data-idx="${i}" aria-label="${t('remove')}">×</button></div>` : '')).join('')}
      ${withdrawnIn(ui.adminDiv).map(w => `<div class="team-item is-withdrawn">${teamBadge(w.team, false, w.div)}
        <span class="grow"><strong>${esc(w.team)}</strong><small class="muted"> · ${t('withdrawnOn')} ${fmtDate(w.on)} · ${esc(withdrawSummary(w))}</small></span>
        <button class="btn btn-sm btn-outline" data-action="bring-team-back" data-key="${esc(`${w.div}|${w.team}`)}">${t('bringBack')}</button></div>`).join('')}
      ${hiddenTeams(ui.adminDiv).map(h => `<div class="team-item is-withdrawn">${teamBadge(h.team, false, ui.adminDiv)}
        <span class="grow"><strong>${esc(h.team)}</strong><small class="muted"> · ${t(h.kind === 'copaOnly' ? 'copaOnlyTeam' : 'replacementTeam')}${h.games ? ` · ${gamesCount(h.games)}` : ''}</small></span>
        <button class="icon-btn" data-action="edit-hidden" data-team="${esc(h.team)}" aria-label="${t('editTeam')}" title="${t('editTeam')}">✎</button>
        <button class="btn btn-sm btn-outline" data-action="hidden-join-open" data-team="${esc(h.team)}">${t('joinLeague')}</button></div>`).join('')}</div>
    </section>` : ''}
    ${archivedIn(ui.adminDiv).length ? `<section class="reg-section">
      <h2 class="section-title">${t('archivedTeams')}</h2>
      <p class="note">${t('archivedTeamsHelp')}</p>
      <div class="team-list hidden-list">${archivedIn(ui.adminDiv).map(a => `<div class="team-item is-withdrawn">${archivedBadge(a)}
        <span class="grow"><strong>${esc(a.name)}</strong><small class="muted"> · ${esc(archivedWhere(a))}</small></span>
        <button class="icon-btn" data-action="edit-archived" data-name="${esc(a.name)}" aria-label="${t('editTeam')}" title="${t('editTeam')}">✎</button>
        <button class="btn btn-sm btn-outline" data-action="archived-back" data-name="${esc(a.name)}">${t('bringBack')}</button>
        <button class="icon-btn danger" data-action="ask" data-confirm="rm-archived" data-name="${esc(a.name)}" data-ask="askRmArchived" aria-label="${t('remove')}">×</button></div>`).join('')}</div>
    </section>` : ''}`);
}

// "Withdraw" a team that left the league: asks whether its results stay for the other teams.
function openWithdraw(name) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form data-form="withdraw-team" data-team="${esc(name)}">
    <h2>${t('withdraw')} ${esc(name)}</h2>
    <p class="note">${t('withdrawHelp')}</p>
    ${WITHDRAW_OPTS.map(k => `<label class="radio-line"><input type="checkbox" name="${k}" checked> <span><b>${t(`w_${k}`)}</b><small class="muted">${t(`w_${k}Help`)}</small></span></label>`).join('')}
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
      <button type="submit" class="btn btn-danger">${t('withdraw')}</button>
    </div>
  </form>`;
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// Short list of what was picked, for the Teams page and History.
const withdrawSummary = w => (wOpts(w).wipePlayed ? t('withdrawVoidShort')
  : WITHDRAW_OPTS.filter(k => wOpts(w)[k]).map(k => t(`w_${k}Short`)).join(', ') || t('withdrawKeepShort'));

function withdrawTeam(form) {
  const div = ui.adminDiv, team = form.dataset.team;
  const opts = Object.fromEntries(WITHDRAW_OPTS.map(k => [k, form.querySelector(`[name=${k}]`).checked]));
  undoable(`${t('teamWithdrawn')}: ${team}`);
  const list = state.teams[div] || [];
  const idx = list.indexOf(team);
  if (idx >= 0) list.splice(idx, 1);
  // Their games that haven't been played come off the schedule; they're kept with the withdrawal.
  const left = state.matches.filter(m => m.div === div && !played(m) && (m.home === team || m.away === team));
  state.matches = state.matches.filter(m => !left.includes(m));
  const w = { div, team, opts, on: todayISO(), idx, left: left.map(m => ({ ...m, left: true })) };
  state.withdrawn = { ...(state.withdrawn || {}), [`${div}|${team}`]: w };
  touch(div);
  logAction(`${t('teamWithdrawn')} · ${divName(div)}: ${team} · ${withdrawSummary(w)}`);
  save();
  closeDialog(form.closest('dialog'));
  render();
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
  dialog.remove();
}

// A team's logo if one was added, otherwise its initials. Logos are kept by team name.
function teamBadge(name, big, div) {
  const logo = teamLogo(name, div);
  return `<span class="team-badge ${big ? 'big' : ''} ${logo ? 'has-logo' : ''}">${logo
    ? `<img src="${logo}" alt="">`
    : esc(name.slice(0, 2).toUpperCase())}</span>`;
}

// Shrink an uploaded image to a small square logo (keeps the whole image, transparent padding).
function readLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Pop-up to change a team's logo and name. Other divisions with the same name can be renamed too.
function openEditTeam(name) {
  const others = DIVISIONS.filter(d => d.id !== ui.adminDiv && (state.teams[d.id] || []).includes(name));
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form data-form="edit-team" data-old="${esc(name)}">
    <h2>${t('editTeam')}</h2>
    <div class="logo-edit">
      <span class="logo-preview">${teamBadge(name, true, ui.adminDiv)}</span>
      <div class="logo-actions">
        <label class="btn btn-outline btn-sm">${t(teamLogo(name, ui.adminDiv) ? 'changeLogo' : 'uploadLogo')}<input type="file" accept="image/*" data-logo-input hidden></label>
        <button type="button" class="link-btn small" data-action="remove-logo" ${teamLogo(name, ui.adminDiv) ? '' : 'hidden'}>${t('removeLogo')}</button>
        <small class="muted">${t('logoHint')}</small>
      </div>
    </div>
    <label class="field">${t('teamName')}<input class="input" name="name" value="${esc(name)}" required autocomplete="off"></label>
    ${others.length ? `<p class="field-label">${t('alsoRename')}</p>
      <div class="div-checks">${others.map(d => `<label class="check-pill"><input type="checkbox" name="divs" value="${d.id}"><span>${esc(divName(d.id))}</span></label>`).join('')}</div>` : ''}
    <label class="strict-toggle hide-standings"><input type="checkbox" name="hideStandings" ${hiddenFromStandings(ui.adminDiv).has(name) ? 'checked' : ''}><span class="switch" aria-hidden="true"></span><span>${t('hideFromStandings')}</span></label>
    <small class="muted">${t('hideFromStandingsHelp')}</small>
    <p class="warn" hidden></p>
    ${mergeBoxHTML(name)}
    ${addToDivBoxHTML(name)}
    <div class="modal-actions">
      <button type="button" class="btn btn-outline danger-outline withdraw-link" data-action="withdraw-from-edit" data-team="${esc(name)}">${t('withdrawFromLeague')}</button>
      <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
      <button type="submit" class="btn btn-gold">${t('save')}</button>
    </div>
  </form>`;
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// Rename a team inside one division everywhere it appears: team list, matches, goleadores, match-day slots.
function renameTeam(div, from, to) {
  const list = state.teams[div] = state.teams[div] || [];
  if (list.includes(from)) list[list.indexOf(from)] = to;
  state.matches.forEach(m => {
    if (m.div !== div) return;
    if (m.home === from) m.home = to;
    if (m.away === from) m.away = to;
  });
  state.scorers.forEach(s => { if (s.div === div && s.team === from) s.team = to; });
  Object.values(state.matchDays || {}).forEach(day => Object.values(day).forEach(sec => Object.values(sec).forEach(rows => rows.forEach(r => {
    if (r.div !== div) return;
    if (r.home === from) r.home = to;
    if (r.away === from) r.away = to;
  }))));
  // The new name keeps the team's rotation number, playoff/Copa spots, forfeits and red cards.
  const rot = (state.rotation || {})[div];
  if (rot) [rot, ...Object.values(rot.past || {})].forEach(r => Object.keys(r.numbers).forEach(k => { if (r.numbers[k] === from) r.numbers[k] = to; }));
  const swap = l => l.map(x => (x === from ? to : x));
  const po = playoffsOf(div);
  if (po) po.seeds = swap(po.seeds);
  const co = copaOf(div);
  if (co) {
    co.teams = swap(co.teams); (co.groups || []).forEach(g => { g.teams = swap(g.teams); });
    if (co.ko) { co.ko.seeds = swap(co.ko.seeds); co.ko.out = swap(co.ko.out || []); Object.keys(co.ko.picks || {}).forEach(k => { if (co.ko.picks[k] === from) co.ko.picks[k] = to; }); }
  }
  Object.values(state.matchDays || {}).forEach(day => Object.values(day).forEach(sec => Object.values(sec).forEach(rows => rows.forEach(r => {
    if (r.hold && r.hold.div === div) { if (r.hHome === from) r.hHome = to; if (r.hAway === from) r.hAway = to; }
  }))));
  if (state.logos && state.logos[`${div}|${from}`]) { state.logos[`${div}|${to}`] = state.logos[`${div}|${from}`]; delete state.logos[`${div}|${from}`]; }
  state.matches.forEach(m => { if (m.div === div && m.forfeitBy === from) m.forfeitBy = to; });
  Object.values(state.withdrawn || {}).forEach(w => (w.left || []).forEach(m => {
    if (m.div !== div) return;
    if (m.home === from) m.home = to;
    if (m.away === from) m.away = to;
  }));
  (state.redCards || []).forEach(c => { if (c.div === div && c.team === from) c.team = to; });
}

function saveEditTeam(form) {
  const from = form.dataset.old;
  const to = form.querySelector('[name=name]').value.trim();
  const warn = form.querySelector('.warn');
  if (!to) return;
  const divs = [ui.adminDiv, ...[...form.querySelectorAll('input[name=divs]:checked')].map(i => i.value)];
  if (to !== from) {
    const taken = divs.filter(d => state.teams[d].some(n => n !== from && n.toLowerCase() === to.toLowerCase()));
    if (taken.length) {
      warn.textContent = `${t('nameTaken')} ${taken.map(divName).join(', ')}`;
      warn.hidden = false;
      return;
    }
    divs.forEach(d => renameTeam(d, from, to));
  }
  state.logos = state.logos || {};
  const pending = form.closest('dialog').dataset.logo;
  const divKey = `${ui.adminDiv}|${to}`;
  const logoKey = divKey in state.logos || divKey in LOGO_EXCEPTIONS || divKey in DIVISION_LOGOS ? divKey : to;
  if (pending !== undefined) state.logos[logoKey] = pending;
  // Renamed: each renamed division keeps the picture it had (saved for that division only, so another club
  // with the new name elsewhere keeps its own logo).
  else if (to !== from) divs.forEach(d => { const had = teamLogo(from, d); if (had && !teamLogo(to, d)) state.logos[`${d}|${to}`] = had; });
  // Drop the old name's logo once nothing uses that name any more.
  if (to !== from && !Object.values(state.teams).some(l => l.includes(from))) delete state.logos[from];
  // hidden from the standings (or shown again), under its new name if it was renamed
  const hide = form.querySelector('[name=hideStandings]').checked;
  const list = [...hiddenFromStandings(ui.adminDiv)].filter(x => x !== from && x !== to);
  state.standingsHidden = { ...(state.standingsHidden || {}), [ui.adminDiv]: hide ? [...list, to] : list };
  divs.forEach(d => touch(d));
  logAction(`${t('logTeamEdited')}: ${from}${to !== from ? ` → ${to}` : ''}${hide ? ` · ${t('hiddenFromStandingsTag')}` : ''}`);
  save();
  closeDialog(form.closest('dialog'));
  render();
  toast(to !== from ? `${from} → ${to}` : t('saved'));
}

// A hidden team (replacement or Copa only): change its name or logo. The name changes in its games too.
function openEditHidden(name) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form data-form="edit-hidden" data-old="${esc(name)}">
    <h2>${t('editTeam')}</h2>
    <div class="logo-edit">
      <span class="logo-preview">${teamBadge(name, true, ui.adminDiv)}</span>
      <div class="logo-actions">
        <label class="btn btn-outline btn-sm">${t(teamLogo(name, ui.adminDiv) ? 'changeLogo' : 'uploadLogo')}<input type="file" accept="image/*" data-logo-input hidden></label>
        <button type="button" class="link-btn small" data-action="remove-logo" ${teamLogo(name, ui.adminDiv) ? '' : 'hidden'}>${t('removeLogo')}</button>
        <small class="muted">${t('logoHint')}</small>
      </div>
    </div>
    <label class="field">${t('teamName')}<input class="input" name="name" value="${esc(name)}" required autocomplete="off"></label>
    <p class="warn" hidden></p>
    ${mergeBoxHTML(name)}
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
      <button type="submit" class="btn btn-gold">${t('save')}</button>
    </div>
  </form>`;
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

function renameHidden(div, from, to) {
  state.matches.forEach(m => {
    if (m.div !== div) return;
    if (m.fillerTeam === from) m.fillerTeam = to;
    if (m.home === from) m.home = to;
    if (m.away === from) m.away = to;
  });
  const co = copaOf(div);
  if (co) {
    const swap = l => l.map(x => (x === from ? to : x));
    co.teams = swap(co.teams);
    if (co.ko) co.ko.seeds = swap(co.ko.seeds);
    (co.groups || []).forEach(g => { g.teams = swap(g.teams); });
  }
  const logos = state.logos || {};
  if (logos[`${div}|${from}`] && !logos[`${div}|${to}`]) logos[`${div}|${to}`] = logos[`${div}|${from}`];
}

// ---------- combining two teams (the same team entered twice, e.g. a misspelled name) ----------
// Everything of `from` in this division becomes `to`: games, goals, Goleadores, red cards, rotation number,
// playoffs/Copa spots and the logo if `to` has none. Goals are matched up game by game, not by column.
function mergeTeams(div, from, to) {
  const players = state.scorers.filter(s => s.div === div && (s.team === from || s.team === to));
  const byGame = new Map(players.map(s => {
    const games = colGames(div, s.team);
    return [s, new Map(games.map((m, i) => [m && m.id, s.games[i] || 0]).filter(([id]) => id))];
  }));
  state.matches.forEach(m => {
    if (m.div !== div) return;
    if (m.home === from) m.home = to;
    if (m.away === from) m.away = to;
    if (m.fillerTeam === from) m.fillerTeam = to;
    if (m.forfeitBy === from) m.forfeitBy = to;
  });
  Object.values(state.withdrawn || {}).forEach(w => (w.left || []).forEach(m => {
    if (m.div !== div) return;
    if (m.home === from) m.home = to;
    if (m.away === from) m.away = to;
  }));
  Object.values(state.matchDays || {}).forEach(day => Object.values(day).forEach(sec => Object.values(sec).forEach(rows => rows.forEach(r => {
    if (r.div !== div && r.fdiv !== div) return;
    if (r.home === from) r.home = to;
    if (r.away === from) r.away = to;
  }))));
  const list = state.teams[div] || [];
  if (list.includes(from)) state.teams[div] = list.includes(to) ? list.filter(x => x !== from) : list.map(x => (x === from ? to : x));
  const swap = l => [...new Set(l.map(x => (x === from ? to : x)))];
  const po = playoffsOf(div);
  if (po) po.seeds = swap(po.seeds);
  const co = copaOf(div);
  if (co) { co.teams = swap(co.teams); if (co.ko) co.ko.seeds = swap(co.ko.seeds); (co.groups || []).forEach(g => { g.teams = swap(g.teams); }); }
  const rot = (state.rotation || {})[div];
  if (rot) {
    const mine = Object.keys(rot.numbers).find(k => rot.numbers[k] === from);
    const theirs = Object.keys(rot.numbers).find(k => rot.numbers[k] === to);
    if (mine && !theirs) rot.numbers[mine] = to; else if (mine) delete rot.numbers[mine];
  }
  (state.redCards || []).forEach(c => { if (c.div === div && c.team === from) c.team = to; });
  const logos = state.logos || {};
  if (!teamLogo(to, div) && teamLogo(from, div)) logos[`${div}|${to}`] = teamLogo(from, div);
  delete logos[`${div}|${from}`];
  // Goleadores: same player name on both → one player; goals put back in the right game columns.
  const games = colGames(div, to);
  const keep = new Map();
  players.forEach(s => {
    const key = s.own ? `\u0000own${s.own}` : s.name.trim().toLowerCase();
    const goals = byGame.get(s);
    if (keep.has(key)) {
      const k = keep.get(key);
      goals.forEach((n, id) => k.goals.set(id, (k.goals.get(id) || 0) + n));
      state.scorers = state.scorers.filter(x => x !== s);
    } else keep.set(key, { s, goals: new Map(goals) });
  });
  keep.forEach(({ s, goals }) => {
    s.team = to;
    s.games = Array.from({ length: games.length }, (_, i) => (games[i] && goals.get(games[i].id)) || 0);
    recount(s);
  });
  touch(div);
}

// Edit team → "Add this team to another division": the same club starts a team in other divisions (same name
// and logo). Picked like "Which divisions is this team in?"; the ones it's already in show picked and locked.
const divsWithout = name => DIVISIONS.filter(d => !isTour(d) && !(state.teams[d.id] || []).includes(name));
function addToDivBoxHTML(name) {
  if (!divsWithout(name).length) return '';
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  return `<details class="merge-box add-div-box"><summary>${t('addToDivTitle')}</summary>
    <p class="note">${t('addToDivHelp').replace('{x}', esc(name))}</p>
    ${groups.map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
      ${DIVISIONS.filter(d => d.group === g && !isTour(d)).map(d => {
        const has = (state.teams[d.id] || []).includes(name);
        return `<label class="check-pill ${has ? 'in-already' : ''}" ${has ? `title="${t('alreadyIn')}"` : ''}><input type="checkbox" name="toDivs" value="${d.id}" ${has ? 'checked disabled' : ''}><span>${esc(divName(d.id))}</span></label>`;
      }).join('')}
    </fieldset>`).join('')}
    <button type="button" class="btn btn-sm btn-gold" data-action="team-to-div" data-team="${esc(name)}">＋ ${t('addToDivBtn')}</button>
  </details>`;
}

function mergeBoxHTML(name) {
  const div = ui.adminDiv;
  const others = [...new Set([...(state.teams[div] || []), ...hiddenTeams(div).map(h => h.team)])].filter(x => x !== name).sort((a, b) => a.localeCompare(b));
  if (!others.length) return '';
  return `<details class="merge-box"><summary>${t('mergeTitle')}</summary>
    <p class="note">${t('mergeHelp').replace('{x}', esc(name))}</p>
    <div class="merge-row"><select class="select" name="mergeTo" aria-label="${t('team')}">${others.map(x => `<option>${esc(x)}</option>`).join('')}</select>
    <button type="button" class="btn btn-sm btn-outline danger-outline" data-action="ask" data-confirm="merge-team" data-from="${esc(name)}" data-ask="askMerge" data-yes="yesMerge">${t('mergeBtn')}</button></div>
  </details>`;
}

function saveEditHidden(form) {
  const div = ui.adminDiv, from = form.dataset.old, to = form.name.value.trim();
  const warn = form.querySelector('.warn');
  if (!to) return;
  if (to !== from && [...(state.teams[div] || []), ...hiddenTeams(div).map(h => h.team)].some(n => n !== from && n.toLowerCase() === to.toLowerCase())) {
    warn.textContent = `${t('nameTaken')} ${divName(div)}`; warn.hidden = false; return;
  }
  if (to !== from) renameHidden(div, from, to);
  state.logos = state.logos || {};
  const pending = form.closest('dialog').dataset.logo;
  if (pending !== undefined) state.logos[`${div}|${to}`] = pending;
  else if (to !== from && state.logos[`${div}|${from}`]) state.logos[`${div}|${to}`] = state.logos[`${div}|${from}`];
  if (to !== from) delete state.logos[`${div}|${from}`];
  touch(div);
  logAction(`${t('logTeamEdited')}: ${from}${to !== from ? ` → ${to}` : ''}`);
  save();
  closeDialog(form.closest('dialog'));
  render();
}

// Pop-up to add one team name to several divisions at once (the current division starts checked).
// `join` is a hidden team (replacement or Copa only) joining the league: its name and logo start filled in.
// ---------- archived teams ----------
// Teams from past seasons, listed under every division they played in (Teams page). Withdrawn teams land
// here when their division starts a new season. { [name]: { name, logo, divs: { [div]: { season, on } } } }
const archivedTeams = () => Object.values(state.archivedTeams || {});
const archivedIn = div => archivedTeams().filter(a => a.divs[div]).sort((x, y) => x.name.localeCompare(y.name));
function archiveTeam(name, div, season) {
  state.archivedTeams = state.archivedTeams || {};
  const a = state.archivedTeams[name] || (state.archivedTeams[name] = { name, logo: '', divs: {} });
  a.logo = a.logo || teamLogo(name, div) || '';
  a.divs[div] = { season: season || '', on: todayISO() };
}
const archivedBadge = a => `<span class="team-badge ${a.logo ? 'has-logo' : ''}">${a.logo ? `<img src="${a.logo}" alt="">` : esc(a.name.slice(0, 2).toUpperCase())}</span>`;
const archivedWhere = a => DIVISIONS.filter(d => a.divs[d.id]).map(d => `${divName(d.id)}${a.divs[d.id].season ? ` (${a.divs[d.id].season})` : ''}`).join(' · ');
// Division pills, grouped like Add team; `on` = the ones picked.
function divPillsHTML(name, on) {
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  return groups.map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
    ${DIVISIONS.filter(d => d.group === g && !isTour(d)).map(d => `<label class="check-pill"><input type="checkbox" name="${name}" value="${d.id}" ${on.includes(d.id) ? 'checked' : ''}><span>${esc(divName(d.id))}</span></label>`).join('')}
  </fieldset>`).join('');
}
const logoEditHTML = (badge, has) => `<div class="logo-edit">
    <span class="logo-preview">${badge}</span>
    <div class="logo-actions">
      <label class="btn btn-outline btn-sm">${t(has ? 'changeLogo' : 'uploadLogo')}<input type="file" accept="image/*" data-logo-input hidden></label>
      <button type="button" class="link-btn small" data-action="remove-logo" ${has ? '' : 'hidden'}>${t('removeLogo')}</button>
      <small class="muted">${t('logoHint')}</small>
    </div>
  </div>`;
// ✎ on an archived team: its name, logo and the divisions it played in.
function openEditArchived(name) {
  const a = (state.archivedTeams || {})[name];
  if (!a) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form data-form="edit-archived" data-old="${esc(name)}">
    <h2>${t('editTeam')}</h2>
    <p class="note">${t('archivedTag')}</p>
    <label class="field">${t('teamName')}<input class="input" name="name" value="${esc(a.name)}" required autocomplete="off"></label>
    ${logoEditHTML(archivedBadge(a).replace('team-badge', 'team-badge big'), !!a.logo)}
    <p class="field-label">${t('archivedDivs')}</p>
    ${divPillsHTML('divs', Object.keys(a.divs))}
    <p class="warn" hidden></p>
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
      <button type="submit" class="btn btn-gold">${t('save')}</button>
    </div>
  </form>`;
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}
function saveEditArchived(form) {
  const from = form.dataset.old, a = (state.archivedTeams || {})[from], to = form.name.value.trim();
  const warn = form.querySelector('.warn');
  const divs = [...form.querySelectorAll('[name=divs]:checked')].map(x => x.value);
  if (!a || !to) return;
  if (!divs.length) { warn.textContent = t('pickDivision'); warn.hidden = false; return; }
  if (to !== from && state.archivedTeams[to]) { warn.textContent = t('nameTakenArchived'); warn.hidden = false; return; }
  const dialog = form.closest('dialog');
  if (dialog.dataset.logo !== undefined) a.logo = dialog.dataset.logo;
  a.divs = Object.fromEntries(divs.map(d => [d, a.divs[d] || { season: '', on: todayISO() }]));
  a.name = to;
  if (to !== from) { delete state.archivedTeams[from]; state.archivedTeams[to] = a; }
  logAction(`${t('archivedTeams')} · ${t('logTeamEdited')}: ${from}${to !== from ? ` → ${to}` : ''}`);
  save();
  closeDialog(dialog);
  render();
  toast(t('saved'));
}

// "＋ Add a team…" at the bottom of a division's team list. Picking it opens Add team for that division; the new
// team is then picked in the same list (found again by its data-addkey after the page redraws).
const addTeamOpt = () => `<option value="__addteam">＋ ${t('addTeamOption')}</option>`;
const addTeamAttrs = (div, key) => `data-adddiv="${esc(div)}" data-addkey="${esc(key)}"`;
function pickAddedTeam(key, name) {
  const sel = [...document.querySelectorAll('select[data-addkey]')].find(x => x.dataset.addkey === key);
  if (!sel || ![...sel.options].some(o => o.value === name || o.text === name)) return;
  sel.value = name;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

// A team that played as a replacement joining: tick which of those games count on its record (none by default).
function joinGamesHTML(name) {
  const key = (name || '').trim().toLowerCase();
  const games = key ? state.matches.filter(m => m.fillerTeam && m.fillerTeam.toLowerCase() === key && !m.countOnly && !m.fromFriendly && !m.fillerCounts && !(state.teams[m.div] || []).includes(m.fillerTeam)).sort(byDateTime) : [];
  if (!games.length) return '';
  return `<fieldset class="div-checks join-games-list"><legend>${t('joinGamesTitle')}</legend>
    <p class="note">${t('joinGamesHelp')}</p>
    ${games.map(m => {
      const us = m.fillerTeam, them = m.home === us ? m.away : m.home;
      const res = played(m) ? (() => { const a = m.home === us ? m.hs : m.as, b = m.home === us ? m.as : m.hs; return `${t(a > b ? 'joinW' : a < b ? 'joinL' : 'joinD')} ${a}–${b}`; })() : t('joinNotPlayed');
      return `<label class="check-pill join-game"><input type="checkbox" name="countGames" value="${m.id}"><span>${esc(divName(m.div))} · ${fmtDate(m.date)} · ${t('vs')} ${esc(them)} · ${esc(res)}</span></label>`;
    }).join('')}
  </fieldset>`;
}

// `archived`: bringing back an archived team (its name, logo and old divisions come filled in).
function openAddTeam(join = '', rest = false, div = ui.adminDiv, addKey = '', archived = null, prefill = '', note = '') {
  const groups = [['youth', 'youth'], ['adult', 'adults'], ['futsal', 'futsal']];
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  const logo = archived ? archived.logo : join && teamLogo(join, ui.adminDiv);
  const picked = archived ? Object.keys(archived.divs) : [div];
  dialog.innerHTML = `<form data-form="add-team" ${join ? `data-join="${esc(join)}"` : ''} ${rest ? `data-rest="${esc(div)}"` : ''} ${addKey ? `data-addkey="${esc(addKey)}"` : ''} ${archived ? `data-archived="${esc(archived.name)}"` : ''}>
    <h2>${t(join ? 'joinLeague' : archived ? 'bringBackTeam' : 'addTeam')}</h2>
    ${rest ? `<p class="note">${t('addTeamRestHelp').replace('{div}', esc(divName(div)))}</p>` : ''}
    ${join ? `<p class="note">${t('joinHelp')}</p>` : ''}
    ${archived ? `<p class="note">${t('bringBackTeamHelp')}</p>` : ''}
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <label class="field">${t('teamName')}<input class="input" name="name" required autocomplete="off" value="${esc(join || (archived ? archived.name : prefill))}"></label>
    <div class="join-games" data-join-games>${joinGamesHTML(join || prefill)}</div>
    <div class="logo-edit">
      <span class="logo-preview">${archived ? (logo ? `<span class="team-badge big has-logo"><img src="${logo}" alt=""></span>` : '<span class="team-badge big">＋</span>') : logo ? teamBadge(join, true, ui.adminDiv) : '<span class="team-badge big">＋</span>'}</span>
      <div class="logo-actions">
        <label class="btn btn-outline btn-sm">${t('uploadLogo')} <span class="muted">(${t('optional')})</span><input type="file" accept="image/*" data-logo-input hidden></label>
        <button type="button" class="link-btn small" data-action="remove-logo" hidden>${t('removeLogo')}</button>
        <small class="muted">${t('logoHint')}</small>
      </div>
    </div>
    <p class="field-label">${t('whichDivisions')}</p>
    ${groups.map(([g, label]) => `<fieldset class="div-checks"><legend>${t(label)}</legend>
      ${DIVISIONS.filter(d => d.group === g).map(d => `<label class="check-pill"><input type="checkbox" name="divs" value="${d.id}" ${picked.includes(d.id) ? 'checked' : ''}><span>${esc(divName(d.id))}</span></label>`).join('')}
    </fieldset>`).join('')}
    ${join ? '' : `<label class="strict-toggle hide-standings"><input type="checkbox" name="hideStandings"><span class="switch" aria-hidden="true"></span><span>${t('hideFromStandings')}</span></label>
    <small class="muted">${t('hideFromStandingsHelp')}</small>`}
    <p class="warn" hidden>${t('pickDivision')}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" data-action="close-dialog">${t('cancel')}</button>
      <button type="submit" class="btn btn-gold">${t(join ? 'joinLeague' : archived ? 'bringBack' : 'addTeam')}</button>
    </div>
  </form>`;
  document.querySelectorAll('dialog.modal').forEach(closeDialog);
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  if (archived && logo) { dialog.dataset.logo = logo; dialog.querySelector('[data-action=remove-logo]').hidden = false; }
  dialog.showModal();
  dialog.querySelector('[name=name]').focus();
}

// ---------- schedule generation ----------

// ---------- goleadores sheet (one row per player, one column per game) ----------

// Youth seasons are 15 games, adult seasons 14.
// Games in a division's season (set in Admin → Seasons). Youth seasons are usually 15, adult 14.
const gameColumns = div => (state.seasonGames && state.seasonGames[div]) || (groupOf(div) === 'youth' ? 15 : 14);
const BLANK_ROWS = 5;

function recount(s) {
  s.goals = s.games.reduce((n, g) => n + (g || 0), 0);
}

// A team's matches in order, so G1 is its first game, G2 its second, and so on.
// Games a withdrawn opponent had left still count in the order, so the columns don't shift.
function teamGames(div, team, past) {
  const matches = past ? [...past.matches, ...forfeitStubs(div, past.withdrawn || [], past.matches)] : [...state.matches, ...forfeitStubs(div)];
  return matches.filter(m => m.div === div && !m.playoff && (m.fillerTeam !== team || m.fillerCounts || fillsForForfeit(m, matches)) && (m.home === team || m.away === team)
    && !(m.forfeitBy && m.forfeitBy !== team && forfeitSwap(m, matches))).sort(byDateTime);
}

// The Goleadores sheet's columns follow the league's game numbers: G1 is the division's Game 1, G2 its
// Game 2… A week a team didn't play (joined late, a rest week) is an empty column. Returns the team's games
// by column (gaps where it had none) and how many game weeks there are so far.
function colGames(div, team, past) {
  const games = teamGames(div, team, past);
  if (past && past.scorerCols !== 'league') return Object.assign(games, { weeks: games.length }); // older seasons: the team's own order
  const all = past ? [...past.matches, ...forfeitStubs(div, past.withdrawn || [], past.matches)] : [...state.matches, ...forfeitStubs(div)];
  const days = [...new Set(all.filter(m => m.div === div && !m.playoff && !m.fromFriendly).map(m => m.date))].sort();
  const out = [];
  games.forEach(m => { const i = days.indexOf(m.date); if (i >= 0 && !out[i]) out[i] = m; });
  return Object.assign(out, { weeks: days.length, days });
}
// A week the team has no game in shows grey on Goleadores, once that day has come (a coming week may
// still get a game).
const noGameCol = (c, g) => !c[g] && g < c.weeks && !(c.days && c.days[g] > todayISO());
// Once: the columns used to follow each team's own games (G1 = its first game). Each team's goals move to
// the column of the game they were scored in. A team already typed by game number (its column totals match
// those games' scores better) stays as it is. Returns true if anything moved.
function upgradeGoalCols() {
  if (state.scorerCols === 'league') return false;
  const teams = new Map();
  state.scorers.forEach(x => { const k = `${x.div}\u0000${x.team}`; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(x); });
  teams.forEach(ps => {
    const { div, team } = ps[0];
    const old = teamGames(div, team), now = colGames(div, team);
    const scored = m => (m && played(m) ? (m.home === team ? m.hs : m.as) : null);
    let byOld = 0, byNow = 0;
    for (let i = 0; i < Math.max(0, ...ps.map(x => x.games.length)); i++) {
      const sum = ps.reduce((n, x) => n + (x.games[i] || 0), 0);
      if (!sum) continue;
      if (scored(old[i]) === sum) byOld++;
      if (scored(now[i]) === sum) byNow++;
    }
    if (byNow > byOld) return;
    ps.forEach(x => {
      const out = [];
      x.games.forEach((g, i) => {
        if (!g) return;
        const c = old[i] ? now.indexOf(old[i]) : -1, at = c >= 0 ? c : i;
        out[at] = (out[at] || 0) + g;
      });
      x.games = Array.from({ length: out.length }, (_, i) => out[i] || 0);
      recount(x);
    });
  });
  state.scorerCols = 'league';
  return true;
}

function sheetTeam() {
  const teams = [...(state.teams[ui.adminDiv] || [])].sort((a, b) => a.localeCompare(b));
  if (!teams.includes(ui.sheetTeam)) ui.sheetTeam = teams[0];
  return { teams, team: ui.sheetTeam };
}

// own: true = Default / Autogoal row, 'noname' = goals by a number that isn't on the roster (the team
// total adds up, but nobody gets them on Goleadores).
function sheetRow(s, cols, own, off = []) {
  const name = own
    ? `<span class="own-label">${t(own === 'noname' ? 'noNameGoal' : 'ownGoal')}</span>`
    : `<input class="cell name" value="${esc(s ? s.name : '')}" placeholder="${s ? '' : t('addPlayerRow')}" aria-label="${t('player')}">`;
  return `<tr data-sid="${s ? s.id : ''}" ${own ? `data-own="${own === 'noname' ? 'noname' : '1'}" class="own-row${own === 'noname' ? ' noname-row' : ''}"` : ''}>
    <td class="name-col">${name}</td>
    ${Array.from({ length: cols }, (_, g) => `<td class="${off[g] ? 'no-game' : ''}"><input class="cell g" data-g="${g}" inputmode="numeric" maxlength="2" value="${s && s.games[g] ? s.games[g] : ''}" aria-label="G${g + 1}"></td>`).join('')}
    <td class="total">${s ? s.goals : 0}</td>
    <td class="row-x">${own ? '' : s
      ? `<button class="icon-btn danger" data-action="ask" data-confirm="rm-scorer" data-sid="${s.id}" aria-label="${t('remove')}">×</button>`
      : `<button class="icon-btn danger" data-action="rm-blank-row" aria-label="${t('remove')}">×</button>`}</td>
  </tr>`;
}

function sheetFoot(div, team, cols) {
  const players = state.scorers.filter(s => s.div === div && s.team === team);
  const games = colGames(div, team);
  const cells = Array.from({ length: cols }, (_, g) => {
    const sum = players.reduce((n, s) => n + (s.games[g] || 0), 0);
    const m = games[g];
    if (noGameCol(games, g)) return `<td class="no-game" title="${esc(t('noGameThisWeek'))}">${sum || ''}</td>`;
    // every game the team played that day and that counts for it (two games in a day add up)
    const day = m ? teamGames(div, team).filter(x => x.date === m.date && !x.left) : [];
    const done = day.filter(played);
    const scored = done.length ? done.reduce((n, x) => n + (x.home === team ? x.hs : x.as), 0) : null;
    // red when the players' goals don't match the score, nothing entered yet included (0/4); 0/0 is fine
    const off = scored !== null && sum !== scored;
    const tip = day.map(x => `${fmtDate(x.date)} ${t('vs')} ${x.home === team ? x.away : x.home}${played(x) ? ` · ${t('scored')} ${x.home === team ? x.hs : x.as}` : ''}`).join(' + ');
    return `<td class="${off ? 'mismatch' : ''}" title="${esc(tip)}">${scored !== null ? `${sum}<small>/${scored}</small>` : sum || ''}</td>`;
  });
  return { cells, total: players.reduce((n, s) => n + s.goals, 0) };
}

// This division's teams whose player goals don't add up to a published score (game by game, like the
// sheet's bottom row): missing goals first, then too many.
function goalGaps(div) {
  const out = [];
  [...(state.teams[div] || [])].sort((a, b) => a.localeCompare(b)).forEach(team => {
    const players = state.scorers.filter(s => s.div === div && s.team === team);
    const games = colGames(div, team), gaps = [];
    games.forEach((m, g) => {
      if (!m) return;
      const done = teamGames(div, team).filter(x => x.date === m.date && !x.left && played(x));
      if (!done.length) return;
      const scored = done.reduce((n, x) => n + (x.home === team ? x.hs : x.as), 0);
      const entered = players.reduce((n, p) => n + (p.games[g] || 0), 0);
      if (entered !== scored) gaps.push({ g, date: m.date, scored, entered });
    });
    if (gaps.length) out.push({ team, gaps });
  });
  return out;
}
function goalGapsHTML(div) {
  const list = goalGaps(div);
  if (!list.length) return '';
  const open = !!ui.golesAlertOpen, n = list.length;
  return `<div class="goles-alert" role="status">
    <div class="goles-alert-head">
      <p class="goles-alert-title">⚠ ${t('goalGapsTitle').replace('{div}', esc(divName(div)))} <span class="muted">· ${n} ${t(n === 1 ? 'goalGapsTeam' : 'goalGapsTeams')}</span></p>
      <button type="button" class="btn btn-sm btn-outline" data-action="goles-alert-toggle" aria-expanded="${open}">${t(open ? 'goalGapsHide' : 'goalGapsShow')}</button>
    </div>
    <ul ${open ? '' : 'hidden'}>${list.map(({ team, gaps }) => `<li><button type="button" class="link-btn" data-action="goles-jump" data-team="${esc(team)}">${esc(team)}</button>
      ${gaps.map(x => `<span class="goles-gap">G${x.g + 1} · ${fmtDate(x.date)}: ${(x.entered < x.scored ? t('goalGapsMissing') : t('goalGapsExtra'))
        .replace('{e}', x.entered).replace('{s}', x.scored).replace('{n}', Math.abs(x.scored - x.entered))}</span>`).join('')}</li>`).join('')}</ul>
  </div>`;
}

function pageAdminScorers() {
  ui.adminDiv = scorerDiv(ui.adminDiv);
  const div = ui.adminDiv;
  const { teams, team } = sheetTeam();
  if (!team) return adminShell('admin/scorers', `<h1 class="page-title">${t('manageScorers')}</h1>${divPills(div, 'data-admin-div', { scorers: true })}${empty(t('noMatches'))}`);
  let players = state.scorers.filter(s => s.div === div && s.team === team && !s.own).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  // While typing, rows stay where they are (each change is still saved right away); Save puts them in
  // order by goals. New players go under the others.
  const key = `${div}|${team}`;
  if (ui.golesOrder && ui.golesOrder.key === key) {
    const pos = new Map(ui.golesOrder.ids.map((id, i) => [id, i]));
    const at = x => (pos.has(x.id) ? pos.get(x.id) : 1e9 + x.id);
    players = [...players].sort((a, b) => at(a) - at(b));
  }
  ui.golesOrder = { key, ids: players.map(x => x.id) };
  const own = state.scorers.find(s => s.div === div && s.team === team && s.own === true);
  const noname = state.scorers.find(s => s.div === div && s.team === team && s.own === 'noname');
  const byCol = colGames(div, team);
  const off = Array.from({ length: byCol.weeks }, (_, g) => noGameCol(byCol, g));
  const cols = Math.max(gameColumns(div), byCol.length, ...players.map(s => s.games.length));
  const foot = sheetFoot(div, team, cols);
  return adminShell('admin/scorers', `
    <h1 class="page-title">${t('manageScorers')}</h1>
    <div class="toolbar">${divPills(div, 'data-admin-div', { scorers: true })}</div>
    ${goalGapsHTML(div)}
    <div class="goles-head">
      <select class="select sheet-team" data-change="sheet-team" ${addTeamAttrs(div, 'sheet-team')} aria-label="${t('team')}">
        ${teams.map(n => `<option ${n === team ? 'selected' : ''}>${esc(n)}</option>`).join('')}${addTeamOpt()}
      </select>
      <p class="note">${t('sheetHelp')}</p>
    </div>
    ${teamBanner(team, div)}
    <div class="sheet-wrap">
      <table class="sheet" data-team="${esc(team)}" data-cols="${cols}">
        <thead><tr>
          <th class="name-col">${t('playerName')}</th>
          ${Array.from({ length: cols }, (_, g) => (noGameCol(byCol, g) ? `<th class="no-game" title="${esc(t('noGameThisWeek'))}">G${g + 1}</th>` : `<th>G${g + 1}</th>`)).join('')}
          <th class="total">${t('total')}</th><th class="row-x"></th>
        </tr></thead>
        <tbody>
          ${players.map(s => sheetRow(s, cols, false, off)).join('')}
          ${Array.from({ length: BLANK_ROWS }, () => sheetRow(null, cols, false, off)).join('')}
          ${sheetRow(noname, cols, 'noname', off)}
          ${sheetRow(own, cols, true, off)}
        </tbody>
        <tfoot><tr>
          <td class="name-col">${t('teamTotal')}</td>
          ${foot.cells.join('')}
          <td class="total">${foot.total}</td><td class="row-x"></td>
        </tr></tfoot>
      </table>
    </div>
    <div class="goles-actions">
      <button type="button" class="btn btn-gold" data-action="goles-save">${t('golesSave')}</button>
      <button type="button" class="btn btn-outline add-row" data-action="add-sheet-row">＋ ${t('addRow')}</button>
    </div>`);
}

// Save one row of the sheet (creating the player the first time a name or goal is typed).
function saveSheetRow(tr) {
  const table = tr.closest('table');
  const team = table.dataset.team;
  const games = [...tr.querySelectorAll('.cell.g')].map(c => parseInt(c.value, 10) || 0);
  let s = state.scorers.find(x => x.id === +tr.dataset.sid);
  if (!s) {
    const own = tr.dataset.own === '1' ? true : tr.dataset.own === 'noname' ? 'noname' : false;
    const name = own === true ? 'DEFAULT/AUTOGOAL' : own ? 'NO NAME' : tr.querySelector('.cell.name').value.trim();
    if (!name) return;
    s = { id: state.nextScorerId++, div: ui.adminDiv, name, team, games: [], goals: 0, own };
    state.scorers.push(s);
    tr.dataset.sid = s.id;
    if (!own) logAction(`${t('logPlayerAdded')} · ${divName(ui.adminDiv)}: ${name} (${team})`);
  } else if (!s.own) {
    const nm = tr.querySelector('.cell.name').value.trim();
    if (!nm) {
      // Erasing the name of a player with no goals takes the player off; with goals the name stays
      // (clear the goals first, or use ×).
      if (!games.some(Boolean)) {
        undoable(t('playerRemoved'));
        logAction(`${t('playerRemoved')} · ${divName(s.div)}: ${s.name} (${s.team}, ${s.goals} ${t('goalsWord')})`, { type: 'scorer', scorer: clone(s) });
        state.scorers = state.scorers.filter(x => x.id !== s.id);
        touch(ui.adminDiv); save(); return render();
      }
      tr.querySelector('.cell.name').value = s.name;
      toast(t('nameNeededGoals'));
    } else s.name = nm;
  }
  s.games = games;
  while (s.games.length && !s.games[s.games.length - 1]) s.games.pop();
  recount(s);
  tr.querySelector('.total').textContent = s.goals;
  const foot = sheetFoot(ui.adminDiv, team, +table.dataset.cols);
  const footCells = table.querySelectorAll('tfoot td');
  foot.cells.forEach((html, i) => { footCells[i + 1].outerHTML = html; });
  table.querySelector('tfoot td.total').textContent = foot.total;
  // the notice at the top follows along
  const alert = document.querySelector('.goles-alert'), fresh = goalGapsHTML(ui.adminDiv);
  if (alert) { if (fresh) alert.outerHTML = fresh; else alert.remove(); }
  else if (fresh) document.querySelector('.goles-head')?.insertAdjacentHTML('beforebegin', fresh);
  touch(ui.adminDiv);
  save();
}

// ---------- layout ----------

function renderHeader(route) {
  // Admin pages get their own simple header (no public menu), so the two menus don't get mixed up.
  if (route.startsWith('admin')) {
    document.getElementById('site-header').innerHTML = `
    <div class="wrap header-inner admin-header">
      <a class="brand" href="#/admin">${LOGO}<span>LA Alhambra<b>Soccer League</b></span></a>
      <span class="admin-badge">${t('admin')}</span>
      <div class="header-tools">
        <div class="lang" role="group" aria-label="Language">
          <button data-lang="en" class="${LANG === 'en' ? 'active' : ''}">EN</button>
          <button data-lang="es" class="${LANG === 'es' ? 'active' : ''}">ES</button>
        </div>
        <a class="btn btn-sm btn-outline-gold view-site" href="#/" target="_blank" rel="noopener">${t('viewSite')} ↗</a>
      </div>
      <button class="menu-btn" data-action="admin-menu" aria-label="${t('menuWord')}" aria-expanded="${!!ui.adminMenuOpen}">☰</button>
    </div>`;
    return;
  }
  const links = [['', 'home'], ['register', 'register'], ['scores', 'scores'], ['scorers', 'scorers'], ['standings', 'standings'],
    ...(Object.keys(state.playoffs || {}).length || Object.keys(state.copa || {}).length || tournaments().length ? [['playoffs', 'playoffs']] : []), ['about', 'aboutUs']];
  document.getElementById('site-header').innerHTML = `
    <div class="wrap header-inner">
      <a class="brand" href="#/">${LOGO}<span>LA Alhambra<b>Soccer League</b></span></a>
      <button class="menu-btn" data-action="menu" aria-label="Menu" aria-expanded="${ui.menuOpen}">☰</button>
      <nav class="nav ${ui.menuOpen ? 'open' : ''}">
        ${links.map(([r, k, external]) => external
          ? `<a href="${r}" target="_blank" rel="noopener">${t(k)} <small class="ext">↗</small></a>`
          : `<a href="#/${r}" class="${route === r ? 'active' : ''}">${t(k)}</a>`).join('')}
        <div class="header-tools">
          <div class="lang" role="group" aria-label="Language">
            <button data-lang="en" class="${LANG === 'en' ? 'active' : ''}">EN</button>
            <button data-lang="es" class="${LANG === 'es' ? 'active' : ''}">ES</button>
          </div>
          <a class="btn btn-sm btn-outline-gold ${route.startsWith('admin') ? 'active' : ''}" href="#/admin">${t('admin')}</a>
        </div>
      </nav>
    </div>`;
}

// The league's Instagram, promoted on every public page and in the footer.
const INSTAGRAM = { url: 'https://www.instagram.com/la.alhambra.soccer', handle: '@la.alhambra.soccer' };
function instagramCard() {
  return `<a class="promo promo-insta" href="${INSTAGRAM.url}" target="_blank" rel="noopener">
      <img class="promo-insta-icon" src="images/instagram.png" alt="">
      <div class="promo-text">
        <span class="eyebrow">Instagram</span>
        <h2>${t('followUs')}</h2>
        <p><b>${INSTAGRAM.handle}</b> · ${t('instaSub')}</p>
        <span class="btn btn-ghost btn-sm">${t('follow')} ↗</span>
      </div>
    </a>`;
}

function renderFooter() {
  document.getElementById('site-footer').innerHTML = `
    <div class="wrap footer-inner">
      <div class="brand">${LOGO}<span>LA Alhambra<b>Soccer League</b></span></div>
      <div><h4>${t('contact')}</h4><p>Alhambra, California<br>323-899-7156<br>laalhambrasoccerleague@gmail.com<br>${t('dmUs')} <a href="${INSTAGRAM.url}" target="_blank" rel="noopener">${INSTAGRAM.handle}</a></p></div>
      <div><h4>${t('links')}</h4><p>
        <a href="#/register">${t('registerNow')}</a><br>
        <a href="#/about">${t('aboutUs')}</a><br>
        <a href="#/archive">${t('archive')}</a>
      </p></div>
      <div><h4>${t('followUs')}</h4>
        <a class="footer-insta" href="${INSTAGRAM.url}" target="_blank" rel="noopener"><img src="images/instagram-glyph.png" alt="">${INSTAGRAM.handle}</a>
      </div>
    </div>
`;
}

const ROUTES = {
  '': pageHome, scores: pageScores, standings: pageStandings, playoffs: pagePlayoffs, scorers: pageScorers, fields: pageFields,
  register: pageRegister, about: pageAbout,
  admin: pageAdminDash, 'admin/scores': pageAdminScores, 'admin/scorers': pageAdminScorers,
  'admin/schedule': pageAdminSchedule, 'admin/teams': pageAdminTeams, 'admin/seasons': pageAdminSeasons, 'admin/fields': pageAdminFields,
  'admin/settings': pageAdminSettings, 'admin/history': pageAdminHistory, 'admin/redcards': pageAdminRedCards,
  'admin/teamgames': pageAdminTeamGames, 'admin/rotation': pageAdminRotation, 'admin/tournaments': pageAdminTournaments, 'admin/playoffs': pageAdminPlayoffs, 'admin/sheet': pageAdminSheet, 'admin/table': pageAdminTable, 'admin/regpage': pageAdminRegister, 'admin/homepage': pageAdminHome, 'admin/agechecks': pageAdminAgeChecks, 'admin/matchups': pageAdminTeamGames,
  archive: pageArchive,
};

function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '');
  return r in ROUTES ? r : '';
}

// On a phone the letter-size sheet is shrunk to fit the screen's width, the way a PDF preview is.
function fitSheet() {
  const box = document.querySelector('.sheet-scroll'), page = box && box.querySelector('.sheet-page');
  if (!page) return;
  page.style.zoom = '';
  const k = Math.min(1, box.clientWidth / page.offsetWidth);
  if (k < 1) page.style.zoom = k.toFixed(3);
}
window.addEventListener('resize', fitSheet);

// The admin pages open on the division (and Goleadores team) picked last, also after a refresh. A league
// added online only exists once the online data is in, so the saved one waits for it.
function keepAdminDiv() {
  const p = ui.adminDivPref;
  if (p) {
    if (DIVISIONS.some(d => d.id === p)) { ui.adminDiv = p; ui.adminDivPref = null; }
    else if (!cloudOn() || (typeof CLOUD !== 'undefined' && CLOUD.ready)) ui.adminDivPref = null;
  }
  try {
    if (!ui.adminDivPref) localStorage.setItem('asl-adiv', ui.adminDiv);
    if (ui.sheetTeam) localStorage.setItem('asl-steam', ui.sheetTeam); else localStorage.removeItem('asl-steam');
  } catch (e) {}
}
function render() {
  keepAdminDiv();
  // An admin whose account was removed is signed out.
  if (!cloudOn() && ui.admin && admins().length && !admins().some(a => a.id === readWho())) { ui.admin = false; writeFlag('asl-admin', false); writeWho(''); }
  fillHolds();
  syncRotationForfeits();
  const route = currentRoute();
  renderHeader(route);
  renderFooter();
  const page = route.startsWith('admin') && !ui.admin ? pageLogin : ROUTES[route];
  // Every public page starts with the Instagram block (the home page has it among its cards).
  const insta = !route.startsWith('admin') && route !== '' ? `<div class="wrap insta-strip">${instagramCard()}</div>` : '';
  document.getElementById('app').innerHTML = insta + page();
  refreshSaveAll();
  fitTiPreview();
  document.body.classList.toggle('is-admin', route.startsWith('admin'));
  fitSheet();
}

// ---------- events ----------

// Remove a match, including one that already has a score: its goals come off the Goleadores
// and the division's standings show as just updated.
function deleteMatch(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m) return;
  if (played(m)) {
    applyGoals(m, m.goals, -1);
    touch(m.div);
  }
  state.matches = state.matches.filter(x => x.id !== id);
}

function applyGoals(m, list, sign) {
  list.forEach(g => {
    const team = g.team === 'home' ? m.home : m.away;
    let s = state.scorers.find(x => x.div === m.div && x.name.toLowerCase() === g.name.toLowerCase() && x.team === team);
    if (!s) {
      if (sign < 0) return;
      s = { id: state.nextScorerId++, div: m.div, name: g.name, team, games: [], goals: 0 };
      state.scorers.push(s);
    }
    const game = colGames(m.div, team).findIndex(x => x && x.id === m.id);
    if (game < 0) return; // not a league game (playoff, friendly)
    s.games[game] = Math.max(0, (s.games[game] || 0) + sign * g.n);
    for (let i = 0; i < s.games.length; i++) s.games[i] = s.games[i] || 0;
    recount(s);
  });
}

// Close an open division dropdown when clicking anywhere else.
// Number boxes change only by typing: scrolling over a box that's being edited scrolls the page instead
// of nudging the number.
document.addEventListener('wheel', e => {
  if (e.target.matches && e.target.matches('input[type=number]') && document.activeElement === e.target) e.target.blur();
}, { passive: true });
document.addEventListener('toggle', e => {
  const id = e.target.dataset && e.target.dataset.box;
  if (!id) return;
  ui.openBoxes = ui.openBoxes || new Set();
  if (e.target.open) ui.openBoxes.add(id); else ui.openBoxes.delete(id);
}, true);
document.addEventListener('click', e => {
  document.querySelectorAll('details.dd[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
});

document.addEventListener('click', e => {
  const jump = e.target.closest('[data-scroll]');
  if (jump) { e.preventDefault(); document.getElementById(jump.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); return; }
  const el = e.target.closest('[data-action],[data-lang],[data-div],[data-admin-div],[data-filter],[data-rc-div],[data-pa-div]');
  if (!el) return;

  if (el.dataset.lang) { setLang(el.dataset.lang); return render(); }
  if (el.dataset.div) {
    ui.div = el.dataset.div; ui.team = ''; ui.scoreDay = null;
    try { localStorage.setItem('asl-div', ui.div); } catch (e) {}
    return render();
  }
  if (el.dataset.adminDiv) {
    ui.adminDiv = el.dataset.adminDiv; ui.sheetTeam = null; ui.adminScoreDay = null; ui.addGameOpen = false; ui.adminScoreTeam = '';
    if (el.tagName === 'BUTTON') return render();
    return;
  }
  if (el.dataset.filter) { ui.adminFilter = el.dataset.filter; return render(); }
  if (el.dataset.paDiv !== undefined) { ui.paFilter = el.dataset.paDiv; ui.paFinish = null; ui.paEdit = null; return render(); }
  if (el.dataset.rcDiv !== undefined) { ui.rcDiv = el.dataset.rcDiv; ui.rcEdit = null; ui.rcTeam = ''; return render(); }

  const form = el.closest('form');
  switch (el.dataset.action) {
    case 'menu': ui.menuOpen = !ui.menuOpen; return render();
    case 'admin-menu': {
      ui.adminMenuOpen = !ui.adminMenuOpen;
      el.setAttribute('aria-expanded', ui.adminMenuOpen);
      const nav = document.querySelector('.admin-nav');
      nav.classList.toggle('open', ui.adminMenuOpen);
      // Opens scrolled to the page you're on.
      const cur = nav.querySelector('a.active');
      if (ui.adminMenuOpen && cur) nav.scrollTop = Math.max(0, cur.offsetTop - nav.clientHeight / 3);
      return;
    }
    case 'toggle-pw': {
      const input = el.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.textContent = t(show ? 'hidePassword' : 'showPassword');
      el.setAttribute('aria-pressed', show);
      return input.focus();
    }
    case 'signout': if (cloudOn()) cloudSignOut(); ui.admin = false; writeFlag('asl-admin', false); writeWho(''); location.hash = '#/'; return;
    case 'cancel-copa': {
      const div = ui.adminDiv;
      state.matches = state.matches.filter(m => !(m.div === div && m.playoff && m.playoff.cup === 'copa'));
      delete state.copa[div];
      touch(div);
      logAction(`${t('cancelCopa')} · ${divName(div)}`);
      save(); return render();
    }
    case 'cancel-playoffs': {
      // Playoff games come off too (Undo in History brings everything back).
      const div = ui.adminDiv;
      state.matches = state.matches.filter(m => !(m.div === div && m.playoff && cupOfGame(m.playoff) === 'playoffs'));
      delete state.playoffs[div];
      touch(div);
      logAction(`${t('cancelPlayoffs')} · ${divName(div)}`);
      save(); return render();
    }
    case 'rot-clear': return setRotation(ui.adminDiv, { size: rotationOf(ui.adminDiv).size, numbers: {} }, t('clearNumbers'));
    case 'rm-admin': {
      const a = admins().find(x => x.id === el.dataset.id);
      if (!a) return;
      undoable(`${t('adminRemoved')}: ${a.name}`);
      state.admins = admins().filter(x => x.id !== a.id);
      logAction(`${t('adminRemoved')}: ${a.name} (${a.email})`);
      save(); return render();
    }
    // Opens a box under that admin for the new password (it's inside the Add admin form, so it uses buttons, not a form of its own).
    case 'admin-password':
      ui.pwEdit = ui.pwEdit === el.dataset.id ? null : el.dataset.id;
      render();
      return document.querySelector('.pw-edit input')?.focus();
    case 'admin-password-cancel': ui.pwEdit = null; return render();
    case 'admin-password-save': {
      const a = admins().find(x => x.id === el.dataset.id);
      const box = el.closest('.pw-edit'), pw = box.querySelector('input').value, warn = box.querySelector('.warn');
      if (!a) return;
      if (pw.length < 6) { warn.textContent = t('passwordShort'); warn.hidden = false; return box.querySelector('input').focus(); }
      return hashPassword(a.email, pw).then(h => {
        a.pwHash = h; ui.pwEdit = null;
        logAction(`${t('passwordChanged')}: ${a.name}`);
        save(); render(); toast(`${t('passwordChanged')}: ${a.name}`);
      });
    }
    case 'reset':
      // Online, everyone shares the data: there's no demo to reset.
      if (cloudOn()) return;
      if (confirm(t('confirmReset'))) {
        for (let i = DIVISIONS.length - 1; i >= 0; i--) if (DIVISIONS[i].custom) DIVISIONS.splice(i, 1);
        if (!DIVISIONS.some(d => d.id === ui.div)) ui.div = '40';
        if (!DIVISIONS.some(d => d.id === ui.adminDiv)) ui.adminDiv = '40';
        state = seedData(); applyFieldChanges(); save(); render();
      }
      return;
    case 'goles-save': {
      // every box is already saved as it's typed; this sends it right away and sorts the rows by goals
      ui.golesOrder = null;
      if (typeof cloudPush === 'function') cloudPush();
      render();
      return toast(t('golesSaved'));
    }
    case 'add-sheet-row': {
      const table = document.querySelector('.sheet');
      { const c = colGames(ui.adminDiv, table.dataset.team);
        table.querySelector('.own-row').insertAdjacentHTML('beforebegin', sheetRow(null, +table.dataset.cols, false, Array.from({ length: c.weeks }, (_, g) => noGameCol(c, g)))); }
      return table.querySelector('.own-row').previousElementSibling.querySelector('.cell.name').focus();
    }
    case 'board-section': ui.boardSection = el.dataset.section; return render();
    case 'score-day': {
      const { key } = el.dataset;
      const days = pickerDays(el.dataset.for, el.dataset.public === '1');
      const next = days[days.indexOf(ui[key]) + +el.dataset.step];
      if (next) ui[key] = next;
      return render();
    }
    case 'board-day': ui.boardDays[ui.boardSection] = +el.dataset.offset; return render();
    case 'day-shift': ui.boardWeek = addDays(ui.boardWeek, +el.dataset.days); return render();
    case 'open-move-day': ui.moveDay = { from: ui.boardDate, to: addDays(ui.boardDate, 7), push: true, mode: 'all', divs: [] }; ui.moveOther = false; return render();
    case 'move-mode': readMoveForm(el.closest('form')); ui.moveDay.mode = el.dataset.mode; return render();
    case 'close-move-day': ui.moveDay = null; return render();
    case 'toggle-length': ui.openLength = ui.openLength === el.dataset.id ? null : el.dataset.id; return redrawBoard();
    case 'len-step': case 'len-reset': {
      const { section, field, k, div } = el.closest('.len-row').dataset;
      state.gameLengths = state.gameLengths || {};
      const lengths = state.gameLengths[ui.boardDate] = state.gameLengths[ui.boardDate] || {};
      const key = `${section}|${field}|${k}`;
      if (el.dataset.action === 'len-reset') delete lengths[key];
      else lengths[key] = Math.min(150, Math.max(20, durationFor(ui.boardDate, section, field, div) + +el.dataset.step));
      if (lengths[key] === lengthFor(field, div)) delete lengths[key];
      reflow(section, field);
      save(); return redrawBoard();
    }
    case 'add-slot-row': {
      const { section, field } = el.dataset;
      const rows = boardRows(section, field);
      const last = rows[rows.length - 1];
      const start = sectionStart(section);
      rows.push(newRow(last ? last.t + durationFor(ui.boardDate, section, field, last.div) : start, !last, last && !last.mid ? last.div : ''));
      save(); return redrawBoard();
    }
    case 'reset-settings': {
      if (el.dataset.part === 'all') { delete settingsOf().fields; delete settingsOf().lengths; }
      else delete settingsOf()[el.dataset.part];
      logAction(`${t(el.dataset.part === 'fields' ? 'usualFieldsTitle' : el.dataset.part === 'all' ? 'usualSetupTitle' : 'gameLengthsTitle')}: ${t('backToDefault')}`);
      save(); render();
      return toast(t('backToDefault'));
    }
    case 'log-undo': {
      const entry = (state.log || []).find(x => x.id === el.dataset.id);
      if (!entry || entry.undone) return;
      if (entry.patch) {
        const problem = undoPatch(entry);
        if (problem) return toast(problem);
        entry.undone = new Date().toISOString();
        logAction(`${t('logUndone')}: ${entry.text}`);
      } else {
        const problem = restoreFromLog(entry);
        if (problem) return toast(problem);
      }
      save(); render();
      return toast(`${t('logUndone')}: ${entry.text}`);
    }
    case 'undo': {
      const restore = undoRestore;
      undoRestore = null;
      document.getElementById('toast').classList.remove('show', 'has-undo');
      if (restore) { restore(); toast(t('restored')); }
      return;
    }
    case 'rm-slot-row': {
      undoable(t('slotRemoved'));
      const { section, field, row } = el.closest('tr').dataset;
      const rows = boardRows(section, field);
      const [r] = rows.splice(rows.findIndex(x => x.id === row), 1);
      const sm = r.mid && state.matches.find(x => x.id === r.mid);
      logAction(`${t('slotRemoved')} · ${fmtDate(ui.boardDate)} ${fromMin(r.t)} · ${FIELDS[field]}${sm ? ` (${sm.home} ${t('vs')} ${sm.away})` : ''}`,
        { type: 'slot', date: ui.boardDate, section, field, row: clone(r), match: sm ? clone(sm) : null });
      if (r.mid) deleteMatch(r.mid);
      reflow(section, field);
      save(); return redrawBoard();
    }
    case 'ask': return askConfirm(el);
    case 'open-add-game': ui.addGameOpen = true; return render();
    case 'new-age-group-for': {
      // The new age group is added to the list it was opened from, already picked; nothing else changes.
      const box = el.previousElementSibling, season = el.dataset.target === 'season';
      return openAgeGroupDialog(g => {
        const pill = season
          ? `<label class="check-pill"><input type="checkbox" name="youthDivs" value="${g.id}" checked><span>${esc(g.name)}</span></label>`
          : `<label class="check-pill"><input type="radio" name="age" value="${g.id}" data-change="league-age" checked><span>${esc(g.name)}</span></label>`;
        const after = [...box.querySelectorAll('input')].filter(i => divAge(DIVISIONS.find(d => d.id === i.value) || {}) <= divAge(g)).pop();
        if (after) after.closest('label').insertAdjacentHTML('afterend', pill); else box.insertAdjacentHTML('afterbegin', pill);
        if (!season) box.querySelector(`[value="${g.id}"]`).dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    case 'new-field-for-league': {
      // The league form keeps everything typed; the new field shows up ticked.
      const form = el.closest('form');
      return openFieldDialog(ids => {
        form.dataset.fieldsTouched = '1';
        form.querySelector('.league-fields').insertAdjacentHTML('beforeend', ids.map(id =>
          `<label class="check-pill"><input type="checkbox" name="fields" value="${id}" checked><span>${esc(FIELDS[id])}</span></label>`).join(''));
      });
    }
    case 'toggle-notes': ui.notesOpen = ui.notesOpen === +el.dataset.id ? null : +el.dataset.id; return render();
    case 'save-notes': {
      const form = el.closest('form'), m = state.matches.find(x => x.id === +el.dataset.id);
      m.refReport = form.refReport.value.trim();
      m.adminNotes = form.adminNotes.value.trim();
      m.notesAt = new Date().toISOString();
      logAction(`${t('notesSaved')} · ${divName(m.div)}: ${m.home} ${t('vs')} ${m.away}`);
      ui.notesOpen = null;
      save(); render();
      return toast(`${t('notesSaved')}: ${m.home} ${t('vs')} ${m.away}`);
    }
    case 'edit-game': ui.editGame = ui.editGame === +el.dataset.id ? null : +el.dataset.id; return render();
    case 'cancel-edit-game': ui.editGame = null; return render();
    case 'save-edit-game': return saveEditGame(el.closest('form'));
    case 'slide-step': return goToSlide(ui.slide + +el.dataset.step, +el.dataset.step < 0);
    case 'slide-go': return goToSlide(+el.dataset.k, +el.dataset.k < ui.slide);
    case 'open-postponed': ui.adminFilter = 'postponed'; ui.adminDiv = el.dataset.league || ui.adminDiv; if (location.hash === '#/admin/scores') return render(); location.hash = '#/admin/scores'; return;
    case 'unpostpone': {
      const m = state.matches.find(x => x.id === +el.dataset.id);
      Object.assign(m, { postponed: false, playedOn: null, playedTime: null, playedField: null });
      logAction(`${t('unmarkedPostponed')} · ${divName(m.div)}: ${m.home} ${t('vs')} ${m.away}`);
      save(); render();
      return toast(`${t('unmarkedPostponed')}: ${m.home} ${t('vs')} ${m.away}`);
    }
    case 'use-last-day': {
      const input = el.closest('form').playedOn;
      input.value = el.dataset.day;
      return input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    case 'toggle-field': {
      const id = el.dataset.id, closing = isOpenField(id);
      state.fieldsClosed = state.fieldsClosed || {};
      if (closing) state.fieldsClosed[id] = true; else delete state.fieldsClosed[id];
      logAction(`${t(closing ? 'fieldClosed' : 'fieldReopened')}: ${FIELDS[id]}`);
      save(); render();
      return toast(`${t(closing ? 'fieldClosed' : 'fieldReopened')}: ${FIELDS[id]}`);
    }
    case 'field-has-games': return toast(t('fieldHasGames'));
    case 'edit-address': ui.editAddress = el.dataset.place; render(); return document.querySelector('.address-form input')?.focus();
    case 'cancel-address': ui.editAddress = null; return render();
    case 'add-label-row': {
      const list = el.closest('form').querySelector('.label-list');
      list.insertAdjacentHTML('beforeend', `<span class="label-row"><input class="input" name="label" autocomplete="off" aria-label="${t('fieldLabel')}"><button type="button" class="icon-btn" data-action="rm-label-row" aria-label="${t('remove')}">×</button></span>`);
      return list.lastElementChild.querySelector('input').focus();
    }
    case 'rm-label-row': return el.closest('.label-row').remove();
    case 'close-add-game': ui.addGameOpen = false; return render();
    case 'cancel-rm': {
      const box = el.closest('.confirm-rm');
      box.previousElementSibling.hidden = false;
      return box.remove();
    }
    case 'bring-back': {
      const a = (state.archive || []).find(x => x.id === el.dataset.id);
      if (!a) return;
      const blocked = seasonComebackBlocked(a.div);
      if (blocked) return toast(blocked);
      undoable(`${t('broughtBack')}: ${divName(a.div)} · ${a.name}`);
      logAction(`${t('broughtBack')}: ${divName(a.div)} · ${a.name}`);
      bringBackSeason(a.div, a.id);
      save(); return render();
    }
    case 'end-season': {
      undoable(t('seasonEndedToast'));
      state.seasonEnded = state.seasonEnded || {};
      unitDivs(el.dataset.for).forEach(d => { state.seasonEnded[d] = todayISO(); });
      logAction(`${t('seasonEndedToast')}: ${unitDivs(el.dataset.for).map(divName).join(', ')}`);
      save(); render();
      return toast(`${t('seasonEndedToast')}: ${(seasonUnits().find(u => u.key === el.dataset.for) || { label: divName(el.dataset.for) }).label}`);
    }
    case 'reopen-season':
      unitDivs(el.dataset.for).forEach(d => { if (state.seasonEnded) delete state.seasonEnded[d]; });
      logAction(`${t('logSeasonReopened')}: ${unitDivs(el.dataset.for).map(divName).join(', ')}`);
      save(); return render();
    case 'rc-edit': ui.rcEdit = ui.rcEdit === el.dataset.id ? null : el.dataset.id; return render();
    case 'pa-finish-open': ui.paFinish = el.dataset.id; ui.paEdit = null; return render();
    case 'pa-edit-open': ui.paEdit = ui.paEdit === el.dataset.id ? null : el.dataset.id; ui.paFinish = null; return render();
    case 'pa-close': ui.paFinish = null; ui.paEdit = null; return render();
    case 'rm-agecheck': {
      const c = (state.ageChecks || []).find(x => x.id === el.dataset.id);
      if (!c) return;
      state.ageChecks = state.ageChecks.filter(x => x !== c);
      logAction(`${t('ageChecks')} · ${divName(c.div)}: ${t('paLogRemoved')} (${c.team})`);
      save(); return render();
    }
    case 'rm-redcard': {
      const c = (state.redCards || []).find(x => x.id === el.dataset.id);
      if (!c) return;
      undoable(t('rcRemoved'));
      logAction(`${t('rcRemoved')} · ${divName(c.div)}: ${c.player} (${c.team})`, { type: 'redcard', card: clone(c) });
      state.redCards = state.redCards.filter(x => x.id !== c.id);
      save(); return render();
    }
    case 'rm-blank-row': {
      // A blank row was never saved; if a name was typed it was saved as a player, so ask first.
      const tr = el.closest('tr');
      if (tr.dataset.sid) { el.dataset.sid = tr.dataset.sid; el.dataset.confirm = 'rm-scorer'; return askConfirm(el); }
      const parent = tr.parentNode, next = tr.nextSibling;
      undoable(t('rowRemoved'), () => parent.insertBefore(tr, next));
      return tr.remove();
    }
    case 'rm-scorer': {
      undoable(t('playerRemoved'));
      const sc = state.scorers.find(x => x.id === +el.dataset.sid);
      if (sc) logAction(`${t('playerRemoved')} · ${divName(sc.div)}: ${sc.name} (${sc.team}, ${sc.goals} ${t('goalsWord')})`, { type: 'scorer', scorer: clone(sc) });
      state.scorers = state.scorers.filter(x => x.id !== +el.dataset.sid);
      touch(ui.adminDiv); save(); return render();
    }
    case 'rm-team': {
      undoable(t('teamRemoved'));
      const idx = +el.dataset.idx;
      const name = state.teams[ui.adminDiv].splice(idx, 1)[0];
      const gone = state.matches.filter(m => m.div === ui.adminDiv && !played(m) && (m.home === name || m.away === name));
      logAction(`${t('teamRemoved')} · ${divName(ui.adminDiv)}: ${name}`, { type: 'team', div: ui.adminDiv, name, idx, matches: clone(gone) });
      state.matches = state.matches.filter(m => !(m.div === ui.adminDiv && !played(m) && (m.home === name || m.away === name)));
      touch(ui.adminDiv); save(); return render();
    }
    case 'open-archive': ui.archiveId = el.dataset.id; location.hash = '#/archive'; return render();
    case 'open-archive-div': ui.archiveId = null; return;
    case 'close-archive': ui.archiveId = null; return render();
    case 'cancel-season': ui.newSeason = null; return render();
    case 'toggle-youth-seasons': ui.youthSeasonsOpen = !ui.youthSeasonsOpen; return render();
    case 'remove-league': ui.removeLeague = el.dataset.for; return render();
    case 'toggle-league-scorers': {
      const l = customLeague(el.dataset.for);
      l.scorers = !hasScorers(l.id);
      logAction(`${l.name}: ${t(l.scorers ? 'scorersOn' : 'scorersOff')}`);
      save(); render();
      return toast(`${l.name}: ${t(l.scorers ? 'scorersOn' : 'scorersOff')}`);
    }
    case 'cancel-remove-league': ui.removeLeague = null; return render();
    case 'edit-league':
      ui.editLeague = ui.editLeague === el.dataset.for ? null : el.dataset.for; render();
      return ui.editLeague && document.getElementById('edit-league-box')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    case 'confirm-remove-league': undoable(t('leagueRemoved')); return removeLeague(ui.removeLeague);
    case 'season-games': {
      const divs = unitDivs(el.dataset.for);
      const games = Math.min(40, Math.max(1, gameColumns(divs[0]) + +el.dataset.step));
      state.seasonGames = state.seasonGames || {};
      divs.forEach(d => { state.seasonGames[d] = games; });
      logAction(`${t('gamesInSeason')} · ${divs.length > 1 ? t('youth') : divName(divs[0])}: ${games}`);
      save(); return render();
    }
    case 'confirm-season': {
      const { name, games } = ui.newSeason;
      const divs = [...new Set(ui.newSeason.divs.flatMap(unitDivs))];
      undoable(`${t('seasonStarted')}: ${name}`);
      const before = Object.fromEntries(divs.map(d => [d, { name: seasonName(d), games: gameColumns(d) }]));
      const archived = (state.archive || []).length;
      startNewSeason(name, divs);
      const ids = Object.fromEntries((state.archive || []).slice(archived).map(a => [a.div, a.id]));
      logAction(`${t('seasonStarted')}: ${name} · ${divs.map(divName).join(', ')}`,
        { type: 'season', divs: divs.map(d => ({ div: d, archiveId: ids[d] || null, ...before[d] })) });
      if (games) divs.forEach(d => { state.seasonGames = state.seasonGames || {}; state.seasonGames[d] = games; });
      save();
      ui.newSeason = null;
      render();
      return toast(`${t('seasonStarted')}: ${name}`);
    }
    case 'open-add-team': return openAddTeam();
    case 'rot-add-rest': return openAddTeam('', true);
    case 'rot-fill': {
      // Give the teams without a number the open numbers, in name order.
      const div = ui.adminDiv, rot = rotationOf(div), numbers = { ...rot.numbers };
      const teams = [...(state.teams[div] || [])].sort((a, b) => a.localeCompare(b)).filter(tm => !rotationNumber(div, tm));
      for (let n = 1; n <= rot.size && teams.length; n++) if (!numbers[n]) numbers[n] = teams.shift();
      return setRotation(div, { size: rot.size, numbers }, t('fillEmptyNumbers'));
    }
    case 'friendly-list': {
      // Back from a typed name to the division's list.
      const tr = el.closest('tr');
      const r = boardRows(tr.dataset.section, tr.dataset.field).find(x => x.id === tr.dataset.row);
      const side = el.dataset.side;
      Object.assign(r, { [`${side}Typed`]: false, [side]: '' });
      save(); return redrawBoard(r.id, `b-${side}`);
    }
    case 'sheet-section': ui.sheetSection = el.dataset.section; return render();
    case 'sheet-week': ui.sheetDate = addDays(ui.sheetDate || todayISO(), +el.dataset.days); return render();
    case 'sheet-futsal-day': ui.sheetDate = sheetDayFor(ui.sheetDate || todayISO(), ui.sheetSection || 'youth', +el.dataset.dow); return render();
    case 'refs-toggle': e.preventDefault(); ui.refsOpen = !ui.refsOpen; return render();
    case 'ref-add': {
      const date = ui.sheetDate || ui.boardDate, key = el.dataset.key;
      const list = fieldRefs(date, key).map(x => ({ ...x }));
      if (!list.length) list.push({ name: '', times: null });
      list.push({ name: '', times: [] });
      return setFieldRefs(date, key, list);
    }
    case 'ref-rm': {
      const date = ui.sheetDate || ui.boardDate, key = el.dataset.key;
      return setFieldRefs(date, key, fieldRefs(date, key).filter((x, i) => i !== +el.dataset.i));
    }
    case 'ref-chip': {
      // Tap a game time to give it to this ref (it comes off whoever had it) or take it away.
      const date = ui.sheetDate || ui.boardDate, key = el.dataset.key, i = +el.dataset.i, time = +el.dataset.t;
      const [sec, field] = key.split('|');
      const all = (boardDay(date)[sec][field] || []).filter(r => rowTaken(date, r)).map(r => r.t);
      let list = fieldRefs(date, key).map(x => ({ ...x }));
      if (!list.length) list = [{ name: '', times: null }];
      const covered = k => all.filter(tm => refCovers(list, k, tm));
      const snap = list.map((x, k) => covered(k));
      if (snap[i].includes(time)) list[i].times = snap[i].filter(tm => tm !== time);
      else {
        list = list.map((x, k) => (k !== i && snap[k].includes(time) ? { ...x, times: snap[k].filter(tm => tm !== time) } : x));
        list[i].times = [...snap[i], time];
      }
      return setFieldRefs(date, key, list);
    }
    case 'print-sheet': return window.print();
    case 'sheet-edit': ui.sheetEdit = !ui.sheetEdit; return render();
    case 'sheet-edits-reset': {
      const date = ui.sheetDate, sec = ui.sheetSection || 'youth';
      const all = { ...(state.sheetEdits || {}) }, day = { ...(all[date] || {}) };
      delete day[sec];
      if (Object.keys(day).length) all[date] = day; else delete all[date];
      state.sheetEdits = all;
      logAction(`${t('scheduleSheet')} · ${fmtDate(date)}: ${t('sheetEditReset')}`);
      save(); return render();
    }
    case 'pdf-sheet': return saveSheetPdf(el);
    case 'sheet-export': return sheetExport(el);
    case 'export-card': return exportCard(el);
    case 'ti-kind': ui.tiKind = el.dataset.kind; return render();
    case 'rot-round-edit': {
      const key = el.dataset.key;
      if (ui.rotEditR === key) { ui.rotEditR = null; ui.rotDraft = null; } // close = nothing saved
      else { ui.rotEditR = key; ui.rotDraft = rotDraftStart(ui.adminDiv, key); }
      ui.rotNumsG = null;
      return render();
    }
    case 'rot-draft-save': {
      const div = ui.adminDiv, d = ui.rotDraft;
      if (!d || !rotDraftDirty()) return;
      let rot = rotationOf(div);
      const notes = [];
      if (d.week !== d.startWeek) {
        const rounds = Object.fromEntries(Object.entries(rot.rounds || {}).filter(([, x]) => x !== d.r));
        const held = new Set(rot.held || []);
        held.delete(d.r);
        if (d.week === 'tbd') held.add(d.r);
        if (d.week.startsWith('g:')) rounds[+d.week.slice(2)] = d.r;
        rot = { ...rot, rounds, held: [...held].sort((a, b) => a - b) };
        if (!Object.keys(rot.rounds).length) delete rot.rounds;
        if (!rot.held.length) delete rot.held;
        notes.push(`${t('roundWord')} ${d.r} → ${d.week === 'tbd' ? t('rotGameTbd') : d.week === 'auto' ? t('rotAutoShort') : `${t('game')} ${d.week.slice(2)}`}`);
      }
      const key = nums => JSON.stringify(Object.entries(nums).sort(([a], [b]) => a - b));
      if (d.size !== d.startSize || key(d.numbers) !== key(d.startNumbers)) {
        // the games already played keep the numbers they were played with
        state.rotation = { ...(state.rotation || {}), [div]: rot };
        freezePastRotation(div);
        rot = rotationOf(div);
        const next = nextGameNumber(div), past = { ...(rot.past || {}) };
        Object.keys(past).forEach(x => { if (+x >= next) delete past[x]; });
        rot = { ...rot, size: d.size, numbers: { ...d.numbers }, past };
        notes.push(t('rotDraftNumsLog').replace('{n}', d.size));
      }
      state.rotation = { ...(state.rotation || {}), [div]: rot };
      logAction(`${t('rotation')} · ${divName(div)}: ${notes.join('; ')}`);
      ui.rotEditR = null; ui.rotDraft = null; ui.rotNumsG = null;
      save(); render();
      return toast(t('saved'));
    }
    case 'rot-game-edit': { const g = +el.dataset.g; ui.rotEditG = ui.rotEditG === g ? null : g; ui.rotNumsG = null; return render(); }
    case 'rot-nums-forward': {
      // this game's numbers for every game after it too (only the chart; booked or played games keep their teams)
      const div = ui.adminDiv, g = +el.dataset.g, rot = rotationOf(div), at = rotationAt(div, g), next = nextGameNumber(div);
      const past = { ...(rot.past || {}) };
      for (let x = g + 1; x <= gameColumns(div); x++) {
        if (x < next) past[x] = { size: at.size, numbers: { ...at.numbers } }; else delete past[x];
      }
      state.rotation = { ...(state.rotation || {}), [div]: { ...rot, size: at.size, numbers: { ...at.numbers }, past } };
      logAction(`${t('rotation')} · ${divName(div)}: ${t('rotForwardLog').replace('{g}', g)}`);
      save(); return render();
    }
    case 'rot-hold': {
      // hold a round for later (automatic weeks skip it) or let it be used again
      const div = ui.adminDiv, r = +el.dataset.r, rot = rotationOf(div);
      const held = new Set(rot.held || []);
      const holding = !held.has(r);
      if (holding) held.add(r); else held.delete(r);
      const next = { ...rot, held: [...held].sort((a, b) => a - b) };
      if (!next.held.length) delete next.held;
      state.rotation = { ...(state.rotation || {}), [div]: next };
      logAction(`${t('rotation')} · ${divName(div)}: ${t('roundWord')} ${r} ${t(holding ? 'rotHeldLog' : 'rotReleasedLog')}`);
      save(); return render();
    }
    case 'rot-nums-toggle': { const g = el.dataset.g; ui.rotNumsG = ui.rotNumsG === g ? null : g; return render(); }
    case 'rot-game-now': {
      // this past game on the chart takes today's numbers (only the chart; played games keep their teams)
      const div = ui.adminDiv, g = +el.dataset.g, rot = rotationOf(div);
      const past = { ...(rot.past || {}), [g]: { size: rot.size, numbers: { ...rot.numbers } } };
      state.rotation = { ...(state.rotation || {}), [div]: { ...rot, past } };
      logAction(`${t('rotation')} · ${divName(div)}: ${t('game')} ${g} ${t('rotLogNowNumbers')}`);
      save(); return render();
    }
    case 'hp-reset': delete state.homePage; logAction(`${t('homePageNav')}: ${t('hpResetDone')}`); save(); return render();
    case 'rot-past-apply': {
      // This division's past games on the chart take today's numbers. Only the chart changes: a withdrawn
      // team's forfeits for days already gone aren't added because of it.
      const div = ui.adminDiv, rot = rotationOf(div);
      const was = new Map(withdrawnIn(div).map(w => [w, new Set((w.left || []).map(m => m.id))]));
      setRotation(div, { size: rot.size, numbers: { ...rot.numbers } }, t('rotPastDone'), true);
      let undo = false;
      was.forEach((ids, w) => { const keep = (w.left || []).filter(m => ids.has(m.id) || m.date >= todayISO()); if (keep.length !== (w.left || []).length) { w.left = keep; undo = true; } });
      if (undo) { save(); render(); }
      return toast(t('rotPastDone'));
    }
    case 'ti-zoom': {
      const z = el.dataset.z, now = ui.tiZoomNow || 1;
      if (z === 'fit') ui.tiZoom = 'fit';
      else if (z === '1') ui.tiZoom = 1;
      else ui.tiZoom = z === 'in' ? TI_ZOOMS.find(x => x > now + 0.001) || TI_ZOOMS[TI_ZOOMS.length - 1] : [...TI_ZOOMS].reverse().find(x => x < now - 0.001) || TI_ZOOMS[0];
      // keep the page where it is (only the preview changes)
      const y = window.scrollY; render(); window.scrollTo(0, y); return;
    }
    // "Back to usual": this division's picture goes back to the built-in look (other divisions keep theirs)
    case 'ti-reset': setImg(tiKindNow(), { ...imgDefaults(tiKindNow()) }); return render();
    case 'ti-height-auto': setImg(tiKindNow(), { ...imgSet(tiKindNow()), height: 0 }); return render();
    case 'ti-unit': setImg(tiKindNow(), { ...imgSet(tiKindNow()), unit: el.dataset.unit }); return render();
    case 'board-to-sheet': ui.sheetDate = ui.boardDate; ui.sheetSection = ui.boardSection; return;
    case 'sheet-to-board': {
      // Open the planner on the sheet's own date (it works a week at a time, so set the week and the day).
      const d = ui.sheetDate || ui.boardDate;
      ui.boardSection = ui.sheetSection || ui.boardSection;
      if (d) { ui.boardWeek = sundayOf(d); ui.boardDays[ui.boardSection] = dayOfWeek(d); ui.boardDate = d; }
      return;
    }
    case 'edit-hidden': return openEditHidden(el.dataset.team);
    case 'edit-archived': return openEditArchived(el.dataset.name);
    case 'archived-back': return openAddTeam('', false, ui.adminDiv, '', (state.archivedTeams || {})[el.dataset.name]);
    case 'rm-archived': {
      const name = el.dataset.name;
      if (!(state.archivedTeams || {})[name]) return;
      undoable(`${t('archivedTeams')} · ${t('remove')}: ${name}`);
      delete state.archivedTeams[name];
      logAction(`${t('archivedTeams')} · ${t('remove')}: ${name}`);
      save(); return render();
    }
    case 'show-standings': {
      // Official now: back on the standings with all its games so far.
      const div = ui.adminDiv, team = el.dataset.team;
      state.standingsHidden = { ...(state.standingsHidden || {}), [div]: [...hiddenFromStandings(div)].filter(x => x !== team) };
      touch(div);
      logAction(`${t('showInStandings')}: ${team} · ${divName(div)}`);
      save(); render();
      return toast(`${team}: ${t('showInStandings')}`);
    }
    case 'tour-to-board': {
      // Open the planner on that tournament day, on this division's tab (Youth, Adults or Futsal).
      const d = el.dataset.date, sec = el.dataset.section;
      Object.assign(ui, { boardSection: sec, boardWeek: sundayOf(d), boardDate: d });
      ui.boardDays[sec] = dayOfWeek(d);
      return;
    }
    case 'hide-field-day': {
      const { section, field } = el.dataset, date = ui.boardDate;
      const rows = ((boardDay(date)[section] || {})[field] || []);
      const busy = rows.filter(r => rowTaken(date, r)).length;
      if (busy) return toast(t('fieldHasBookings').replace('{n}', busy));
      setHiddenOn(date, section, [...new Set([...hiddenOn(date, section), field])]);
      delete state.matchDays[date][section][field];
      logAction(`${t('fieldRemovedForDay')} · ${fmtDate(date)}: ${FIELDS[field]}`);
      save(); return redrawBoard();
    }
    case 'tour-new-field': {
      // The same pop-up as the planner's "New field…"; the new field is used by this division right away.
      const d = DIVISIONS.find(x => x.id === el.dataset.id);
      return openFieldDialog(ids => {
        d.fields = [...new Set([...d.fields, ...ids])];
        logAction(`${t('tourFieldsChanged')} · ${divName(d.id)}`);
        save(); render();
      });
    }
    case 'tour-div-rm-date': {
      // Take a day off one division (games already booked that day stay on the schedule).
      const d = DIVISIONS.find(x => x.id === el.dataset.id);
      if (!d || d.dates.length < 2) return;
      d.dates = d.dates.filter(x => x !== el.dataset.date);
      syncTourDates(d);
      logAction(`${t('tourDayRemoved')} · ${divName(d.id)}: ${fmtDate(el.dataset.date)}`);
      save(); return render();
    }
    case 'tour-add-date': {
      // Opens the calendar; the day is added as soon as it's picked.
      const box = el.closest('form').pickDate;
      box.focus(); try { box.showPicker(); } catch (err) {}
      return;
    }
    case 'tour-rm-date': {
      const form = el.closest('form');
      return setFormDates(form, JSON.parse(form.dates.value || '[]').filter(x => x !== el.dataset.date));
    }
    case 'open-tour': ui.tourId = el.dataset.id; ui.tourDiv = null; ui.copaDraft = null; return render();
    case 'close-tour': ui.tourId = null; return render();
    case 'tour-games-by': ui.tourGamesBy = el.dataset.by; return render();
    case 'copa-reformat':
      ui.copaReformat = ui.adminDiv; ui.copaDraft = draftFromCopa(ui.adminDiv); render();
      return document.querySelector('[data-form="start-copa"]')?.scrollIntoView({ block: 'start' });
    case 'copa-reformat-cancel': ui.copaReformat = null; ui.copaDraft = null; return render();
    case 'copa-rename-open':
      ui.copaRename = el.dataset.team || null; ui.copaEditOpen = true; render();
      return document.querySelector('.copa-rename [name=to]')?.focus();
    case 'copa-out': copaTakeOut(ui.adminDiv, el.dataset.team); ui.copaEditOpen = true; save(); return render();
    case 'tour-div': ui.tourDiv = el.dataset.id; ui.copaDraft = null; ui.copaReformat = null; return render();
    case 'rm-tournament': removeTournament(el.dataset.id); ui.tourId = null; save(); return render();
    case 'rm-day-off': {
      const o = offDays().find(x => x.id === el.dataset.id);
      if (!o) return;
      state.offDays = offDays().filter(x => x.id !== o.id);
      logAction(`${t('dayOffRemoved')}: ${fmtDate(o.date)}${o.note ? ` · ${o.note}` : ''}`);
      save(); return render();
    }
    case 'hidden-join-open': return openAddTeam(el.dataset.team);
    case 'team-to-div': {
      const name = el.dataset.team, box = el.closest('.add-div-box');
      const ids = [...box.querySelectorAll('[name=toDivs]:checked:not(:disabled)')].map(x => x.value).filter(id => !(state.teams[id] || []).includes(name));
      if (!ids.length) return toast(t('pickDivision'));
      const logo = teamLogo(name, ui.adminDiv), nums = [];
      ids.forEach(id => {
        state.teams[id] = [...(state.teams[id] || []), name];
        // Its logo comes along (the same picture as in this division).
        if (logo && logo !== teamLogo(name, id)) state.logos = { ...(state.logos || {}), [`${id}|${name}`]: logo };
        // A division using the Game rotation: an open number goes to it (nobody else's games change).
        const rot = (state.rotation || {})[id];
        if (rot && Object.keys(rot.numbers).length) {
          freezePastRotation(id);
          for (let n = 1; n <= rot.size; n++) if (!rot.numbers[n]) { rot.numbers[n] = name; nums.push(`${divName(id)} #${n}`); break; }
        }
        // Now it's in: show it picked and locked.
        const cb = box.querySelector(`[name=toDivs][value="${id}"]`);
        cb.disabled = true; cb.closest('label').classList.add('in-already');
      });
      logAction(`${t('logTeamAdded')}: ${name} · ${ids.map(divName).join(', ')}`);
      save(); render();
      return toast(`${name} ${t('addedTo')} ${ids.map(divName).join(', ')}${nums.length ? ` · ${t('rotationNumberGiven')} ${nums.join(', ')}` : ''}`);
    }
    case 'merge-team': {
      const form = el.closest('form'), from = el.dataset.from, to = form.mergeTo.value;
      if (!to || to === from) return;
      undoable(`${t('merged')}: ${from} → ${to}`);
      mergeTeams(ui.adminDiv, from, to);
      logAction(`${t('merged')} · ${divName(ui.adminDiv)}: ${from} → ${to}`);
      save();
      closeDialog(el.closest('dialog'));
      render();
      return toast(`${t('merged')}: ${from} → ${to}`);
    }
    case 'hidden-join': {
      // From now on a regular team; the games it played as a replacement stay as they were (they didn't count).
      const div = ui.adminDiv, name = el.dataset.team;
      state.teams[div] = state.teams[div] || [];
      if (!state.teams[div].includes(name)) state.teams[div].push(name);
      touch(div);
      logAction(`${t('joinedLeague')} · ${divName(div)}: ${name}`);
      save(); render();
      return toast(`${t('joinedLeague')}: ${name}`);
    }

    case 'reg-btn-rm': { const box = el.closest('[data-reg-group]'); el.closest('.reg-edit-row').remove(); return saveRegGroup(box); }
    case 'reg-btn-add': {
      const box = el.closest('[data-reg-group]');
      el.insertAdjacentHTML('beforebegin', `<div class="reg-edit-row" data-id="new"><input class="input" data-change="reg-btn" data-f="label" value="${esc(t('registerBtn'))}"><input class="input" data-change="reg-btn" data-f="url" value="" placeholder="https://…"><button type="button" class="icon-btn danger" data-action="reg-btn-rm">×</button></div>`);
      saveRegGroup(box);
      // focus the new button's link box to fill in
      const rows = document.querySelectorAll(`[data-reg-group="${CSS.escape(box.dataset.regGroup)}"] .reg-edit-row`);
      return rows[rows.length - 1]?.querySelector('[data-f=url]').focus();
    }
    case 'reg-reset': delete state.regButtons; delete state.regCards; logAction(t('regResetDone')); save(); return render();
    case 'reg-card-add': {
      const rc = regCardsState(), id = `c${Date.now().toString(36)}`;
      state.regCards = { ...rc, added: [...rc.added, { id, section: el.dataset.section, title: t('regNewDivision'), desc: '', url: '' }] };
      logAction(`${t('regDivCards')} · ${t(Object.fromEntries(REG_SECTIONS)[el.dataset.section])}: ${t('regCardAdded')}`);
      save(); render();
      const box = document.querySelector(`[data-reg-card="${id}"] [data-f=title]`);
      if (box) { box.scrollIntoView({ block: 'center' }); box.select(); }
      return;
    }
    case 'reg-card-rm': {
      const rc = regCardsState(), id = el.dataset.id;
      const c = REG_SECTIONS.flatMap(([sec]) => regCards(sec)).find(x => x.id === id);
      state.regCards = id.startsWith('c') && rc.added.some(x => x.id === id)
        ? { ...rc, added: rc.added.filter(x => x.id !== id) }
        : { ...rc, removed: [...rc.removed, id] };
      logAction(`${t('regDivCards')} · ${c ? c.title : ''}: ${t('regCardRemoved')}`);
      save(); return render();
    }
    case 'score-publish': {
      const form = el.closest('form');
      if (!readScoreForm(form)) return toast(t('typeBothScores'));
      const m = applyScoreForm(form);
      scorePicks().delete(+form.dataset.id);
      if (!m) return toast(t('nothingChanged'));
      touch(m.div); save(); render();
      return toast(`${t('publishedToast')}: ${m.home} ${m.hs ?? '–'}–${m.as ?? '–'} ${m.away}`);
    }
    case 'score-unpublish': {
      const form = el.closest('form');
      const m = unpublishScoreForm(form);
      scorePicks().delete(+form.dataset.id);
      if (!m) return;
      touch(m.div); save(); render();
      return toast(`${t('unpublishedToast')}: ${m.home} ${t('vs')} ${m.away}`);
    }
    case 'scores-bulk': {
      const pub = el.dataset.mode === 'publish';
      const forms = [...document.querySelectorAll('form.score-row')].filter(f => scorePicks().has(+f.dataset.id));
      if (!forms.length) return;
      if (el.dataset.mode === 'unpublish') {
        const games = forms.map(unpublishScoreForm).filter(Boolean);
        forms.forEach(f => scorePicks().delete(+f.dataset.id));
        [...new Set(games.map(m => m.div))].forEach(touch);
        if (games.length) save();
        render();
        return toast(games.length ? t('bulkUnpublished').replace('{n}', games.length) : t('nothingChanged'));
      }
      // A half-typed score (one box empty) stays ticked for later.
      const ready = forms.filter(f => readScoreForm(f));
      const games = ready.map(f => (pub ? applyScoreForm(f) : draftScoreForm(f))).filter(Boolean);
      ready.forEach(f => scorePicks().delete(+f.dataset.id));
      if (pub) [...new Set(games.map(m => m.div))].forEach(touch);
      if (games.length) save();
      render();
      const half = forms.length - ready.length;
      return toast(`${games.length ? t(pub ? 'bulkPublished' : 'bulkSaved').replace('{n}', games.length) : t('nothingChanged')}${half ? ` · ${t('halfScoresLeft').replace('{n}', half)}` : ''}`);
    }
    case 'forfeit-open': ui.forfeitGame = ui.forfeitGame === +el.dataset.id ? null : +el.dataset.id; return render();
    case 'forfeit-game': {
      const m = state.matches.find(x => x.id === +el.dataset.id);
      if (!m) return;
      Object.assign(m, { forfeitBy: el.dataset.team, forfeitFrom: { field: m.field, time: m.time }, field: '', hs: null, as: null });
      ui.forfeitGame = null;
      touch(m.div);
      logAction(`${t('forfeitAdded')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${doubleForfeit(m) ? `${m.home} ${t('and')} ${m.away} ${t('bothLose30Lower')}` : `${m.forfeitBy === m.home ? m.away : m.home} ${t('wins30')} (${m.forfeitBy} ${t('forfeitedWord')})`}`);
      save(); return render();
    }
    case 'rm-forfeit-game': {
      // A booked game that was turned into a forfeit goes back to that game; one added as a forfeit is removed.
      const m = state.matches.find(x => x.id === +el.dataset.id);
      if (!m) return;
      undoable(`${t('forfeitRemoved')}: ${m.home} ${t('vs')} ${m.away}`);
      if (m.forfeitFrom) { Object.assign(m, m.forfeitFrom); delete m.forfeitBy; delete m.forfeitFrom; }
      else state.matches = state.matches.filter(x => x.id !== m.id);
      touch(m.div);
      logAction(`${t('forfeitRemoved')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${m.home} ${t('vs')} ${m.away}`);
      save(); return render();
    }
    case 'forfeit-add-open': ui.forfeitAddOpen = !ui.forfeitAddOpen; return render();
    case 'goles-alert-toggle': ui.golesAlertOpen = !ui.golesAlertOpen; return render();
    case 'goles-jump': ui.sheetTeam = el.dataset.team; render(); document.querySelector('.goles-head')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
    case 'filler-open': ui.fillerFor = ui.fillerFor === +el.dataset.mid ? null : +el.dataset.mid; return render();
    case 'filler-undo': {
      // Put the 3–0 forfeit back (scores, goals and the guest game come off).
      const m = state.matches.find(x => x.id === +el.dataset.id);
      if (!m || !m.filler) return;
      if (m.goals && m.goals.length) applyGoals(m, m.goals, -1);
      if (m.filler.regular) {
        const r = m.filler.regular;
        Object.assign(m, { home: r.home, away: r.away, forfeitBy: m.filler.gone, field: '', hs: null, as: null, goals: [] });
        if (r.forfeitFrom) m.forfeitFrom = r.forfeitFrom;
        delete m.fillerTeam; delete m.filler; delete m.fillerCounts;
      } else {
        const w = state.withdrawn[`${m.div}|${m.filler.gone}`];
        if (w) w.left = [...(w.left || []), m.filler.stub];
        state.matches = state.matches.filter(x => x.id !== m.id);
      }
      touch(m.div);
      logAction(`${t('backToForfeit')} · ${divName(m.div)} · ${fmtDate(m.date)}`);
      save(); return render();
    }
    case 'pub-tour': ui.pubTour = el.dataset.id; ui.pubTourDiv = null; return render();
    case 'pub-tour-div': ui.pubTourDiv = el.dataset.id; return render();
    case 'cup-tab': ui.cupTab = el.dataset.cup; return render();
    case 'copa-add-team': {
      const form = el.closest('form');
      const name = form.newTeam.value.trim();
      if (!name) return form.newTeam.focus();
      const d = readCopaDraft(form, ui.adminDiv);
      const taken = [...standings(ui.adminDiv).map(r => r.team), ...d.extras].some(x => x.toLowerCase() === name.toLowerCase());
      if (!taken) d.extras = [...d.extras, name];
      ui.copaDraft = d;
      render();
      return document.querySelector('[name=newTeam]')?.focus();
    }
    case 'copa-rm-team': {
      const d = readCopaDraft(el.closest('form'), ui.adminDiv);
      d.extras = d.extras.filter(x => x !== el.dataset.name);
      ui.copaDraft = d;
      return render();
    }
    case 'copa-ko': {
      // Group winners first, then runners-up (A1, B1, A2, B2…), so teams from the same group meet late.
      const div = ui.adminDiv;
      makeKo(div);
      logAction(`${t('koFromGroups')} · ${divName(div)}`);
      save(); return render();
    }
    case 'team-expand': {
      ui.teamOpen = { ...(ui.teamOpen || {}), [el.dataset.box]: !(ui.teamOpen || {})[el.dataset.box] };
      return render();
    }
    case 'rm-forfeit': {
      const f = findForfeit(+el.dataset.mid);
      if (!f) return;
      undoable(`${t('forfeitRemoved')}: ${f.m.home} ${t('vs')} ${f.m.away}`);
      f.w.left.splice(f.i, 1);
      touch(f.m.div);
      logAction(`${t('forfeitRemoved')} · ${divName(f.m.div)} · ${fmtDate(f.m.date)}: ${f.m.home} ${t('vs')} ${f.m.away}`);
      save(); return render();
    }
    case 'open-withdraw': return openWithdraw(state.teams[ui.adminDiv][+el.dataset.idx]);
    case 'withdraw-from-edit': closeDialog(el.closest('dialog')); return openWithdraw(el.dataset.team);
    case 'bring-team-back': {
      const w = (state.withdrawn || {})[el.dataset.key];
      if (!w) return;
      undoable(`${t('teamBack')}: ${w.team}`);
      const list = state.teams[w.div] = state.teams[w.div] || [];
      if (!list.includes(w.team)) list.splice(Math.min(w.idx ?? list.length, list.length), 0, w.team);
      (w.left || []).forEach(({ left, ...m }) => { if (!state.matches.some(x => x.id === m.id)) state.matches.push(m); });
      delete state.withdrawn[el.dataset.key];
      touch(w.div);
      logAction(`${t('teamBack')} · ${divName(w.div)}: ${w.team}`);
      save(); return render();
    }
    case 'edit-team': return openEditTeam(state.teams[ui.adminDiv][+el.dataset.idx]);
    case 'remove-logo': {
      const dialog = el.closest('dialog');
      dialog.dataset.logo = '';
      const initials = esc(dialog.querySelector('[name=name]').value.slice(0, 2).toUpperCase());
      dialog.querySelector('.logo-preview').innerHTML = `<span class="team-badge big">${initials}</span>`;
      el.hidden = true;
      return;
    }
    case 'close-dialog': return closeDialog(el.closest('dialog'));
    case 'rm-match': {
      undoable(t('gameRemoved'));
      const gm = state.matches.find(x => x.id === +el.dataset.id);
      if (gm) logAction(`${t('gameRemoved')} · ${divName(gm.div)}: ${gm.home} ${played(gm) ? `${gm.hs}–${gm.as}` : t('vs')} ${gm.away} · ${fmtDate(gm.date)}`, { type: 'match', match: clone(gm) });
      deleteMatch(+el.dataset.id);
      save(); return render();
    }
    case 'rm-field': undoable(t('fieldDeleted')); return deleteField(el.dataset.id);
  }
});

document.addEventListener('submit', e => {
  const form = e.target;
  e.preventDefault();
  switch (form.dataset.form) {
    case 'login': return signIn(form);
    case 'my-account': return saveMyAccount(form);
    case 'add-admin': return addAdmin(form);
    case 'add-forfeit': return addForfeit(form);
    case 'start-playoffs': return startPlayoffs(form);
    case 'filler': return bookFiller(form);
    case 'start-copa':
      if (document.activeElement && document.activeElement.name === 'newTeam') return form.querySelector('[data-action=copa-add-team]').click();
      return startCopa(form);
    case 'playoff-rules': {
      const copa = form.dataset.cup === 'copa';
      const co = copa && copaOf(ui.adminDiv);
      const po = copa ? co.ko || co : playoffsOf(ui.adminDiv);
      const count = copa ? (co.ko ? co.ko.seeds.length : co.groups.length * (co.advance || 1)) : po.seeds.length;
      const rules = { tie: form.querySelector('[name=tie]:checked').value, roundLegs: readRoundLegs(form, count), third: form.third.checked };
      Object.assign(po, rules);
      if (co && co.ko) Object.assign(co, rules);
      delete po.legs;
      touch(ui.adminDiv);
      logAction(`${t('playoffSettings')} · ${divName(ui.adminDiv)}`);
      save(); render(); return toast(t('saved'));
    }
    case 'score': {
      if (!readScoreForm(form)) return toast(t('typeBothScores'));
      const m = draftScoreForm(form);
      scorePicks().delete(+form.dataset.id);
      if (!m) return toast(t('nothingChanged'));
      save(); render(); return toast(t(m.draft ? 'savedNotPublished' : 'draftCleared'));
    }
    case 'add-game': {
      const f = new FormData(form);
      const warn = form.querySelector('.warn');
      const home = f.get('home'), away = f.get('away');
      if (!home || !away || home === away) { warn.textContent = t(home && home === away ? 'sameTeam' : 'pickTeams'); warn.hidden = false; return; }
      const day = form.dataset.day;
      const hs = f.get('hs') === '' ? null : +f.get('hs');
      const as = f.get('as') === '' ? null : +f.get('as');
      const playedOn = f.get('playedOn') && f.get('playedOn') !== day ? f.get('playedOn') : null;
      const time = (state.matches.find(m => m.div === ui.adminDiv && m.date === day) || {}).time || '';
      state.matches.push({ id: state.nextId++, div: ui.adminDiv, date: day, time, field: f.get('field'), home, away,
        hs: hs !== null && as !== null ? hs : null, as: hs !== null && as !== null ? as : null, goals: [],
        postponed: !!playedOn, playedOn });
      tagPlayoff(state.matches[state.matches.length - 1]);
      ui.addGameOpen = false;
      logAction(`${t('logGameAdded')} · ${divName(ui.adminDiv)}: ${home} ${t('vs')} ${away}`);
      touch(ui.adminDiv); save(); render();
      return toast(`${t('gameAdded')}: ${home} ${t('vs')} ${away}`);
    }
    case 'edit-team': return saveEditTeam(form);
    case 'copa-rename': return copaRename(form);
    case 'copa-late-team': ui.copaEditOpen = true; return copaLateTeam(form);
    case 'edit-hidden': return saveEditHidden(form);
    case 'edit-archived': return saveEditArchived(form);
    case 'add-day-off': return addDayOff(form);
    case 'new-tournament': return addTournament(form);
    case 'tour-days': {
      const tour = tournaments().find(x => x.id === form.dataset.tour);
      const dates = [...new Set([...JSON.parse(form.dates.value || '[]'), ...(form.pickDate.value ? [form.pickDate.value] : [])])].sort();
      if (!dates.length) { const w = form.querySelector('.warn'); w.textContent = `${t('fillIn')}: ${t('tourDays')}`; w.hidden = false; return; }
      tour.dates = dates;
      // Every division of the tournament plays on the new days (games already booked keep their dates).
      tourDivs(tour).forEach(d => {
        d.dates = dates;
        const l = (state.leagues || []).find(x => x.id === d.id);
        if (l) l.dates = dates;
        const co = copaOf(d.id);
        if (co && co.on > dates[0]) co.on = dates[0];
      });
      logAction(`${t('changeTourDays')} · ${tour.name}: ${dates.map(x => fmtDate(x)).join(', ')}`);
      save(); render(); return toast(t('saved'));
    }
    case 'new-league': return addLeague(form);
    case 'edit-league': return saveEditLeague(form);
    case 'edit-league-full': return saveLeagueEdit(form);
    case 'new-age-group': return addAgeGroup(form);
    case 'add-field': return addField(form);
    case 'withdraw-team': return withdrawTeam(form);
    case 'postponed-game': return savePostponed(form);
    case 'red-card': return addRedCard(form);
    case 'pa-add': return savePaForm(form, 'add');
    case 'pa-finish': return savePaForm(form, 'finish');
    case 'pa-edit': return savePaForm(form, 'edit');
    case 'rc-edit': {
      // Longer or shorter suspension: the change, the date it was decided and why are kept on the card.
      const c = state.redCards.find(x => x.id === form.dataset.id);
      const games = parseInt(form.games.value, 10), on = form.on.value, note = form.note.value.trim();
      const warn = form.querySelector('.warn');
      const missing = [[games >= 1 && games <= 20, 'rcGamesOut'], [on, 'rcChangeDate']].filter(([ok]) => !ok).map(([, k]) => t(k));
      if (missing.length) { warn.textContent = `${t('fillIn')}: ${missing.join(', ')}`; warn.hidden = false; return; }
      const staffNotes = form.staffNotes.value.trim();
      if (staffNotes !== (c.staffNotes || '')) {
        c.staffNotes = staffNotes;
        logAction(`${t('staffNotes')} · ${divName(c.div)}: ${c.player} (${c.team})`);
      }
      if (games !== c.games) {
        c.changes = [...(c.changes || []), { on, from: c.games, to: games, note }];
        logAction(`${t('rcEdited')} · ${divName(c.div)}: ${c.player} (${c.team}) · ${gamesCount(c.games)} → ${gamesCount(games)}${note ? ` · ${note}` : ''}`);
        c.games = games;
      }
      ui.rcEdit = null;
      save(); render();
      return toast(`${t('rcEdited')}: ${c.player}`);
    }
    case 'settings-fields': {
      // Only divisions that differ from their usual fields are kept (nothing ticked = every field).
      const fields = {}, all = openFields();
      DIVISIONS.forEach(d => {
        const picked = [...form.querySelectorAll(`input[name="f|${d.id}"]:checked`)].map(i => i.value);
        const def = defaultDivisionFields(d.id);
        const usual = def.length < all.length ? def : [];
        if (!(picked.length === usual.length && picked.every(f => usual.includes(f)))) fields[d.id] = picked;
      });
      settingsOf().fields = fields;
      const lengths = {};
      DIVISIONS.forEach(d => {
        const box = form.querySelector(`[name="len|${d.id}"]`);
        const n = box ? parseInt(box.value, 10) : (settingsOf().lengths || {})[d.id];
        if (n >= 20 && n <= 150) lengths[d.id] = n;
      });
      settingsOf().lengths = lengths;
      logAction(`${t('usualSetupTitle')}: ${[...new Set([...Object.keys(fields), ...Object.keys(lengths)])].map(divName).join(', ') || t('backToDefault')}`);
      save(); render();
      return toast(t('saved'));
    }
    case 'settings-lengths': {
      const lengths = {};
      DIVISIONS.forEach(d => {
        const n = parseInt(form.querySelector(`[name="len|${d.id}"]`).value, 10);
        if (n >= 20 && n <= 120) lengths[d.id] = n;
      });
      settingsOf().lengths = lengths;
      logAction(`${t('gameLengthsTitle')}: ${Object.entries(lengths).map(([d, n]) => `${divName(d)} ${n}`).join(', ') || t('backToDefault')}`);
      save(); render();
      return toast(t('saved'));
    }
    case 'move-day': {
      readMoveForm(form);
      const { from, to } = ui.moveDay;
      const divs = movingDivs();
      if (!to || to <= from) return;
      if (divs && !divs.length) { const w = form.querySelector('.warn'); w.textContent = t('pickDivision'); w.hidden = false; return; }
      const inScope = m => !divs || divs.includes(m.div);
      const n = unplayedOn(from).filter(inScope).length;
      const push = unplayedOn(to).some(inScope) && (form.querySelector('[name=push]:checked') || {}).value !== '0';
      if (push) pushSeason(from, to, divs); else moveDay(from, to, divs);
      logAction(`${t('logMovedDay')}: ${gamesCount(n)} · ${fmtDate(from)} → ${fmtDate(to)}${divs ? ` (${divs.map(divName).join(', ')})` : ''}${push ? ` · ${t('laterWeeksMoved')}` : ''}`);
      ui.moveDay = null;
      ui.boardWeek = sundayOf(to);
      ui.boardDays[ui.boardSection] = dayOfWeek(to);
      save(); render();
      return toast(`${t('gamesMoved').replace('{n}', gamesCount(n))} ${fmtDate(to, { weekday: 'short', month: 'short', day: 'numeric' })}${push ? ` · ${t('laterWeeksMoved')}` : ''}`);
    }
    case 'place-address': {
      const place = form.dataset.place, address = form.address.value.trim();
      state.placeAddresses = { ...(state.placeAddresses || {}), [place]: address };
      if (!address) delete state.placeAddresses[place];
      logAction(`${t('logAddress')}: ${place}${address ? ` · ${address}` : ''}`);
      ui.editAddress = null;
      save(); render();
      return toast(`${t('saved')}: ${place}`);
    }
    case 'new-season': {
      const name = form.querySelector('[name=name]').value.trim();
      // Youth ticked: only the youth divisions still ticked under it (all of them → "Youth").
      const divs = [...form.querySelectorAll('input[name=divs]:checked')].map(i => i.value).filter(k => k !== 'youth');
      if (form.querySelector('input[name=divs][value=youth]').checked) {
        const boxes = [...form.querySelectorAll('input[name=youthDivs]')];
        const picked = boxes.filter(i => i.checked).map(i => i.value);
        divs.unshift(...(picked.length === boxes.length ? ['youth'] : picked));
      }
      const warn = form.querySelector('.warn');
      if (!name || !divs.length) { warn.textContent = t(name ? 'pickDivision' : 'newSeasonName'); warn.hidden = false; return; }
      const games = parseInt(form.querySelector('[name=games]').value, 10);
      ui.newSeason = { name, divs, games: games >= 1 && games <= 40 ? games : null };
      return render();
    }
    case 'add-team': {
      const f = new FormData(form);
      const name = f.get('name').trim();
      const divs = f.getAll('divs');
      if (!name) return;
      if (!divs.length) { form.querySelector('.warn').hidden = false; return; }
      // A hidden team joining: a fixed name carries to its earlier games, and its logo comes along.
      const join = form.dataset.join;
      if (join) {
        if (name !== join) renameHidden(ui.adminDiv, join, name);
        const old = (state.logos || {})[`${ui.adminDiv}|${name}`];
        if (old && !form.closest('dialog').dataset.logo) form.closest('dialog').dataset.logo = old;
      }
      const added = [], skipped = [];
      divs.forEach(id => {
        state.teams[id] = state.teams[id] || [];
        if (state.teams[id].some(n => n.toLowerCase() === name.toLowerCase())) skipped.push(divName(id));
        else { state.teams[id].push(name); added.push(divName(id)); }
      });
      // Not official yet: kept off the standings in the divisions it was added to (Edit team shows it again).
      const hide = f.get('hideStandings') === 'on';
      if (hide) divs.forEach(id => {
        if (!added.includes(divName(id))) return;
        state.standingsHidden = { ...(state.standingsHidden || {}), [id]: [...hiddenFromStandings(id), name] };
      });
      if (added.length) logAction(`${t(join ? 'joinedLeague' : 'logTeamAdded')}: ${name} · ${added.join(', ')}${hide ? ` · ${t('hiddenFromStandingsTag')}` : ''}`);
      // Replacement games picked to count on the new team's record.
      const counted = f.getAll('countGames').map(Number).map(id => state.matches.find(m => m.id === id))
        .filter(m => m && divs.includes(m.div) && added.includes(divName(m.div)));
      counted.forEach(m => { if (m.fillerTeam.toLowerCase() === name.toLowerCase()) { if (m.home === m.fillerTeam) m.home = name; else m.away = name; m.fillerTeam = name; } m.fillerCounts = true; touch(m.div); });
      if (counted.length) logAction(`${t('joinGamesLog')}: ${name} · ${counted.map(m => `${divName(m.div)} ${fmtDate(m.date)}`).join(', ')}`);
      // Divisions using the Game rotation: an empty number goes to the new team (nobody else's games change).
      // With every number taken it stays without one, and Game rotation shows it under "No number yet".
      const numbered = [];
      divs.forEach(id => {
        const rot = (state.rotation || {})[id];
        if (!rot || !Object.keys(rot.numbers).length || !added.includes(divName(id)) || rotationNumber(id, name)) return;
        freezePastRotation(id);
        // Added from a rest spot: the rest number becomes a real number for this team.
        if (form.dataset.rest === id && rot.size % 2) rot.size += 1;
        for (let n = 1; n <= rot.size; n++) if (!rot.numbers[n]) { rot.numbers[n] = name; numbered.push(`${divName(id)} #${n}`); break; }
      });
      if (numbered.length) logAction(`${t('rotation')}: ${name} → ${numbered.join(', ')}`);
      const logo = form.closest('dialog').dataset.logo;
      if (logo && added.length) {
        state.logos = state.logos || {};
        divs.forEach(id => { if (added.includes(divName(id))) state.logos[`${id}|${name}`] = logo; });
      }
      save();
      closeDialog(form.closest('dialog'));
      render();
      if (form.dataset.addkey && added.length) pickAddedTeam(form.dataset.addkey, name);
      // Added from a friendly's "Counts for": the game now counts for it (under the name it was added as).
      const pf = ui.pendingFriendlyCount;
      if (pf && added.length) {
        ui.pendingFriendlyCount = null;
        const fr = ((((state.matchDays || {})[pf.date] || {}).youth || {})[pf.field] || []).concat(...Object.values((state.matchDays || {})[pf.date] || {}).map(sec => (sec || {})[pf.field] || [])).find(x => x.id === pf.row);
        if (fr) {
          fr[pf.side] = name;
          fr.countFor = [...new Set([...(fr.countFor || []), pf.side])].filter(x => x === 'home' || x === 'away');
          syncFriendlyCount(pf.date, pf.field, fr, fr.fdiv || ui.adminDiv);
          logAction(`${t('friendly')} · ${fmtDate(pf.date)} · ${fr.home} ${t('vs')} ${fr.away}: ${t('friendlyNowCounts')} ${name}`);
          save(); render();
        }
      }
      // Brought back from Archived teams: it's a current team again, so it comes off the archive.
      if (form.dataset.archived && added.length && state.archivedTeams) { delete state.archivedTeams[form.dataset.archived]; save(); render(); }
      return toast(added.length
        ? `${name} ${t('addedTo')} ${added.join(', ')}${skipped.length ? ` (${t('alreadyIn')} ${skipped.join(', ')})` : ''}${numbered.length ? ` · ${t('rotationNumberGiven')} ${numbered.join(', ')}` : ''}`
        : `${name} ${t('alreadyIn')} ${skipped.join(', ')}`);
    }
  }
});

// Enter in the "add a usual time" box adds the time instead of submitting the match.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches('.sheet .cell')) {
    e.preventDefault();
    const td = e.target.closest('td');
    const below = td.parentElement.nextElementSibling?.children[td.cellIndex]?.querySelector('input');
    if (below) { below.focus(); below.select(); } else e.target.blur();
    return;
  }
});

document.addEventListener('input', e => {
  if (e.target.matches('.sheet .cell.g')) {
    e.target.value = e.target.value.replace(/\D/g, '');
    saveSheetRow(e.target.closest('tr'));
  }
});

// "＋ Add a team…" in a team list: put the list back the way it was and open Add team instead.
window.addEventListener('change', e => {
  const sel = e.target;
  if (!sel.matches || !sel.matches('select[data-addkey]') || sel.value !== '__addteam') return;
  e.stopImmediatePropagation();
  const was = [...sel.options].find(o => o.defaultSelected);
  sel.value = was ? was.value : (sel.options[0] || {}).value || '';
  // On the planner, next to a team the rotation has resting this game: the new team also takes the rest spot.
  const div = sel.dataset.adddiv, tr = sel.closest('tr');
  const other = tr && sel.matches('.b-home, .b-away') ? tr.querySelector(sel.matches('.b-home') ? '.b-away' : '.b-home').value : '';
  const rest = !!other && rotationOf(div).size % 2 === 1 && rotationOpponent(div, ui.boardDate, other) === 'rest';
  openAddTeam('', rest, div, sel.dataset.addkey);
}, true);

document.addEventListener('change', e => {
  if (e.target.matches('[data-logo-input]') && e.target.files[0]) {
    const dialog = e.target.closest('dialog');
    readLogo(e.target.files[0]).then(url => {
      dialog.dataset.logo = url;
      dialog.querySelector('.logo-preview').innerHTML = `<span class="team-badge big has-logo"><img src="${url}" alt=""></span>`;
      dialog.querySelector('[data-action=remove-logo]').hidden = false;
    }).catch(() => toast(t('logoError')));
    return;
  }
  if (e.target.dataset.change === 'strict') {
    const { section, field } = e.target.dataset;
    state.looseTimes = state.looseTimes || {};
    const day = state.looseTimes[ui.boardDate] = state.looseTimes[ui.boardDate] || {};
    day[`${section}|${field}`] = !e.target.checked;
    reflow(section, field);
    save(); return redrawBoard();
  }
  if ((e.target.dataset.change === 'sheet-date' || e.target.dataset.change === 'board-date') && e.target.value === '__other') {
    // "Other day…": show a calendar next to the list for any date.
    ui.otherDay = e.target.dataset.change;
    render();
    const cal = document.querySelector(`input.other-day[data-change="${ui.otherDay}"]`);
    if (cal) { cal.focus(); try { cal.showPicker(); } catch (err) {} }
    return;
  }
  if (e.target.dataset.change === 'sheet-date' && e.target.value) { ui.sheetDate = e.target.value; ui.otherDay = null; return render(); }
  if (e.target.dataset.change === 'sheet-ref') {
    const date = ui.sheetDate || ui.boardDate, key = e.target.dataset.key, i = +e.target.dataset.i;
    const list = fieldRefs(date, key).map(x => ({ ...x }));
    if (!list.length) list.push({ name: '', times: null });
    list[i].name = e.target.value.trim();
    return setFieldRefs(date, key, list);
  }
  if (e.target.dataset.change === 'friendly-day') {
    state.friendlyDays = { ...(state.friendlyDays || {}) };
    if (e.target.checked) state.friendlyDays[ui.boardDate] = true;
    else {
      delete state.friendlyDays[ui.boardDate];
      // Slots that were only friendlies because of the switch stay friendlies if something was typed in them.
    }
    logAction(`${t('friendlyDay')} · ${fmtDate(ui.boardDate)}: ${t(e.target.checked ? 'on' : 'off')}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-auto') {
    const div = e.target.dataset.rdiv;
    state.rotationOff = { ...(state.rotationOff || {}) };
    if (e.target.checked) delete state.rotationOff[div]; else state.rotationOff[div] = true;
    logAction(`${t('rotationAuto')} · ${divName(div)}: ${t(e.target.checked ? 'on' : 'off')}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-size') {
    const size = Math.max(2, Math.min(30, parseInt(e.target.value, 10) || 2));
    const rot = rotationOf(ui.adminDiv);
    const numbers = Object.fromEntries(Object.entries(rot.numbers).filter(([n]) => +n <= size));
    return setRotation(ui.adminDiv, { size, numbers }, `${t('howManyNumbers')} ${size}`);
  }
  if (['rot-draft-week', 'rot-draft-size', 'rot-draft-num'].includes(e.target.dataset.change) && ui.rotDraft) {
    const d = ui.rotDraft, ch = e.target.dataset.change;
    if (ch === 'rot-draft-week') d.week = e.target.value;
    if (ch === 'rot-draft-size') {
      d.size = Math.max(2, Math.min(30, parseInt(e.target.value, 10) || d.size));
      d.numbers = Object.fromEntries(Object.entries(d.numbers).filter(([n]) => +n <= d.size));
    }
    if (ch === 'rot-draft-num') {
      const n = e.target.dataset.n, team = e.target.value, numbers = { ...d.numbers };
      const had = Object.keys(numbers).find(k => numbers[k] === team && k !== n);
      if (had) { if (numbers[n]) numbers[had] = numbers[n]; else delete numbers[had]; }
      if (team) numbers[n] = team; else delete numbers[n];
      d.numbers = numbers;
    }
    return render();
  }
  if (e.target.dataset.change === 'rot-game-size') {
    // how many numbers this one game has (only this game; numbers above the new count come off it)
    const div = ui.adminDiv, g = +e.target.dataset.g, rot = rotationOf(div), at = rotationAt(div, g);
    const size = Math.max(2, Math.min(30, parseInt(e.target.value, 10) || at.size));
    if (size === at.size) return;
    const numbers = Object.fromEntries(Object.entries(at.numbers).filter(([n]) => +n <= size));
    const past = { ...(rot.past || {}), [g]: { size, numbers } };
    state.rotation = { ...(state.rotation || {}), [div]: { ...rot, past } };
    logAction(`${t('rotation')} · ${divName(div)}: ${t('game')} ${g} · ${t('howManyNumbers')} ${size}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-game-num') {
    // this one game's numbers (only the chart for that game; booked or played games keep their teams)
    const div = ui.adminDiv, g = +e.target.dataset.g, n = e.target.dataset.n, team = e.target.value, rot = rotationOf(div);
    const at = rotationAt(div, g), numbers = { ...at.numbers };
    const had = Object.keys(numbers).find(k => numbers[k] === team && k !== n);
    if (had) { if (numbers[n]) numbers[had] = numbers[n]; else delete numbers[had]; }
    if (team) numbers[n] = team; else delete numbers[n];
    const past = { ...(rot.past || {}), [g]: { size: at.size, numbers } };
    state.rotation = { ...(state.rotation || {}), [div]: { ...rot, past } };
    logAction(`${t('rotation')} · ${divName(div)}: ${t('game')} ${g} · ${n} = ${team || '—'}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-round-week') {
    // which week plays this round: Automatic, TBD (held for later) or a picked week
    const div = ui.adminDiv, r = +e.target.dataset.r, v = e.target.value, rot = rotationOf(div);
    const rounds = Object.fromEntries(Object.entries(rot.rounds || {}).filter(([, x]) => x !== r));
    const held = new Set(rot.held || []);
    held.delete(r);
    if (v === 'tbd') held.add(r);
    if (v.startsWith('g:')) rounds[+v.slice(2)] = r;
    const nextRot = { ...rot, rounds, held: [...held].sort((a, b) => a - b) };
    if (!Object.keys(rounds).length) delete nextRot.rounds;
    if (!nextRot.held.length) delete nextRot.held;
    state.rotation = { ...(state.rotation || {}), [div]: nextRot };
    logAction(`${t('rotation')} · ${divName(div)}: ${t('roundWord')} ${r} → ${v === 'tbd' ? t('rotGameTbd') : v === 'auto' ? t('rotAutoShort') : `${t('game')} ${v.slice(2)}`}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-round') {
    // which round this game plays (only the chart and what the planner suggests; booked games stay)
    const div = ui.adminDiv, g = +e.target.dataset.g, r = +e.target.value, rot = rotationOf(div);
    const rounds = { ...(rot.rounds || {}) };
    if (!r) delete rounds[g]; else rounds[g] = r;
    const next = { ...rot, rounds };
    if (!Object.keys(rounds).length) delete next.rounds;
    state.rotation = { ...(state.rotation || {}), [div]: next };
    logAction(`${t('rotation')} · ${divName(div)}: ${t('game')} ${g} → ${r ? `${t('roundWord')} ${r}` : t('rotAutoShort')}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'rot-num') {
    const rot = rotationOf(ui.adminDiv), n = e.target.dataset.n, team = e.target.value;
    // A team can only have one number: picking it here swaps it with whoever had this number.
    const apply = was => {
      const numbers = { ...was };
      const had = Object.keys(numbers).find(k => numbers[k] === team && k !== n);
      if (had) { if (numbers[n]) numbers[had] = numbers[n]; else delete numbers[had]; }
      if (team) numbers[n] = team; else delete numbers[n];
      return numbers;
    };
    return setRotation(ui.adminDiv, { size: rot.size, numbers: apply(rot.numbers) }, team ? `${n} = ${team}` : `${n} = —`, );
  }
  if (['po-size', 'po-round', 'po-third'].includes(e.target.dataset.change)) {
    const form = e.target.form;
    const size = +form.size.value;
    ui.poDraft = { tie: (form.querySelector('[name=tie]:checked') || {}).value || 'pens', on: form.on.value, third: form.third.checked,
      roundLegs: readRoundLegs(form, size) };
    if (e.target.dataset.change === 'po-size') ui.poSize = size;
    if (e.target.dataset.change === 'po-round') {
      const i = PLAYOFF_ROUNDS.indexOf(e.target.value);
      ui.poStart = e.target.checked ? e.target.value : PLAYOFF_ROUNDS[i + 1];
      ui.poSize = null;
    }
    return render();
  }
  if (e.target.dataset.change === 'filler-field') {
    const form = e.target.form, sel = e.target;
    if (sel.value === '__other') {
      const usual = divisionFields(form.dataset.league);
      const rest = openFields().filter(f => !usual.includes(f));
      sel.innerHTML = usual.map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')
        + `<optgroup label="${t('otherFields')}">${rest.map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')}</optgroup>`;
      sel.value = rest[0];
    }
    // The time list follows the field: only its open slots, plus "Other time…".
    const ed = state.matches.find(x => x.id === +form.dataset.mid && x.filler);
    const times = ed ? editSlots(ed, sel.value) : openSlots(sel.value);
    form.time.innerHTML = fillerTimeOptions(times, ed && ed.field === sel.value ? toMin(ed.time) : null);
    form.customTime.hidden = times.length > 0;
    return;
  }
  if (e.target.dataset.change === 'copa-move') {
    const div = ui.adminDiv, co = copaOf(div), x = e.target.dataset.team;
    undoable(`${t('moveGroup')}: ${x}`);
    co.groups.forEach(g => { g.teams = g.teams.filter(y => y !== x); });
    co.groups.find(g => g.name === e.target.value).teams.push(x);
    // Its group games still to play no longer fit a group; they're checked again.
    state.matches.filter(m => m.div === div && !played(m) && (m.home === x || m.away === x) && m.playoff && m.playoff.group).forEach(m => { delete m.playoff; tagPlayoff(m); });
    ui.copaEditOpen = true;
    logAction(`${t('moveGroup')} · ${divName(div)}: ${x} → ${t('group')} ${e.target.value}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'ti-date') { ui.tiDate = e.target.value; return render(); }
  if (e.target.dataset.change === 'hp-text' || e.target.dataset.change === 'hp-link') {
    const k = e.target.dataset.k, v = e.target.value.trim(), hpData = clone(state.homePage || {});
    const part = e.target.dataset.change === 'hp-link' ? 'links' : LANG;
    hpData[part] = { ...(hpData[part] || {}), [k]: v };
    if (!v) delete hpData[part][k];
    state.homePage = hpData;
    save(); return render();
  }
  if (e.target.dataset.change === 'ti-pct') {
    const v = Math.round(+e.target.value);
    if (v >= 20 && v <= 100) setImg('scores', { ...imgSet('scores'), [e.target.dataset.k]: v });
    return render();
  }
  if (e.target.dataset.change === 'ti-font') {
    const kind = ['scorers', 'scores'].includes(ui.tiKind) ? ui.tiKind : 'standings';
    if (IMG_FONTS.includes(e.target.value)) setImg(kind, { ...imgSet(kind), [e.target.dataset.k === 'headFont' ? 'headFont' : 'font']: e.target.value });
    return render();
  }
  if (['ti-set', 'ti-col', 'ti-header', 'ti-autofit', 'ti-count', 'ti-color', 'ti-flag'].includes(e.target.dataset.change)) {
    const kind = ['scorers', 'scores'].includes(ui.tiKind) ? ui.tiKind : 'standings', o = imgSet(kind);
    if (e.target.dataset.change === 'ti-color') {
      // a hex code, with or without #; 3 digits (#FFF) count as 6
      let h = e.target.value.trim().replace(/^#/, '');
      if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(x => x + x).join('');
      if (!/^[0-9a-f]{6}$/i.test(h)) { e.target.value = o[e.target.dataset.k].toUpperCase(); return toast(t('hexBad')); }
      o[e.target.dataset.k] = `#${h.toLowerCase()}`;
    }
    if (e.target.dataset.change === 'ti-flag') o[e.target.dataset.k] = e.target.checked;
    if (e.target.dataset.change === 'ti-count') o[e.target.dataset.k] = +e.target.value;
    if (e.target.dataset.change === 'ti-autofit') o.autoFit = e.target.checked;
    if (e.target.dataset.change === 'ti-set') {
      const k = e.target.dataset.k, inch = e.target.dataset.unit === 'in';
      let n = parseFloat(e.target.value);
      const zeroOk = ['height', 'headHeight', 'spaceBelow', 'headFontSize'].includes(k) || k.startsWith('col:');
      if (zeroOk && e.target.value.trim() === '') n = 0;
      if (!(n >= 0) || (n === 0 && !zeroOk)) return;
      // leaving the automatic height as it was shown doesn't fix it
      if (k === 'height' && !(o.height > 0) && e.target.classList.contains('auto-val') && Math.round(n * (inch ? 96 : 1)) === Math.round(tableUsed(ui.adminDiv, kind).natural)) return;
      if (e.target.dataset.unit === 'pt') n = n / 0.75;
      else if (inch) n = n * 96;
      const key = k.startsWith('col:') ? 'colWidth' : k;
      const lo = { headFontSize: 6, width: 400, height: 0, rowHeight: 12, fontSize: 8, logoSize: 8, headHeight: 12, spaceBelow: 0, colWidth: 20, bottomHeight: 1, rowWidth: 200 }[key], hi = { headFontSize: 64, width: 1600, height: 2400, rowHeight: 120, fontSize: 32, logoSize: 70, headHeight: 120, spaceBelow: 600, colWidth: 800, bottomHeight: 60, rowWidth: 1600 }[key];
      // font sizes keep fractions so 11 pt stays 11 pt; the rest are whole pixels
      const top = kind === 'scores' && key === 'rowHeight' ? 400 : hi; // a score row can be taller than a table row
      const v = n === 0 ? 0 : Math.max(lo, Math.min(top, k === 'fontSize' || k === 'headFontSize' ? Math.round(n * 100) / 100 : Math.round(n)));
      if (k.startsWith('col:')) o.colWidths = { ...o.colWidths, [k.slice(4)]: v }; else o[k] = v;
    }
    if (e.target.dataset.change === 'ti-col') o.cols = (kind === 'scorers' ? SCORER_COLS : TABLE_COLS).map(c => c[0]).filter(k => (k === e.target.value ? e.target.checked : o.cols.includes(k)));
    if (e.target.dataset.change === 'ti-header') o.headerRow = e.target.checked;
    setImg(kind, o);
    return render();
  }
  if (e.target.dataset.change === 'tour-length') {
    const d = DIVISIONS.find(x => x.id === e.target.dataset.id);
    const n = Math.max(10, Math.min(120, parseInt(e.target.value, 10) || d.length));
    d.length = n;
    const l = (state.leagues || []).find(x => x.id === d.id);
    if (l) l.length = n;
    logAction(`${t('tourLength')} · ${divName(d.id)}: ${n}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'tour-loose') {
    const d = DIVISIONS.find(x => x.id === e.target.dataset.id);
    d.loose = !e.target.checked;
    const l = (state.leagues || []).find(x => x.id === d.id);
    if (l) l.loose = d.loose;
    logAction(`${t('strictTimes')} · ${divName(d.id)}: ${t(e.target.checked ? 'on' : 'off')}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'tour-field') {
    const d = DIVISIONS.find(x => x.id === e.target.dataset.id);
    const next = e.target.checked ? [...new Set([...d.fields, e.target.value])] : d.fields.filter(f => f !== e.target.value);
    if (!next.length) { e.target.checked = true; return toast(t('needOneField')); }
    d.fields = next;
    logAction(`${t('tourFieldsChanged')} · ${divName(d.id)}: ${next.map(f => FIELDS[f]).join(', ')}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'tour-div-add-date' && e.target.value) {
    const d = DIVISIONS.find(x => x.id === e.target.dataset.id);
    if (d && !d.dates.includes(e.target.value)) {
      d.dates = [...d.dates, e.target.value].sort();
      syncTourDates(d);
      logAction(`${t('tourDayAdded')} · ${divName(d.id)}: ${fmtDate(e.target.value)}`);
      save();
    }
    return render();
  }
  if (e.target.dataset.change === 'tour-pick-date' && e.target.value) {
    const form = e.target.form;
    setFormDates(form, [...JSON.parse(form.dates.value || '[]'), e.target.value]);
    e.target.value = '';
    return;
  }
  if (e.target.dataset.change === 'day-off-date') {
    // Redraw so the choices only list the divisions that play on that weekday (keep the name typed so far).
    const note = e.target.form.note.value;
    ui.dayOffDate = e.target.value;
    render();
    const f = document.querySelector('form[data-form=add-day-off]');
    if (f) f.note.value = note;
    return;
  }
  if (e.target.dataset.change === 'day-off-who') { e.target.form.querySelector('.day-off-divs').hidden = e.target.value !== 'some'; return; }
  if (e.target.dataset.change === 'filler-pick' && e.target.value === '__more') {
    // the forfeit is a withdrawn team's game or a regular game that was forfeited
    const id = +e.target.form.dataset.mid, f = findForfeit(id), m = f ? f.m : state.matches.find(x => x.id === id);
    if (!m) return;
    const box = e.target.form.name;
    e.target.outerHTML = replacementSelectHTML(m, true);
    box.hidden = false;
    const sel = box.form.querySelector('[name=pick]');
    sel.focus(); try { sel.showPicker(); } catch (err) {}
    return;
  }
  if (e.target.dataset.change === 'filler-pick') {
    const box = e.target.form.name;
    box.hidden = e.target.value !== '__new';
    if (!box.hidden) box.focus();
    return;
  }
  if (e.target.dataset.change === 'filler-time') {
    const c = e.target.form.customTime;
    c.hidden = e.target.value !== '__other';
    if (!c.hidden) c.focus();
    return;
  }
  if (e.target.dataset.change === 'copa-draft') { ui.copaDraft = readCopaDraft(e.target.form, ui.adminDiv); return render(); }
  if (e.target.dataset.change === 'po-pick') {
    const po = knockoutOf(ui.adminDiv, e.target.dataset.cup || 'playoffs');
    po.picks = { ...(po.picks || {}) };
    if (e.target.value) po.picks[e.target.dataset.key] = e.target.value; else delete po.picks[e.target.dataset.key];
    touch(ui.adminDiv);
    logAction(`${t('playoffs')} · ${divName(ui.adminDiv)}: ${t('whoAdvances')} ${e.target.value}`);
    save(); return render();
  }
  if (e.target.dataset.change === 'admin-team') { ui.adminTeam = e.target.value; ui.editGame = null; ui.notesOpen = null; return render(); }
  if (e.target.dataset.change === 'forfeit-div') { ui.forfeitDiv = e.target.value; return render(); }
  if (e.target.dataset.change === 'forfeit-team' || e.target.dataset.change === 'forfeit-gone') {
    const f = findForfeit(+e.target.closest('.forfeit-row').dataset.mid);
    if (!f) return;
    const other = f.m.home === f.w.team ? f.m.away : f.m.home;
    const team = e.target.dataset.change === 'forfeit-team' ? e.target.value : other;
    const gone = e.target.dataset.change === 'forfeit-gone' ? e.target.value : f.w.team;
    if (!team) return render();
    if (team !== other && hasGameOn(f.m.div, team, f.m.date, f.m.id)) { toast(`${team} ${t('alreadyPlaysToday')}`); return render(); }
    const m = { ...f.m, home: team, away: gone };
    f.w.left.splice(f.i, 1);
    const to = state.withdrawn[`${f.m.div}|${gone}`];
    to.left = [...(to.left || []), m];
    touch(f.m.div);
    logAction(`${t('forfeitChanged')} · ${divName(m.div)} · ${fmtDate(m.date)}: ${team} ${t('vs')} ${gone}`);
    save(); return render();
  }
  if (e.target.closest('.board')) {
    return e.target.matches('.tp-h, .tp-m') ? commitTimeBox(e.target) : boardChange(e.target);
  }
  if (e.target.dataset.change === 'pa-div') {
    // new division: its teams and game days fill the menus (what's typed stays)
    const form = e.target.form, div = e.target.value;
    if (!form.dataset.id) ui.paDiv = div;
    const tmp = document.createElement('div');
    tmp.innerHTML = paReportFields({ div, player: form.player.value, date: form.date.value });
    ['team', 'by', 'game'].forEach(n => form[n].replaceWith(tmp.querySelector(`[name=${n}]`)));
    return;
  }
  if (e.target.dataset.change === 'pa-game') { if (e.target.value) e.target.form.date.value = e.target.value; return; }
  if (e.target.dataset.change === 'pa-role') {
    const box = e.target.closest('.field').nextElementSibling;
    if (box && box.classList.contains('pa-role-other')) { box.hidden = e.target.value !== 'paRoleOther'; if (!box.hidden) box.querySelector('input').focus(); }
    return;
  }
  if (e.target.dataset.change === 'pa-doc') { e.target.form.querySelector('.pa-doc-other').hidden = e.target.value !== 'paDocOther'; return; }
  if (e.target.dataset.change === 'rc-div' || e.target.dataset.change === 'rc-team') {
    // Picking a division fills its teams; picking a team fills its games and player names.
    const form = e.target.form, div = form.div.value;
    if (e.target.dataset.change === 'rc-div') { form.team.innerHTML = rcTeamOptions(div, ''); form.team.disabled = false; }
    const team = form.team.value;
    form.match.innerHTML = team ? rcGameOptions(div, team) : `<option value="">${t('chooseOne')}</option>`;
    form.match.disabled = !team;
    return;
  }
  if (e.target.dataset.change === 'age-like') {
    // Start from the age group it works like: its game length and fields, unless you've changed them.
    const form = e.target.form, like = e.target.value;
    const len = form.querySelector('[name=length]');
    if (len.value === '' || len.value === len.dataset.auto) len.value = len.dataset.auto = lengthFor('', like);
    if (form.dataset.fieldsTouched !== '1') {
      const usual = divisionFields(like);
      form.querySelectorAll('[name=fields]').forEach(i => { i.checked = usual.includes(i.value); });
    }
    return;
  }
  if (e.target.dataset.change === 'age-field') { e.target.form.dataset.fieldsTouched = '1'; return; }
  if (e.target.dataset.change === 'league-kind' || e.target.dataset.change === 'league-age') {
    const form = e.target.form;
    const kind = form.querySelector('[name=kind]').value;
    form.querySelector('.league-youth').hidden = kind !== 'youth';
    form.querySelector('.league-other').hidden = kind !== 'other';
    const age = kind === 'youth' ? (form.querySelector('[name=age]:checked') || {}).value : '';
    const { length, fields } = leagueDefaults(kind, age);
    const len = form.querySelector('[name=length]');
    if (len.value === '' || len.value === len.dataset.auto) len.value = len.dataset.auto = length;
    if (form.dataset.scorersTouched !== '1' && kind) {
      form.querySelector(`[name=scorers][value=${kind === 'futsal' ? 'no' : 'yes'}]`).checked = true;
    }
    if (form.dataset.fieldsTouched !== '1') {
      form.querySelectorAll('input[name=fields]').forEach(i => { i.checked = fields.includes(i.value); });
    }
    return;
  }
  if (e.target.matches('.league-form input[name=fields]')) { e.target.form.dataset.fieldsTouched = '1'; return; }
  if (e.target.dataset.change === 'league-scorers') { e.target.form.dataset.scorersTouched = '1'; return; }
  if (e.target.dataset.change === 'add-game-field' && e.target.value === '__other') {
    // "Other field…" lists every other field below the division's usual ones.
    const usual = divisionFields(e.target.form.dataset.league || ui.adminDiv);
    const rest = openFields().filter(f => !usual.includes(f));
    e.target.innerHTML = usual.map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')
      + `<optgroup label="${t('otherFields')}">${rest.map(f => `<option value="${f}">${esc(FIELDS[f])}</option>`).join('')}</optgroup>`;
    e.target.value = rest[0];
    e.target.focus();
    return;
  }
  if (e.target.dataset.change === 'move-day-to' || e.target.dataset.change === 'move-day-div') {
    if (e.target.name === 'toCustom') e.target.focus();
    readMoveForm(e.target.form);
    render();
    const cal = ui.moveOther && document.querySelector('input[name=toCustom]');
    if (cal) { cal.focus(); try { cal.showPicker(); } catch (err) {} }
    return;
  }
  if (e.target.dataset.change === 'field-place') {
    const boxes = [...e.target.form.querySelectorAll('.new-place')];
    boxes.forEach(b => { b.hidden = e.target.value !== '__new'; });
    if (!boxes[0].hidden) boxes[0].querySelector('input').focus();
    return;
  }
  // Postponed saves right away and moves the game to the Postponed tab, where its date and score go.
  if (e.target.dataset.change === 'score-pick') {
    const id = +e.target.closest('form').dataset.id;
    if (e.target.checked) scorePicks().add(id); else scorePicks().delete(id);
    return refreshSaveAll();
  }
  if (e.target.dataset.change === 'score-pick-all') {
    document.querySelectorAll('form.score-row').forEach(f => (e.target.checked ? scorePicks().add(+f.dataset.id) : scorePicks().delete(+f.dataset.id)));
    return refreshSaveAll();
  }
  if (e.target.dataset.change === 'reg-btn') return saveRegGroup(e.target.closest('[data-reg-group]'));
  if (e.target.dataset.change === 'reg-card') {
    const id = e.target.closest('[data-reg-card]').dataset.regCard, f = e.target.dataset.f, v = e.target.value.trim();
    const rc = regCardsState();
    if (rc.added.some(x => x.id === id)) state.regCards = { ...rc, added: rc.added.map(x => (x.id === id ? { ...x, [f]: v } : x)) };
    else {
      const def = REG_SECTIONS.flatMap(([sec]) => regCardDefaults(sec)).find(x => x.id === id) || {};
      const e2 = { ...(rc.edits[id] || {}), [f]: v };
      if (v === (def[f] || '')) delete e2[f]; // back to how it started
      const edits = { ...rc.edits, [id]: e2 };
      if (!Object.keys(e2).length) delete edits[id];
      state.regCards = { ...rc, edits };
    }
    save(); return render();
  }
  if (e.target.dataset.change === 'friendly-score' || e.target.dataset.change === 'friendly-count') {
    const { date, field, r } = findFriendly(e.target);
    if (!r) return;
    // A team that isn't in the division yet: add it first (Add team, already filled in), then it counts.
    if (e.target.dataset.needsTeam) {
      e.target.checked = false;
      const div = r.fdiv || ui.adminDiv, side = e.target.dataset.side;
      ui.pendingFriendlyCount = { date, field, row: r.id, side };
      return openAddTeam('', false, div, '', null, r[side], t('friendlyAddFirst').replace('{x}', r[side]).replace(/\{div\}/g, divName(div)));
    }
    if (e.target.dataset.change === 'friendly-score') {
      const v = e.target.value.trim();
      r[e.target.dataset.side] = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    } else {
      const set = new Set(r.countFor || []);
      set[e.target.checked ? 'add' : 'delete'](e.target.dataset.side);
      r.countFor = ['home', 'away'].filter(x => set.has(x));
      const name = r[e.target.dataset.side];
      logAction(`${t('friendly')} · ${fmtDate(date)} · ${r.home} ${t('vs')} ${r.away}: ${e.target.checked ? t('friendlyNowCounts') : t('friendlyNoLongerCounts')} ${name}`);
    }
    syncFriendlyCount(date, field, r, r.fdiv || ui.adminDiv);
    save();
    return render();
  }
  if (e.target.dataset.change === 'postponed') {
    const m = state.matches.find(x => x.id === +e.target.form.dataset.id);
    if (e.target.checked) m.postponed = true;
    else Object.assign(m, { postponed: false, playedOn: null, playedTime: null, playedField: null });
    logAction(`${t(m.postponed ? 'logPostponed' : 'unmarkedPostponed')} · ${divName(m.div)}: ${m.home} ${t('vs')} ${m.away}`);
    save(); render();
    return toast(`${t(m.postponed ? 'movedToPostponed' : 'unmarkedPostponed')}: ${m.home} ${t('vs')} ${m.away}`);
  }
  if (e.target.dataset.change === 'season-youth') {
    e.target.form.querySelector('.youth-pick').hidden = !e.target.checked;
    return;
  }
  if (e.target.dataset.change === 'board-date' && e.target.value) {
    ui.otherDay = null;
    // Picking a day opens a section that plays that day (a Wednesday opens Futsal, a Sunday Youth).
    const dow = dayOfWeek(e.target.value);
    const secs = daySections(e.target.value);
    ui.boardWeek = sundayOf(e.target.value);
    if (secs.length && !secs.includes(ui.boardSection)) ui.boardSection = secs[0];
    if (secs.length) ui.boardDays[ui.boardSection] = dow;
    return render();
  }
  if (e.target.dataset.change === 'add-field' && e.target.value === '__new') {
    // New field in a pop-up; the schedule stays as it is and the new field is added to this section.
    const section = e.target.dataset.section, date = ui.boardDate;
    e.target.value = '';
    return openFieldDialog(ids => {
      ids.forEach(id => { state.matchDays[date][section][id] = [{ ...newRow(sectionStart(section), true), added: true }]; });
      save(); redrawBoard();
    });
  }
  if (e.target.dataset.change === 'add-field' && e.target.value) {
    const section = e.target.dataset.section;
    const start = sectionStart(section);
    setHiddenOn(ui.boardDate, section, hiddenOn(ui.boardDate, section).filter(f => f !== e.target.value));
    state.matchDays[ui.boardDate][section][e.target.value] = templateRows(ui.boardDate, section, e.target.value).length
      ? templateRows(ui.boardDate, section, e.target.value).map(r => ({ ...r, added: true })) : [{ ...newRow(start, true), added: true }];
    save(); return redrawBoard();
  }
  if (e.target.matches('.sheet .cell.name')) saveSheetRow(e.target.closest('tr'));
  if (e.target.dataset.change === 'sheet-team') { ui.sheetTeam = e.target.value; render(); }
  if (e.target.dataset.change === 'score-day') { ui[e.target.dataset.key] = e.target.value; return render(); }
  if (e.target.dataset.change === 'rc-filter-team') { ui.rcTeam = e.target.value; ui.rcEdit = null; return render(); }
  if (e.target.dataset.change === 'admin-score-team') { ui.adminScoreTeam = e.target.value; ui.adminScoreDay = ui.adminScoreTeam ? 'all' : null; return render(); }
  if (e.target.dataset.change === 'team') { ui.team = e.target.value; ui.scoreDay = ui.team ? 'all' : null; render(); }
});

// Remember which fields are collapsed on the board.
document.addEventListener('toggle', e => {
  if (!e.target.matches || !e.target.matches('.board-field')) return;
  ui.closedFields[e.target.open ? 'delete' : 'add'](e.target.dataset.key);
}, true);

// Typing a score marks its game unsaved and shows the Save all bar.
document.addEventListener('input', e => {
  if (e.target.name === 'name' && e.target.form && e.target.form.dataset.form === 'add-team') {
    const box = e.target.form.querySelector('[data-join-games]');
    if (box) box.innerHTML = joinGamesHTML(e.target.value);
    return;
  }
  const f = e.target.closest && e.target.closest('form.score-row');
  // only the score boxes (a tick box sends this too, and is handled on change)
  if (!f || !e.target.classList.contains('score-in')) return;
  scorePicks().add(+f.dataset.id);
  refreshSaveAll();
});

// Tapping outside the phone admin menu closes it.
document.addEventListener('click', e => {
  if (!ui.adminMenuOpen || e.target.closest('.admin-nav, [data-action="admin-menu"]')) return;
  ui.adminMenuOpen = false;
  document.querySelector('.admin-nav')?.classList.remove('open');
  document.querySelector('[data-action="admin-menu"]')?.setAttribute('aria-expanded', 'false');
}, true);
window.addEventListener('hashchange', () => { ui.menuOpen = false; ui.adminMenuOpen = false; render(); window.scrollTo(0, 0); });

setLang(LANG);
// One-time data upgrades. They run on the published site only, so working on a copy here never changes the
// league's data before it's published. (The test copy can run them by hand: upgradeGoalCols().)
const LIVE_SITE = /(^|\.)alhambrasoccer\.com$|\.github\.io$/.test(location.hostname);
function runUpgrades() { return LIVE_SITE ? upgradeGoalCols() : false; }
runUpgrades();
render();
