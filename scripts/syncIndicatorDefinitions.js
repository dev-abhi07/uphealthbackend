/**
 * Sync indicator.code (IND001–IND037) + name + definition fields from Excel.
 * Replaces legacy long codes when still present (by sno).
 *
 * Usage: node scripts/syncIndicatorDefinitions.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const XLSX_PATH =
  process.env.IND_DEFINITION_XLSX ||
  path.join(__dirname, '..', 'data', 'Ind_definition.xlsx');

/** Ranking Excel codes → master IND### (name overlap) */
const RANK_TO_MASTER = {
  RANK_ANC4_HB: 'IND003',
  RANK_INST_DEL: 'IND004',
  RANK_FULL_IMM: 'IND015',
  RANK_ASHA_EXP: 'IND017',
  RANK_TB_NOTIF: 'IND020',
};

function clean(s) {
  if (s == null) return null;
  return String(s).replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim() || null;
}

function isNegativeName(name) {
  return /negative\s+indicator/i.test(String(name || ''));
}

function loadDefinitions(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Definition file not found: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath);
  const sheetName =
    wb.SheetNames.find((n) => /domain/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  const out = [];
  for (const r of rows) {
    const code = clean(r.Indicator_id || r.indicator_id);
    if (!code || !/^IND\d{3}$/i.test(code)) continue;
    const name = clean(r.Indicator || r.Indicator_name || r.name);
    const domainLabel = clean(r.Domain || r.domain);
    out.push({
      code: code.toUpperCase(),
      sno: Number(String(code).replace(/\D/g, '')) || null,
      name,
      domain_label: domainLabel,
      numerator_text: clean(r.Numerator || r.numerator),
      denominator_text: clean(r.Denominator || r.denominator),
      data_source_text: clean(r['Data source'] || r.data_source || r.DataSource),
      level_raw: clean(r.Level || r.level),
      is_negative: isNegativeName(name),
    });
  }
  return out;
}

function rankingLevelFromExcel(levelRaw) {
  const s = String(levelRaw || '').toLowerCase();
  if (s === 'both') return 'both';
  if (s === 'district') return 'district';
  if (s === 'block') return 'block';
  return null;
}

async function main() {
  const defs = loadDefinitions(XLSX_PATH);
  console.log(`Loaded ${defs.length} definitions from ${XLSX_PATH}`);

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE indicator
        ADD COLUMN IF NOT EXISTS short_name TEXT,
        ADD COLUMN IF NOT EXISTS numerator_text TEXT,
        ADD COLUMN IF NOT EXISTS denominator_text TEXT,
        ADD COLUMN IF NOT EXISTS data_source_text TEXT,
        ADD COLUMN IF NOT EXISTS domain_label VARCHAR(120);

      ALTER TABLE ranking_indicator
        ADD COLUMN IF NOT EXISTS master_indicator_id BIGINT,
        ADD COLUMN IF NOT EXISTS numerator_text TEXT,
        ADD COLUMN IF NOT EXISTS denominator_text TEXT,
        ADD COLUMN IF NOT EXISTS data_source_text TEXT,
        ADD COLUMN IF NOT EXISTS domain_label VARCHAR(120),
        ADD COLUMN IF NOT EXISTS is_negative BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    // Ensure codes are IND001… before definition update (if still legacy)
    const { rows: legacy } = await client.query(
      `SELECT id, code, sno FROM indicator WHERE code !~ '^IND\\d{3}$' AND sno BETWEEN 1 AND 37`
    );
    for (const row of legacy) {
      const neu = `IND${String(row.sno).padStart(3, '0')}`;
      await client.query(
        `UPDATE indicator SET code = $2, updated_at = NOW() WHERE id = $1`,
        [row.id, neu]
      );
      console.log(`  rename ${row.code} → ${neu}`);
    }

    // Drop public_code if present
    await client.query(`DROP INDEX IF EXISTS uq_indicator_public_code`);
    await client.query(`ALTER TABLE indicator DROP COLUMN IF EXISTS public_code`);
    await client.query(`DROP INDEX IF EXISTS uq_ranking_indicator_public_code`);
    await client.query(`ALTER TABLE ranking_indicator DROP COLUMN IF EXISTS public_code`);

    let updated = 0;
    let missing = [];

    for (const d of defs) {
      const { rows } = await client.query(
        `SELECT id, code FROM indicator WHERE code = $1 OR sno = $2 LIMIT 1`,
        [d.code, d.sno]
      );
      if (!rows.length) {
        missing.push(d.code);
        continue;
      }
      const level = rankingLevelFromExcel(d.level_raw);
      await client.query(
        `
        UPDATE indicator SET
          code = $2,
          name = COALESCE($3, name),
          domain_label = $4,
          numerator_text = $5,
          denominator_text = $6,
          data_source_text = $7,
          is_negative = COALESCE($8, is_negative),
          ranking_level = COALESCE($9, ranking_level),
          sno = COALESCE($10, sno),
          updated_at = NOW()
        WHERE id = $1
        `,
        [
          rows[0].id,
          d.code,
          d.name,
          d.domain_label,
          d.numerator_text,
          d.denominator_text,
          d.data_source_text,
          d.is_negative,
          level,
          d.sno,
        ]
      );
      updated += 1;
      console.log(`  ${d.code} updated`);
    }

    for (const [rankCode, masterCode] of Object.entries(RANK_TO_MASTER)) {
      const { rows: indRows } = await client.query(
        `SELECT id, domain_label, numerator_text, denominator_text, data_source_text, is_negative
         FROM indicator WHERE code = $1 LIMIT 1`,
        [masterCode]
      );
      if (!indRows.length) continue;
      const m = indRows[0];
      await client.query(
        `
        UPDATE ranking_indicator SET
          master_indicator_id = $2,
          domain_label = $3,
          numerator_text = $4,
          denominator_text = $5,
          data_source_text = $6,
          is_negative = $7
        WHERE code = $1
        `,
        [
          rankCode,
          m.id,
          m.domain_label,
          m.numerator_text,
          m.denominator_text,
          m.data_source_text,
          m.is_negative,
        ]
      );
      console.log(`  ranking ${rankCode} → ${masterCode}`);
    }

    await client.query('COMMIT');
    console.log(`\nUpdated ${updated}. Missing: ${missing.length ? missing.join(', ') : 'none'}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
