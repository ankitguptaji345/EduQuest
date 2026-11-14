import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Compass, Target, XCircle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { Assessment, QuestionPublic } from '../types/api';

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
}

export function QuizResultsPage() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['assessment-results', id],
    queryFn: () => apiFetch<ResultsResponse>(`/api/assessments/${id}`),
    enabled: Boolean(id),
  });

  if (isLoading || !data) {
    return <div className="h-64 rounded-2xl bg-[#151E33] animate-pulse" />;
  }

  const { assessment, questions, answers, review } = data;
  const answerMap = new Map(answers.map((a) => [a.question_id, a]));
  const reviewMap = new Map(review.map((r) => [r.question_id, r]));

  const maxScore = Math.max(1, assessment.max_score || questions.length);
  const rawScore = assessment.score ?? answers.reduce((s, a) => s + a.score, 0);
  const pct = Math.round((rawScore / maxScore) * 100);
  const wrongCount = answers.filter((a) => !a.is_correct).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-[#151E33] border border-slate-400/15 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs text-[#22D3EE] uppercase">Assessment Report</p>
          <h1 className="font-display text-3xl font-bold tabular-nums">{pct}% Accuracy</h1>
          <p className="text-sm text-[#94A3B8] tabular-nums">
            {answers.filter((a) => a.is_correct).length} of {questions.length} correct ·{' '}
            {wrongCount} flagged for review
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          {wrongCount > 0 && (
            <Link
              to="/misconceptions"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-xs font-semibold text-[#F59E0B]"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Review Misconceptions
            </Link>
          )}
          <Link
            to="/assessments"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8B5CF6] text-white text-xs font-semibold"
          >
            <Target className="w-3.5 h-3.5" />
            New Quiz
          </Link>
          <Link
            to="/worlds"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs font-medium text-[#F8FAFC]"
          >
            <Compass className="w-3.5 h-3.5 text-[#22D3EE]" />
            Learning Worlds
          </Link>
        </div>
      </div>

      {/* Question Breakdown */}
      <div className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Question-by-Question Review</h2>
        {questions.map((q, idx) => {
          const ans = answerMap.get(q.id);
          const rev = reviewMap.get(q.id);
          const ok = ans?.is_correct;
          return (
            <div
              key={q.id}
              className="bg-[#151E33] border border-slate-400/15 rounded-xl p-5 space-y-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-sm text-[#F8FAFC]">
                  <span className="text-[#94A3B8] mr-2 tabular-nums">Q{idx + 1}.</span>
                  {q.prompt}
                </p>
                {ok ? (
                  <CheckCircle2 className="w-5 h-5 text-[#22C55E] shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-[#EF4444] shrink-0" />
                )}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs pt-1">
                <div className="p-3 rounded-lg bg-[#11182B] border border-slate-400/15">
                  <span className="text-[#94A3B8]">Your Answer: </span>
                  <strong className={ok ? 'text-[#22C55E]' : 'text-[#EF4444]'}>
                    {ans?.answer.value || 'Not answered'}
                  </strong>
                </div>
                {rev && (
                  <div className="p-3 rounded-lg bg-[#11182B] border border-slate-400/15">
                    <span className="text-[#94A3B8]">Expected Answer: </span>
                    <strong className="text-[#22C55E]">{rev.correct_answer}</strong>
                  </div>
                )}
              </div>

              {rev?.explanation && (
                <p className="text-xs text-[#94A3B8] leading-relaxed">{rev.explanation}</p>
              )}
              {q.source_refs.length > 0 && (
                <p className="text-xs text-[#22D3EE]">
                  Source: {q.source_refs.map((r) => r.label).join(', ')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
