// ═══════════════════════════════════════════════════════════════════════════════
//  EduQuest — modules/admin/content-oversight-service.js
//  Service layer for Chunk C: Content Oversight (read-only drill-in + "Edit as").
//  (ISOLATION_ROLES_PLAN.md Chunk C — see supabase/phase41_content_oversight.sql,
//   audit-log-service.js, teacher-directory-service.js.)
//
//  REPOSITORY PATTERN CONTRACT — same rule as every other *Service module:
//  content-oversight.js (the render layer) NEVER calls DBService.rpc() or
//  AuditLogService directly — it calls ContentOversightService.<method>(...).
//  This file is the ONLY place that pairs an oversight write with its
//  log_edit_as_action() call, so "every Edit-as write gets logged" is
//  enforced in one spot rather than repeated per render-layer call site.
//
//  Deliberately does NOT touch AppStore/DB.achievements etc. — same reason
//  starter-pack-service.js stays separate (see its header): another
//  teacher's content must never end up mixed into the admin's own local
//  catalog cache. This screen fetches and mutates its own separate,
//  short-lived local state instead.
//
//  WHAT'S HERE
//    fetchTeacherContent(teacherId) — read-only bundle (get_teacher_content()).
//    saveAchievement()/saveTitle()/saveQuiz()/saveCampaignWorld()/saveShopItem()
//      — each takes { teacherId, row, isNew }, calls the matching
//      oversight_upsert_*() RPC, then logs via AuditLogService on success.
//    deleteAchievement()/deleteTitle()/deleteQuiz()/deleteCampaignWorld()/
//    deleteShopItem() — reuse the EXISTING delete_*() RPCs unchanged (they
//    already accept any admin regardless of owner), then log the delete.
//
//  A write RPC succeeding but the follow-up log call failing is a real gap
//  (the two aren't atomic) — same tradeoff already accepted in Chunk E's
//  design note. If that ever matters in practice, wrapping both in a single
//  RPC is the fix; not done here to keep this chunk's SQL surface small.
// ═══════════════════════════════════════════════════════════════════════════════

