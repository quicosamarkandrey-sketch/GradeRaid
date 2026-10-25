// Phase 7 (Stream A) — bridge for db-schema.js.
import { DB_KEY, QUEST_IMAGES, DEFAULT_DB, loadDB, saveDB } from '../../src/db-schema.js';

window.DB_KEY = DB_KEY;
window.QUEST_IMAGES = QUEST_IMAGES;
window.DEFAULT_DB = DEFAULT_DB;
window.loadDB = loadDB;
window.saveDB = saveDB;
