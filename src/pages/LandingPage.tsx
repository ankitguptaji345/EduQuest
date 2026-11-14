import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Compass,
  FileText,
  MessageSquare,
  Shield,
  Target,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';

export function LandingPage() {
  const user = useAuthStore((s) => s.user);
  const ctaTarget = user ? (user.onboarding_completed_at ? '/dashboard' : '/onboarding') : '/auth';

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0B1020]/90 backdrop-blur-md border-b border-slate-400/15">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0"
          >
            EduQuest AI
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#94A3B8]">
            <a href="#how-it-works" className="hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#misconceptions" className="hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0">
              Misconception Engine
            </a>
            <a href="#features" className="hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0">
              Features
            </a>
            <Link to="/auth" className="hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0">
              Sign In
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to={ctaTarget}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors whitespace-nowrap shrink-0"
            >
              {user ? 'Open Workspace' : 'Get Started'}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-7xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-12 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="lg:col-span-7 space-y-6"
          >
            <p className="text-sm font-medium text-[#22D3EE]">
              Your AI Teacher · Your Learning World · Your Adventure
            </p>
            <h1 className="font-display text-4xl lg:text-5xl font-bold tracking-tight leading-tight text-balance">
              Turn your own study materials into misconception-aware quests.
            </h1>
            <p className="text-base lg:text-lg text-[#94A3B8] max-w-2xl leading-relaxed">
              Upload PDFs, lecture slides, DOCX notes, or text outlines. EduQuest AI extracts structured
              topics, grounds every tutor explanation in clickable citations, diagnoses why mistakes happen,
              and adapts quests and boss battles around your real mastery.
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <Link
                to={ctaTarget}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold text-sm transition-colors"
              >
                {user ? 'Go to Dashboard' : 'Start Learning Now'}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/20 text-[#F8FAFC] font-medium text-sm transition-colors"
              >
                See How It Works
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#94A3B8] pt-2">
              <span>PDF, DOCX, PPTX & TXT</span>
              <span aria-hidden="true">·</span>
              <span>Zero hallucinated citations</span>
              <span aria-hidden="true">·</span>
              <span>Server-side answer keys & XP</span>
            </div>
          </motion.div>

          {/* Differentiator Preview Panel */}
          <div className="lg:col-span-5 eq-hero-surface rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-400/15 pb-4">
              <div>
                <p className="text-xs font-medium text-[#22D3EE]">Core Differentiator</p>
                <h2 className="font-display text-lg font-semibold text-[#F8FAFC]">
                  Misconception Diagnosis Loop
                </h2>
              </div>
              <div className="w-9 h-9 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/25 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
              </div>
            </div>

            <div className="space-y-3.5 text-sm">
              <div className="p-3.5 rounded-xl bg-[#0B1020]/65 border border-slate-400/15">
                <p className="text-xs text-[#94A3B8] mb-1">01. Student Response Detected</p>
                <p className="text-[#F8FAFC]">
                  Answered <span className="text-[#EF4444] font-medium">"Oldest item at bottom (FIFO)"</span> for
                  Stack POP operation across 2 attempts.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#0B1020]/65 border border-slate-400/15">
                <p className="text-xs text-[#F59E0B] mb-1">02. Confirmed Diagnosis · Confidence 88%</p>
                <p className="text-[#F8FAFC]">
                  LIFO (Stack) vs FIFO (Queue) Confusion — requires corrective comparison before advancing.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#0B1020]/65 border border-slate-400/15">
                <p className="text-xs text-[#22C55E] mb-1">03. Corrective Lesson & Verification</p>
                <p className="text-[#94A3B8]">
                  Targeted mini-lesson grounded in Page 2 + follow-up check updates status to Resolved and
                  awards improvement XP.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="border-t border-slate-400/15 bg-[#11182B]/50 py-16">
          <div className="max-w-7xl mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-2">
              <h2 className="font-display text-2xl lg:text-3xl font-bold">From raw notes to verified mastery</h2>
              <p className="text-[#94A3B8] text-sm lg:text-base">
                Every world, quiz, and tutor reply is built directly from your uploaded materials.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  step: '01',
                  title: 'Upload Material',
                  desc: 'Drop PDF, DOCX, PPTX, or TXT files up to 20 MB with format and scanned-PDF checks.',
                  icon: FileText,
                },
                {
                  step: '02',
                  title: 'Extract & Map Topics',
                  desc: 'Build hierarchical topics, definitions, formulas, and page/slide/section citations.',
                  icon: BookOpen,
                },
                {
                  step: '03',
                  title: 'Diagnose Misconceptions',
                  desc: 'Spot repeated conceptual errors vs careless slips and resolve them with targeted checks.',
                  icon: Target,
                },
                {
                  step: '04',
                  title: 'Conquer Worlds & Bosses',
                  desc: 'Unlock adaptive quests and multi-round boss battles while earning server-verified XP.',
                  icon: Shield,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.step}
                    className="eq-card eq-card-hover rounded-2xl p-6 space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs text-[#94A3B8]">
                      <span className="font-mono">{item.step}</span>
                      <Icon className="w-4 h-4 text-[#22D3EE]" />
                    </div>
                    <h3 className="font-display text-base font-semibold text-[#F8FAFC]">{item.title}</h3>
                    <p className="text-sm text-[#94A3B8] leading-relaxed">{item.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-7xl mx-auto px-6 py-16 space-y-10">
          <div id="misconceptions" className="max-w-2xl space-y-2">
            <h2 className="font-display text-2xl lg:text-3xl font-bold">Built for serious academic integrity</h2>
            <p className="text-[#94A3B8] text-sm lg:text-base">
              Deterministic Rule-Based Engine for local offline execution, architected for drop-in Gemini &
              Supabase scaling.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: MessageSquare,
                title: 'Citation-Grounded Tutor',
                desc: 'BM25 + TF-IDF retrieval surfaces exact excerpts with clickable Page, Slide, or Section citations—and refuses to guess when evidence is missing.',
              },
              {
                icon: Compass,
                title: 'Topic-Driven Learning Worlds',
                desc: 'No generic templates. Every world, lesson, checkpoint, and 3-round boss challenge is generated from your uploaded topics.',
              },
              {
                icon: BarChart3,
                title: 'Evidence-Based Analytics',
                desc: 'Track real XP ledgers, timezone-aware streaks, capped active session minutes, and mastery confidence scores.',
              },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="eq-card eq-card-hover rounded-2xl p-6 space-y-3"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/10 border border-[#8B5CF6]/25 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-[#8B5CF6]" />
                  </div>
                  <h3 className="font-display text-base font-semibold">{f.title}</h3>
                  <p className="text-sm text-[#94A3B8] leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-400/15 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#94A3B8]">
          <span>EduQuest AI · Grounded Gamified Learning</span>
          <div className="flex items-center gap-6">
            <Link to="/auth" className="hover:text-[#F8FAFC]">
              Student Login
            </Link>
            <a href="#how-it-works" className="hover:text-[#F8FAFC]">
              Architecture
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
