// ---------- online data and admin sign-in (Firebase) ----------
// Everyone reads the league from Firestore (collection "league", one document per part of the data) and sees
// changes live. Admins sign in with a Firebase email and password; their edits save online right after they
// save here. This browser keeps a copy too, so the site opens fast and still shows something offline.
// The web settings below are meant to be public: who can change the data is decided by the sign-in and the
// Firestore rules, not by hiding them.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAA0qwfnoMEFQIrmhTfTc34ZZlsr33BvvA',
  authDomain: 'alhambra-soccer.firebaseapp.com',
  projectId: 'alhambra-soccer',
  storageBucket: 'alhambra-soccer.firebasestorage.app',
  messagingSenderId: '621408549370',
  appId: '1:621408549370:web:4b1a088d4f8198379ecc43',
};

const CLOUD = {
  on: false, // Firebase loaded
  ready: false, // the online data has arrived (nothing is sent before that, so an old copy can't overwrite it)
  user: null, // the signed-in admin
  synced: {}, // each part's JSON as it is online
  timer: null,
  waiting: null, // online changes held back while an admin is typing
};
// Parts of the saved data that stay in this browser only.
const LOCAL_ONLY = new Set(['admins']);
// Firestore documents hold up to 1 MB; bigger parts are split.
const CHUNK = 700000;

if (window.firebase && firebase.initializeApp) {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    CLOUD.db = firebase.firestore();
    CLOUD.auth = firebase.auth();
    CLOUD.on = true;
  } catch (e) { console.warn('Firebase did not start', e); }
}

