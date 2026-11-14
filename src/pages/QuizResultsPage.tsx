import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  Target,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type {
  Assessment,
  AssessmentAnalyticsSummary,
  QuestionPublic,
} from '../types/api';

interface ResultsResponse {
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
  analytics_summary?: AssessmentAnalyticsSummary | null;
}

export function QuizResultsPage() {
  const { id } = useParams<{ id: string }>();
  const [filterMode, setFilterMode] = useState<'all' | 'incorrect'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['assessment-results', id],
    queryFn: () => apiFetch<ResultsResponse>(`/api/assessments/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading || !data) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
        <div className="h-36 rounded-2xl bg-[#151E33]" />
        <div className="h-44 rounded-xl bg-[#151E33]" />
      </div>
    );
  }

  const { assessment, questions, answers, review, analytics_summary } = data;
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));
  const reviewMap = new Map(review.map((r) => [r.question_id, r]));

  const maxScore = Math.max(1, assessment.max_score || questions.length);
  const rawScore = assessment.score ?? answers.reduce((s, a) => s + a.score, 0);
  const pct = Math.round((rawScore / maxScore) * 100);
  const correctCount = answers.filter((a) => a.is_correct).length;
  const wrongCount = answers.length - correctCount;

  const visibleQuestions =
    filterMode === 'incorrect'
      ? questions.filter((q) => !answerMap.get(q.id)?.is_correct)
      : questions;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Score Summary Card */}
      <div className="eq-hero-surface rounded-2xl p-6 lg:p-7 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#22D3EE] uppercase">
              {analytics_summary?.document_title
                ? `${analytics_summary.document_title} · Assessment Report`
                : 'Assessment Report'}
            </p>
            <h1 className="font-display text-3xl lg:text-4xl font-bold tabular-nums">
              {pct}% Accuracy ({correctCount}/{questions.length})
            </h1>
            <p className="text-sm text-[#94A3B8] tabular-nums">
              {correctCount} correct · {wrongCount} incorrect
              {analytics_summary?.weak_topics.length
                ? ` · ${analytics_summary.weak_topics.length} weak topic${analytics_summary.weak_topics.length === 1 ? '' : 's'} detected`
                : ''}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 shrink-0">
            {wrongCount > 0 && (
              <Link
                to="/misconceptions"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/40 text-xs font-semibold text-[#F59E0B] transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Review Misconceptions
              </Link>
            )}
            <Link
              to="/assessments"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
            >
              <Target className="w-3.5 h-3.5" />
              New Quiz
            </Link>
            <Link
              to="/worlds"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#11182B] hover:bg-[#1B2740] border border-slate-400/20 text-xs font-medium text-[#F8FAFC] transition-colors"
            >
              <Compass className="w-3.5 h-3.5 text-[#22D3EE]" />
              Learning Worlds
            </Link>
          </div>
        </div>

        <div className="h-2.5 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
          <div
            className={`h-full transition-all duration-500 ${
              pct >= 75 ? 'bg-[#22C55E]' : pct >= 50 ? 'bg-[#22D3EE]' : 'bg-[#F59E0B]'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Per-Topic Breakdown & Adaptive Study Recommendations */}
      {analytics_summary && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="eq-card rounded-2xl p-5 space-y-3.5">
            <h2 className="font-display text-sm font-semibold text-[#F8FAFC] uppercase tracking-wide">
              Topic Performance Breakdown
            </h2>
            <div className="space-y-2.5">
              {analytics_summary.per_topic.map((tp, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#F8FAFC] truncate">{tp.topic_name}</span>
                    <span
                      className={`font-mono font-semibold shrink-0 ${
                        tp.accuracy >= 70
                          ? 'text-[#22C55E]'
                          : tp.accuracy >= 50
                            ? 'text-[#F59E0B]'
                            : 'text-[#EF4444]'
                      }`}
                    >
                      {tp.correct}/{tp.total} ({tp.accuracy}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[#0B1020] overflow-hidden">
                    <div
                      className={`h-full ${
                        tp.accuracy >= 70
                          ? 'bg-[#22C55E]'
                          : tp.accuracy >= 50
                            ? 'bg-[#F59E0B]'
                            : 'bg-[#EF4444]'
                      }`}
                      style={{ width: `${tp.accuracy}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="eq-card rounded-2xl p-5 space-y-3.5">
            <h2 className="font-display text-sm font-semibold text-[#22D3EE] uppercase tracking-wide">
              Adaptive Study Recommendations
            </h2>
            <div className="space-y-2.5">
              {analytics_summary.recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-2"
                >
                  <p className="text-xs font-semibold text-[#F8FAFC]">{rec.title}</p>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{rec.reason}</p>
                  <Link
                    to={rec.action_path}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#22D3EE] hover:underline"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    {rec.action_label}
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Question Breakdown */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Question-by-Question Review</h2>
          {wrongCount > 0 && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'all'
                    ? 'bg-[#8B5CF6] text-white'
                    : 'bg-[#11182B] border border-slate-400/15 text-[#94A3B8]'
                }`}
              >
                All ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('incorrect')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterMode === 'incorrect'
                    ? 'bg-[#EF4444]/80 text-white'
                    : 'bg-[#11182B] border border-slate-400/15 text-[#94A3B8]'
                }`}
              >
                Incorrect ({wrongCount})
              </button>
            </div>
          )}
        </div>

        {visibleQuestions.map((q) => {
          const origIdx = questions.findIndex((item) => item.id === q.id);
          const ans = answerMap.get(q.id);
          const rev = reviewMap.get(q.id);
          const ok = ans?.is_correct;
          return (
            <div
              key={q.id}
              className={`eq-card rounded-2xl p-5 space-y-3 border ${
                ok ? 'border-[#22C55E]/25' : 'border-[#EF4444]/25'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  {q.topic_name && (
                    <span className="text-[11px] font-medium text-[#C4B5FD]">{q.topic_name}</span>
                  )}
                  <p className="font-display font-semibold text-sm lg:text-base text-[#F8FAFC]">
                    <span className="text-[#94A3B8] mr-2 tabular-nums">Q{origIdx + 1}.</span>
                    {q.prompt}
                  </p>
                </div>
                {ok ? (
                  <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#EF4444] shrink-0" />
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-1">
                  <span className="text-[#94A3B8] block">Your Answer</span>
                  <strong className={ok ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                    {ans?.answer.value || 'Not answered'}
                  </strong>
                </div>
                {rev && (
                  <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 space-y-1">
                    <span className="text-[#94A3B8] block">Expected Answer</span>
                    <strong className="text-[#22C55E]">{rev.correct_answer}</strong>
                  </div>
                )}
              </div>

              {rev?.explanation && (
                <div className="p-3.5 rounded-xl bg-[#11182B]/60 border border-slate-400/10 text-xs text-[#94A3B8] leading-relaxed">
                  <strong className="text-[#F8FAFC]">Explanation: </strong>
                  {rev.explanation}
                </div>
              )}
              {q.source_refs.length > 0 && (
                <p className="text-xs text-[#22D3EE]">
                  Grounded Source: {q.source_refs.map((r) => r.label).join(', ')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
