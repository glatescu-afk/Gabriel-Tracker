'use strict';

/* ============================================================
 * Gabriel Tracker : suivi des calories
 * Sources : CIQUAL/CALNUT (ANSES, locale), Open Food Facts, USDA FDC
 * Toutes les données utilisateur restent dans le localStorage.
 * ============================================================ */

const MEALS = [
  { id: 'breakfast', label: 'Petit-déjeuner' },
  { id: 'lunch', label: 'Déjeuner' },
  { id: 'snack', label: 'Collation' },
  { id: 'dinner', label: 'Dîner' },
];

// Conversion cru → cuit pour les féculents CIQUAL (identifiant de l'aliment cuit).
// rawKcal = valeur énergétique typique du produit sec/cru (pour 100 g, d'après les
// étiquettes et la table CIQUAL). La cuisson à l'eau n'ajoute pas de calories : le
// rapport rawKcal / kcal cuit donne donc le facteur de gonflement à l'eau.
const RAW_EQUIV = {
  9811: { rawKcal: 357, label: 'pâtes sèches crues' },
  9871: { rawKcal: 345, label: 'pâtes complètes crues' },
  9822: { rawKcal: 370, label: 'pâtes aux œufs sèches crues' },
  9824: { rawKcal: 357, label: 'pâtes sans gluten crues' },
  9816: { rawKcal: 280, label: 'pâtes fraîches aux œufs crues' },
  9086: { rawKcal: 360, label: 'nouilles de blé sèches' },
  9104: { rawKcal: 354, label: 'riz blanc cru' },
  9120: { rawKcal: 354, label: 'riz basmati / thaï cru' },
  9103: { rawKcal: 350, label: 'riz complet cru' },
  9111: { rawKcal: 357, label: 'riz sauvage cru' },
  9341: { rawKcal: 354, label: 'quinoa cru' },
  9683: { rawKcal: 360, label: 'semoule de couscous sèche' },
  9691: { rawKcal: 350, label: 'boulgour sec' },
  9081: { rawKcal: 345, label: 'blé précuit sec (type Ebly)' },
  9615: { rawKcal: 360, label: 'polenta sèche' },
  9901: { rawKcal: 363, label: 'vermicelles de riz secs' },
  20505: { rawKcal: 330, label: 'lentilles sèches' },
  20502: { rawKcal: 300, label: 'haricots blancs secs' },
  20503: { rawKcal: 310, label: 'haricots rouges secs' },
  20513: { rawKcal: 300, label: 'flageolets secs' },
  20531: { rawKcal: 330, label: 'haricots mungo secs' },
  20700: { rawKcal: 320, label: 'légumes secs crus' },
};

// Synonymes pour la recherche CIQUAL (formes de pâtes, etc.).
const SYNONYMS = {
  spaghetti: ['pates'], spaghettis: ['pates'], tagliatelle: ['pates'], tagliatelles: ['pates'],
  penne: ['pates'], pennes: ['pates'], coquillettes: ['pates'], coquillette: ['pates'],
  macaroni: ['pates'], macaronis: ['pates'], fusilli: ['pates'], farfalle: ['pates'],
  linguine: ['pates'], nouilles: ['pates', 'nouilles'], pasta: ['pates'], pate: ['pates'],
  basmati: ['basmati'], couscous: ['couscous'], semoule: ['semoule', 'couscous'],
  patate: ['pomme', 'terre'], patates: ['pomme', 'terre'], pdt: ['pomme', 'terre'],
  oeuf: ['oeuf'], yaourt: ['yaourt', 'lait', 'fermente'], yogourt: ['yaourt'],
  steak: ['boeuf', 'steak'], frites: ['frites'], poulet: ['poulet'],
};

const QUICK = ['Pâtes cuites', 'Riz cuit', 'Pomme de terre', 'Lentilles', 'Pain baguette', 'Œuf', 'Poulet', 'Banane', 'Yaourt', 'Huile olive'];

const SRC_LABEL = { ciqual: 'CIQUAL (ANSES)', off: 'Open Food Facts', usda: 'USDA FoodData Central', mine: 'Mon aliment' };

/* ---------- utilitaires ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (x, d = 0) => { const k = 10 ** d; return Math.round((x || 0) * k) / k; };
const fmt = (x, d = 0) => round(x, d).toLocaleString('fr-FR', { maximumFractionDigits: d });
const norm = (s) => String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function isoDate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ---------- stockage ---------- */
const KEY = 'gabriel-tracker-v1';
const DEFAULT_STATE = {
  settings: { goal: 2000, pPct: 25, cPct: 50, fPct: 25, usdaKey: '', profile: { sex: 'm', age: 30, height: 175, weight: 75, activity: '1.375', target: '0' } },
  log: {},
  custom: [],
  recents: [],
  favs: {},
  weights: {},
  meta: { stamps: {} },
};
// Version autonome (page claude.ai) : la base CIQUAL est intégrée au fichier et les API externes sont bloquées.
const EMBEDDED = !!document.getElementById('ciqual-data');
let state = load();