// ---------- two admins at once ----------
// Each part of the data (all Goleadores, all games, all red cards…) is one online document. When two
// admins edit at the same time, their changes are merged instead of one copy replacing the other: what
// only this browser changed stays, what only the other admin changed comes in, and when both changed the
// very same value the one from this browser wins. Lists of things with an id (games, players, History…)
// merge item by item; two new items made at the same moment with the same id both stay (this browser's
// gets a new id). Lists of names merge as sets; lists of numbers (a player's goals per game) cell by cell.
const plainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sameVal = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const allWithIds = (...lists) => lists.every(a => a.every(x => plainObj(x) && x.id !== undefined && x.id !== null));
function merge3(base, mine, theirs) {
  if (sameVal(mine, theirs)) return mine;
  if (sameVal(mine, base)) return theirs;
  if (sameVal(theirs, base)) return mine;
  if (plainObj(mine) && plainObj(theirs)) {
    const b = plainObj(base) ? base : {}, out = {};
    [...Object.keys(theirs), ...Object.keys(mine).filter(k => !(k in theirs))].forEach(k => {
      const v = merge3(b[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const b = Array.isArray(base) ? base : [];
    if ((mine.length || theirs.length) && allWithIds(mine, theirs, b)) return mergeById(b, mine, theirs);
    if ([mine, theirs, b].every(a => a.every(x => typeof x === 'string'))) {
      const removed = b.filter(x => !mine.includes(x) || !theirs.includes(x));
      return [...theirs.filter(x => !removed.includes(x)), ...mine.filter(x => !theirs.includes(x) && !b.includes(x))];
    }
    if ([mine, theirs, b].every(a => a.every(x => x === null || typeof x !== 'object'))) {
      const out = Array.from({ length: Math.max(mine.length, theirs.length) }, (_, i) => merge3(b[i], mine[i], theirs[i]));
      while (out.length && out[out.length - 1] === undefined) out.pop();
      return out.map(x => (x === undefined ? 0 : x));
    }
  }
  return mine;
}
function mergeById(base, mine, theirs) {
  const key = x => String(x.id);
  const bm = new Map(base.map(x => [key(x), x])), mm = new Map(mine.map(x => [key(x), x])), tm = new Map(theirs.map(x => [key(x), x]));
  const out = [], clash = [];
  [...theirs.map(key), ...mine.map(key).filter(k => !tm.has(k))].forEach(k => {
    const b = bm.get(k), m = mm.get(k), t = tm.get(k);
    if (!b && m && t && !sameVal(m, t)) { out.push(t); clash.push(m); return; }
    const v = merge3(b, m, t);
    if (v !== undefined) out.push(v);
  });
  let top = Math.max(0, ...out.map(x => +x.id).filter(Number.isFinite));
  clash.forEach(m => out.push({ ...m, id: typeof m.id === 'number' ? ++top : `${m.id}-${Math.random().toString(36).slice(2, 6)}` }));
  return out;
}
// Counters only go up; after a merge they stay above every id in use.
function mergePart(k, base, mine, theirs) {
  if ((k === 'nextId' || k === 'nextScorerId') && typeof mine === 'number' && typeof theirs === 'number') return Math.max(mine, theirs);
  return merge3(base, mine, theirs);
}
function fixCounters(s) {
  const top = list => Math.max(0, ...(list || []).map(x => +x.id).filter(Number.isFinite));
  if (Array.isArray(s.matches) && typeof s.nextId === 'number') s.nextId = Math.max(s.nextId, top(s.matches) + 1);
  if (Array.isArray(s.scorers) && typeof s.nextScorerId === 'number') s.nextScorerId = Math.max(s.nextScorerId, top(s.scorers) + 1);
}
const parseJ = j => (j === undefined || j === null ? undefined : JSON.parse(j));
const strJ = v => (v === undefined ? undefined : JSON.stringify(v));
// Merge one part: base = how it was online when this browser last saw it, mine = here, theirs = online now.
function mergeJSON(k, baseJ, mineJ, theirsJ) {
  if (mineJ === theirsJ || mineJ === baseJ) return theirsJ;
  if (theirsJ === baseJ) return mineJ;
  return strJ(mergePart(k, parseJ(baseJ), parseJ(mineJ), parseJ(theirsJ)));
}
// Edits not online yet are remembered with the online copy they started from, so a refresh (or closing
// the page) before they're sent doesn't lose them: they're merged in when the page opens again.
const readPending = key => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } };
const writePending = (key, p) => { try { Object.keys(p).length ? localStorage.setItem(key, JSON.stringify(p)) : localStorage.removeItem(key); } catch (e) {} };
function notePending(key, parts, synced) {
  const p = readPending(key);
  let n = 0;
  new Set([...Object.keys(parts), ...Object.keys(synced)]).forEach(k => {
    if (parts[k] !== synced[k] && !(k in p)) { p[k] = synced[k] === undefined ? null : synced[k]; n++; }
  });
  if (n) writePending(key, p);
}
function clearPending(key, parts, synced) {
  const p = readPending(key);
  Object.keys(p).forEach(k => { if (parts[k] === synced[k]) delete p[k]; });
  writePending(key, p);
}
const PENDING = 'asl-pending', PENDING_PRIVATE = 'asl-pending-private';
// Merge what came from online into this browser's copy. Returns the merged parts and whether this
// browser still has changes to send.
function mergeIncoming(parts, synced, local, first, pendKey) {
  const pend = first ? readPending(pendKey) : {};
  const out = {};
  let mine = false;
  new Set([...Object.keys(parts), ...Object.keys(synced), ...Object.keys(pend)]).forEach(k => {
    // the first time online data arrives, it's used as it is, except for edits made here that never got
    // sent (kept in pending with the copy they started from)
    const v = first && !(k in pend) ? parts[k] : mergeJSON(k, first ? pend[k] ?? undefined : synced[k], local[k], parts[k]);
    if (v !== undefined) out[k] = v;
    if (v !== parts[k]) mine = true;
  });
  return { out, mine };
}
// Read and write one part inside a transaction (big parts are split over several documents).
async function readPart(tx, col, k) {
  const d = await tx.get(col.doc(k));
  if (!d.exists) return undefined;
  const v = d.data() || {};
  if (!v.parts) return v.json;
  let j = '';
  for (let i = 0; i < v.parts; i++) { const c = await tx.get(col.doc(`${k}~${i}`)); j += ((c.exists && c.data()) || {}).json || ''; }
  return j;
}
function writePart(tx, col, k, json) {
  if (json === undefined) { tx.delete(col.doc(k)); return; }
  if (json.length > CHUNK) {
    const pieces = Math.ceil(json.length / CHUNK);
    for (let i = 0; i < pieces; i++) tx.set(col.doc(`${k}~${i}`), { json: json.slice(i * CHUNK, (i + 1) * CHUNK) });
    tx.set(col.doc(k), { parts: pieces });
  } else tx.set(col.doc(k), { json });
}
// Send this browser's changes: each changed part is read online, merged with what's there, and written,
// all in one go (if someone else saves in between, it starts over with their version).
async function pushMerged(colName, keys, parts, synced) {
  const col = CLOUD.db.collection(colName);
  // a list's id counter goes along, so it stays above every id after the merge
  const counters = colName === 'league' ? [['scorers', 'nextScorerId'], ['matches', 'nextId']].filter(([l]) => keys.includes(l)) : [];
  const reads = [...new Set([...keys, ...counters.map(c => c[1])])];
  return CLOUD.db.runTransaction(async tx => {
    const now = {};
    for (const k of reads) now[k] = await readPart(tx, col, k);
    const out = {};
    keys.forEach(k => { out[k] = mergeJSON(k, synced[k], parts[k], now[k]); });
    counters.forEach(([l, c]) => {
      const list = parseJ(out[l]) || [], cur = parseJ(c in out ? out[c] : now[c] ?? parts[c]);
      if (typeof cur !== 'number') return;
      const need = Math.max(cur, ...list.map(x => +x.id + 1).filter(Number.isFinite));
      if (need !== cur || !(c in out)) out[c] = String(need);
    });
    Object.keys(out).forEach(k => { if (out[k] !== now[k]) writePart(tx, col, k, out[k]); });
    return out;
  });
}
// Put merged parts that differ from this browser's copy into the data here (and redraw when no one is typing).
function takeMerged(out, parts) {
  let changed = false;
  Object.entries(out).forEach(([k, j]) => {
    if (j === parts[k]) return;
    changed = true;
    if (j === undefined) { delete state[k]; if (lastSaved) delete lastSaved[k]; }
    else { state[k] = JSON.parse(j); if (lastSaved) lastSaved[k] = JSON.parse(j); }
  });
  if (!changed) return;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  const draw = () => (typing() ? setTimeout(draw, 1200) : render());
  draw();
}

// Parts only signed-in admins can read (Proof of Age): saved in the "private" collection, never with the
// public league data. PRIVATE_PARTS is in app.js.
const cloudParts = () => Object.fromEntries(Object.entries(state)
  .filter(([k, v]) => !LOCAL_ONLY.has(k) && !PRIVATE_PARTS.has(k) && v !== undefined).map(([k, v]) => [k, JSON.stringify(v)]));
const privateParts = () => Object.fromEntries([...PRIVATE_PARTS].filter(k => state[k] !== undefined).map(k => [k, JSON.stringify(state[k])]));
CLOUD.privSynced = {};
function listenPrivate() {
  if (CLOUD.privUnsub) return;
  CLOUD.privUnsub = CLOUD.db.collection('private').onSnapshot(snap => {
    if (snap.metadata.hasPendingWrites) return;
    const parts = {};
    snap.forEach(d => { parts[d.id] = (d.data() || {}).json; });
    // merged with changes made here that aren't online yet (another admin's save doesn't wipe them)
    const first = !CLOUD.privReady;
    const { out, mine } = mergeIncoming(parts, CLOUD.privSynced, privateParts(), first, PENDING_PRIVATE);
    CLOUD.privSynced = { ...parts };
    CLOUD.privReady = true;
    let changed = false;
    PRIVATE_PARTS.forEach(k => {
      const v = out[k] ? JSON.parse(out[k]) : undefined;
      if (JSON.stringify(state[k]) === JSON.stringify(v)) return;
      if (v === undefined) delete state[k]; else state[k] = v;
      if (lastSaved) { if (v === undefined) delete lastSaved[k]; else lastSaved[k] = JSON.parse(out[k]); }
      changed = true;
    });
    if (changed) { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} render(); }
    if (mine) setTimeout(() => pushPrivate(), 400);
  }, err => { console.warn('Could not read the admin-only data', err); });
}
function stopPrivate() {
  if (CLOUD.privUnsub) { CLOUD.privUnsub(); CLOUD.privUnsub = null; }
  CLOUD.privReady = false; CLOUD.privSynced = {};
  writePending(PENDING_PRIVATE, {});
  // signed out: the admin-only data doesn't stay in this browser
  PRIVATE_PARTS.forEach(k => { delete state[k]; if (lastSaved) delete lastSaved[k]; });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
async function pushPrivate() {
  if (!CLOUD.user || !CLOUD.privReady) return;
  if (CLOUD.privPushing) { CLOUD.privAgain = true; return; }
  const parts = privateParts(), synced = { ...CLOUD.privSynced };
  const keys = [...new Set([...Object.keys(parts), ...Object.keys(synced)])].filter(k => parts[k] !== synced[k]);
  if (!keys.length) return;
  CLOUD.privPushing = true;
  try {
    const out = await pushMerged('private', keys, parts, synced);
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete CLOUD.privSynced[k]; else CLOUD.privSynced[k] = out[k]; });
    takeMerged(out, parts);
    clearPending(PENDING_PRIVATE, privateParts(), CLOUD.privSynced);
  } catch (e) {
    console.warn('Could not save the admin-only data', e);
    toast(t('privateSaveFailed'));
  } finally {
    CLOUD.privPushing = false;
    if (CLOUD.privAgain) { CLOUD.privAgain = false; setTimeout(() => pushPrivate(), 50); }
  }
}

