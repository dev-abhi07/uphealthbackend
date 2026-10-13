/**
 * Seed only sysadmin + state.admin (password Pass@123).
 * Other users are created from the System Admin panel.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, query } = require('./pool');

const KEEP_USERNAMES = ['sysadmin', 'state.admin'];

async function ensureRoles() {
  await query(`
    INSERT INTO role (code, name, is_active) VALUES
      ('system_admin', 'System Admin', TRUE),
      ('state_admin', 'State', TRUE),
      ('division_viewer', 'Division', TRUE),
      ('district_viewer', 'District', TRUE),
      ('block_viewer', 'Block', TRUE)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
  `);
  await query(`
    UPDATE role SET is_active = FALSE
    WHERE code IN (
      'district_uploader', 'district_approver',
      'block_uploader', 'facility_uploader'
    )
  `);
}

async function purgeOtherUsers() {
  // Clear FKs that block user delete (uploads are legacy; outcome data is from API)
  await query(`
    UPDATE upload_batch ub
    SET uploaded_by = NULL
    WHERE uploaded_by IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM app_user u
        WHERE u.id = ub.uploaded_by
          AND lower(u.username) = ANY($1::text[])
      )
  `, [KEEP_USERNAMES]);

  // Any other tables referencing app_user — best-effort null/delete children already CASCADE on user_role / geo
  const del = await query(
    `
    DELETE FROM app_user
    WHERE lower(username) <> ALL($1::text[])
    RETURNING username
    `,
    [KEEP_USERNAMES]
  );
  return del.rows.map((r) => r.username);
}

async function upsertUser(u, passwordHash) {
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
  if (!roleInsert.rowCount) throw new Error(`Role not found: ${u.role}`);

  await query(`DELETE FROM user_geo_assignment WHERE user_id = $1`, [userId]);
  console.log(`User ready: ${u.username} / Pass@123  (${u.role}, statewide)`);
}

async function main() {
  const schemaPath = path.join(__dirname, '../../database/015_auth_schema.sql');
  await query(fs.readFileSync(schemaPath, 'utf8'));
  console.log('Auth schema applied.');

  await ensureRoles();
  console.log('Roles ensured.');

  const removed = await purgeOtherUsers();
  if (removed.length) console.log('Removed users:', removed.join(', '));
  else console.log('No extra users to remove.');

  const passwordHash = await bcrypt.hash('Pass@123', 10);
  await upsertUser(
    {
      username: 'sysadmin',
      full_name: 'System Administrator',
      email: 'sysadmin@uphealth.local',
      role: 'system_admin',
    },
    passwordHash
  );
  await upsertUser(
    {
      username: 'state.admin',
      full_name: 'UP State Level Admin',
      email: 'state.admin@uphealth.local',
      role: 'state_admin',
    },
    passwordHash
  );

  const { rows } = await query(
    `
    SELECT u.username, r.code AS role
    FROM app_user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role r ON r.id = ur.role_id
    ORDER BY u.username
    `
  );
  console.log('Remaining users:', rows);
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
