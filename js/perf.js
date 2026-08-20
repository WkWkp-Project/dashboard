// ============================================================================
// perf.js — Section C (Performance & Ad Results) helpers, extracted from
// index.html for modularity. Loaded via <script src> AFTER the main inline
// script, so a syntax error here can no longer take the whole app down with it.
//
// These are classic (non-module) scripts sharing the global scope, exactly like
// js/control.js. Functions here may reference globals defined in index.html
// (campaigns, escapeHtml, showToast, …) — that is safe because every reference
// resolves at call time, by which point both scripts have finished loading.
//
// STEP 1 of an incremental split: only the pure date helpers move first, to
// prove the load/order mechanism against the full test suite before larger
// blocks follow.
// ============================================================================

// 'YYYY-MM' month key from a start date ('' if unparseable).
function perfMonthKey(dateStr) {
  const s = String(dateStr || '').slice(0,7);
  return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

const PERF_MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
// Normalize a messy date cell to 'YYYY-MM-DD'. Handles ISO (YYYY-MM-DD / with a
// time suffix), year-first slash, day/month-first slash or dash with 2- OR
// 4-digit year (DD/MM/YYYY, common in Thai/EU FB exports), month-name dates
// ("Jul 1, 2026", "1-Jul-2026"), and bare Excel serial numbers (from .xlsx).
// Slash dates default to DAY-first; if the 2nd part is >12 it must be the day,
// so we swap. Returns '' when nothing parses.
function perfNormDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  const p2 = n => (n < 10 ? '0' : '') + n;
  const yr = y => { y = +y; return y < 100 ? 2000 + y : y; };
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);              // year-first ISO-ish
  if (m) { const mo=+m[2], d=+m[3]; if (mo>=1&&mo<=12&&d>=1&&d<=31) return `${m[1]}-${p2(mo)}-${p2(d)}`; }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);              // day/month-first, 2- or 4-digit year
  if (m) {
    let d=+m[1], mo=+m[2]; const y=yr(m[3]);
    if (mo>12 && d<=12) { const t=d; d=mo; mo=t; }                     // 2nd part >12 → it's the day
    if (mo>=1&&mo<=12&&d>=1&&d<=31) return `${y}-${p2(mo)}-${p2(d)}`;
  }
  const mn = s.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);  // month-name
  if (mn) {
    const mo = PERF_MONTHS[mn[1]];
    const nums = s.match(/\d+/g) || [];
    let year = null, day = null;
    nums.forEach(n => { if (n.length >= 4) year = +n; });
    for (const n of nums) { if (n.length < 4 && +n>=1 && +n<=31) { day = +n; break; } }
    if (!year) for (const n of nums) { if (n.length <= 2 && +n>31) year = yr(n); }
    if (year && day) return `${year}-${p2(mo)}-${p2(day)}`;
  }
  if (/^\d{4,6}$/.test(s)) {                                           // bare Excel serial
    const n = +s;
    if (n >= 20000 && n <= 60000) return new Date(Date.UTC(1899,11,30) + n*86400000).toISOString().slice(0,10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0,10)) ? s.slice(0,10) : '';
}


// ==== STEP 2: constants + pure compute/format helpers ====

// Metrics grouped under the app's Catch · Connect · Convert concept (same as
// Section A/B). Cost / Derived stays its own group. catch=awareness,
// connect=engagement/interaction, convert=outcome/results.
const PERF_METRICS = [
  { key:'spend',       label:'Spend ฿',    group:'cost',    fmt:'money', aliases:['amount spent','amount spent (thb)','amount_spent','spend'] },
  { key:'reach',       label:'Reach',      group:'catch',   fmt:'int',   aliases:['reach'] },
  { key:'impressions', label:'Impr.',      group:'catch',   fmt:'int',   aliases:['impressions','impr'] },
  { key:'video_views', label:'Video View', group:'catch',   fmt:'int',   aliases:['video views','video plays','3-second video plays','thruplays','video_views'] },
  { key:'likes',       label:'Likes',      group:'connect', fmt:'int',   aliases:['likes','post reactions','reactions'] },
  { key:'comments',    label:'Comments',   group:'connect', fmt:'int',   aliases:['comments','post comments'] },
  { key:'shares',      label:'Shares',     group:'connect', fmt:'int',   aliases:['shares','post shares'] },
  { key:'saves',       label:'Saves',      group:'connect', fmt:'int',   aliases:['saves','saved'] },
  { key:'reposts',     label:'Reposts',    group:'connect', fmt:'int',   aliases:['reposts'] },
  { key:'engagement',  label:'Engage',     group:'connect', fmt:'int',   aliases:['post engagements','engagement','engagements'] },
  { key:'traffic',     label:'Traffic',    group:'connect', fmt:'int',   aliases:['link clicks','traffic','clicks'] },
  { key:'leads',       label:'Leads',      group:'convert', fmt:'int',   aliases:['leads','on-facebook leads'] },
  { key:'sales',       label:'Sales',      group:'convert', fmt:'int',   aliases:['sales'] },
  { key:'purchases',   label:'Purchases',  group:'convert', fmt:'int',   aliases:['purchases','website purchases'] },
  { key:'conversions', label:'Results',    group:'convert', fmt:'int',   aliases:['results','conversions'] },
  { key:'value',       label:'Value ฿',    group:'convert', fmt:'money', aliases:['purchase conversion value','conversion value','value'] },
];
const METRIC_DEFS = PERF_METRICS.reduce((o,m) => { o[m.key] = m; return o; }, {});
// Derived columns shown at the end of the Cost group (computed, never stored).
const PERF_DERIVED = [
  { key:'cpm',  label:'CPM',  fmt:'money' },
  { key:'ctr',  label:'CTR',  fmt:'pct'   },
  { key:'roas', label:'ROAS', fmt:'x'     },
];
// Objective → cat-pill colour class (reuse the app's catch/connect/convert).
const PERF_OBJECTIVES = {
  reach:      { label:'Reach',      cls:'catch'   },
  engagement: { label:'Engagement', cls:'connect' },
  traffic:    { label:'Traffic',    cls:'catch'   },
  conversion: { label:'Conversion', cls:'convert' },
  sales:      { label:'Sales',      cls:'convert' },
  '':         { label:'—',          cls:'connect' }
};
const PERF_GROUPS = ['catch','connect','convert','cost'];
const PERF_GROUP_LABEL = { catch:'Catch', connect:'Connect', convert:'Convert', cost:'Cost / Derived' };

// header-name candidates for the non-metric columns
const PERF_ID_HEADERS      = ['id','asset_id','asset id','assetid'];
const PERF_START_HEADERS   = ['period_start','reporting starts','start','date','day','date_start'];
const PERF_END_HEADERS     = ['period_end','reporting ends','end','date_end'];
const PERF_OBJ_HEADERS     = ['objective','objectives'];
const PERF_CHANNEL_HEADERS = ['type','channel','source','organic/ads','ads/organic','paid/organic'];
const PERF_NAME_HEADERS    = ['ad name','ad_name','adname','ชื่อโฆษณา','ชื่อแอด','name','asset','ad'];
// Cell value → channel. Organic keywords win; everything else (incl. blank) = ads,
// because FB ad exports are ad rows by default.
function perfChannelOf(v) {
  const s = String(v||'').trim().toLowerCase();
  if (/organic|organics|reach เพจ|เพจ|โพสต์ปกติ|โพสปกติ|non-?paid|unpaid/.test(s)) return 'organic';
  return 'ads';
}

