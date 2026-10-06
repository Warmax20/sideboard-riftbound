const KEY = 'sb-guide-v1';
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const app = document.getElementById('app');

let db = loadDb();
let champs = { v: '', map: {} };
let view = { name: 'home' };

// ---------- helpers ----------

function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.legends)) return d;
  } catch {}
  return { legends: [] };
}

// `changed` marks guides as edited since the last backup; restoring or backing up doesn't count.
function save(changed = true) {
  localStorage.setItem(KEY, JSON.stringify(db));
  if (changed) localStorage.setItem(KEY + '-dirty', '1');
}

// Gives the user a file: the share sheet on iPhone (a download link is unreliable in an
// installed app there), a plain download everywhere else.
function giveFile(file) {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file] }).then(() => true, () => false);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return Promise.resolve(true);
}

function backupStatus() {
  const last = localStorage.getItem(KEY + '-backup');
  const dirty = localStorage.getItem(KEY + '-dirty');
  if (!last) return 'Never backed up';
  return `Last backup: ${fmtDate(last)}${dirty ? ' · changes since then' : ''}`;
}

function restoreFrom(text) {
  try {
    const d = JSON.parse(text);
    if (!d || !Array.isArray(d.legends) || d.legends.some(l => !l.id || !l.name || !Array.isArray(l.versions) || !l.versions.length)) throw 0;
    db = d;
    save(false);
    go({ name: 'home' });
  } catch {
    view.err = "That isn't a valid backup. Pick the .json file you exported.";
    render();
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = o => JSON.parse(JSON.stringify(o));
const today = () => new Date().toISOString().slice(0, 10);
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const total = cards => cards.reduce((n, c) => n + c.qty, 0);
const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// Official spelling when the name is a known Riftbound legend ("leblanc" -> "LeBlanc").
const canon = name => LEGENDS.find(l => norm(l) === norm(name)) || name.trim();

const legend = id => db.legends.find(l => l.id === id);
const latest = l => l.versions[l.versions.length - 1];

// CSS variables for the legend's two domain colors; empty for an unknown legend.
function domainVars(name) {
  const d = LEGEND_DOMAINS[canon(name)];
  return d ? `--d1:var(--${d[0]});--d2:var(--${d[1] || d[0]})` : '';
}

function avatar(name, small) {
  const c = champs.map[norm(name)];
  const initials = name.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const img = c ? `<img src="${DDRAGON}/cdn/${champs.v}/img/champion/${c}.png" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="av${small ? ' sm' : ''}" style="${domainVars(name)}">${esc(initials)}${img}</span>`;
}

// Legends matching what's typed, each with its portrait. Empty once a legend is chosen.
function picker(field, value) {
  const q = norm(value);
  const list = LEGENDS.filter(n => norm(n).includes(q));
  if (list.length === 1 && norm(list[0]) === q) return '';
  return list.map(n => `<button class="pick" data-a="pick" data-field="${field}" data-name="${esc(n)}">${avatar(n, true)}<span class="name">${esc(n)}</span></button>`).join('');
}

function mergeCard(list, card) {
  const hit = list.find(c => norm(c.name) === norm(card.name));
  if (hit) hit.qty += card.qty; else list.push(card);
}

// ---------- parsing ----------

// "3 Falling Star", "3x Falling Star", "Falling Star" (qty 1)
function parseCard(str) {
  const s = str.trim();
  if (!s) return null;
  const m = s.match(/^[+-]?\s*(\d+)\s*x?\s+(.+)$/i);
  return m ? { qty: +m[1], name: m[2].trim() } : { qty: 1, name: s };
}

function parseCards(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const c = parseCard(line);
    if (c && c.qty > 0) mergeCard(out, c);
  }
  return out;
}

const cardsText = cards => cards.map(c => `${c.qty} ${c.name}`).join('\n');

// Decklist: lines "3 Card name" under section headers. Runes, battlefields and
// the legend itself can't be sided, so those sections are skipped.
// `sections` keeps every section as pasted, for the visual decklist.
function parseDeck(text) {
  const main = [], side = [], sections = [];
  let sec = 'main', cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const m = l.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) {
      const h = norm(l);
      sec = /side|reserve/.test(h) ? 'side' : /rune|battlefield|legend/.test(h) ? 'skip' : 'main';
      cur = { title: l.replace(/\s*:$/, ''), cards: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) { cur = { title: 'Main deck', cards: [] }; sections.push(cur); }
    const card = { qty: +m[1], name: m[2].trim() };
    mergeCard(cur.cards, { ...card });
    if (sec !== 'skip') mergeCard(sec === 'side' ? side : main, card);
  }
  return { main, side, sections: sections.filter(s => s.cards.length) };
}

// ---------- card images ----------

const CARDS = new Map(CARD_LIST.map(([name, file]) => [norm(name), { name, file }]));
// "Daughter of the Void" or "Without a Sound" alone also finds the card, when unambiguous.
const CARD_PARTS = new Map();
for (const c of CARDS.values()) {
  const part = norm(c.name.split(', ').slice(1).join(''));
  if (part) CARD_PARTS.set(part, CARD_PARTS.has(part) ? null : c);
}
const found = new Map();

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Exact name first, then near misses such as "Travelling Merchant" for "Traveling Merchant".
function findCard(name) {
  const k = norm(name);
  if (found.has(k)) return found.get(k);
  let hit = CARDS.get(k) || CARD_PARTS.get(k) || null;
  if (!hit) {
    const max = k.length >= 8 ? 2 : k.length >= 5 ? 1 : 0;
    let best = max + 1;
    for (const [key, c] of CARDS) {
      const d = editDistance(key, k, max);
      if (d < best) { best = d; hit = c; }
    }
  }
  found.set(k, hit);
  return hit;
}