function normalize(s) {
  if (!s) return structuredClone(DEFAULT_STATE);
  return {
    ...structuredClone(DEFAULT_STATE), ...s,
    settings: { ...DEFAULT_STATE.settings, ...s.settings, profile: { ...DEFAULT_STATE.settings.profile, ...(s.settings || {}).profile } },
    meta: { stamps: {}, ...s.meta },
  };
}
function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* stockage indisponible : la synchro prend le relais */ }
}
function save() {
  markChanges();
  saveLocal();
  schedulePush();
}

/* ---------- synchronisation avec le compte claude.ai (capacité db) ----------
 * Le journal est découpé en un document « profile » (réglages, aliments perso,
 * favoris, poids) et un document par mois. Chaque partie porte l'horodatage de
 * sa dernière modification : la version la plus récente l'emporte. */
const sync = { db: null, uid: null, last: {}, pending: 2, timer: null, pushing: false };
let localJSON = parts();

function parts(s = state) {
  const out = { profile: JSON.stringify({ settings: s.settings, custom: s.custom, recents: s.recents, favs: s.favs, weights: s.weights }) };
  for (const [d, list] of Object.entries(s.log)) {
    if (!list.length) continue;
    const k = 'm' + d.slice(0, 7);
    (out[k] = out[k] || {})[d] = list;
  }
  for (const k of Object.keys(out)) if (k !== 'profile') out[k] = JSON.stringify(out[k]);
  for (const k of Object.keys(s.meta.stamps)) if (!(k in out)) out[k] = '{}';
  return out;
}
function markChanges() {
  const now = parts();
  for (const k of new Set([...Object.keys(now), ...Object.keys(localJSON)])) {
    if (now[k] !== localJSON[k]) state.meta.stamps[k] = Date.now();
  }
  localJSON = parts();
}
function partRef(k) {
  const profile = sync.db.doc(`data/users/${sync.uid}/profile`);
  return k === 'profile' ? profile : profile.collection('months').doc(k.slice(1));
}
function applyRemote(k, snap) {
  if (!snap.exists) return;
  const doc = snap.data();
  if (typeof doc.json !== 'string') return;
  sync.last[k] = doc.json;
  if (doc.updatedAt <= (state.meta.stamps[k] || 0) || doc.json === localJSON[k]) return;
  const body = JSON.parse(doc.json);
  if (k === 'profile') {
    Object.assign(state, normalize({ ...state, ...body }));
  } else {
    const month = k.slice(1);
    for (const d of Object.keys(state.log)) if (d.startsWith(month)) delete state.log[d];
    Object.assign(state.log, body);
  }
  state.meta.stamps[k] = doc.updatedAt;
  localJSON = parts();
  saveLocal();
  fillSettings();
  renderJournal();
  if ($('#view-history').classList.contains('active')) renderHistory();
}
function schedulePush() {
  if (!sync.db || sync.pending) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(push, 1200);
}
async function push() {
  if (sync.pushing) return schedulePush();
  sync.pushing = true;
  try {
    for (const [k, json] of Object.entries(localJSON)) {
      if (json === sync.last[k] || !state.meta.stamps[k]) continue;
      await partRef(k).set({ updatedAt: state.meta.stamps[k], json });
      sync.last[k] = json;
    }
    setSyncStatus('Synchronisé avec ton compte claude.ai');
  } catch (err) {
    setSyncStatus(err.code === 'quota_exceeded' ? 'Espace de synchronisation plein : exporte puis efface les vieux mois.' : 'Synchronisation en attente (réessai automatique).');
    if (err.code === 'unavailable') schedulePush();
  } finally {
    sync.pushing = false;
  }
}
function setSyncStatus(t) {
  const el = $('#sync-status');
  if (el) { el.textContent = t; el.hidden = false; }
}
async function startSync() {
  if (!window.claude || !window.claude.use) return;
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  const id = user && (await user.id());
  if (!db || !id) return setSyncStatus('Connecte-toi à claude.ai pour synchroniser ton journal entre tes appareils.');
  Object.assign(sync, { db, uid: id });
  setSyncStatus('Synchronisation…');
  const ready = () => { if (sync.pending && --sync.pending === 0) push(); };
  partRef('profile').onSnapshot((snap) => { applyRemote('profile', snap); ready(); }, () => ready());
  partRef('profile').collection('months').onSnapshot((qs) => {
    qs.docs.forEach((d) => applyRemote('m' + d.id, d));
    ready();
  }, () => ready());
}

/* ---------- nutrition ---------- */
const NUTRI_KEYS = ['kcal', 'p', 'c', 's', 'f', 'sf', 'fi', 'na'];
function scale(per100, grams) {
  const o = {};
  for (const k of NUTRI_KEYS) o[k] = per100[k] == null ? null : (per100[k] * grams) / 100;
  return o;
}
function sumEntries(entries) {
  const t = { kcal: 0, p: 0, c: 0, s: 0, f: 0, sf: 0, fi: 0, na: 0 };
  for (const e of entries) {
    const n = scale(e.per100, e.grams);
    for (const k of NUTRI_KEYS) t[k] += n[k] || 0;
  }
  return t;
}
function macroGoals() {
  const s = state.settings;
  return { p: (s.goal * s.pPct) / 100 / 4, c: (s.goal * s.cPct) / 100 / 4, f: (s.goal * s.fPct) / 100 / 9 };
}

