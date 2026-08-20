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
