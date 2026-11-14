import crypto from 'node:crypto';
import { documentRepo } from '../../repositories/documentRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { worldRepo, type LearningWorldRow, type QuestRow } from '../../repositories/worldRepo.ts';

const THEMES = ['nebula_core', 'quantum_citadel', 'algorithm_spire', 'neural_sanctum'];

export const worldService = {
  async generateWorldForDocument(
    userId: string,
    documentId: string,
    options: { refreshOnReprocess?: boolean } = {},
  ): Promise<{ world: LearningWorldRow; quests: QuestRow[] } | null> {
    const existing = worldRepo.findWorldByDocument(userId, documentId);
    if (existing && !options.refreshOnReprocess) {
      return { world: existing, quests: worldRepo.listQuestsForWorld(userId, existing.id) };
    }

    const doc = documentRepo.getDocument(userId, documentId);
    if (!doc) return null;

    const allTopics = topicRepo.listTopics(userId, { documentId });
    if (allTopics.length === 0) {
      return existing
        ? { world: existing, quests: worldRepo.listQuestsForWorld(userId, existing.id) }
        : null;
    }

    const primaryTopics = allTopics.filter((t) => t.kind === 'topic');
    const usableTopics = primaryTopics.length > 0 ? primaryTopics : allTopics;
    const existingWorlds = worldRepo.listWorlds(userId);

    const worldId = existing ? existing.id : crypto.randomUUID();
    const description = `Adaptive quest progression grounded in ${usableTopics.length} topics extracted from "${doc.title}".`;
    const world: LearningWorldRow = existing
      ? { ...existing, description, model: 'rule-based-v2' }
      : {
          id: worldId,
          user_id: userId,
          subject_id: doc.subject_id,
          document_id: documentId,
          position: existingWorlds.length + 1,
          title: `${doc.title} — Mastery World`,
          theme_key: THEMES[existingWorlds.length % THEMES.length],
          description,
          status: 'ready',
          model: 'rule-based-v2',
          prompt_version: 'rule-based-v2',
        };

    const quests: QuestRow[] = [];
    let pos = 1;
    let prevQuestId: string | null = null;

    // Build lesson + practice/checkpoint quests from real extracted topics (capped neatly)
    const sliceTopics = usableTopics.slice(0, 5);
    for (let i = 0; i < sliceTopics.length; i++) {
      const topic = sliceTopics[i];
      const lessonId = crypto.randomUUID();
      quests.push({
        id: lessonId,
        user_id: userId,
        world_id: worldId,
        position: pos++,
        kind: i === 0 ? 'lesson' : i % 2 === 1 ? 'practice' : 'checkpoint',
        title: `${i === 0 ? 'Explore' : i % 2 === 1 ? 'Practice' : 'Checkpoint'}: ${topic.name}`,
        intro: topic.summary || `Master the fundamentals of ${topic.name} from your study material.`,
        objective: `Achieve at least 70% accuracy on ${topic.name}.`,
        topic_ids: [topic.id],
        lesson_markdown: null,
        completion_rules: { lesson_required: true, min_items: 2, min_accuracy: 0.5 },
        mastery_threshold: 0.7,
        xp_reward: 50 + i * 15,
        unlock_rule: {
          requires_completed: prevQuestId ? [prevQuestId] : [],
          min_topic_score: null,
        },
        source_refs: topic.source_refs,
      });
      prevQuestId = lessonId;
    }

    // Final Boss Quest covering all extracted topics in the document
    const bossId = crypto.randomUUID();
    quests.push({
      id: bossId,
      user_id: userId,
      world_id: worldId,
      position: pos,
      kind: 'boss',
      title: `Boss Challenge: ${doc.title}`,
      intro: 'Face a multi-round escalating assessment across your extracted topics. Reach 75%+ accuracy to conquer this world.',
      objective: 'Defeat all 3 adaptive rounds with >= 75% overall accuracy.',
      topic_ids: usableTopics.map((t) => t.id),
      lesson_markdown: null,
      completion_rules: { lesson_required: false, min_items: 6, min_accuracy: 0.75 },
      mastery_threshold: 0.75,
      xp_reward: 150,
      unlock_rule: {
        requires_completed: prevQuestId ? [prevQuestId] : [],
        min_topic_score: null,
      },
      source_refs: usableTopics.flatMap((t) => t.source_refs).slice(0, 4),
    });

    if (existing) {
      worldRepo.replaceWorldQuestsIfUnattempted(userId, existing.id, description, quests);
      return {
        world: worldRepo.getWorld(userId, existing.id) || world,
        quests: worldRepo.listQuestsForWorld(userId, existing.id),
      };
    }

    worldRepo.createWorldWithQuests(world, quests);
    return { world, quests };
  },

  listWorldsWithProgress(userId: string) {
    const worlds = worldRepo.listWorlds(userId);
    const completedIds = worldRepo.getCompletedQuestIds(userId);
    const allAttempts = worldRepo.listAttemptsForUser(userId);

    return worlds.map((world) => {
      const quests = worldRepo.listQuestsForWorld(userId, world.id).map((q) => {
        const reqs = q.unlock_rule.requires_completed || [];
        const isUnlocked = reqs.every((id) => completedIds.has(id));
        const isCompleted = completedIds.has(q.id);
        const activeAttempt = allAttempts.find(
          (a) => a.quest_id === q.id && (a.status === 'in_progress' || a.status === 'paused'),
        );
        const bestAttempt = allAttempts
          .filter((a) => a.quest_id === q.id && a.status === 'completed')
          .sort((a, b) => (b.score || 0) - (a.score || 0))[0];

        return {
          ...q,
          is_unlocked: isUnlocked,
          is_completed: isCompleted,
          active_attempt: activeAttempt || null,
          best_score: bestAttempt?.score ?? null,
        };
      });

      const completedCount = quests.filter((q) => q.is_completed).length;
      return {
        ...world,
        quests,
        completed_count: completedCount,
        total_quests: quests.length,
        progress_percent: quests.length > 0 ? Math.round((completedCount / quests.length) * 100) : 0,
      };
    });
  },
};
