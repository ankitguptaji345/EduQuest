import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Compass,
  Flame,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
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

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/dashboard')) return 'Learning Overview';
  if (pathname.startsWith('/upload')) return 'Upload Study Material';
  if (pathname.startsWith('/documents/')) return 'Document & Topic Explorer';
  if (pathname.startsWith('/documents')) return 'Study Library';
  if (pathname.startsWith('/tutor')) return 'Grounded AI Tutor';
  if (pathname.includes('/results')) return 'Assessment Results';
  if (pathname.startsWith('/assessments')) return 'Diagnostics & Practice';
  if (pathname.startsWith('/misconceptions')) return 'Misconceptions Center';
  if (pathname.includes('/boss/')) return 'Boss Arena';
  if (pathname.startsWith('/quests/')) return 'Quest Lesson';
  if (pathname.startsWith('/worlds')) return 'Learning Worlds';
  if (pathname.startsWith('/analytics')) return 'Learning Analytics';
  if (pathname.startsWith('/settings')) return 'Profile & Settings';
  return 'EduQuest AI';
}

function getInitials(name?: string, email?: string): string {
  const source = (name || email || 'S').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AppShell() {
  const { user, logout } = useAuthStore();
  const {
    mobileNavOpen,
    setMobileNavOpen,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    toasts,
    removeToast,
  } = useUIStore();
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
  const pageTitle = getPageTitle(location.pathname);

  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-[#0B1020] text-[#F8FAFC] flex overflow-x-hidden">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col bg-[#11182B] border-r border-slate-400/15 shrink-0 sticky top-0 h-screen transition-[width] duration-200 ${
          sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-64'
        }`}
      >
        {/* Brand + Collapse Button */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-400/15">
          {!sidebarCollapsed && (
            <Link
              to="/dashboard"
              className="font-display text-lg font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap truncate"
            >
              EduQuest AI
            </Link>
          )}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className={`p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33] transition-colors ${
              sidebarCollapsed ? 'mx-auto' : ''
            }`}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* XP & Level HUD */}
        {sidebarCollapsed ? (
          <div className="px-2 py-3.5 border-b border-slate-400/15 flex flex-col items-center gap-1.5">
            <span className="text-xs font-display font-bold text-[#22D3EE] tabular-nums">
              Lv.{currentLvl}
            </span>
            <div className="w-10 h-1.5 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
              <div
                className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-300"
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <span className="text-[11px] text-[#F59E0B] inline-flex items-center gap-0.5 tabular-nums">
              <Flame className="w-3 h-3" />
              {stats?.current_streak || 0}
            </span>
          </div>
        ) : (
          <div className="px-4 py-4 border-b border-slate-400/15 bg-gradient-to-b from-[#151E33]/50 to-transparent">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="font-display font-semibold text-[#F8FAFC] tabular-nums">
                Level {currentLvl}
              </span>
              <span className="inline-flex items-center gap-1 font-mono font-medium tabular-nums text-[#22D3EE]">
                <Zap className="w-3.5 h-3.5" />
                {totalXp} XP
              </span>
            </div>
            <div className="h-2 bg-[#0B1020] rounded-full overflow-hidden border border-slate-400/15">
              <div
                className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE] transition-all duration-500"
                style={{ width: `${levelPct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-[#94A3B8] tabular-nums">
              <span>{Math.max(0, nextThreshold - totalXp)} XP to Lv.{currentLvl + 1}</span>
              <span className="inline-flex items-center gap-1 font-medium text-[#F59E0B]">
                <Flame className="w-3.5 h-3.5" />
                {stats?.current_streak || 0}d streak
              </span>
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `group relative flex items-center ${
                    sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'
                  } py-2.5 rounded-xl text-sm font-medium transition-all duration-150 whitespace-nowrap ${
                    isActive
                      ? 'bg-gradient-to-r from-[#8B5CF6]/20 to-[#22D3EE]/5 text-[#F8FAFC] border border-[#8B5CF6]/35 shadow-sm'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33]/80 border border-transparent'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#22D3EE]' : 'text-[#94A3B8] group-hover:text-[#F8FAFC]'
                      }`}
                    />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="p-3 border-t border-slate-400/15 space-y-2.5">
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-3 px-2 py-1.5 rounded-xl bg-[#151E33]/60 border border-slate-400/10">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#8B5CF6]/30 to-[#22D3EE]/25 border border-slate-400/20 flex items-center justify-center text-xs font-display font-bold text-[#F8FAFC] shrink-0">
                {getInitials(user?.full_name, user?.email)}
              </div>
              <div className="min-w-0 text-xs">
                <p className="text-[#F8FAFC] font-medium truncate">{user?.full_name || 'Student'}</p>
                <p className="text-[#94A3B8] truncate text-[11px]">{user?.email}</p>
              </div>
            </div>
          ) : (
            <div
              className="w-9 h-9 mx-auto rounded-lg bg-gradient-to-br from-[#8B5CF6]/30 to-[#22D3EE]/25 border border-slate-400/20 flex items-center justify-center text-xs font-display font-bold text-[#F8FAFC]"
              title={user?.full_name || user?.email || 'Student'}
            >
              {getInitials(user?.full_name, user?.email)}
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-[#151E33] hover:bg-[#1B2740] border border-slate-400/15 rounded-xl transition-colors ${
              sidebarCollapsed ? 'px-2' : ''
            }`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            {!sidebarCollapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 px-4 lg:px-8 bg-[#11182B]/85 backdrop-blur-md border-b border-slate-400/15 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="lg:hidden p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-[#151E33] shrink-0"
              aria-label="Toggle navigation"
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="min-w-0 flex items-center gap-2.5">
              <span className="lg:hidden font-display font-bold text-base text-[#F8FAFC] whitespace-nowrap">
                EduQuest AI
              </span>
              <span className="hidden lg:inline font-display text-sm font-semibold text-[#F8FAFC] truncate">
                {pageTitle}
              </span>
              <span className="hidden xl:inline text-xs text-[#94A3B8] whitespace-nowrap">
                · Rule-Based Engine
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="lg:hidden flex items-center gap-2.5 text-xs tabular-nums">
              <span className="text-[#22D3EE] font-semibold">Lv.{currentLvl}</span>
              <span className="text-[#94A3B8]">{totalXp} XP</span>
            </div>
            <Link
              to="/upload"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white transition-colors whitespace-nowrap shrink-0 shadow-sm"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Upload Material</span>
              <span className="sm:hidden">Upload</span>
            </Link>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <div className="lg:hidden fixed inset-0 top-16 z-40 bg-[#0B1020]/95 backdrop-blur-md p-4 overflow-y-auto">
            <div className="mb-4 p-4 rounded-xl bg-[#151E33] border border-slate-400/15 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#F8FAFC]">{user?.full_name || 'Student'}</span>
                <span className="text-[#22D3EE] font-mono tabular-nums">
                  Lv.{currentLvl} · {totalXp} XP
                </span>
              </div>
              <div className="h-1.5 bg-[#0B1020] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#8B5CF6] to-[#22D3EE]"
                  style={{ width: `${levelPct}%` }}
                />
              </div>
            </div>

            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileNavOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-[#8B5CF6]/20 text-[#F8FAFC] border border-[#8B5CF6]/35'
                          : 'text-[#94A3B8] hover:bg-[#151E33]'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-[#151E33] text-[#EF4444] border border-slate-400/15"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </nav>
          </div>
        )}

        {/* Main Viewport with subtle compositor-only route transition */}
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 max-w-7xl w-full mx-auto min-w-0">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>

      {/* Toast Stack */}
      <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
              className={`pointer-events-auto flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-sm shadow-xl bg-[#151E33]/95 backdrop-blur-md ${
                t.type === 'success'
                  ? 'border-[#22C55E]/40 text-[#F8FAFC]'
                  : t.type === 'error'
                    ? 'border-[#EF4444]/40 text-[#F8FAFC]'
                    : 'border-[#22D3EE]/40 text-[#F8FAFC]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {t.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0 mt-0.5" />
                ) : t.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 text-[#22D3EE] shrink-0 mt-0.5" />
                )}
                <span className="leading-snug">{t.message}</span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-[#94A3B8] hover:text-[#F8FAFC] shrink-0"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
