/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AssessmentPage } from './pages/AssessmentPage';
import { AuthPage } from './pages/AuthPage';
import { BossBattlePage } from './pages/BossBattlePage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { LandingPage } from './pages/LandingPage';
import { MisconceptionsPage } from './pages/MisconceptionsPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ProfileSettingsPage } from './pages/ProfileSettingsPage';
import { QuestPlayPage } from './pages/QuestPlayPage';
import { QuizResultsPage } from './pages/QuizResultsPage';
import { TutorPage } from './pages/TutorPage';
import { UploadPage } from './pages/UploadPage';
import { WorldsPage } from './pages/WorldsPage';
import { useAuthStore } from './store/useAuthStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  if (!token || !user) {
    return <Navigate to="/auth" replace />;
  }
  return <>{children}</>;
}

function OnboardedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  if (!token || !user) {
    return <Navigate to="/auth" replace />;
  }
  if (!user.onboarding_completed_at) {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            element={
              <OnboardedRoute>
                <AppShell />
              </OnboardedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/documents" element={<DocumentsPage />} />
            <Route path="/documents/:id" element={<DocumentDetailPage />} />
            <Route path="/tutor" element={<TutorPage />} />
            <Route path="/assessments" element={<AssessmentPage />} />
            <Route path="/assessments/:id" element={<AssessmentPage />} />
            <Route path="/assessments/:id/results" element={<QuizResultsPage />} />
            <Route path="/misconceptions" element={<MisconceptionsPage />} />
            <Route path="/worlds" element={<WorldsPage />} />
            <Route path="/quests/:id" element={<QuestPlayPage />} />
            <Route path="/worlds/:worldId/boss/:questId" element={<BossBattlePage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<ProfileSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
