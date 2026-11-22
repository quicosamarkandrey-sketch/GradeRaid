const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const teacher = '10000000-0000-4000-8000-000000000001';
  const foreign = '10000000-0000-4000-8000-000000000002';
  const student = '10000000-0000-4000-8000-000000000003';
  const created = '10000000-0000-4000-8000-000000000004';
  const hash = 'a'.repeat(64);
  const attempt = crypto.randomUUID();
  const call = async (actor, name, finish = false, key = attempt, credential = hash, section = 'room') =>
    (await db.query('select public.section_roster_import_row($1,$2,$3,$4,$5,$6) as result',
      [actor, section, name, key, credential, finish])).rows[0].result;
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, email text unique, raw_app_meta_data jsonb);
      create table public.class_sections(id text primary key, adviser_id text, archived boolean default false);
      create table public.profiles(
        id text primary key, class_id text, role text, is_active boolean default true, display_name text,
        first_name text,last_name text,init text,color text,xp int,coins int,level int,tier text,
        attendance_pct int,quiz_avg int,join_date date);
      insert into public.class_sections values ('room','${teacher}',false),('other','${foreign}',false);
      insert into public.profiles(id,role,display_name,class_id) values
        ('${teacher}','teacher','Teacher',null),('${foreign}','teacher','Other teacher',null),
        ('${student}','student','Existing Student','room');
    `);
    const migration = fs.readFileSync('supabase/phase86_section_roster_import.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec('set role authenticated');
    await assert.rejects(call(teacher, 'Alex Reyes'), /permission denied/i);
    await db.exec('reset role; set role service_role');
    assert.equal((await call(teacher, 'Alex Reyes', false, attempt, hash, 'other')).status, 'forbidden');
    assert.equal((await call(student, 'Alex Reyes')).status, 'forbidden');
    assert.equal((await call(teacher, 'existing  student')).status, 'existing');
    assert.equal((await call(teacher, '<img src=x>')).status, 'invalid');
    const row = await call(teacher, '  Alex   Reyes ');
    assert.equal(row.status, 'reserved');
    assert.equal((await call(teacher, 'alex reyes', false, crypto.randomUUID())).status, 'pending');
    assert.equal((await call(teacher, 'Alex Reyes', false, attempt, 'b'.repeat(64))).status, 'pending');
    assert.equal((await call(teacher, 'Alex Reyes', true)).status, 'retry');
    await db.exec('reset role');
    await db.query('insert into auth.users values($1,$2,$3)', [created, row.login, { graderaid_roster_id: row.reservation }]);
    await db.exec('set role service_role');
    assert.equal((await call(teacher, 'Alex Reyes')).hasAccount, true);
    assert.equal((await call(teacher, 'Alex Reyes', true)).status, 'created');
    assert.equal((await call(teacher, 'Alex Reyes')).login, row.login);
    assert.equal((await call(teacher, 'Alex Reyes', false, crypto.randomUUID())).status, 'existing');
    await db.exec('reset role');
    assert.deepEqual((await db.query('select display_name, role, class_id from profiles where id=$1', [created])).rows,
      [{ display_name: 'Alex Reyes', role: 'student', class_id: 'room' }]);
    await db.exec("update class_sections set archived=true where id='room'; set role service_role");
    assert.equal((await call(teacher, 'Alex Reyes')).status, 'forbidden');
    console.log('PASS: scoped roster provisioning, duplicate prevention, retry and Auth/profile linkage.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
