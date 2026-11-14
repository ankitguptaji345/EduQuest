import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Compass,
  Flame,
  MessageSquare,
  Target,
  Upload,
  Zap,
} from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiFetch } from '../lib/api';
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
        <div className="h-24 rounded-xl bg-[#151E33]" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-[#151E33]" />
          ))}
        </div>
      </div>
    );
  }

  const stats = overview?.stats;

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold">
            Welcome back, {user?.full_name || 'Scholar'}
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            {docs.length === 0
              ? 'Upload your first study material to unlock topics, tutoring, and adaptive quests.'
              : `Tracking ${docs.length} study material${docs.length === 1 ? '' : 's'} · ${overview?.summary.active_misconceptions || 0} active misconceptions`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Material
          </Link>
          <Link
            to="/tutor"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/15 text-[#F8FAFC] text-xs font-medium transition-colors whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#22D3EE]" />
            Ask AI Tutor
          </Link>
          <Link
            to="/assessments"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/15 text-[#F8FAFC] text-xs font-medium transition-colors whitespace-nowrap"
          >
            <Target className="w-3.5 h-3.5 text-[#22C55E]" />
            Diagnostic Quiz
          </Link>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8] flex items-center justify-between">
            <span>Level & Total XP</span>
            <Zap className="w-4 h-4 text-[#22D3EE]" />
          </p>
          <p className="font-display text-2xl font-bold tabular-nums">
            Lv.{stats?.level || 1} <span className="text-base font-medium text-[#22D3EE]">· {stats?.total_xp || 0} XP</span>
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {stats?.xp_to_next_level ?? 283} XP to next level
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8] flex items-center justify-between">
            <span>Current Streak</span>
            <Flame className="w-4 h-4 text-[#F59E0B]" />
          </p>
          <p className="font-display text-2xl font-bold tabular-nums">
            {stats?.current_streak || 0} days
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            Best: {stats?.longest_streak || 0} days
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8] flex items-center justify-between">
            <span>Daily Study Goal</span>
            <BookOpen className="w-4 h-4 text-[#8B5CF6]" />
          </p>
          <p className="font-display text-2xl font-bold tabular-nums">
            {overview?.daily_goal.completed_minutes || 0} / {overview?.daily_goal.target_minutes || 20}m
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview?.daily_goal.percent || 0}% of daily target
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-1">
          <p className="text-xs text-[#94A3B8] flex items-center justify-between">
            <span>Quiz Accuracy</span>
            <Target className="w-4 h-4 text-[#22C55E]" />
          </p>
          <p className="font-display text-2xl font-bold tabular-nums">
            {overview?.summary.overall_accuracy || 0}%
          </p>
          <p className="text-xs text-[#94A3B8] tabular-nums">
            {overview?.summary.completed_quests || 0} quests completed
          </p>
        </div>
      </div>

      {/* Empty State for Zero Documents */}
      {docs.length === 0 ? (
        <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-10 text-center space-y-4">
          <Upload className="w-10 h-10 text-[#22D3EE] mx-auto" />
          <div className="max-w-lg mx-auto space-y-2">
            <h2 className="font-display text-xl font-bold">Your study workspace is ready</h2>
            <p className="text-sm text-[#94A3B8]">
              We never populate fake worlds or fabricated stats. Upload a PDF, DOCX, PPTX, or TXT file to
              extract your real topics, unlock the grounded tutor, and build your first Learning World.
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
          >
            Upload Your First Study Material
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-6">
          {/* Left 7 cols: Recommended Next Activity + Weekly Chart */}
          <div className="lg:col-span-7 space-y-6">
            {topRec && (
              <div className="bg-[#151E33] border border-[#8B5CF6]/35 rounded-xl p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-[#22D3EE]">
                      Recommended Next Activity · Priority {topRec.priority}
                    </p>
                    <h2 className="font-display text-lg font-bold">{topRec.title}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRecAction(topRec)}
                    className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    Start Activity
                  </button>
                </div>
                <p className="text-sm text-[#94A3B8]">{topRec.reason}</p>
                <div className="text-xs text-[#94A3B8] flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-slate-400/15">
                  {Object.entries(topRec.evidence).map(([k, v]) => (
                    <span key={k}>
                      {k.replace(/_/g, ' ')}: <strong className="text-[#F8FAFC]">{String(v)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Weekly Activity Chart */}
            <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-semibold">Weekly Study Activity</h2>
                  <p className="text-xs text-[#94A3B8]">Active session minutes over the past 7 days</p>
                </div>
                <Link to="/analytics" className="text-xs text-[#22D3EE] hover:underline">
                  Full Analytics
                </Link>
              </div>
              <div className="h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overview?.weekly_activity || []}>
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
          </div>

          {/* Right 5 cols: Strong/Weak Topics, Active Worlds, Recent Materials */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Topic Mastery Snapshot</h2>
                <Link to="/misconceptions" className="text-xs text-[#F59E0B] hover:underline inline-flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {overview?.summary.active_misconceptions || 0} active issues
                </Link>
              </div>

              {(overview?.weak_topics.length || 0) === 0 && (overview?.strong_topics.length || 0) === 0 ? (
                <p className="text-sm text-[#94A3B8]">
                  Take a Diagnostic Quiz to measure your topic mastery and surface weak areas.
                </p>
              ) : (
                <div className="space-y-3">
                  {overview?.weak_topics.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <span className="truncate pr-3 text-[#F8FAFC]">{t.topic_name_snapshot}</span>
                      <span className="text-xs font-mono text-[#EF4444] tabular-nums shrink-0">
                        {Math.round(t.score)}% · Needs Focus
                      </span>
                    </div>
                  ))}
                  {overview?.strong_topics.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <span className="truncate pr-3 text-[#F8FAFC]">{t.topic_name_snapshot}</span>
                      <span className="text-xs font-mono text-[#22C55E] tabular-nums shrink-0">
                        {Math.round(t.score)}% · {t.band}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Active Learning Worlds</h2>
                <Link to="/worlds" className="text-xs text-[#22D3EE] hover:underline">
                  View All
                </Link>
              </div>
              <div className="space-y-3">
                {worlds.slice(0, 3).map((w) => (
                  <Link
                    key={w.id}
                    to="/worlds"
                    className="block p-3.5 rounded-lg bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/15 transition-colors"
                  >
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span className="truncate flex items-center gap-2">
                        <Compass className="w-4 h-4 text-[#8B5CF6] shrink-0" />
                        {w.title}
                      </span>
                      <span className="text-xs tabular-nums text-[#22D3EE]">
                        {w.completed_count}/{w.total_quests}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className="bg-[#151E33] border border-slate-400/15 rounded-xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">Uploaded Study Materials</h2>
                <Link to="/documents" className="text-xs text-[#22D3EE] hover:underline">
                  Library
                </Link>
              </div>
              {docs.slice(0, 3).map((d) => (
                <Link
                  key={d.id}
                  to={`/documents/${d.id}`}
                  className="flex items-center justify-between text-sm py-1.5 hover:text-[#22D3EE] transition-colors"
                >
                  <span className="truncate pr-3">{d.title}</span>
                  <span className="text-xs text-[#94A3B8] uppercase shrink-0">
                    {d.file_ext} · {d.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
