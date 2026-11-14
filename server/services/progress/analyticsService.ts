import { getDb } from '../../core/database.ts';
import { identityRepo } from '../../repositories/identityRepo.ts';
import { misconceptionRepo } from '../../repositories/misconceptionRepo.ts';
import { progressRepo } from '../../repositories/progressRepo.ts';
import { topicRepo } from '../../repositories/topicRepo.ts';
import { worldRepo } from '../../repositories/worldRepo.ts';
import { getLocalDateString, xpThresholdForLevel } from './xpService.ts';

export const analyticsService = {
  getOverview(userId: string) {
    const db = getDb();
    const profile = identityRepo.getProfile(userId);
    const prefs = identityRepo.getPreferences(userId);
    const stats = identityRepo.getStats(userId)!;
    const timezone = profile?.timezone || 'UTC';
    const todayLocal = getLocalDateString(timezone);

    // 7-day window dates
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() - i);
      days.push(getLocalDateString(timezone, dt));
    }

    const sessions = progressRepo.listSessionsSince(userId, days[0]);
    const dailyMap = new Map<string, number>();
    for (const d of days) dailyMap.set(d, 0);
    for (const s of sessions) {
      dailyMap.set(s.local_date, (dailyMap.get(s.local_date) || 0) + s.active_seconds);
    }

    const weeklyActivity = days.map((d) => ({
      date: d,
      label: d.slice(5),
      minutes: Math.round(((dailyMap.get(d) || 0) / 60) * 10) / 10,
    }));

    const todaySeconds = dailyMap.get(todayLocal) || 0;
    const todayMinutes = Math.round((todaySeconds / 60) * 10) / 10;

    // Derived assessment & answer stats
    const answerAgg = db
      .prepare(
        `SELECT COUNT(*) as total_answers,
                SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct_answers
         FROM student_answers WHERE user_id = ?`,
      )
      .get(userId) as { total_answers: number; correct_answers: number | null };

    const quizCountRow = db
      .prepare(`SELECT COUNT(*) as cnt FROM assessments WHERE user_id = ? AND status = 'evaluated'`)
      .get(userId) as { cnt: number };

    const completedQuestsCount = worldRepo.getCompletedQuestIds(userId).size;
    const masteryList = topicRepo.listMastery(userId);
    const strongTopics = masteryList.filter((m) => m.band === 'strong' || m.band === 'developing');
    const weakTopics = masteryList.filter((m) => m.band === 'weak' || m.band === 'needs_practice');

    const threads = misconceptionRepo.listThreads(userId);
    const resolvedMisconceptions = threads.filter((t) => t.status === 'resolved').length;
    const activeMisconceptions = threads.filter(
      (t) => t.status === 'confirmed' || t.status === 'suspected' || t.status === 'improving',
    ).length;

    const currentLevelThreshold = xpThresholdForLevel(stats.level);
    const nextLevelThreshold = xpThresholdForLevel(stats.level + 1);

    return {
      stats: {
        ...stats,
        current_level_xp: currentLevelThreshold,
        next_level_xp: nextLevelThreshold,
        xp_to_next_level: Math.max(0, nextLevelThreshold - stats.total_xp),
      },
      daily_goal: {
        target_minutes: prefs?.daily_goal_minutes || 20,
        completed_minutes: todayMinutes,
        percent: Math.min(
          100,
          Math.round((todayMinutes / Math.max(1, prefs?.daily_goal_minutes || 20)) * 100),
        ),
      },
      summary: {
        completed_quests: completedQuestsCount,
        completed_assessments: quizCountRow?.cnt || 0,
        total_answers: answerAgg?.total_answers || 0,
        overall_accuracy:
          answerAgg?.total_answers > 0
            ? Math.round(((answerAgg.correct_answers || 0) / answerAgg.total_answers) * 100)
            : 0,
        active_misconceptions: activeMisconceptions,
        resolved_misconceptions: resolvedMisconceptions,
        total_study_minutes: Math.round(
          sessions.reduce((s, x) => s + x.active_seconds, 0) / 60,
        ),
      },
      topic_mastery: masteryList,
      strong_topics: strongTopics,
      weak_topics: weakTopics,
      weekly_activity: weeklyActivity,
      xp_transactions: progressRepo.listXpTransactions(userId, 30),
    };
  },
};
