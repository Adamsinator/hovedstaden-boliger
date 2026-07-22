'use strict';

/* ===================== state & helpers ===================== */
const S = {
  meta: null, geo: null, index: null, history: null,
  all: [], type: 'all', munis: new Set(), nearS: false,
  priceMin: null, priceMax: null, rooms: null, areaMin: null, areaMax: null,
  lotMin: null, floorMin: null, yearMin: null, daysMax: null, energyMin: null,
  hasBasement: false, hasElevator: false, hasBalcony: false,
  search: '', colorBy: 'm2p', sort: 'd', shown: 60,
  A: null, B: null, radA: 3, radB: 3,   // home/work points {name,lat,lon}
  dstArea: '01',
};
const $ = (s, r = document) => r.querySelector(s);
const el = (t, a = {}, ...kids) => {
  const n = document.createElement(t);
  for (const k in a) { if (k === 'class') n.className = a[k]; else if (k === 'html') n.innerHTML = a[k]; else n.setAttribute(k, a[k]); }
  for (const c of kids) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const svel = (t, a = {}) => { const n = document.createElementNS(SVGNS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };

const kr = n => n == null ? '–' : Math.round(n).toLocaleString('da-DK') + ' kr';
const krM = n => n == null ? '–' : (n >= 1e6 ? (n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 2 }) + ' mio. kr'
  : Math.round(n / 1000).toLocaleString('da-DK') + '.000 kr');
const m2 = n => n == null ? '–' : Math.round(n).toLocaleString('da-DK') + ' kr/m²';
const num = n => n == null ? '–' : Math.round(n).toLocaleString('da-DK');
const median = arr => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const quantile = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const p = (a.length - 1) * q, lo = Math.floor(p); return a[lo] + (a[lo + 1] - a[lo] || 0) * (p - lo); };
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371, p = Math.PI / 180;
  const a = 0.5 - Math.cos((la2 - la1) * p) / 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * (1 - Math.cos((lo2 - lo1) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(a)); // km
};
const ENERGY_ORDER = { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1 };
const energyRank = e => { if (!e) return 0; return ENERGY_ORDER[String(e)[0].toLowerCase()] || 0; };
const PRICES = [1e6, 1.5e6, 2e6, 2.5e6, 3e6, 4e6, 5e6, 7.5e6, 10e6, 15e6, 20e6, 30e6];

/* ===================== load ===================== */
async function boot() {
  try {
    const [meta, listings, geo, index, history] = await Promise.all([
      fetch('data/meta.json').then(r => r.json()),
      fetch('data/listings.json').then(r => r.json()),
      fetch('data/geo.json').then(r => r.json()).catch(() => ({})),
      fetch('data/priceindex.json').then(r => r.json()).catch(() => null),
      fetch('data/history.json').then(r => r.json()).catch(() => ({ series: [] })),
    ]);
    S.meta = meta; S.all = listings; S.geo = geo; S.index = index; S.history = history;
    meta.municipalities.forEach(m => S.munis.add(m.slug));
    buildProjection();
    initUI();
    render();
    resetView();
  } catch (e) {
    $('#map').innerHTML = '<div class="loading">Kunne ikke hente data.</div>';
    console.error(e);
  }
}

/* ===================== projection (shared) ===================== */
const P = {};
function buildProjection() {
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  const bump = (lo, la) => { mnx = Math.min(mnx, lo); mxx = Math.max(mxx, lo); mny = Math.min(mny, la); mxy = Math.max(mxy, la); };
  Object.values(S.geo || {}).forEach(g => { const b = g.bbox; bump(b[0], b[1]); bump(b[2], b[3]); });
  (S.meta.stations || []).forEach(s => bump(s.lon, s.lat));
  if (mnx === 1e9) { S.all.forEach(r => bump(r.lon, r.lat)); }
  const padx = (mxx - mnx) * .03, pady = (mxy - mny) * .03;
  mnx -= padx; mxx += padx; mny -= pady; mxy += pady;
  const latMid = (mny + mxy) / 2, kx = Math.cos(latMid * Math.PI / 180);
  const gW = (mxx - mnx) * kx, gH = (mxy - mny);
  P.W = 1000; P.H = Math.round(P.W * gH / gW);
  P.x = lon => (lon - mnx) * kx / gW * P.W;
  P.y = lat => (mxy - lat) / gH * P.H;
  P.kmToUnitsX = km => km / 111.32 * kx / gW * P.W; // approx horizontal
  P.kmToUnitsY = km => km / 110.57 / gH * P.H;
  P.bboxLonLat = { mnx, mny, mxx, mxy };
}

