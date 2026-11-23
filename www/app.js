"use strict";
// ======================= Utilità comuni =======================
const G = window.Galleria;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const fmtB = b => !b ? '' : b > 1e9 ? (b/1e9).toFixed(2) + ' GB' : (b/1e6).toFixed(1) + ' MB';
const fmtD = t => t ? new Date(t).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
const fmtT = s => s < 60 ? Math.round(s) + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' ore';

function ask(text, yes = 'Conferma') {
  return new Promise(res => {
    const d = document.getElementById('dialog');
    document.getElementById('dlg-text').textContent = text;
    document.getElementById('dlg-yes').textContent = yes;
    d.hidden = false;
    const end = v => { d.hidden = true; res(v); };
    document.getElementById('dlg-yes').onclick = () => end(true);
    document.getElementById('dlg-no').onclick = () => end(false);
  });
}

let bigUrl = null;
async function zoom(p, caption) {
  const m = document.getElementById('modal'), img = document.getElementById('big');
  if (bigUrl) URL.revokeObjectURL(bigUrl), bigUrl = null;
  img.removeAttribute('src');
  document.getElementById('bigcap').textContent = 'Carico…';
  m.style.display = 'flex';
  try {
    bigUrl = URL.createObjectURL(await p.load(2048));
    img.src = bigUrl;
    document.getElementById('bigcap').textContent = caption || [p.name, fmtD(p.date)].filter(Boolean).join(' · ');
  } catch (e) { document.getElementById('bigcap').textContent = 'Non riesco ad aprire la foto.'; }
}
document.getElementById('modal').onclick = () => { document.getElementById('modal').style.display = 'none'; };

// Tocco lungo (per vedere la foto) + tocco normale
function onTap(el, tap, long) {
  let t = null, fired = false, sx = 0, sy = 0;
  el.addEventListener('pointerdown', e => { fired = false; sx = e.clientX; sy = e.clientY; t = setTimeout(() => { fired = true; long(); }, 500); });
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) cancel(); });
  el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointerleave', cancel);
  el.addEventListener('click', e => { if (fired) { e.preventDefault(); return; } if (e.altKey || e.ctrlKey || e.metaKey) long(); else tap(); });
  el.addEventListener('dblclick', long);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

function permissionNote(note) {
  note('warn', G.platform === 'ios'
    ? 'L\'app non ha il permesso di vedere le foto. Apri <i>Impostazioni → Le mie foto → Foto</i> e scegli <i>Accesso completo</i>.'
    : 'L\'app non ha il permesso di vedere le foto. Apri <i>Impostazioni → App → Le mie foto → Autorizzazioni → Foto e video</i> e scegli <i>Consenti sempre / tutte</i>.');
}
function limitedNote(note) {
  note('warn', 'Hai dato accesso solo ad alcune foto: l\'app vede solo quelle. Per analizzarle tutte concedi l\'accesso completo nelle impostazioni del telefono.');
}