/* ---------- base CIQUAL ---------- */
let ciqual = [];
const ciqualReady = (EMBEDDED ? Promise.resolve(JSON.parse($('#ciqual-data').textContent)) : fetch('data/ciqual.json').then((r) => r.json()))
  .then((d) => {
    ciqual = d.foods.map((f) => ({ ...f, words: norm(f.n).split(' ').map(stem) }));
  })
  .catch(() => toast('Base CIQUAL indisponible'));

function ciqualToFood(f) {
  return {
    key: 'ciqual:' + f.id, src: 'ciqual', ref: f.id, name: f.n, sub: f.g,
    per100: { kcal: f.kcal, p: f.p, c: f.c, s: f.s, f: f.f, sf: f.sf, fi: f.fi, na: f.na },
    raw: RAW_EQUIV[f.id] ? { ...RAW_EQUIV[f.id], factor: RAW_EQUIV[f.id].rawKcal / f.kcal } : null,
  };
}

function searchCiqual(q, limit = 60) {
  const tokens = norm(q).split(' ').filter(Boolean).map(stem);
  if (!tokens.length) return [];
  const groups = tokens.map((t) => [t, ...(SYNONYMS[t] || []).map(stem)]);
  const out = [];
  for (const f of ciqual) {
    let score = 0;
    let ok = true;
    for (const alts of groups) {
      let best = 0;
      for (const [i, w] of f.words.entries()) {
        for (const a of alts) {
          if (w === a) best = Math.max(best, i === 0 ? 6 : 4);
          else if (w.startsWith(a)) best = Math.max(best, i === 0 ? 4 : 2);
        }
      }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    // favorise les aliments simples (noms courts) et les féculents cuits
    score -= f.words.length * 0.15;
    if (/\bcuit/.test(norm(f.n))) score += 0.5;
    if (RAW_EQUIV[f.id]) score += 1.5;
    out.push([score, f]);
  }
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, limit).map(([, f]) => ciqualToFood(f));
}

/* ---------- Open Food Facts ---------- */
const OFF_FIELDS = 'code,product_name,product_name_fr,generic_name_fr,brands,nutriments,serving_quantity,serving_size,image_front_small_url,quantity';
function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
  if (kcal == null) return null;
  const name = p.product_name_fr || p.product_name || p.generic_name_fr;
  if (!name) return null;
  const sq = parseFloat(p.serving_quantity);
  return {
    key: 'off:' + p.code, src: 'off', ref: p.code, name,
    sub: [p.brands, p.quantity].filter(Boolean).join(' · '),
    img: p.image_front_small_url,
    per100: {
      kcal: +kcal, p: n.proteins_100g ?? null, c: n.carbohydrates_100g ?? null, s: n.sugars_100g ?? null,
      f: n.fat_100g ?? null, sf: n['saturated-fat_100g'] ?? null, fi: n.fiber_100g ?? null, na: n.salt_100g ?? null,
    },
    serving: sq > 0 ? { g: sq, label: p.serving_size || sq + ' g' } : null,
  };
}
async function searchOFF(q, signal) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&lc=fr&fields=${OFF_FIELDS}`;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('OFF ' + r.status);
  const d = await r.json();
  return (d.products || []).map(offToFood).filter(Boolean);
}
async function fetchBarcode(code) {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?lc=fr&fields=${OFF_FIELDS}`);
  if (!r.ok) return null;
  const d = await r.json();
  return d.status === 1 ? offToFood({ ...d.product, code }) : null;
}

