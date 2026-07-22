'use strict';

/* ===================== state & helpers ===================== */
const S = {
  meta: null, all: [], type: 'condo', munis: new Set(), nearS: false,
  priceMax: null, rooms: null, search: '', colorBy: 'm2p', sort: 'd', shown: 60,
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

const kr = n => n == null ? '–' : (n).toLocaleString('da-DK') + ' kr';
const krM = n => n == null ? '–' : (n >= 1e6 ? (n / 1e6).toLocaleString('da-DK', { maximumFractionDigits: 2 }) + ' mio. kr'
  : Math.round(n / 1000).toLocaleString('da-DK') + '.000 kr');
const m2 = n => n == null ? '–' : Math.round(n).toLocaleString('da-DK') + ' kr/m²';
const num = n => n == null ? '–' : Math.round(n).toLocaleString('da-DK');
const median = arr => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const quantile = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const p = (a.length - 1) * q, lo = Math.floor(p); return a[lo] + (a[lo + 1] - a[lo] || 0) * (p - lo); };

/* ===================== load ===================== */
async function boot() {
  document.getElementById('map').innerHTML = '<div class="loading">Henter boligdata…</div>';
  try {
    const [meta, listings] = await Promise.all([
      fetch('data/meta.json').then(r => r.json()),
      fetch('data/listings.json').then(r => r.json()),
    ]);
    S.meta = meta; S.all = listings;
    meta.municipalities.forEach(m => S.munis.add(m.slug));
    initUI();
    render();
  } catch (e) {
    document.getElementById('map').innerHTML = '<div class="loading">Kunne ikke hente data.</div>';
    console.error(e);
  }
}

/* ===================== UI wiring ===================== */
function initUI() {
  const upd = new Date(S.meta.generatedAt);
  $('#updated').textContent = 'Opdateret ' + upd.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' }) +
    ' · ' + S.meta.total.toLocaleString('da-DK') + ' boliger';
  $('#nearSHint').textContent = '(≤ ' + S.meta.strainNearM + ' m)';

  // type segments
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
    S.shown = 60; render();
  });
  wrap.append(allBtn);
  S.meta.municipalities.forEach(m => {
    const c = el('span', { class: 'chip on' }, m.name);
    c.addEventListener('click', () => {
      if (S.munis.has(m.slug)) S.munis.delete(m.slug); else S.munis.add(m.slug);
      S.shown = 60; render();
    });
    c._slug = m.slug; wrap.append(c);
  });

  const bind = (id, key, fn) => $(id).addEventListener(fn === 'input' ? 'input' : 'change', e => {
    S[key] = e.target.type === 'checkbox' ? e.target.checked : (e.target.value || null);
    if (key === 'priceMax') S.priceMax = e.target.value ? +e.target.value : null;
    if (key === 'rooms') S.rooms = e.target.value ? +e.target.value : null;
    S.shown = 60; render();
  });
  bind('#nearS', 'nearS'); bind('#priceMax', 'priceMax'); bind('#rooms', 'rooms');
  bind('#colorBy', 'colorBy'); bind('#sort', 'sort');
  $('#search').addEventListener('input', e => { S.search = e.target.value.toLowerCase().trim(); S.shown = 60; render(); });
  $('#loadMore').addEventListener('click', () => { S.shown += 60; renderCards(filtered()); });

  // theme
  const tt = $('#themeToggle');
  const saved = localStorage.getItem('hbTheme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  tt.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur ? cur === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('hbTheme', next);
    render(); // recolour SVGs from CSS vars
  });
}

