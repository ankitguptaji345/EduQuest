import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, CheckCircle2, Clock, Sparkles, Zap } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-[#151E33]" />
          ))}
        </div>
        <div className="h-72 rounded-2xl bg-[#151E33]" />
      </div>
    );
  }

  const masteryData = overview.topic_mastery.map((m) => ({
    name: m.topic_name_snapshot.slice(0, 18),
    score: Math.round(m.score),
  }));

  // Aggregate real XP earned by source type from xp_transactions
  const xpBySourceMap = new Map<string, number>();
  for (const tx of overview.xp_transactions) {
    const label = tx.source_type.replace(/_/g, ' ');
    xpBySourceMap.set(label, (xpBySourceMap.get(label) || 0) + tx.amount);
  }
  const xpSourceData = Array.from(xpBySourceMap.entries()).map(([source, xp]) => ({
    source: source.charAt(0).toUpperCase() + source.slice(1),
    xp,
  }));

  const achievements = achData?.items || [];
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const achPct = achievements.length > 0 ? Math.round((unlockedCount / achievements.length) * 100) : 0;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-2xl font-bold">Learning Analytics & Progress Ledger</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Every chart and score below is strictly computed from your real quizzes, session
          heartbeats, misconception resolutions, and immutable XP ledger.
        </p>
      </div>

      {/* Derived KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="eq-card eq-card-hover rounded-xl p-5 space-y-1.5">
          <p className="text-xs text-[#94A3B8]">Overall Quiz Accuracy</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[#22C55E]">
            {overview.summary.overall_accuracy}%
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview.summary.total_answers} graded answer(s)
          </p>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 space-y-1.5">
          <p className="text-xs text-[#94A3B8]">Completed Activities</p>
          <p className="font-display text-2xl font-bold tabular-nums">
            {overview.summary.completed_assessments + overview.summary.completed_quests}
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview.summary.completed_assessments} quizzes · {overview.summary.completed_quests} quests
          </p>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 space-y-1.5">
          <p className="text-xs text-[#94A3B8]">Misconception Repair</p>
          <p className="font-display text-2xl font-bold tabular-nums text-[#22D3EE]">
            {overview.summary.resolved_misconceptions} resolved
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview.summary.active_misconceptions} active remaining
          </p>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 space-y-1.5">
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

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="eq-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#8B5CF6]" />
              Weekly Study Activity (Minutes)
            </h2>
            <span className="text-xs text-[#94A3B8] tabular-nums">Past 7 days</span>
          </div>
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.weekly_activity} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="label" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} unit="m" />
                <Tooltip
                  cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                  contentStyle={{
                    backgroundColor: '#1B2740',
                    borderColor: 'rgba(148,163,184,0.2)',
                    borderRadius: '10px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="minutes" name="Minutes" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="eq-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#22D3EE]" />
              Topic Mastery Scores
            </h2>
            <span className="text-xs text-[#94A3B8] tabular-nums">{masteryData.length} topic(s)</span>
          </div>
          {masteryData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-[#94A3B8] text-center px-6">
              Complete a quiz or quest to generate explainable topic mastery scores.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={masteryData} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} stroke="#94A3B8" fontSize={12} unit="%" />
                  <YAxis type="category" dataKey="name" width={120} stroke="#94A3B8" fontSize={11} />
                  <Tooltip
                    cursor={{ fill: 'rgba(34,211,238,0.08)' }}
                    contentStyle={{
                      backgroundColor: '#1B2740',
                      borderColor: 'rgba(148,163,184,0.2)',
                      borderRadius: '10px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="score" name="Mastery %" fill="#22D3EE" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* XP Earned by Source Chart + Explainable Mastery */}
      {xpSourceData.length > 0 && (
        <div className="eq-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#22C55E]" />
              XP Progression by Activity Source
            </h2>
            <span className="text-xs font-mono text-[#22D3EE] tabular-nums">
              Total: {overview.stats.total_xp} XP
            </span>
          </div>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={xpSourceData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="source" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(34,197,94,0.08)' }}
                  contentStyle={{
                    backgroundColor: '#1B2740',
                    borderColor: 'rgba(148,163,184,0.2)',
                    borderRadius: '10px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="xp" name="XP Earned" fill="#22C55E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Explainable Mastery Breakdown */}
      {overview.topic_mastery.length > 0 && (
        <div className="eq-card rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold">Explainable Mastery Breakdown</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {overview.topic_mastery.map((m) => {
              const pct = Math.round(m.score);
              const barColor =
                pct >= 80 ? 'bg-[#22C55E]' : pct >= 55 ? 'bg-[#22D3EE]' : 'bg-[#EF4444]';
              return (
                <div
                  key={m.id}
                  className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{m.topic_name_snapshot}</span>
                    <span className="text-xs font-mono font-bold text-[#22D3EE] tabular-nums shrink-0">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
                    <div className={`h-full ${barColor}`} style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                  <p className="text-xs text-[#94A3B8] capitalize tabular-nums">
                    Band: {m.band.replace('_', ' ')} · Evidence: {m.evidence_count} · Confidence:{' '}
                    {Math.round(m.confidence * 100)}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Achievements & XP Ledger */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 eq-card rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-semibold flex items-center gap-2">
              <Award className="w-4 h-4 text-[#F59E0B]" />
              Achievements ({unlockedCount}/{achievements.length})
            </h2>
            <span className="text-xs font-mono text-[#F59E0B] tabular-nums">{achPct}% unlocked</span>
          </div>
          <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
            <div className="h-full bg-[#F59E0B] transition-all duration-500" style={{ width: `${achPct}%` }} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            {achievements.map((a) => (
              <div
                key={a.code}
                className={`p-3.5 rounded-xl border space-y-1 transition-colors ${
                  a.unlocked
                    ? 'bg-[#11182B] border-[#22C55E]/35'
                    : 'bg-[#0B1020]/50 border-slate-400/10 opacity-70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#F8FAFC]">{a.name}</span>
                  {a.unlocked ? (
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
                  ) : (
                    <span className="text-[11px] font-mono text-[#94A3B8] tabular-nums">
                      +{a.xp_bonus} XP
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#94A3B8]">{a.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 eq-card rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-base font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#22D3EE]" />
            Immutable XP Ledger
          </h2>
          {overview.xp_transactions.length === 0 ? (
            <p className="text-sm text-[#94A3B8]">No XP earned yet. Complete a quiz or quest!</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {overview.xp_transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-xl bg-[#11182B] border border-slate-400/15 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="text-[#F8FAFC] font-medium truncate">{tx.reason}</p>
                    <p className="text-[11px] text-[#94A3B8] capitalize mt-0.5">
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
