// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/starter-pack-service.js
//  Service layer for the admin-only Starter Pack Editor.
//  (ISOLATION_ROLES_PLAN.md §6 "Starter pack — the mechanism", §7 "draft
//   content", §11 "Starter-template editor", §12 step 5, chunk B — see
//   supabase/phase38_starter_pack.sql.)
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module in
//  this app (TeacherDirectoryService, SectionService, RegistrationService):
//  starter-pack-editor.js (the render layer) NEVER calls DBService.rpc()
//  directly. It calls StarterPackService.<method>(...).
//
//  WHAT'S HERE
//    fetch() — reads all 5 tables' is_starter_template rows in one call
//    (get_starter_pack()).
//    saveAchievement() / saveTitle() / saveQuiz() / saveCampaignWorld() /
//    saveShopItem() — each is create-or-update (the caller always supplies
//    an id — a new one from uid() for "add new", or the existing row's id
//    for "edit"), backed by the matching upsert_starter_*() RPC.
//    deleteAchievement() / deleteTitle() / deleteQuiz() / deleteCampaignWorld()
//    / deleteShopItem() — reuse the EXISTING delete_achievement()/
//    delete_title()/delete_quiz()/delete_campaign_world()/delete_shop_product()
//    RPCs unchanged (an admin session already passes their ownership check
//    regardless of who owns the row — see phase38's header note).
//
//  This deliberately does NOT go through AppStore/DB.achievements etc. —
//  starter-pack content is admin-only template data, never part of any
//  logged-in user's own catalog cache (db-service.js's pull filters
//  is_starter_template rows OUT of those arrays specifically so this stays
//  true). This screen fetches and mutates its own separate, short-lived
//  local state instead — see starter-pack-editor.js.
// ═══════════════════════════════════════════════════════════════════════════════

window.StarterPackService = (function () {
  'use strict';

  /**
   * fetch() → Promise<{ok, pack?, error?}>
   * pack shape: { achievements:[], titles:[], quizzes:[], campaignWorlds:[], shopProducts:[] }
   */
  async function fetch() {
    const { data, error } = await DBService.rpc('get_starter_pack', {});
    if (error) return { ok: false, error: error.message || 'Could not load the starter pack.' };
    return { ok: true, pack: data || { achievements: [], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] } };
  }

  async function saveAchievement(a) {
    const { data, error } = await DBService.rpc('upsert_starter_achievement', {
      p_id: a.id, p_name: a.name, p_description: a.description || '', p_icon: a.icon || '🏅',
      p_category: a.category || 'General', p_rarity: a.rarity || 'Common',
      p_xp_reward: a.xpReward || 0, p_coin_reward: a.coinReward || 0,
      p_trigger_type: a.triggerType || 'manual', p_trigger_value: a.triggerValue || 0,
      p_active: a.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this achievement.' };
    return { ok: true, row: data };
  }

  async function saveTitle(t) {
    const { data, error } = await DBService.rpc('upsert_starter_title', {
      p_id: t.id, p_name: t.name, p_description: t.description || '', p_icon: t.icon || '🎖️',
      p_rarity: t.rarity || 'Common', p_active: t.active !== false,
      p_text_color: t.textColor || null, p_border_color: t.borderColor || null,
      p_glow_color: t.glowColor || null, p_bg_color: t.bgColor || null,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this title.' };
    return { ok: true, row: data };
  }

  async function saveQuiz(q) {
    const { data, error } = await DBService.rpc('upsert_starter_quiz', {
      p_id: q.id, p_title: q.title, p_description: q.description || '',
      p_xp_reward: q.xpReward || 0, p_coin_reward: q.coinReward || 0,
      p_time_limit: q.timeLimit || null, p_questions: q.questions || [],
      p_active: q.active !== false,
      p_rarity: q.rarity || 'Common', p_cadence: q.cadence || 'standing',
      // Phase 60 pass-through — no form fields for these yet on this screen,
      // so we round-trip whatever the read RPC handed us in `q` rather than
      // omitting them (omitting = RPC falls back to its SQL DEFAULTs, which
      // would silently null/reset chain+schedule data on every save).
      p_chain_id: q.chainId ?? null, p_chain_order: q.chainOrder ?? 1, p_chain_label: q.chainLabel ?? null,
      p_start_date: q.startDate ?? null, p_end_date: q.endDate ?? null,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this quiz.' };
    return { ok: true, row: data };
  }

  async function saveCampaignWorld(w) {
    const { data, error } = await DBService.rpc('upsert_starter_campaign_world', {
      p_id: w.id, p_label: w.label, p_icon: w.icon || '🗺️', p_color: w.color || '#8b5cf6',
      p_description: w.description || '', p_stages: w.stages || [], p_active: w.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this campaign world.' };
    return { ok: true, row: data };
  }

  async function saveShopItem(p) {
    const { data, error } = await DBService.rpc('upsert_starter_shop_item', {
      p_id: p.id, p_name: p.name, p_emoji: p.emoji || '🎁', p_description: p.description || '',
      p_category: p.category || 'General', p_cost: p.cost || 0, p_active: p.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this shop item.' };
    return { ok: true, row: data };
  }

  async function deleteAchievement(id) {
    const { error } = await DBService.rpc('delete_achievement', { p_achievement_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this achievement.' };
    return { ok: true };
  }

  async function deleteTitle(id) {
    const { error } = await DBService.rpc('delete_title', { p_title_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this title.' };
    return { ok: true };
  }

  async function deleteQuiz(id) {
    const { error } = await DBService.rpc('delete_quiz', { p_quiz_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this quiz.' };
    return { ok: true };
  }

  async function deleteCampaignWorld(id) {
    const { error } = await DBService.rpc('delete_campaign_world', { p_world_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this campaign world.' };
    return { ok: true };
  }

  async function deleteShopItem(id) {
    const { error } = await DBService.rpc('delete_shop_product', { p_product_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this shop item.' };
    return { ok: true };
  }

  return {
    fetch,
    saveAchievement, saveTitle, saveQuiz, saveCampaignWorld, saveShopItem,
    deleteAchievement, deleteTitle, deleteQuiz, deleteCampaignWorld, deleteShopItem,
  };
})();