// Pure: derive rate/cost metrics from a raw bag. Missing inputs → key omitted.
// IMPORTANT: rates are computed from the raw sums passed in, never averaged.
function perfDerived(raw) {
  raw = raw || {};
  const n = k => (+raw[k] || 0);
  const spend=n('spend'), impr=n('impressions'), reach=n('reach'),
        eng=n('engagement'), traffic=n('traffic'), vv=n('video_views'),
        leads=n('leads'), purch=n('purchases'), value=n('value');
  const d = {};
  if (impr)  { if (reach) d.frequency = impr/reach; d.cpm = spend/impr*1000; d.ctr = traffic/impr; d.vtr = vv/impr; }
  if (eng)   { if (reach) d.eng_rate = eng/reach; d.cpe = spend/eng; }
  if (traffic) d.cpc = spend/traffic;
  if (leads)   d.cpl = spend/leads;
  if (purch)   d.cpa = spend/purch;
  if (value && spend) d.roas = value/spend;
  return d;
}

// Sum a list of raw bags into one (canonical keys + present values only).
function perfSumRaw(rawList) {
  const out = {};
  (rawList || []).forEach(raw => {
    if (!raw) return;
    Object.keys(METRIC_DEFS).forEach(k => {
      if (raw[k] != null && !isNaN(+raw[k])) out[k] = (out[k] || 0) + (+raw[k]);
    });
  });
  return out;
}

// Numeric-equality compare of two raw metric bags (canonical keys only).
// Used to tell a re-import apart: same key + same numbers = duplicate (skip),
// same key + different numbers = update (overwrite). Never double-counts.
function perfRawEqual(a, b) {
  a = a || {}; b = b || {};
  const keys = new Set(Object.keys(a).concat(Object.keys(b)).filter(k => METRIC_DEFS[k]));
  for (const k of keys) {
    const va = (a[k] == null || a[k] === '' || isNaN(+a[k])) ? null : +a[k];
    const vb = (b[k] == null || b[k] === '' || isNaN(+b[k])) ? null : +b[k];
    if (va !== vb) return false;
  }
  return true;
}

// Validate one staged import row → array of human-readable warnings (Thai).
// Warnings only — they never block the import, but every one is surfaced in
// the preview so a bad paste is caught before it reaches Drive.
function perfRowIssues(m) {
  const issues = [];
  const dRe = /^\d{4}-\d{2}-\d{2}$/;
  const hasMetric = Object.keys(m.raw || {}).length > 0;
  if (m.start && !dRe.test(m.start)) issues.push('วันเริ่มรันผิดรูปแบบ (ต้องเป็น YYYY-MM-DD)');
  if (m.end && !dRe.test(m.end))     issues.push('วันสิ้นสุดผิดรูปแบบ (ต้องเป็น YYYY-MM-DD)');
  if (dRe.test(m.start) && dRe.test(m.end) && m.end < m.start) issues.push('วันสิ้นสุดมาก่อนวันเริ่มรัน');
  if (hasMetric && !m.start) issues.push('ไม่มีวันเริ่มรัน — จะกรองตามเดือนไม่เจอ');
  if (!hasMetric)            issues.push('ไม่มีค่า metric ที่อ่านได้ในแถวนี้');
  Object.keys(m.raw || {}).forEach(k => {
    if (+m.raw[k] < 0) issues.push((METRIC_DEFS[k] ? METRIC_DEFS[k].label : k) + ' เป็นค่าติดลบ');
  });
  return issues;
}

// Funnel rank for objective ordering within a creative block: Catch(reach/
// traffic)=1, Connect(engagement)=2, Convert(conversion/sales)=3, unknown=4.
function perfObjRank(objective) {
  const o = PERF_OBJECTIVES[objective] || PERF_OBJECTIVES[''];
  return o.cls === 'catch' ? 1 : o.cls === 'connect' ? 2 : o.cls === 'convert' ? 3 : 4;
}

// --- formatting ---
function perfFmt(v, fmt) {
  if (v == null || isNaN(v)) return '<span class="perf-na">—</span>';
  if (fmt === 'money') return '฿' + Math.round(v).toLocaleString('en-US');
  if (fmt === 'pct')   return (v*100).toFixed(1) + '%';
  if (fmt === 'x')     return v.toFixed(1) + '×';
  return Math.round(v).toLocaleString('en-US');
}
function perfCompact(v) {
  v = +v || 0;
  if (v >= 1e6) return (v/1e6).toFixed(v>=1e7?0:1) + 'M';
  if (v >= 1e3) return (v/1e3).toFixed(v>=1e4?0:1) + 'K';
  return String(Math.round(v));
}
function perfDateLabel(periods) {
  const starts = periods.map(p=>p.start).filter(Boolean).sort();
  const ends   = periods.map(p=>p.end||p.start).filter(Boolean).sort();
  if (!starts.length) return '';
  const f = s => { const d = new Date(s+'T00:00:00'); return isNaN(d.getTime()) ? s : d.toLocaleDateString('th-TH',{day:'numeric',month:'short'}); };
  const a = f(starts[0]), b = ends.length ? f(ends[ends.length-1]) : '';
  return (b && b !== a) ? (a + '–' + b) : a;
}


// ==== STEP 3: CSV/number parse + header/name mappers ====

// RFC-4180-ish CSV parser: handles quoted fields, embedded commas/newlines,
// and "" escapes. Returns array of string-arrays; blank rows dropped.
function parsePerfCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') { /* ignore */ }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// Parse a messy numeric cell ("1,200 ฿", "2.9%") → number or null.
function perfParseNum(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === '') return null;
  s = s.replace(/[,\s฿%]/g, '').replace(/[^\d.\-]/g, '');
  if (s === '' || s === '-' || isNaN(+s)) return null;
  return +s;
}
// FB column header → canonical metric key (exact key OR alias; else null).
function perfMapMetricHeader(h) {
  const n = String(h || '').trim().toLowerCase();
  if (!n) return null;
  if (METRIC_DEFS[n]) return n;
  for (const m of PERF_METRICS) { if (m.aliases && m.aliases.indexOf(n) >= 0) return m.key; }
  return null;
}

// Find any known asset id that appears as a substring of a free-text cell
// (e.g. FB "Ad name" that embeds the id). Longest id first so a longer id
// wins over a shorter one it contains. Returns the asset or null.
function perfMatchByName(text, assetsSortedByIdLen) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  for (const a of assetsSortedByIdLen) { if (hay.indexOf(String(a.id).toLowerCase()) >= 0) return a; }
  return null;
}


// ==== STEP 4: state + normalize + rows/blocks + render + import IO + clear ====

// --- module state (never persisted) ---
let _perfMonth = 'all';                                            // 'all' | 'YYYY-MM'
let _perfChannel = 'all';                                          // 'all' | 'ads' | 'organic'
let _perfGroups = new Set(['catch','connect','convert','cost']);   // all on by default
let _perfImportCtx = null;                                         // staged import awaiting confirm
let _perfExpanded = new Set();                                     // asset ids with periods expanded

// Normalize one period from Drive/import. Returns null for junk so a
// half-written object can never poison the table.
function normalizePerfPeriod(p) {
  if (!p || typeof p !== 'object') return null;
  const start = String(p.start || '').slice(0,10);
  const end   = String(p.end   || '').slice(0,10);
  const raw = {};
  const src = (p.raw && typeof p.raw === 'object') ? p.raw : {};
  Object.keys(METRIC_DEFS).forEach(k => {
    const v = src[k];
    if (v != null && v !== '' && !isNaN(+v)) raw[k] = +v;
  });
  if (!start && !Object.keys(raw).length) return null;
  const channel = perfChannelOf(p.channel);
  return { start, end, objective: String(p.objective || ''), channel, raw };
}

