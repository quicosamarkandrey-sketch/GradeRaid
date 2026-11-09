const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
 create table profiles(id text primary key,role text,class_id text,display_name text,profile_pic_url text,init text,xp int default 0,coins int default 0);
 create function is_staff_for_section(c text) returns boolean language sql stable as $$select auth.uid()::text='00000000-0000-4000-8000-000000000001' and c='room-a'$$;
 create table recitation_log(id text primary key,student_id text,class_id text,pts int,note text,when_label text,created_at timestamptz default now());
 create table rfid_cards(id uuid default gen_random_uuid(),student_id text,tag_id text,is_active boolean default true);
 create table attendance_logs(student_id text,class_id text,status text,log_date date default (now() at time zone 'Asia/Manila')::date);
 create table classroom_layouts(id uuid primary key,class_id text,name text);
 create table seats(id uuid primary key,layout_id uuid,x_coord numeric,y_coord numeric,label text);
 create table seat_assignments(id uuid default gen_random_uuid(),seat_id uuid,layout_id uuid,student_id text);
 create publication supabase_realtime;
 insert into profiles(id,role,class_id,display_name,init) values
 ('00000000-0000-4000-8000-000000000001','teacher','room-a','Teacher','T'),('alex','student','room-a','Alex Rivera','AR'),('bea','student','room-a','Bea Cruz','BC'),('cam','student','room-a','Cam Reyes','CR'),('absent','student','room-a','Absent Student','AS'),('outside','student','room-b','Other Class','OC');
 insert into rfid_cards(student_id,tag_id) values('alex','aa:bb'),('bea','cc:dd'),('cam','ee:ff'),('absent','11:22'),('outside','33:44');
 insert into attendance_logs(student_id,class_id,status) values('alex','room-a','On Time'),('bea','room-a','Late'),('cam','room-a','Early'),('absent','room-a','Absent');
 insert into classroom_layouts values('00000000-0000-4000-8000-000000000010','room-a','Main room');
 insert into seats values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010',0,0,'A1'),('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010',140,0,'A2');
 insert into seat_assignments(seat_id,layout_id,student_id) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','alex'),('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','bea');
 set app.uid='00000000-0000-4000-8000-000000000001';`);
 for(const file of ['phase30_recitation_rls_fix.sql','phase71_recitation_session_sync.sql','phase81_recitation_presentation.sql'])await db.exec(fs.readFileSync('supabase/'+file,'utf8'));
 const rpc=async(action,payload={},device='teacher-phone-12345678901234567890',identity='teacher',classId='room-a')=>{
  await db.exec(`set app.uid='${identity==='teacher'?'00000000-0000-4000-8000-000000000001':identity==='anonymous'?'':'00000000-0000-4000-8000-000000000002'}'`);
  return (await db.query('select recitation_presentation($1,$2,$3,$4::jsonb) result',[classId,action,device,JSON.stringify(payload)])).rows[0].result;
 };
 return {db,rpc};
}
module.exports={setup};
