import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Heart,
  Loader2,
  Shield,
  Skull,
  Swords,
  Trophy,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useUIStore } from '../store/useUIStore';
import type { QuestionPublic, Quest } from '../types/api';

interface BossStartResponse {
  quest: Quest;
  attempt: {
    id: string;
    progress: { boss_hp?: number; player_hp?: number; current_round?: number };
  };
  questions: QuestionPublic[];
  answers: Array<{ question_id: string; is_correct: boolean }>;
}

interface BossBattleResult {
  passed: boolean;
  accuracy_percent: number;
  threshold_percent: number;
  round_stats: Array<{ round: number; total: number; correct: number; accuracy: number }>;
  xp_award: { amount: number } | null;
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

export function BossBattlePage() {
  const { questId } = useParams<{ worldId: string; questId: string }>();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [battle, setBattle] = useState<BossStartResponse | null>(null);
  const [bossHp, setBossHp] = useState(100);
  const [playerHp, setPlayerHp] = useState(100);
  const [currentRound, setCurrentRound] = useState(1);
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [lastEval, setLastEval] = useState<{ is_correct: boolean; feedback: string } | null>(null);
  const [finalResult, setFinalResult] = useState<BossBattleResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!questId) return;
    let active = true;
    apiFetch<BossStartResponse>(`/api/quests/${questId}/start`, {
      method: 'POST',
      idempotent: true,
    })
      .then((res) => {
        if (!active) return;
        setBattle(res);
        setBossHp(res.attempt.progress?.boss_hp ?? 100);
        setPlayerHp(res.attempt.progress?.player_hp ?? 100);
        setCurrentRound(res.attempt.progress?.current_round ?? 1);
        setAnsweredIds(res.answers.map((a) => a.question_id));
      })
      .catch((err) => {
        if (!active) return;
        setErrorMsg(err instanceof ApiError ? err.message : 'Unable to enter Boss Arena.');
      });
    return () => {
      active = false;
    };
  }, [questId]);

  const strikeMut = useMutation({
    mutationFn: (params: { attemptId: string; questionId: string; answer: string }) =>
      apiFetch<{
        evaluation: { is_correct: boolean; feedback: string };
        boss_hp: number;
        player_hp: number;
        current_round: number;
        battle_result: BossBattleResult | null;
      }>(`/api/boss/${params.attemptId}/round-answer`, {
        method: 'POST',
        idempotent: true,
        body: JSON.stringify({ question_id: params.questionId, answer: params.answer }),
      }),
    onSuccess: (res, vars) => {
      setAnsweredIds((prev) => [...prev, vars.questionId]);
      setDraft('');
      setBossHp(res.boss_hp);
      setPlayerHp(res.player_hp);
      setCurrentRound(res.current_round);
      setLastEval(res.evaluation);
      if (res.battle_result) {
        setFinalResult(res.battle_result);
        void queryClient.invalidateQueries({ queryKey: ['worlds'] });
        void queryClient.invalidateQueries({ queryKey: ['progress-stats'] });
        void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
        if (res.battle_result.passed) {
          addToast('success', `Boss defeated! +${res.battle_result.xp_award?.amount || 0} XP`);
        }
      }
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Failed to submit boss strike.');
    },
  });

  if (errorMsg) {
    return (
      <div className="max-w-xl mx-auto eq-card border-[#EF4444]/35 rounded-2xl p-8 text-center space-y-4">
        <Skull className="w-10 h-10 text-[#EF4444] mx-auto" />
        <h1 className="font-display text-xl font-bold">Boss Arena Locked</h1>
        <p className="text-sm text-[#94A3B8]">{errorMsg}</p>
        <Link
          to="/worlds"
          className="inline-block px-5 py-2.5 rounded-xl bg-[#8B5CF6] text-white text-xs font-semibold"
        >
          Back to World Map
        </Link>
      </div>
    );
  }

  if (!battle) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#94A3B8]">
        <Loader2 className="w-4 h-4 animate-spin text-[#F59E0B]" />
        Preparing 3-round Boss Arena...
      </div>
    );
  }

  const nextQuestion = battle.questions.find((q) => !answeredIds.includes(q.id));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Arena Header */}
      <div className="eq-hero-surface rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Link to="/worlds" className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F8FAFC]">
            <ArrowLeft className="w-3.5 h-3.5" />
            Learning Worlds
          </Link>
          <h1 className="font-display text-2xl font-bold">{battle.quest.title}</h1>
          <p className="text-xs text-[#F59E0B] font-medium tabular-nums">
            Mastery Required: {Math.round((battle.quest.mastery_threshold || 0.75) * 100)}% · Reward: +
            {battle.quest.xp_reward} XP
          </p>
        </div>

        {/* 3-Round Indicator */}
        <div className="flex items-center gap-1.5">
          {[1, 2, 3].map((r) => (
            <div
              key={r}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border tabular-nums ${
                currentRound === r
                  ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F59E0B]'
                  : currentRound > r || finalResult
                    ? 'bg-[#22C55E]/15 border-[#22C55E]/40 text-[#22C55E]'
                    : 'bg-[#11182B] border-slate-400/15 text-[#94A3B8]'
              }`}
            >
              Round {r}
            </div>
          ))}
        </div>
      </div>

      {/* Boss & Scholar HP Bars */}
      <div className="grid sm:grid-cols-2 gap-4 eq-card rounded-2xl p-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#F59E0B]">
              <Skull className="w-4 h-4" />
              Boss Integrity
            </span>
            <span className="font-mono font-bold tabular-nums">{bossHp}%</span>
          </div>
          <div className="h-3 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
            <div
              className="h-full bg-gradient-to-r from-[#EF4444] to-[#F59E0B] transition-all duration-300"
              style={{ width: `${bossHp}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-[#22C55E]">
              <Heart className="w-4 h-4" />
              Scholar Shield
            </span>
            <span className="font-mono font-bold tabular-nums">{playerHp}%</span>
          </div>
          <div className="h-3 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
            <div
              className="h-full bg-gradient-to-r from-[#22C55E] to-[#22D3EE] transition-all duration-300"
              style={{ width: `${playerHp}%` }}
            />
          </div>
        </div>
      </div>

      {finalResult ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.22 }}
          className={`rounded-2xl border p-7 space-y-6 ${
            finalResult.passed
              ? 'bg-[#22C55E]/10 border-[#22C55E]/35'
              : 'bg-[#EF4444]/10 border-[#EF4444]/35'
          }`}
        >
          <div className="text-center space-y-2">
            {finalResult.passed ? (
              <Trophy className="w-12 h-12 text-[#22C55E] mx-auto" />
            ) : (
              <Shield className="w-12 h-12 text-[#EF4444] mx-auto" />
            )}
            <h2 className="font-display text-2xl font-bold">
              {finalResult.passed ? 'Boss Defeated!' : 'Boss Survived — Review & Retry'}
            </h2>
            <p className="text-sm text-[#F8FAFC]/90 tabular-nums">
              Final Accuracy: <strong>{finalResult.accuracy_percent}%</strong> (Required:{' '}
              {finalResult.threshold_percent}%)
              {finalResult.xp_award ? ` · Earned +${finalResult.xp_award.amount} XP` : ''}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {finalResult.round_stats.map((r) => (
              <div
                key={r.round}
                className="p-4 rounded-xl bg-[#11182B] border border-slate-400/15 text-center space-y-1"
              >
                <p className="text-xs text-[#94A3B8]">Round {r.round}</p>
                <p className="font-display text-xl font-bold tabular-nums">{r.accuracy}%</p>
                <p className="text-[11px] text-[#94A3B8] tabular-nums">
                  {r.correct}/{r.total} correct
                </p>
              </div>
            ))}
          </div>

          <div className="flex justify-center gap-3">
            <Link
              to="/worlds"
              className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors"
            >
              Return to World Map
            </Link>
            {!finalResult.passed && (
              <Link
                to="/misconceptions"
                className="px-5 py-2.5 rounded-xl bg-[#151E33] border border-slate-400/20 text-xs font-semibold text-[#F59E0B]"
              >
                Review Misconceptions
              </Link>
            )}
          </div>
        </motion.div>
      ) : (
        nextQuestion && (
          <div className="eq-card rounded-2xl p-6 lg:p-7 space-y-5">
            <div className="flex items-center justify-between text-xs text-[#94A3B8] tabular-nums">
              <span className="capitalize font-medium text-[#F59E0B]">
                Round {nextQuestion.round_no} · Difficulty: {nextQuestion.difficulty}
              </span>
              <span>
                Challenge {answeredIds.length + 1} of {battle.questions.length}
              </span>
            </div>

            <h2 className="font-display text-lg lg:text-xl font-semibold leading-snug">
              {nextQuestion.prompt}
            </h2>

            {nextQuestion.options && nextQuestion.options.length > 0 ? (
              <div className="space-y-2.5">
                {nextQuestion.options.map((opt, oIdx) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setDraft(opt)}
                    className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm transition-all flex items-start gap-3 ${
                      draft === opt
                        ? 'bg-[#F59E0B]/20 border-[#F59E0B] text-[#F8FAFC]'
                        : 'bg-[#11182B] border-slate-400/20 text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                        draft === opt
                          ? 'bg-[#F59E0B] text-[#0B1020]'
                          : 'bg-[#151E33] text-[#94A3B8] border border-slate-400/20'
                      }`}
                    >
                      {OPTION_LETTERS[oIdx] || oIdx + 1}
                    </span>
                    <span className="leading-relaxed pt-0.5">{opt}</span>
                  </button>
                ))}
              </div>
            ) : (
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type your boss counter-answer..."
                className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-4 py-3 text-sm text-[#F8FAFC]"
              />
            )}

            {lastEval && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-center gap-2 border ${
                  lastEval.is_correct
                    ? 'bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]'
                    : 'bg-[#EF4444]/10 border-[#EF4444]/30 text-[#EF4444]'
                }`}
              >
                {lastEval.is_correct ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>Previous Strike: {lastEval.feedback}</span>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-400/15">
              <button
                type="button"
                disabled={!draft.trim() || strikeMut.isPending}
                onClick={() =>
                  strikeMut.mutate({
                    attemptId: battle.attempt.id,
                    questionId: nextQuestion.id,
                    answer: draft,
                  })
                }
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-[#0B1020] text-sm font-bold transition-colors"
              >
                <Swords className="w-4 h-4" />
                {strikeMut.isPending ? 'Resolving Strike...' : 'Submit Strike'}
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
