import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Login } from './pages/Login';
import { Users } from './pages/Users';
import UserWalletLedger from './pages/UserWalletLedger';
import { Dashboard } from './pages/Dashboard';
import { Funding } from './pages/Funding';
import { Admin } from './pages/Admin';
import { DiagnosticsUsers } from './pages/DiagnosticsUsers';
import { DiagnosticsUserDetail } from './pages/DiagnosticsUserDetail';
import { Lineups } from './pages/Lineups';
import { Trends } from './pages/Trends';
import { ViewDiscovered } from './pages/ViewDiscovered';
import { CreateContestType } from './pages/CreateContestType';
import StagingCleanup from './pages/StagingCleanup';
import { AlertCenter } from './pages/AlertCenter';
import { ContestPoolDiagnostics } from './pages/ContestPoolDiagnostics';
import { ContestControlTower } from './pages/ContestControlTower';
import ContestOpsDetailPage from './pages/ContestOpsDetailPage';
import { SystemInvariantMonitor } from './pages/SystemInvariantMonitor';
import { AdminControlRoomPage } from './pages/admin/AdminControlRoomPage';
import { PlatformHealthPage } from './pages/admin/platform-health/PlatformHealthPage';
import { ContestOpsPage } from './pages/admin/contest-ops/ContestOpsPage';
import { PlayerDataPage } from './pages/admin/player-data/PlayerDataPage';
import { UserOpsPage } from './pages/admin/user-ops/UserOpsPage';
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
            <Route path="admin" element={<AdminControlRoomPage />} />
            <Route path="admin/platform-health" element={<PlatformHealthPage />} />
            <Route path="admin/contest-ops" element={<ContestOpsPage />} />
            <Route path="admin/player-data" element={<PlayerDataPage />} />
            <Route path="admin/user-ops" element={<UserOpsPage />} />
            <Route path="alerts" element={<AlertCenter />} />
            <Route path="users" element={<Users />} />
            <Route path="users/wallet-ledger" element={<UserWalletLedger />} />
            <Route path="diagnostics/users" element={<DiagnosticsUsers />} />
            <Route path="diagnostics/users/:userId" element={<DiagnosticsUserDetail />} />
            <Route path="diagnostics/contest-pools" element={<ContestPoolDiagnostics />} />
            <Route path="lineups" element={<Lineups />} />
            <Route path="trends" element={<Trends />} />
            <Route path="discovery" element={<ViewDiscovered />} />
            <Route path="contest-ops" element={<ContestControlTower />} />
            <Route path="contest-ops/:contestId" element={<ContestOpsDetailPage />} />
            <Route path="create-contest-type" element={<CreateContestType />} />
            <Route path="staging-cleanup" element={<StagingCleanup />} />
            <Route path="system-invariants" element={<SystemInvariantMonitor />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
