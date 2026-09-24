/**
 * Apply auth schema (if needed) and seed demo login users.
 * Default password for all demo users: Pass@123
 *
 * Scope:
 *   state_admin     → whole UP
 *   division_viewer → one division (all its districts/blocks)
 *   district_viewer → one district (and its blocks)
 *   block_viewer    → one block
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./pool');

async function ensureViewerRoles() {
  await query(`
    INSERT INTO role (code, name) VALUES
      ('district_viewer', 'District Viewer'),
      ('block_viewer', 'Block Viewer')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  `);
}

async function main() {
  const schemaPath = path.join(__dirname, '../../database/015_auth_schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await query(schemaSql);
  console.log('Auth schema applied.');

  await ensureViewerRoles();
  console.log('Viewer roles ensured.');

  const passwordHash = await bcrypt.hash('Pass@123', 10);

  const users = [
    // —— State (statewide) ——
    {
      username: 'admin',
      full_name: 'State Admin',
      email: 'admin@uphealth.local',
      role: 'state_admin',
      geo: null,
    },
    {
      username: 'state.admin',
      full_name: 'UP State Level Admin',
      email: 'state.admin@uphealth.local',
      role: 'state_admin',
      geo: null,
    },

    // —— Division viewers (see whole division) ——
    {
      username: 'prayagraj.div',
      full_name: 'Prayagraj Division Viewer',
      email: 'prayagraj.div@uphealth.local',
      role: 'division_viewer',
      geo: { geo_level: 'division', division_id: 1 },
    },
    {
      username: 'agra.div',
      full_name: 'Agra Division Viewer',
      email: 'agra.div@uphealth.local',
      role: 'division_viewer',
      geo: { geo_level: 'division', division_id: 18 },
    },
    {
      username: 'lucknow.div',
      full_name: 'Lucknow Division Viewer',
      email: 'lucknow.div@uphealth.local',
      role: 'division_viewer',
      geo: { geo_level: 'division', division_id: 3 },
    },

    // —— District viewers (see district data + blocks) ——
    {
      username: 'prayagraj.dh',
      full_name: 'Prayagraj District Viewer',
      email: 'prayagraj.dh@uphealth.local',
      role: 'district_viewer',
      geo: { geo_level: 'district', division_id: 1, district_id: 61 },
    },
    {
      username: 'agra.dh',
      full_name: 'Agra District Viewer',
      email: 'agra.dh@uphealth.local',
      role: 'district_viewer',
      geo: { geo_level: 'district', division_id: 18, district_id: 1 },
    },
    {
      username: 'lucknow.dh',
      full_name: 'Lucknow District Viewer',
      email: 'lucknow.dh@uphealth.local',
      role: 'district_viewer',
      geo: { geo_level: 'district', division_id: 3, district_id: 49 },
    },

    // —— Block viewers (see block-level data only) ——
    {
      username: 'prayagraj.handia',
      full_name: 'Handia Block Viewer (Prayagraj)',
      email: 'handia@uphealth.local',
      role: 'block_viewer',
      geo: { geo_level: 'block', division_id: 1, district_id: 61, block_id: 708 },
    },
    {
      username: 'agra.achhnera',
      full_name: 'Achhnera Block Viewer (Agra)',
      email: 'achhnera@uphealth.local',
      role: 'block_viewer',
      geo: { geo_level: 'block', division_id: 18, district_id: 1, block_id: 14 },
    },
    {
      username: 'lucknow.bkt',
      full_name: 'Bakshi-Ka-Talab Block Viewer (Lucknow)',
      email: 'lucknow.bkt@uphealth.local',
      role: 'block_viewer',
      geo: { geo_level: 'block', division_id: 3, district_id: 49, block_id: 574 },
    },
  ];

  for (const u of users) {
    const upsert = await query(
      `
      INSERT INTO app_user (username, full_name, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (username) DO UPDATE
      SET full_name = EXCLUDED.full_name,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          is_active = TRUE,
          updated_at = NOW()
      RETURNING id
    `,
      [u.username, u.full_name, u.email, passwordHash]
    );
    const userId = upsert.rows[0].id;

    await query(`DELETE FROM user_role WHERE user_id = $1`, [userId]);
    const roleInsert = await query(
      `
      INSERT INTO user_role (user_id, role_id)
      SELECT $1, r.id FROM role r WHERE r.code = $2
      RETURNING role_id
    `,
      [userId, u.role]
    );
    if (!roleInsert.rowCount) {
      throw new Error(`Role not found: ${u.role}`);
    }

    await query(`DELETE FROM user_geo_assignment WHERE user_id = $1`, [userId]);
    if (u.geo) {
      await query(
        `
        INSERT INTO user_geo_assignment
          (user_id, geo_level, division_id, district_id, block_id, facility_id)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          userId,
          u.geo.geo_level,
          u.geo.division_id || null,
          u.geo.district_id || null,
          u.geo.block_id || null,
          u.geo.facility_id || null,
        ]
      );
    }

    const scopeLabel = u.geo
      ? `${u.geo.geo_level}` +
        (u.geo.block_id
          ? ` block#${u.geo.block_id}`
          : u.geo.district_id
            ? ` district#${u.geo.district_id}`
            : ` division#${u.geo.division_id}`)
      : 'statewide';
    console.log(`User ready: ${u.username} / Pass@123  (${u.role}, ${scopeLabel})`);
  }

  console.log('Auth seed complete.');
}

main()
  .catch((err) => {
    console.error('Auth seed failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