window.ContentOversightService = (function () {
  'use strict';

  async function fetchTeacherContent(teacherId) {
    const { data, error } = await DBService.rpc('get_teacher_content', { p_owner_teacher_id: teacherId });
    if (error) return { ok: false, error: error.message || 'Could not load this teacher\u2019s content.' };
    return { ok: true, content: data || { achievements: [], titles: [], quizzes: [], campaignWorlds: [], shopProducts: [] } };
  }

  async function _logWrite(teacherId, tableName, recordId, action) {
    // Best-effort — a logging failure shouldn't undo an otherwise-successful
    // save/delete or block the admin from continuing; surfaced via console
    // only. See header note on the non-atomicity tradeoff.
    const res = await AuditLogService.logEditAsAction({ targetTeacherId: teacherId, tableName, recordId, action });
    if (!res.ok) console.error('[EduQuest] Edit-as action succeeded but logging failed:', tableName, recordId, action, res.error);
  }

  async function saveAchievement(teacherId, a, isNew) {
    const { data, error } = await DBService.rpc('oversight_upsert_achievement', {
      p_owner_teacher_id: teacherId,
      p_id: a.id, p_name: a.name, p_description: a.description || '', p_icon: a.icon || '🏅',
      p_category: a.category || 'General', p_rarity: a.rarity || 'Common',
      p_xp_reward: a.xpReward || 0, p_coin_reward: a.coinReward || 0,
      p_trigger_type: a.triggerType || 'manual', p_trigger_value: a.triggerValue || 0,
      p_active: a.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this achievement.' };
    await _logWrite(teacherId, 'achievements', data.id, isNew ? 'create' : 'update');
    return { ok: true, row: data };
  }

  async function saveTitle(teacherId, t, isNew) {
    const { data, error } = await DBService.rpc('oversight_upsert_title', {
      p_owner_teacher_id: teacherId,
      p_id: t.id, p_name: t.name, p_description: t.description || '', p_icon: t.icon || '🎖️',
      p_rarity: t.rarity || 'Common', p_active: t.active !== false,
      p_text_color: t.textColor || null, p_border_color: t.borderColor || null,
      p_glow_color: t.glowColor || null, p_bg_color: t.bgColor || null,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this title.' };
    await _logWrite(teacherId, 'titles', data.id, isNew ? 'create' : 'update');
    return { ok: true, row: data };
  }

  async function saveQuiz(teacherId, q, isNew) {
    const { data, error } = await DBService.rpc('oversight_upsert_quiz', {
      p_owner_teacher_id: teacherId,
      p_id: q.id, p_title: q.title, p_description: q.description || '',
      p_xp_reward: q.xpReward || 0, p_coin_reward: q.coinReward || 0,
      p_time_limit: q.timeLimit || null, p_questions: q.questions || [],
      p_active: q.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this quiz.' };
    await _logWrite(teacherId, 'quizzes', data.id, isNew ? 'create' : 'update');
    return { ok: true, row: data };
  }

  async function saveCampaignWorld(teacherId, w, isNew) {
    const { data, error } = await DBService.rpc('oversight_upsert_campaign_world', {
      p_owner_teacher_id: teacherId,
      p_id: w.id, p_label: w.label, p_icon: w.icon || '🗺️', p_color: w.color || '#8b5cf6',
      p_description: w.description || '', p_stages: w.stages || [], p_active: w.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this campaign world.' };
    await _logWrite(teacherId, 'campaign_worlds', data.id, isNew ? 'create' : 'update');
    return { ok: true, row: data };
  }

  async function saveShopItem(teacherId, p, isNew) {
    const { data, error } = await DBService.rpc('oversight_upsert_shop_item', {
      p_owner_teacher_id: teacherId,
      p_id: p.id, p_name: p.name, p_emoji: p.emoji || '🎁', p_description: p.description || '',
      p_category: p.category || 'General', p_cost: p.cost || 0, p_active: p.active !== false,
    });
    if (error) return { ok: false, error: error.message || 'Could not save this shop item.' };
    await _logWrite(teacherId, 'shop_products', data.id, isNew ? 'create' : 'update');
    return { ok: true, row: data };
  }

  async function deleteAchievement(teacherId, id) {
    const { error } = await DBService.rpc('delete_achievement', { p_achievement_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this achievement.' };
    await _logWrite(teacherId, 'achievements', id, 'delete');
    return { ok: true };
  }

  async function deleteTitle(teacherId, id) {
    const { error } = await DBService.rpc('delete_title', { p_title_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this title.' };
    await _logWrite(teacherId, 'titles', id, 'delete');
    return { ok: true };
  }

  async function deleteQuiz(teacherId, id) {
    const { error } = await DBService.rpc('delete_quiz', { p_quiz_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this quiz.' };
    await _logWrite(teacherId, 'quizzes', id, 'delete');
    return { ok: true };
  }

  async function deleteCampaignWorld(teacherId, id) {
    const { error } = await DBService.rpc('delete_campaign_world', { p_world_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this campaign world.' };
    await _logWrite(teacherId, 'campaign_worlds', id, 'delete');
    return { ok: true };
  }

  async function deleteShopItem(teacherId, id) {
    const { error } = await DBService.rpc('delete_shop_product', { p_product_id: id });
    if (error) return { ok: false, error: error.message || 'Could not delete this shop item.' };
    await _logWrite(teacherId, 'shop_products', id, 'delete');
    return { ok: true };
  }

  return {
    fetchTeacherContent,
    saveAchievement, saveTitle, saveQuiz, saveCampaignWorld, saveShopItem,
    deleteAchievement, deleteTitle, deleteQuiz, deleteCampaignWorld, deleteShopItem,
  };
})();
