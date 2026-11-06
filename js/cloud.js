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
    CLOUD.privSynced = { ...parts };
    CLOUD.privReady = true;
    let changed = false;
    PRIVATE_PARTS.forEach(k => {
      const v = parts[k] ? JSON.parse(parts[k]) : undefined;
      if (JSON.stringify(state[k]) === JSON.stringify(v)) return;
      if (v === undefined) delete state[k]; else state[k] = v;
      if (lastSaved) { if (v === undefined) delete lastSaved[k]; else lastSaved[k] = JSON.parse(parts[k]); }
      changed = true;
    });
    if (changed) { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} render(); }
  }, err => { console.warn('Could not read the admin-only data', err); });
}
function stopPrivate() {
  if (CLOUD.privUnsub) { CLOUD.privUnsub(); CLOUD.privUnsub = null; }
  CLOUD.privReady = false; CLOUD.privSynced = {};
  // signed out: the admin-only data doesn't stay in this browser
  PRIVATE_PARTS.forEach(k => { delete state[k]; if (lastSaved) delete lastSaved[k]; });
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}
async function pushPrivate() {
  if (!CLOUD.user || !CLOUD.privReady) return;
  const parts = privateParts(), col = CLOUD.db.collection('private'), batch = CLOUD.db.batch();
  let n = 0;
  Object.entries(parts).forEach(([k, json]) => { if (CLOUD.privSynced[k] !== json) { batch.set(col.doc(k), { json }); n++; } });
  Object.keys(CLOUD.privSynced).forEach(k => { if (!(k in parts)) { batch.delete(col.doc(k)); n++; } });
  if (!n) return;
  const before = { ...CLOUD.privSynced };
  CLOUD.privSynced = { ...parts };
  try { await batch.commit(); } catch (e) {
    console.warn('Could not save the admin-only data', e);
    CLOUD.privSynced = before;
    toast(t('privateSaveFailed'));
  }
}

// Put the online data in place of this browser's copy.
function applyCloud(parts) {
  const next = { ...state };
  Object.keys(CLOUD.synced).forEach(k => { if (!(k in parts)) delete next[k]; });
  Object.entries(parts).forEach(([k, json]) => { next[k] = JSON.parse(json); });
  next.admins = state.admins;
  CLOUD.synced = { ...parts };
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
  const parts = cloudParts();
  const batch = CLOUD.db.batch();
  const col = CLOUD.db.collection('league');
  let n = 0;
  const before = { ...CLOUD.synced };
  Object.entries(parts).forEach(([k, json]) => {
    if (!all && before[k] === json) return;
    if (json.length > CHUNK) {
      const pieces = Math.ceil(json.length / CHUNK);
      for (let i = 0; i < pieces; i++) batch.set(col.doc(`${k}~${i}`), { json: json.slice(i * CHUNK, (i + 1) * CHUNK) });
      batch.set(col.doc(k), { parts: pieces });
      n += pieces + 1;
    } else { batch.set(col.doc(k), { json }); n++; }
  });
  Object.keys(before).forEach(k => { if (!(k in parts)) { batch.delete(col.doc(k)); n++; } });
  if (!n) return;
  CLOUD.synced = { ...parts };
  try {
    await batch.commit();
    if (CLOUD.failed) { CLOUD.failed = false; toast(t('cloudSavedAgain')); }
  } catch (e) {
    console.warn('Could not save online', e);
    CLOUD.synced = before; // try these again next time
    if (!CLOUD.failed) toast(t('cloudSaveFailed'));
    CLOUD.failed = true;
    clearTimeout(CLOUD.retry);
    CLOUD.retry = setTimeout(() => cloudPush(), 8000);
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