// Put the online data in place of this browser's copy.
function applyCloud(parts) {
  // what came in is merged with changes made here that aren't online yet (see merge3)
  const first = !CLOUD.seen;
  CLOUD.seen = true;
  const { out, mine } = mergeIncoming(parts, CLOUD.synced, cloudParts(), first, PENDING);
  const next = { ...state };
  Object.keys(next).forEach(k => { if (!LOCAL_ONLY.has(k) && !PRIVATE_PARTS.has(k) && !(k in out) && (k in CLOUD.synced || k in parts)) delete next[k]; });
  Object.entries(out).forEach(([k, json]) => { next[k] = JSON.parse(json); });
  if (mine) fixCounters(next);
  next.admins = state.admins;
  CLOUD.synced = { ...parts };
  if (mine && CLOUD.user) setTimeout(() => cloudPush(), 400);
  state = addSeasons(next);
  // a one-time upgrade of the data (see runUpgrades) is saved online by the first admin signed in
  if (runUpgrades() && CLOUD.user) setTimeout(() => save(), 1500);
  CLOUD.upgraded = CLOUD.upgraded || state.scorerCols === 'league' && !('scorerCols' in parts);
  for (let i = DIVISIONS.length - 1; i >= 0; i--) if (DIVISIONS[i].custom) DIVISIONS.splice(i, 1);
  (state.leagues || []).forEach(addDivision);
  applyFieldChanges();
  lastSaved = JSON.parse(JSON.stringify(state));
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  render();
}