/* ===================== UI ===================== */
function initUI() {
  const upd = new Date(S.meta.generatedAt);
  $('#updated').textContent = 'Opdateret ' + upd.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' · ' + S.meta.total.toLocaleString('da-DK') + ' boliger';
  $('#nearSHint').textContent = '(≤ ' + S.meta.strainNearM + ' m)';

  // price selects
  const fill = (id, label) => { const s = $(id); PRICES.forEach(p => s.append(el('option', { value: p }, krM(p).replace(' kr', '')))); };
  fill('#priceMin'); fill('#priceMax');

  $('#typeSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    S.type = b.dataset.type; S.shown = 60;
    [...e.currentTarget.children].forEach(c => c.classList.toggle('active', c === b));
    render();
  });

  // municipality chips
  const wrap = $('#muniChips');
  const allBtn = el('span', { class: 'chip allbtn on' }, 'Alle kommuner');
  allBtn.addEventListener('click', () => {
    const allOn = S.munis.size === S.meta.municipalities.length;
    S.munis = new Set(allOn ? [] : S.meta.municipalities.map(m => m.slug));
    S.shown = 60; render(); fitToSelection();
  });
  wrap.append(allBtn);
  S.meta.municipalities.forEach(m => {
    const c = el('span', { class: 'chip on' }, m.name);
    c.addEventListener('click', () => {
      if (S.munis.has(m.slug)) S.munis.delete(m.slug); else S.munis.add(m.slug);
      S.shown = 60; render(); fitToSelection();
    });
    c._slug = m.slug; wrap.append(c);
  });

  // filters
  const on = (id, key, isNum) => $(id).addEventListener('change', e => {
    const v = e.target.type === 'checkbox' ? e.target.checked : (e.target.value || null);
    S[key] = isNum && v ? +v : v; S.shown = 60; render();
  });
  on('#priceMin', 'priceMin', 1); on('#priceMax', 'priceMax', 1); on('#rooms', 'rooms', 1);
  on('#areaMin', 'areaMin', 1); on('#areaMax', 'areaMax', 1); on('#lotMin', 'lotMin', 1);
  on('#floorMin', 'floorMin', 1); on('#yearMin', 'yearMin', 1); on('#daysMax', 'daysMax', 1);
  on('#energyMin', 'energyMin'); on('#hasBasement', 'hasBasement'); on('#hasElevator', 'hasElevator');
  on('#hasBalcony', 'hasBalcony'); on('#colorBy', 'colorBy'); on('#sort', 'sort');
  $('#search').addEventListener('input', e => { S.search = e.target.value.toLowerCase().trim(); S.shown = 60; render(); });
  $('#loadMore').addEventListener('click', () => { S.shown += 60; renderCards(filtered()); });
  $('#resetFilters').addEventListener('click', resetFilters);

  // DST area select
  if (S.index) {
    const sel = $('#dstArea');
    S.index.areas.forEach(a => sel.append(el('option', { value: a.id }, a.name)));
    sel.value = S.dstArea;
    sel.addEventListener('change', e => { S.dstArea = e.target.value; renderIndexChart(); });
  }
  $('#trendMetric').addEventListener('change', renderTrendChart);

  // map zoom buttons
  $('#zoomIn').addEventListener('click', () => zoomBy(0.7));
  $('#zoomOut').addEventListener('click', () => zoomBy(1 / 0.7));
  $('#zoomReset').addEventListener('click', resetView);

  // home / work geocoding
  setupGeo('A'); setupGeo('B');
  $('#radA').addEventListener('input', e => { S.radA = +e.target.value; $('#radAVal').textContent = e.target.value; render(); });
  $('#radB').addEventListener('input', e => { S.radB = +e.target.value; $('#radBVal').textContent = e.target.value; render(); });

  // theme
  const tt = $('#themeToggle');
  const saved = localStorage.getItem('hbTheme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  tt.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    localStorage.setItem('hbTheme', dark ? 'light' : 'dark');
    render();
  });
}

function resetFilters() {
  Object.assign(S, { priceMin: null, priceMax: null, rooms: null, areaMin: null, areaMax: null, lotMin: null,
    floorMin: null, yearMin: null, daysMax: null, energyMin: null, hasBasement: false, hasElevator: false, hasBalcony: false });
  ['#priceMin', '#priceMax', '#rooms', '#areaMin', '#areaMax', '#lotMin', '#floorMin', '#yearMin', '#daysMax', '#energyMin'].forEach(id => $(id).value = '');
  ['#hasBasement', '#hasElevator', '#hasBalcony'].forEach(id => $(id).checked = false);
  S.shown = 60; render();
}
function activeFilterCount() {
  let n = 0;
  ['priceMin', 'priceMax', 'rooms', 'areaMin', 'areaMax', 'lotMin', 'floorMin', 'yearMin', 'daysMax', 'energyMin'].forEach(k => { if (S[k]) n++; });
  ['hasBasement', 'hasElevator', 'hasBalcony'].forEach(k => { if (S[k]) n++; });
  return n;
}

/* ---- DAWA address autocomplete ---- */
function setupGeo(which) {
  const input = $('#addr' + which), sug = $('#sug' + which);
  let items = [], hl = -1, timer;
  const close = () => { sug.classList.remove('show'); sug.innerHTML = ''; hl = -1; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { close(); return; }
    timer = setTimeout(async () => {
      try {
        const url = 'https://api.dataforsyningen.dk/adgangsadresser/autocomplete?per_side=6&q=' + encodeURIComponent(q);
        items = await fetch(url).then(r => r.json());
        sug.innerHTML = '';
        items.forEach((it, i) => {
          const d = el('div', {}, it.tekst);
          d.addEventListener('mousedown', ev => { ev.preventDefault(); pick(i); });
          sug.append(d);
        });
        sug.classList.toggle('show', items.length > 0);
      } catch (e) { close(); }
    }, 220);
  });
  input.addEventListener('keydown', e => {
    if (!sug.classList.contains('show')) return;
    if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); mark(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (hl >= 0) { pick(hl); e.preventDefault(); } }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  const mark = () => [...sug.children].forEach((c, i) => c.classList.toggle('hl', i === hl));
  const pick = i => {
    const it = items[i], a = it.adgangsadresse;
    input.value = it.tekst;
    S[which] = { name: it.tekst, lat: +a.y, lon: +a.x };
    close(); render(); fitToSelection();
  };
}

