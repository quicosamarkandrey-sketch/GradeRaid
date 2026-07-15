// ─────────────────────────────────────────────────────────────────────────────
// DB SCHEMA  — DB_KEY, QUEST_IMAGES, DEFAULT_DB
//
// This file defines the shape of the application database.
// Every DB.tableName reference across all modules maps back to keys defined here.
// This file is the schema contract.
//
// DEPENDENCY: DBService must be declared before this file is evaluated.
//   (DB_KEY is derived from DBService.storageKey)
// ─────────────────────────────────────────────────────────────────────────────

const DB_KEY = DBService.storageKey;

const QUEST_IMAGES = [
  'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&q=80', // math/science
  'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=600&q=80', // lab
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80', // study
  'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&q=80', // space
  'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600&q=80', // tech
];

const DEFAULT_DB = {
  schemaVersion: 3,
  students:[
    {id:'jose',pass:'pass123',name:'Jose Miguel Santos',init:'JM',color:'#8b5cf6',xp:12450,coins:2840,level:12,tier:'Scholar',rank:3,attendance:95,quizAvg:88,completedQuizzes:[]},
    {id:'ana',pass:'pass123',name:'Ana Mendoza',init:'AM',color:'#C0C0C0',xp:11820,coins:2100,level:11,tier:'Scholar',rank:2,attendance:100,quizAvg:96,completedQuizzes:[]},
    {id:'karl',pass:'pass123',name:'Karl Reyes',init:'KR',color:'#FFB800',xp:14300,coins:3200,level:14,tier:'Master',rank:1,attendance:98,quizAvg:98,completedQuizzes:[]},
    {id:'maria',pass:'pass123',name:'Maria Pascual',init:'MP',color:'#4edea3',xp:10900,coins:1800,level:10,tier:'Achiever',rank:4,attendance:93,quizAvg:91,completedQuizzes:[]},
    {id:'diego',pass:'pass123',name:'Diego Go',init:'DG',color:'#d0bcff',xp:8700,coins:980,level:8,tier:'Scholar',rank:5,attendance:88,quizAvg:84,completedQuizzes:[]},
  ],
  admin:{id:'admin',pass:'admin123',name:'Ms. Garcia',role:'Teacher'},
  store:[
    {id:'s1',emoji:'🍫',name:'Chocolate Bar',desc:'Sweet milk chocolate treat. Restores 10 Mana.',cat:'food',cost:100,stock:15},
    {id:'s2',emoji:'🍬',name:'Candy Pack',desc:'Assorted fruity candies for a quick boost.',cat:'food',cost:50,stock:30},
    {id:'s3',emoji:'🥤',name:'Juice Box',desc:'Apple or mango juice. +5 Focus.',cat:'food',cost:80,stock:20},
    {id:'s4',emoji:'🍿',name:'Popcorn',desc:'Buttered popcorn bag for movie nights.',cat:'food',cost:120,stock:8},
    {id:'s5',emoji:'✏️',name:'Enchanted Pencil Set',desc:'5-piece colored set. +3 Intelligence.',cat:'supplies',cost:80,stock:25},
    {id:'s6',emoji:'📒',name:'Arcane Notebook',desc:'Lined 100-page tome. Grants +5 Intelligence when used.',cat:'supplies',cost:150,stock:12},
    {id:'s7',emoji:'⭐',name:'+5 Quiz Bonus',desc:'Add 5 pts to your next quiz score.',cat:'privilege',cost:300,stock:5},
    {id:'s8',emoji:'💺',name:'Seat Choice',desc:'Pick any seat in class for a full week.',cat:'privilege',cost:200,stock:10},
    {id:'s9',emoji:'📴',name:'Free HW Pass',desc:'Skip one homework assignment, no penalty.',cat:'privilege',cost:500,stock:3},
    {id:'s10',emoji:'❓',name:'Mystery Box',desc:'Contains one random item of Rare quality or better.',cat:'mystery',cost:500,stock:7},
  ],
  quizzes:[
    // Phase 1 — question `type` field added ('mc' explicit on legacy questions
    // for clarity; eqQType() in utils.js already defaults missing type to
    // 'mc' so older/未-tagged data never breaks). q1 also demonstrates a
    // mixed-type quest: multiple choice + true/false + identification in
    // the same reviewer, same as a real teacher would build.
    {id:'q1',title:'Science — Chapter 5',desc:'Photosynthesis & Cell Biology. Master the building blocks of life.',xpReward:150,coinReward:80,timeLimit:10,questions:[
      {type:'mc',q:'What organelle performs photosynthesis?',opts:['Mitochondria','Chloroplast','Nucleus','Ribosome'],answer:1},
      {type:'mc',q:'What gas do plants release during photosynthesis?',opts:['Carbon Dioxide','Nitrogen','Oxygen','Hydrogen'],answer:2},
      {type:'mc',q:'Which part of the plant absorbs sunlight?',opts:['Root','Stem','Leaf','Flower'],answer:2},
      {type:'tf',q:'Plants release oxygen as a byproduct of photosynthesis.',opts:['True','False'],answer:0},
      {type:'id',q:'What pigment gives plants their green color?',answer:'Chlorophyll',altAnswers:['chlorophyl']},
    ]},
    {id:'q2',title:'Math — Algebra Quiz',desc:'Linear equations & expressions. Solve the Riddles of the X Variable.',xpReward:120,coinReward:60,timeLimit:8,questions:[
      {type:'mc',q:'Solve: 2x + 4 = 12',opts:['x = 2','x = 4','x = 6','x = 8'],answer:1},
      {type:'mc',q:'What is the slope of y = 3x + 5?',opts:['5','2','3','1'],answer:2},
      {type:'mc',q:'Simplify: 4(x + 2) - 3x',opts:['x + 2','x + 8','7x + 2','x + 6'],answer:1},
    ]},
  ],
  pointLog:[
    {studentId:'jose',what:'Recitation - Chapter 7',pts:10,when:'10 min ago'},
    {studentId:'jose',what:'Attendance Check',pts:5,when:'1 hr ago'},
    {studentId:'jose',what:'Late to Class',pts:-5,when:'Yesterday'},
    {studentId:'jose',what:'Quiz #5 — Perfect Score',pts:20,when:'Yesterday'},
  ],
  redemptions:[
    {studentId:'jose',item:'🍫 Chocolate Bar',pts:100,date:'May 30'},
    {studentId:'jose',item:'⭐ +5 Quiz Bonus',pts:300,date:'May 28'},
  ],
  orders:[], // Phase 48 — synced via `orders` table; see shop_store.js cartCheckout()
  inventory:{}, // Phase 48 — synced via `inventory` table; see shop_store.js / shop_inventory.js
  achievements:[
    {id:'a_quiz_master',name:'Quiz Master',description:'Score 100% on a quiz',icon:'🧠',category:'Quiz Performance',rarity:'Rare',xpReward:100,coinReward:100,triggerType:'quiz_score',triggerValue:100,active:true},
    {id:'a_attendance_star',name:'Perfect Attendance',description:'Maintain 100% attendance',icon:'📅',category:'Attendance',rarity:'Uncommon',xpReward:80,coinReward:50,triggerType:'attendance_pct',triggerValue:100,active:true},
    {id:'a_boss_champion',name:'Boss Champion',description:'Defeat a boss with your team',icon:'🐲',category:'Boss Battles',rarity:'Epic',xpReward:120,coinReward:150,triggerType:'boss_victories',triggerValue:1,active:true},
  ],
  achievementUnlocks:{
    jose:[{achId:'a_attendance_star',unlockedAt:'2026-06-10T08:00:00.000Z',xpGranted:80,coinsGranted:50}],
  },
  titles:[
    {id:'t1',name:'Quiz Conqueror',description:'Earned by scoring 100% on a quiz',icon:'🎖️',rarity:'Rare',active:true,achievementId:'a_quiz_master',textColor:'#ffffff',borderColor:'#60a5fa',glowColor:'#60a5fa',bgColor:'#111827',primaryColor:'#93c5fd',secondaryColor:'#60a5fa',gradientFrom:'#6366f1',gradientTo:'#0ea5e9',borderStyle:'double',animation:'glow-pulse',particles:'sparkles',bgEffect:'gradient',customBorderCSS:'',customAnimationCSS:'',customBgCSS:'',createdAt:'2026-06-10T08:00:00.000Z'},
    {id:'t2',name:'Attendance Ace',description:'Awarded for perfect attendance',icon:'📜',rarity:'Uncommon',active:true,achievementId:'a_attendance_star',textColor:'#1f2937',borderColor:'#fbbf24',glowColor:'#fbbf24',bgColor:'#fef3c7',primaryColor:'#fde68a',secondaryColor:'#fbbf24',gradientFrom:'#fbbf24',gradientTo:'#f59e0b',borderStyle:'solid',animation:'pulse',particles:'embers',bgEffect:'none',customBorderCSS:'',customAnimationCSS:'',customBgCSS:'',createdAt:'2026-06-10T08:00:00.000Z'},
    {id:'t3',name:'Boss Tamer',description:'A title granted by rewards or teacher recognition',icon:'🐉',rarity:'Epic',active:true,achievementId:null,textColor:'#ffffff',borderColor:'#f472b6',glowColor:'#f472b6',bgColor:'#1f1237',primaryColor:'#fda4af',secondaryColor:'#f472b6',gradientFrom:'#9333ea',gradientTo:'#fb7185',borderStyle:'solid',animation:'float',particles:'stars',bgEffect:'anim-grad',customBorderCSS:'',customAnimationCSS:'',customBgCSS:'',createdAt:'2026-06-10T08:00:00.000Z'},
  ],
  titleUnlocks:{
    jose:['t2'],
  },
  equippedTitles:{
    jose:'t2',
  },
  attendanceSessions:[],
  recitationLog:[],
  mail:[], // Phase 15 — synced via mail_messages when Supabase is configured
  // Phase 67 — student notification bell. Rows are synthesized client-side
  // by notification-service.js from DB.pointLog / DB.orders (never written
  // directly at the source — see that file's header comment for why), and
  // synced via the `notifications` table (phase67_notifications.sql).
  notifications:[],
  quizSectionAssignments:{}, // Phase 15 — {quizId: [classId, ...]}, synced via quiz_sections
  // Phase 60 (exploit fix) — {studentId: {quizId: true}}. A one-time,
  // teacher/parent-granted exception that lets a student take one more
  // attempt on a quiz that's hit the hard scored-attempt cap before its
  // 24h cooldown has elapsed. Consumed (deleted) the moment it's used —
  // see startQuiz() / eqQuizAttemptStatus() in index.html + utils.js.
  quizAttemptOverrides:{},
  achievementSectionAssignments:{}, // Phase 16 — {achievementId: [classId, ...]}, synced via achievement_sections
  titleSectionAssignments:{}, // Phase 21 — {titleId: [classId, ...]}, synced via title_sections
  // Phase 7 (Campaign Redesign) — {studentId: {hint, heal, shield}} skill
  // counts (Decision #5). Written ONLY via the campaign engine's
  // adjust_student_skill_count() RPC calls (modules/campaign/campaign_engine.js)
  // — same "RPC only, never bulk upsert" convention as titleUnlocks/
  // achievementUnlocks above. See supabase/phase68_campaign_student_skills.sql.
  studentSkills:{},
  stageMap:[
    {
      id:'w1',label:'Arcanum Basics',icon:'⚗️',color:'#8b5cf6',desc:'Foundation spells of knowledge.',
      stages:[
        {id:'s1',title:'The Awakening',icon:'⭐',type:'normal',xp:50,coins:20,lives:3,
          scenes:[
            {type:'story',speaker:'NARRATOR',text:'You stand at the gates of EduQuest Academy. Ancient runes glow along the walls, whispering secrets of knowledge long forgotten.',bg:'#1a0a2e'},
            {type:'story',speaker:'NARRATOR',text:'A small spirit appears before you. "Welcome, young scholar. Your journey begins now. But first… you must prove yourself!"',bg:'#1a0a2e'},
          ],
          enemies:[
            {sprite:'👺',name:'Goblin Guard',title:'ENEMY ENCOUNTER',questions:[
              {q:'What is 2 + 2?',opts:['3','4','5','6'],answer:1},
            ]},
          ],
          outro:[{type:'story',speaker:'NARRATOR',text:'The goblin vanishes in a puff of smoke. The gates swing open. Your quest has truly begun!',bg:'#0e1a0e'}],
        },
        {id:'s2',title:'Alphabet Ruins',icon:'📖',type:'normal',xp:75,coins:30,lives:3,
          scenes:[
            {type:'story',speaker:'NARRATOR',text:'Ancient stone tablets fill this chamber, each carved with letters from forgotten languages.',bg:'#1a1208'},
          ],
          enemies:[
            {sprite:'📜',name:'Letter Wraith',title:'LETTER WRAITH AWAKENS',questions:[
              {q:'Which letter comes after "D" in the alphabet?',opts:['C','E','F','B'],answer:1},
              {q:'How many vowels are in the English alphabet?',opts:['4','5','6','7'],answer:1},
            ]},
          ],
          outro:[{type:'story',speaker:'NARRATOR',text:'The ruins tremble as you decipher the last rune. A new path opens ahead.',bg:'#0e1a0e'}],
        },
        {id:'s3',title:'The First Trial',icon:'👑',type:'boss',xp:300,coins:150,lives:5,
          scenes:[
            {type:'story',speaker:'NARRATOR',text:'The chamber fills with an ominous red glow. This is it — the first major trial.',bg:'#1a0808'},
            {type:'story',speaker:'NARRATOR',text:'"Face me, scholar!" booms the Trial Keeper. "Answer my questions or be cast back to the beginning!"',bg:'#1a0808'},
          ],
          enemies:[
            {sprite:'👾',name:'Trial Keeper',title:'⚠️ BOSS BATTLE',questions:[
              {q:'What is 5 × 6?',opts:['25','30','35','40'],answer:1},
              {q:'Which planet is closest to the Sun?',opts:['Venus','Earth','Mercury','Mars'],answer:2},
              {q:'What is the capital of the Philippines?',opts:['Cebu','Davao','Manila','Quezon City'],answer:2},
            ]},
          ],
          outro:[{type:'story',speaker:'NARRATOR',text:'The Trial Keeper crumbles to dust. "Impressive… you may pass." A golden light fills the room!',bg:'#1a1400'}],
        },
      ]
    },
    {
      id:'w2',label:'Science Citadel',icon:'🧪',color:'#4edea3',desc:'Unravel the mysteries of the natural world.',
      stages:[
        {id:'s4',title:'Cell Kingdom',icon:'🔬',type:'normal',xp:150,coins:60,lives:3,
          scenes:[
            {type:'story',speaker:'NARRATOR',text:'You enter a microscopic world where giant cell organelles tower above you like buildings in a city.',bg:'#081a10'},
          ],
          enemies:[
            {sprite:'🦠',name:'Virus Invader',title:'VIRUS INVADER ATTACKS',questions:[
              {q:'What organelle is known as the powerhouse of the cell?',opts:['Nucleus','Ribosome','Mitochondria','Vacuole'],answer:2},
              {q:'What do plants use to make their own food?',opts:['Water only','Sunlight only','Sunlight, CO₂ & Water','Soil minerals'],answer:2},
            ]},
          ],
          outro:[{type:'story',speaker:'NARRATOR',text:'The virus retreats. Your knowledge of cells has saved the kingdom!',bg:'#081a10'}],
        },
        {id:'s5',title:'The Molecule Dragon',icon:'🐉',type:'boss',xp:500,coins:250,lives:5,
          scenes:[
            {type:'story',speaker:'NARRATOR',text:'A massive dragon made of intertwined molecules blocks your path, breathing fire made of chemical reactions!',bg:'#1a0808'},
          ],
          enemies:[
            {sprite:'🐉',name:'Molecule Dragon',title:'⚠️ BOSS: MOLECULE DRAGON',questions:[
              {q:'What gas do plants release during photosynthesis?',opts:['CO₂','Nitrogen','Oxygen','Hydrogen'],answer:2},
              {q:'What is the chemical symbol for water?',opts:['WA','H₂O','HO₂','W₂H'],answer:1},
              {q:'How many bones does an adult human have?',opts:['196','206','216','226'],answer:1},
            ]},
          ],
          outro:[{type:'story',speaker:'NARRATOR',text:'The Molecule Dragon dissolves into harmless steam. Science has prevailed!',bg:'#081a10'}],
        },
      ]
    },
  ],
};

function loadDB() {
  return DBService.read(DEFAULT_DB);
}

function saveDB() {
  DBService.write(DB);
}