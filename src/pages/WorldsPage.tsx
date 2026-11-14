import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  CheckCircle2,
  Compass,
  Lock,
  Play,
  Skull,
  Sparkles,
  Upload,
  Zap,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { LearningWorld, StudyDocument } from '../types/api';

export function WorldsPage() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const { data: worldsData, isLoading } = useQuery({
    queryKey: ['worlds'],
    queryFn: () => apiFetch<{ items: LearningWorld[] }>('/api/worlds'),
  });

  const { data: docsData } = useQuery({
    queryKey: ['documents-ready'],
    queryFn: () => apiFetch<{ items: StudyDocument[] }>('/api/documents?status=ready'),
  });

  const generateMut = useMutation({
    mutationFn: (documentId: string) =>
      apiFetch('/api/worlds/generate', {
        method: 'POST',
        body: JSON.stringify({ document_id: documentId }),
      }),
    onSuccess: () => {
      addToast('success', 'Learning World generated from your study topics!');
      void queryClient.invalidateQueries({ queryKey: ['worlds'] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to generate world.');
    },
  });

  const worlds = worldsData?.items || [];
  const readyDocs = docsData?.items || [];
  const worldDocIds = new Set(worlds.map((w) => w.document_id));
  const docsWithoutWorld = readyDocs.filter((d) => !worldDocIds.has(d.id));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Learning Worlds & Quest Map</h1>
        <p className="text-sm text-[#94A3B8] mt-1">
          Adaptive worlds generated directly from your uploaded materials, featuring sequential mastery
          unlocks and 3-round Boss Challenges.
        </p>
      </div>

      {docsWithoutWorld.length > 0 && (
        <div className="eq-hero-surface rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#22D3EE] inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              New Study Material Ready
            </p>
            <p className="text-sm text-[#F8FAFC]">
              Generate a grounded Learning World for <strong>{docsWithoutWorld[0].title}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => generateMut.mutate(docsWithoutWorld[0].id)}
            disabled={generateMut.isPending}
            className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold shrink-0 transition-colors"
          >
            {generateMut.isPending ? 'Building World...' : 'Generate World'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-64 rounded-2xl bg-[#151E33]" />
        </div>
      ) : worlds.length === 0 ? (
        <div className="eq-card rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#22D3EE]/10 border border-[#22D3EE]/25 flex items-center justify-center mx-auto">
            <Compass className="w-6 h-6 text-[#22D3EE]" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-xl font-bold">No Learning Worlds yet</h2>
            <p className="text-sm text-[#94A3B8] max-w-md mx-auto">
              Upload a study document first. Once topics are extracted, EduQuest AI builds an adaptive
              quest path and Boss Arena automatically.
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Study Material
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {worlds.map((world) => {
            const totalXpAvailable = world.quests.reduce((s, q) => s + q.xp_reward, 0);
            return (
              <section key={world.id} className="eq-card rounded-2xl p-6 space-y-6">
                {/* World Banner */}
                <div className="eq-hero-surface rounded-xl p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <p className="text-xs font-medium text-[#22D3EE] capitalize">
                        {world.theme_key.replace(/_/g, ' ')} · {totalXpAvailable} Total XP Available
                      </p>
                      <h2 className="font-display text-xl font-bold text-[#F8FAFC] truncate">
                        {world.title}
                      </h2>
                      <p className="text-sm text-[#94A3B8] leading-relaxed">{world.description}</p>
                    </div>
                    <div className="text-left sm:text-right shrink-0">
                      <p className="font-display text-3xl font-bold text-[#22D3EE] tabular-nums">
                        {world.progress_percent}%
                      </p>
                      <p className="text-xs text-[#94A3B8] tabular-nums">
                        {world.completed_count} of {world.total_quests} quests cleared
                      </p>
                    </div>
                  </div>
                  <div className="h-2 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
                    <div
                      className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-500"
                      style={{ width: `${world.progress_percent}%` }}
                    />
                  </div>
                </div>

                {/* Quest Progression Nodes */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {world.quests.map((q) => {
                    const isBoss = q.kind === 'boss';
                    const unlocked = q.is_unlocked;
                    const completed = q.is_completed;
                    const targetUrl = isBoss ? `/worlds/${world.id}/boss/${q.id}` : `/quests/${q.id}`;
                    const masteryPct = Math.round((q.mastery_threshold || 0.75) * 100);

                    return (
                      <div
                        key={q.id}
                        className={`p-4 rounded-xl border flex flex-col justify-between gap-4 transition-all ${
                          isBoss
                            ? 'bg-gradient-to-br from-[#F59E0B]/10 via-[#11182B] to-[#11182B] border-[#F59E0B]/40'
                            : completed
                              ? 'bg-[#11182B] border-[#22C55E]/35'
                              : unlocked
                                ? 'bg-[#11182B] border-[#8B5CF6]/40 hover:border-[#22D3EE]/50'
                                : 'bg-[#0B1020]/70 border-slate-400/10 opacity-65'
                        }`}
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold uppercase text-[#94A3B8] tabular-nums">
                              Quest {q.position} · {isBoss ? 'Boss Challenge' : q.kind}
                            </span>
                            {completed ? (
                              <span className="inline-flex items-center gap-1 text-[#22C55E] font-medium">
                                <CheckCircle2 className="w-4 h-4" />
                                Cleared
                              </span>
                            ) : !unlocked ? (
                              <span className="inline-flex items-center gap-1 text-[#94A3B8]">
                                <Lock className="w-3.5 h-3.5" />
                                Locked
                              </span>
                            ) : isBoss ? (
                              <span className="inline-flex items-center gap-1 text-[#F59E0B] font-semibold">
                                <Skull className="w-4 h-4" />
                                3 Rounds
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#22D3EE] font-medium">
                                <Play className="w-3.5 h-3.5" />
                                Ready
                              </span>
                            )}
                          </div>

                          <h3 className="font-display text-base font-bold text-[#F8FAFC] leading-snug">
                            {q.title}
                          </h3>
                          <p className="text-xs text-[#94A3B8] line-clamp-2 leading-relaxed">
                            {q.objective}
                          </p>
                        </div>

                        <div className="space-y-3 pt-2 border-t border-slate-400/15">
                          <div className="flex items-center justify-between text-xs text-[#94A3B8] tabular-nums">
                            <span className="inline-flex items-center gap-1 font-mono font-semibold text-[#22D3EE]">
                              <Zap className="w-3.5 h-3.5" />+{q.xp_reward} XP
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Award className="w-3.5 h-3.5 text-[#8B5CF6]" />
                              Pass: {masteryPct}%
                            </span>
                          </div>

                          {unlocked ? (
                            <Link
                              to={targetUrl}
                              className={`block w-full text-center px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                                isBoss
                                  ? 'bg-[#F59E0B] hover:bg-[#D97706] text-[#0B1020] font-bold'
                                  : completed
                                    ? 'bg-[#151E33] hover:bg-[#1B2740] text-[#22C55E] border border-[#22C55E]/30'
                                    : 'bg-[#8B5CF6] hover:bg-[#7C3AED] text-white'
                              }`}
                            >
                              {completed ? 'Replay Quest' : isBoss ? 'Enter Boss Arena' : 'Start Quest'}
                            </Link>
                          ) : (
                            <div className="w-full text-center px-3 py-2 rounded-xl bg-[#151E33]/50 border border-slate-400/10 text-xs text-[#94A3B8]">
                              Complete previous quest to unlock
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
