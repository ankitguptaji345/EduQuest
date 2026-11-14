import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import { useUIStore } from '../store/useUIStore';
import type { Profile } from '../types/api';

type Mode = 'login' | 'register' | 'reset';

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const setAuth = useAuthStore((s) => s.setAuth);
  const addToast = useUIStore((s) => s.addToast);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);

    try {
      if (mode === 'reset') {
        const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email, new_password: password }),
        });
        setInfoMsg(res.message);
        setMode('login');
      } else if (mode === 'register') {
        const res = await apiFetch<{ access_token: string; user: Profile }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password, full_name: fullName }),
        });
        setAuth(res.access_token, res.user);
        addToast('success', 'Account created! Let us personalize your study setup.');
        navigate('/onboarding');
      } else {
        const res = await apiFetch<{ access_token: string; user: Profile }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAuth(res.access_token, res.user);
        addToast('success', `Welcome back, ${res.user.full_name || 'Scholar'}!`);
        navigate(res.user.onboarding_completed_at ? '/dashboard' : '/onboarding');
      }
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex flex-col justify-center items-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-[#94A3B8] hover:text-[#F8FAFC] transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to EduQuest AI
        </Link>

        <div className="eq-card rounded-2xl p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold">
              {mode === 'login'
                ? 'Sign in to EduQuest AI'
                : mode === 'register'
                  ? 'Create your student account'
                  : 'Reset your password'}
            </h1>
            <p className="text-sm text-[#94A3B8]">
              {mode === 'login'
                ? 'Access your study materials, tutor sessions, and learning worlds.'
                : mode === 'register'
                  ? 'Each account has isolated documents, mastery history, and XP ledgers.'
                  : 'Enter your email and choose a new password (6+ characters).'}
            </p>
          </div>

          {/* Mode Tabs */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#11182B] rounded-xl border border-slate-400/15">
            {(['login', 'register', 'reset'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErrorMsg('');
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors capitalize ${
                  mode === m
                    ? 'bg-[#1B2740] text-[#F8FAFC]'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {m === 'register' ? 'Sign Up' : m === 'reset' ? 'Reset' : 'Sign In'}
              </button>
            ))}
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-xs text-[#EF4444]">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="p-3.5 rounded-xl bg-[#22C55E]/10 border border-[#22C55E]/30 text-xs text-[#22C55E]">
              {infoMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#94A3B8]" htmlFor="full-name">
                  Full Name
                </label>
                <input
                  id="full-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/50 focus:border-[#22D3EE] focus:outline-none"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]" htmlFor="email">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@university.edu"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/50 focus:border-[#22D3EE] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#94A3B8]" htmlFor="password">
                {mode === 'reset' ? 'New Password' : 'Password'}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B1020] border border-slate-400/20 text-sm text-[#F8FAFC] placeholder:text-[#94A3B8]/50 focus:border-[#22D3EE] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                  ? 'Create Account'
                  : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