// ======================= FOTO SIMILI =======================
(() => {
const $ = id => document.getElementById('s-' + id);
let photos = [], groups = [], page = 0;
const PER_PAGE = 20;

$('pick').onclick = async () => {
  $('msg').innerHTML = '';
  let res;
  try { res = await G.choose(+$('range').value, $('file')); }
  catch (e) { if (e.message === 'permesso') permissionNote(note); else note('warn', 'Errore: ' + esc(e.message)); return; }
  if (!res.items.length) { setStatus(G.isNative ? 'Nessuna foto in questo periodo' : 'Nessuna foto scelta'); return; }
  if (res.limited) limitedNote(note);
  start(res.items);
};

async function start(list) {
  $('intro').style.display = 'none';
  $('pick').disabled = true;
  photos.forEach(p => p.thumb && URL.revokeObjectURL(p.thumb));
  photos = [];
  await G.clearCache(); G.keepAwake(true);
  let done = 0, failed = 0;
  const queue = list.slice();
  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      try { photos.push(await analyse(it)); } catch (e) { failed++; console.warn('Salto', it.name, e); }
      done++;
      if (done % 5 === 0 || done === list.length) { $('prog').style.width = (100 * done / list.length) + '%'; setStatus(`Analizzo ${done} / ${list.length}`); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  G.keepAwake(false);
  $('pick').disabled = false;
  if (failed) note('warn', `${failed} foto non sono state lette (formato non supportato o non scaricata da iCloud) e sono state saltate.`);
  photos.sort((a, b) => (a.date - b.date) || a.path.localeCompare(b.path));
  photos.forEach((p, i) => p.idx = i);
  $('tools').hidden = false; $('actions').hidden = false;
  regroup();
}

async function analyse(it) {
  const blob = await it.load(360);
  const date = it.date || (it.file && ((await exifDate(it.file)) || it.file.lastModified)) || 0;
  const bmp = await createImageBitmap(blob);
  const w = it.w || bmp.width, h = it.h || bmp.height;
  const s = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
  const tw = Math.max(1, Math.round(bmp.width * s)), th = Math.max(1, Math.round(bmp.height * s));
  const tc = new OffscreenCanvas(tw, th), tx = tc.getContext('2d');
  tx.imageSmoothingQuality = 'high'; tx.drawImage(bmp, 0, 0, tw, th);
  bmp.close();
  const thumb = URL.createObjectURL(await tc.convertToBlob({ type: 'image/jpeg', quality: .75 }));
  // nitidezza: varianza del laplaciano
  const td = tx.getImageData(0, 0, tw, th).data;
  const g = new Float32Array(tw * th);
  for (let i = 0; i < g.length; i++) g[i] = .299 * td[4*i] + .587 * td[4*i+1] + .114 * td[4*i+2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < th - 1; y++) for (let x = 1; x < tw - 1; x++) {
    const i = y * tw + x, l = 4 * g[i] - g[i-1] - g[i+1] - g[i-tw] - g[i+tw];
    sum += l; sum2 += l * l; n++;
  }
  const sharp = n ? sum2 / n - (sum / n) ** 2 : 0;
  // dHash 64 bit
  const hc = new OffscreenCanvas(9, 8), hx = hc.getContext('2d');
  hx.imageSmoothingQuality = 'high'; hx.drawImage(tc, 0, 0, 9, 8);
  const hd = hx.getImageData(0, 0, 9, 8).data;
  const gr = []; for (let i = 0; i < 72; i++) gr.push(.299 * hd[4*i] + .587 * hd[4*i+1] + .114 * hd[4*i+2]);
  let hi = 0, lo = 0, bit = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++, bit++) {
    if (gr[y*9 + x] > gr[y*9 + x + 1]) { if (bit < 32) hi |= (1 << bit); else lo |= (1 << (bit - 32)); }
  }
  // istogramma colori 4x4x4
  const cc = new OffscreenCanvas(32, 32), cx = cc.getContext('2d');
  cx.drawImage(tc, 0, 0, 32, 32);
  const cd = cx.getImageData(0, 0, 32, 32).data, hist = new Float32Array(64);
  for (let i = 0; i < cd.length; i += 4) hist[(cd[i] >> 6) * 16 + (cd[i+1] >> 6) * 4 + (cd[i+2] >> 6)]++;
  for (let i = 0; i < 64; i++) hist[i] /= 1024;
  return { ...it, date, w, h, hash: [hi >>> 0, lo >>> 0], hist, sharp, thumb, keep: false };
}

function pop(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
function ham(a, b) { return pop(a.hash[0] ^ b.hash[0]) + pop(a.hash[1] ^ b.hash[1]); }
function histSim(a, b) { let s = 0; for (let i = 0; i < 64; i++) s += Math.min(a.hist[i], b.hist[i]); return s; }

function regroup() {
  const T = +$('thr').value, nearOnly = $('nearOnly').checked;
  $('thrv').textContent = T;
  const WINDOW = 30 * 60 * 1000;
  // distanza tra due foto, oppure -1 se non sono abbastanza simili
  const dist = (a, b) => {
    const dt = Math.abs(b.date - a.date);
    if (nearOnly && dt > WINDOW) return -1;
    const lim = T + (dt < 60 * 1000 ? 4 : 0);
    const d = ham(a, b);
    return d <= lim && histSim(a, b) >= 0.6 ? d : -1;
  };
  // Complete linkage: una foto entra in un gruppo solo se somiglia a TUTTE le foto del gruppo;
  // se può entrare in più gruppi, va in quello con la somiglianza media maggiore.
  const all = [], active = [];
  for (const p of photos) {
    if (nearOnly) for (let k = active.length - 1; k >= 0; k--) if (p.date - active[k].last > WINDOW) active.splice(k, 1);
    let best = null, bestAvg = Infinity;
    for (const g of active) {
      let sum = 0, ok = true;
      for (const q of g.items) { const d = dist(q, p); if (d < 0) { ok = false; break; } sum += d; }
      if (ok && sum / g.items.length < bestAvg) { bestAvg = sum / g.items.length; best = g; }
    }
    if (best) { best.items.push(p); best.last = p.date; }
    else { const g = { items: [p], last: p.date }; all.push(g); active.push(g); }
  }
  groups = all.map(g => g.items).filter(g => g.length > 1);
  photos.forEach(p => p.keep = true);
  for (const g of groups) { g.forEach(p => p.keep = false); g.reduce((a, b) => (score(b) > score(a) ? b : a)).keep = true; }
  page = 0;
  render();
}
function score(p) { return Math.log(1 + p.sharp) + 0.15 * Math.log(p.w * p.h); }

function render() {
  const drop = photos.filter(p => !p.keep);
  const bytes = drop.reduce((s, p) => s + (p.size || 0), 0);
  setStatus(`${photos.length} foto · ${groups.length} gruppi · ${drop.length} da scartare${bytes ? ' (' + fmtB(bytes) + ')' : ''}`);
  $('apply').disabled = !drop.length;
  $('apply').textContent = drop.length ? `Sposta ${drop.length} scartate nel cestino` : 'Sposta scartate nel cestino';
  const box = $('groups'); box.innerHTML = '';
  if (!groups.length) { box.innerHTML = '<div class="box">Nessun gruppo di foto simili con questa sensibilità. Prova ad alzarla.</div>'; $('pager').innerHTML = ''; return; }
  const pages = Math.ceil(groups.length / PER_PAGE);
  for (const [gi, g] of groups.slice(page * PER_PAGE, (page + 1) * PER_PAGE).entries()) {
    const el = document.createElement('div'); el.className = 'group';
    const gsz = g.filter(p => !p.keep).reduce((s, p) => s + (p.size || 0), 0);
    el.innerHTML = `<div class="ghead"><span>Gruppo ${page * PER_PAGE + gi + 1} · ${g.length} foto · ${fmtD(g[0].date)}${gsz ? ' · libera ' + fmtB(gsz) : ''}</span>
      <span><button data-a="all">Tieni tutte</button> <button data-a="best">Solo la proposta</button></span></div><div class="thumbs"></div>`;
    const th = el.querySelector('.thumbs');
    for (const p of g) {
      const d = document.createElement('div'); d.className = 'ph' + (p.keep ? ' keep' : '');
      d.innerHTML = `<img loading="lazy" src="${p.thumb}"><span class="tag">${p.keep ? 'TIENI' : 'SCARTA'}</span><button class="zoom" aria-label="Vedi grande">🔍</button>
        <div class="meta">${p.w}×${p.h}${p.size ? ' · ' + fmtB(p.size) : ''}</div>`;
      d.onclick = e => { if (e.target.classList.contains('zoom')) { zoom(p); return; } p.keep = !p.keep; render(); };
      th.appendChild(d);
    }
    el.querySelector('[data-a=all]').onclick = () => { g.forEach(p => p.keep = true); render(); };
    el.querySelector('[data-a=best]').onclick = () => { const b = g.reduce((a, c) => score(c) > score(a) ? c : a); g.forEach(p => p.keep = p === b); render(); };
    box.appendChild(el);
  }
  const pg = $('pager'); pg.innerHTML = '';
  if (pages > 1) {
    const prev = document.createElement('button'); prev.textContent = '‹ Indietro'; prev.disabled = page === 0; prev.onclick = () => { page--; render(); scrollTo(0, 0); };
    const next = document.createElement('button'); next.textContent = 'Avanti ›'; next.disabled = page >= pages - 1; next.onclick = () => { page++; render(); scrollTo(0, 0); };
    const s = document.createElement('span'); s.className = 'muted'; s.textContent = `Pagina ${page + 1} di ${pages}`;
    pg.append(prev, s, next);
  }
}
function setStatus(t) { $('status').textContent = t; }
function note(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; $('msg').appendChild(d); }

$('thr').oninput = () => { $('thrv').textContent = $('thr').value; };
$('thr').onchange = () => photos.length && regroup();
$('nearOnly').onchange = () => photos.length && regroup();
$('thrv').textContent = $('thr').value;

$('apply').onclick = async () => {
  const drop = photos.filter(p => !p.keep);
  if (!drop.length) return;
  if (!G.isNative) { note('warn', 'Lo spostamento nel cestino funziona solo nell\'app installata sul telefono.'); return; }
  const where = G.platform === 'ios' ? 'in "Eliminati di recente"' : 'nel cestino';
  if (!await ask(`Spostare ${drop.length} foto ${where}?\nPotrai recuperarle per circa 30 giorni.`, 'Sposta')) return;
  $('apply').disabled = true;
  setStatus('Il telefono chiede conferma…');
  try {
    const ok = await G.trash(drop);
    if (!ok) { note('warn', 'Operazione annullata: nessuna foto spostata.'); render(); return; }
    const gone = new Set(drop);
    drop.forEach(p => p.thumb && URL.revokeObjectURL(p.thumb));
    photos = photos.filter(p => !gone.has(p));
    note('done', `Spostate <b>${drop.length}</b> foto ${where}. Se cambi idea le trovi lì per circa 30 giorni.`);
    regroup();
  } catch (e) { note('warn', 'Non sono riuscita a spostare le foto: ' + esc(e.message)); render(); }
};

// Data di scatto (solo per la prova nel browser: sul telefono arriva già dalla galleria)
async function exifDate(file) {
  if (!/\.jpe?g$/i.test(file.name) && file.type !== 'image/jpeg') return null;
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const mk = buf.getUint16(off), len = buf.getUint16(off + 2);
      if (mk === 0xFFE1 && buf.getUint32(off + 4) === 0x45786966) {
        const t = off + 10, le = buf.getUint16(t) === 0x4949;
        const u16 = o => buf.getUint16(t + o, le), u32 = o => buf.getUint32(t + o, le);
        const readTag = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return -1; };
        const ascii = (o, l) => { let s = ''; for (let i = 0; i < l; i++) s += String.fromCharCode(buf.getUint8(o + i)); return s; };
        const ifd0 = u32(4);
        let e = readTag(ifd0, 0x8769), str = null;
        if (e >= 0) { const sub = u32(e + 8); const d = readTag(sub, 0x9003); if (d >= 0) str = ascii(t + u32(d + 8), 19); }
        if (!str) { const d = readTag(ifd0, 0x0132); if (d >= 0) str = ascii(t + u32(d + 8), 19); }
        if (!str) return null;
        const m = str.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
      }
      if ((mk & 0xFF00) !== 0xFF00) return null;
      off += 2 + len;
    }
  } catch (e) {}
  return null;
}
})();

