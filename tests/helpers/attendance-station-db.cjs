const fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite');
module.exports=async function(){
 const db=new PGlite();
 // Same surrounding schema used by the real learning-rewards integration test.
 const base=fs.readFileSync('tests/database/learning-rewards.cjs','utf8').match(/await db.exec\(`([\s\S]*?)`\);/)[1];await db.exec(base);
 await db.exec(`drop table attendance_logs;
 create table attendance_logs(id uuid primary key default gen_random_uuid(),student_id text references profiles(id),class_id text,log_date date not null default (now() at time zone 'Asia/Manila')::date,status text not null check(status in ('Early','On Time','Late','Absent','Excused')),scanned_at timestamptz not null default now(),entry_method text not null default 'Manual',rfid_tag text,recorded_by text,notes text,updated_at timestamptz default now(),unique(student_id,class_id,log_date));
 alter table profiles add column profile_pic_url text;
 create table rfid_cards(id uuid default gen_random_uuid(),tag_id text,student_id text,is_active boolean default true);
 create table attendance_schedules(id uuid primary key default gen_random_uuid(),class_id text,open_time time,start_time time,late_cutoff time,close_time time,active boolean default true,day_of_week smallint default 0,day_off boolean default false);
 insert into profiles(id,role,class_id,display_name,init,color) values('00000000-0000-4000-8000-000000000001','teacher','room-a','Teacher','T','#888'),('alex','student','room-a','Alex Rivera','AR','#888'),('bea','student','room-a','Bea Cruz','BC','#888'),('cam','student','room-a','Cam Reyes','CR','#888'),('outside','student','room-b','Outside Student','OS','#888');
 insert into class_sections values('room-a','00000000-0000-4000-8000-000000000001');
 insert into rfid_cards(tag_id,student_id) values('1001','alex'),('1002','bea'),('1003','cam'),('2001','outside');
 insert into attendance_schedules(class_id,open_time,start_time,late_cutoff,close_time) values('room-a','00:00','00:00','23:59:58','23:59:59');`);
 const resolver=fs.readFileSync('supabase/phase54_weekly_attendance_schedule.sql','utf8').match(/create or replace function public.get_effective_attendance_schedule\([\s\S]*?\$\$;/)[0];await db.exec(resolver);
 await db.exec(fs.readFileSync('supabase/phase72_learning_rewards.sql','utf8'));await db.exec("update learning_reward_policy set activated_at=now()-interval '30 days'");
 await db.exec(fs.readFileSync('supabase/phase83_attendance_station.sql','utf8'));
 let serial=Promise.resolve();
 const rpc=(action,payload={},identity='teacher',classId='room-a')=>{const job=serial.catch(()=>{}).then(async()=>{await db.query("select set_config('app.uid',$1,false)",[identity==='teacher'?'00000000-0000-4000-8000-000000000001':identity==='anonymous'?'':'00000000-0000-4000-8000-000000000002']);return (await db.query('select attendance_station($1,$2,$3::jsonb) result',[classId,action,JSON.stringify(payload)])).rows[0].result;});serial=job;return job;};
 return {db,rpc};
};
