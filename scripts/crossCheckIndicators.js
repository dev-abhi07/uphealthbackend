/**
 * Cross-check Ind_definition.xlsx vs indicator-related DB tables + templates.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { TEMPLATES } = require('../src/upload/templateRegistry');

const XLSX_PATH = path.join(__dirname, '..', 'data', 'Ind_definition.xlsx');

function clean(s) {
  if (s == null) return null;
  return String(s).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() || null;
}

function loadSheet() {
  const wb = XLSX.readFile(XLSX_PATH);
  const defSheet = wb.SheetNames.find((n) => /defen/i.test(n)) || wb.SheetNames[0];
  const domainSheet = wb.SheetNames.find((n) => /domain/i.test(n)) || wb.SheetNames[1];
  const defs = XLSX.utils.sheet_to_json(wb.Sheets[defSheet], { defval: null });
  const domains = XLSX.utils.sheet_to_json(wb.Sheets[domainSheet], { defval: null });
  const byCode = new Map();
  for (const r of domains) {
    const code = clean(r.Indicator_id);
    if (!code) continue;
    byCode.set(code.toUpperCase(), {
      code: code.toUpperCase(),
      name: clean(r.Indicator),
      domain_label: clean(r.Domain),
      numerator: clean(r.Numerator),
      denominator: clean(r.Denominator),
      data_source: clean(r['Data source']),
      level: clean(r.Level),
    });
  }
  for (const r of defs) {
    const code = clean(r.Indicator_id);
    if (!code) continue;
    const c = code.toUpperCase();
    if (!byCode.has(c)) {
      byCode.set(c, { code: c, name: clean(r.Indicator_name) });
    } else if (!byCode.get(c).name) {
      byCode.get(c).name = clean(r.Indicator_name);
    }
  }
  return byCode;
}

function normLevel(s) {
  const x = String(s || '').toLowerCase();
  if (x === 'both') return 'both';
  if (x === 'district') return 'district';
  return x || null;
}

(async () => {
  const sheet = loadSheet();
  const sheetCodes = [...sheet.keys()].sort();
  console.log('=== Excel sheet ===');
  console.log('indicators in sheet:', sheetCodes.length);

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const issues = [];
  const ok = [];

  // --- indicator ---
  const { rows: inds } = await pool.query(`
    SELECT i.id, i.sno, i.code, i.name, i.domain, i.domain_label, i.indicator_type,
           i.ranking_level, i.unit, i.is_negative, i.numerator_text, i.denominator_text,
           i.data_source_text, i.formula_text, i.is_active,
           s.code AS source_code
    FROM indicator i
    LEFT JOIN source_system s ON s.id = i.primary_source_id
    ORDER BY i.sno NULLS LAST, i.code
  `);
  const byDbCode = new Map(inds.map((r) => [r.code, r]));

  console.log('\n=== indicator table ===');
  console.log('rows:', inds.length);

  for (const code of sheetCodes) {
    const s = sheet.get(code);
    const d = byDbCode.get(code);
    if (!d) {
      issues.push(`MISSING in indicator: ${code}`);
      continue;
    }
    const problems = [];
    if (clean(d.name) !== s.name) {
      problems.push(`name mismatch\n    sheet: ${s.name}\n    db:    ${clean(d.name)}`);
    }
    if (clean(d.domain_label) !== s.domain_label) {
      problems.push(`domain_label mismatch sheet="${s.domain_label}" db="${d.domain_label}"`);
    }
    if (clean(d.numerator_text) !== s.numerator) {
      problems.push(`numerator mismatch`);
    }
    if (clean(d.denominator_text) !== s.denominator) {
      problems.push(`denominator mismatch`);
    }
    if (clean(d.data_source_text) !== s.data_source) {
      problems.push(`data_source mismatch\n    sheet: ${s.data_source}\n    db:    ${d.data_source_text}`);
    }
    const wantLevel = normLevel(s.level);
    if (wantLevel && d.ranking_level !== wantLevel) {
      problems.push(`ranking_level sheet=${wantLevel} db=${d.ranking_level}`);
    }
    if (d.sno !== Number(code.replace(/\D/g, ''))) {
      problems.push(`sno ${d.sno} != ${code}`);
    }
    if (!d.is_active) problems.push('is_active=false');
    if (problems.length) {
      issues.push(`${code}:\n  - ${problems.join('\n  - ')}`);
    } else {
      ok.push(code);
    }
  }

  for (const r of inds) {
    if (!sheet.has(r.code) && /^IND\d{3}$/.test(r.code)) {
      issues.push(`EXTRA in indicator (not in sheet): ${r.code}`);
    }
    if (!/^IND\d{3}$/.test(r.code)) {
      issues.push(`LEGACY code still present: ${r.code}`);
    }
  }

  // public_code column should not exist
  const { rows: pubCols } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE column_name = 'public_code'
      AND table_name IN ('indicator', 'ranking_indicator')
  `);
  if (pubCols.length) {
    issues.push(`public_code column still exists: ${JSON.stringify(pubCols)}`);
  } else {
    ok.push('no public_code columns');
  }

  // --- indicator_level ---
  const { rows: levels } = await pool.query(`
    SELECT i.code, array_agg(il.level ORDER BY il.level) AS levels
    FROM indicator i
    LEFT JOIN indicator_level il ON il.indicator_id = i.id
    GROUP BY i.code
    ORDER BY i.code
  `);
  console.log('\n=== indicator_level ===');
  let levelGaps = 0;
  for (const r of levels) {
    const s = sheet.get(r.code);
    if (!s) continue;
    const lv = r.levels || [];
    if (!lv.length || lv[0] === null) {
      issues.push(`${r.code}: no indicator_level rows`);
      levelGaps += 1;
      continue;
    }
    const want = normLevel(s.level);
    // district → division+district; both → division+district+block
    if (want === 'district' && !lv.includes('district')) {
      issues.push(`${r.code}: sheet Level=District but levels=${lv}`);
      levelGaps += 1;
    }
    if (want === 'both' && (!lv.includes('district') || !lv.includes('block'))) {
      issues.push(`${r.code}: sheet Level=Both but levels=${lv}`);
      levelGaps += 1;
    }
  }
  if (!levelGaps) ok.push('indicator_level ok for sheet levels');

  // --- indicator_component ---
  const { rows: comps } = await pool.query(`
    SELECT i.code, count(ic.id)::int AS parts,
           count(*) FILTER (WHERE ic.role LIKE 'numerator%')::int AS num_parts,
           count(*) FILTER (WHERE ic.role LIKE 'denominator%')::int AS den_parts
    FROM indicator i
    LEFT JOIN indicator_component ic ON ic.indicator_id = i.id AND ic.is_active = TRUE
    GROUP BY i.code
    ORDER BY i.code
  `);
  console.log('\n=== indicator_component ===');
  const noComp = comps.filter((c) => sheet.has(c.code) && c.parts === 0).map((c) => c.code);
  const hasComp = comps.filter((c) => sheet.has(c.code) && c.parts > 0);
  console.log('with components:', hasComp.length);
  console.log('without components:', noComp.length, noComp.join(', ') || '(none)');
  if (noComp.length) {
    issues.push(`No indicator_component for: ${noComp.join(', ')}`);
  } else {
    ok.push('all sheet indicators have components');
  }

  // orphan components pointing to missing DE?
  const { rows: badDe } = await pool.query(`
    SELECT i.code, de.code AS de_code, ic.role
    FROM indicator_component ic
    JOIN indicator i ON i.id = ic.indicator_id
    LEFT JOIN data_element de ON de.id = ic.data_element_id
    WHERE de.id IS NULL OR de.is_active = FALSE
  `);
  if (badDe.length) {
    issues.push(`Broken DE links: ${JSON.stringify(badDe)}`);
  } else {
    ok.push('all components link to active data_element');
  }

  // --- templateRegistry ---
  console.log('\n=== templateRegistry ===');
  const tplCodes = Object.keys(TEMPLATES).sort();
  const missingTpl = sheetCodes.filter((c) => !TEMPLATES[c]);
  const extraTpl = tplCodes.filter((c) => !sheet.has(c));
  console.log('templates:', tplCodes.length);
  if (missingTpl.length) issues.push(`Missing templates: ${missingTpl.join(', ')}`);
  else ok.push('all sheet codes have upload templates');
  if (extraTpl.length) issues.push(`Extra templates not in sheet: ${extraTpl.join(', ')}`);

  // name drift in templates vs sheet
  let tplNameDrift = 0;
  for (const code of sheetCodes) {
    const t = TEMPLATES[code];
    const s = sheet.get(code);
    if (!t || !s) continue;
    if (clean(t.name) !== s.name) {
      tplNameDrift += 1;
      // soft warning only
      console.log(`  template name differs ${code}`);
      console.log(`    sheet: ${s.name}`);
      console.log(`    tpl:   ${clean(t.name)}`);
    }
  }
  if (tplNameDrift) {
    issues.push(`${tplNameDrift} template names differ from sheet (DB names are source of truth for /api/indicators)`);
  }

  // --- ranking_indicator links ---
  const { rows: ranks } = await pool.query(`
    SELECT ri.code AS rank_code, ri.master_indicator_id, i.code AS master_code,
           ri.domain_label, ri.numerator_text IS NOT NULL AS has_num
    FROM ranking_indicator ri
    LEFT JOIN indicator i ON i.id = ri.master_indicator_id
    WHERE ri.is_active = TRUE
    ORDER BY ri.sort_order
  `);
  console.log('\n=== ranking_indicator ===');
  const mapped = ranks.filter((r) => r.master_indicator_id);
  console.log('total ranking indicators:', ranks.length);
  console.log('mapped to master IND###:', mapped.length);
  mapped.forEach((r) => console.log(`  ${r.rank_code} → ${r.master_code}`));

  // Expected maps from sync script
  const expectedMap = {
    RANK_ANC4_HB: 'IND003',
    RANK_INST_DEL: 'IND004',
    RANK_FULL_IMM: 'IND015',
    RANK_ASHA_EXP: 'IND017',
    RANK_TB_NOTIF: 'IND020',
  };
  for (const [rank, ind] of Object.entries(expectedMap)) {
    const row = ranks.find((r) => r.rank_code === rank);
    if (!row || row.master_code !== ind) {
      issues.push(`ranking map ${rank} expected ${ind}, got ${row && row.master_code}`);
    }
  }

  // Summary table
  console.log('\n======== SUMMARY ========');
  console.log('Sheet indicators:', sheetCodes.length);
  console.log('DB indicators (IND###):', inds.filter((i) => /^IND\d{3}$/.test(i.code)).length);
  console.log('OK checks:', ok.length);
  console.log('Issues:', issues.length);
  if (issues.length) {
    console.log('\n--- ISSUES ---');
    issues.forEach((i, idx) => console.log(`\n[${idx + 1}] ${i}`));
  } else {
    console.log('\nAll checks passed.');
  }

  // Per-indicator snapshot
  console.log('\n======== PER INDICATOR ========');
  console.log(
    'code | sno | level | domain_label | components | template | name_ok'
  );
  for (const code of sheetCodes) {
    const s = sheet.get(code);
    const d = byDbCode.get(code);
    const c = comps.find((x) => x.code === code);
    const nameOk = d && clean(d.name) === s.name ? 'Y' : 'N';
    console.log(
      [
        code,
        d ? d.sno : '-',
        d ? d.ranking_level : '-',
        d ? (d.domain_label || '').slice(0, 28) : '-',
        c ? c.parts : 0,
        TEMPLATES[code] ? 'Y' : 'N',
        nameOk,
      ].join(' | ')
    );
  }

  await pool.end();
  process.exit(issues.length ? 2 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