// While an admin is typing in a box, an update from someone else waits until they leave it.
const typing = () => ui.admin && document.activeElement && document.activeElement.matches('#app input, #app textarea');
function applyWhenFree(parts) {
  CLOUD.waiting = parts;
  if (typing()) return setTimeout(() => CLOUD.waiting === parts && applyWhenFree(parts), 1200);
  CLOUD.waiting = null;
  applyCloud(parts);
}

function listen() {
  CLOUD.db.collection('league').onSnapshot({ includeMetadataChanges: false }, snap => {
    if (snap.metadata.hasPendingWrites) return; // our own save on its way
    const docs = {};
    snap.forEach(d => { docs[d.id] = d.data(); });
    const parts = {};
    try {
      Object.entries(docs).forEach(([id, d]) => {
        if (id.includes('~')) return;
        parts[id] = d.parts ? Array.from({ length: d.parts }, (_, i) => (docs[`${id}~${i}`] || {}).json || '').join('') : d.json;
        JSON.parse(parts[id]);
      });
    } catch (e) { return; } // a big part only half there yet; the next update brings the rest
    const first = !CLOUD.ready;
    CLOUD.ready = true;
    if (!snap.size) {
      // Nothing online yet: the first admin to sign in sends this browser's data up.
      CLOUD.empty = !snap.metadata.fromCache;
      if (CLOUD.empty && CLOUD.user) pushAll();
      return first && render();
    }
    CLOUD.empty = false;
    const same = Object.keys(parts).length === Object.keys(CLOUD.synced).length
      && Object.entries(parts).every(([k, v]) => CLOUD.synced[k] === v);
    if (!same) applyWhenFree(parts);
    else if (first) render();
  }, err => {
    console.warn('Could not read the league data online', err);
    if (ui.admin) toast(t('cloudReadFailed'));
  });
}