const cardUrl = (file, width) => `${CARD_IMG}${file}?w=${width}&auto=format&accountingTag=RB`;

// Free-form guide text, e.g.
//   vs Viktor
//   OUT: 2 Falling Star, 1 Stupefy
//   IN: 2 Hextech Ray, 1 Rune Prison
// Also accepts "+2 Card" / "-2 Card" lines and one card per line under In/Out.
//
// Play first / play second: a "1st" or "2nd" line switches plan. A two-column
// table copied from a web page or a doc arrives with the cells of each row
// separated by a tab (alone on its line, or inline); the cell after the tab
// belongs to the second column, i.e. the "2nd" plan.
function parseGuide(text) {
  const res = [];
  let cur = null, mode = null, target = 'first', tab = false, afterFirst = false;
  const start = name => {
    cur = { id: uid(), opponent: canon(name.replace(/[\s:\-–]+$/, '')), outs: [], ins: [], second: { outs: [], ins: [] }, note: '', flat: null };
    res.push(cur);
    mode = null; target = 'first'; tab = false;
  };
  const plan = () => (tab || target === 'second' ? cur.second : cur);
  const addCards = (str, m) => {
    // Card names can contain commas ("Zed, Without A Sound"): only split before a quantity.
    for (const part of str.split(/[,;]\s*(?=[+-]?\s*\d)/)) {
      const c = parseCard(part);
      if (c) mergeCard(plan()[m], c);
    }
  };
  const handle = l => {
    let m;
    const wasAfterFirst = afterFirst;
    afterFirst = false;
    if ((m = l.match(/^(?:vs\.?|versus|contre|match-?up)\s*:?\s+(.+)$/i))) return start(m[1]);
    if ((m = l.match(/^(1st|1er|first|premier|otp|on the play|2nd|2e|2[eè]me|second|otd|on the draw)\s*:?$/i))) {
      const second = /^(2|second|otd|on the draw)/i.test(m[1]);
      // "2nd" straight after "1st" with no tab in between: a table whose tabs were lost in the
      // copy (phones do that). Its cards are collected in order and split by splitColumns().
      if (second && !tab && wasAfterFirst && cur) cur.flat = [];
      // "2nd" right after a tab is a table header: columns are then told apart card by card.
      target = second && !tab && !(cur && cur.flat) ? 'second' : 'first';
      afterFirst = !second;
      return;
    }
    if ((m = l.match(/^(side ?out|side ?in|out|in|sorties?|entr[ée]es?)\b\s*(?:\(\d+\))?\s*[:\-–]?\s*(.*)$/i))) {
      if (!cur) start('?');
      mode = /^(side ?out|out|sort)/i.test(m[1]) ? 'outs' : 'ins';
      if (m[2]) addCards(m[2], mode);
      return;
    }
    if ((m = l.match(/^([+\-−–])\s*(\d+)\s*x?\s+(.+)$/))) {
      if (!cur) start('?');
      const side = m[1] === '+' ? 'ins' : 'outs', card = { qty: +m[2], name: m[3].trim() };
      if (cur.flat && !tab) cur.flat.push({ side, card }); else mergeCard(plan()[side], card);
      return;
    }
    if (cur && mode && /^\d+\s*x?\s+\S/.test(l)) return addCards(l, mode);
    if ((m = l.match(/^notes?\s*:\s*(.+)$/i))) { if (cur) cur.note = (cur.note + ' ' + m[1]).trim(); return; }
    const hasCards = cur && (cur.outs.length || cur.ins.length || cur.second.outs.length || cur.second.ins.length || (cur.flat && cur.flat.length));
    const looksLikeName = l.split(/\s+/).length <= 4 && !/[.!?]$/.test(l);
    if (!cur || (hasCards && looksLikeName)) start(l);
    else cur.note = (cur.note + ' ' + l).trim();
  };
  for (const raw of text.replace(/(\S) *\t *(\S)/g, '$1\n\t\n$2').split(/\r?\n/)) {
    if (/^ *\t\s*$/.test(raw)) { tab = true; continue; }
    const l = raw.replace(/^[\s*•#>-]+(?=\D)/, '').trim();
    if (!l) continue;
    handle(l);
    tab = false;
  }
  const key = p => JSON.stringify([p.outs, p.ins].map(cs => cs.map(c => `${c.qty} ${norm(c.name)}`).sort()));
  for (const m of res) {
    if (m.flat) {
      const [first, second] = splitColumns(m.flat);
      first.forEach(c => mergeCard(m[c.side], c.card));
      second.forEach(c => mergeCard(m.second[c.side], c.card));
    }
    delete m.flat;
    const empty = !m.second.outs.length && !m.second.ins.length;
    if (empty || key(m.second) === key(m)) m.second = null;
  }
  return res;
}

// A two-column table read row by row, with its column separators lost: cells alternate
// 1st, 2nd, 1st, 2nd… until the shorter column runs out, then all belong to the longer one.
// Nothing says where that happens, so every possibility is tried and the one that makes
// sense wins: as many cards in as out in each column, and ins listed before outs.
function splitColumns(cells) {
  const score = col => {
    if (!col.length) return 0;
    const qty = side => col.filter(c => c.side === side).reduce((n, c) => n + c.card.qty, 0);
    const ordered = col.every((c, i) => !i || !(c.side === 'ins' && col[i - 1].side === 'outs'));
    return (qty('ins') === qty('outs') ? 2 : 0) + (ordered ? 1 : 0);
  };
  let best = null;
  for (let rows = Math.floor(cells.length / 2); rows >= 0; rows--) {
    const paired = cells.slice(0, rows * 2), rest = cells.slice(rows * 2);
    const a = paired.filter((_, i) => i % 2 === 0), b = paired.filter((_, i) => i % 2 === 1);
    for (const cols of rest.length ? [[[...a, ...rest], b], [a, [...b, ...rest]]] : [[a, b]]) {
      const s = score(cols[0]) + score(cols[1]);
      if (!best || s > best.s) best = { s, cols };
    }
  }
  return best ? best.cols : [[], []];
}

// The plan to show for a matchup: the "play second" one when it exists and is asked for.
const planOf = (m, which) => (which === 'second' && m.second ? m.second : m);

// ---------- views ----------

function bar(title, back, right = '') {
  return `<div class="bar">
    ${back ? `<button class="ghost back" data-a="${back}" aria-label="Back">‹</button>` : ''}
    <div class="grow">${title}</div>${right}</div>`;
}

// The latest set released on a given day (the first set for anything earlier).
const setAt = date => [...SETS].reverse().find(s => s.date <= date) || SETS[0];
// A version's set: the one chosen for it, else the set that was current when it was made.
const setOf = v => SETS.find(s => s.id === v.set) || setAt(v.date);
// What the user called a version, e.g. whose list it is. Versions made before titles existed had a note.
const titleOf = v => (v.title !== undefined ? v.title : v.note) || '';
// Green when the version was made for the set currently out, amber when it's from an older one.
const setTag = v => `<span class="tag${setOf(v) === setAt(today()) ? '' : ' old'}">${setOf(v).name}</span>`;

const GEAR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

function viewHome() {
  const byRecent = (a, b) => (b.opened || 0) - (a.opened || 0);
  const row = l => {
    const v = latest(l);
    return `<button class="row grow" data-a="open" data-id="${l.id}">
      ${avatar(l.name)}
      <span class="grow"><span class="name">${esc(l.name)}</span>${setTag(v)}<br>
      <span class="muted">v${v.n}${titleOf(v) ? ' · ' + esc(titleOf(v)) : ''} · ${fmtDate(v.date)} · ${v.matchups.length} matchup${v.matchups.length === 1 ? '' : 's'}</span></span>
      <span class="chev">›</span></button>`;
  };
  const list = db.legends.filter(l => !l.archived).sort(byRecent).map(row).join('');
  const old = db.legends.filter(l => l.archived).sort(byRecent);
  const archived = !old.length ? '' : `<button class="ghost muted" data-a="toggle-archived">Archived (${old.length})<span class="caret${view.showArchived ? '' : ' right'}"></span></button>` +
    (view.showArchived ? `<div class="archived">${old.map(l =>
      `<div class="line">${row(l)}<button data-a="unarchive" data-id="${l.id}">Restore</button></div>`).join('')}</div>` : '');
  const empty = `<div class="empty"><strong>Add your first legend</strong>Your sideboard guide will be one tap away from your home screen.</div>`;
  const form = view.adding
    ? `<label for="lname">Legend name</label>
       <input type="text" id="lname" data-f="lname" value="${esc(view.lname || '')}" placeholder="Kai'Sa" autocomplete="off">
       <div class="picker" id="picker">${picker('lname', view.lname || '')}</div>
       ${view.err ? `<p class="err">${esc(view.err)}</p>` : ''}
       <div class="actions"><button data-a="cancel-add">Cancel</button><button class="primary" data-a="create">Create</button></div>`
    : `<button class="block primary" data-a="add">Add a legend</button>`;
  // On a phone, in the browser: push installing first. On iPhone the installed app keeps its
  // own data, so guides built in the browser would not be there after installing.
  const key = browserKey();
  const nudge = key === 'desktop' || isInstalled() || localStorage.getItem(KEY + '-nudge') ? '' : `<div class="nudge">
      <strong>Add Sideboard to your home screen first</strong>
      <p>${key.startsWith('ios')
        ? 'Do it before building your guides. On iPhone the app from your home screen keeps its own data: guides you create here in the browser will not show up in it.'
        : 'It opens like an app, full screen and offline, straight to your guides.'}</p>
      <button class="block" data-a="install">Show me how</button>
      <button class="ghost" data-a="skip-nudge">Continue in the browser</button>
    </div>`;
  return bar('<h1>Your legends</h1>') + nudge + (list || empty) + form +
    `<div class="footer">${archived}${isInstalled() ? '' : '<button class="ghost muted" data-a="install">Add to home screen</button>'}
      <button class="ghost muted" data-a="backup">Backup and transfer</button>
      ${db.legends.length ? `<p class="muted" style="font-size:13px">${backupStatus()}</p>` : ''}</div>`;
}

function cardList(cards) {
  if (!cards.length) return '<span class="muted">—</span>';
  return [...cards].sort((a, b) => byName(a.name, b.name))
    .map(c => `<div class="card-line"><b>${c.qty}</b><span>${esc(c.name)}</span></div>`).join('');
}

// Same cards as pictures, for the guide's "cards" display.
function cardPics(cards) {
  if (!cards.length) return '<span class="muted">—</span>';
  return `<div class="tiles four">${[...cards].sort((a, b) => byName(a.name, b.name)).map(cardTile).join('')}</div>`;
}

const PICS_KEY = KEY + '-pics';
const showPics = () => localStorage.getItem(PICS_KEY) !== 'off';

function viewGuide() {
  const l = legend(view.lid);
  const v = l.versions.find(x => x.id === view.vid) || latest(l);
  const isLatest = v === latest(l);
  const mus = [...v.matchups].sort((a, b) => byName(a.opponent, b.opponent));
  const seg = mus.some(m => m.second) ? `<div class="seg" role="group" aria-label="Turn order">
      <button data-a="plan" data-plan="first" aria-pressed="${view.plan !== 'second'}">Going 1st</button>
      <button data-a="plan" data-plan="second" aria-pressed="${view.plan === 'second'}">Going 2nd</button>
    </div>` : '';
  const pics = showPics();
  const list = mus.map(m => {
    const p = planOf(m, view.plan);
    const o = total(p.outs), i = total(p.ins);
    const open = view.open.has(m.id);
    return `<div class="mu">
      <button class="mu-head" data-a="toggle" data-id="${m.id}" aria-expanded="${open}">
        ${avatar(m.opponent, true)}
        <span class="grow name">${esc(m.opponent)}</span>
        <span class="count${o !== i ? ' bad' : ''}">${o} out · ${i} in</span>
        <span class="caret${open ? '' : ' right'}"></span>
      </button>
      ${open ? `<div class="mu-body">
        <div class="cols${pics ? ' stack' : ''}">
          <div class="side out"><h3>Out · ${o}</h3>${(pics ? cardPics : cardList)(p.outs)}</div>
          <div class="side in"><h3>In · ${i}</h3>${(pics ? cardPics : cardList)(p.ins)}</div>
        </div>
        ${seg && !m.second ? '<p class="note">Same plan going 1st and 2nd.</p>' : ''}
        ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}
        ${isLatest ? `<div class="mu-actions"><button data-a="edit" data-id="${m.id}">Edit</button></div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');
  const empty = `<div class="empty"><strong>Add your first matchup</strong>Paste your decklist, then pick your ins and outs. Or paste a whole guide with Import guide.</div>`;
  const banner = isLatest ? '' : `<div class="banner"><span class="grow">Older version, read-only.</span><button data-a="open" data-id="${l.id}">View current</button></div>`;
  const deckLabel = v.deck ? `Decklist · ${total(v.deck.main)} + ${total(v.deck.side)}` : 'Add decklist';
  const actions = isLatest ? `<div class="actions">
      <button class="primary wide" data-a="new-mu">Add a matchup</button>
      <button data-a="import">Import guide</button>
      <button data-a="deck">${deckLabel}</button>
    </div>` : '';
  return bar(`<div style="display:flex;align-items:center;gap:10px">${avatar(l.name)}<h1>${esc(l.name)}</h1></div>`, 'home',
    `<button class="pill" data-a="versions">v${v.n}<span class="caret"></span></button>
     <button class="ghost gear" data-a="settings" aria-label="Legend settings">${GEAR}</button>`) +
    (titleOf(v) ? `<p class="vtitle">${esc(titleOf(v))}</p>` : '') + banner + seg +
    (list ? `<button class="switch" role="switch" aria-checked="${pics}" data-a="toggle-pics"><span class="grow">Card images</span><span class="track"><span class="knob"></span></span></button>` : '') +
    (list || empty) + actions;
}

// The plan being edited: the draft itself (play first) or its "second" variant.
const editKey = () => (view.plan === 'second' && view.draft.second ? 'second' : 'first');
const editPlan = () => (editKey() === 'second' ? view.draft.second : view.draft);

function stepper(side, pool, picked) {
  const names = [...new Set([...pool.map(c => c.name), ...picked.map(c => c.name)])].sort(byName);
  if (!names.length) return '<p class="muted">No cards in this part of the decklist.</p>';
  return names.map(name => {
    const n = (picked.find(c => c.name === name) || {}).qty || 0;
    const inDeck = pool.find(c => c.name === name);
    return `<div class="step ${n ? 'on' : 'off'}">
      <span class="grow">${esc(name)}${inDeck ? '' : ' <span class="muted">(not in decklist)</span>'}</span>
      <button data-a="dec" data-side="${side}" data-card="${esc(name)}" aria-label="Remove one ${esc(name)}">−</button>
      <span class="n">${n}${inDeck ? `<small>/${inDeck.qty}</small>` : ''}</span>
      <button data-a="inc" data-side="${side}" data-card="${esc(name)}" aria-label="Add one ${esc(name)}">+</button>
    </div>`;
  }).join('');
}

function editTotals() {
  const d = editPlan(), t = view.texts[editKey()];
  const o = view.deck ? total(d.outs) : total(parseCards(t.outs));
  const i = view.deck ? total(d.ins) : total(parseCards(t.ins));
  return `<span class="count${o !== i ? ' bad' : ''}">${o} out · ${i} in${o !== i ? ' — totals differ' : ''}</span>`;
}

function viewEdit() {
  const d = view.draft, p = editPlan(), t = view.texts[editKey()];
  const seg = d.second
    ? `<div class="seg" role="group" aria-label="Plan to edit" style="margin-top:16px">
         <button data-a="edit-plan" data-plan="first" aria-pressed="${editKey() === 'first'}">Going 1st</button>
         <button data-a="edit-plan" data-plan="second" aria-pressed="${editKey() === 'second'}">Going 2nd</button>
       </div>`
    : '';
  const body = view.deck
    ? `<h2 style="color:var(--out)">Out — from the main deck</h2>${stepper('outs', view.deck.main, p.outs)}
       <h2 style="color:var(--in)">In — from the sideboard</h2>${stepper('ins', view.deck.side, p.ins)}`
    : `<label for="outs">Out — one card per line</label>
       <textarea id="outs" data-f="outsText" placeholder="2 Falling Star&#10;1 Stupefy">${esc(t.outs)}</textarea>
       <label for="ins">In — one card per line</label>
       <textarea id="ins" data-f="insText" placeholder="2 Hextech Ray&#10;1 Rune Prison">${esc(t.ins)}</textarea>
       <p class="muted" style="margin-top:8px">Save a decklist to pick cards with + and − buttons instead.</p>`;
  return bar(`<h1>${view.isNew ? 'New matchup' : 'Edit matchup'}</h1>`, 'back-guide') +
    `<label for="opp">Opposing legend</label>
     <input type="text" id="opp" data-f="opponent" value="${esc(d.opponent)}" placeholder="Viktor" autocomplete="off">
     <div class="picker" id="picker">${picker('opponent', d.opponent)}</div>
     ${view.err ? `<p class="err">${esc(view.err)}</p>` : ''}
     ${seg}
     ${body}
     <p id="totals" style="margin-top:14px">${editTotals()}</p>
     <button class="block" data-a="toggle-second">${d.second ? 'Use a single plan' : 'Different plan when going 2nd'}</button>
     <label for="note">Note</label>
     <input type="text" id="note" data-f="note" value="${esc(d.note)}" placeholder="Hold answers for turn 4">
     <div class="actions">
       <button data-a="back-guide">Cancel</button><button class="primary" data-a="save-mu">Save</button>
       ${view.isNew ? '' : `<button class="wide danger" data-a="del-mu">Delete matchup</button>`}
     </div>`;
}

function viewVersions() {
  const l = legend(view.lid);
  const cur = latest(l);
  const many = l.versions.length > 1;
  const list = [...l.versions].reverse().map(v => `<div class="version">
      <button class="row" data-a="show-version" data-id="${v.id}">
        <span class="grow"><span class="name">v${v.n}</span>${setTag(v)}${v === cur ? '<span class="tag plain">Current</span>' : ''}<br>
        <span class="muted">${fmtDate(v.date)} · ${v.matchups.length} matchup${v.matchups.length === 1 ? '' : 's'}</span></span>
        <span class="chev">›</span></button>
      <div class="line">
        <label for="title-${v.id}">Title</label>
        <input type="text" id="title-${v.id}" data-c="title" data-id="${v.id}" value="${esc(titleOf(v))}" placeholder="Whose list, which event">
      </div>
      <div class="line">
        <label for="set-${v.id}">Set</label>
        <select id="set-${v.id}" data-c="set" data-id="${v.id}">${SETS.map(s =>
          `<option value="${s.id}"${s === setOf(v) ? ' selected' : ''}>${s.name}</option>`).join('')}</select>
        ${many ? `<button class="danger" data-a="del-version" data-id="${v.id}">${view.confirmVer === v.id ? 'Confirm' : 'Delete'}</button>` : ''}
      </div>
    </div>`).join('');
  return bar('<h1>Versions and settings</h1>', 'back-guide') + list +
    `<label for="vnote">Title for the new version</label>
     <input type="text" id="vnote" data-f="vnote" value="${esc(view.vnote || '')}" placeholder="Whose list, which event">
     <button class="block primary" data-a="new-version">Create v${cur.n + 1} from v${cur.n}</button>
     <p class="muted" style="margin-top:8px">The current version is copied and tagged ${setAt(today()).name}. Older versions stay available.</p>
     <h2 id="legend-settings">This legend</h2>
     <div class="actions">
       <button class="wide" data-a="pdf">Save guide as PDF</button>
       <button data-a="archive">${l.archived ? 'Restore from archive' : 'Archive'}</button>
       <button class="danger" data-a="del-legend">${view.confirmDel ? 'Confirm deletion' : 'Delete'}</button>
     </div>
     <p class="muted" style="margin-top:8px">Archiving hides the legend from your list and keeps its guides. Deleting removes them for good.</p>`;
}

function cardTile(c) {
  const card = findCard(c.name);
  const qty = `<span class="qty">×${c.qty}</span>`;
  if (!card) return `<div class="tile missing">${qty}<span>${esc(c.name)}</span></div>`;
  const size = card.file.match(/-(\d+)x(\d+)\./);
  const wide = size && +size[1] > +size[2];
  return `<button class="tile${wide ? ' wide' : ''}" data-a="zoom" data-file="${card.file}" aria-label="${c.qty} ${esc(card.name)}">
    ${qty}<img src="${cardUrl(card.file, 300)}" alt="${esc(card.name)}" loading="lazy"></button>`;
}

function viewDeck() {
  const cur = latest(legend(view.lid));
  if (view.editing) {
    return bar('<h1>Decklist</h1>', 'back-guide') +
      `<p class="muted">Optional. It lets you pick ins and outs without retyping card names.</p>
       <label for="deck">One card per line, sideboard under a "Sideboard" line</label>
       <textarea id="deck" data-f="text" style="min-height:300px" placeholder="Legend:&#10;1 Kai'Sa, Daughter of the Void&#10;MainDeck:&#10;3 Falling Star&#10;3 Stupefy&#10;…&#10;Sideboard:&#10;2 Hextech Ray&#10;1 Rune Prison">${esc(view.text)}</textarea>
       <p id="totals" class="muted" style="margin-top:8px">${deckSummary(parseDeck(view.text))}</p>
       <div class="actions"><button data-a="${view.saved ? 'deck' : 'back-guide'}">Cancel</button><button class="primary" data-a="save-deck">Save</button>
         ${view.saved ? `<button class="wide" data-a="save-deck-new">Save as v${cur.n + 1} and keep v${cur.n} as is</button>` : ''}</div>`;
  }
  const sections = parseDeck(view.text).sections.map(s =>
    `<h2>${esc(s.title)} · ${total(s.cards)}</h2><div class="tiles">${s.cards.map(cardTile).join('')}</div>`).join('');
  return bar('<h1>Decklist</h1>', 'back-guide', `<button class="pill" data-a="edit-deck">Edit list</button>`) + sections;
}

const deckSummary = p => `Main deck: ${total(p.main)} cards · Sideboard: ${total(p.side)} cards`;

function importPreview() {
  const mus = parseGuide(view.text);
  if (!mus.length) return '<p class="muted">The preview shows up here.</p>';
  const block = (p, label) => `<p style="margin-top:10px">${label ? `<strong>${label}</strong> ` : ''}<span class="count${total(p.outs) !== total(p.ins) ? ' bad' : ''}">${total(p.outs)} out · ${total(p.ins)} in</span></p>
      <div class="cols"><div class="side out"><h3>Out</h3>${cardList(p.outs)}</div><div class="side in"><h3>In</h3>${cardList(p.ins)}</div></div>`;
  return mus.map(m => `<div class="mu"><div class="mu-body" style="border:0;padding-top:10px">
      <div style="display:flex;align-items:center;gap:10px">${avatar(m.opponent, true)}<span class="name" style="font-size:18px;font-weight:600">${esc(m.opponent)}</span></div>
      ${m.second ? block(m, 'Going 1st') + block(m.second, 'Going 2nd') : block(m, '')}
      ${m.note ? `<p class="note">${esc(m.note)}</p>` : ''}</div></div>`).join('');
}

function viewImport() {
  return bar('<h1>Import guide</h1>', 'back-guide') +
    `<label for="imp">Paste your guide</label>
     <textarea id="imp" data-f="text" style="min-height:200px" placeholder="vs Viktor&#10;OUT: 2 Falling Star, 1 Stupefy&#10;IN: 2 Hextech Ray, 1 Rune Prison&#10;&#10;vs Jinx&#10;-2 Stupefy&#10;+2 Rune Prison">${esc(view.text)}</textarea>
     <h2>Preview</h2><div id="preview">${importPreview()}</div>
     <p class="muted">A matchup that already exists under the same name is replaced.</p>
     <div class="actions"><button data-a="back-guide">Cancel</button><button class="primary" data-a="do-import">Import</button></div>`;
}

function viewBackup() {
  return bar('<h1>Backup</h1>', 'home') +
    `<p class="muted">Your guides live on this device only. A backup file keeps them safe and moves them to another device.</p>
     <button class="block primary" data-a="export">Back up all guides</button>
     <p class="muted" style="margin-top:8px">${backupStatus()}. Keep the file somewhere safe, like iCloud Drive or Google Drive.</p>
     <h2>Restore</h2>
     <label class="btn file">Restore from a backup file<input type="file" accept=".json,application/json" data-c="restore-file" hidden></label>
     ${view.err ? `<p class="err">${esc(view.err)}</p>` : ''}
     <p class="muted" style="margin-top:8px">Restoring replaces all the guides on this device.</p>`;
}

// ---------- add to home screen ----------

const INSTALL = {
  'ios-safari': ['Safari on iPhone or iPad', [
    'Tap the Share button, the square with an arrow pointing up, in the toolbar.',
    'Scroll down the list and tap <b>Add to Home Screen</b>.',
    'Tap <b>Add</b> in the top right corner.']],
  'ios-other': ['Chrome, Firefox or Edge on iPhone or iPad', [
    'Tap the Share button. It sits in the address bar, or inside the ☰ or ⋯ menu.',
    'Tap <b>Add to Home Screen</b>.',
    'Tap <b>Add</b>.',
    "No such option? Open this page in Safari and do it from there."]],
  'android-chrome': ['Chrome on Android', [
    'Tap the ⋮ menu in the top right corner.',
    'Tap <b>Add to Home screen</b>, sometimes shown as <b>Install app</b>.',
    'Tap <b>Install</b> or <b>Add</b>.']],
  samsung: ['Samsung Internet', [
    'Tap the ☰ menu in the bottom right corner.',
    'Tap <b>Add to</b>, sometimes shown as <b>Add page to</b>.',
    'Pick <b>Home screen</b>, then tap <b>Add</b>.']],
  'android-firefox': ['Firefox on Android', [
    'Tap the ⋮ menu.',
    'Tap <b>Add to Home screen</b>.',
    'Tap <b>Add</b>.']],
  desktop: ['Chrome or Edge on a computer', [
    'Click the install icon at the right end of the address bar, a screen with a down arrow.',
    'No icon? Open the ⋮ menu, then <b>Cast, save and share</b> or <b>Apps</b>, then <b>Install</b>.',
    'Click <b>Install</b>.']],
};

function browserKey() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : /Firefox/.test(ua) ? 'android-firefox' : 'android-chrome';
  return 'desktop';
}

const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// Chrome and Edge can show their own install dialog; they announce it with this event.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  if (view.name === 'install') render();
});

function viewInstall() {
  const mine = browserKey();
  const steps = k => `<ol class="steps">${INSTALL[k][1].map(s => `<li>${s}</li>`).join('')}</ol>`;
  const others = Object.keys(INSTALL).filter(k => k !== mine).map(k =>
    `<details class="mu"><summary class="mu-head"><span class="grow">${INSTALL[k][0]}</span></summary><div class="mu-body">${steps(k)}</div></details>`).join('');
  return bar('<h1>Add to home screen</h1>', 'home') +
    `<p class="muted">Get an app icon on your phone: it opens full screen, straight to your guides, and works offline.</p>
     ${mine.startsWith('ios') ? '<p class="nudge-note">Then build your guides in the app you open from the icon, not here in the browser: on iPhone the two keep separate data.</p>' : ''}
     ${installPrompt ? '<button class="block primary" data-a="install-now">Install now</button>' : ''}
     <h2>Your browser: ${INSTALL[mine][0]}</h2>
     <div class="mu"><div class="mu-body" style="border:0">${steps(mine)}</div></div>
     <h2>Other browsers</h2>${others}`;
}

const views = { install: viewInstall, home: viewHome, guide: viewGuide, edit: viewEdit, versions: viewVersions, deck: viewDeck, import: viewImport, backup: viewBackup };

function render() {
  const zoom = view.zoom ? `<button class="zoom" data-a="unzoom" aria-label="Close card"><img src="${cardUrl(view.zoom, 744)}" alt=""></button>` : '';
  app.innerHTML = views[view.name]() + zoom;
}

function go(v) {
  view = v;
  render();
  window.scrollTo(0, 0);
}

const goGuide = (lid, vid, plan = 'first') => go({ name: 'guide', lid, vid, plan, open: new Set() });

// ---------- actions ----------

function bump(side, name, delta) {
  const plan = editPlan();
  const list = plan[side];
  const pool = side === 'outs' ? view.deck.main : view.deck.side;
  const max = (pool.find(c => c.name === name) || {}).qty;
  let card = list.find(c => c.name === name);
  if (!card) { card = { qty: 0, name }; list.push(card); }
  card.qty = Math.max(0, card.qty + delta);
  if (max !== undefined) card.qty = Math.min(max, card.qty);
  plan[side] = list.filter(c => c.qty > 0);
  render();
}

const actions = {
  home: () => go({ name: 'home' }),
  install: () => go({ name: 'install' }),
  'skip-nudge'() { localStorage.setItem(KEY + '-nudge', 'off'); render(); },
  'install-now'() {
    installPrompt.prompt();
    installPrompt = null;
    render();
  },
  add: () => { view.adding = true; render(); document.getElementById('lname').focus(); },
  'cancel-add': () => go({ name: 'home' }),
  pick(el) {
    if (el.dataset.field === 'lname') view.lname = el.dataset.name;
    else view.draft.opponent = el.dataset.name;
    view.err = '';
    render();
  },
  create() {
    const name = canon(view.lname || '');
    if (!name) { view.err = 'Enter a legend name.'; return render(); }
    const l = { id: uid(), name, opened: Date.now(), versions: [{ id: uid(), n: 1, date: today(), note: '', deck: null, deckText: '', matchups: [] }] };
    db.legends.push(l);
    save();
    goGuide(l.id);
  },
  open(el) {
    const l = legend(el.dataset.id);
    l.opened = Date.now();
    save(false);
    goGuide(l.id);
  },
  'back-guide': () => goGuide(view.lid, undefined, view.guidePlan),
  plan(el) { view.plan = el.dataset.plan; render(); },
  'edit-plan'(el) { view.plan = el.dataset.plan; render(); },
  'toggle-second'() {
    const d = view.draft;
    if (d.second) {
      d.second = null;
      view.plan = 'first';
    } else {
      d.second = { outs: clone(d.outs), ins: clone(d.ins) };
      view.texts.second = { ...view.texts.first };
      view.plan = 'second';
    }
    render();
  },
  toggle(el) {
    const id = el.dataset.id;
    view.open.has(id) ? view.open.delete(id) : view.open.add(id);
    render();
  },
  'new-mu': () => openEdit(null),
  edit: el => openEdit(el.dataset.id),
  inc: el => bump(el.dataset.side, el.dataset.card, 1),
  dec: el => bump(el.dataset.side, el.dataset.card, -1),
  'save-mu'() {
    const d = view.draft;
    d.opponent = canon(d.opponent);
    if (!d.opponent) { view.err = 'Enter the opposing legend.'; return render(); }
    if (!view.deck) {
      const t = view.texts;
      d.outs = parseCards(t.first.outs); d.ins = parseCards(t.first.ins);
      if (d.second) d.second = { outs: parseCards(t.second.outs), ins: parseCards(t.second.ins) };
    }
    const v = latest(legend(view.lid));
    const i = v.matchups.findIndex(m => m.id === d.id);
    if (i >= 0) v.matchups[i] = d; else v.matchups.push(d);
    save();
    go({ name: 'guide', lid: view.lid, plan: view.guidePlan, open: new Set([d.id]) });
  },
  'del-mu'() {
    const v = latest(legend(view.lid));
    v.matchups = v.matchups.filter(m => m.id !== view.draft.id);
    save();
    goGuide(view.lid);
  },
  versions: () => go({ name: 'versions', lid: view.lid }),
  pdf() {
    const l = legend(view.lid), v = latest(l);
    const name = `${l.name.replace(/[^\p{L}\p{N}]+/gu, '')}-sideboard-v${v.n}.pdf`;
    giveFile(new File([guidePdf(l, v)], name, { type: 'application/pdf' }));
  },
  settings() {
    go({ name: 'versions', lid: view.lid });
    document.getElementById('legend-settings').scrollIntoView();
  },
  'show-version': el => goGuide(view.lid, el.dataset.id),
  'new-version'() {
    const l = legend(view.lid);
    const v = clone(latest(l));
    Object.assign(v, { id: uid(), n: v.n + 1, date: today(), set: setAt(today()).id, title: (view.vnote || '').trim() });
    l.versions.push(v);
    save();
    goGuide(l.id);
  },
  'del-version'(el) {
    const id = el.dataset.id;
    if (view.confirmVer !== id) { view.confirmVer = id; return render(); }
    const l = legend(view.lid);
    if (l.versions.length > 1) l.versions = l.versions.filter(v => v.id !== id);
    save();
    view.confirmVer = null;
    render();
  },
  archive() {
    const l = legend(view.lid);
    l.archived = !l.archived;
    save();
    go({ name: 'home' });
  },
  unarchive(el) {
    legend(el.dataset.id).archived = false;
    save();
    render();
  },
  'toggle-archived'() { view.showArchived = !view.showArchived; render(); },
  'del-legend'() {
    if (!view.confirmDel) { view.confirmDel = true; return render(); }
    db.legends = db.legends.filter(l => l.id !== view.lid);
    save();
    go({ name: 'home' });
  },
  deck() {
    const v = latest(legend(view.lid));
    go({ name: 'deck', lid: view.lid, text: v.deckText || '', saved: !!v.deck, editing: !v.deck });
  },
  'edit-deck'() { view.editing = true; render(); },
  zoom(el) { view.zoom = el.dataset.file; render(); },
  'toggle-pics'() { localStorage.setItem(PICS_KEY, showPics() ? 'off' : 'on'); render(); },
  unzoom() { view.zoom = null; render(); },
  'save-deck-new'() {
    const l = legend(view.lid);
    const v = clone(latest(l));
    Object.assign(v, { id: uid(), n: v.n + 1, date: today(), set: setAt(today()).id });
    l.versions.push(v);
    actions['save-deck']();
  },
  'save-deck'() {
    const v = latest(legend(view.lid));
    const p = parseDeck(view.text);
    v.deckText = view.text;
    v.deck = p.main.length || p.side.length ? { main: p.main, side: p.side } : null;
    save();
    if (v.deck) actions.deck(); else goGuide(view.lid);
  },
  import: () => go({ name: 'import', lid: view.lid, text: '' }),
  'do-import'() {
    const v = latest(legend(view.lid));
    for (const m of parseGuide(view.text)) {
      const i = v.matchups.findIndex(x => norm(x.opponent) === norm(m.opponent));
      if (i >= 0) v.matchups[i] = m; else v.matchups.push(m);
    }
    save();
    goGuide(view.lid);
  },
  backup: () => go({ name: 'backup' }),
  async export() {
    const file = new File([JSON.stringify(db, null, 2)], `sideboard-backup-${today()}.json`, { type: 'application/json' });
    if (!await giveFile(file)) return;
    localStorage.setItem(KEY + '-backup', today());
    localStorage.removeItem(KEY + '-dirty');
    render();
  },
};

function openEdit(mid) {
  const v = latest(legend(view.lid));
  const m = mid && v.matchups.find(x => x.id === mid);
  const draft = m ? clone(m) : { id: uid(), opponent: '', outs: [], ins: [], second: null, note: '' };
  const text = p => ({ outs: cardsText(p ? p.outs : []), ins: cardsText(p ? p.ins : []) });
  go({
    name: 'edit', lid: view.lid, isNew: !m, draft, deck: v.deck,
    plan: view.plan, guidePlan: view.plan,
    texts: { first: text(draft), second: text(draft.second) },
  });
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && actions[el.dataset.a]) actions[el.dataset.a](el);
});

// Text inputs update state without re-rendering, so focus and caret stay put.
document.addEventListener('change', e => {
  const field = e.target.dataset.c;
  if (field === 'restore-file' && e.target.files[0]) return e.target.files[0].text().then(restoreFrom);
  if (field !== 'set' && field !== 'title') return;
  legend(view.lid).versions.find(v => v.id === e.target.dataset.id)[field] = e.target.value.trim();
  save();
  if (field === 'set') render();
});

document.addEventListener('input', e => {
  const f = e.target.dataset.f;
  if (!f) return;
  if (view.name === 'edit' && (f === 'opponent' || f === 'note')) view.draft[f] = e.target.value;
  else if (f === 'outsText' || f === 'insText') view.texts[editKey()][f === 'outsText' ? 'outs' : 'ins'] = e.target.value;
  else view[f] = e.target.value;
  const totals = document.getElementById('totals');
  if (view.name === 'edit' && totals) totals.innerHTML = editTotals();
  if (view.name === 'deck' && totals) totals.textContent = deckSummary(parseDeck(view.text));
  if (view.name === 'import') document.getElementById('preview').innerHTML = importPreview();
  if (f === 'lname' || f === 'opponent') document.getElementById('picker').innerHTML = picker(f, e.target.value);
});

// ---------- champion portraits (Data Dragon) ----------

async function loadChamps() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY + '-champs'));
    if (c && c.map) champs = c;
  } catch {}
  try {
    const v = (await (await fetch(`${DDRAGON}/api/versions.json`)).json())[0];
    if (v !== champs.v) {
      const data = (await (await fetch(`${DDRAGON}/cdn/${v}/data/en_US/champion.json`)).json()).data;
      champs = { v, map: {} };
      for (const c of Object.values(data)) champs.map[norm(c.name)] = c.id;
      localStorage.setItem(KEY + '-champs', JSON.stringify(champs));
      if (view.name === 'home' || view.name === 'guide') render();
    }
  } catch {}
}


render();
loadChamps();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js');
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
