const assert=require('node:assert/strict'),fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
 const student='00000000-0000-4000-8000-000000000001',teacher='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
 await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create table profiles(id text primary key,role text,class_id text,is_active boolean default true,display_name text,coins integer default 100,xp integer default 200);
 create table titles(id text primary key,owner_teacher_id text,name text,description text,achievement_id text,active boolean default true);
 create table title_unlocks(student_id text,title_id text,unlocked_at timestamptz default now(),primary key(student_id,title_id));create table title_sections(title_id text,class_id text);create table achievement_sections(achievement_id text,class_id text);create table user_achievements(student_id text,achievement_id text);
 insert into profiles(id,role,class_id,display_name) values('${student}','student','a','Alex'),('${teacher}','teacher','a','Morgan Reyes'),('${other}','teacher','b','Other');
 insert into titles values('manual','${teacher}','Aegis','Leadership in class',null,true),('tier2','${teacher}','Aegis II','Continued leadership',null,true),('foreign','${other}','Other class title','Other',null,true);insert into title_sections values('foreign','b');
 insert into title_unlocks values('${student}','manual','2026-01-01');`);
 const sql=fs.readFileSync('supabase/phase74_title_collections.sql','utf8');await db.exec(sql);await db.exec(sql);
 const as=async id=>db.query("select set_config('app.uid',$1,false)",[id||'']);
 const details=async()=> (await db.query('select title_collection_details() data')).rows[0].data;
 await as(teacher);await db.exec('set role authenticated');await db.query("select set_title_collection_details('manual','Guardians',1,'Class of 2026')");await db.query("select set_title_collection_details('tier2','Guardians',2,'Class of 2026')");
 await assert.rejects(()=>db.query("select set_title_collection_details('tier2','Guardians',1,'Class of 2026')"),/already has/);
 await assert.rejects(()=>db.query("select set_title_collection_details('foreign','Guardians',1,'')"),/authorized/);
 await assert.rejects(()=>db.query('select * from title_collection_meta'),/permission denied/);
 await db.exec('reset role');const before=(await db.query('select * from profiles order by id')).rows;
 // Existing awards keep their actual original date; grantor is not invented.
 await as(student);await db.exec('set role authenticated');let data=await details();assert.equal(data.metadata.length,2);assert.equal(data.legacyEarned.length,1);assert.equal(data.history.length,0);
 await assert.rejects(()=>db.query("select set_title_collection_details('manual','Fake',1,'')"),/Staff/);await assert.rejects(()=>db.query('select * from title_award_events'),/permission denied/);
 await db.exec('reset role');await as(teacher);await db.query("insert into title_unlocks(student_id,title_id) values($1,'tier2') on conflict do nothing",[student]);await db.query("insert into title_unlocks(student_id,title_id) values($1,'tier2') on conflict do nothing",[student]);
 await as(student);data=await details();assert.equal(data.history.length,1);assert.equal(data.history[0].actor_name,'Morgan Reyes');assert.equal(data.history[0].source,'teacher');assert.equal(data.history[0].description,'Continued leadership');
 await as(teacher);await db.query("delete from title_unlocks where student_id=$1 and title_id='tier2'",[student]);await as(student);data=await details();assert.equal(data.history.length,2);assert.equal(data.history[0].event,'revoked');
 await as(other);assert.equal((await details()).metadata.length,0,'Other teacher does not read another owner’s metadata');await as(null);await assert.rejects(details,/Sign in/);
 assert.deepEqual((await db.query('select * from profiles order by id')).rows,before,'Metadata/history never change coins or XP');console.log('PASS: title collection migration/reapply, staff ownership, stage uniqueness, student scope, private tables, legacy dates without fabricated attribution, exactly-once grant audit/revocation and unchanged wallets.');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
