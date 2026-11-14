import crypto from 'node:crypto';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { misconceptionRepo } from '../../repositories/misconceptionRepo.ts';
import { worldRepo } from '../../repositories/worldRepo.ts';
import { progressRepo, type RecommendationRow } from '../../repositories/progressRepo.ts';

export const recommendationService = {
  recompute(userId: string): RecommendationRow[] {
    const docs = documentRepo.listDocuments(userId, null, 'ready');
    const items: Array<Omit<RecommendationRow, 'generated_at' | 'expires_at' | 'rules_version'>> = [];

    if (docs.length === 0) {
      items.push({
        id: crypto.randomUUID(),
        user_id: userId,
        kind: 'upload_material',
        target_type: 'upload',
        target_id: null,
        title: 'Upload your first study material',
        reason: 'Upload a PDF, DOCX, PPTX, or TXT file to extract topics, ask the tutor, and generate your first Learning World.',
        evidence: { ready_documents: 0 },
        priority: 100,
        status: 'active',
      });
      progressRepo.replaceActiveRecommendations(userId, items);
      return progressRepo.listRecommendations(userId);
    }

    // 1. Confirmed / suspected misconceptions take top priority
    const threads = misconceptionRepo
      .listThreads(userId)
      .filter((t) => t.status === 'confirmed' || t.status === 'suspected' || t.status === 'improving');
    for (const thread of threads.slice(0, 2)) {
      items.push({
        id: crypto.randomUUID(),
        user_id: userId,
        kind: 'resolve_misconception',
        target_type: 'misconception_thread',
        target_id: thread.id,
        title: `Resolve: ${thread.label}`,
        reason:
          thread.status === 'confirmed'
            ? `Confirmed across ${thread.occurrences} mistakes in ${thread.topic_name_snapshot || 'this topic'}. Complete the corrective lesson to solidify mastery.`
            : `Possible misconception flagged (${thread.occurrences} observation). Verify your mental model with a quick check.`,
        evidence: {
          status: thread.status,
          occurrences: thread.occurrences,
          confidence: thread.confidence_agg,
          topic_name: thread.topic_name_snapshot,
        },
        priority: thread.status === 'confirmed' ? 95 : 82,
        status: 'active',
      });
    }

    // 2. Weak or needs_practice topics
    const masteryList = topicRepo.listMastery(userId);
    const weakTopics = masteryList
      .filter((m) => m.topic_id && (m.band === 'weak' || m.band === 'needs_practice'))
      .sort((a, b) => a.score - b.score);
    for (const wm of weakTopics.slice(0, 2)) {
      items.push({
        id: crypto.randomUUID(),
        user_id: userId,
        kind: 'practice_topic',
        target_type: 'topic',
        target_id: wm.topic_id,
        title: `Practice ${wm.topic_name_snapshot}`,
        reason: `Current mastery is ${Math.round(wm.score)}% across ${wm.evidence_count} evaluated answers (${wm.band.replace('_', ' ')}).`,
        evidence: {
          score: wm.score,
          band: wm.band,
          evidence_count: wm.evidence_count,
          confidence: wm.confidence,
        },
        priority: 85,
        status: 'active',
      });
    }

    // 3. Unassessed topics → recommend diagnostic
    const unassessed = masteryList.filter((m) => m.topic_id && m.band === 'unassessed');
    if (unassessed.length > 0 && weakTopics.length === 0) {
      items.push({
        id: crypto.randomUUID(),
        user_id: userId,
        kind: 'practice_topic',
        target_type: 'document',
        target_id: docs[0].id,
        title: `Take a Diagnostic Quiz on "${docs[0].title}"`,
        reason: `${unassessed.length} extracted topics have not been assessed yet. Establish your baseline mastery.`,
        evidence: { unassessed_topics: unassessed.length, document_title: docs[0].title },
        priority: 78,
        status: 'active',
      });
    }

    // 4. Unlocked quests / Boss battles
    const worlds = worldRepo.listWorlds(userId);
    const completedIds = worldRepo.getCompletedQuestIds(userId);
    for (const w of worlds) {
      const quests = worldRepo.listQuestsForWorld(userId, w.id);
      for (const q of quests) {
        if (completedIds.has(q.id)) continue;
        const reqs = q.unlock_rule.requires_completed || [];
        const unlocked = reqs.every((id) => completedIds.has(id));
        if (unlocked) {
          items.push({
            id: crypto.randomUUID(),
            user_id: userId,
            kind: q.kind === 'boss' ? 'take_boss' : 'take_quest',
            target_type: q.kind === 'boss' ? 'boss' : 'quest',
            target_id: q.id,
            title: q.kind === 'boss' ? `Challenge Boss: ${q.title}` : `Continue Quest: ${q.title}`,
            reason:
              q.kind === 'boss'
                ? `All prerequisite quests in "${w.title}" are complete. Score 75%+ to conquer the boss!`
                : `Next unlocked step in "${w.title}" (+${q.xp_reward} XP).`,
            evidence: { world_title: w.title, quest_kind: q.kind, xp_reward: q.xp_reward },
            priority: q.kind === 'boss' ? 80 : 70,
            status: 'active',
          });
          break;
        }
      }
    }

    progressRepo.replaceActiveRecommendations(userId, items.slice(0, 6));
    return progressRepo.listRecommendations(userId);
  },
};
