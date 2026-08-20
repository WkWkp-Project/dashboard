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