// NOTE: perfMonthKey, PERF_MONTHS and perfNormDate moved to js/perf.js
// (loaded via <script src> after this block). Step 1 of the incremental
// Section C extraction — see js/perf.js header.


// One display row per asset for the active month scope. hasData=false → the
// asset has no period in scope and renders as em-dashes (never as zeros).
function perfRowsFor(camp, month, channel) {
  channel = channel || 'all';
  const chOk = p => channel === 'all' || (perfChannelOf(p.channel) === channel);
  const rows = [];
  (camp.assets || []).forEach(a => {
    const periods = ((a.metrics && a.metrics.periods) || []).filter(chOk);
    const inScope = periods.filter(p => month === 'all' || perfMonthKey(p.start) === month);
    const otherMonths = new Set(
      periods.filter(p => inScope.indexOf(p) < 0).map(p => perfMonthKey(p.start)).filter(Boolean)
    );
    if (!inScope.length) { rows.push({ asset:a, hasData:false, raw:{}, periods:[], objective:'', otherMonths, channels:new Set() }); return; }
    const sorted = inScope.slice().sort((x,y) => String(y.start).localeCompare(String(x.start)));
    const withObj = sorted.find(p => p.objective);
    rows.push({
      asset:a, hasData:true,
      raw: perfSumRaw(inScope.map(p => p.raw)),
      periods: sorted,
      objective: withObj ? withObj.objective : '',
      otherMonths,
      channels: new Set(inScope.map(p => perfChannelOf(p.channel)))   // which channels feed this row
    });
  });
  return rows;
}

// Like perfRowsFor, but splits each creative into one entry PER OBJECTIVE
// (periods sharing an objective are summed — same calculation basis), kept as a
// block under the creative. `raw` on the block is the creative overview (sum
// across its objectives). Objectives sorted by funnel, then spend desc.
function perfBlocksFor(camp, month, channel) {
  channel = channel || 'all';
  const chOk = p => channel === 'all' || (perfChannelOf(p.channel) === channel);
  const blocks = [];
  (camp.assets || []).forEach(a => {
    const periods = ((a.metrics && a.metrics.periods) || []).filter(chOk);
    const inScope = periods.filter(p => month === 'all' || perfMonthKey(p.start) === month);
    const otherMonths = new Set(periods.filter(p => inScope.indexOf(p) < 0).map(p => perfMonthKey(p.start)).filter(Boolean));
    if (!inScope.length) { blocks.push({ asset:a, hasData:false, objectives:[], raw:{}, channels:new Set(), otherMonths }); return; }
    const byObj = new Map();
    inScope.forEach(p => { const k = String(p.objective || ''); if (!byObj.has(k)) byObj.set(k, []); byObj.get(k).push(p); });
    const objectives = Array.from(byObj.entries()).map(([objective, ps]) => ({
      objective,
      periods: ps.slice().sort((x,y) => String(y.start).localeCompare(String(x.start))),
      raw: perfSumRaw(ps.map(p => p.raw)),
      channels: new Set(ps.map(p => perfChannelOf(p.channel)))
    }));
    objectives.sort((A,B) => perfObjRank(A.objective) - perfObjRank(B.objective) || ((B.raw.spend||0) - (A.raw.spend||0)));
    blocks.push({
      asset:a, hasData:true, objectives,
      raw: perfSumRaw(inScope.map(p => p.raw)),
      channels: new Set(inScope.map(p => perfChannelOf(p.channel))),
      otherMonths
    });
  });
  return blocks;
}


function setPerfMonth(m) { _perfMonth = m; renderPerfTable(); }
function setPerfChannel(c) { _perfChannel = c; renderPerfTable(); }
function togglePerfGroup(g) { if (_perfGroups.has(g)) _perfGroups.delete(g); else _perfGroups.add(g); renderPerfTable(); }
function togglePerfRow(id) { if (_perfExpanded.has(id)) _perfExpanded.delete(id); else _perfExpanded.add(id); renderPerfTable(); }
// Small channel badge (Ads / Organic / mixed) from a set of channels.
function perfChanBadge(channels) {
  const s = channels instanceof Set ? channels : new Set(channels||[]);
  if (!s.size) return '';
  const cls = c => c === 'organic' ? 'organic' : 'ads';
  if (s.size === 1) { const c = Array.from(s)[0]; return `<span class="perf-chan ${cls(c)}">${c==='organic'?'Organic':'Ads'}</span>`; }
  return `<span class="perf-chan mixed">Ads+Org</span>`;
}

