import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Compass,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Target,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { apiFetch, xpRequiredForLevel } from '../../lib/api';
import { useAuthStore } from '../../store/useAuthStore';
import { useUIStore } from '../../store/useUIStore';
import type { UserStats } from '../../types/api';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/upload', label: 'Upload Material', icon: Upload },
  { to: '/documents', label: 'Study Library', icon: BookOpen },
  { to: '/tutor', label: 'AI Tutor', icon: MessageSquare },
  { to: '/assessments', label: 'Diagnostics', icon: Target },
  { to: '/misconceptions', label: 'Misconceptions', icon: AlertTriangle },
  { to: '/worlds', label: 'Learning Worlds', icon: Compass },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuthStore();
  const { mobileNavOpen, setMobileNavOpen, toasts, removeToast } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const sessionIdRef = useRef<string | null>(null);

  const { data: statsData } = useQuery({
    queryKey: ['progress-stats'],
    queryFn: () => apiFetch<{ stats: UserStats }>('/api/progress/stats'),
    enabled: Boolean(user),
    refetchInterval: 30_000,
  });

  // Track active learning sessions with capped server-side heartbeats
  useEffect(() => {
    if (!user) return;
    const path = location.pathname;
    const activity = path.startsWith('/tutor')
      ? 'tutor'
      : path.startsWith('/assessments')
        ? 'assessment'
        : path.includes('/boss/')
          ? 'boss'
          : path.startsWith('/quests') || path.startsWith('/worlds')
            ? 'quest'
            : 'reading';

    let mounted = true;
    apiFetch<{ session: { id: string } }>('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ activity }),
    })
      .then((res) => {
        if (mounted) sessionIdRef.current = res.session.id;
      })
      .catch(() => {});

    const hbTimer = setInterval(() => {
      if (sessionIdRef.current && document.visibilityState === 'visible') {
        apiFetch(`/api/sessions/${sessionIdRef.current}/heartbeat`, { method: 'POST' }).catch(() => {});
      }
    }, 30_000);

    return () => {
      mounted = false;
      clearInterval(hbTimer);
      if (sessionIdRef.current) {
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        apiFetch(`/api/sessions/${sid}/end`, { method: 'POST' }).catch(() => {});
      }
    };
  }, [user, location.pathname]);

  const stats = statsData?.stats;
  const currentLvl = stats?.level || 1;
  const totalXp = stats?.total_xp || 0;
  const currThreshold = xpRequiredForLevel(currentLvl);
  const nextThreshold = xpRequiredForLevel(currentLvl + 1);
  const levelPct = Math.min(
    100,
    Math.max(0, Math.round(((totalXp - currThreshold) / Math.max(1, nextThreshold - currThreshold)) * 100)),
  );

  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#11182B] border-r border-slate-400/15 shrink-0 sticky top-0 h-screen">
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-400/15">
          <Link to="/dashboard" className="font-display text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap">
            EduQuest AI
          </Link>
        </div>

        {/* XP & Level HUD */}
        <div className="px-4 py-4 border-b border-slate-400/15">
          <div className="flex items-center justify-between text-xs text-[#94A3B8] mb-1.5">
            <span className="font-medium text-[#F8FAFC] tabular-nums">Level {currentLvl}</span>
            <span className="inline-flex items-center gap-1 tabular-nums text-[#22D3EE]">
              <Zap className="w-3.5 h-3.5" />
              {totalXp} XP
            </span>
          </div>
          <div className="h-2 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
            <div
              className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-300"
              style={{ width: `${levelPct}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-[#94A3B8] tabular-nums">
            <span>{Math.max(0, nextThreshold - totalXp)} XP to Lv.{currentLvl + 1}</span>
            <span className="inline-flex items-center gap-1 text-[#F59E0B]">
              <Flame className="w-3.5 h-3.5" />
              {stats?.current_streak || 0}d
            </span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#8B5CF6]/15 text-[#F8FAFC] border border-[#8B5CF6]/30'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33]'
                  }`
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-400/15 space-y-3">
          <div className="text-xs text-[#94A3B8]">
            <p className="text-[#F8FAFC] font-medium truncate">{user?.full_name || 'Student'}</p>
            <p className="truncate">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/15 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 px-4 lg:px-8 bg-[#11182B]/80 backdrop-blur-md border-b border-slate-400/15 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33]"
              aria-label="Toggle navigation"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="lg:hidden font-display font-bold text-base text-[#F8FAFC] whitespace-nowrap">
              EduQuest AI
            </span>
            <span className="hidden lg:inline text-xs text-[#94A3B8]">
              Rule-Based Engine · Local Grounded Workspace
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="lg:hidden flex items-center gap-3 text-xs tabular-nums">
              <span className="text-[#22D3EE] font-medium">Lv.{currentLvl}</span>
              <span className="text-[#94A3B8]">{totalXp} XP</span>
            </div>
            <Link
              to="/upload"
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors whitespace-nowrap shrink-0"
            >
              Upload Material
            </Link>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 top-16 z-40 bg-[#0B1020]/95 backdrop-blur-md p-4 overflow-y-auto">
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium ${
                        isActive
                          ? 'bg-[#8B5CF6]/20 text-[#F8FAFC] border border-[#8B5CF6]/30'
                          : 'text-[#94A3B8] hover:bg-[#151E33]'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium bg-[#151E33] text-[#EF4444] border border-slate-400/15"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </nav>
          </div>
        )}

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Toast Stack */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-sm shadow-lg ${
              t.type === 'success'
                ? 'bg-[#151E33] border-[#22C55E]/40 text-[#F8FAFC]'
                : t.type === 'error'
                  ? 'bg-[#151E33] border-[#EF4444]/40 text-[#F8FAFC]'
                  : 'bg-[#151E33] border-[#22D3EE]/40 text-[#F8FAFC]'
            }`}
          >
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="text-[#94A3B8] hover:text-[#F8FAFC]"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
