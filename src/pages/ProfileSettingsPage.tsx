import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Plus, Server, Trash2 } from 'lucide-react';
import { apiFetch, ApiError } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type { Profile, Subject, UserPreferences } from '../types/api';

interface ProfileResponse {
  profile: Profile;
  preferences: UserPreferences;
  subjects: Subject[];
}

interface HealthReady {
  status: string;
  database: boolean;
  storage: boolean;
  ai_mode: string;
  ai_configured: boolean;
  ocr_enabled: boolean;
}

export function ProfileSettingsPage() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const addToast = useUIStore((s) => s.addToast);

  const { data } = useQuery({
    queryKey: ['profile-full'],
    queryFn: () => apiFetch<ProfileResponse>('/api/profile'),
  });

  const { data: health } = useQuery({
    queryKey: ['health-ready'],
    queryFn: () => apiFetch<HealthReady>('/health/ready'),
  });

  const [fullName, setFullName] = useState('');
  const [course, setCourse] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [educationLevel, setEducationLevel] = useState<Profile['education_level']>('undergraduate');
  const [style, setStyle] = useState<UserPreferences['explanation_style']>('step_by_step');
  const [dailyGoal, setDailyGoal] = useState(20);
  const [newSubject, setNewSubject] = useState('');

  useEffect(() => {
    if (data?.profile) {
      setFullName(data.profile.full_name);
      setCourse(data.profile.course);
      setTimezone(data.profile.timezone || 'UTC');
      setEducationLevel(data.profile.education_level);
    }
    if (data?.preferences) {
      setStyle(data.preferences.explanation_style);
      setDailyGoal(data.preferences.daily_goal_minutes);
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const pRes = await apiFetch<{ profile: Profile }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName,
          course,
          timezone,
          education_level: educationLevel,
        }),
      });
      await apiFetch('/api/profile/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          explanation_style: style,
          daily_goal_minutes: Number(dailyGoal),
        }),
      });
      return pRes.profile;
    },
    onSuccess: (updatedProfile) => {
      setUser(updatedProfile);
      void queryClient.invalidateQueries({ queryKey: ['profile-full'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-overview'] });
      addToast('success', 'Settings saved.');
    },
    onError: (err) => {
      addToast('error', err instanceof ApiError ? err.message : 'Unable to save settings.');
    },
  });

  const addSubjMut = useMutation({
    mutationFn: () =>
      apiFetch('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ name: newSubject.trim() }),
      }),
    onSuccess: () => {
      setNewSubject('');
      void queryClient.invalidateQueries({ queryKey: ['profile-full'] });
      void queryClient.invalidateQueries({ queryKey: ['subjects'] });
    },
  });

  const delSubjMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/subjects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile-full'] });
      void queryClient.invalidateQueries({ queryKey: ['subjects'] });
    },
  });

  const scheduleDeleteMut = useMutation({
    mutationFn: () => apiFetch<{ profile: Profile }>('/api/profile', { method: 'DELETE' }),
    onSuccess: (res) => {
      setUser(res.profile);
      void queryClient.invalidateQueries({ queryKey: ['profile-full'] });
      addToast('info', 'Account deletion scheduled (7-day grace period).');
    },
  });

  const cancelDeleteMut = useMutation({
    mutationFn: () =>
      apiFetch<{ profile: Profile }>('/api/profile/cancel-deletion', { method: 'POST' }),
    onSuccess: (res) => {
      setUser(res.profile);
      void queryClient.invalidateQueries({ queryKey: ['profile-full'] });
      addToast('success', 'Account deletion cancelled.');
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="eq-hero-surface rounded-2xl p-6 space-y-1">
        <p className="text-xs font-medium text-[#22D3EE]">Workspace Configuration</p>
        <h1 className="font-display text-2xl font-bold text-[#F8FAFC]">Profile & Study Settings</h1>
        <p className="text-sm text-[#94A3B8]">
          Configure your learner profile, explanation style, daily goal, subjects, and runtime
          status.
        </p>
      </div>

      {/* Profile & Preferences */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMut.mutate();
        }}
        className="eq-card rounded-2xl p-6 space-y-5"
      >
        <h2 className="font-display text-base font-semibold text-[#F8FAFC]">Learner Preferences</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Education Level</label>
            <select
              value={educationLevel}
              onChange={(e) => setEducationLevel(e.target.value as Profile['education_level'])}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            >
              <option value="school">School</option>
              <option value="undergraduate">Undergraduate</option>
              <option value="postgraduate">Postgraduate</option>
              <option value="exam_prep">Exam Prep</option>
              <option value="self_learner">Self Learner</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Course / Program</label>
            <input
              type="text"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Timezone (IANA)</label>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Tutor Explanation Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as UserPreferences['explanation_style'])}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
            >
              <option value="step_by_step">Step by Step</option>
              <option value="beginner">Beginner</option>
              <option value="academic">Academic</option>
              <option value="example_based">Example Based</option>
              <option value="exam_oriented">Exam Oriented</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#94A3B8]">Daily Goal (minutes)</label>
            <input
              type="number"
              min={5}
              max={240}
              value={dailyGoal}
              onChange={(e) => setDailyGoal(Number(e.target.value))}
              className="w-full bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] tabular-nums focus:outline-none focus:border-[#22D3EE]"
            />
          </div>
        </div>
        <div className="flex justify-end pt-2 border-t border-slate-400/15">
          <button
            type="submit"
            disabled={saveMut.isPending}
            className="px-5 py-2.5 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {saveMut.isPending ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </form>

      {/* Subjects Manager */}
      <div className="eq-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-[#F8FAFC]">Study Subjects</h2>
          <span className="text-xs text-[#94A3B8] tabular-nums">
            {(data?.subjects || []).length} configured
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder="Add subject (e.g. Algorithms)"
            className="flex-1 bg-[#11182B] border border-slate-400/20 rounded-xl px-3.5 py-2.5 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#22D3EE]"
          />
          <button
            type="button"
            onClick={() => newSubject.trim() && addSubjMut.mutate()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#22D3EE] hover:bg-[#06B6D4] text-[#0B1020] text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Subject
          </button>
        </div>
        {(data?.subjects || []).length === 0 ? (
          <p className="text-xs text-[#94A3B8]">No subjects added yet. Add a subject to organize uploads.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(data?.subjects || []).map((s) => (
              <div
                key={s.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#11182B] border border-slate-400/20 text-xs text-[#F8FAFC]"
              >
                <span>{s.name}</span>
                <button
                  type="button"
                  onClick={() => delSubjMut.mutate(s.id)}
                  className="text-[#94A3B8] hover:text-[#EF4444] transition-colors"
                  aria-label={`Remove ${s.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Runtime & AI Engine Status (Honest Layer A/B reporting) */}
      <div className="eq-card rounded-2xl p-6 space-y-3.5">
        <h2 className="font-display text-base font-semibold flex items-center gap-2 text-[#F8FAFC]">
          <Server className="w-4 h-4 text-[#22D3EE]" />
          Runtime & AI Provider Status
        </h2>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 flex items-center justify-between gap-2">
            <span className="text-[#94A3B8]">Active AI Mode</span>
            <span className="font-semibold text-[#22C55E] inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {health?.ai_mode === 'rule_based' ? 'Rule-Based Engine (Local)' : health?.ai_mode || 'rule_based'}
            </span>
          </div>
          <div className="p-3.5 rounded-xl bg-[#11182B] border border-slate-400/15 flex items-center justify-between gap-2">
            <span className="text-[#94A3B8]">Database & Disk Storage</span>
            <span className="font-semibold text-[#22C55E]">
              {health?.database && health?.storage ? 'SQLite + Local Disk Ready' : 'Checking...'}
            </span>
          </div>
        </div>
      </div>

      {/* Account Deletion */}
      <div className="eq-card border-[#EF4444]/30 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#EF4444]">Account Lifecycle</h2>
          <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">
            {data?.profile.deletion_requested_at
              ? `Deletion scheduled on ${new Date(data.profile.deletion_requested_at).toLocaleDateString()} (7-day grace period active).`
              : 'Request account deletion with a 7-day reversible grace period.'}
          </p>
        </div>
        {data?.profile.deletion_requested_at ? (
          <button
            type="button"
            onClick={() => cancelDeleteMut.mutate()}
            className="px-4 py-2.5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#0B1020] text-xs font-bold transition-colors whitespace-nowrap shrink-0"
          >
            Cancel Scheduled Deletion
          </button>
        ) : (
          <button
            type="button"
            onClick={() => scheduleDeleteMut.mutate()}
            className="px-4 py-2.5 rounded-xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 border border-[#EF4444]/40 text-xs font-semibold text-[#EF4444] transition-colors whitespace-nowrap shrink-0"
          >
            Schedule Account Deletion
          </button>
        )}
      </div>
    </div>
  );
}