/* ===================== filtering ===================== */
function filtered() {
  return S.all.filter(r => {
    if (S.type !== 'all' && r.t !== S.type) return false;
    if (!S.munis.has(r.muni)) return false;
    if (S.nearS && !r.near) return false;
    if (S.priceMax && r.p > S.priceMax) return false;
    if (S.rooms && (r.r || 0) < S.rooms) return false;
    if (S.search) {
      const hay = (r.adr + ' ' + r.city + ' ' + r.zip + ' ' + (r.ssn || '')).toLowerCase();
      if (!hay.includes(S.search)) return false;
    }
    return true;
  });
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ===================== master render ===================== */
function render() {
  // sync chip visuals
  [...$('#muniChips').children].forEach(c => {
    if (c._slug) c.classList.toggle('on', S.munis.has(c._slug));
    else c.classList.toggle('on', S.munis.size === S.meta.municipalities.length);
  });
  const f = filtered();
  renderKPIs(f);
  renderMuniChart(f);
  renderDistChart(f);
  renderDaysChart(f);
  renderMap(f);
  renderCards(f);
}

/* ===================== KPIs ===================== */
function renderKPIs(f) {
  const prices = f.map(r => r.p).filter(Boolean);
  const m2p = f.map(r => r.m2p).filter(Boolean);
  const days = f.map(r => r.d).filter(v => v != null);
  const cuts = f.filter(r => r.chg < 0);
  const cutPct = f.length ? Math.round(cuts.length / f.length * 100) : 0;
  const nearPct = f.length ? Math.round(f.filter(r => r.near).length / f.length * 100) : 0;
  const kpis = [
    { label: 'Boliger til salg', val: f.length.toLocaleString('da-DK'), sub: S.type === 'all' ? 'ejerlejl. + villaer' : (S.type === 'condo' ? 'ejerlejligheder' : 'villaer') },
    { label: 'Median pris', val: krM(median(prices)), sub: prices.length ? kr(Math.round(quantile(prices, .25))) + ' – ' + kr(Math.round(quantile(prices, .75))) : '' },
    { label: 'Median pris/m²', val: m2(median(m2p)), sub: 'typisk kvadratmeterpris' },
    { label: 'Median liggetid', val: median(days) != null ? Math.round(median(days)) + ' <small>dage</small>' : '–', sub: 'til salg på boligsiden', html: true },
    { label: 'Med prisnedsættelse', val: cutPct + ' <small>%</small>', sub: nearPct + ' % ligger nær S-tog', html: true },
  ];
  const box = $('#kpis'); box.innerHTML = '';
  kpis.forEach(k => box.append(el('div', { class: 'kpi' },
    el('div', { class: 'k-label' }, k.label),
    el('div', { class: 'k-val', html: k.val }),
    el('div', { class: 'k-sub' }, k.sub || ''),
  )));
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
  // rows: [{label, value, n, color}]
  mount.innerHTML = '';
  if (!rows.length) { mount.append(el('div', { class: 'loading' }, 'Ingen data for det valgte filter.')); return; }
  const W = 640, rowH = 26, padL = 132, padR = 60, padT = 6, padB = 4;
  const H = padT + padB + rows.length * rowH;
  const max = Math.max(...rows.map(r => r.value)) * 1.02 || 1;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const plotW = W - padL - padR;
  rows.forEach((r, i) => {
    const y = padT + i * rowH;
    const bw = Math.max(2, r.value / max * plotW);
    const g = svel('g', { class: 'bar-row' });
    const lbl = svel('text', { x: padL - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'bar-lbl' });
    lbl.textContent = r.label; g.append(lbl);
    const rect = svel('rect', { x: padL, y: y + 4, width: bw, height: rowH - 10, rx: 4, fill: r.color || cssVar('--condo') });
    g.append(rect);
    const val = svel('text', { x: padL + bw + 7, y: y + rowH / 2 + 4, class: 'bar-val' });
    val.textContent = opt.fmt ? opt.fmt(r.value) : num(r.value); g.append(val);
    g.addEventListener('mousemove', e => showTip(
      `<div class="tt-title">${r.label}</div>` +
      `<div class="tt-row"><span>${opt.vlabel || 'Værdi'}</span><b>${opt.fmt ? opt.fmt(r.value) : num(r.value)}</b></div>` +
      (r.n != null ? `<div class="tt-row"><span>Antal boliger</span><b>${r.n}</b></div>` : ''), e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
    svg.append(g);
  });
  mount.append(svg);
}

function renderMuniChart(f) {
  const byM = new Map();
  f.forEach(r => { (byM.get(r.muni) || byM.set(r.muni, []).get(r.muni)).push(r.m2p); });
  const names = Object.fromEntries(S.meta.municipalities.map(m => [m.slug, m.name]));
  const rows = [...byM.entries()]
    .map(([slug, arr]) => ({ label: names[slug] || slug, value: Math.round(median(arr.filter(Boolean))), n: arr.length }))
    .filter(r => r.value)
    .sort((a, b) => b.value - a.value);
  rows.forEach(r => r.color = cssVar('--condo'));
  hbars($('#chartMuni'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

function renderDistChart(f) {
  const buckets = [
    { label: '0–500 m', lo: 0, hi: 500 },
    { label: '500 m–1 km', lo: 500, hi: 1000 },
    { label: '1–2 km', lo: 1000, hi: 2000 },
    { label: '2–4 km', lo: 2000, hi: 4000 },
    { label: 'over 4 km', lo: 4000, hi: Infinity },
  ];
  const rows = buckets.map(b => {
    const arr = f.filter(r => r.sst >= b.lo && r.sst < b.hi).map(r => r.m2p).filter(Boolean);
    return { label: b.label, value: Math.round(median(arr) || 0), n: arr.length, color: cssVar('--condo') };
  }).filter(r => r.n);
  hbars($('#chartDist'), rows, { fmt: m2, vlabel: 'Median pris/m²' });
}

function renderDaysChart(f) {
  // histogram of days on market
  const days = f.map(r => r.d).filter(v => v != null);
  const mount = $('#chartDays'); mount.innerHTML = '';
  if (!days.length) { mount.append(el('div', { class: 'loading' }, 'Ingen data.')); return; }
  const edges = [0, 14, 30, 60, 90, 120, 180, 270, 365, Infinity];
  const labels = ['<2 uger', '2–4 uger', '1–2 mdr', '2–3 mdr', '3–4 mdr', '4–6 mdr', '6–9 mdr', '9–12 mdr', '>1 år'];
  const counts = new Array(labels.length).fill(0);
  days.forEach(d => { for (let i = 0; i < edges.length - 1; i++) if (d >= edges[i] && d < edges[i + 1]) { counts[i]++; break; } });
  const W = 640, H = 220, padL = 34, padR = 12, padT = 10, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...counts) || 1;
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  // gridlines
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - g / 4 * plotH;
    svg.append(svel('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'gridline' }));
    const t = svel('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-txt' }); t.textContent = Math.round(max * g / 4); svg.append(t);
  }
  const bw = plotW / counts.length;
  counts.forEach((c, i) => {
    const h = c / max * plotH, x = padL + i * bw, y = padT + plotH - h;
    const rect = svel('rect', { x: x + bw * .14, y, width: bw * .72, height: h, rx: 4, fill: cssVar('--condo') });
    const g = svel('g'); g.append(rect);
    g.addEventListener('mousemove', e => showTip(`<div class="tt-title">${labels[i]}</div><div class="tt-row"><span>Boliger</span><b>${c}</b></div><div class="tt-row"><span>Andel</span><b>${Math.round(c / days.length * 100)} %</b></div>`, e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
    svg.append(g);
    const lt = svel('text', { x: x + bw / 2, y: H - padB + 15, 'text-anchor': 'middle', class: 'axis-txt' });
    lt.textContent = labels[i]; lt.setAttribute('transform', `rotate(-30 ${x + bw / 2} ${H - padB + 15})`); svg.append(lt);
  });
  mount.append(svg);
}

/* ===================== colour scales ===================== */
function seqRamp() { return ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6'].map(cssVar); }
function makeScale(vals, invert = false) {
  const lo = quantile(vals, .05), hi = quantile(vals, .95);
  const ramp = seqRamp();
  return v => {
    if (v == null) return cssVar('--muted');
    let t = (v - lo) / (hi - lo || 1); t = Math.max(0, Math.min(1, t)); if (invert) t = 1 - t;
    return ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
  };
}

/* ===================== MAP ===================== */
function renderMap(f) {
  const mount = $('#map'); mount.innerHTML = '';
  const stations = S.meta.stations, lines = S.meta.lines;
  // bounds from stations (stable frame regardless of filter)
  const lats = stations.map(s => s.lat), lons = stations.map(s => s.lon);
  let latMin = Math.min(...lats), latMax = Math.max(...lats), lonMin = Math.min(...lons), lonMax = Math.max(...lons);
  const latPad = (latMax - latMin) * .04, lonPad = (lonMax - lonMin) * .04;
  latMin -= latPad; latMax += latPad; lonMin -= lonPad; lonMax += lonPad;
  const latMid = (latMin + latMax) / 2, kx = Math.cos(latMid * Math.PI / 180);
  const W = 900, pad = 26;
  const geoW = (lonMax - lonMin) * kx, geoH = (latMax - latMin);
  const H = Math.round((W - 2 * pad) * geoH / geoW + 2 * pad);
  const X = lon => pad + (lon - lonMin) * kx / geoW * (W - 2 * pad);
  const Y = lat => pad + (latMax - lat) / geoH * (H - 2 * pad);
  const svg = svel('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Kort over boliger og S-togsnettet' });

  const lineColors = {
    central: cssVar('--ink-2'), hilleroed: cssVar('--condo'), klampenborg: '#1baf7a',
    farum: '#4a3aa7', frederikssund: '#eda100', kystbanen: cssVar('--muted'),
  };
  const stMap = Object.fromEntries(stations.map(s => [s.name, s]));

  // ---- rail lines ----
  const gLines = svel('g', {});
  lines.forEach(L => {
    const pts = L.stops.map(n => stMap[n]).filter(Boolean).map(s => `${X(s.lon).toFixed(1)},${Y(s.lat).toFixed(1)}`).join(' ');
    gLines.append(svel('polyline', {
      points: pts, fill: 'none', stroke: lineColors[L.corridor], 'stroke-width': 3,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .55,
      'stroke-dasharray': L.corridor === 'kystbanen' ? '2 6' : '',
    }));
  });
  svg.append(gLines);

  // ---- listing dots ----
  const colorBy = S.colorBy;
  let scale, cAcc;
  if (colorBy === 'type') { cAcc = r => r.t === 'villa' ? cssVar('--villa') : cssVar('--condo'); }
  else {
    const vals = f.map(r => r[colorBy]).filter(v => v != null);
    scale = makeScale(vals, colorBy === 'd'); // invert days so short liggetid = dark/hot
    cAcc = r => scale(r[colorBy]);
  }
  const gDots = svel('g', {});
  // draw densest first isn't needed; cap radius small
  f.forEach(r => {
    const c = svel('circle', { cx: X(r.lon).toFixed(1), cy: Y(r.lat).toFixed(1), r: 2.4, fill: cAcc(r), class: 'listing-dot' });
    c._r = r; gDots.append(c);
  });
  svg.append(gDots);
  gDots.addEventListener('mousemove', e => {
    const t = e.target; if (t.tagName !== 'circle' || !t._r) return; const r = t._r;
    t.setAttribute('r', 4.2);
    showTip(
      `<div class="tt-title">${r.adr}</div>` +
      `<div class="tt-row"><span>${r.city}</span><b>${r.t === 'villa' ? 'Villa' : 'Ejerlejl.'}</b></div>` +
      `<div class="tt-row"><span>Pris</span><b>${krM(r.p)}</b></div>` +
      `<div class="tt-row"><span>Pris/m²</span><b>${m2(r.m2p)}</b></div>` +
      `<div class="tt-row"><span>Størrelse</span><b>${r.a} m² · ${r.r} vær.</b></div>` +
      `<div class="tt-row"><span>Liggetid</span><b>${r.d} dage</b></div>` +
      `<div class="tt-row"><span>S-tog</span><b>${r.ssn} ${r.sst} m</b></div>`, e.clientX, e.clientY);
  }, true);
  gDots.addEventListener('mouseout', e => { if (e.target.tagName === 'circle') e.target.setAttribute('r', 2.4); hideTip(); }, true);
  gDots.addEventListener('click', e => { const t = e.target; if (t._r && t._r.url) window.open(t._r.url, '_blank', 'noopener'); });

  // ---- stations ----
  const bigStations = new Set(['København H', 'Hellerup', 'Nørreport', 'Lyngby', 'Holte', 'Birkerød', 'Allerød',
    'Hillerød', 'Farum', 'Værløse', 'Ballerup', 'Herlev', 'Klampenborg', 'Charlottenlund', 'Gentofte',
    'Bagsværd', 'Rungsted Kyst', 'Nivå', 'Ordrup', 'Buddinge']);
  const gSt = svel('g', {});
  stations.forEach(s => {
    const cx = X(s.lon), cy = Y(s.lat);
    const dot = svel('circle', { cx, cy, r: s.strain ? 3 : 2.6, class: 'st-dot', stroke: lineColors[s.corridor] });
    gSt.append(dot);
    if (bigStations.has(s.name)) {
      const tx = svel('text', { x: cx + 5, y: cy + 3, class: 'st-label' }); tx.textContent = s.name; gSt.append(tx);
    }
  });
  svg.append(gSt);
  mount.append(svg);

  renderMapFacts(f);
  renderMapLegend(colorBy, f, lineColors);
}

function renderMapFacts(f) {
  const box = $('#mapFacts'); box.innerHTML = '';
  if (!f.length) return;
  const names = Object.fromEntries(S.meta.municipalities.map(m => [m.slug, m.name]));
  const byM = new Map();
  f.forEach(r => { (byM.get(r.muni) || byM.set(r.muni, []).get(r.muni)).push(r.m2p); });
  const meds = [...byM.entries()].map(([s, a]) => ({ n: names[s] || s, v: median(a.filter(Boolean)) }))
    .filter(x => x.v).sort((a, b) => b.v - a.v);
  const nearArr = f.filter(r => r.near).map(r => r.m2p).filter(Boolean);
  const farArr = f.filter(r => !r.near).map(r => r.m2p).filter(Boolean);
  const nearMed = median(nearArr), farMed = median(farArr);
  const facts = [];
  if (meds.length) facts.push(['Dyreste kommune', `${meds[0].n} · ${m2(meds[0].v)}`]);
  if (meds.length > 1) facts.push(['Billigste kommune', `${meds[meds.length - 1].n} · ${m2(meds[meds.length - 1].v)}`]);
  if (nearMed && farMed) {
    const prem = Math.round((nearMed / farMed - 1) * 100);
    facts.push(['Nær S-tog vs. længere væk', `${m2(nearMed)} <small>mod ${m2(farMed)}</small>`]);
    facts.push(['S-togs­premie', (prem >= 0 ? '+' : '') + prem + ' <small>% pr. m²</small>']);
  }
  facts.forEach(([l, v]) => box.append(el('div', { class: 'mf' },
    el('div', { class: 'mf-l' }, l), el('div', { class: 'mf-v', html: v }))));
}

function renderMapLegend(colorBy, f, lineColors) {
  const box = $('#mapLegend'); box.innerHTML = '';
  if (colorBy === 'type') {
    box.append(legItem(cssVar('--condo'), 'Ejerlejlighed'), legItem(cssVar('--villa'), 'Villa'));
  } else {
    const vals = f.map(r => r[colorBy]).filter(v => v != null);
    const lo = quantile(vals, .05), hi = quantile(vals, .95);
    const fmt = colorBy === 'm2p' ? m2 : colorBy === 'p' ? krM : v => Math.round(v) + ' dage';
    const ramp = el('span', { class: 'ramp' });
    let steps = seqRamp(); if (colorBy === 'd') steps = [...steps].reverse();
    steps.forEach(c => ramp.append(el('i', { style: `background:${c}` })));
    const label = colorBy === 'm2p' ? 'Pris pr. m²' : colorBy === 'p' ? 'Pris' : 'Liggetid';
    box.append(el('span', { class: 'legend-item' }, label + ':'),
      el('span', { class: 'legend-item' }, colorBy === 'd' ? 'kort' : (fmt(lo))), ramp,
      el('span', { class: 'legend-item' }, colorBy === 'd' ? 'lang' : (fmt(hi))));
  }
  // rail line legend
  const seen = new Set();
  S.meta.lines.forEach(L => {
    const key = L.corridor === 'kystbanen' ? 'kyst' : (L.corridor === 'central' ? 'central' : 'strain');
    box.append(el('span', { class: 'legend-item' },
      el('span', { class: 'legend-line' + (L.corridor === 'kystbanen' ? ' dashed' : ''), style: `border-top-color:${lineColors[L.corridor]}` }),
      L.label));
  });
}
function legItem(color, text) { return el('span', { class: 'legend-item' }, el('span', { class: 'swatch', style: `background:${color}` }), text); }

/* ===================== listing cards ===================== */
function sortRows(f) {
  const s = S.sort;
  const cmp = {
    d: (a, b) => a.d - b.d,
    m2p: (a, b) => a.m2p - b.m2p,
    m2p_desc: (a, b) => b.m2p - a.m2p,
    p: (a, b) => a.p - b.p,
    p_desc: (a, b) => b.p - a.p,
    sst: (a, b) => a.sst - b.sst,
    chg: (a, b) => (a.chg || 0) - (b.chg || 0),
  }[s];
  return [...f].sort(cmp);
}
function renderCards(f) {
  const rows = sortRows(f);
  $('#listCount').textContent = '· ' + f.length.toLocaleString('da-DK');
  const box = $('#cards'); box.innerHTML = '';
  rows.slice(0, S.shown).forEach(r => box.append(card(r)));
  const more = $('#loadMore'); more.hidden = rows.length <= S.shown;
  more.textContent = `Vis flere (${(rows.length - S.shown).toLocaleString('da-DK')} tilbage)`;
}
function card(r) {
  const a = el('a', { class: 'lcard', href: r.url || '#', target: '_blank', rel: 'noopener' });
  const thumb = el('div', { class: 'thumb' });
  if (r.img) thumb.style.backgroundImage = `url("${r.img}")`;
  thumb.append(el('span', { class: 'badge ' + r.t }, r.t === 'villa' ? 'Villa' : 'Ejerlejl.'));
  const near = r.near;
  thumb.append(el('span', { class: 'stbadge' + (near ? ' near' : '') }, `${near ? '🚆 ' : ''}${r.ssn} · ${(r.sst / 1000).toLocaleString('da-DK', { maximumFractionDigits: 1 })} km`));
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
  body.append(meta);
  a.append(body);
  return a;
}

boot();