/* ---------- USDA FoodData Central ---------- */
function usdaToFood(f) {
  const get = (...ids) => {
    for (const id of ids) {
      const n = f.foodNutrients.find((x) => x.nutrientId === id);
      if (n && n.value != null) return n.value;
    }
    return null;
  };
  let kcal = get(1008, 2047, 2048);
  if (kcal == null) {
    const kj = get(1062);
    if (kj != null) kcal = kj / 4.184;
  }
  if (kcal == null) return null;
  const sodium = get(1093);
  return {
    key: 'usda:' + f.fdcId, src: 'usda', ref: f.fdcId, name: f.description,
    sub: [f.dataType, f.brandOwner].filter(Boolean).join(' · '),
    per100: { kcal, p: get(1003), c: get(1005), s: get(2000, 1063), f: get(1004), sf: get(1258), fi: get(1079), na: sodium == null ? null : (sodium * 2.5) / 1000 },
  };
}
async function searchUSDA(q, signal) {
  const key = state.settings.usdaKey || 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=30&dataType=${encodeURIComponent('Foundation,SR Legacy,Survey (FNDDS)')}`;
  const r = await fetch(url, { signal });
  if (r.status === 429) throw new Error('Limite USDA atteinte : ajoute ta clé gratuite dans Réglages');
  if (!r.ok) throw new Error('USDA ' + r.status);
  const d = await r.json();
  return (d.foods || []).map(usdaToFood).filter(Boolean);
}

/* ---------- aliments perso ---------- */
function customToFood(c) {
  return {
    key: 'mine:' + c.id, src: 'mine', ref: c.id, name: c.n, sub: 'Aliment personnel',
    per100: { kcal: c.kcal, p: c.p, c: c.c, s: c.s, f: c.f, sf: null, fi: c.fi, na: null },
    serving: c.serving ? { g: c.serving, label: c.serving + ' g' } : null,
  };
}

/* ============================================================
 * JOURNAL
 * ============================================================ */
let currentDate = isoDate(new Date());

function dayEntries(date = currentDate) {
  return state.log[date] || [];
}

function renderDate() {
  const today = isoDate(new Date());
  const d = new Date(currentDate + 'T12:00:00');
  let label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (currentDate === today) label = "Aujourd'hui";
  else if (currentDate === addDays(today, -1)) label = 'Hier';
  else if (currentDate === addDays(today, 1)) label = 'Demain';
  $('#date-label').textContent = label.charAt(0).toUpperCase() + label.slice(1);
  $('#date-input').value = currentDate;
}

function renderJournal() {
  renderDate();
  const entries = dayEntries();
  const tot = sumEntries(entries);
  const goal = state.settings.goal;
  const left = goal - tot.kcal;
  $('#kcal-goal').textContent = fmt(goal);
  $('#kcal-eaten').textContent = fmt(tot.kcal);
  $('#kcal-left').textContent = fmt(Math.abs(left));
  $('#kcal-left-label').textContent = left >= 0 ? 'kcal restantes' : 'kcal en trop';
  const C = 2 * Math.PI * 52;
  const ring = $('#ring-fg');
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - Math.min(tot.kcal / goal, 1));
  ring.classList.toggle('over', left < 0);

  const mg = macroGoals();
  $('#macro-bars').innerHTML = [['p', 'Protéines', 'var(--p)'], ['c', 'Glucides', 'var(--c)'], ['f', 'Lipides', 'var(--f)']]
    .map(([k, l, col]) => `<div class="macro"><div class="lbl"><span>${l}</span><span>${fmt(tot[k])} / ${fmt(mg[k])} g</span></div>
      <div class="bar"><i style="width:${Math.min(100, (tot[k] / mg[k]) * 100)}%;background:${col}"></i></div></div>`).join('');

  $('#meals').innerHTML = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.id);
    const kc = sumEntries(list).kcal;
    return `<div class="card">
      <div class="meal-head"><h2>${m.label}</h2><span class="kc">${list.length ? fmt(kc) + ' kcal' : ''}</span></div>
      <ul class="entries">${list.map((e) => `<li class="entry" data-uid="${e.uid}">
        <div><div class="nm">${esc(e.name)}</div><div class="sub">${e.raw ? fmt(e.raw.grams) + ' g cru (≈ ' + fmt(e.grams) + ' g cuit)' : fmt(e.grams) + ' ' + (e.unit || 'g')} · ${SRC_LABEL[e.src] || ''}</div></div>
        <div class="kc">${fmt((e.per100.kcal * e.grams) / 100)}</div></li>`).join('')}</ul>
      <button class="add-line" data-meal="${m.id}">＋ Ajouter</button>
    </div>`;
  }).join('');
}

$('#meals').addEventListener('click', (ev) => {
  const add = ev.target.closest('.add-line');
  if (add) return openSearch(add.dataset.meal);
  const li = ev.target.closest('.entry');
  if (li) {
    const e = dayEntries().find((x) => x.uid === li.dataset.uid);
    if (e) openPortion(entryToFood(e), e);
  }
});

function entryToFood(e) {
  return { key: e.key, src: e.src, ref: e.ref, name: e.name, sub: e.sub, per100: e.per100, raw: e.rawInfo || null, serving: e.serving || null };
}

function defaultMeal() {
  const h = new Date().getHours();
  if (h < 11) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

/* ============================================================
 * RECHERCHE
 * ============================================================ */
let activeSrc = 'ciqual';
let searchAbort = null;
const searchDlg = $('#search-dlg');

$('#meal-select').innerHTML = MEALS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
$('#quick-chips').innerHTML = QUICK.map((q) => `<button class="chip">${q}</button>`).join('');
$('#quick-chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  if (activeSrc !== 'ciqual') setSrc('ciqual');
  $('#search-input').value = c.textContent;
  runSearch();
});

function openSearch(meal) {
  $('#meal-select').value = meal || defaultMeal();
  $('#search-input').value = '';
  setSrc('ciqual');
  searchDlg.showModal();
  setTimeout(() => $('#search-input').focus(), 50);
}

function setSrc(src) {
  activeSrc = src;
  $$('#source-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
  const ph = { ciqual: 'Rechercher : pâtes cuites, riz basmati, yaourt…', off: 'Produit ou marque : Nutella, Panzani…', usda: 'En anglais : cooked pasta, chicken breast…', mine: 'Filtrer mes aliments…' };
  $('#search-input').placeholder = ph[src];
  $('#quick-chips').hidden = src !== 'ciqual';
  runSearch();
}
$('#source-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setSrc(b.dataset.src);
});

function resultRow(f) {
  const serving = f.serving ? `<small>${fmt((f.per100.kcal * f.serving.g) / 100)} kcal / portion</small>` : '<small>/ 100 g</small>';
  return `<div class="res" data-key="${esc(f.key)}">
    <div class="l">${f.img ? `<img src="${esc(f.img)}" alt="" loading="lazy">` : ''}
      <div><div class="nm">${esc(f.name)}${f.raw ? '<span class="badge">cru ↔ cuit</span>' : ''}</div><div class="sub">${esc(f.sub || '')}</div></div></div>
    <div class="kc">${fmt(f.per100.kcal)} kcal${serving}</div></div>`;
}

let lastResults = new Map();
function showResults(groups) {
  lastResults = new Map();
  const html = groups.filter((g) => g.items.length).map((g) => {
    g.items.forEach((f) => lastResults.set(f.key, f));
    return (g.title ? `<div class="section-title">${g.title}</div>` : '') + g.items.map(resultRow).join('');
  }).join('');
  $('#results').innerHTML = html || '<div class="empty">Aucun résultat</div>';
}

async function runSearch() {
  const q = $('#search-input').value.trim();
  if (searchAbort) searchAbort.abort();
  const box = $('#results');

  if (activeSrc === 'mine') {
    const nq = norm(q);
    const items = state.custom.filter((c) => !nq || norm(c.n).includes(nq)).map(customToFood);
    box.innerHTML = '';
    showResults([{ items }]);
    box.insertAdjacentHTML('afterbegin', '<button class="btn block" id="new-custom" style="margin-bottom:8px">＋ Créer un aliment</button>');
    return;
  }

  if (!q) {
    const favs = Object.values(state.favs);
    showResults([{ title: 'Favoris', items: favs }, { title: 'Récents', items: state.recents.filter((r) => !state.favs[r.key]) }]);
    if (!favs.length && !state.recents.length) box.innerHTML = `<div class="empty">Tape un aliment ou choisis une suggestion.<br><br><small>Les féculents existent en version <strong>cuite</strong> (et tu peux peser cru).</small></div>`;
    return;
  }

  if (activeSrc === 'ciqual') {
    await ciqualReady;
    const items = searchCiqual(q);
    showResults([{ items }]);
    if (!items.length) box.innerHTML = `<div class="empty">Rien dans CIQUAL.<br><br><button class="btn" data-goto="off">Chercher dans Open Food Facts</button></div>`;
    return;
  }

  searchAbort = new AbortController();
  box.innerHTML = '<div class="spinner"></div>';
  try {
    const items = activeSrc === 'off' ? await searchOFF(q, searchAbort.signal) : await searchUSDA(q, searchAbort.signal);
    showResults([{ items }]);
  } catch (err) {
    if (err.name === 'AbortError') return;
    box.innerHTML = `<div class="empty">Erreur réseau : ${esc(err.message)}<br><small>Vérifie ta connexion. CIQUAL fonctionne hors ligne.</small></div>`;
  }
}
const debouncedLocal = debounce(runSearch, 120);
const debouncedRemote = debounce(runSearch, 650);
$('#search-input').addEventListener('input', () => (activeSrc === 'ciqual' || activeSrc === 'mine' ? debouncedLocal() : debouncedRemote()));
$('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });

$('#results').addEventListener('click', (e) => {
  if (e.target.closest('#new-custom')) return openCustom();
  const goto = e.target.closest('[data-goto]');
  if (goto) return setSrc(goto.dataset.goto);
  const row = e.target.closest('.res');
  if (row) openPortion(lastResults.get(row.dataset.key));
});

/* ============================================================
 * PORTION
 * ============================================================ */
const portionDlg = $('#portion-dlg');
let pFood = null;
let pEntry = null;
let pMode = 'cooked';

function openPortion(food, entry = null) {
  if (!food) return;
  pFood = food;
  pEntry = entry;
  pMode = entry && entry.raw ? 'raw' : 'cooked';
  $('#p-name').textContent = food.name;
  $('#p-source').textContent = [SRC_LABEL[food.src], food.sub].filter(Boolean).join(' · ') + ` · ${fmt(food.per100.kcal)} kcal / 100 g`;
  $('#raw-box').hidden = !food.raw;
  $('#p-grams').value = entry ? (entry.raw ? entry.raw.grams : entry.grams) : food.serving ? food.serving.g : food.raw ? 200 : 100;
  $('#p-add').textContent = entry ? 'Mettre à jour' : 'Ajouter';
  $('#p-delete').hidden = !entry;
  $('#fav-btn').textContent = state.favs[food.key] ? '★' : '☆';
  setRawMode(pMode, false);
  portionDlg.showModal();
}

function setRawMode(mode, adjust = true) {
  const g = parseFloat($('#p-grams').value) || 0;
  if (adjust && pFood.raw && mode !== pMode) {
    $('#p-grams').value = round(mode === 'raw' ? g / pFood.raw.factor : g * pFood.raw.factor);
  }
  pMode = mode;
  $$('#raw-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  renderPresets();
  updatePortion();
}
$('#raw-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setRawMode(b.dataset.mode);
});

function renderPresets() {
  let presets;
  if (pFood.raw && pMode === 'raw') presets = [[60, '60 g'], [80, '80 g'], [100, '100 g'], [125, '125 g'], [150, '150 g']];
  else if (pFood.raw) presets = [[150, '150 g'], [200, '200 g'], [250, '250 g'], [300, '300 g']];
  else presets = [[30, '30 g'], [50, '50 g'], [100, '100 g'], [150, '150 g'], [200, '200 g']];
  if (pFood.serving) presets.unshift([pFood.serving.g, '1 portion (' + pFood.serving.label + ')']);
  $('#p-presets').innerHTML = presets.map(([g, l]) => `<button class="chip" data-g="${g}">${esc(l)}</button>`).join('');
}
$('#p-presets').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (c) { $('#p-grams').value = c.dataset.g; updatePortion(); }
});

function cookedGrams() {
  const g = parseFloat($('#p-grams').value) || 0;
  return pFood.raw && pMode === 'raw' ? g * pFood.raw.factor : g;
}

function updatePortion() {
  const g = cookedGrams();
  const n = scale(pFood.per100, g);
  if (pFood.raw) {
    $('#raw-info').innerHTML = pMode === 'raw'
      ? `${fmt(parseFloat($('#p-grams').value) || 0)} g de ${esc(pFood.raw.label)} ≈ <strong>${fmt(g)} g une fois cuits</strong> (facteur × ${fmt(pFood.raw.factor, 2)}, base ${pFood.raw.rawKcal} kcal / 100 g cru).`
      : `Valeurs CIQUAL pour l'aliment cuit. Pas de balance après cuisson ? Passe sur « Pesé cru / sec ».`;
  }
  const v = (x, d = 1) => (x == null ? '–' : fmt(x, d));
  $('#p-nutri').innerHTML = `
    <div><strong>${fmt(n.kcal)}</strong><span>kcal</span></div>
    <div><strong style="color:var(--p)">${v(n.p)}</strong><span>Protéines g</span></div>
    <div><strong style="color:var(--c)">${v(n.c)}</strong><span>Glucides g</span></div>
    <div><strong style="color:var(--f)">${v(n.f)}</strong><span>Lipides g</span></div>
    <div class="extra">Sucres ${v(n.s)} g · AG saturés ${v(n.sf)} g · Fibres ${v(n.fi)} g · Sel ${v(n.na, 2)} g</div>`;
}
$('#p-grams').addEventListener('input', updatePortion);

