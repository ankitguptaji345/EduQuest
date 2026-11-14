import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
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

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function AssessmentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  // Launcher state
  const [selectedDocId, setSelectedDocId] = useState('');
  const [kind, setKind] = useState<'diagnostic' | 'practice'>('diagnostic');
  const [questionCount, setQuestionCount] = useState(5);

  // Active quiz state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealedHints, setRevealedHints] = useState<string[]>([]);
  const [questionStartTs, setQuestionStartTs] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [feedbackByQ, setFeedbackByQ] = useState<
    Record<
      string,
      {
        is_correct: boolean;
        feedback: string;
        correct_answer: string;
        explanation: string;
        thread?: MisconceptionThread | null;
      }
    >
  >({});

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

  // Reset active state cleanly when opening a new quiz id
  useEffect(() => {
    setCurrentIdx(0);
    setDraftAnswers({});
    setHintsUsed(0);
    setRevealedHints([]);
    setFeedbackByQ({});
    setElapsedSec(0);
    setQuestionStartTs(null);
  }, [id]);

  // Start timer ONLY when an active (non-evaluated) quiz has loaded
  const isQuizActive = Boolean(id && detail && detail.assessment.status !== 'evaluated');
  useEffect(() => {
    if (!isQuizActive) return;
    const started = Date.now();
    setQuestionStartTs(started);
    setElapsedSec(0);
    const t = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [isQuizActive, id, currentIdx]);

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
          answer: draftAnswers[qId] || '',
          hints_used: hintsUsed,
          time_taken_ms: questionStartTs ? Math.max(500, Date.now() - questionStartTs) : 0,
        }),
      }),
    onSuccess: (res, qId) => {
      setFeedbackByQ((prev) => ({
        ...prev,
        [qId]: {
          is_correct: res.student_answer.is_correct,
          feedback: res.student_answer.feedback,
          correct_answer: res.correct_answer,
          explanation: res.explanation,
          thread: res.diagnosis?.thread || null,
        },
      }));
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
            Questions are generated directly from meaningful educational concepts in your processed study
            documents with server-side answer verification and automatic misconception diagnosis.
          </p>
        </div>

        <div className="eq-card rounded-2xl p-6 space-y-6">
          <h2 className="font-display text-lg font-semibold">Configure Assessment</h2>
          {docs.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#11182B] border border-slate-400/15 text-center space-y-3">
              <p className="text-sm text-[#94A3B8]">
                Upload and process at least one study document before starting a quiz.
              </p>
              <Link
                to="/upload"
                className="inline-block px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
              >
                Upload Study Material
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Kind Selector Cards */}
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  {
                    value: 'diagnostic' as const,
                    title: 'Diagnostic Assessment',
                    desc: 'Broad sweep across extracted topics to detect weak spots and misconceptions.',
                  },
                  {
                    value: 'practice' as const,
                    title: 'Targeted Practice',
                    desc: 'Focused mastery check reinforcing key definitions, commands, and applications.',
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKind(opt.value)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      kind === opt.value
                        ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#F8FAFC]'
                        : 'bg-[#11182B] border-slate-400/15 text-[#94A3B8] hover:border-slate-400/35'
                    }`}
                  >
                    <p className="font-display text-sm font-semibold text-[#F8FAFC]">{opt.title}</p>
                    <p className="text-xs text-[#94A3B8] mt-1">{opt.desc}</p>
                  </button>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#94A3B8]">Source Material</label>
                  <select
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                    className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC]"
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
                  <label className="text-xs font-medium text-[#94A3B8]">Question Count</label>
                  <select
                    value={questionCount}
                    onChange={(e) => setQuestionCount(Number(e.target.value))}
                    className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC]"
                  >
                    <option value={3}>3 Questions</option>
                    <option value={5}>5 Questions</option>
                    <option value={8}>8 Questions</option>
                    <option value={10}>10 Questions</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
                >
                  {createMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Target className="w-4 h-4" />
                  )}
                  Generate & Start Quiz
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Past Assessments */}
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold">Assessment History</h2>
          {history.length === 0 ? (
            <div className="eq-card rounded-xl p-6 text-sm text-[#94A3B8]">
              No assessments taken yet. Launch your first diagnostic quiz above.
            </div>
          ) : (
            <div className="grid gap-3">
              {history.map((a) => {
                const pct =
                  a.score !== null && a.max_score ? Math.round((a.score / a.max_score) * 100) : null;
                return (
                  <div
                    key={a.id}
                    className="eq-card eq-card-hover rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <p className="font-display font-semibold text-sm capitalize text-[#F8FAFC]">
                        {a.kind.replace('_', ' ')} Assessment
                      </p>
                      <p className="text-xs text-[#94A3B8] tabular-nums">
                        Status: <span className="capitalize text-[#F8FAFC]">{a.status.replace('_', ' ')}</span>
                        {pct !== null ? ` · Score: ${pct}%` : ''} · {new Date(a.started_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Link
                      to={a.status === 'evaluated' ? `/assessments/${a.id}/results` : `/assessments/${a.id}`}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-semibold text-[#22D3EE] transition-colors shrink-0"
                    >
                      {a.status === 'evaluated' ? 'View Results' : 'Resume Quiz'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Quiz Runner View
  if (loadingQuiz || !detail) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-20 rounded-xl bg-[#151E33]" />
        <div className="h-80 rounded-2xl bg-[#151E33]" />
      </div>
    );
  }

  const { assessment, questions, answers, review } = detail;
  if (assessment.status === 'evaluated') {
    return (
      <div className="max-w-xl mx-auto eq-card rounded-2xl p-8 text-center space-y-4">
        <CheckCircle2 className="w-10 h-10 text-[#22C55E] mx-auto" />
        <h2 className="font-display text-xl font-bold">This assessment is already completed</h2>
        <Link
          to={`/assessments/${assessment.id}/results`}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#8B5CF6] text-white text-sm font-semibold"
        >
          View Results & Explanations
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const q = questions[currentIdx];
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));
  const reviewMap = new Map(review.map((r) => [r.question_id, r]));
  const existingAnswer = q ? answerMap.get(q.id) : undefined;
  const existingReview = q ? reviewMap.get(q.id) : undefined;
  const qFeedback = q ? feedbackByQ[q.id] : undefined;
  const currentDraft = q ? draftAnswers[q.id] || '' : '';

  const allAnswered = questions.length > 0 && answers.length >= questions.length;
  const progressPct = Math.round((answers.length / Math.max(1, questions.length)) * 100);

  const moveToQuestion = (idx: number) => {
    if (idx < 0 || idx >= questions.length) return;
    setCurrentIdx(idx);
    setHintsUsed(0);
    setRevealedHints([]);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Progress & Timer Header */}
      <div className="eq-card rounded-2xl p-5 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[#22D3EE] capitalize">
              {assessment.kind.replace('_', ' ')} Assessment
            </p>
            <p className="text-sm font-semibold tabular-nums mt-0.5">
              Question {currentIdx + 1} of {questions.length} · {answers.length}/{questions.length} answered ({progressPct}%)
            </p>
          </div>
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#11182B] border border-slate-400/15 text-xs font-mono text-[#F8FAFC] tabular-nums"
            title="Time spent on current question"
          >
            <Clock className="w-3.5 h-3.5 text-[#22D3EE]" />
            {String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:{String(elapsedSec % 60).padStart(2, '0')}
          </div>
        </div>

        {/* Interactive Question Navigator Bar */}
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, questions.length)}, minmax(0, 1fr))` }}
        >
          {questions.map((item, idx) => {
            const ans = answerMap.get(item.id);
            const isCurr = idx === currentIdx;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => moveToQuestion(idx)}
                title={`Question ${idx + 1}`}
                className={`h-2 rounded-full transition-all ${
                  isCurr
                    ? 'bg-[#22D3EE] ring-2 ring-[#22D3EE]/30'
                    : ans
                      ? ans.is_correct
                        ? 'bg-[#22C55E]'
                        : 'bg-[#EF4444]'
                      : 'bg-[#0B1020] border border-slate-400/20'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Question Card */}
      {q && (
        <div className="eq-card rounded-2xl p-6 lg:p-7 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#94A3B8]">
            <div className="flex flex-wrap items-center gap-2">
              {q.topic_name && (
                <span className="px-2.5 py-0.5 rounded-md bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 text-[#C4B5FD] font-medium">
                  {q.topic_name}
                </span>
              )}
              <span className="capitalize font-medium">
                {q.type === 'mcq' ? 'Multiple Choice' : q.type.replace('_', ' ')} ·{' '}
                <strong className="text-[#F8FAFC]">{q.difficulty}</strong>
              </span>
            </div>
            {q.source_refs.length > 0 && (
              <span className="text-[#22D3EE]">{q.source_refs.map((r) => r.label).join(', ')}</span>
            )}
          </div>

          <h2 className="font-display text-lg lg:text-xl font-semibold leading-snug text-[#F8FAFC]">
            {q.prompt}
          </h2>

          {/* Answer Selection (Radio A/B/C/D style) */}
          {q.options && q.options.length > 0 ? (
            <div className="space-y-2.5" role="radiogroup" aria-label="Answer options">
              {q.options.map((opt, oIdx) => {
                const selectedValue = existingAnswer?.answer.value || currentDraft;
                const selected = selectedValue === opt;
                const correctAns = qFeedback?.correct_answer || existingReview?.correct_answer;
                const isRevealedCorrect = Boolean(existingAnswer && correctAns === opt);
                const isRevealedWrong = Boolean(existingAnswer && selected && !existingAnswer.is_correct);

                return (
                  <button
                    key={`${q.id}-${oIdx}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={Boolean(existingAnswer) || submitAnswerMut.isPending}
                    onClick={() =>
                      setDraftAnswers((prev) => ({
                        ...prev,
                        [q.id]: opt,
                      }))
                    }
                    className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all flex items-start gap-3 ${
                      isRevealedCorrect
                        ? 'bg-[#22C55E]/15 border-[#22C55E] text-[#F8FAFC]'
                        : isRevealedWrong
                          ? 'bg-[#EF4444]/15 border-[#EF4444] text-[#F8FAFC]'
                          : selected
                            ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#F8FAFC] shadow-sm'
                            : 'bg-[#11182B] border-slate-400/20 text-[#94A3B8] hover:text-[#F8FAFC] hover:border-slate-400/40'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 mt-0.5 rounded-full border flex items-center justify-center shrink-0 ${
                        selected
                          ? 'border-[#8B5CF6] bg-[#8B5CF6]/20'
                          : 'border-slate-400/40 bg-[#0B1020]'
                      }`}
                    >
                      {selected && <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />}
                    </span>
                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                        selected
                          ? 'bg-[#8B5CF6] text-white'
                          : 'bg-[#151E33] text-[#94A3B8] border border-slate-400/20'
                      }`}
                    >
                      {OPTION_LETTERS[oIdx] || oIdx + 1}
                    </span>
                    <span className="leading-relaxed pt-0.5">{opt}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              rows={3}
              disabled={Boolean(existingAnswer) || submitAnswerMut.isPending}
              value={existingAnswer?.answer.value || currentDraft}
              onChange={(e) =>
                setDraftAnswers((prev) => ({
                  ...prev,
                  [q.id]: e.target.value,
                }))
              }
              placeholder="Write your grounded answer..."
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-4 py-3 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
          )}

          {/* Progressive Hints */}
          {revealedHints.length > 0 && !existingAnswer && (
            <div className="space-y-2">
              {revealedHints.map((h, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B] flex items-start gap-2"
                >
                  <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Hint {i + 1}:</strong> {h}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Feedback & Explanation Panel */}
          {(qFeedback || existingAnswer) && (
            <div
              className={`p-4 rounded-xl border space-y-2.5 ${
                (qFeedback?.is_correct ?? existingAnswer?.is_correct)
                  ? 'bg-[#22C55E]/10 border-[#22C55E]/35'
                  : 'bg-[#EF4444]/10 border-[#EF4444]/35'
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                {(qFeedback?.is_correct ?? existingAnswer?.is_correct) ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-[#22C55E]">Correct Answer</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-[#EF4444]" />
                    <span className="text-[#EF4444]">Incorrect Answer</span>
                  </>
                )}
              </div>
              <p className="text-xs text-[#F8FAFC]/90 leading-relaxed">
                {qFeedback?.feedback || existingAnswer?.feedback}
              </p>
              {(qFeedback || existingReview) && (
                <div className="p-3 rounded-lg bg-[#0B1020]/60 border border-slate-400/15 text-xs space-y-1">
                  <p className="text-[#94A3B8]">
                    Expected:{' '}
                    <strong className="text-[#22C55E]">
                      {qFeedback?.correct_answer || existingReview?.correct_answer}
                    </strong>
                  </p>
                  <p className="text-[#94A3B8] leading-relaxed">
                    {qFeedback?.explanation || existingReview?.explanation}
                  </p>
                </div>
              )}
              {qFeedback?.thread && (
                <div className="pt-2 border-t border-slate-400/20 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <span className="text-[#F59E0B] inline-flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Misconception flagged ({qFeedback.thread.status}): {qFeedback.thread.label}
                  </span>
                  <Link to="/misconceptions" className="text-[#22D3EE] font-semibold hover:underline shrink-0">
                    Open Corrective Lesson
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Action Bar with Previous / Submit / Next / Complete */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-400/15">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => moveToQuestion(currentIdx - 1)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] disabled:opacity-40 border border-slate-400/20 text-xs font-medium text-[#F8FAFC] transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Previous
              </button>

              {!existingAnswer && hintsUsed < q.hints_count && (
                <button
                  type="button"
                  onClick={() => hintMut.mutate(q.id)}
                  disabled={hintMut.isPending}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#F59E0B] transition-colors"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Hint ({q.hints_count - hintsUsed})
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {!existingAnswer && (
                <button
                  type="button"
                  disabled={!currentDraft.trim() || submitAnswerMut.isPending}
                  onClick={() => submitAnswerMut.mutate(q.id)}
                  className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                >
                  {submitAnswerMut.isPending ? 'Checking...' : 'Check Answer'}
                </button>
              )}

              {currentIdx < questions.length - 1 && (
                <button
                  type="button"
                  onClick={() => moveToQuestion(currentIdx + 1)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${
                    existingAnswer
                      ? 'bg-[#22D3EE] hover:bg-[#06B6D4] text-[#0B1020]'
                      : 'bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-[#F8FAFC]'
                  }`}
                >
                  Next
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}

              {allAnswered && (
                <button
                  type="button"
                  onClick={() => completeMut.mutate()}
                  disabled={completeMut.isPending}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#0B1020] text-xs font-bold transition-colors"
                >
                  {completeMut.isPending ? 'Finalizing...' : 'Finish & View Results'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
