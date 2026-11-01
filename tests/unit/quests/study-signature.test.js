const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/quests/study-studio.js','utf8');
function setup(quiz,local={sets:{},saved:[]}){
 let memory;const elements=new Map();const state={quizzes:quiz?[quiz]:[],quizHistory:{},quizSectionAssignments:{}};
 const ctx={currentUser:{id:'student',classId:'a',completedQuizzes:[]},currentRole:'student',document:{addEventListener:()=>{},getElementById:id=>{if(!elements.has(id))elements.set(id,{innerHTML:''});return elements.get(id);}},AppStore:{subscribe:()=>{},getSlice:fn=>structuredClone(fn(state))},localStorage:{getItem:()=>JSON.stringify(local),setItem:()=>{}},StudySync:{connect:(_id,opts)=>memory=opts.getMemory()},eqQuizScheduleStatus:()=>null,eqQuizCadence:()=> 'standing',eqQuizChain:()=>({}),eqQType:q=>q.type||'mc'};ctx.window=ctx;vm.runInNewContext(source,ctx);
 return {state,api:ctx.QuestStudy,get memory(){return memory;}};
}
test('identical JSONB question content has the same version regardless of object property order',()=>{
 const {api}=setup({id:'q',questions:[]});const a={questions:[{type:'mc',q:'Question',opts:['A','B'],answer:0}]},b={questions:[{answer:0,opts:['A','B'],q:'Question',type:'mc'}]};assert.equal(api.signature(a),api.signature(b));assert.notEqual(api.signature(a),api.signature({questions:[{...a.questions[0],answer:1}]}));assert.notEqual(api.signature(a),api.signature({questions:[{...a.questions[0],opts:['B','A']}]}));
});
test('legacy local self-assessment is upgraded to the stable version without losing marks',()=>{
 const quiz={id:'q',title:'Quiz',questions:[{type:'id',q:'Unit of life?',answer:'Cell'}]};let hash=2166136261;for(const ch of JSON.stringify(quiz.questions))hash=Math.imul(hash^ch.charCodeAt(0),16777619);const old=(hash>>>0).toString(36);
 const f=setup(quiz,{sets:{q:{signature:old,known:[0],starred:[0],position:0}},saved:['q']});f.api.renderLibrary();assert.equal(f.memory.sets.q.signature,f.api.signature(quiz));assert.deepEqual(JSON.parse(JSON.stringify(f.memory.sets.q.known)),[0]);assert.deepEqual(JSON.parse(JSON.stringify(f.memory.saved)),['q']);
});

test('legacy progress also upgrades when quiz content arrives after session boot',()=>{
 const quiz={id:'q',title:'Quiz',questions:[{q:'A question',answer:'An answer',type:'id'}]};let hash=2166136261;for(const ch of JSON.stringify(quiz.questions))hash=Math.imul(hash^ch.charCodeAt(0),16777619);
 const f=setup(null,{sets:{q:{signature:(hash>>>0).toString(36),known:[0],starred:[],position:0}},saved:[]});f.api.renderLibrary();f.state.quizzes=[quiz];f.api.renderLibrary();assert.equal(f.memory.sets.q.signature,f.api.signature(quiz));assert.deepEqual(JSON.parse(JSON.stringify(f.memory.sets.q.known)),[0]);
});