$('#p-add').addEventListener('click', () => {
  const input = parseFloat($('#p-grams').value);
  if (!(input > 0)) return toast('Quantité invalide');
  const grams = round(cookedGrams(), 1);
  const raw = pFood.raw && pMode === 'raw' ? { grams: input, factor: pFood.raw.factor } : null;
  const list = (state.log[currentDate] = state.log[currentDate] || []);
  if (pEntry) {
    Object.assign(pEntry, { grams, raw });
    toast('Mis à jour');
  } else {
    list.push({
      uid: uid(), meal: $('#meal-select').value, key: pFood.key, src: pFood.src, ref: pFood.ref,
      name: pFood.name, sub: pFood.sub, per100: pFood.per100, grams, raw, rawInfo: pFood.raw || null, serving: pFood.serving || null, t: Date.now(),
    });
    addRecent(pFood);
    toast(`${fmt((pFood.per100.kcal * grams) / 100)} kcal ajoutées`);
  }
  save();
  portionDlg.close();
  if (!pEntry) searchDlg.close();
  renderJournal();
});

$('#p-delete').addEventListener('click', () => {
  if (!pEntry) return;
  state.log[currentDate] = dayEntries().filter((e) => e.uid !== pEntry.uid);
  save();
  portionDlg.close();
  renderJournal();
  toast('Supprimé');
});

