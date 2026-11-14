import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { MisconceptionThread, QuestionPublic } from '../types/api';

const STATUS_TABS = [
  { id: '', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'suspected', label: 'Suspected' },
  { id: 'improving', label: 'Improving' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'dismissed', label: 'Dismissed' },
];

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

interface ThreadDetailResponse {
  thread: MisconceptionThread;
  records: Array<{
    id: string;
    cause_class: string;
    confidence: number;
    explanation: string;
    recommended_action: string;
    concept: string;
    created_at: string;
  }>;
  follow_up_assessment_id: string | null;
  follow_up_question: QuestionPublic | null;
}

export function MisconceptionsPage() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [statusFilter, setStatusFilter] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [followUpAnswer, setFollowUpAnswer] = useState('');
  const [verifyFeedback, setVerifyFeedback] = useState<{
    is_correct: boolean;
    feedback: string;
    correct_answer: string;
    explanation: string;
    xp?: number;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['misconceptions', statusFilter],
    queryFn: () =>
      apiFetch<{ items: MisconceptionThread[] }>(
        `/api/misconceptions${statusFilter ? `?status=${statusFilter}` : ''}`,
      ),
  });

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['misconception-detail', activeThreadId],
    queryFn: () => apiFetch<ThreadDetailResponse>(`/api/misconceptions/${activeThreadId}`),
    enabled: Boolean(activeThreadId),
  });

  const dismissMut = useMutation({
    mutationFn: (threadId: string) =>
      apiFetch(`/api/misconceptions/${threadId}/dismiss`, { method: 'POST' }),
    onSuccess: () => {
      addToast('info', 'Misconception thread dismissed.');
      void queryClient.invalidateQueries({ queryKey: ['misconceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
    },
  });

  const verifyMut = useMutation({
    mutationFn: (params: { threadId: string; questionId: string; answer: string }) =>
      apiFetch<{
        is_correct: boolean;
        feedback: string;
        correct_answer: string;
        explanation: string;
        thread: MisconceptionThread;
        xp_award: { amount: number } | null;
      }>(`/api/misconceptions/${params.threadId}/corrective-answer`, {
        method: 'POST',
        idempotent: true,
        body: JSON.stringify({ question_id: params.questionId, answer: params.answer }),
      }),
    onSuccess: (res) => {
      setVerifyFeedback({
        is_correct: res.is_correct,
        feedback: res.feedback,
        correct_answer: res.correct_answer,
        explanation: res.explanation,
        xp: res.xp_award?.amount,
      });
      void queryClient.invalidateQueries({ queryKey: ['misconceptions'] });
      void queryClient.invalidateQueries({ queryKey: ['misconception-detail', activeThreadId] });
      void queryClient.invalidateQueries({ queryKey: ['progress-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      if (res.is_correct) {
        addToast('success', `Misconception resolved! +${res.xp_award?.amount || 35} XP`);
      }
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Verification failed.');
    },
  });

  const threads = data?.items || [];

  const statusMeta = (status: MisconceptionThread['status']) => {
    if (status === 'resolved') {
      return {
        text: 'text-[#22C55E]',
        bg: 'bg-[#22C55E]/10 border-[#22C55E]/30',
        bar: 'bg-[#22C55E]',
      };
    }
    if (status === 'confirmed' || status === 'persistent') {
      return {
        text: 'text-[#EF4444]',
        bg: 'bg-[#EF4444]/10 border-[#EF4444]/30',
        bar: 'bg-[#EF4444]',
      };
    }
    if (status === 'suspected' || status === 'improving') {
      return {
        text: 'text-[#F59E0B]',
        bg: 'bg-[#F59E0B]/10 border-[#F59E0B]/30',
        bar: 'bg-[#F59E0B]',
      };
    }
    return {
      text: 'text-[#94A3B8]',
      bg: 'bg-[#11182B] border-slate-400/20',
      bar: 'bg-[#94A3B8]',
    };
  };

  return (
    <div className="space-y-6">
      <div className="eq-hero-surface rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#22D3EE]">Diagnostic Repair Loop</p>
          <h1 className="font-display text-2xl font-bold text-[#F8FAFC]">Misconceptions Center</h1>
          <p className="text-sm text-[#94A3B8] max-w-2xl leading-relaxed">
            Recurring conceptual errors transition from suspected (1st miss) to confirmed (2+ misses).
            Complete the corrective mini-lesson and verification check to resolve each thread and earn
            improvement XP.
          </p>
        </div>
        <div className="px-4 py-2.5 rounded-xl bg-[#0B1020]/70 border border-slate-400/15 text-right shrink-0">
          <p className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Active View</p>
          <p className="font-display text-xl font-bold text-[#F8FAFC] tabular-nums">
            {threads.length} {threads.length === 1 ? 'Thread' : 'Threads'}
          </p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Misconception status filters">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id || 'all'}
            type="button"
            role="tab"
            aria-selected={statusFilter === t.id}
            onClick={() => setStatusFilter(t.id)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all whitespace-nowrap shrink-0 ${
              statusFilter === t.id
                ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#F8FAFC]'
                : 'bg-[#151E33] border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC] hover:border-slate-400/35'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-28 rounded-2xl bg-[#151E33] border border-slate-400/10" />
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="eq-card rounded-2xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#22C55E]/10 border border-[#22C55E]/25 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6 text-[#22C55E]" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">
              No misconceptions in this view
            </h2>
            <p className="text-sm text-[#94A3B8] max-w-md mx-auto">
              Take a Diagnostic Quiz or Boss Battle to detect and repair any hidden conceptual gaps.
            </p>
          </div>
          <Link
            to="/assessments"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            Take Diagnostic Quiz
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {threads.map((t) => {
            const meta = statusMeta(t.status);
            const confidencePct = Math.round(t.confidence_agg * 100);
            return (
              <div
                key={t.id}
                className="eq-card eq-card-hover rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5"
              >
                <div className="space-y-2.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold uppercase tracking-wide ${meta.bg} ${meta.text}`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {t.status}
                    </span>
                    <h2 className="font-display text-base font-semibold text-[#F8FAFC] truncate">
                      {t.label}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#94A3B8] tabular-nums">
                    <span>
                      Topic: <strong className="text-[#F8FAFC] font-medium">{t.topic_name_snapshot}</strong>
                    </span>
                    <span>·</span>
                    <span>{t.occurrences} occurrence(s)</span>
                    <span>·</span>
                    <div className="inline-flex items-center gap-2">
                      <span>Confidence: {confidencePct}%</span>
                      <div className="w-20 h-1.5 rounded-full bg-[#0B1020] overflow-hidden border border-slate-400/15">
                        <div
                          className={`h-full rounded-full ${meta.bar}`}
                          style={{ width: `${Math.min(100, Math.max(8, confidencePct))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveThreadId(t.id);
                      setFollowUpAnswer('');
                      setVerifyFeedback(null);
                    }}
                    className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                  >
                    {t.status === 'resolved' ? 'Review Lesson' : 'Open Corrective Lesson'}
                  </button>
                  {t.status !== 'resolved' && t.status !== 'dismissed' && (
                    <button
                      type="button"
                      onClick={() => dismissMut.mutate(t.id)}
                      className="px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Corrective Mini-Lesson & Verification Modal */}
      {activeThreadId && (
        <div
          className="fixed inset-0 z-50 bg-[#0B1020]/80 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#151E33] border border-slate-400/20 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-400/15 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#22D3EE]">Corrective Learning Loop · Rule-Based Engine</p>
                <h2 className="font-display text-base font-bold text-[#F8FAFC] truncate">
                  {detail?.thread.label || 'Loading Corrective Lesson...'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveThreadId(null)}
                className="p-2 rounded-xl bg-[#11182B] border border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC] transition-colors shrink-0"
                aria-label="Close corrective lesson"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              {loadingDetail || !detail ? (
                <div className="flex items-center gap-2.5 text-xs text-[#94A3B8] py-6 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-[#22D3EE]" />
                  Loading misconception evidence...
                </div>
              ) : (
                <>
                  {detail.records[0] && (
                    <div className="p-4 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs space-y-1.5">
                      <p className="font-semibold text-[#F59E0B] uppercase tracking-wide">
                        Diagnosis ({detail.records[0].cause_class.replace(/_/g, ' ')})
                      </p>
                      <p className="text-[#F8FAFC]/90 leading-relaxed">{detail.records[0].explanation}</p>
                    </div>
                  )}

                  <div className="p-5 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-2.5">
                    <p className="text-xs font-semibold text-[#22D3EE] uppercase tracking-wide">
                      Corrective Mini-Lesson
                    </p>
                    <div className="text-sm text-[#F8FAFC]/90 whitespace-pre-wrap leading-relaxed">
                      {detail.thread.corrective_lesson}
                    </div>
                  </div>

                  {detail.follow_up_question && detail.thread.status !== 'resolved' && (
                    <div className="p-5 rounded-xl bg-[#11182B] border border-[#8B5CF6]/35 space-y-4">
                      <p className="text-xs font-semibold text-[#8B5CF6] uppercase tracking-wide">
                        Follow-Up Verification Question
                      </p>
                      <p className="text-sm font-medium text-[#F8FAFC] leading-snug">
                        {detail.follow_up_question.prompt}
                      </p>

                      {detail.follow_up_question.options &&
                      detail.follow_up_question.options.length > 0 ? (
                        <div className="space-y-2">
                          {detail.follow_up_question.options.map((opt, idx) => {
                            const selected = followUpAnswer === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setFollowUpAnswer(opt)}
                                className={`w-full text-left px-3.5 py-3 rounded-xl border text-xs transition-all flex items-start gap-3 ${
                                  selected
                                    ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#F8FAFC]'
                                    : 'bg-[#151E33] border-slate-400/20 text-[#94A3B8] hover:text-[#F8FAFC] hover:border-slate-400/40'
                                }`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-mono font-bold shrink-0 ${
                                    selected
                                      ? 'bg-[#8B5CF6] text-white'
                                      : 'bg-[#11182B] text-[#94A3B8] border border-slate-400/20'
                                  }`}
                                >
                                  {OPTION_LETTERS[idx] || idx + 1}
                                </span>
                                <span className="leading-relaxed pt-0.5">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <textarea
                          rows={2}
                          value={followUpAnswer}
                          onChange={(e) => setFollowUpAnswer(e.target.value)}
                          placeholder="Enter your verification answer..."
                          className="w-full bg-[#151E33] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
                        />
                      )}

                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!followUpAnswer.trim() || verifyMut.isPending}
                          onClick={() =>
                            verifyMut.mutate({
                              threadId: detail.thread.id,
                              questionId: detail.follow_up_question!.id,
                              answer: followUpAnswer,
                            })
                          }
                          className="px-5 py-2.5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-50 text-[#0B1020] text-xs font-bold transition-colors whitespace-nowrap"
                        >
                          {verifyMut.isPending ? 'Verifying...' : 'Verify & Resolve (+35 XP)'}
                        </button>
                      </div>
                    </div>
                  )}

                  {verifyFeedback && (
                    <div
                      className={`p-4 rounded-xl border space-y-2 text-xs ${
                        verifyFeedback.is_correct
                          ? 'bg-[#22C55E]/10 border-[#22C55E]/35 text-[#22C55E]'
                          : 'bg-[#EF4444]/10 border-[#EF4444]/35 text-[#EF4444]'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {verifyFeedback.is_correct ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 shrink-0" />
                        )}
                        <span>
                          {verifyFeedback.is_correct
                            ? `Resolved! +${verifyFeedback.xp || 35} XP earned`
                            : 'Needs another look — review the mini-lesson and try again.'}
                        </span>
                      </div>
                      <p className="text-[#F8FAFC]/90 leading-relaxed">{verifyFeedback.feedback}</p>
                      <p className="text-[#94A3B8] leading-relaxed">{verifyFeedback.explanation}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
