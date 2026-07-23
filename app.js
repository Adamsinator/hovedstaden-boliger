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
  dstArea: '01', indexMode: 'krm2', bvc: null,
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
// one colour per entity: ejerlejlighed = blue, villa = orange (blue when both)
const typeColor = () => cssVar(S.type === 'villa' ? '--villa' : '--condo');
const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371, p = Math.PI / 180;
  const a = 0.5 - Math.cos((la2 - la1) * p) / 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * (1 - Math.cos((lo2 - lo1) * p)) / 2;
  return 2 * R * Math.asin(Math.sqrt(a)); // km
};
const ENERGY_ORDER = { a: 7, b: 6, c: 5, d: 4, e: 3, f: 2, g: 1 };
const energyRank = e => { if (!e) return 0; return ENERGY_ORDER[String(e)[0].toLowerCase()] || 0; };
const PRICES = [1e6, 1.5e6, 2e6, 2.5e6, 3e6, 4e6, 5e6, 7.5e6, 10e6, 15e6, 20e6, 30e6, 50e6, 75e6, 100e6, 150e6];

/* ===================== load ===================== */
async function boot() {
  try {
    const [meta, listings, geo, index, history, bvc] = await Promise.all([
      fetch('data/meta.json').then(r => r.json()),
      fetch('data/listings.json').then(r => r.json()),
      fetch('data/geo.json').then(r => r.json()).catch(() => ({})),
      fetch('data/priceindex.json').then(r => r.json()).catch(() => null),
      fetch('data/history.json').then(r => r.json()).catch(() => ({ series: [] })),
      fetch('data/bvc.json').then(r => r.json()).catch(() => null),
    ]);
    S.meta = meta; S.all = listings; S.geo = geo; S.index = index; S.history = history; S.bvc = bvc;
    meta.municipalities.forEach(m => S.munis.add(m.slug));
    initUI();
    initMap();
    render();
  } catch (e) {
    $('#map').innerHTML = '<div class="loading">Kunne ikke hente data.</div>';
    console.error(e);
  }
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
  on('#nearS', 'nearS');
  $('#search').addEventListener('input', e => { S.search = e.target.value.toLowerCase().trim(); S.shown = 60; render(); });
  $('#loadMore').addEventListener('click', () => { S.shown += 60; renderCards(filtered()); });
  $('#resetFilters').addEventListener('click', resetFilters);

  // DST area select — only the corridor landsdele we can anchor to real kr/m²
  if (S.index) {
    const sel = $('#dstArea');
    S.index.areas.filter(a => DST_LANDSDEL_MUNIS[a.id]).forEach(a => sel.append(el('option', { value: a.id }, a.name)));
    sel.value = S.dstArea;
    sel.addEventListener('change', e => { S.dstArea = e.target.value; renderIndexChart(); });
  }
  const modeSel = $('#indexMode');
  if (!S.bvc) modeSel.querySelector('option[value="real"]').remove();
  modeSel.addEventListener('change', e => {
    S.indexMode = e.target.value;
    $('#dstAreaLabel').style.display = S.indexMode === 'real' ? 'none' : '';
    renderIndexChart();
  });
  $('#trendMetric').addEventListener('change', renderTrendChart);
  $('#outlierSide').addEventListener('change', () => renderOutliers(filtered()));

  // (map pan / zoom / double-click zoom is native Leaflet)

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
    refreshMapTheme(); render();
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
  renderYearChart(f);
  renderScatter(f);
  renderOutliers(f);
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
    { label: 'Median pris', val: krM(median(prices)),
      sub: prices.length ? `Midterste 50 %: ${krM(quantile(prices, .25))} – ${krM(quantile(prices, .75))} · dyreste ${krM(Math.max(...prices))}` : '' },
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
    g.append(svel('rect', { x: padL, y: y + 4, width: bw, height: rowH - 10, rx: 4, fill: r.color || typeColor() }));
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
  const rows = [...byM.entries()].map(([slug, arr]) => ({ label: names[slug] || slug, value: Math.round(median(arr.filter(Boolean))), n: arr.length, color: typeColor() }))
    .filter(r => r.value).sort((a, b) => b.value - a.value);
  hbars($('#chartMuni'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

function renderDistChart(f) {
  const buckets = [['0–500 m', 0, 500], ['500 m–1 km', 500, 1000], ['1–2 km', 1000, 2000], ['2–4 km', 2000, 4000], ['over 4 km', 4000, Infinity]];
  const rows = buckets.map(([label, lo, hi]) => {
    const arr = f.filter(r => r.sst >= lo && r.sst < hi).map(r => r.m2p).filter(Boolean);
    return { label, value: Math.round(median(arr) || 0), n: arr.length, color: typeColor() };
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
    const g = svel('g'); g.append(svel('rect', { x: x + bw * .14, y, width: bw * .72, height: h, rx: 4, fill: typeColor() }));
    g.addEventListener('mousemove', e => showTip(`<div class="tt-title">${labels[i]}</div><div class="tt-row"><span>Boliger</span><b>${c}</b></div><div class="tt-row"><span>Andel</span><b>${Math.round(c / days.length * 100)} %</b></div>`, e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
    svg.append(g);
    const lt = svel('text', { x: x + bw / 2, y: H - padB + 15, 'text-anchor': 'middle', class: 'axis-txt' }); lt.textContent = labels[i]; lt.setAttribute('transform', `rotate(-30 ${x + bw / 2} ${H - padB + 15})`); svg.append(lt);
  });
  mount.append(svg);
}

/* ===================== price by build year ===================== */
function renderYearChart(f) {
  const buckets = [['før 1900', -1e9, 1900], ['1900–39', 1900, 1940], ['1940–59', 1940, 1960],
    ['1960–79', 1960, 1980], ['1980–99', 1980, 2000], ['2000–09', 2000, 2010],
    ['2010–19', 2010, 2020], ['2020+', 2020, 1e9]];
  const rows = buckets.map(([label, lo, hi]) => {
    const arr = f.filter(r => r.y && r.y >= lo && r.y < hi).map(r => r.m2p).filter(Boolean);
    return { label, value: Math.round(median(arr) || 0), n: arr.length, color: typeColor() };
  }).filter(r => r.n >= 5);
  hbars($('#chartYear'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

/* ===================== scatter: size vs kr/m² ===================== */
function renderScatter(f) {
  const mount = $('#chartScatter'); mount.innerHTML = '';
  const pts = f.filter(r => r.a > 0 && r.m2p > 0);
  if (pts.length < 5) { mount.append(el('div', { class: 'loading' }, 'For få boliger.')); return; }
  const W = 640, H = 300, padL = 52, padR = 12, padT = 10, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xMax = Math.min(320, quantile(pts.map(r => r.a), .99));
  const yMax = quantile(pts.map(r => r.m2p), .99);
  const X = v => padL + Math.min(v, xMax) / xMax * plotW;
  const Y = v => padT + plotH - Math.min(v, yMax) / yMax * plotH;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let g = 0; g <= 4; g++) {
    const yv = yMax * g / 4, y = Y(yv);
    svg.append(svel('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'gridline' }));
    const t = svel('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-txt' });
    t.textContent = Math.round(yv / 1000) + 'k'; svg.append(t);
  }
  for (let g = 0; g <= 4; g++) {
    const xv = xMax * g / 4, x = X(xv);
    const t = svel('text', { x, y: H - padB + 15, 'text-anchor': 'middle', class: 'axis-txt' });
    t.textContent = Math.round(xv) + ' m²'; svg.append(t);
  }
  const gDots = svel('g', {});
  pts.forEach(r => {
    const c = svel('circle', { cx: X(r.a).toFixed(1), cy: Y(r.m2p).toFixed(1), r: 2.2,
      fill: r.t === 'villa' ? cssVar('--villa') : cssVar('--condo'), opacity: .5 });
    c._r = r; gDots.append(c);
  });
  svg.append(gDots);
  gDots.addEventListener('mousemove', e => {
    const t = e.target; if (t.tagName !== 'circle' || !t._r) return; const r = t._r;
    showTip(`<div class="tt-title">${r.adr}</div><div class="tt-row"><span>${r.city}</span><b>${r.a} m²</b></div><div class="tt-row"><span>Pris/m²</span><b>${m2(r.m2p)}</b></div><div class="tt-row"><span>Pris</span><b>${krM(r.p)}</b></div>`, e.clientX, e.clientY);
  }, true);
  gDots.addEventListener('mouseout', hideTip, true);
  // median kr/m² per 20 m² bin — the trend line through the cloud
  const bins = new Map();
  pts.forEach(r => { const b = Math.floor(Math.min(r.a, xMax) / 20) * 20; (bins.get(b) || bins.set(b, []).get(b)).push(r.m2p); });
  const line = [...bins.entries()].filter(([, v]) => v.length >= 5).sort((a, b) => a[0] - b[0])
    .map(([b, v]) => [X(b + 10), Y(median(v))]);
  if (line.length > 1) {
    svg.append(svel('polyline', { points: line.map(p => p.join(',')).join(' '), fill: 'none',
      stroke: cssVar('--ink'), 'stroke-width': 2, opacity: .75, 'stroke-linejoin': 'round' }));
  }
  mount.append(svg);
  mount.append(el('p', { class: 'chart-note' },
    'Hver prik er en bolig. Den mørke linje er median pris pr. m² pr. 20 m²-interval — den falder typisk med størrelsen (stordriftsrabat).'));
}

/* ============ outliers: robust z-score of kr/m² within kommune + type ============ */
function outlierRows(f) {
  const groups = new Map();
  f.forEach(r => { if (!r.m2p) return; const k = r.muni + '|' + r.t; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
  const out = [];
  groups.forEach(rows => {
    if (rows.length < 8) return;                       // too small to judge
    const vals = rows.map(r => r.m2p);
    const med = median(vals);
    const mad = median(vals.map(v => Math.abs(v - med)));
    const sigma = 1.4826 * mad;                        // robust ≈ std-dev
    if (!sigma) return;
    rows.forEach(r => out.push({ r, z: (r.m2p - med) / sigma, med }));
  });
  return out;
}
function renderOutliers(f) {
  const box = $('#outliers'); box.innerHTML = '';
  const side = $('#outlierSide').value;
  const all = outlierRows(f);
  if (!all.length) { box.append(el('div', { class: 'loading' }, 'For få boliger i hvert område til at beregne afvigelser.')); return; }
  const sorted = all.sort((a, b) => side === 'low' ? a.z - b.z : b.z - a.z).slice(0, 12);
  const names = Object.fromEntries(S.meta.municipalities.map(m => [m.slug, m.name]));
  sorted.forEach(({ r, z, med }) => {
    const pct = Math.round((r.m2p / med - 1) * 100);
    const a = el('a', { class: 'ol-row', href: r.url || '#', target: '_blank', rel: 'noopener' });
    a.append(el('span', { class: 'ol-z ' + (z < 0 ? 'lo' : 'hi') }, (pct > 0 ? '+' : '') + pct + ' %'));
    a.append(el('span', { class: 'ol-main' },
      el('b', {}, r.adr),
      el('small', {}, `${names[r.muni] || r.muni} · ${r.t === 'villa' ? 'villa' : 'ejerlejl.'} · ${r.a} m² · ${r.r} vær.`)));
    a.append(el('span', { class: 'ol-num' }, el('b', {}, m2(r.m2p)), el('small', {}, `område: ${m2(med)}`)));
    a.append(el('span', { class: 'ol-num' }, el('b', {}, krM(r.p)), el('small', {}, `${r.d} dage`)));
    box.append(a);
  });
  box.append(el('p', { class: 'chart-note' },
    side === 'low'
      ? 'Boliger hvis m²-pris ligger lavest i forhold til medianen for samme boligtype i samme kommune (robust z-score på median/MAD). Kan være fund — eller afspejle stand, støj eller stue-/kælderplan.'
      : 'Boliger hvis m²-pris ligger højest i forhold til deres eget område — typisk nybyg, penthouse eller vandudsigt.'));
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

// DST landsdele → the corridor municipalities they contain (for anchoring the
// index to today's real kr/m²). 084/000 aren't shown (can't anchor to our data).
const DST_LANDSDEL_MUNIS = {
  '01': ['koebenhavn', 'frederiksberg'],
  '02': ['gentofte', 'lyngby-taarbaek', 'gladsaxe', 'herlev', 'ballerup'],
  '03': ['rudersdal', 'furesoe', 'alleroed', 'hilleroed', 'hoersholm', 'egedal', 'fredensborg'],
};
function currentKrM2(areaId, type) {
  const set = new Set(DST_LANDSDEL_MUNIS[areaId] || []);
  return median(S.all.filter(r => r.t === type && set.has(r.muni)).map(r => r.m2p).filter(Boolean));
}
function renderIndexChart() {
  const mount = $('#chartIndex');
  if (S.indexMode === 'real' && S.bvc) return renderRealIndexChart(mount);
  if (!S.index) { mount.innerHTML = ''; return; }
  const q = S.index.quarters, area = S.dstArea;
  const xticks = [];
  q.forEach((qq, i) => { if (qq.endsWith('K1') && (+qq.slice(0, 4)) % 4 === 0) xticks.push([i, qq.slice(0, 4)]); });
  const lastIdx = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  // convert the DST index into estimated kr/m², anchored so the latest quarter
  // equals today's actual median kr/m² for that landsdel + type.
  const toKrM2 = (cat, type) => {
    const arr = S.index.series[area + '|' + cat] || [];
    const base = lastIdx(arr), anchor = currentKrM2(area, type);
    if (!base || !anchor) return arr.map(() => null);
    return arr.map(v => v == null ? null : Math.round(v / base * anchor));
  };
  const series = [];
  if (S.type !== 'villa') series.push({ name: 'Ejerlejlighed', color: cssVar('--condo'), values: toKrM2('condo', 'condo') });
  if (S.type !== 'condo') series.push({ name: 'Villa/hus', color: cssVar('--villa'), values: toKrM2('villa', 'villa') });
  lineChart(mount, q, series, { xticks, legend: true, yfmt: m2short, tfmt: m2 });
  const areaName = (S.index.areas.find(a => a.id === area) || {}).name || '';
  mount.append(el('p', { class: 'chart-note' },
    `Estimeret kr/m² for ${areaName}: Danmarks Statistiks kvartalsvise prisindeks (EJ56) skaleret, så seneste kvartal svarer til det aktuelle medianniveau. Viser prisernes bevægelse siden 1992, ikke faktiske historiske udbudspriser.`));
}
const m2short = v => v == null ? '–' : Math.round(v / 1000) + 'k';

// Long real (inflation-adjusted) prices, Boligøkonomisk Videncenter.
// Houses run from 1938, condos from 1973 — rebased to 2000 = 100 so the two are
// directly comparable on one axis.
function renderRealIndexChart(mount) {
  const b = S.bvc, hy = b.houses.years, cy = b.condos.years, BASE = 2000;
  const rebase = (vals, yrs) => {
    const i = yrs.indexOf(BASE), f = (i >= 0 && vals[i]) ? 100 / vals[i] : 1;
    return vals.map(v => v == null ? null : Math.round(v * f * 10) / 10);
  };
  const houses = rebase(b.houses.kbhfrb, hy);
  const condosR = rebase(b.condos.kbhfrb, cy);
  const condos = hy.map(y => { const i = cy.indexOf(y); return i < 0 ? null : condosR[i]; });
  const series = [];
  if (S.type !== 'condo') series.push({ name: 'Villa/hus (realt)', color: cssVar('--villa'), values: houses });
  if (S.type !== 'villa') series.push({ name: 'Ejerlejlighed (realt)', color: cssVar('--condo'), values: condos });
  const xticks = [];
  hy.forEach((y, i) => { if (y % 10 === 0) xticks.push([i, String(y)]); });
  lineChart(mount, hy.map(String), series, {
    xticks, legend: true, yfmt: v => Math.round(v), tfmt: v => v == null ? '–' : Math.round(v),
  });
  mount.append(el('p', { class: 'chart-note' },
    `Reale (inflationskorrigerede) boligpriser i København + Frederiksberg, indekseret så ${BASE} = 100. `
    + 'Huse måles fra 1938, ejerlejligheder fra 1973. Viser prisernes købekraft-korrigerede udvikling — '
    + 'toppen før finanskrisen og faldet efter er tydelige. Kilde: Boligøkonomisk Videncenter.'));
}

function renderTrendChart() {
  const mount = $('#chartTrend'); const hist = (S.history && S.history.series) || [];
  const metric = $('#trendMetric').value;
  const scope = S.munis.size === 1 ? [...S.munis][0] : 'all';
  const scopeName = scope === 'all' ? 'hele korridoren' : (S.meta.municipalities.find(m => m.slug === scope) || {}).name;
  const dates = [...new Set(hist.filter(r => r.scope === scope).map(r => r.date))].sort();
  $('#trendSrc').textContent = '· ' + scopeName + (dates.length < 2 ? ' · bygges op fra ' + (dates[0] || '') : ' · vores daglige målinger');
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

/* ===================== MAP (Leaflet + tiles) ===================== */
const MAP = { map: null, tiles: null, L: {}, renderer: null, inited: false };
const LINE_COLORS = () => ({ central: cssVar('--ink-2'), hilleroed: cssVar('--condo'), klampenborg: '#12a06f', farum: '#7a5cff', frederikssund: '#e08a00', kystbanen: cssVar('--muted') });
const BIG_STATIONS = new Set(['København H', 'Hellerup', 'Nørreport', 'Lyngby', 'Holte', 'Birkerød', 'Allerød', 'Hillerød', 'Farum', 'Værløse', 'Ballerup', 'Herlev', 'Klampenborg', 'Charlottenlund', 'Gentofte', 'Bagsværd', 'Rungsted Kyst', 'Nivå', 'Ordrup', 'Buddinge', 'Svanemøllen', 'Virum']);

function isDark() { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
function tileUrl() {
  return isDark()
    ? 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
}
function regionBounds() {
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  Object.values(S.geo || {}).forEach(g => { const x = g.bbox; a = Math.min(a, x[1]); b = Math.min(b, x[0]); c = Math.max(c, x[3]); d = Math.max(d, x[2]); });
  if (a === 1e9) { S.all.forEach(r => { a = Math.min(a, r.lat); b = Math.min(b, r.lon); c = Math.max(c, r.lat); d = Math.max(d, r.lon); }); }
  return [[a, b], [c, d]];
}

function initMap() {
  const map = L.map('map', { preferCanvas: true, zoomControl: true, minZoom: 8, maxZoom: 18, doubleClickZoom: true, scrollWheelZoom: true });
  MAP.map = map;
  MAP.renderer = L.canvas({ padding: 0.4 });
  L.control.scale({ imperial: false }).addTo(map);
  setTiles();
  MAP.L.boundaries = L.layerGroup().addTo(map);
  MAP.L.rail = L.layerGroup().addTo(map);
  MAP.L.listings = L.layerGroup().addTo(map);
  MAP.L.labels = L.layerGroup().addTo(map);
  MAP.L.stations = L.layerGroup().addTo(map);
  MAP.L.geo = L.layerGroup().addTo(map);
  map.fitBounds(regionBounds(), { padding: [12, 12] });
  drawRail(); drawStations();
  map.on('mouseout', hideTip);
  map.on('zoomend', () => { resizeDots(); drawPriceLabels(); });
  map.on('moveend', drawPriceLabels);

  // "reset view" control next to the zoom buttons
  const Reset = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const a = L.DomUtil.create('a', 'leaflet-bar map-reset');
      a.href = '#'; a.title = 'Nulstil kortet'; a.innerHTML = '⤢';
      L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => fitAll());
      return a;
    },
  });
  map.addControl(new Reset());
  window.__MAP = MAP;   // handy for debugging from the console
  setTimeout(() => map.invalidateSize(), 200);
  addEventListener('resize', () => map.invalidateSize());
  MAP.inited = true;
}
function setTiles() {
  if (MAP.tiles) MAP.map.removeLayer(MAP.tiles);
  MAP.tiles = L.tileLayer(tileUrl(), {
    subdomains: 'abcd', maxZoom: 19, detectRetina: true,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
  MAP.tiles.addTo(MAP.map); MAP.tiles.bringToBack();
}

function drawRail() {
  MAP.L.rail.clearLayers();
  const stMap = Object.fromEntries(S.meta.stations.map(s => [s.name, s]));
  const col = LINE_COLORS();
  S.meta.lines.forEach(Ln => {
    const pts = Ln.stops.map(n => stMap[n]).filter(Boolean).map(s => [s.lat, s.lon]);
    L.polyline(pts, { color: col[Ln.corridor], weight: 4, opacity: .85, lineCap: 'round', lineJoin: 'round', dashArray: Ln.corridor === 'kystbanen' ? '3 8' : null }).addTo(MAP.L.rail);
  });
}
function drawStations() {
  MAP.L.stations.clearLayers();
  const col = LINE_COLORS();
  S.meta.stations.forEach(s => {
    L.circleMarker([s.lat, s.lon], { renderer: MAP.renderer, radius: s.strain ? 4 : 3, color: col[s.corridor], weight: 2, fillColor: cssVar('--surface'), fillOpacity: 1 })
      .addTo(MAP.L.stations).bindTooltip(s.name + (s.strain ? '' : ' · Kystbanen'), { direction: 'top', offset: [0, -4] });
    if (BIG_STATIONS.has(s.name))
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'st-name', html: s.name, iconSize: [90, 12], iconAnchor: [-6, 6] }), interactive: false, keyboard: false }).addTo(MAP.L.stations);
  });
}
function drawBoundaries() {
  MAP.L.boundaries.clearLayers();
  const partial = S.munis.size > 0 && S.munis.size < S.meta.municipalities.length;
  S.meta.municipalities.forEach(m => {
    const g = S.geo[m.slug]; if (!g) return;
    const sel = S.munis.has(m.slug);
    g.rings.forEach(ring => {
      L.polygon(ring.map(p => [p[1], p[0]]), {
        color: sel ? cssVar('--land-sel-edge') : cssVar('--muted'),
        weight: sel ? 2 : 1, opacity: partial ? (sel ? 0.95 : 0.28) : 0.5,
        fill: partial && sel, fillColor: cssVar('--condo'), fillOpacity: 0.07,
        interactive: false,
      }).addTo(MAP.L.boundaries);
    });
  });
}
function listingTip(r) {
  return `<div class="tt-title">${r.adr}</div><div class="tt-row"><span>${r.city}</span><b>${r.t === 'villa' ? 'Villa' : 'Ejerlejl.'}</b></div><div class="tt-row"><span>Pris</span><b>${krM(r.p)}</b></div><div class="tt-row"><span>Pris/m²</span><b>${m2(r.m2p)}</b></div><div class="tt-row"><span>Størrelse</span><b>${r.a} m² · ${r.r} vær.</b></div><div class="tt-row"><span>Liggetid</span><b>${r.d} dage</b></div><div class="tt-row"><span>S-tog</span><b>${r.ssn} · ${r.sst} m</b></div>`;
}
// dots grow as you zoom in — keeps them visible and easy to hover/hit
const radiusForZoom = z => Math.max(4, Math.min(11, 4 + (z - 10) * 1.15));
// asking price rounded to the nearest 250.000 kr, for the on-map labels
function priceLabel(p) {
  const v = Math.round(p / 250000) * 250000;
  return v >= 1e6 ? (v / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 2 }) + ' mio.'
    : Math.round(v / 1000) + 'k';
}
const LABEL_ZOOM = 13;      // show price labels from this zoom in
const LABEL_MAX = 220;      // …but never more than this many at once

function drawListings(f) {
  MAP.L.listings.clearLayers();
  MAP.f = f;
  let cAcc;
  if (S.colorBy === 'type') cAcc = r => r.t === 'villa' ? cssVar('--villa') : cssVar('--condo');
  else { const scale = makeScale(f.map(r => r[S.colorBy]).filter(v => v != null), S.colorBy === 'd'); cAcc = r => scale(r[S.colorBy]); }
  const rad = radiusForZoom(MAP.map.getZoom());
  f.forEach(r => {
    const mk = L.circleMarker([r.lat, r.lon], { renderer: MAP.renderer, radius: rad, color: cssVar('--surface'), weight: .7, fillColor: cAcc(r), fillOpacity: .95 });
    mk.on('mouseover', ev => showTip(listingTip(r), ev.originalEvent.clientX, ev.originalEvent.clientY));
    mk.on('mousemove', ev => showTip(listingTip(r), ev.originalEvent.clientX, ev.originalEvent.clientY));
    mk.on('mouseout', hideTip);
    mk.on('click', () => { if (r.url) window.open(r.url, '_blank', 'noopener'); });
    mk.addTo(MAP.L.listings);
  });
  drawPriceLabels();
}

function resizeDots() {
  const rad = radiusForZoom(MAP.map.getZoom());
  MAP.L.listings.eachLayer(l => l.setRadius && l.setRadius(rad));
}

function drawPriceLabels() {
  const lay = MAP.L.labels; if (!lay) return;
  lay.clearLayers();
  const z = MAP.map.getZoom();
  if (z < LABEL_ZOOM || !MAP.f) return;
  const b = MAP.map.getBounds();
  const vis = MAP.f.filter(r => b.contains([r.lat, r.lon]));
  if (vis.length > LABEL_MAX) return;          // too dense to be readable
  const off = radiusForZoom(z) + 6;   // bubble tail sits just above the dot
  vis.forEach(r => {
    L.marker([r.lat, r.lon], {
      interactive: false, keyboard: false,
      icon: L.divIcon({
        className: 'price-label',
        html: `<b class="${r.t === 'villa' ? 'villa' : 'condo'}">${priceLabel(r.p)}</b>`,
        iconSize: [80, 22], iconAnchor: [40, off + 22],
      }),
    }).addTo(lay);
  });
}
function drawGeoPoints() {
  MAP.L.geo.clearLayers();
  const add = (pt, rad, emoji) => {
    if (!pt) return;
    L.circle([pt.lat, pt.lon], { radius: rad * 1000, color: cssVar('--condo'), weight: 1.5, dashArray: '5 5', fillColor: cssVar('--condo'), fillOpacity: .06 }).addTo(MAP.L.geo);
    L.marker([pt.lat, pt.lon], { icon: L.divIcon({ className: 'geo-pin2', html: `<span>${emoji}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(MAP.L.geo).bindTooltip(pt.name, { direction: 'top', offset: [0, -12] });
  };
  add(S.A, S.radA, '🏠'); add(S.B, S.radB, '💼');
}

function drawMap(f) {
  if (!MAP.inited) return;
  drawBoundaries();
  drawListings(f);
  drawGeoPoints();
  renderMapFacts(f);
  renderMapLegend(S.colorBy, f, LINE_COLORS());
}

function refreshMapTheme() { if (MAP.inited) { setTiles(); drawRail(); drawStations(); } }
function fitAll() { if (MAP.map) MAP.map.fitBounds(regionBounds(), { padding: [12, 12] }); }
function fitToSelection() {
  if (!MAP.map) return;
  const pts = [S.A, S.B].filter(Boolean);
  if (pts.length) {
    let bnd = null;
    pts.forEach(p => { const bb = L.latLng(p.lat, p.lon).toBounds((p === S.A ? S.radA : S.radB) * 2000); bnd = bnd ? bnd.extend(bb) : bb; });
    MAP.map.fitBounds(bnd, { padding: [24, 24] }); return;
  }
  const sel = [...S.munis].map(s => S.geo[s]).filter(Boolean);
  if (!sel.length || sel.length === S.meta.municipalities.length) { fitAll(); return; }
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  sel.forEach(g => { a = Math.min(a, g.bbox[1]); b = Math.min(b, g.bbox[0]); c = Math.max(c, g.bbox[3]); d = Math.max(d, g.bbox[2]); });
  MAP.map.fitBounds([[a, b], [c, d]], { padding: [18, 18] });
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
  if (nearMed && farMed) { const prem = Math.round((nearMed / farMed - 1) * 100); facts.push(['Nær S-tog vs. længere væk', `${m2(nearMed)} <small>mod ${m2(farMed)}</small>`]); facts.push(['S-togs­præmie', (prem >= 0 ? '+' : '') + prem + ' <small>% pr. m²</small>']); }
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