// Send what changed (or everything, the first time).
async function cloudPush(all = false) {
  if (!CLOUD.on || !CLOUD.user || !CLOUD.ready) return;
  if (CLOUD.pushing) { CLOUD.again = true; return; }
  const parts = cloudParts(), synced = { ...CLOUD.synced };
  const keys = [...new Set([...Object.keys(parts), ...Object.keys(synced)])].filter(k => all || parts[k] !== synced[k]);
  if (!keys.length) return;
  CLOUD.pushing = true;
  try {
    // merged with whatever is online right now, so another admin's save in the meantime isn't lost
    const out = await pushMerged('league', keys, parts, all ? {} : synced);
    Object.keys(out).forEach(k => { if (out[k] === undefined) delete CLOUD.synced[k]; else CLOUD.synced[k] = out[k]; });
    takeMerged(out, parts);
    clearPending(PENDING, cloudParts(), CLOUD.synced);
    if (CLOUD.failed) { CLOUD.failed = false; toast(t('cloudSavedAgain')); }
  } catch (e) {
    console.warn('Could not save online', e);
    if (!CLOUD.failed) toast(t('cloudSaveFailed'));
    CLOUD.failed = true;
    clearTimeout(CLOUD.retry);
    CLOUD.retry = setTimeout(() => cloudPush(), 8000);
  } finally {
    CLOUD.pushing = false;
    if (CLOUD.again) { CLOUD.again = false; setTimeout(() => cloudPush(), 50); }
  }
}
// The very first upload only comes from a browser that has been used as admin (it has History), so a new
// browser with just the built-in starting data can't fill the online copy instead of the real one.
function pushAll() {
  if (!(state.log || []).length) return;
  CLOUD.empty = false;
  return cloudPush(true);
}

// Every save here also goes online (a moment later, so quick edits go together).
const saveHere = save;
save = function () {
  saveHere();
  if (!CLOUD.on || !CLOUD.user || !CLOUD.ready) return;
  notePending(PENDING, cloudParts(), CLOUD.synced);
  if (CLOUD.privReady) notePending(PENDING_PRIVATE, privateParts(), CLOUD.privSynced);
  clearTimeout(CLOUD.timer);
  CLOUD.timer = setTimeout(() => { cloudPush(); pushPrivate(); }, 400);
};
window.addEventListener('beforeunload', e => {
  if (CLOUD.timer && CLOUD.user) { clearTimeout(CLOUD.timer); cloudPush(); pushPrivate(); }
});

// Admin sign-in with Firebase.
signIn = async function (form) {
  const warn = form.querySelector('.warn');
  const btn = form.querySelector('[type=submit]');
  if (!CLOUD.on) { warn.textContent = t('cloudOffline'); warn.hidden = false; return; }
  btn.disabled = true;
  try {
    await CLOUD.auth.signInWithEmailAndPassword(form.email.value.trim(), form.password.value);
  } catch (e) {
    warn.textContent = t(e.code === 'auth/too-many-requests' ? 'tooManyTries' : e.code === 'auth/network-request-failed' ? 'cloudOffline' : 'wrongLogin');
    warn.hidden = false;
  }
  btn.disabled = false;
};
function cloudSignOut() { if (CLOUD.on) CLOUD.auth.signOut(); }

if (CLOUD.on) {
  listen();
  CLOUD.auth.onAuthStateChanged(u => {
    CLOUD.user = u;
    ui.admin = !!u;
    writeFlag('asl-admin', !!u);
    writeWho(u ? u.email : '');
    if (u && CLOUD.empty) pushAll();
    if (u) listenPrivate(); else stopPrivate();
    // History shows names, not emails: tidy older lines once the online data is in.
    if (u) { const tidy = () => (CLOUD.ready ? (scrubLogEmails() || CLOUD.upgraded) && save() : setTimeout(tidy, 800)); setTimeout(tidy, 800); }
    render();
  });
}