/* ===================== filtering ===================== */
function filtered() {
  return S.all.filter(r => {
    if (S.type !== 'all' && r.t !== S.type) return false;
    if (!S.munis.has(r.muni)) return false;
    if (S.nearS && !r.near) return false;
    if (S.priceMin && r.p < S.priceMin) return false;
    if (S.priceMax && r.p > S.priceMax) return false;
    if (S.rooms && (r.r || 0) < S.rooms) return false;
    if (S.areaMin && (r.a || 0) < S.areaMin) return false;
    if (S.areaMax && (r.a || 0) > S.areaMax) return false;
    if (S.lotMin && (r.lot || 0) < S.lotMin) return false;          // villa lots
    if (S.floorMin != null && r.t === 'condo' && (r.fln == null || r.fln < S.floorMin)) return false;
    if (S.yearMin && (r.y || 0) < S.yearMin) return false;
    if (S.daysMax && (r.d || 0) > S.daysMax) return false;
    if (S.energyMin && energyRank(r.e) < energyRank(S.energyMin)) return false;
    if (S.hasBasement && !(r.bsm > 0)) return false;
    if (S.hasElevator && !r.elev) return false;
    if (S.hasBalcony && !r.balc) return false;
    if (S.A && haversine(r.lat, r.lon, S.A.lat, S.A.lon) > S.radA) return false;
    if (S.B && haversine(r.lat, r.lon, S.B.lat, S.B.lon) > S.radB) return false;
    if (S.search) {
      const hay = (r.adr + ' ' + r.city + ' ' + r.zip + ' ' + (r.ssn || '')).toLowerCase();
      if (!hay.includes(S.search)) return false;
    }
    return true;
  });
}

/* ===================== master render ===================== */
function render() {
  [...$('#muniChips').children].forEach(c => {
    if (c._slug) c.classList.toggle('on', S.munis.has(c._slug));
    else c.classList.toggle('on', S.munis.size === S.meta.municipalities.length);
  });
  const fc = activeFilterCount();
  $('#filterCount').textContent = fc ? `(${fc} aktive)` : '';
  const f = filtered();
  renderKPIs(f);
  renderMuniChart(f);
  renderDistChart(f);
  renderDaysChart(f);
  renderIndexChart();
  renderTrendChart();
  drawMap(f);
  renderCards(f);
}

/* ===================== KPIs ===================== */
function renderKPIs(f) {
  const prices = f.map(r => r.p).filter(Boolean);
  const m2p = f.map(r => r.m2p).filter(Boolean);
  const days = f.map(r => r.d).filter(v => v != null);
  const cutPct = f.length ? Math.round(f.filter(r => r.chg < 0).length / f.length * 100) : 0;
  const nearPct = f.length ? Math.round(f.filter(r => r.near).length / f.length * 100) : 0;
  const typeLabel = S.type === 'all' ? 'ejerl. + villaer' : (S.type === 'condo' ? 'ejerlejligheder' : 'villaer');
  const kpis = [
    { label: 'Boliger til salg', val: f.length.toLocaleString('da-DK'), sub: typeLabel },
    { label: 'Median pris', val: krM(median(prices)), sub: prices.length ? kr(quantile(prices, .25)) + ' – ' + kr(quantile(prices, .75)) : '' },
    { label: 'Median pris/m²', val: m2(median(m2p)), sub: 'typisk kvadratmeterpris' },
    { label: 'Median liggetid', val: median(days) != null ? Math.round(median(days)) + ' <small>dage</small>' : '–', sub: 'til salg på boligsiden', html: true },
    { label: 'Med prisnedsættelse', val: cutPct + ' <small>%</small>', sub: nearPct + ' % ligger nær S-tog', html: true },
  ];
  const box = $('#kpis'); box.innerHTML = '';
  kpis.forEach(k => box.append(el('div', { class: 'kpi' },
    el('div', { class: 'k-label' }, k.label),
    el('div', { class: 'k-val', html: k.val }),
    el('div', { class: 'k-sub' }, k.sub || ''))));
}

/* ===================== tooltip ===================== */
const TT = $('#tooltip');
function showTip(html, x, y) {
  TT.innerHTML = html; TT.hidden = false;
  const w = TT.offsetWidth, h = TT.offsetHeight;
  TT.style.left = Math.min(x + 14, innerWidth - w - 8) + 'px';
  TT.style.top = Math.max(8, y - h - 12) + 'px';
}
const hideTip = () => { TT.hidden = true; };