// ======================= PERSONE E ANIMALI =======================
(() => {
const $ = id => document.getElementById('c-' + id);
const KNOWN_KEY = 'persone-riconosciute-v1';
let human, ready = false, stopFlag = false, busy = false;
let photos = [];   // {..item, pet, petEx, petThumb}
let faces = [];    // {photo, emb, thumb, excluded}
let clusters = []; // {faces, name, cent}
let known = [];    // {name, emb}
let showAll = new Set();
let petsChoice = { on: true, name: 'Gatti' };

const config = {
  modelBasePath: new URL('models/', location.href).href, backend: 'webgl', debug: false, cacheModels: false, warmup: 'none', async: true,
  filter: { enabled: false },
  face: { enabled: true,
    detector: { modelPath: 'blazeface.json', rotation: true, maxDetected: 25, minConfidence: 0.5, skipFrames: 0, skipTime: 0 },
    mesh: { enabled: true, modelPath: 'facemesh.json' },
    attention: { enabled: false }, iris: { enabled: false }, emotion: { enabled: false },
    description: { enabled: true, modelPath: 'faceres.json', skipFrames: 0, skipTime: 0 },
    antispoof: { enabled: false }, liveness: { enabled: false }, gear: { enabled: false } },
  body: { enabled: false }, hand: { enabled: false }, gesture: { enabled: false }, segmentation: { enabled: false },
  object: { enabled: true, modelPath: 'nanodet.json', minConfidence: 0.2, maxDetected: 10, skipFrames: 0, skipTime: 0 },
};

window.__initCls = async () => {
  loadKnown();
  try {
    human = new Human.Human(config);
    await human.load();
    ready = true; setStatus('Pronta. Scegli le foto.');
  } catch (e) {
    console.error(e); setStatus('Errore nel caricamento dei modelli: ' + e.message);
    note('warn', 'Non riesco ad avviare il riconoscimento su questo telefono.');
  }
};

$('pick').onclick = async () => {
  if (!ready) { note('warn', 'Attendi qualche secondo: sto ancora caricando i modelli di riconoscimento.'); return; }
  $('msg').innerHTML = '';
  let res;
  try { res = await G.choose(+$('range').value, $('file')); }
  catch (e) { if (e.message === 'permesso') permissionNote(note); else note('warn', 'Errore: ' + esc(e.message)); return; }
  if (!res.items.length) { setStatus(G.isNative ? 'Nessuna foto in questo periodo.' : 'Nessuna foto scelta.'); return; }
  if (res.limited) limitedNote(note);
  $('intro').style.display = 'none';
  analyse(res.items);
};
$('stop').onclick = () => { stopFlag = true; };

async function analyse(list) {
  photos = []; faces = []; clusters = []; stopFlag = false; showAll.clear(); busy = true;
  $('pick').disabled = true; $('stop').disabled = false; $('work').style.display = ''; $('actions').hidden = false;
  await G.clearCache(); G.keepAwake(true);
  updateButtons();
  const t0 = performance.now();
  let failed = 0;
  for (let i = 0; i < list.length && !stopFlag; i++) {
    const it = list[i];
    try { await analyseOne(it); } catch (e) { failed++; console.warn('Salto', it.name, e); }
    const el = (performance.now() - t0) / 1000, rem = el / (i + 1) * (list.length - i - 1);
    $('prog').style.width = (100 * (i + 1) / list.length) + '%';
    setStatus(`Analizzo ${i + 1} / ${list.length} · ${faces.length} volti · mancano circa ${fmtT(rem)}`);
    if ((i + 1) % 25 === 0) { cluster(); renderAll(); }
  }
  G.keepAwake(false); busy = false;
  $('pick').disabled = false; $('stop').disabled = true;
  setStatus(`Fatto: ${photos.length} foto · ${faces.length} volti · ${photos.filter(p => p.pet).length} con animali`);
  if (stopFlag) note('warn', `Analisi interrotta: considerate ${photos.length} foto su ${list.length}.`);
  if (failed) note('warn', `${failed} foto non sono state lette e sono state saltate.`);
  cluster(); renderAll();
}

async function analyseOne(it) {
  const bmp = await createImageBitmap(await it.load(1280));
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, w, h); bmp.close();
  const res = await human.detect(cv);
  const ph = { ...it, pet: false, petEx: false, petThumb: null };
  const objs = res.object || [];
  const petBoxes = objs.filter(o => (o.label === 'cat' || o.label === 'dog') && o.score >= 0.3).map(o => o.box);
  const personBoxes = objs.filter(o => o.label === 'person' && o.score >= 0.3).map(o => o.box);
  const inside = (b, x, y) => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];
  if (petBoxes.length) { ph.pet = true; ph.petThumb = await crop(cv, [0, 0, w, h], 220, 0); }
  for (const f of res.face || []) {
    const [bx, by, bw, bh] = f.box;
    const fx = bx + bw / 2, fy = by + bh / 2;
    if (petBoxes.some(b => inside(b, fx, fy)) && !personBoxes.some(b => inside(b, fx, fy))) continue; // muso di animale
    if (!f.embedding || f.embedding.length < 10) continue;
    if (bw < 48 || bh < 48 || (f.faceScore ?? f.score) < 0.6) continue;
    faces.push({ photo: ph, emb: norm(Float32Array.from(f.embedding)), thumb: await crop(cv, f.box, 120, 0.25), excluded: false });
  }
  photos.push(ph);
}
async function crop(cv, box, size, pad) {
  let [x, y, w, h] = box; const p = Math.max(w, h) * pad, side = Math.max(w, h) + 2 * p;
  x = x + w / 2 - side / 2; y = y + h / 2 - side / 2;
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#ddd'; g.fillRect(0, 0, size, size);
  if (pad === 0 && box[0] === 0) { const m = Math.min(w, h); g.drawImage(cv, (w - m) / 2, (h - m) / 2, m, m, 0, 0, size, size); }
  else g.drawImage(cv, x, y, side, side, 0, 0, size, size);
  return URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: .8 }));
}
function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }
function cos(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

function cluster() {
  const T = +$('thr').value / 100;
  const oldNames = new Map();
  for (const c of clusters) if (c.name) for (const f of c.faces) oldNames.set(f, c.name);
  const cl = [];
  for (const f of faces) {
    if (f.excluded) continue;
    let best = null, bs = -1;
    for (const c of cl) { const s = cos(f.emb, c.cent); if (s > bs) { bs = s; best = c; } }
    if (best && bs >= T) { best.faces.push(f); best.sum.forEach((v, i) => best.sum[i] += f.emb[i]); best.cent = norm(Float32Array.from(best.sum)); }
    else cl.push({ faces: [f], sum: Float32Array.from(f.emb), cent: Float32Array.from(f.emb), name: '' });
  }
  for (const c of cl) {
    const votes = {}; for (const f of c.faces) { const n = oldNames.get(f); if (n) votes[n] = (votes[n] || 0) + 1; }
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (top) c.name = top[0];
    else { let bn = '', bs = -1; for (const k of known) { const s = cos(c.cent, k.emb); if (s > bs) { bs = s; bn = k.name; } } if (bs >= T) c.name = bn; }
  }
  cl.sort((a, b) => (!!b.name - !!a.name) || b.faces.length - a.faces.length);
  clusters = cl;
}
$('thr').oninput = () => $('thrv').textContent = $('thr').value;
$('thr').onchange = () => { cluster(); renderAll(); };
$('thrv').textContent = $('thr').value;
$('showSingles').onchange = () => renderAll();

$('tPeople').onclick = () => tab(true); $('tPets').onclick = () => tab(false);
function tab(p) { $('tPeople').classList.toggle('on', p); $('tPets').classList.toggle('on', !p); $('people').style.display = p ? '' : 'none'; $('pets').style.display = p ? 'none' : ''; }

function renderAll() { renderPeople(); renderPets(); updateButtons(); }
function renderPeople() {
  const box = $('people'); box.innerHTML = '';
  const singles = $('showSingles').checked;
  const vis = clusters.filter(c => singles || c.faces.length > 1 || c.name);
  if (!vis.length) { box.innerHTML = '<div class="box">Nessun volto ricorrente trovato (per ora).</div>'; return; }
  const hint = document.createElement('p'); hint.className = 'muted';
  hint.textContent = 'Tocca un volto = escludilo (non è quella persona). Tieni premuto = vedi la foto. Stesso nome su più gruppi = un solo album.';
  box.appendChild(hint);
  for (const c of vis) {
    const el = document.createElement('div'); el.className = 'cl' + (c.name ? ' named' : '');
    const nPhotos = new Set(c.faces.map(f => f.photo)).size;
    el.innerHTML = `<div class="clh"><input type="text" placeholder="Chi è? (scrivi un nome)" list="c-namesList" enterkeyhint="done"><span class="muted">${nPhotos} foto</span></div><div class="faces"></div>`;
    const inp = el.querySelector('input'); inp.value = c.name;
    inp.onchange = () => { c.name = inp.value.trim(); el.classList.toggle('named', !!c.name); updateNamesList(); updateButtons(); };
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    const fb = el.querySelector('.faces');
    const lim = showAll.has(c) ? c.faces.length : 11;
    for (const f of c.faces.slice(0, lim)) {
      const d = document.createElement('div'); d.className = 'face' + (f.excluded ? ' ex' : '');
      d.innerHTML = `<img src="${f.thumb}" alt="">`;
      onTap(d, () => { f.excluded = !f.excluded; d.classList.toggle('ex', f.excluded); updateButtons(); }, () => zoom(f.photo));
      fb.appendChild(d);
    }
    if (c.faces.length > lim) { const m = document.createElement('div'); m.className = 'more'; m.textContent = `+${c.faces.length - lim}`; m.onclick = () => { showAll.add(c); renderPeople(); }; fb.appendChild(m); }
    box.appendChild(el);
  }
  updateNamesList();
}
function updateNamesList() {
  let dl = $('namesList'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'c-namesList'; document.body.appendChild(dl); }
  const names = new Set([...clusters.map(c => c.name), ...known.map(k => k.name)].filter(Boolean));
  dl.innerHTML = [...names].map(n => `<option value="${esc(n)}">`).join('');
}
function renderPets() {
  const box = $('pets'); box.innerHTML = '';
  const list = photos.filter(p => p.pet);
  box.insertAdjacentHTML('beforeend', '<p class="muted">Il riconoscimento trova gatti e cani ma non distingue il singolo animale, e qualche foto può sfuggire (animale piccolo, al buio, di spalle).</p>');
  const el = document.createElement('div'); el.className = 'box';
  el.innerHTML = `<div class="row"><label class="sl"><input type="checkbox" ${petsChoice.on ? 'checked' : ''}> crea album</label>
    <input type="text" value="${esc(petsChoice.name)}" enterkeyhint="done">
    <span class="muted">${list.filter(p => !p.petEx).length} foto con animali</span></div>
    <p class="muted">Tocca una foto per escluderla (non c'è un animale). Tieni premuto per vederla grande.</p><div class="faces big"></div>`;
  const [cb, nm] = el.querySelectorAll('input');
  cb.onchange = () => { petsChoice.on = cb.checked; updateButtons(); };
  nm.onchange = () => { petsChoice.name = nm.value.trim() || 'Gatti'; updateButtons(); };
  const pb = el.querySelector('.faces');
  const lim = showAll.has('pets') ? list.length : 60;
  for (const p of list.slice(0, lim)) {
    const d = document.createElement('div'); d.className = 'face' + (p.petEx ? ' ex' : '');
    d.innerHTML = `<img src="${p.petThumb}" alt="">`;
    onTap(d, () => { p.petEx = !p.petEx; d.classList.toggle('ex', p.petEx); updateButtons(); }, () => zoom(p));
    pb.appendChild(d);
  }
  if (list.length > lim) { const m = document.createElement('div'); m.className = 'more'; m.textContent = `+${list.length - lim}`; m.onclick = () => { showAll.add('pets'); renderPets(); }; pb.appendChild(m); }
  box.appendChild(el);
}
function plan() {
  const map = new Map();
  for (const c of clusters) if (c.name) for (const f of c.faces) if (!f.excluded) { if (!map.has(c.name)) map.set(c.name, new Set()); map.get(c.name).add(f.photo); }
  if (petsChoice.on) { const s = photos.filter(p => p.pet && !p.petEx); if (s.length) map.set(petsChoice.name, new Set([...(map.get(petsChoice.name) || []), ...s])); }
  return map;
}
function updateButtons() {
  const m = plan(); let n = 0; m.forEach(s => n += s.size);
  $('make').disabled = !n || busy; $('make').textContent = n ? `Crea album (${m.size})` : 'Crea album';
  $('saveNames').disabled = !clusters.some(c => c.name);
}

$('make').onclick = async () => {
  const m = plan();
  if (!G.isNative) { note('warn', 'La creazione degli album funziona solo nell\'app installata sul telefono.'); return; }
  const desc = [...m].map(([n, s]) => `• ${n}: ${s.size} foto`).join('\n');
  const how = G.platform === 'ios' ? 'Le foto vengono aggiunte agli album (senza duplicarle).' : 'Le foto vengono copiate nella cartella Immagini/Classificate, una sottocartella per album.';
  if (!await ask(`Creo questi album:\n${desc}\n\n${how} Gli originali non vengono toccati.`, 'Crea')) return;
  $('make').disabled = true;
  let done = 0, ko = 0; const tot = m.size;
  for (const [name, set] of m) {
    try { await G.addToAlbum(safe(name), [...set]); }
    catch (e) { console.warn(name, e); ko++; }
    done++; setStatus(`Album ${done} / ${tot}`); $('prog').style.width = (100 * done / tot) + '%';
  }
  note(ko ? 'warn' : 'done', `Fatto: album pronti (${[...m.keys()].map(esc).join(', ')}).${ko ? ` ${ko} album non riusciti.` : ''} Li trovi nell'app Foto/Galleria.`);
  setStatus('Album creati.'); updateButtons();
};
const safe = s => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Senza nome';

// Persone ricordate (restano solo su questo telefono)
function loadKnown() {
  try { const d = JSON.parse(localStorage.getItem(KNOWN_KEY) || 'null'); known = d ? d.map(p => ({ name: p.name, emb: norm(Float32Array.from(p.emb)) })) : []; }
  catch (e) { known = []; }
  showKnown();
}
function showKnown() {
  $('knownInfo').textContent = known.length ? `Persone ricordate: ${known.map(k => k.name).join(', ')}.` : 'Nessuna persona ricordata.';
  $('forget').hidden = !known.length;
}
$('saveNames').onclick = () => {
  const by = new Map();
  for (const c of clusters) if (c.name) for (const f of c.faces) if (!f.excluded) { if (!by.has(c.name)) by.set(c.name, []); by.get(c.name).push(f.emb); }
  for (const k of known) if (!by.has(k.name)) by.set(k.name, [k.emb]);
  const out = [...by].map(([name, embs]) => { const s = new Float32Array(embs[0].length); embs.forEach(e => e.forEach((v, i) => s[i] += v)); return { name, emb: Array.from(norm(s), v => +v.toFixed(5)) }; });
  localStorage.setItem(KNOWN_KEY, JSON.stringify(out));
  loadKnown();
  note('done', `Ricordate ${known.length} persone. La prossima volta verranno riconosciute da sole.`);
};
$('forget').onclick = async () => {
  if (!await ask('Dimenticare tutte le persone ricordate?', 'Dimentica')) return;
  localStorage.removeItem(KNOWN_KEY); loadKnown();
};

function setStatus(t) { $('status').textContent = t; }
function note(cls, html) { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; $('msg').appendChild(d); }
})();

// ======================= Schede =======================
(() => {
  const sim = document.getElementById('mod-sim'), cls = document.getElementById('mod-cls');
  const bS = document.getElementById('navSim'), bC = document.getElementById('navCls');
  let started = false;
  bS.onclick = () => { sim.style.display = ''; cls.style.display = 'none'; bS.classList.add('on'); bC.classList.remove('on'); scrollTo(0, 0); };
  bC.onclick = () => { sim.style.display = 'none'; cls.style.display = ''; bC.classList.add('on'); bS.classList.remove('on'); scrollTo(0, 0);
    if (!started) { started = true; setTimeout(() => window.__initCls(), 30); } };
})();
