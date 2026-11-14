import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type { Profile } from '../types/api';

const EDUCATION_LEVELS = [
  { value: 'school', label: 'High School' },
  { value: 'undergraduate', label: 'Undergraduate' },
  { value: 'postgraduate', label: 'Postgraduate' },
  { value: 'exam_prep', label: 'Exam Prep' },
  { value: 'self_learner', label: 'Self Learner' },
] as const;

const STYLES = [
  { value: 'step_by_step', label: 'Step-by-Step', desc: 'Numbered logical breakdowns' },
  { value: 'beginner', label: 'Beginner Friendly', desc: 'Clear plain-language summaries' },
  { value: 'example_based', label: 'Example-Based', desc: 'Concept paired with concrete cases' },
  { value: 'exam_oriented', label: 'Exam-Oriented', desc: 'Key facts & common pitfalls' },
  { value: 'academic', label: 'Academic', desc: 'Formal definitions & terminology' },
] as const;

export function OnboardingPage() {
  const { user, setUser } = useAuthStore();
  const addToast = useUIStore((s) => s.addToast);
  const navigate = useNavigate();

  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [educationLevel, setEducationLevel] = useState<Profile['education_level']>('undergraduate');
  const [course, setCourse] = useState('');
  const [timezone, setTimezone] = useState(detectedTz);
  const [subjectInput, setSubjectInput] = useState('');
  const [subjects, setSubjects] = useState<string[]>(['Computer Science']);
  const [goals, setGoals] = useState('Master core concepts and eliminate recurring mistakes');
  const [explanationStyle, setExplanationStyle] = useState('step_by_step');
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(20);
  const [saving, setSaving] = useState(false);

  const addSubjectTag = () => {
    const clean = subjectInput.trim();
    if (clean && !subjects.some((s) => s.toLowerCase() === clean.toLowerCase())) {
      setSubjects([...subjects, clean]);
    }
    setSubjectInput('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName,
          education_level: educationLevel,
          course,
          timezone,
        }),
      });

      await apiFetch('/api/profile/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          subjects_of_interest: subjects,
          goals: goals
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean),
          explanation_style: explanationStyle,
          daily_goal_minutes: dailyGoalMinutes,
        }),
      });

      for (const s of subjects) {
        await apiFetch('/api/subjects', {
          method: 'POST',
          body: JSON.stringify({ name: s }),
        });
      }

      const completed = await apiFetch<{ profile: Profile }>('/api/profile/onboarding-complete', {
        method: 'POST',
      });
      setUser(completed.profile);
      addToast('success', 'Onboarding complete! Upload your first study file to begin.');
      navigate('/dashboard');
    } catch (err) {
      addToast('error', err instanceof ApiError ? err.message : 'Failed to save onboarding.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] py-12 px-4">
      <div className="max-w-2xl mx-auto bg-[#151E33] border border-slate-400/15 rounded-2xl p-8 space-y-8">
        <div className="space-y-2 border-b border-slate-400/15 pb-5">
          <p className="text-xs font-medium text-[#22D3EE]">Student Setup</p>
          <h1 className="font-display text-2xl font-bold">Personalize Your Learning World</h1>
          <p className="text-sm text-[#94A3B8]">
            Set your academic profile, subjects, explanation style, and daily study target.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">Education Level</label>
              <select
                value={educationLevel}
                onChange={(e) => setEducationLevel(e.target.value as Profile['education_level'])}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              >
                {EDUCATION_LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">Course / Major</label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="B.S. Computer Science"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">Timezone (for Streaks)</label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              />
            </div>
          </div>

          {/* Subjects */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#94A3B8]">Your Subjects</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={subjectInput}
                onChange={(e) => setSubjectInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addSubjectTag();
                  }
                }}
                placeholder="Add subject (e.g. Data Structures, Biology)"
                className="flex-1 px-3.5 py-2 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              />
              <button
                type="button"
                onClick={addSubjectTag}
                className="px-3.5 py-2 rounded-lg bg-[#1B2740] hover:bg-[#1B2740]/80 text-xs font-medium inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {subjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => setSubjects(subjects.filter((s) => s !== sub))}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#11182B] border border-slate-400/20 text-xs text-[#F8FAFC] hover:border-[#EF4444]/50"
                >
                  <span>{sub}</span>
                  <X className="w-3 h-3 text-[#94A3B8]" />
                </button>
              ))}
            </div>
          </div>

          {/* Explanation Style */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-[#94A3B8]">
              Preferred Tutor Explanation Style
            </label>
            <div className="grid sm:grid-cols-3 gap-2.5">
              {STYLES.map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setExplanationStyle(st.value)}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    explanationStyle === st.value
                      ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#F8FAFC]'
                      : 'bg-[#11182B] border-slate-400/15 text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{st.label}</span>
                    {explanationStyle === st.value && <Check className="w-3.5 h-3.5 text-[#22D3EE]" />}
                  </div>
                  <p className="text-[11px] text-[#94A3B8] mt-1">{st.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">Learning Goals</label>
              <input
                type="text"
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]">
                Daily Learning Target: <span className="text-[#F8FAFC] tabular-nums">{dailyGoalMinutes} min/day</span>
              </label>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={dailyGoalMinutes}
                onChange={(e) => setDailyGoalMinutes(Number(e.target.value))}
                className="w-full accent-[#8B5CF6] mt-2"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Complete Setup & Enter Dashboard
          </button>
        </form>
      </div>
    </div>
  );
}