function renderPerfTable() {
  const wrap = document.getElementById('perf-table-wrap');
  if (!wrap) return;                              // Section C markup absent
  const monthbar = document.getElementById('perf-monthbar');
  const tilesEl  = document.getElementById('perf-tiles');
  const camp = getCurrentCampaign();
  if (!camp) {
    wrap.innerHTML = '<div class="perf-empty">เลือกแคมเปญเพื่อดู performance</div>';
    if (monthbar) monthbar.innerHTML = '';
    if (tilesEl)  tilesEl.innerHTML = '';
    return;
  }

  // available months across the campaign
  const monthSet = new Set();
  (camp.assets||[]).forEach(a => ((a.metrics&&a.metrics.periods)||[]).forEach(p => { const m = perfMonthKey(p.start); if (m) monthSet.add(m); }));
  const months = Array.from(monthSet).sort();
  if (_perfMonth !== 'all' && !monthSet.has(_perfMonth)) _perfMonth = 'all';

  // month segmented control
  if (monthbar) {
    const monLabel = m => { const [y,mo] = m.split('-'); const d = new Date(+y, +mo-1, 1); return d.toLocaleDateString('th-TH',{month:'short'}) + ' ' + String(+y+543).slice(-2); };
    let seg = `<button class="${_perfMonth==='all'?'on':''}" onclick="setPerfMonth('all')">ทั้งหมด</button>`;
    months.forEach(m => seg += `<button class="${_perfMonth===m?'on':''}" onclick="setPerfMonth('${m}')">${monLabel(m)}</button>`);
    monthbar.innerHTML = `<span class="lb">ช่วงเวลา</span><div class="perf-seg">${seg}</div>`;
  }

  // channel (Ads / Organic) segmented control — only shown when both exist
  const chanSet = new Set();
  (camp.assets||[]).forEach(a => ((a.metrics&&a.metrics.periods)||[]).forEach(p => chanSet.add(perfChannelOf(p.channel))));
  if (_perfChannel !== 'all' && !chanSet.has(_perfChannel)) _perfChannel = 'all';
  const chanWrap = document.getElementById('perf-chan-toggle');
  const chanBar = document.getElementById('perf-chanbar');
  if (chanWrap && chanBar) {
    if (chanSet.size > 1) {
      chanWrap.style.display = '';
      const cbtn = (v,l) => `<button class="${_perfChannel===v?'on':''}" onclick="setPerfChannel('${v}')">${l}</button>`;
      chanBar.innerHTML = cbtn('all','รวม') + cbtn('ads','Ads') + cbtn('organic','Organic');
    } else {
      chanWrap.style.display = 'none';   // single channel → nothing to toggle
      _perfChannel = 'all';
    }
  }

  // sync column chips to state
  document.querySelectorAll('#perf-chips .perf-chip').forEach(ch => ch.classList.toggle('on', _perfGroups.has(ch.dataset.grp)));

  const rows = perfRowsFor(camp, _perfMonth, _perfChannel);
  const withData = rows.filter(r => r.hasData);
  const totalRaw = perfSumRaw(withData.map(r => r.raw));
  const totalDer = perfDerived(totalRaw);

  // Clear button: visible only when the current scope holds data and the user
  // can edit Section B. Label follows the month filter (all vs one month).
  const clearBtn = document.getElementById('perf-clear-btn');
  if (clearBtn) {
    const canClear = withData.length && canManagePerf();
    clearBtn.style.display = canClear ? '' : 'none';
    const lbl = document.getElementById('perf-clear-label');
    if (lbl) lbl.textContent = _perfMonth === 'all' ? 'ล้างผลทั้งหมด' : 'ล้างเดือนนี้';
  }
  const exportBtn = document.getElementById('perf-export-btn');
  if (exportBtn) exportBtn.style.display = withData.length ? '' : 'none';
  // Import = admin-only (performance numbers are internal). Non-admins still
  // see the table + Export, just not the write path.
  const importBtn = document.getElementById('perf-import-btn');
  if (importBtn) importBtn.style.display = canManagePerf() ? '' : 'none';

  // MoM: when one month is selected, compare against the previous month with
  // data (compact ▲/▼ % on a few tiles). 'all' view shows no delta (no baseline).
  let prevRaw = null, prevDer = null;
  if (_perfMonth !== 'all') {
    const idx = months.indexOf(_perfMonth);
    const prevMonth = idx > 0 ? months[idx-1] : null;
    if (prevMonth) {
      const pr = perfRowsFor(camp, prevMonth, _perfChannel).filter(r => r.hasData);
      if (pr.length) { prevRaw = perfSumRaw(pr.map(r => r.raw)); prevDer = perfDerived(prevRaw); }
    }
  }
  // ▲/▼ badge vs a previous value. higherIsBetter flips the colour for cost-like
  // metrics (a lower CPM month is good → green even though the number dropped).
  const delta = (cur, prev, higherIsBetter) => {
    if (prev == null || prev === 0 || cur == null || isNaN(cur)) return '';
    const pct = (cur - prev) / Math.abs(prev) * 100;
    if (!isFinite(pct) || Math.abs(pct) < 0.5) return ' <span class="perf-mom flat">≈</span>';
    const up = pct > 0, good = higherIsBetter ? up : !up;
    return ` <span class="perf-mom ${good?'up':'down'}">${up?'▲':'▼'}${Math.abs(pct).toFixed(0)}%</span>`;
  };

  // summary tiles (rates from totals)
  if (tilesEl) {
    const tile = (k,v,d,hl) => `<div class="perf-tile${hl?' hl':''}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d||''}</div></div>`;
    const dSpend  = prevRaw ? delta(totalRaw.spend||0, prevRaw.spend||0, true) : '';
    const dResult = prevRaw ? delta(totalRaw.conversions||0, prevRaw.conversions||0, true) : '';
    const dCpm    = prevDer ? delta(totalDer.cpm, prevDer.cpm, false) : '';
    const dRoas   = prevDer ? delta(totalDer.roas, prevDer.roas, true) : '';
    tilesEl.innerHTML =
      tile('ค่าโฆษณา', '<span class="u">฿</span>'+Math.round(totalRaw.spend||0).toLocaleString('en-US'), withData.length+' asset'+dSpend, true) +
      tile('Impressions', perfCompact(totalRaw.impressions), 'Reach '+perfCompact(totalRaw.reach)) +
      tile('Engagement', perfCompact(totalRaw.engagement), 'eng rate '+(totalDer.eng_rate!=null?(totalDer.eng_rate*100).toFixed(1)+'%':'—')) +
      tile('Results', perfCompact(totalRaw.conversions), 'CPA '+(totalDer.cpa!=null?'฿'+totalDer.cpa.toFixed(1):'—')+dResult) +
      tile('CPM', totalDer.cpm!=null?'<span class="u">฿</span>'+totalDer.cpm.toFixed(1):'—', (prevDer?'vs เดือนก่อน':'จากยอดรวม')+dCpm) +
      tile('ROAS', totalDer.roas!=null?totalDer.roas.toFixed(1)+'×':'—', 'Value ฿'+Math.round(totalRaw.value||0).toLocaleString('en-US')+dRoas, true);
  }

  if (!rows.length) { wrap.innerHTML = '<div class="perf-empty">ยังไม่มี asset ในแคมเปญนี้ — เพิ่มงานใน Section B ก่อน</div>'; return; }

  // visible columns, ordered by PERF_GROUPS; cost group = spend + derived
  const visibleGroups = PERF_GROUPS.filter(g => _perfGroups.has(g));
  const colList = [];   // { def, kind:'raw'|'der', first }
  visibleGroups.forEach(g => {
    const metricsInG = PERF_METRICS.filter(m => m.group === g);
    metricsInG.forEach((m,i) => colList.push({ def:m, kind:'raw', first: i===0 }));
    if (g === 'cost') PERF_DERIVED.forEach(m => colList.push({ def:m, kind:'der', first:false }));
  });

  // group header row
  let gh = '<th class="l" colspan="5"></th>';
  visibleGroups.forEach(g => {
    const cnt = PERF_METRICS.filter(m => m.group === g).length + (g==='cost' ? PERF_DERIVED.length : 0);
    if (cnt) gh += `<th class="gh ${g} grp" colspan="${cnt}">${PERF_GROUP_LABEL[g]}</th>`;
  });
  // column header row
  let chh = '<th class="l">Artwork</th><th class="l">ID</th><th class="l">Asset</th><th class="l">ช่วง</th><th class="l">Objective</th>';
  colList.forEach(c => chh += `<th class="${c.first?'grp':''}">${c.def.label}</th>`);

  // stable short ids (in-memory only), same derivation as Section B
  uniqueShortIds(camp.assets, a => a.id, 'A');
  const campLabel = shortId(camp.id, 'C');

  // Render the metric <td>s for one raw bag (+ its derived). Shared by the
  // asset row, each expanded period row, and the per-asset subtotal.
  const metricCells = (raw, hasData, extraCls) => {
    const der = hasData ? perfDerived(raw) : {};
    let out = '';
    colList.forEach(c => {
      const cls = (c.first ? 'grp' : '') + (extraCls ? ' ' + extraCls : '');
      const clsAttr = cls ? ` class="${cls}"` : '';
      if (!hasData) { out += `<td${clsAttr}><span class="perf-na">—</span></td>`; return; }
      if (c.kind === 'raw') {
        const v = raw[c.def.key];
        out += `<td${clsAttr}>${v!=null ? perfFmt(v, c.def.fmt) : '<span class="perf-na">—</span>'}</td>`;
      } else {
        const v = der[c.def.key];
        out += `<td${clsAttr}>${v!=null ? '<span class="perf-derived">'+perfFmt(v, c.def.fmt)+'</span>' : '<span class="perf-na">—</span>'}</td>`;
      }
    });
    return out;
  };

  const canEditPerf = canManagePerf();
  // Identity (thumb + id + name) cells — shown once on a block's first row.
  const identityCells = (a) => {
    const allFiles = (a.files && a.files.length) ? a.files
      : (a.fileData ? [{ name:a.fileName||'file', type:guessMimeFromDataUrl(a.fileData), data:a.fileData }] : []);
    const pf = allFiles.find(f => isImageType(f.type)) || allFiles[0];
    let thumb = '<div class="perf-thumb ph">—</div>';
    if (pf) {
      const src = fileSrcNow(pf);
      if (src && isImageType(pf.type)) thumb = `<img class="perf-thumb" src="${src}" alt="" onclick="openMediaViewer('${a.id}')">`;
      else thumb = `<div class="perf-thumb ph" onclick="openMediaViewer('${a.id}')">${fileIsOnDrive(pf)?'☁️':'📄'}</div>`;
    }
    return `<td class="l">${thumb}</td>` +
      `<td class="l"><span class="asset-ref-id" title="${escapeHtml(campLabel+' / '+(a._displayId||''))}">${escapeHtml(a._displayId||shortId(a.id,'A'))}</span><small style="display:block;font-family:'Poppins','Prompt',sans-serif;font-size:9px;color:var(--muted-2);margin-top:2px;">${escapeHtml(campLabel)}</small></td>` +
      `<td class="l"><div class="perf-aname">${escapeHtml(a.h2||'—')}</div><div class="perf-asub">${escapeHtml(a.catLabel||camp.brand||'')}</div></td>`;
  };
  const emptyIdentity = `<td class="l"></td><td class="l"></td><td class="l"></td>`;

  const blocks = perfBlocksFor(camp, _perfMonth, _perfChannel);
  let body = '';
  blocks.forEach(blk => {
    const a = blk.asset;
    // no data in scope → single em-dash row for the creative
    if (!blk.hasData) {
      const o0 = PERF_OBJECTIVES[''];
      body += `<tr class="perf-block-start">${identityCells(a)}` +
        `<td class="l"><span class="perf-na" style="font-size:11px">ไม่มีข้อมูล${blk.otherMonths && blk.otherMonths.size ? ' เดือนนี้':''}</span></td>` +
        `<td class="l"><span class="cat-pill ${o0.cls}">${escapeHtml(o0.label)}</span></td>${metricCells({}, false, '')}</tr>`;
      return;
    }
    const multi = blk.objectives.length >= 2;
    const rowClear = canEditPerf
      ? `<button class="perf-row-clear" title="ล้างผลทั้ง creative นี้ในช่วงที่เลือก" onclick="clearPerfAsset('${escapeHtml(a.id)}')">✕</button>` : '';
    // one row per objective, grouped as a contiguous block under the creative
    blk.objectives.forEach((ob, oi) => {
      const obj = PERF_OBJECTIVES[ob.objective] || PERF_OBJECTIVES[''];
      const alt = (oi === 0 && blk.otherMonths && blk.otherMonths.size) ? `<span class="alt">+${blk.otherMonths.size} เดือน</span>` : '';
      const chanBadge = (_perfChannel === 'all') ? perfChanBadge(ob.channels) : '';
      const objKey = a.id + '::' + String(ob.objective || '').replace(/[^a-z0-9]/gi, '_');
      const expanded = _perfExpanded.has(objKey);
      const caret = ob.periods.length ? `<button class="perf-caret${expanded?' open':''}" title="ดูราย period" onclick="togglePerfRow('${escapeHtml(objKey)}')">▸</button>` : '';
      const period = `${caret}<span class="perf-period">${perfDateLabel(ob.periods)}${alt}</span>${chanBadge}${oi===0?rowClear:''}`;
      body += `<tr class="perf-arow ${oi===0?'perf-block-start':'perf-block-cont'}">` +
        (oi === 0 ? identityCells(a) : emptyIdentity) +
        `<td class="l">${period}</td>` +
        `<td class="l"><span class="cat-pill ${obj.cls}">${escapeHtml(obj.label)}</span></td>` +
        `${metricCells(ob.raw, true, '')}</tr>`;
      // ▸ expand = this objective's periods
      if (expanded) {
        ob.periods.forEach(pd => {
          body += `<tr class="perf-detail">` +
            `<td class="l"></td><td class="l"></td>` +
            `<td class="l"><span class="perf-detail-lead">↳ ราย period</span></td>` +
            `<td class="l"><span class="perf-period sm">${perfDateLabel([pd])}</span> ${perfChanBadge([perfChannelOf(pd.channel)])}</td>` +
            `<td class="l"><span class="cat-pill sm ${obj.cls}">${escapeHtml(obj.label)}</span></td>` +
            `${metricCells(pd.raw, true, 'dim')}</tr>`;
        });
      }
    });
    // creative overview row — only when the creative has >1 objective
    if (multi) {
      body += `<tr class="perf-subtotal">` +
        `<td class="l" colspan="5">Σ รวมครีเอทีฟ · ${blk.objectives.length} objective · ${escapeHtml(a.h2||a.id)}</td>` +
        `${metricCells(blk.raw, true, '')}</tr>`;
    }
  });

  let foot = '';
  if (withData.length) {
    let tc = '';
    colList.forEach(c => {
      const cls = c.first ? ' class="grp"' : '';
      if (c.kind === 'raw') { const v = totalRaw[c.def.key]; tc += `<td${cls}>${v!=null ? perfFmt(v, c.def.fmt) : '<span class="perf-na">—</span>'}</td>`; }
      else { const v = totalDer[c.def.key]; tc += c.first ? `<td class="grp rate">${v!=null?perfFmt(v,c.def.fmt):'—'}</td>` : `<td class="rate">${v!=null?perfFmt(v,c.def.fmt):'—'}</td>`; }
    });
    const chanNote = _perfChannel === 'all' ? ' · รวม Ads+Organic (CPM/ROAS แม่นเมื่อเลือก Ads)' : ' · ' + perfChannelLabel(_perfChannel);
    const sumLabel = _perfMonth === 'all' ? 'รวมทั้งหมด (SUM)' : 'รวมเดือนที่เลือก (SUM)';
    foot = `<tfoot><tr class="perf-grandtotal"><td class="l" colspan="5">Σ ${sumLabel} · ${withData.length} asset${chanNote}</td>${tc}</tr></tfoot>`;
  }

  wrap.innerHTML = `<table><thead><tr>${gh}</tr><tr class="cols">${chh}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

// ---- CSV template + import ----
function downloadPerfTemplate() {
  const camp = getCurrentCampaign();
  if (!camp) { showToast('เลือกแคมเปญก่อน', 'warn'); return; }
  // 'type' = Ads | Organic (filter in Section C). Blank defaults to Ads.
  const cols = ['id','asset','objective','period_start','period_end','type'].concat(PERF_METRICS.map(m => m.key));
  const lines = [cols.join(',')];
  (camp.assets||[]).forEach(a => {
    const row = [a.id, a.h2||'', '', '', '', 'Ads'].concat(PERF_METRICS.map(() => ''));
    lines.push(row.map(csvEscape).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = `performance_${String(camp.campaign||camp.id).replace(/[^\w]+/g,'_')}.csv`;
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('⬇ ดาวน์โหลด template แล้ว · กรอกเลขจากไฟล์ FB แล้ว Import กลับ', 'ok');
}

// Export the CURRENTLY VISIBLE view (respects month + channel + visible column
// groups) to CSV — raw metrics + derived columns + a totals row. For reports.
function exportPerfView() {
  const camp = getCurrentCampaign();
  if (!camp) { showToast('เลือกแคมเปญก่อน', 'warn'); return; }
  const blocks = perfBlocksFor(camp, _perfMonth, _perfChannel).filter(b => b.hasData);
  if (!blocks.length) { showToast('ไม่มีข้อมูลในมุมมองนี้ให้ export', 'warn'); return; }
  const visibleGroups = PERF_GROUPS.filter(g => _perfGroups.has(g));
  const cols = [];
  visibleGroups.forEach(g => {
    PERF_METRICS.filter(m => m.group === g).forEach(m => cols.push({ key:m.key, label:m.label, kind:'raw' }));
    if (g === 'cost') PERF_DERIVED.forEach(m => cols.push({ key:m.key, label:m.label, kind:'der' }));
  });
  const num = (raw, der, c) => { const v = c.kind==='raw' ? raw[c.key] : der[c.key]; return (v==null||isNaN(v)) ? '' : (Math.round(v*1000)/1000); };
  const head = ['id','asset','channel','period_start','period_end','objective'].concat(cols.map(c => c.label));
  const lines = [head.map(csvEscape).join(',')];
  // one line per (creative × objective) — matches the on-screen table; a
  // creative-total line follows when the creative has >1 objective.
  let assetCount = 0;
  blocks.forEach(blk => {
    assetCount++;
    blk.objectives.forEach(ob => {
      const der = perfDerived(ob.raw);
      const starts = ob.periods.map(p=>p.start).filter(Boolean).sort();
      const ends = ob.periods.map(p=>p.end||p.start).filter(Boolean).sort();
      const line = [ blk.asset.id, blk.asset.h2||'', Array.from(ob.channels).join('+'),
        starts[0]||'', ends[ends.length-1]||'', ob.objective||'' ]
        .concat(cols.map(c => num(ob.raw, der, c)));
      lines.push(line.map(csvEscape).join(','));
    });
    if (blk.objectives.length >= 2) {
      const der = perfDerived(blk.raw);
      lines.push([ blk.asset.id, blk.asset.h2||'', Array.from(blk.channels).join('+'), '', '', 'CREATIVE_TOTAL' ]
        .concat(cols.map(c => num(blk.raw, der, c))).map(csvEscape).join(','));
    }
  });
  const totalRaw = perfSumRaw(blocks.map(b => b.raw));
  const totalDer = perfDerived(totalRaw);
  lines.push(['TOTAL', assetCount+' asset', _perfChannel==='all'?'Ads+Organic':perfChannelLabel(_perfChannel), '', '', '']
    .concat(cols.map(c => num(totalRaw, totalDer, c))).map(csvEscape).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const scope = (_perfMonth==='all'?'all':_perfMonth) + '_' + _perfChannel;
  const el = document.createElement('a');
  el.href = url; el.download = `perf_${String(camp.campaign||camp.id).replace(/[^\w]+/g,'_')}_${scope}.csv`;
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`⬇ Export ${assetCount} asset (${perfFullScopeLabel(_perfMonth, _perfChannel)}) แล้ว`, 'ok');
}

function triggerPerfImport() {
  if (blockPerf('เฉพาะ admin จึง import performance ได้')) return;
  if (!getCurrentCampaign()) { showToast('เลือกแคมเปญก่อน', 'warn'); return; }
  const inp = document.getElementById('perf-import-file');
  if (inp) inp.click();
}
function onPerfImportFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  const reader = new FileReader();
  reader.onerror = () => showToast('อ่านไฟล์ไม่สำเร็จ', 'err');
  if (isXlsx) {
    if (typeof XLSX === 'undefined') { showToast('XLSX library ยังไม่โหลด — refresh แล้วลองใหม่ หรือ save เป็น .csv', 'err'); return; }
    reader.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(reader.result), { type:'array', cellDates:true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        // header:1 → array-of-arrays (same shape parsePerfCSV returns). cellDates
        // keeps real date cells as Date objects → perfNormDate reads them exactly
        // (dodges Excel's 2-digit-year / m-d-yy display formats). Non-dates → text.
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, blankrows:false, raw:true, defval:'' })
          .map(r => r.map(c => (c instanceof Date) ? perfNormDate(c) : String(c == null ? '' : c)))
          .filter(r => r.some(c => String(c).trim() !== ''));
        stagePerfImportTable(rows);
      } catch(e){ showToast('อ่าน .xlsx ไม่สำเร็จ · ' + (e.message||e), 'err'); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = () => { try { stagePerfImport(String(reader.result || '')); } catch(e){ showToast('อ่านไฟล์ไม่สำเร็จ · ' + (e.message||e), 'err'); } };
    reader.readAsText(file);
  }
}


function stagePerfImport(text) {
  const table = parsePerfCSV(text);
  stagePerfImportTable(table);
}

// Core importer. `table` = array-of-string-arrays (row 0 = headers). Shared by
// the CSV and .xlsx paths.
function stagePerfImportTable(table) {
  const camp = getCurrentCampaign();
  if (!camp) { showToast('เลือกแคมเปญก่อน', 'warn'); return; }
  if (!Array.isArray(table) || table.length < 2) { showToast('ไฟล์ว่างหรือไม่มีแถวข้อมูล', 'err'); return; }
  const headers = table[0].map(h => String(h||'').trim());
  const lower = headers.map(h => h.toLowerCase());
  const findCol = list => { for (let i=0;i<lower.length;i++) if (list.indexOf(lower[i]) >= 0) return i; return -1; };
  const idCol = findCol(PERF_ID_HEADERS);
  const startCol = findCol(PERF_START_HEADERS);
  const endCol = findCol(PERF_END_HEADERS);
  const objCol = findCol(PERF_OBJ_HEADERS);
  const chanCol = findCol(PERF_CHANNEL_HEADERS);
  const nameCol = findCol(PERF_NAME_HEADERS);

  const metricCols = []; const usedKey = new Set();
  headers.forEach((h,i) => { const k = perfMapMetricHeader(h); if (k && !usedKey.has(k)) { usedKey.add(k); metricCols.push({ idx:i, key:k, header:h }); } });
  const specialIdx = new Set([idCol, startCol, endCol, objCol, chanCol, nameCol].concat(metricCols.map(m=>m.idx)));
  const unknown = headers.filter((h,i) => h && !specialIdx.has(i));

  if (idCol < 0 && nameCol < 0) { showToast('ไม่พบคอลัมน์ id — ไฟล์ต้องมีคอลัมน์ id หรือชื่อโฆษณาที่ฝัง asset id', 'err'); return; }
  if (!metricCols.length){ showToast('ไม่พบคอลัมน์ metric ที่รู้จักในไฟล์', 'err'); return; }

  const byId = new Map((camp.assets||[]).map(a => [String(a.id).trim(), a]));
  const byLen = (camp.assets||[]).slice().sort((a,b) => String(b.id).length - String(a.id).length);
  const matched = [], unmatched = [];
  let nameMatchCount = 0;
  const seenInFile = new Map();   // id|start|end → matched-row index (intra-file dup guard)
  for (let r=1; r<table.length; r++) {
    const cells = table[r];
    let id = idCol>=0 ? String(cells[idCol] || '').trim() : '';
    let asset = id ? byId.get(id) : null;
    let byName = false;
    // Fallback: id column empty or unmatched → try to find an asset id embedded
    // in the ad-name column. If still nothing, it stays unmatched (old behavior).
    if (!asset && nameCol >= 0) {
      const found = perfMatchByName(cells[nameCol], byLen);
      if (found) { asset = found; id = found.id; byName = true; nameMatchCount++; }
    }
    if (!id && !asset) continue;
    if (!asset) { unmatched.push({ id: id || String(cells[nameCol]||'').slice(0,40), rowNo:r+1 }); continue; }
    const raw = {};
    metricCols.forEach(mc => { const v = perfParseNum(cells[mc.idx]); if (v != null) raw[mc.key] = v; });
    const m = {
      asset, id, byName,
      start: startCol>=0 ? perfNormDate(cells[startCol]) : '',
      end:   endCol>=0   ? perfNormDate(cells[endCol])   : '',
      objective: objCol>=0 ? String(cells[objCol]||'').trim().toLowerCase() : '',
      channel: chanCol>=0 ? perfChannelOf(cells[chanCol]) : 'ads',
      raw, rowNo:r+1
    };
    // Classify against what already lives on the asset (data + metric compare).
    // Channel is part of the key: same period, Ads vs Organic, are separate rows.
    const key = (m.start||'') + '|' + (m.end||'') + '|' + m.channel;
    const existing = (asset.metrics && asset.metrics.periods || []).find(p => ((p.start||'')+'|'+(p.end||'')+'|'+perfChannelOf(p.channel)) === key);
    if (!existing)                             m.status = 'new';
    else if (perfRawEqual(existing.raw, m.raw)) m.status = 'same';
    else                                        m.status = 'update';
    m.issues = perfRowIssues(m);
    // Intra-file duplicate: two rows in the SAME file for one asset+period+channel.
    const fileKey = id + '|' + key;
    if (seenInFile.has(fileKey)) {
      m.dupInFile = true;
      m.issues = m.issues.concat('ซ้ำกับอีกแถวในไฟล์เดียวกัน (ใช้แถวหลังสุด)');
      const prevIdx = seenInFile.get(fileKey);
      if (matched[prevIdx]) matched[prevIdx].overridden = true;   // earlier one gets dropped
    }
    seenInFile.set(fileKey, matched.length);
    matched.push(m);
  }

  const counts = { new:0, update:0, same:0 };
  matched.forEach(m => { if (!m.overridden) counts[m.status]++; });
  const issueRows = matched.filter(m => !m.overridden && m.issues.length);
  _perfImportCtx = { campId: camp.id, matched, unmatched, metricCols, unknown, counts, issueRows, nameMatchCount };
  showPerfImportPreview();
}

function showPerfImportPreview() {
  const ctx = _perfImportCtx; if (!ctx) return;
  const body = document.getElementById('perf-import-body');
  const applyBtn = document.getElementById('perf-import-apply');
  const sample = ctx.matched[0];
  let mapRows = '';
  if (ctx.matched.some(m => m.start)) {
    mapRows += `<tr><td>วันเริ่มรัน (period_start)</td><td class="perf-na">→</td><td><code>เดือน</code></td><td>${escapeHtml(sample && sample.start || '—')}</td></tr>`;
  }
  mapRows += `<tr><td>ประเภท (type)</td><td class="perf-na">→</td><td><code>ช่อง Ads/Organic</code></td><td>${escapeHtml(perfChannelLabel(sample && sample.channel || 'ads'))}</td></tr>`;
  ctx.metricCols.forEach(mc => {
    const val = sample && sample.raw[mc.key] != null ? sample.raw[mc.key].toLocaleString('en-US') : '<span class="perf-na">—</span>';
    mapRows += `<tr><td>${escapeHtml(mc.header)}</td><td class="perf-na">→</td><td><code>${mc.key}</code></td><td>${val}</td></tr>`;
  });
  const ignored = ctx.unknown.length ? `<div style="font-size:11px;color:var(--muted);margin-top:8px;">ข้าม ${ctx.unknown.length} คอลัมน์ที่ไม่รู้จัก: ${ctx.unknown.map(escapeHtml).join(', ')}</div>` : '';
  const nameNote = ctx.nameMatchCount ? `<div style="font-size:11px;color:var(--connect);margin-top:8px;">🔎 ${ctx.nameMatchCount} แถวจับคู่จากชื่อโฆษณา (ไม่มี id ตรง — ดึง asset id จากชื่อให้)</div>` : '';
  let unmatchedBlock = '';
  if (ctx.unmatched.length) {
    const list = ctx.unmatched.slice(0,8).map(u => `<code>${escapeHtml(u.id)}</code>`).join(', ');
    const more = ctx.unmatched.length > 8 ? ` …+${ctx.unmatched.length-8}` : '';
    unmatchedBlock = `<div class="perf-warn"><b>⚠ ${ctx.unmatched.length} แถวจับคู่ ID ไม่ได้</b> — ${list}${more}<br>แถวเหล่านี้จะ<b>ไม่ถูกเขียน</b> (id พิมพ์ผิด หรือ asset ถูกลบ)</div>`;
  }

  // NEW / UPDATE / SAME breakdown — makes "add more vs overwrite vs duplicate"
  // explicit before anything is written. Duplicates are skipped (no double-count).
  const c = ctx.counts || { new:0, update:0, same:0 };
  const pill = (n, color, label) => n ? `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:20px;background:${color}22;color:${color};"><b>${n}</b> ${label}</span>` : '';
  let adsN = 0, orgN = 0;
  ctx.matched.forEach(m => { if (m.overridden || m.status === 'same') return; if (m.channel === 'organic') orgN++; else adsN++; });
  const breakdown =
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">` +
    pill(c.new, '#3A7A3E', 'เพิ่มใหม่') +
    pill(c.update, '#B89248', 'อัปเดตทับ') +
    pill(c.same, '#6B6F76', 'ซ้ำ (ข้าม)') +
    `</div>` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">` +
    pill(adsN, '#DD3A2C', 'Ads') +
    pill(orgN, '#3A7A3E', 'Organic') +
    `</div>`;

  // Validation warnings — every flagged row surfaced, never silently dropped.
  let issueBlock = '';
  if (ctx.issueRows && ctx.issueRows.length) {
    const items = ctx.issueRows.slice(0,10).map(m => {
      const who = escapeHtml((m.asset && m.asset.h2) || m.id);
      return `<li><b>${who}</b> <span class="perf-na">(แถว ${m.rowNo})</span> — ${m.issues.map(escapeHtml).join('; ')}</li>`;
    }).join('');
    const more = ctx.issueRows.length > 10 ? `<li class="perf-na">…อีก ${ctx.issueRows.length-10} แถว</li>` : '';
    issueBlock = `<div class="perf-warn"><b>⚠ ตรวจพบ ${ctx.issueRows.length} แถวที่ควรตรวจสอบ</b><ul style="margin:6px 0 0 16px;padding:0;font-size:12px;line-height:1.6;">${items}${more}</ul><div style="font-size:11px;margin-top:6px;">ยังเขียนได้ แต่ตรวจให้แน่ใจก่อนยืนยัน</div></div>`;
  }

  const writable = c.new + c.update;   // 'same' rows are skipped on apply
  body.innerHTML =
    `<div style="font-size:13px;margin-bottom:10px;">พบ <b class="perf-ok">${ctx.matched.length}</b> แถวที่จับคู่ asset ได้` +
    (ctx.unmatched.length ? ` · <b style="color:var(--convert)">${ctx.unmatched.length}</b> แถวจับคู่ไม่ได้` : '') + `</div>` +
    breakdown +
    `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-2);font-weight:700;margin-bottom:6px;">การจับคู่คอลัมน์ → metric (ตัวอย่างจากแถวแรก)</div>` +
    `<table class="perf-map"><thead><tr><th>คอลัมน์ในไฟล์</th><th></th><th>เก็บเป็น</th><th>ค่าตัวอย่าง</th></tr></thead><tbody>${mapRows}</tbody></table>` +
    ignored + nameNote + issueBlock + unmatchedBlock +
    (writable ? '' : '<div class="perf-warn" style="margin-top:14px;"><b>ไม่มีข้อมูลใหม่ให้เขียน</b> — ทุกแถวซ้ำกับที่มีอยู่แล้ว หรือจับคู่ ID ไม่ได้</div>');
  if (applyBtn) {
    applyBtn.disabled = !writable;
    applyBtn.textContent = writable ? `เขียนลง Drive (${writable})` : 'เขียนลง Drive';
  }
  document.getElementById('perfImportModal').classList.add('show');
}
function closePerfImport() {
  const m = document.getElementById('perfImportModal');
  if (m) m.classList.remove('show');
  _perfImportCtx = null;
}
function applyPerfImport() {
  const ctx = _perfImportCtx; if (!ctx) return;
  if (blockPerf('เฉพาะ admin จึงแก้ performance ได้')) return;
  const camp = campaigns.find(c => c.id === ctx.campId);
  if (!camp) { showToast('แคมเปญหาย — ปิดแล้วลองใหม่', 'err'); closePerfImport(); return; }
  const now = new Date().toISOString();
  const by = (document.getElementById('sb-name') && document.getElementById('sb-name').textContent) || currentUserEmail || 'Unknown';
  let added = 0, updated = 0, skipped = 0; const touched = new Set();
  ctx.matched.forEach(m => {
    if (m.overridden) return;                                  // superseded by a later row in the file
    if (m.status === 'same') { skipped++; return; }            // identical → never rewrite (no double-count)
    if (!Object.keys(m.raw).length && !m.start) return;        // nothing to write
    const a = m.asset;
    if (!a.metrics || typeof a.metrics !== 'object') a.metrics = { updatedAt:'', updatedBy:'', periods:[] };
    if (!Array.isArray(a.metrics.periods)) a.metrics.periods = [];
    const key = (m.start||'') + '|' + (m.end||'') + '|' + (m.channel||'ads');
    const idx = a.metrics.periods.findIndex(p => ((p.start||'') + '|' + (p.end||'') + '|' + perfChannelOf(p.channel)) === key);
    const period = { start:m.start||'', end:m.end||'', objective:m.objective||'', channel:m.channel||'ads', raw:m.raw };
    if (idx >= 0) { a.metrics.periods[idx] = period; updated++; } else { a.metrics.periods.push(period); added++; }
    a.metrics.updatedAt = now; a.metrics.updatedBy = by;
    touched.add(a.id);
  });
  camp.log = camp.log || [];
  camp.log.unshift({ time:now, type:'PERF_IMPORT', user:by,
    desc:`Import performance · +${added} ใหม่ · ${updated} อัปเดต · ${touched.size} asset` +
      (skipped ? ` · ข้ามซ้ำ ${skipped}` : '') + (ctx.unmatched.length ? ` · unmatched ${ctx.unmatched.length}` : '') });
  markCampaignDirty(camp.id);
  scheduleSave(camp.id);
  closePerfImport();
  renderEverything();
  showToast(`✓ Import performance · +${added} ใหม่ · ${updated} อัปเดต · ${touched.size} asset` +
    (skipped ? ` · ข้ามซ้ำ ${skipped}` : '') + (ctx.unmatched.length ? ` · จับคู่ไม่ได้ ${ctx.unmatched.length}` : ''), 'ok');
}

