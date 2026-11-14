import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Compass,
  Lock,
  Play,
  Skull,
  Sparkles,
  Upload,
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Learning Worlds & Quest Map</h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Each world is built directly from your uploaded materials with server-verified quest
            unlocks and 3-round Boss Battles.
          </p>
        </div>
      </div>

      {docsWithoutWorld.length > 0 && (
        <div className="bg-[#151E33] border border-[#8B5CF6]/35 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#22D3EE] inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              New Study Material Ready
            </p>
            <p className="text-sm text-[#F8FAFC]">
              Generate a grounded Learning World for{' '}
              <strong>{docsWithoutWorld[0].title}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => generateMut.mutate(docsWithoutWorld[0].id)}
            disabled={generateMut.isPending}
            className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold shrink-0"
          >
            {generateMut.isPending ? 'Building World...' : 'Generate World'}
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-48 rounded-2xl bg-[#151E33]" />
        </div>
      ) : worlds.length === 0 ? (
        <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-10 text-center space-y-4">
          <Compass className="w-10 h-10 text-[#22D3EE] mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-bold">No Learning Worlds yet</h2>
            <p className="text-sm text-[#94A3B8] max-w-md mx-auto">
              Upload a study document first. Once topics are extracted, EduQuest AI builds an
              adaptive quest path and Boss Arena automatically.
            </p>
          </div>
          <Link
            to="/upload"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Study Material
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {worlds.map((world) => (
            <div
              key={world.id}
              className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-6 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-[#22D3EE] capitalize">
                    {world.theme_key.replace(/_/g, ' ')} · Rule-Based Engine
                  </p>
                  <h2 className="font-display text-xl font-bold">{world.title}</h2>
                  <p className="text-sm text-[#94A3B8]">{world.description}</p>
                </div>
                <div className="text-left sm:text-right shrink-0">
                  <p className="font-display text-2xl font-bold text-[#22D3EE] tabular-nums">
                    {world.progress_percent}%
                  </p>
                  <p className="text-xs text-[#94A3B8] tabular-nums">
                    {world.completed_count} / {world.total_quests} quests completed
                  </p>
                </div>
              </div>

              {/* Quest Progression Nodes */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {world.quests.map((q) => {
                  const isBoss = q.kind === 'boss';
                  const unlocked = q.is_unlocked;
                  const completed = q.is_completed;
                  const targetUrl = isBoss
                    ? `/worlds/${world.id}/boss/${q.id}`
                    : `/quests/${q.id}`;

                  return (
                    <div
                      key={q.id}
                      className={`p-4 rounded-xl border flex flex-col justify-between gap-4 ${
                        isBoss
                          ? 'bg-[#11182B] border-[#F59E0B]/40'
                          : completed
                            ? 'bg-[#11182B] border-[#22C55E]/35'
                            : unlocked
                              ? 'bg-[#11182B] border-[#8B5CF6]/35'
                              : 'bg-[#0B1020]/60 border-slate-400/10 opacity-70'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold uppercase text-[#94A3B8] tabular-nums">
                            Quest {q.position} · {q.kind}
                          </span>
                          {completed ? (
                            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                          ) : !unlocked ? (
                            <Lock className="w-4 h-4 text-[#94A3B8]" />
                          ) : isBoss ? (
                            <Skull className="w-4 h-4 text-[#F59E0B]" />
                          ) : (
                            <Play className="w-4 h-4 text-[#22D3EE]" />
                          )}
                        </div>
                        <h3 className="font-display text-sm font-bold text-[#F8FAFC]">{q.title}</h3>
                        <p className="text-xs text-[#94A3B8] line-clamp-2">{q.objective}</p>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-400/15">
                        <span className="text-xs font-mono text-[#22D3EE] tabular-nums">
                          +{q.xp_reward} XP
                        </span>
                        {unlocked ? (
                          <Link
                            to={targetUrl}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                              isBoss
                                ? 'bg-[#F59E0B] text-[#0B1020]'
                                : completed
                                  ? 'bg-[#151E33] text-[#22C55E] border border-[#22C55E]/30'
                                  : 'bg-[#8B5CF6] text-white'
                            }`}
                          >
                            {completed ? 'Replay' : isBoss ? 'Enter Boss Arena' : 'Play Quest'}
                          </Link>
                        ) : (
                          <span className="text-xs text-[#94A3B8]">Locked</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
