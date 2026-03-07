import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Login } from './pages/Login';
import { Users } from './pages/Users';
import { Dashboard } from './pages/Dashboard';
import { Funding } from './pages/Funding';
import { Admin } from './pages/Admin';
import { DiagnosticsDashboard } from './pages/DiagnosticsDashboard';
import { DiagnosticsUsers } from './pages/DiagnosticsUsers';
import { DiagnosticsUserDetail } from './pages/DiagnosticsUserDetail';
import { Lineups } from './pages/Lineups';
import { Trends } from './pages/Trends';
import { ViewDiscovered } from './pages/ViewDiscovered';
import { CreateContestType } from './pages/CreateContestType';
import StagingCleanup from './pages/StagingCleanup';
import { AlertCenter } from './pages/AlertCenter';
import { ContestPoolDiagnostics } from './pages/ContestPoolDiagnostics';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="funding" element={<Funding />} />
            <Route path="admin" element={<Admin />} />
            <Route path="alerts" element={<AlertCenter />} />
            <Route path="users" element={<Users />} />
            <Route path="diagnostics" element={<DiagnosticsDashboard />} />
            <Route path="diagnostics/users" element={<DiagnosticsUsers />} />
            <Route path="diagnostics/users/:userId" element={<DiagnosticsUserDetail />} />
            <Route path="diagnostics/contest-pools" element={<ContestPoolDiagnostics />} />
            <Route path="lineups" element={<Lineups />} />
            <Route path="trends" element={<Trends />} />
            <Route path="discovery" element={<ViewDiscovered />} />
            <Route path="create-contest-type" element={<CreateContestType />} />
            <Route path="staging-cleanup" element={<StagingCleanup />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