$('#fav-btn').addEventListener('click', () => {
  if (state.favs[pFood.key]) delete state.favs[pFood.key];
  else state.favs[pFood.key] = slimFood(pFood);
  $('#fav-btn').textContent = state.favs[pFood.key] ? '★' : '☆';
  save();
});

function slimFood(f) {
  const { key, src, ref, name, sub, per100, raw, serving, img } = f;
  return { key, src, ref, name, sub, per100, raw: raw || null, serving: serving || null, img };
}
function addRecent(f) {
  state.recents = [slimFood(f), ...state.recents.filter((r) => r.key !== f.key)].slice(0, 30);
}

/* ============================================================
 * ALIMENT PERSO
 * ============================================================ */
const customDlg = $('#custom-dlg');
function openCustom() {
  $('#custom-form').reset();
  customDlg.showModal();
}
$('#custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const num = (k) => (fd.get(k) === '' ? null : parseFloat(fd.get(k)));
  const c = { id: uid(), n: fd.get('n').trim(), kcal: num('kcal'), p: num('p'), c: num('c'), s: num('s'), f: num('f'), fi: num('fi'), serving: num('serving') };
  state.custom.push(c);
  save();
  customDlg.close();
  runSearch();
  openPortion(customToFood(c));
});

/* ============================================================
 * CODE-BARRES
 * ============================================================ */
const scanDlg = $('#scan-dlg');
let scanStream = null;