// ---- clear performance (undo a wrong import) ----
// Is a period inside the active month + channel scope? 'all' → no filter.
function perfInScope(p, scope, channel) {
  const monthOk = (scope === 'all') || perfMonthKey(p.start) === scope;
  const chanOk  = (!channel || channel === 'all') || perfChannelOf(p.channel) === channel;
  return monthOk && chanOk;
}
// Remove in-scope periods from one asset; drops metrics entirely when empty.
// Returns how many periods were removed.
function perfStripScope(asset, scope, channel) {
  const periods = asset.metrics && asset.metrics.periods;
  if (!Array.isArray(periods) || !periods.length) return 0;
  const keep = periods.filter(p => !perfInScope(p, scope, channel));
  const removed = periods.length - keep.length;
  if (!removed) return 0;
  if (keep.length) asset.metrics.periods = keep;
  else asset.metrics = null;
  return removed;
}
function perfScopeLabel(scope) {
  if (scope === 'all') return 'ทุกเดือน';
  const [y,mo] = scope.split('-');
  const d = new Date(+y, +mo-1, 1);
  return d.toLocaleDateString('th-TH', { month:'long' }) + ' ' + (+y+543);
}
function perfChannelLabel(ch) { return ch === 'ads' ? 'Ads' : ch === 'organic' ? 'Organic' : 'Ads+Organic'; }
// Combined month + channel scope label for confirm dialogs / logs.
function perfFullScopeLabel(scope, channel) {
  return perfScopeLabel(scope) + (channel && channel !== 'all' ? ' · ' + perfChannelLabel(channel) : '');
}
// Header button: clear every asset's performance in the current month+channel view.
function clearPerfScope() {
  if (blockPerf('เฉพาะ admin จึงล้างผลได้')) return;
  const camp = getCurrentCampaign();
  if (!camp) { showToast('เลือกแคมเปญก่อน', 'warn'); return; }
  const scope = _perfMonth, channel = _perfChannel;
  let total = 0, assetsHit = 0;
  (camp.assets||[]).forEach(a => {
    const n = ((a.metrics && a.metrics.periods) || []).filter(p => perfInScope(p, scope, channel)).length;
    if (n) { total += n; assetsHit++; }
  });
  if (!total) { showToast('ไม่มีข้อมูลผลในมุมมองนี้ให้ล้าง', 'warn'); return; }
  showConfirm('ล้างผล Performance',
    `จะลบข้อมูลผล ${total} ช่วง จาก ${assetsHit} asset (${perfFullScopeLabel(scope, channel)}) — กู้คืนไม่ได้ (แต่ import ใหม่ได้)`,
    () => {
      const now = new Date().toISOString();
      const by = (document.getElementById('sb-name') && document.getElementById('sb-name').textContent) || currentUserEmail || 'Unknown';
      let removed = 0; const touched = new Set();
      (camp.assets||[]).forEach(a => { const n = perfStripScope(a, scope, channel); if (n) { removed += n; touched.add(a.id); } });
      camp.log = camp.log || [];
      camp.log.unshift({ time:now, type:'PERF_CLEAR', user:by, desc:`ล้างผล performance · ${removed} ช่วง · ${touched.size} asset · ${perfFullScopeLabel(scope, channel)}` });
      markCampaignDirty(camp.id);
      scheduleSave(camp.id);
      renderEverything();
      showToast(`✓ ล้างผลแล้ว · ${removed} ช่วง · ${touched.size} asset`, 'ok');
    });
}
// Per-row button: clear one asset's performance in the current month scope.
function clearPerfAsset(assetId) {
  if (blockPerf('เฉพาะ admin จึงล้างผลได้')) return;
  const camp = getCurrentCampaign();
  if (!camp) return;
  const a = (camp.assets||[]).find(x => x.id === assetId);
  if (!a) return;
  const scope = _perfMonth, channel = _perfChannel;
  const n = ((a.metrics && a.metrics.periods) || []).filter(p => perfInScope(p, scope, channel)).length;
  if (!n) { showToast('ไม่มีข้อมูลผลให้ล้างในมุมมองนี้', 'warn'); return; }
  showConfirm('ล้างผลของชิ้นงานนี้',
    `จะลบผล ${n} ช่วง ของ "${a.h2||assetId}" (${perfFullScopeLabel(scope, channel)}) — กู้คืนไม่ได้`,
    () => {
      const now = new Date().toISOString();
      const by = (document.getElementById('sb-name') && document.getElementById('sb-name').textContent) || currentUserEmail || 'Unknown';
      const removed = perfStripScope(a, scope, channel);
      camp.log = camp.log || [];
      camp.log.unshift({ time:now, type:'PERF_CLEAR', user:by, desc:`ล้างผล "${a.h2||assetId}" · ${removed} ช่วง · ${perfFullScopeLabel(scope, channel)}` });
      markCampaignDirty(camp.id);
      scheduleSave(camp.id);
      renderEverything();
      showToast(`✓ ล้างผล "${a.h2||assetId}" แล้ว`, 'ok');
    });
}
