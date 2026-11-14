import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Trophy,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { QuestionPublic, Quest } from '../types/api';

interface QuestStateResponse {
  quest: Quest;
  attempt: { id: string; assessment_id: string | null; status: string } | null;
  questions: QuestionPublic[];
  answers: Array<{ question_id: string; is_correct: boolean; feedback: string }>;
}

export function QuestPlayPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [started, setStarted] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [completionResult, setCompletionResult] = useState<{
    passed: boolean;
    accuracy_percent: number;
    required_percent: number;
    xp_award: { amount: number } | null;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['quest-detail', id],
    queryFn: () => apiFetch<QuestStateResponse>(`/api/quests/${id}`),
    enabled: Boolean(id),
  });

  const startMut = useMutation({
    mutationFn: () =>
      apiFetch<QuestStateResponse>(`/api/quests/${id}/start`, {
        method: 'POST',
        idempotent: true,
      }),
    onSuccess: () => {
      setStarted(true);
      void queryClient.invalidateQueries({ queryKey: ['quest-detail', id] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to start quest.');
    },
  });

  useEffect(() => {
    if (data && !data.attempt && !started && !startMut.isPending && !completionResult) {
      startMut.mutate();
    }
  }, [data, started, startMut, completionResult]);

  const answerMut = useMutation({
    mutationFn: (params: { assessmentId: string; questionId: string; answer: string }) =>
      apiFetch(`/api/assessments/${params.assessmentId}/answers`, {
        method: 'POST',
        idempotent: true,
        body: JSON.stringify({ question_id: params.questionId, answer: params.answer }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['quest-detail', id] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Could not save answer.');
    },
  });

  const pauseMut = useMutation({
    mutationFn: () => apiFetch(`/api/quests/${id}/pause`, { method: 'POST' }),
    onSuccess: () => {
      addToast('info', 'Quest paused.');
      navigate('/worlds');
    },
  });

  const abandonMut = useMutation({
    mutationFn: () => apiFetch(`/api/quests/${id}/abandon`, { method: 'POST' }),
    onSuccess: () => {
      addToast('info', 'Quest abandoned.');
      navigate('/worlds');
    },
  });

  const completeMut = useMutation({
    mutationFn: () =>
      apiFetch<{
        passed: boolean;
        accuracy_percent: number;
        required_percent: number;
        xp_award: { amount: number } | null;
      }>(`/api/quests/${id}/complete`, { method: 'POST', idempotent: true }),
    onSuccess: (res) => {
      setCompletionResult(res);
      void queryClient.invalidateQueries({ queryKey: ['worlds'] });
      void queryClient.invalidateQueries({ queryKey: ['progress-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      if (res.passed) {
        addToast('success', `Quest completed! +${res.xp_award?.amount || 0} XP`);
      } else {
        addToast('error', `Scored ${res.accuracy_percent}%. Retry to reach ${res.required_percent}%.`);
      }
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Complete all check questions first.');
    },
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#94A3B8] py-12 justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-[#22D3EE]" />
        Loading quest lesson...
      </div>
    );
  }

  const { quest, attempt, questions, answers } = data;
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/worlds" className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F8FAFC]">
            <ArrowLeft className="w-3.5 h-3.5" />
            Learning Worlds
          </Link>
          <h1 className="font-display text-2xl font-bold mt-1">{quest.title}</h1>
          <p className="text-xs text-[#22D3EE] tabular-nums">
            {quest.kind.toUpperCase()} · Reward: +{quest.xp_reward} XP · Rule-Based Engine
          </p>
        </div>

        {attempt && !completionResult && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pauseMut.mutate()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#151E33] border border-slate-400/20 text-xs text-[#94A3B8] hover:text-[#F8FAFC]"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              Pause
            </button>
            <button
              type="button"
              onClick={() => abandonMut.mutate()}
              className="px-3 py-1.5 rounded-lg bg-[#151E33] border border-slate-400/20 text-xs text-[#EF4444]"
            >
              Abandon
            </button>
          </div>
        )}
      </div>

      {/* Lesson Content */}
      <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-6 space-y-3">
        <p className="text-xs font-semibold text-[#22D3EE]">Grounded Quest Lesson</p>
        <div className="text-sm text-[#F8FAFC]/90 whitespace-pre-wrap leading-relaxed">
          {quest.lesson_markdown || quest.intro}
        </div>
        {quest.source_refs.length > 0 && (
          <p className="text-xs text-[#94A3B8] pt-2 border-t border-slate-400/15">
            Sources: {quest.source_refs.map((r) => r.label).join(', ')}
          </p>
        )}
      </div>

      {/* Completion Result */}
      {completionResult ? (
        <div
          className={`rounded-2xl border p-6 space-y-4 text-center ${
            completionResult.passed
              ? 'bg-[#22C55E]/10 border-[#22C55E]/35'
              : 'bg-[#EF4444]/10 border-[#EF4444]/35'
          }`}
        >
          {completionResult.passed ? (
            <Trophy className="w-10 h-10 text-[#22C55E] mx-auto" />
          ) : (
            <XCircle className="w-10 h-10 text-[#EF4444] mx-auto" />
          )}
          <h2 className="font-display text-xl font-bold">
            {completionResult.passed ? 'Quest Cleared!' : 'Quest Needs Retry'}
          </h2>
          <p className="text-sm text-[#F8FAFC]/90 tabular-nums">
            Accuracy: {completionResult.accuracy_percent}% (Required: {completionResult.required_percent}%)
            {completionResult.xp_award ? ` · Earned +${completionResult.xp_award.amount} XP` : ''}
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/worlds"
              className="px-5 py-2.5 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
            >
              Return to World Map
            </Link>
          </div>
        </div>
      ) : (
        /* Quest Check Questions */
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold">
            Quest Check ({answers.length}/{questions.length} answered)
          </h2>
          {questions.map((q, idx) => {
            const existing = answerMap.get(q.id);
            const draft = selectedAnswers[q.id] || '';
            return (
              <div
                key={q.id}
                className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-3"
              >
                <p className="text-sm font-semibold">
                  {idx + 1}. {q.prompt}
                </p>

                {q.options && q.options.length > 0 ? (
                  <div className="space-y-2">
                    {q.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        disabled={Boolean(existing)}
                        onClick={() => setSelectedAnswers((p) => ({ ...p, [q.id]: opt }))}
                        className={`w-full text-left px-3.5 py-2.5 rounded-lg border text-xs transition-colors ${
                          draft === opt
                            ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#F8FAFC]'
                            : 'bg-[#11182B] border-slate-400/20 text-[#94A3B8]'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    disabled={Boolean(existing)}
                    value={draft}
                    onChange={(e) => setSelectedAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                    placeholder="Type your answer..."
                    className="w-full bg-[#11182B] border border-slate-400/20 rounded-lg px-3.5 py-2 text-sm text-[#F8FAFC]"
                  />
                )}

                {existing ? (
                  <div
                    className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                      existing.is_correct
                        ? 'bg-[#22C55E]/10 text-[#22C55E]'
                        : 'bg-[#EF4444]/10 text-[#EF4444]'
                    }`}
                  >
                    {existing.is_correct ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 shrink-0" />
                    )}
                    <span>{existing.feedback}</span>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={!draft.trim() || !attempt?.assessment_id || answerMut.isPending}
                      onClick={() =>
                        answerMut.mutate({
                          assessmentId: attempt!.assessment_id!,
                          questionId: q.id,
                          answer: draft,
                        })
                      }
                      className="px-4 py-1.5 rounded-lg bg-[#22D3EE] text-[#0B1020] text-xs font-bold"
                    >
                      Check Answer
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {questions.length > 0 && answers.length >= questions.length && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => completeMut.mutate()}
                disabled={completeMut.isPending}
                className="px-6 py-2.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#0B1020] text-sm font-bold"
              >
                {completeMut.isPending ? 'Evaluating...' : 'Complete Quest & Claim XP'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