$('#scan-btn').addEventListener('click', openScan);
async function openScan() {
  $('#barcode-input').value = '';
  scanDlg.showModal();
  const video = $('#scan-video');
  const msg = $('#scan-msg');
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) {
    video.hidden = true;
    msg.textContent = 'Le scan caméra n’est pas pris en charge par ce navigateur (essaie Chrome sur Android). Saisis le code à la main :';
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream;
    video.hidden = false;
    await video.play();
    msg.textContent = 'Vise le code-barres du produit…';
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) return lookupBarcode(codes[0].rawValue);
      } catch { /* image pas prête */ }
      requestAnimationFrame(tick);
    };
    tick();
  } catch {
    video.hidden = true;
    msg.textContent = 'Caméra indisponible. Saisis le code à la main :';
  }
}
function stopScan() {
  if (scanStream) scanStream.getTracks().forEach((t) => t.stop());
  scanStream = null;
}
scanDlg.addEventListener('close', stopScan);
$('#barcode-form').addEventListener('submit', (e) => {
  e.preventDefault();
  lookupBarcode($('#barcode-input').value.trim());
});
async function lookupBarcode(code) {
  stopScan();
  $('#scan-msg').textContent = 'Recherche du produit ' + code + '…';
  try {
    const food = await fetchBarcode(code);
    if (!food) {
      $('#scan-msg').textContent = `Produit ${code} introuvable dans Open Food Facts (ou sans valeurs nutritionnelles). Tu peux le créer dans « Mes aliments ».`;
      return;
    }
    scanDlg.close();
    openPortion(food);
  } catch {
    $('#scan-msg').textContent = 'Erreur réseau.';
  }
}

/* ============================================================
 * HISTORIQUE
 * ============================================================ */
let histDays = 7;
$('#hist-range').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  histDays = +b.dataset.days;
  $$('#hist-range button').forEach((x) => x.classList.toggle('on', x === b));
  renderHistory();
});

function renderHistory() {
  const today = isoDate(new Date());
  const days = [];
  for (let i = histDays - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ d, kcal: sumEntries(dayEntries(d)).kcal });
  }
  const goal = state.settings.goal;
  const W = 600, H = 240, pad = 50;
  const max = Math.max(goal * 1.25, ...days.map((x) => x.kcal)) || 1;
  const bw = (W - pad) / days.length;
  const y = (v) => H - 26 - (v / max) * (H - 46);
  const labelEvery = Math.ceil(days.length / 10);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories par jour">`;
  svg += `<line class="axis" x1="${pad}" x2="${W}" y1="${H - 26}" y2="${H - 26}"/>`;
  svg += `<line class="goal" x1="${pad}" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/><text x="0" y="${y(goal) + 3}">${fmt(goal)}</text>`;
  days.forEach((x, i) => {
    const h = H - 26 - y(x.kcal);
    const cx = pad + i * bw;
    if (x.kcal > 0) svg += `<rect class="${x.kcal > goal * 1.05 ? 'barover' : 'barok'}" x="${cx + bw * 0.15}" y="${y(x.kcal)}" width="${bw * 0.7}" height="${h}" rx="3"><title>${x.d} : ${fmt(x.kcal)} kcal</title></rect>`;
    if (i % labelEvery === 0) svg += `<text x="${cx + bw / 2}" y="${H - 5}" text-anchor="middle">${x.d.slice(8)}/${x.d.slice(5, 7)}</text>`;
  });
  $('#chart').innerHTML = svg + '</svg>';

  const logged = days.filter((x) => x.kcal > 0);
  const avg = logged.length ? logged.reduce((a, x) => a + x.kcal, 0) / logged.length : 0;
  const within = logged.filter((x) => x.kcal <= goal * 1.05).length;
  $('#hist-stats').innerHTML = `
    <div><strong>${fmt(avg)}</strong><span>kcal / jour (moy.)</span></div>
    <div><strong>${logged.length}/${days.length}</strong><span>jours saisis</span></div>
    <div><strong>${within}</strong><span>jours dans l'objectif</span></div>`;
  renderWeight();
}

function renderWeight() {
  const pts = Object.entries(state.weights).sort(([a], [b]) => a.localeCompare(b)).slice(-60);
  const box = $('#weight-chart');
  if (pts.length < 2) {
    box.innerHTML = pts.length ? `<p class="muted">Dernier poids : ${fmt(pts[0][1], 1)} kg</p>` : '<p class="muted">Enregistre ton poids pour voir la courbe.</p>';
    return;
  }
  const W = 600, H = 180, pad = 56;
  const vals = pts.map((p) => p[1]);
  const mn = Math.min(...vals) - 0.5, mx = Math.max(...vals) + 0.5;
  const t0 = new Date(pts[0][0]).getTime(), t1 = new Date(pts[pts.length - 1][0]).getTime() || t0 + 1;
  const x = (d) => pad + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - pad - 10);
  const y = (v) => 14 + (1 - (v - mn) / (mx - mn)) * (H - 44);
  let svg = `<svg viewBox="0 0 ${W} ${H}"><line class="axis" x1="${pad}" x2="${W}" y1="${H - 26}" y2="${H - 26}"/>`;
  svg += `<text x="0" y="${y(mx - 0.5) + 3}">${fmt(mx - 0.5, 1)}</text><text x="0" y="${y(mn + 0.5) + 3}">${fmt(mn + 0.5, 1)}</text>`;
  svg += `<polyline class="line" points="${pts.map(([d, v]) => `${x(d)},${y(v)}`).join(' ')}"/>`;
  svg += pts.map(([d, v]) => `<circle class="dot" cx="${x(d)}" cy="${y(v)}" r="3"><title>${d} : ${v} kg</title></circle>`).join('');
  svg += `<text x="${pad}" y="${H - 5}">${pts[0][0].slice(5)}</text><text x="${W - 10}" y="${H - 5}" text-anchor="end">${pts[pts.length - 1][0].slice(5)}</text>`;
  box.innerHTML = svg + '</svg>';
}

