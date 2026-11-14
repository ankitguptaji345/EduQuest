import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, CheckCircle2, Clock, Zap } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../lib/api';
import type { TopicMastery, UserStats } from '../types/api';

interface AnalyticsOverviewResponse {
  stats: UserStats;
  daily_goal: { target_minutes: number; completed_minutes: number; percent: number };
  summary: {
    completed_quests: number;
    completed_assessments: number;
    total_answers: number;
    overall_accuracy: number;
    active_misconceptions: number;
    resolved_misconceptions: number;
    total_study_minutes: number;
  };
  topic_mastery: TopicMastery[];
  weekly_activity: Array<{ date: string; label: string; minutes: number }>;
  xp_transactions: Array<{
    id: string;
    amount: number;
    source_type: string;
    reason: string;
    created_at: string;
  }>;
}

interface AchievementItem {
  code: string;
  name: string;
  description: string;
  xp_bonus: number;
  unlocked: boolean;
  unlocked_at: string | null;
}

export function AnalyticsPage() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch<AnalyticsOverviewResponse>('/api/analytics/overview'),
  });

  const { data: achData } = useQuery({
    queryKey: ['achievements'],
    queryFn: () => apiFetch<{ items: AchievementItem[] }>('/api/progress/achievements'),
  });

  if (isLoading || !overview) {
    return <div className="h-72 rounded-2xl bg-[#151E33] animate-pulse" />;
  }

  const masteryData = overview.topic_mastery.map((m) => ({
    name: m.topic_name_snapshot.slice(0, 18),
    score: Math.round(m.score),
  }));

  const achievements = achData?.items || [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Learning Analytics & Ledger</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Every metric below is strictly derived from your real quizzes, session heartbeats,
          misconception resolutions, and XP ledger.
        </p>
      </div>

      {/* Derived KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8]">Overall Accuracy</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[#22C55E]">
            {overview.summary.overall_accuracy}%
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            Across {overview.summary.total_answers} graded answer(s)
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8]">Completed Activities</p>
          <p className="font-display text-2xl font-bold tabular-nums">
            {overview.summary.completed_assessments + overview.summary.completed_quests}
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview.summary.completed_assessments} quizzes · {overview.summary.completed_quests} quests
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8]">Misconceptions Resolved</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[#22D3EE]">
            {overview.summary.resolved_misconceptions}
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview.summary.active_misconceptions} currently active
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8]">7-Day Active Study Time</p>
          <p className="font-display text-2xl font-bold tabular-nums inline-flex items-center gap-1.5">
            <Clock className="w-5 h-5 text-[#8B5CF6]" />
            {overview.summary.total_study_minutes}m
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            Today: {overview.daily_goal.completed_minutes} / {overview.daily_goal.target_minutes}m
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#8B5CF6]" />
            Weekly Study Activity (Minutes)
          </h2>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.weekly_activity}>
                <XAxis dataKey="label" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} unit="m" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1B2740',
                    borderColor: 'rgba(148,163,184,0.2)',
                    borderRadius: '8px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="minutes" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold">Topic Mastery Scores</h2>
          {masteryData.length === 0 ? (
            <p className="text-sm text-[#94A3B8] py-16 text-center">
              Complete a quiz or quest to generate explainable topic mastery scores.
            </p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={masteryData} layout="vertical">
                  <XAxis type="number" domain={[0, 100]} stroke="#94A3B8" fontSize={12} />
                  <YAxis type="category" dataKey="name" width={120} stroke="#94A3B8" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1B2740',
                      borderColor: 'rgba(148,163,184,0.2)',
                      borderRadius: '8px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="score" fill="#22D3EE" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Topic Mastery Breakdown */}
      {overview.topic_mastery.length > 0 && (
        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold">Explainable Mastery Breakdown</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {overview.topic_mastery.map((m) => (
              <div
                key={m.id}
                className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">{m.topic_name_snapshot}</span>
                  <span className="text-xs font-mono text-[#22D3EE] tabular-nums">
                    {Math.round(m.score)}%
                  </span>
                </div>
                <p className="text-xs text-[#94A3B8] capitalize tabular-nums">
                  Band: {m.band.replace('_', ' ')} · Evidence: {m.evidence_count} · Confidence:{' '}
                  {Math.round(m.confidence * 100)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievements & XP Ledger */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <Award className="w-4 h-4 text-[#F59E0B]" />
            Achievements ({achievements.filter((a) => a.unlocked).length}/{achievements.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {achievements.map((a) => (
              <div
                key={a.code}
                className={`p-3.5 rounded-xl border space-y-1 ${
                  a.unlocked
                    ? 'bg-[#11182B] border-[#22C55E]/35'
                    : 'bg-[#0B1020]/50 border-slate-400/10 opacity-65'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#F8FAFC]">{a.name}</span>
                  {a.unlocked ? (
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                  ) : (
                    <span className="text-[11px] text-[#94A3B8] tabular-nums">+{a.xp_bonus} XP</span>
                  )}
                </div>
                <p className="text-xs text-[#94A3B8]">{a.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#22D3EE]" />
            Immutable XP Ledger
          </h2>
          {overview.xp_transactions.length === 0 ? (
            <p className="text-sm text-[#94A3B8]">No XP earned yet. Complete a quiz or quest!</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {overview.xp_transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-lg bg-[#11182B] border border-slate-400/15 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="text-[#F8FAFC] font-medium truncate">{tx.reason}</p>
                    <p className="text-[11px] text-[#94A3B8] capitalize">
                      {tx.source_type} · {new Date(tx.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="font-mono font-bold text-[#22C55E] tabular-nums shrink-0">
                    +{tx.amount} XP
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