/* ===================== horizontal bar chart ===================== */
function hbars(mount, rows, opt = {}) {
  mount.innerHTML = '';
  if (!rows.length) { mount.append(el('div', { class: 'loading' }, 'Ingen data for det valgte filter.')); return; }
  const W = 640, rowH = 26, padL = 132, padR = 62, padT = 6, padB = 4;
  const H = padT + padB + rows.length * rowH;
  const max = Math.max(...rows.map(r => r.value)) * 1.02 || 1;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const plotW = W - padL - padR;
  rows.forEach((r, i) => {
    const y = padT + i * rowH, bw = Math.max(2, r.value / max * plotW);
    const g = svel('g', { class: 'bar-row' });
    const lbl = svel('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-lbl' }); lbl.textContent = r.label; g.append(lbl);
    g.append(svel('rect', { x: padL, y: y + 4, width: bw, height: rowH - 10, rx: 4, fill: r.color || cssVar('--condo') }));
    const val = svel('text', { x: padL + bw + 7, y: y + rowH / 2 + 4, class: 'bar-val' }); val.textContent = opt.fmt ? opt.fmt(r.value) : num(r.value); g.append(val);
    g.addEventListener('mousemove', e => showTip(`<div class="tt-title">${r.label}</div><div class="tt-row"><span>${opt.vlabel || 'Værdi'}</span><b>${opt.fmt ? opt.fmt(r.value) : num(r.value)}</b></div>${r.n != null ? `<div class="tt-row"><span>Antal boliger</span><b>${r.n}</b></div>` : ''}`, e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
    svg.append(g);
  });
  mount.append(svg);
}

function renderMuniChart(f) {
  const byM = new Map();
  f.forEach(r => { (byM.get(r.muni) || byM.set(r.muni, []).get(r.muni)).push(r.m2p); });
  const names = Object.fromEntries(S.meta.municipalities.map(m => [m.slug, m.name]));
  const rows = [...byM.entries()].map(([slug, arr]) => ({ label: names[slug] || slug, value: Math.round(median(arr.filter(Boolean))), n: arr.length, color: cssVar('--condo') }))
    .filter(r => r.value).sort((a, b) => b.value - a.value);
  hbars($('#chartMuni'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

function renderDistChart(f) {
  const buckets = [['0–500 m', 0, 500], ['500 m–1 km', 500, 1000], ['1–2 km', 1000, 2000], ['2–4 km', 2000, 4000], ['over 4 km', 4000, Infinity]];
  const rows = buckets.map(([label, lo, hi]) => {
    const arr = f.filter(r => r.sst >= lo && r.sst < hi).map(r => r.m2p).filter(Boolean);
    return { label, value: Math.round(median(arr) || 0), n: arr.length, color: cssVar('--condo') };
  }).filter(r => r.n);
  hbars($('#chartDist'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

function renderDaysChart(f) {
  const days = f.map(r => r.d).filter(v => v != null);
  const mount = $('#chartDays'); mount.innerHTML = '';
  if (!days.length) { mount.append(el('div', { class: 'loading' }, 'Ingen data.')); return; }
  const edges = [0, 14, 30, 60, 90, 120, 180, 270, 365, Infinity];
  const labels = ['<2 uger', '2–4 uger', '1–2 mdr', '2–3 mdr', '3–4 mdr', '4–6 mdr', '6–9 mdr', '9–12 mdr', '>1 år'];
  const counts = new Array(labels.length).fill(0);
  days.forEach(d => { for (let i = 0; i < edges.length - 1; i++) if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; break; } });
  const W = 640, H = 220, padL = 34, padR = 12, padT = 10, padB = 40, plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...counts) || 1;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let g = 0; g <= 4; g++) { const y = padT + plotH - g / 4 * plotH; svg.append(svel('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'gridline' })); const t = svel('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-txt' }); t.textContent = Math.round(max * g / 4); svg.append(t); }
  const bw = plotW / counts.length;
  counts.forEach((c, i) => {
    const h = c / max * plotH, x = padL + i * bw, y = padT + plotH - h;
    const g = svel('g'); g.append(svel('rect', { x: x + bw * .14, y, width: bw * .72, height: h, rx: 4, fill: cssVar('--condo') }));
    g.addEventListener('mousemove', e => showTip(`<div class="tt-title">${labels[i]}</div><div class="tt-row"><span>Boliger</span><b>${c}</b></div><div class="tt-row"><span>Andel</span><b>${Math.round(c / days.length * 100)} %</b></div>`, e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
    svg.append(g);
    const lt = svel('text', { x: x + bw / 2, y: H - padB + 15, 'text-anchor': 'middle', class: 'axis-txt' }); lt.textContent = labels[i]; lt.setAttribute('transform', `rotate(-30 ${x + bw / 2} ${H - padB + 15})`); svg.append(lt);
  });
  mount.append(svg);
}

/* ===================== line chart (shared: DST index + trend) ===================== */
function lineChart(mount, xLabels, series, opt = {}) {
  mount.innerHTML = '';
  const pts = xLabels.length;
  if (!pts || !series.some(s => s.values.some(v => v != null))) { mount.append(el('div', { class: 'loading' }, opt.empty || 'Ingen data endnu.')); return; }
  const W = 680, H = 260, padL = 46, padR = 14, padT = 12, padB = 30, plotW = W - padL - padR, plotH = H - padT - padB;
  const all = series.flatMap(s => s.values).filter(v => v != null);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (opt.zeroBase) lo = Math.min(lo, 0);
  const span = (hi - lo) || 1; lo -= span * .06; hi += span * .06;
  const X = i => padL + (pts === 1 ? plotW / 2 : i / (pts - 1) * plotW);
  const Y = v => padT + plotH - (v - lo) / (hi - lo) * plotH;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let g = 0; g <= 4; g++) { const yv = lo + (hi - lo) * g / 4, y = Y(yv); svg.append(svel('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'gridline' })); const t = svel('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-txt' }); t.textContent = opt.yfmt ? opt.yfmt(yv) : Math.round(yv); svg.append(t); }
  // x ticks
  (opt.xticks || []).forEach(([i, lab]) => { const x = X(i); svg.append(svel('line', { x1: x, y1: padT, x2: x, y2: padT + plotH, class: 'gridline' })); const t = svel('text', { x, y: H - padB + 15, 'text-anchor': 'middle', class: 'axis-txt' }); t.textContent = lab; svg.append(t); });
  series.forEach(s => {
    let d = '', started = false;
    s.values.forEach((v, i) => { if (v == null) { started = false; return; } d += (started ? ' L' : ' M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); started = true; });
    svg.append(svel('path', { d: d.trim(), fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (pts === 1) { const i = 0, v = s.values[0]; if (v != null) svg.append(svel('circle', { cx: X(i), cy: Y(v), r: 4, fill: s.color })); }
  });
  // hover crosshair
  const cross = svel('line', { y1: padT, y2: padT + plotH, class: 'crosshair', 'stroke-dasharray': '3 3' }); cross.style.display = 'none'; svg.append(cross);
  const hit = svel('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
  hit.addEventListener('mousemove', e => {
    const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
    let i = Math.round((px - padL) / plotW * (pts - 1)); i = Math.max(0, Math.min(pts - 1, i));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.style.display = '';
    const rows = series.map(s => s.values[i] != null ? `<div class="tt-row"><span><i class="dot" style="background:${s.color}"></i>${s.name}</span><b>${opt.tfmt ? opt.tfmt(s.values[i]) : s.values[i]}</b></div>` : '').join('');
    showTip(`<div class="tt-title">${xLabels[i]}</div>${rows}`, e.clientX, e.clientY);
  });
  hit.addEventListener('mouseleave', () => { cross.style.display = 'none'; hideTip(); });
  svg.append(hit);
  mount.append(svg);
  if (opt.legend) {
    const lg = el('div', { class: 'chart-legend' });
    series.forEach(s => lg.append(el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: `background:${s.color}` }), s.name)));
    mount.append(lg);
  }
}

function renderIndexChart() {
  const mount = $('#chartIndex'); if (!S.index) { mount.innerHTML = ''; return; }
  const q = S.index.quarters, area = S.dstArea;
  const xticks = [];
  q.forEach((qq, i) => { if (qq.endsWith('K1') && (+qq.slice(0, 4)) % 4 === 0) xticks.push([i, qq.slice(0, 4)]); });
  const mk = (cat, color, name) => ({ name, color, values: (S.index.series[area + '|' + cat] || []).map(v => v) });
  const series = [];
  if (S.type !== 'villa') series.push(mk('condo', cssVar('--condo'), 'Ejerlejlighed'));
  if (S.type !== 'condo') series.push(mk('villa', cssVar('--villa'), 'Villa/hus'));
  lineChart(mount, q, series, {
    xticks, legend: true, yfmt: v => Math.round(v),
    tfmt: v => v == null ? '–' : v.toLocaleString('da-DK', { maximumFractionDigits: 1 }),
  });
}

function renderTrendChart() {
  const mount = $('#chartTrend'); const hist = (S.history && S.history.series) || [];
  const metric = $('#trendMetric').value;
  const scope = S.munis.size === 1 ? [...S.munis][0] : 'all';
  const dates = [...new Set(hist.filter(r => r.scope === scope).map(r => r.date))].sort();
  $('#trendSrc').textContent = dates.length < 2 ? '· bygges op fra ' + (dates[0] || '') : '· daglige målinger';
  const pick = (t, d) => { const row = hist.find(r => r.scope === scope && r.type === t && r.date === d); return row ? row[metric] : null; };
  const series = [];
  if (S.type !== 'villa') series.push({ name: 'Ejerlejlighed', color: cssVar('--condo'), values: dates.map(d => pick('condo', d)) });
  if (S.type !== 'condo') series.push({ name: 'Villa/hus', color: cssVar('--villa'), values: dates.map(d => pick('villa', d)) });
  const fmt = metric === 'medM2' ? m2 : metric === 'medPrice' ? krM : metric === 'pctCut' ? (v => Math.round(v) + ' %') : metric === 'medDays' ? (v => Math.round(v) + ' dage') : num;
  const xlab = dates.map(d => new Date(d).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }));
  const note = dates.length < 2 ? 'Historikken bygges op fra i dag — kom tilbage om nogle dage for at se udviklingen i liggetid og prisnedsættelser.' : '';
  lineChart(mount, xlab, series, { legend: true, yfmt: fmt, tfmt: fmt, empty: note, xticks: dates.length > 6 ? [[0, xlab[0]], [dates.length - 1, xlab[dates.length - 1]]] : [] });
  if (note && dates.length === 1) mount.append(el('p', { class: 'chart-note' }, note));
}

/* ===================== colour scales ===================== */
function seqRamp() { return ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6'].map(cssVar); }
function makeScale(vals, invert) {
  const lo = quantile(vals, .05), hi = quantile(vals, .95), ramp = seqRamp();
  return v => { if (v == null) return cssVar('--muted'); let t = (v - lo) / (hi - lo || 1); t = Math.max(0, Math.min(1, t)); if (invert) t = 1 - t; return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))]; };
}

/* ===================== MAP ===================== */
const MAP = { view: null, dots: [], stationEls: [], labelEls: [], svg: null };
function drawMap(f) {
  const mount = $('#map'); mount.innerHTML = '';
  const svg = svel('svg', { viewBox: `0 0 ${P.W} ${P.H}`, role: 'img', 'aria-label': 'Kort over boliger og S-togsnettet' });
  MAP.svg = svg;
  const lineColors = { central: cssVar('--ink-2'), hilleroed: cssVar('--condo'), klampenborg: '#1baf7a', farum: '#7a5cff', frederikssund: '#eda100', kystbanen: cssVar('--muted') };

  // ---- land (municipality polygons) ----
  const gLand = svel('g', {});
  S.meta.municipalities.forEach(m => {
    const g = S.geo[m.slug]; if (!g) return;
    const sel = S.munis.has(m.slug);
    g.rings.forEach(ring => {
      const d = ring.map((p, i) => (i ? 'L' : 'M') + P.x(p[0]).toFixed(1) + ' ' + P.y(p[1]).toFixed(1)).join(' ') + ' Z';
      gLand.append(svel('path', { d, class: 'muni-land' + (sel ? ' sel' : ' dim') }));
    });
  });
  svg.append(gLand);

  // ---- rail lines ----
  const stMap = Object.fromEntries(S.meta.stations.map(s => [s.name, s]));
  const gLines = svel('g', {});
  S.meta.lines.forEach(L => {
    const pts = L.stops.map(n => stMap[n]).filter(Boolean).map(s => `${P.x(s.lon).toFixed(1)},${P.y(s.lat).toFixed(1)}`).join(' ');
    gLines.append(svel('polyline', { points: pts, class: 'rail-line', stroke: lineColors[L.corridor], 'stroke-width': 3, opacity: .6, 'stroke-dasharray': L.corridor === 'kystbanen' ? '2 6' : '' }));
  });
  svg.append(gLines);

  // ---- listing dots ----
  let cAcc;
  if (S.colorBy === 'type') cAcc = r => r.t === 'villa' ? cssVar('--villa') : cssVar('--condo');
  else { const scale = makeScale(f.map(r => r[S.colorBy]).filter(v => v != null), S.colorBy === 'd'); cAcc = r => scale(r[S.colorBy]); }
  const gDots = svel('g', {}); MAP.dots = [];
  f.forEach(r => { const c = svel('circle', { cx: P.x(r.lon).toFixed(1), cy: P.y(r.lat).toFixed(1), r: 2.4, fill: cAcc(r), class: 'listing-dot' }); c._r = r; gDots.append(c); MAP.dots.push(c); });
  svg.append(gDots);
  gDots.addEventListener('mousemove', e => {
    const t = e.target; if (t.tagName !== 'circle' || !t._r) return; const r = t._r;
    showTip(`<div class="tt-title">${r.adr}</div><div class="tt-row"><span>${r.city}</span><b>${r.t === 'villa' ? 'Villa' : 'Ejerlejl.'}</b></div><div class="tt-row"><span>Pris</span><b>${krM(r.p)}</b></div><div class="tt-row"><span>Pris/m²</span><b>${m2(r.m2p)}</b></div><div class="tt-row"><span>Størrelse</span><b>${r.a} m² · ${r.r} vær.</b></div><div class="tt-row"><span>Liggetid</span><b>${r.d} dage</b></div><div class="tt-row"><span>S-tog</span><b>${r.ssn} ${r.sst} m</b></div>`, e.clientX, e.clientY);
  }, true);
  gDots.addEventListener('mouseout', e => { if (e.target.tagName === 'circle') hideTip(); }, true);
  gDots.addEventListener('click', e => { const t = e.target; if (t._r && t._r.url) window.open(t._r.url, '_blank', 'noopener'); });

  // ---- home / work markers + radius circles ----
  const gGeo = svel('g', {});
  const marker = (pt, rad, label, emoji) => {
    if (!pt) return;
    const cx = P.x(pt.lon), cy = P.y(pt.lat);
    const rxu = P.kmToUnitsX(rad), ryu = P.kmToUnitsY(rad);
    gGeo.append(svel('ellipse', { cx, cy, rx: rxu, ry: ryu, class: 'geo-radius' }));
    const pin = svel('g', { class: 'geo-pin' }); pin._noscaleAt = [cx, cy];
    pin.append(svel('circle', { cx, cy, r: 7, class: 'geo-pin-dot' }));
    const tx = svel('text', { x: cx, y: cy + 3.3, 'text-anchor': 'middle', class: 'geo-pin-emoji' }); tx.textContent = emoji; pin.append(tx);
    gGeo.append(pin); MAP.stationEls.push(pin);
  };
  MAP.stationEls = [];
  marker(S.A, S.radA, 'A', '🏠'); marker(S.B, S.radB, 'B', '💼');

  // ---- stations ----
  const bigStations = new Set(['København H', 'Hellerup', 'Nørreport', 'Lyngby', 'Holte', 'Birkerød', 'Allerød', 'Hillerød', 'Farum', 'Værløse', 'Ballerup', 'Herlev', 'Klampenborg', 'Charlottenlund', 'Gentofte', 'Bagsværd', 'Rungsted Kyst', 'Nivå', 'Ordrup', 'Buddinge']);
  const gSt = svel('g', {}); MAP.labelEls = []; const stDots = [];
  S.meta.stations.forEach(s => {
    const cx = P.x(s.lon), cy = P.y(s.lat);
    const dot = svel('circle', { cx, cy, r: s.strain ? 3 : 2.6, class: 'st-dot', stroke: lineColors[s.corridor] }); gSt.append(dot); stDots.push(dot);
    if (bigStations.has(s.name)) { const tx = svel('text', { x: cx + 5, y: cy + 3, class: 'st-label' }); tx.textContent = s.name; gSt.append(tx); MAP.labelEls.push(tx); }
  });
  MAP.stDots = stDots;
  svg.append(gSt);

  // pan / zoom
  attachPanZoom(svg);
  svg.append(gGeo); // geo on top for visibility
  mount.append(svg);
  applyViewScale();

  renderMapFacts(f);
  renderMapLegend(S.colorBy, f, lineColors);
}

function attachPanZoom(svg) {
  if (!MAP.view) MAP.view = { x: 0, y: 0, w: P.W, h: P.H };
  applyView();
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  svg.addEventListener('pointerdown', e => { dragging = true; sx = e.clientX; sy = e.clientY; ox = MAP.view.x; oy = MAP.view.y; svg.classList.add('grabbing'); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', e => {
    if (!dragging) return; const r = svg.getBoundingClientRect();
    MAP.view.x = ox - (e.clientX - sx) / r.width * MAP.view.w;
    MAP.view.y = oy - (e.clientY - sy) / r.height * MAP.view.h;
    clampView(); applyView();
  });
  const end = e => { dragging = false; svg.classList.remove('grabbing'); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', e => {
    e.preventDefault(); const r = svg.getBoundingClientRect();
    const mx = MAP.view.x + (e.clientX - r.left) / r.width * MAP.view.w;
    const my = MAP.view.y + (e.clientY - r.top) / r.height * MAP.view.h;
    zoomAt(mx, my, e.deltaY < 0 ? 0.85 : 1 / 0.85);
  }, { passive: false });
}
function clampView() {
  const v = MAP.view;
  v.w = Math.min(v.w, P.W); v.h = Math.min(v.h, P.H);
  v.x = Math.max(-P.W * .05, Math.min(v.x, P.W - v.w + P.W * .05));
  v.y = Math.max(-P.H * .05, Math.min(v.y, P.H - v.h + P.H * .05));
}
function applyView() { const v = MAP.view; MAP.svg.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`); applyViewScale(); }
function applyViewScale() {
  if (!MAP.view) return;
  const k = MAP.view.w / P.W; // 1 = full, <1 zoomed in
  const dotR = Math.max(1.1, 2.4 * Math.pow(k, .75));
  MAP.dots.forEach(d => d.setAttribute('r', dotR));
  (MAP.stDots || []).forEach(d => d.setAttribute('r', (d.classList.contains('st-dot') ? 3 : 2.6) * Math.pow(k, .8)));
  MAP.labelEls.forEach(t => { t.style.fontSize = (9 * k) + 'px'; t.style.display = k < 0.42 ? '' : (k > 0.9 ? '' : ''); });
  MAP.labelEls.forEach(t => t.setAttribute('font-size', (9 * k)));
}
function zoomAt(cx, cy, factor) {
  const v = MAP.view; const nw = v.w * factor, nh = v.h * factor;
  v.x = cx - (cx - v.x) * (nw / v.w); v.y = cy - (cy - v.y) * (nh / v.h); v.w = nw; v.h = nh;
  clampView(); applyView();
}
function zoomBy(factor) { zoomAt(MAP.view.x + MAP.view.w / 2, MAP.view.y + MAP.view.h / 2, factor); }
function resetView() { MAP.view = { x: 0, y: 0, w: P.W, h: P.H }; if (MAP.svg) applyView(); }
function fitBBox(mnx, mny, mxx, mxy, padFrac = 0.12) {
  if (!MAP.svg) return;
  let x0 = P.x(mnx), x1 = P.x(mxx), y0 = P.y(mxy), y1 = P.y(mny); // note lat inverts
  let w = x1 - x0, h = y1 - y0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  w *= (1 + padFrac * 2); h *= (1 + padFrac * 2);
  const r = MAP.svg.getBoundingClientRect(), aspect = r.width / r.height || (P.W / P.H);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  MAP.view = { x: cx - w / 2, y: cy - h / 2, w, h };
  clampView(); applyView();
}
function fitToSelection() {
  // priority: home/work points -> selected municipalities -> full
  const pts = [S.A, S.B].filter(Boolean);
  if (pts.length) {
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    pts.forEach(p => { const rd = Math.max(p === S.A ? S.radA : S.radB, 1) / 100; mnx = Math.min(mnx, p.lon - rd * 1.6); mxx = Math.max(mxx, p.lon + rd * 1.6); mny = Math.min(mny, p.lat - rd); mxy = Math.max(mxy, p.lat + rd); });
    fitBBox(mnx, mny, mxx, mxy); return;
  }
  const sel = [...S.munis].map(s => S.geo[s]).filter(Boolean);
  if (!sel.length || sel.length === S.meta.municipalities.length) { resetView(); return; }
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  sel.forEach(g => { mnx = Math.min(mnx, g.bbox[0]); mny = Math.min(mny, g.bbox[1]); mxx = Math.max(mxx, g.bbox[2]); mxy = Math.max(mxy, g.bbox[3]); });
  fitBBox(mnx, mny, mxx, mxy);
}

function renderMapFacts(f) {
  const box = $('#mapFacts'); box.innerHTML = '';
  if (!f.length) return;
  const names = Object.fromEntries(S.meta.municipalities.map(m => [m.slug, m.name]));
  const byM = new Map(); f.forEach(r => { (byM.get(r.muni) || byM.set(r.muni, []).get(r.muni)).push(r.m2p); });
  const meds = [...byM.entries()].map(([s, a]) => ({ n: names[s] || s, v: median(a.filter(Boolean)) })).filter(x => x.v).sort((a, b) => b.v - a.v);
  const nearMed = median(f.filter(r => r.near).map(r => r.m2p).filter(Boolean));
  const farMed = median(f.filter(r => !r.near).map(r => r.m2p).filter(Boolean));
  const facts = [];
  if (meds.length) facts.push(['Dyreste kommune', `${meds[0].n} · ${m2(meds[0].v)}`]);
  if (meds.length > 1) facts.push(['Billigste kommune', `${meds[meds.length - 1].n} · ${m2(meds[meds.length - 1].v)}`]);
  if (nearMed && farMed) { const prem = Math.round((nearMed / farMed - 1) * 100); facts.push(['Nær S-tog vs. længere væk', `${m2(nearMed)} <small>mod ${m2(farMed)}</small>`]); facts.push(['S-togs­premie', (prem >= 0 ? '+' : '') + prem + ' <small>% pr. m²</small>']); }
  facts.forEach(([l, v]) => box.append(el('div', { class: 'mf' }, el('div', { class: 'mf-l' }, l), el('div', { class: 'mf-v', html: v }))));
}

function renderMapLegend(colorBy, f, lineColors) {
  const box = $('#mapLegend'); box.innerHTML = '';
  if (colorBy === 'type') box.append(legItem(cssVar('--condo'), 'Ejerlejlighed'), legItem(cssVar('--villa'), 'Villa'));
  else {
    const vals = f.map(r => r[colorBy]).filter(v => v != null), lo = quantile(vals, .05), hi = quantile(vals, .95);
    const fmt = colorBy === 'm2p' ? m2 : colorBy === 'p' ? krM : v => Math.round(v) + ' dage';
    const ramp = el('span', { class: 'ramp' }); let steps = seqRamp(); if (colorBy === 'd') steps = [...steps].reverse();
    steps.forEach(c => ramp.append(el('i', { style: `background:${c}` })));
    const label = colorBy === 'm2p' ? 'Pris pr. m²' : colorBy === 'p' ? 'Pris' : 'Liggetid';
    box.append(el('span', { class: 'legend-item' }, label + ':'), el('span', { class: 'legend-item' }, colorBy === 'd' ? 'kort' : fmt(lo)), ramp, el('span', { class: 'legend-item' }, colorBy === 'd' ? 'lang' : fmt(hi)));
  }
  S.meta.lines.forEach(L => box.append(el('span', { class: 'legend-item' }, el('span', { class: 'legend-line' + (L.corridor === 'kystbanen' ? ' dashed' : ''), style: `border-top-color:${lineColors[L.corridor]}` }), L.label)));
}
function legItem(color, text) { return el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: `background:${color}` }), text); }

/* ===================== listing cards ===================== */
function sortRows(f) {
  const cmp = { d: (a, b) => a.d - b.d, m2p: (a, b) => a.m2p - b.m2p, m2p_desc: (a, b) => b.m2p - a.m2p, p: (a, b) => a.p - b.p, p_desc: (a, b) => b.p - a.p, sst: (a, b) => a.sst - b.sst, chg: (a, b) => (a.chg || 0) - (b.chg || 0) }[S.sort];
  return [...f].sort(cmp);
}
function renderCards(f) {
  const rows = sortRows(f);
  $('#listCount').textContent = '· ' + f.length.toLocaleString('da-DK');
  const box = $('#cards'); box.innerHTML = '';
  rows.slice(0, S.shown).forEach(r => box.append(card(r)));
  const more = $('#loadMore'); more.hidden = rows.length <= S.shown; more.textContent = `Vis flere (${(rows.length - S.shown).toLocaleString('da-DK')} tilbage)`;
}
function card(r) {
  const a = el('a', { class: 'lcard', href: r.url || '#', target: '_blank', rel: 'noopener' });
  const thumb = el('div', { class: 'thumb' }); if (r.img) thumb.style.backgroundImage = `url("${r.img}")`;
  thumb.append(el('span', { class: 'badge ' + r.t }, r.t === 'villa' ? 'Villa' : 'Ejerlejl.'));
  thumb.append(el('span', { class: 'stbadge' + (r.near ? ' near' : '') }, `${r.near ? '🚆 ' : ''}${r.ssn} · ${(r.sst / 1000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} km`));
  a.append(thumb);
  const body = el('div', { class: 'body' });
  body.append(el('div', { class: 'price' }, krM(r.p)));
  body.append(el('div', { class: 'addr' }, r.adr));
  body.append(el('div', { class: 'city' }, (r.zip ? r.zip + ' ' : '') + r.city));
  const meta = el('div', { class: 'meta' });
  meta.append(el('span', {}, el('b', {}, m2(r.m2p))));
  meta.append(el('span', {}, `${r.a} m²`));
  meta.append(el('span', {}, `${r.r} vær.`));
  if (r.y) meta.append(el('span', {}, `opf. ${r.y}`));
  if (r.e) meta.append(el('span', {}, `E: ${String(r.e).toUpperCase().replace('2015', ' 2015')}`));
  meta.append(el('span', {}, `${r.d} dage`));
  if (r.chg < 0) meta.append(el('span', { class: 'cut' }, `↓ ${Math.abs(r.chg).toLocaleString('da-DK', { maximumFractionDigits: 1 })} %`));
  if (S.A || S.B) {
    const parts = [];
    if (S.A) parts.push('🏠 ' + haversine(r.lat, r.lon, S.A.lat, S.A.lon).toLocaleString('da-DK', { maximumFractionDigits: 1 }) + ' km');
    if (S.B) parts.push('💼 ' + haversine(r.lat, r.lon, S.B.lat, S.B.lon).toLocaleString('da-DK', { maximumFractionDigits: 1 }) + ' km');
    meta.append(el('span', { class: 'commute-dist' }, parts.join(' · ')));
  }
  body.append(meta); a.append(body);
  return a;
}

boot();
