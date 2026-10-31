// Real PostgreSQL semantics in PGlite: npm run test:rewards-db.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
 create table profiles(id text primary key,role text,class_id text,is_active boolean default true,coins integer default 0,xp integer default 0,level integer default 0,tier text default 'Novice',display_name text,init text,color text);
 create table class_sections(id text primary key,adviser_id text);
 create function is_staff_for_section(c text) returns boolean language sql security definer as $$select exists(select 1 from profiles p where p.id=auth.uid()::text and (p.role='admin' or (p.role='teacher' and exists(select 1 from class_sections s where s.id=c and s.adviser_id=p.id))))$$;
 create function is_my_advisers_content(owner_id text) returns boolean language sql security definer as $$select exists(select 1 from profiles p join class_sections c on c.id=p.class_id where p.id=auth.uid()::text and c.adviser_id=owner_id)$$;
 create table attendance_logs(id text primary key,student_id text,log_date date,status text,class_id text);
 create table recitation_log(id text primary key,student_id text,pts integer,created_at timestamptz default now(),class_id text);
 create table quizzes(id text primary key,coin_reward integer,active boolean default true);
 create table quiz_sections(quiz_id text,class_id text);
 create table quiz_history(id text primary key,student_id text,quiz_id text,score integer,attempt integer,completed_at timestamptz,date_label text,question_results jsonb,aborted boolean default false);
 create table shop_products(id text primary key,owner_teacher_id text,name text,emoji text,category text,cost integer,stock integer,active boolean default true);
 create table orders(order_id text primary key,student_id text,student_name text,student_init text,student_color text,item_id text,item_name text,emoji text,cost integer,category text,claim_code text,status text,created_at timestamptz default now(),created_date_str text);
 create table redemptions(order_id text primary key,student_id text,item_id text,item_name text,emoji text,item_label text,pts integer,date_label text,time_label text,claim_code text);
 create table inventory(student_id text,item_id text,item_name text,emoji text,category text,quantity integer,date_purchased text,last_purchased text,source text,status text,used_at text,primary key(student_id,item_id));`);
 const sql=fs.readFileSync(path.resolve(__dirname,'../../supabase/phase72_learning_rewards.sql'),'utf8');
 await db.exec(sql);await db.exec(sql); // Installation is repeatable and preserves activation.
 const sid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',teacher='00000000-0000-4000-8000-000000000003';
 await db.exec(`insert into profiles(id,role,class_id,display_name,init,color) values('${sid}','student','class','Alex Rivera','AR','#888'),('${other}','student','other','Other','O','#888'),('${teacher}','teacher','class','Teacher','T','#888');insert into class_sections values('class','${teacher}');insert into quizzes values('quest',20,true),('restricted',40,true);insert into quiz_sections values('restricted','other');update learning_reward_policy set activated_at=now()-interval '30 days';`);
 const scalar=async q=>(await db.query(q)).rows[0];
 const wallet=async()=> (await scalar(`select learning_reward_wallet('${sid}') as data`)).data;
 await db.exec(`select set_config('app.uid','${sid}',false);`);
 await db.exec(`insert into recitation_log values('r1','${sid}',3,now(),'class');`);
 assert.equal((await wallet()).profile.coins,6);
 await db.exec(`update recitation_log set pts=50 where id='r1';`);assert.equal((await wallet()).profile.coins,20,'Daily cap');
 await db.exec(`insert into recitation_log values('r2','${sid}',2,now(),'class');delete from recitation_log where id='r1';`);assert.equal((await wallet()).profile.coins,4,'Undo recomputes cap');
 await db.exec(`delete from recitation_log;`);assert.equal((await wallet()).profile.coins,0);
 for(let i=1;i<=5;i++)await db.exec(`insert into attendance_logs values('a${i}','${sid}',(now() at time zone 'Asia/Manila')::date-${6-i},'${i===2?'Late':'On Time'}','class');`);
 assert.equal((await wallet()).profile.coins,65,'Five days plus streak');assert.equal((await wallet()).profile.xp,75);
 await db.exec(`insert into attendance_logs values('repeat','${sid}',(now() at time zone 'Asia/Manila')::date-1,'On Time','class2');`);assert.equal((await wallet()).profile.coins,65,'Only once per day across classes');
 await db.exec(`update attendance_logs set status='Absent' where id='a3';`);assert.equal((await wallet()).profile.coins,40,'Correction reverses attendance and streak');
 await db.exec(`update attendance_logs set status='Excused' where id='a3';`);assert.equal((await wallet()).profile.coins,40);
 await db.exec(`insert into attendance_logs values('sixth','${sid}',(now() at time zone 'Asia/Manila')::date,'On Time','class');`);assert.equal((await wallet()).profile.coins,65,'Excused does not break recorded-class-day streak');
 const attempt=async(id,score)=>(await scalar(`select record_learning_quest('${id}','quest',${score},1,'[1,0]'::jsonb) as data`)).data;
 assert.equal((await attempt('q1',50)).coinsEarned,10);assert.equal((await attempt('q1',50)).coinsEarned,0);
 assert.equal((await attempt('q2',90)).coinsEarned,8);assert.equal((await attempt('q3',80)).coinsEarned,0);
 await db.exec(`update quizzes set coin_reward=40 where id='quest';`);assert.equal((await attempt('q4',100)).coinsEarned,2,'Budget frozen at original 20');
 await assert.rejects(()=>db.query(`update quiz_history set learning_reward_version=0 where id='q1'`),/identity cannot change/);
 const before=(await wallet()).profile.coins;
 await db.exec(`insert into quiz_history(id,student_id,quiz_id,score,attempt,completed_at) values('legacy','${sid}','quest',100,1,now());`);assert.equal((await wallet()).profile.coins,before,'No duplicate legacy quest payouts');
 await assert.rejects(()=>db.query(`select record_learning_quest('bad','restricted',100,1,null)`),/unavailable/);
 await assert.rejects(()=>db.query(`select learning_reward_wallet('${other}')`),/authorized/);
 await db.exec(`insert into shop_products values('book','${teacher}','Notebook','book','supplies',20,2,true),('rare','${teacher}','Rare','star','privilege',10000,1,true);`);
 await assert.rejects(()=>db.query(`select checkout_learning_rewards('stale-price','[{"id":"book","qty":1,"price":1}]')`),/Price changed/);
 const items=JSON.stringify([{id:'book',qty:2,price:20}]);
 const buy=async()=> (await scalar(`select checkout_learning_rewards('buy-1','${items}'::jsonb) as data`)).data;
 const purchase=await buy();assert.equal(purchase.total,40);assert.equal(purchase.orders.length,2);assert.equal(purchase.wallet.profile.coins,before-40);assert.equal(purchase.inventory[0].quantity,2);
 const replay=await buy();assert.equal(replay.wallet.profile.coins,before-40);assert.deepEqual(replay.orders.map(o=>o.order_id).sort(),purchase.orders.map(o=>o.order_id).sort());
 assert.equal((await scalar(`select stock from shop_products where id='book'`)).stock,0);
 await assert.rejects(()=>db.query(`select checkout_learning_rewards('bad-price','[{"id":"rare","qty":1,"price":10000}]')`),/Not enough coins/);assert.equal((await scalar(`select stock from shop_products where id='rare'`)).stock,1);
 await assert.rejects(()=>db.query(`select checkout_learning_rewards('buy-1','[{"id":"book","qty":1,"price":20}]')`),/different cart/);
 // Spending then undoing never creates a repeatable mint: reversals become debt.
 await db.exec(`update profiles set coins=0 where id='${sid}';delete from attendance_logs;delete from quiz_history;`);
 assert.ok((await wallet()).debt>0);const debt=(await wallet()).debt;
 await db.exec(`insert into recitation_log values('new','${sid}',2,now(),'class');`);assert.equal((await wallet()).profile.coins,0);assert.equal((await wallet()).debt,debt-4);
 // Explicit grants/ACLs: callers cannot execute private settlement functions or write the ledger.
 await db.exec(`set role authenticated;`);
 await assert.rejects(()=>db.query(`select _learning_reconcile('${sid}')`),/permission denied/);
 await assert.rejects(()=>db.query(`insert into learning_reward_ledger values('${sid}','quest','fake',99999,0,'{}',now())`),/permission denied/);
 await db.exec(`reset role;select set_config('app.uid','',false);`);
 await assert.rejects(()=>db.query(`select learning_reward_wallet('${sid}')`),/Sign in/);
 console.log('PASS: PostgreSQL migration/reapply, recitation cap/undo, daily attendance, late/excused/streaks/corrections, quest improvement and replay, scope, legacy isolation, atomic checkout, stock/wallet limits, receipts, debt and ACLs.');
 } finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