$('#weight-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = parseFloat($('#weight-input').value);
  if (!(v > 0)) return;
  state.weights[currentDate] = v;
  state.settings.profile.weight = v;
  save();
  $('#weight-input').value = '';
  renderWeight();
  toast('Poids enregistré');
});

/* ============================================================
 * RÉGLAGES
 * ============================================================ */
const pf = $('#profile-form');
function fillSettings() {
  const s = state.settings;
  for (const [k, v] of Object.entries(s.profile)) if (pf.elements[k]) pf.elements[k].value = v;
  for (const k of ['goal', 'pPct', 'cPct', 'fPct']) pf.elements[k].value = s[k];
  $('#usda-key').value = s.usdaKey;
  updateBmr();
}
function calcTdee() {
  const e = pf.elements;
  const w = +e.weight.value, h = +e.height.value, a = +e.age.value;
  if (!w || !h || !a) return null;
  const bmr = 10 * w + 6.25 * h - 5 * a + (e.sex.value === 'm' ? 5 : -161);
  const tdee = bmr * +e.activity.value;
  return { bmr, tdee, goal: Math.round((tdee + +e.target.value) / 10) * 10 };
}
function updateBmr() {
  const r = calcTdee();
  $('#bmr-info').textContent = r ? `Métabolisme de base ≈ ${fmt(r.bmr)} kcal · Dépense totale ≈ ${fmt(r.tdee)} kcal · Objectif conseillé ≈ ${fmt(r.goal)} kcal` : '';
}
pf.addEventListener('input', updateBmr);
$('#apply-calc').addEventListener('click', () => {
  const r = calcTdee();
  if (r) pf.elements.goal.value = Math.max(1200, r.goal);
});
pf.addEventListener('submit', (e) => {
  e.preventDefault();
  const el = pf.elements;
  const pct = +el.pPct.value + +el.cPct.value + +el.fPct.value;
  if (Math.abs(pct - 100) > 1) return toast(`Les macros font ${pct} % au lieu de 100 %`);
  const s = state.settings;
  s.goal = +el.goal.value;
  s.pPct = +el.pPct.value; s.cPct = +el.cPct.value; s.fPct = +el.fPct.value;
  s.profile = { sex: el.sex.value, age: +el.age.value, height: +el.height.value, weight: +el.weight.value, activity: el.activity.value, target: el.target.value };
  save();
  toast('Réglages enregistrés');
  renderJournal();
});
$('#usda-key').addEventListener('change', (e) => { state.settings.usdaKey = e.target.value.trim(); save(); });

$('#export-btn').addEventListener('click', async () => {
  const filename = `gabriel-tracker-${isoDate(new Date())}.json`;
  const json = JSON.stringify(state, null, 2);
  const downloads = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
  if (downloads) {
    try { await downloads.save({ filename, data: json }); toast('Export enregistré'); } catch (err) { if (err.code !== 'declined') toast('Export impossible ici'); }
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.log || !data.settings) throw new Error();
    if (!(await askConfirm('Remplacer les données actuelles par celles du fichier ?', 'Remplacer'))) return;
    state = normalize({ ...data, meta: state.meta });
    save();
    fillSettings();
    renderJournal();
    toast('Données importées');
  } catch {
    toast('Fichier invalide');
  }
  e.target.value = '';
});
$('#reset-btn').addEventListener('click', async () => {
  if (!(await askConfirm('Effacer définitivement tout le journal, les aliments perso et les réglages ?', 'Tout effacer'))) return;
  state = normalize({ meta: state.meta });
  save();
  fillSettings();
  renderJournal();
  toast('Données effacées');
});

/* ============================================================
 * NAVIGATION
 * ============================================================ */
function showView(v) {
  $$('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  $$('.tabbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  if (v === 'history') renderHistory();
  window.scrollTo(0, 0);
}
$$('.tabbar [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#fab').addEventListener('click', () => openSearch());
$('#prev-day').addEventListener('click', () => { currentDate = addDays(currentDate, -1); renderJournal(); });
$('#next-day').addEventListener('click', () => { currentDate = addDays(currentDate, 1); renderJournal(); });
$('#date-label').addEventListener('click', () => {
  const i = $('#date-input');
  try { i.showPicker(); } catch { i.classList.remove('visually-hidden'); i.focus(); }
});
$('#date-input').addEventListener('change', (e) => {
  e.target.classList.add('visually-hidden');
  if (e.target.value) { currentDate = e.target.value; renderJournal(); }
});
$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

function askConfirm(message, okLabel) {
  const dlg = $('#confirm-dlg');
  $('#confirm-msg').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

if (EMBEDDED) {
  $$('#source-tabs [data-src=off], #source-tabs [data-src=usda], #scan-btn, #usda-key-label').forEach((el) => (el.hidden = true));
  $('#embedded-note').hidden = false;
}

fillSettings();
renderJournal();
startSync();

if (!EMBEDDED && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
