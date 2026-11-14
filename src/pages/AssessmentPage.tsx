import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  Loader2,
  Target,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type {
  Assessment,
  MisconceptionThread,
  QuestionPublic,
  StudyDocument,
} from '../types/api';

interface AssessmentDetailResponse {
  assessment: Assessment;
  questions: QuestionPublic[];
  answers: Array<{
    question_id: string;
    answer: { value: string };
    is_correct: boolean;
    score: number;
    feedback: string;
  }>;
  review: Array<{
    question_id: string;
    correct_answer: string;
    explanation: string;
  }>;
}

export function AssessmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  // Launcher state when /assessments (no id)
  const [selectedDocId, setSelectedDocId] = useState('');
  const [kind, setKind] = useState<'diagnostic' | 'practice'>('diagnostic');
  const [questionCount, setQuestionCount] = useState(5);

  // Active quiz state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealedHints, setRevealedHints] = useState<string[]>([]);
  const [questionStartTs, setQuestionStartTs] = useState(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  const [latestFeedback, setLatestFeedback] = useState<{
    is_correct: boolean;
    feedback: string;
    correct_answer: string;
    explanation: string;
    thread?: MisconceptionThread | null;
  } | null>(null);

  const { data: docsData } = useQuery({
    queryKey: ['documents-ready'],
    queryFn: () => apiFetch<{ items: StudyDocument[] }>('/api/documents?status=ready'),
    enabled: !id,
  });

  const { data: historyData } = useQuery({
    queryKey: ['assessments-list'],
    queryFn: () => apiFetch<{ items: Assessment[] }>('/api/assessments'),
    enabled: !id,
  });

  const { data: detail, isLoading: loadingQuiz } = useQuery({
    queryKey: ['assessment-detail', id],
    queryFn: () => apiFetch<AssessmentDetailResponse>(`/api/assessments/${id}`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - questionStartTs) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [id, questionStartTs]);

  const createMut = useMutation({
    mutationFn: () =>
      apiFetch<{ assessment: Assessment }>('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          document_id: selectedDocId || undefined,
          question_count: questionCount,
        }),
      }),
    onSuccess: (res) => {
      navigate(`/assessments/${res.assessment.id}`);
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to generate quiz.');
    },
  });

  const hintMut = useMutation({
    mutationFn: (qId: string) =>
      apiFetch<{ hint: string }>(`/api/assessments/${id}/questions/${qId}/hint`, {
        method: 'POST',
        body: JSON.stringify({ hint_index: hintsUsed }),
      }),
    onSuccess: (res) => {
      setHintsUsed((n) => n + 1);
      setRevealedHints((prev) => [...prev, res.hint]);
    },
  });

  const submitAnswerMut = useMutation({
    mutationFn: (qId: string) =>
      apiFetch<{
        student_answer: { is_correct: boolean; feedback: string };
        correct_answer: string;
        explanation: string;
        diagnosis: { thread: MisconceptionThread } | null;
      }>(`/api/assessments/${id}/answers`, {
        method: 'POST',
        idempotent: true,
        body: JSON.stringify({
          question_id: qId,
          answer: draftAnswer,
          hints_used: hintsUsed,
          time_taken_ms: Date.now() - questionStartTs,
        }),
      }),
    onSuccess: (res) => {
      setLatestFeedback({
        is_correct: res.student_answer.is_correct,
        feedback: res.student_answer.feedback,
        correct_answer: res.correct_answer,
        explanation: res.explanation,
        thread: res.diagnosis?.thread || null,
      });
      void queryClient.invalidateQueries({ queryKey: ['assessment-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Could not submit answer.');
    },
  });

  const completeMut = useMutation({
    mutationFn: () =>
      apiFetch<{ xp_award: { amount: number } }>(`/api/assessments/${id}/complete`, {
        method: 'POST',
        idempotent: true,
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['progress-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      addToast('success', `Assessment completed! +${res.xp_award.amount} XP`);
      navigate(`/assessments/${id}/results`);
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to complete assessment.');
    },
  });

  // Launcher View
  if (!id) {
    const docs = docsData?.items || [];
    const history = historyData?.items || [];

    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-display text-2xl font-bold">Diagnostic & Practice Quizzes</h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Questions are generated strictly from your processed study documents with zero exposed
            answer keys and automatic misconception diagnosis.
          </p>
        </div>

        <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-6 space-y-5">
          <h2 className="font-display text-lg font-semibold">Launch New Quiz</h2>
          {docs.length === 0 ? (
            <div className="text-sm text-[#94A3B8] space-y-3">
              <p>Upload and process at least one study document before starting a quiz.</p>
              <Link
                to="/upload"
                className="inline-block px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
              >
                Upload Study Material
              </Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#94A3B8]">Source Material</label>
                <select
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full bg-[#11182B] border border-slate-400/20 rounded-lg px-3 py-2.5 text-sm text-[#F8FAFC]"
                >
                  <option value="">All Processed Materials</option>
                  {docs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#94A3B8]">Assessment Type</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'diagnostic' | 'practice')}
                  className="w-full bg-[#11182B] border border-slate-400/20 rounded-lg px-3 py-2.5 text-sm text-[#F8FAFC]"
                >
                  <option value="diagnostic">Diagnostic Assessment</option>
                  <option value="practice">Targeted Practice</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#94A3B8]">Questions</label>
                <select
                  value={questionCount}
                  onChange={(e) => setQuestionCount(Number(e.target.value))}
                  className="w-full bg-[#11182B] border border-slate-400/20 rounded-lg px-3 py-2.5 text-sm text-[#F8FAFC]"
                >
                  <option value={3}>3 Questions</option>
                  <option value={5}>5 Questions</option>
                  <option value={8}>8 Questions</option>
                </select>
              </div>
            </div>
          )}

          {docs.length > 0 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold"
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                Generate & Start Quiz
              </button>
            </div>
          )}
        </div>

        {/* Past Assessments */}
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Assessment History</h2>
          {history.length === 0 ? (
            <p className="text-sm text-[#94A3B8]">No assessments taken yet.</p>
          ) : (
            <div className="grid gap-3">
              {history.map((a) => (
                <div
                  key={a.id}
                  className="bg-[#151E33] border border-slate-400/15 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <div>
                    <p className="font-medium text-sm capitalize text-[#F8FAFC]">
                      {a.kind.replace('_', ' ')} Quiz
                    </p>
                    <p className="text-xs text-[#94A3B8] tabular-nums">
                      Status: {a.status}
                      {a.score !== null && a.max_score
                        ? ` · Score: ${Math.round((a.score / a.max_score) * 100)}%`
                        : ''}
                    </p>
                  </div>
                  <Link
                    to={a.status === 'evaluated' ? `/assessments/${a.id}/results` : `/assessments/${a.id}`}
                    className="px-3.5 py-1.5 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs font-medium text-[#22D3EE]"
                  >
                    {a.status === 'evaluated' ? 'View Results' : 'Resume'}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Quiz Runner View
  if (loadingQuiz || !detail) {
    return <div className="h-64 rounded-2xl bg-[#151E33] animate-pulse" />;
  }

  const { assessment, questions, answers } = detail;
  if (assessment.status === 'evaluated') {
    return (
      <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-8 text-center space-y-4">
        <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto" />
        <h2 className="font-display text-xl font-bold">This assessment is already completed</h2>
        <Link
          to={`/assessments/${assessment.id}/results`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] text-white text-sm font-semibold"
        >
          View Results & Explanations
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const q = questions[currentIdx];
  const existingAnswer = q ? answers.find((a) => a.question_id === q.id) : undefined;
  const allAnswered = questions.length > 0 && answers.length >= questions.length;

  const moveToQuestion = (idx: number) => {
    setCurrentIdx(idx);
    setDraftAnswer('');
    setHintsUsed(0);
    setRevealedHints([]);
    setLatestFeedback(null);
    setQuestionStartTs(Date.now());
    setElapsedSec(0);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Progress Header */}
      <div className="flex items-center justify-between bg-[#151E33] border border-slate-400/15 rounded-xl px-5 py-3.5">
        <div className="space-y-0.5">
          <p className="text-xs text-[#22D3EE] capitalize">{assessment.kind.replace('_', ' ')} Assessment</p>
          <p className="text-sm font-semibold tabular-nums">
            Question {currentIdx + 1} of {questions.length} · {answers.length} answered
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] tabular-nums">
          <Clock className="w-4 h-4" />
          {elapsedSec}s
        </div>
      </div>

      {/* Question Card */}
      {q && (
        <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
            <span className="capitalize">
              {q.type.replace('_', ' ')} · {q.difficulty}
            </span>
            {q.source_refs.length > 0 && (
              <span className="text-[#22D3EE]">{q.source_refs.map((r) => r.label).join(', ')}</span>
            )}
          </div>

          <h2 className="font-display text-lg font-semibold leading-snug">{q.prompt}</h2>

          {/* Answer Input */}
          {q.options && q.options.length > 0 ? (
            <div className="space-y-2.5">
              {q.options.map((opt) => {
                const selected = (existingAnswer?.answer.value || draftAnswer) === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={Boolean(existingAnswer) || submitAnswerMut.isPending}
                    onClick={() => setDraftAnswer(opt)}
                    className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors ${
                      selected
                        ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#F8FAFC]'
                        : 'bg-[#11182B] border-slate-400/20 text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              rows={3}
              disabled={Boolean(existingAnswer) || submitAnswerMut.isPending}
              value={existingAnswer?.answer.value || draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              placeholder="Write your grounded answer..."
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-4 py-3 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
          )}

          {/* Hints */}
          {revealedHints.length > 0 && (
            <div className="space-y-1.5">
              {revealedHints.map((h, i) => (
                <div key={i} className="p-3 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B]">
                  Hint {i + 1}: {h}
                </div>
              ))}
            </div>
          )}

          {/* Immediate Feedback & Misconception Alert */}
          {(latestFeedback || existingAnswer) && (
            <div
              className={`p-4 rounded-xl border space-y-2 ${
                (latestFeedback?.is_correct ?? existingAnswer?.is_correct)
                  ? 'bg-[#22C55E]/10 border-[#22C55E]/30'
                  : 'bg-[#EF4444]/10 border-[#EF4444]/30'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                {(latestFeedback?.is_correct ?? existingAnswer?.is_correct) ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-[#22C55E]">Correct</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-[#EF4444]" />
                    <span className="text-[#EF4444]">Incorrect</span>
                  </>
                )}
              </div>
              <p className="text-xs text-[#F8FAFC]/90">
                {latestFeedback?.feedback || existingAnswer?.feedback}
              </p>
              {latestFeedback && (
                <p className="text-xs text-[#94A3B8]">
                  Expected answer: <strong className="text-[#F8FAFC]">{latestFeedback.correct_answer}</strong> ·{' '}
                  {latestFeedback.explanation}
                </p>
              )}
              {latestFeedback?.thread && (
                <div className="pt-2 border-t border-slate-400/20 flex items-center justify-between gap-3 text-xs">
                  <span className="text-[#F59E0B] inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Misconception flagged ({latestFeedback.thread.status}): {latestFeedback.thread.label}
                  </span>
                  <Link to="/misconceptions" className="text-[#22D3EE] hover:underline shrink-0">
                    Open Corrective Lesson
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-400/15">
            <div className="flex items-center gap-2">
              {!existingAnswer && hintsUsed < q.hints_count && (
                <button
                  type="button"
                  onClick={() => hintMut.mutate(q.id)}
                  disabled={hintMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs text-[#F59E0B]"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Hint ({q.hints_count - hintsUsed} left)
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {!existingAnswer ? (
                <button
                  type="button"
                  disabled={!draftAnswer.trim() || submitAnswerMut.isPending}
                  onClick={() => submitAnswerMut.mutate(q.id)}
                  className="px-5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold"
                >
                  {submitAnswerMut.isPending ? 'Checking...' : 'Submit Answer'}
                </button>
              ) : currentIdx < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => moveToQuestion(currentIdx + 1)}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#22D3EE] text-[#0B1020] text-xs font-bold"
                >
                  Next Question
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : null}

              {allAnswered && (
                <button
                  type="button"
                  onClick={() => completeMut.mutate()}
                  disabled={completeMut.isPending}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#22C55E] text-[#0B1020] text-xs font-bold"
                >
                  {completeMut.isPending ? 'Finalizing...' : 'Finish & Claim XP'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
