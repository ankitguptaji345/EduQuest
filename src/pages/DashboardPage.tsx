import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Compass,
  FileText,
  Flame,
  MessageSquare,
  Sparkles,
  Target,
  Upload,
  Zap,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch, xpRequiredForLevel } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import type {
  LearningWorld,
  Recommendation,
  StudyDocument,
  TopicMastery,
  UserStats,
} from '../types/api';

interface OverviewResponse {
  stats: UserStats;
  daily_goal: { target_minutes: number; completed_minutes: number; percent: number };
  summary: {
    completed_quests: number;
    completed_assessments: number;
    overall_accuracy: number;
    active_misconceptions: number;
    resolved_misconceptions: number;
  };
  strong_topics: TopicMastery[];
  weak_topics: TopicMastery[];
  weekly_activity: Array<{ date: string; label: string; minutes: number }>;
  xp_transactions: Array<{
    id: string;
    amount: number;
    source_type: string;
    reason: string;
    created_at: string;
  }>;
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => apiFetch<OverviewResponse>('/api/analytics/overview'),
  });

  const { data: docsData } = useQuery({
    queryKey: ['documents'],
    queryFn: () => apiFetch<{ items: StudyDocument[] }>('/api/documents'),
  });

  const { data: recsData } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => apiFetch<{ items: Recommendation[] }>('/api/recommendations'),
  });

  const { data: worldsData } = useQuery({
    queryKey: ['worlds'],
    queryFn: () => apiFetch<{ items: LearningWorld[] }>('/api/worlds'),
  });

  const docs = docsData?.items || [];
  const recs = recsData?.items || [];
  const worlds = worldsData?.items || [];
  const topRec = recs[0];

  const handleRecAction = (rec: Recommendation) => {
    if (rec.kind === 'upload_material') navigate('/upload');
    else if (rec.kind === 'resolve_misconception') navigate('/misconceptions');
    else if (rec.kind === 'take_quest' || rec.kind === 'take_boss') {
      if (rec.target_id && rec.kind === 'take_quest') navigate(`/quests/${rec.target_id}`);
      else navigate('/worlds');
    } else if (rec.kind === 'practice_topic') navigate('/assessments');
    else navigate('/documents');
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-32 rounded-2xl bg-[#151E33]" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-[#151E33]" />
          ))}
        </div>
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 rounded-xl bg-[#151E33]" />
          <div className="lg:col-span-5 h-72 rounded-xl bg-[#151E33]" />
        </div>
      </div>
    );
  }

  const stats = overview?.stats;
  const currentLvl = stats?.level || 1;
  const totalXp = stats?.total_xp || 0;
  const currThreshold = xpRequiredForLevel(currentLvl);
  const nextThreshold = xpRequiredForLevel(currentLvl + 1);
  const levelPct = Math.min(
    100,
    Math.max(0, Math.round(((totalXp - currThreshold) / Math.max(1, nextThreshold - currThreshold)) * 100)),
  );
  const dailyPct = overview?.daily_goal.percent || 0;

  return (
    <div className="space-y-7">
      {/* Welcome Banner */}
      <section className="eq-hero-surface rounded-2xl p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-medium text-[#22D3EE]">
            Student Workspace · {user?.course || 'Personalized Mastery Path'}
          </p>
          <h1 className="font-display text-2xl lg:text-3xl font-bold tracking-tight text-balance">
            Welcome back, {user?.full_name || 'Scholar'}
          </h1>
          <p className="text-sm text-[#94A3B8] leading-relaxed">
            {docs.length === 0
              ? 'Upload your first study material to extract structured topics, ask the grounded tutor, and build adaptive quests.'
              : `Tracking ${docs.length} study material${docs.length === 1 ? '' : 's'} · ${overview?.summary.active_misconceptions || 0} active misconceptions · ${overview?.summary.completed_assessments || 0} completed quizzes`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 shrink-0">
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Material
          </Link>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#11182B]/90 hover:bg-[#1B2740] border border-slate-400/20 text-[#F8FAFC] text-xs font-medium transition-colors whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#22D3EE]" />
            Ask AI Tutor
          </Link>
          <Link
            to="/assessments"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#11182B]/90 hover:bg-[#1B2740] border border-slate-400/20 text-[#F8FAFC] text-xs font-medium transition-colors whitespace-nowrap"
          >
            <Target className="w-3.5 h-3.5 text-[#22C55E]" />
            Diagnostic Quiz
          </Link>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="eq-card eq-card-hover rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>Level & XP Progress</span>
            <span className="w-7 h-7 rounded-lg bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-[#22D3EE]" />
            </span>
          </div>
          <div>
            <p className="font-display text-2xl font-bold tabular-nums">
              Lv.{currentLvl}{' '}
              <span className="text-base font-medium text-[#22D3EE]">· {totalXp} XP</span>
            </p>
            <div className="mt-2 h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-500"
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-[#94A3B8] tabular-nums">
              {stats?.xp_to_next_level ?? Math.max(0, nextThreshold - totalXp)} XP to Level {currentLvl + 1}
            </p>
          </div>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>Daily Learning Streak</span>
            <span className="w-7 h-7 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/25 flex items-center justify-center">
              <Flame className="w-3.5 h-3.5 text-[#F59E0B]" />
            </span>
          </div>
          <div>
            <p className="font-display text-2xl font-bold tabular-nums">
              {stats?.current_streak || 0} day{stats?.current_streak === 1 ? '' : 's'}
            </p>
            <p className="mt-2 text-xs text-[#94A3B8] tabular-nums">
              Personal best: {stats?.longest_streak || 0} day{stats?.longest_streak === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>Daily Study Goal</span>
            <span className="w-7 h-7 rounded-lg bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5 text-[#8B5CF6]" />
            </span>
          </div>
          <div>
            <p className="font-display text-2xl font-bold tabular-nums">
              {overview?.daily_goal.completed_minutes || 0}{' '}
              <span className="text-sm font-normal text-[#94A3B8]">
                / {overview?.daily_goal.target_minutes || 20} min
              </span>
            </p>
            <div className="mt-2 h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#8B5CF6] transition-all duration-500"
                style={{ width: `${dailyPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-[#94A3B8] tabular-nums">{dailyPct}% of daily target</p>
          </div>
        </div>

        <div className="eq-card eq-card-hover rounded-xl p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>Quiz Accuracy</span>
            <span className="w-7 h-7 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/25 flex items-center justify-center">
              <Target className="w-3.5 h-3.5 text-[#22C55E]" />
            </span>
          </div>
          <div>
            <p className="font-display text-2xl font-bold tabular-nums">
              {overview?.summary.overall_accuracy || 0}%
            </p>
            <p className="mt-2 text-xs text-[#94A3B8] tabular-nums">
              {overview?.summary.completed_quests || 0} quests · {overview?.summary.resolved_misconceptions || 0} resolved issues
            </p>
          </div>
        </div>
      </section>

      {/* Empty State when no study materials uploaded */}
      {docs.length === 0 ? (
        <div className="eq-card rounded-2xl p-10 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center mx-auto">
            <Upload className="w-6 h-6 text-[#22D3EE]" />
          </div>
          <div className="max-w-lg mx-auto space-y-2">
            <h2 className="font-display text-xl font-bold">Your study workspace is ready</h2>
            <p className="text-sm text-[#94A3B8] leading-relaxed">
              EduQuest AI never populates fake worlds or fabricated statistics. Upload a PDF, DOCX,
              PPTX, or TXT study file to extract your real topics, unlock the citation-grounded tutor,
              and generate your first Learning World.
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
          >
            Upload Your First Study Material
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Left 7 cols */}
          <div className="lg:col-span-7 space-y-6 min-w-0">
            {topRec && (
              <div className="eq-card rounded-xl p-6 space-y-4 border-[#8B5CF6]/35 bg-gradient-to-br from-[#8B5CF6]/10 via-[#151E33] to-[#151E33]">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs font-medium text-[#22D3EE] inline-flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Recommended Next Activity · Priority {topRec.priority}
                    </p>
                    <h2 className="font-display text-lg font-bold text-[#F8FAFC]">{topRec.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRecAction(topRec)}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                  >
                    Start Activity
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-[#94A3B8] leading-relaxed">{topRec.reason}</p>
                {Object.keys(topRec.evidence).length > 0 && (
                  <div className="text-xs text-[#94A3B8] flex flex-wrap gap-x-4 gap-y-1 pt-2 border-t border-slate-400/15">
                    {Object.entries(topRec.evidence).map(([k, v]) => (
                      <span key={k}>
                        {k.replace(/_/g, ' ')}: <strong className="text-[#F8FAFC] tabular-nums">{String(v)}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Weekly Study Activity Chart */}
            <div className="eq-card rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold">Recent Learning Activity</h2>
                  <p className="text-xs text-[#94A3B8]">Verified active minutes across the past 7 days</p>
                </div>
                <Link to="/analytics" className="text-xs font-medium text-[#22D3EE] hover:underline shrink-0">
                  Full Analytics
                </Link>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview?.weekly_activity || []} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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
                    <Bar dataKey="minutes" name="Active Minutes" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent XP Activity */}
            <div className="eq-card rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Recent XP Activity</h2>
                <Link to="/analytics" className="text-xs font-medium text-[#22D3EE] hover:underline">
                  View Ledger
                </Link>
              </div>
              {(overview?.xp_transactions || []).length === 0 ? (
                <p className="text-sm text-[#94A3B8]">
                  Complete a diagnostic quiz, quest, or misconception verification to log your first XP.
                </p>
              ) : (
                <div className="divide-y divide-slate-400/10">
                  {overview!.xp_transactions.slice(0, 4).map((tx) => (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="text-[#F8FAFC] font-medium truncate">{tx.reason}</p>
                        <p className="text-[#94A3B8] capitalize">
                          {tx.source_type} · {new Date(tx.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="font-mono font-semibold text-[#22C55E] tabular-nums shrink-0">
                        +{tx.amount} XP
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right 5 cols */}
          <div className="lg:col-span-5 space-y-6 min-w-0">
            {/* Weak & Strong Topics */}
            <div className="eq-card rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold">Weak & Strong Topics</h2>
                <Link
                  to="/misconceptions"
                  className="text-xs font-medium text-[#F59E0B] hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {overview?.summary.active_misconceptions || 0} active
                </Link>
              </div>

              {(overview?.weak_topics.length || 0) === 0 && (overview?.strong_topics.length || 0) === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-[#94A3B8]">
                    Take a Diagnostic Quiz to measure topic mastery and surface weak concepts.
                  </p>
                  <Link
                    to="/assessments"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#22D3EE] hover:underline"
                  >
                    Launch Diagnostic Quiz
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {overview?.weak_topics.slice(0, 3).map((t) => (
                    <div key={t.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="truncate font-medium text-[#F8FAFC]">{t.topic_name_snapshot}</span>
                        <span className="font-mono text-[#EF4444] tabular-nums shrink-0">
                          {Math.round(t.score)}% · Needs Practice
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#EF4444]"
                          style={{ width: `${Math.max(4, Math.round(t.score))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {overview?.strong_topics.slice(0, 3).map((t) => (
                    <div key={t.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs gap-2">
                        <span className="truncate font-medium text-[#F8FAFC]">{t.topic_name_snapshot}</span>
                        <span className="font-mono text-[#22C55E] tabular-nums shrink-0">
                          {Math.round(t.score)}% · {t.band}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#22C55E]"
                          style={{ width: `${Math.max(4, Math.round(t.score))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recommended Quests / Active Worlds */}
            <div className="eq-card rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Recommended Quests & Worlds</h2>
                <Link to="/worlds" className="text-xs font-medium text-[#22D3EE] hover:underline">
                  View All
                </Link>
              </div>
              {worlds.length === 0 ? (
                <p className="text-sm text-[#94A3B8]">
                  Worlds are automatically generated once a study document finishes processing.
                </p>
              ) : (
                <div className="space-y-3">
                  {worlds.slice(0, 3).map((w) => (
                    <Link
                      key={w.id}
                      to="/worlds"
                      className="block p-3.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/15 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between text-sm font-medium gap-2">
                        <span className="truncate flex items-center gap-2">
                          <Compass className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                          {w.title}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-[#22D3EE] shrink-0">
                          {w.completed_count}/{w.total_quests}
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE]"
                          style={{ width: `${w.progress_percent}%` }}
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Study Materials */}
            <div className="eq-card rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Recent Study Materials</h2>
                <Link to="/documents" className="text-xs font-medium text-[#22D3EE] hover:underline">
                  Library
                </Link>
              </div>
              <div className="divide-y divide-slate-400/10">
                {docs.slice(0, 4).map((d) => (
                  <Link
                    key={d.id}
                    to={`/documents/${d.id}`}
                    className="flex items-center justify-between text-sm py-2.5 hover:text-[#22D3EE] transition-colors gap-3"
                  >
                    <span className="truncate flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
                      <span className="truncate">{d.title}</span>
                    </span>
                    <span
                      className={`text-xs uppercase font-medium shrink-0 ${
                        d.status === 'ready'
                          ? 'text-[#22C55E]'
                          : d.status === 'failed'
                            ? 'text-[#EF4444]'
                            : 'text-[#F59E0B]'
                      }`}
                    >
                      {d.file_ext} · {d.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
