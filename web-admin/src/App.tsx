import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Login } from './pages/Login';
import { Users } from './pages/Users';
import { Dashboard } from './pages/Dashboard';
import { DiagnosticsDashboard } from './pages/DiagnosticsDashboard';
import { DiagnosticsUsers } from './pages/DiagnosticsUsers';
import { DiagnosticsUserDetail } from './pages/DiagnosticsUserDetail';
import { PicksExplorer } from './pages/PicksExplorer';
import { Trends } from './pages/Trends';
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
            <Route path="users" element={<Users />} />
            <Route path="diagnostics" element={<DiagnosticsDashboard />} />
            <Route path="diagnostics/users" element={<DiagnosticsUsers />} />
            <Route path="diagnostics/users/:userId" element={<DiagnosticsUserDetail />} />
            <Route path="picks" element={<PicksExplorer />} />
            <Route path="trends" element={<Trends />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
