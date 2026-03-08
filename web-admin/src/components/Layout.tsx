import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useState } from 'react';
import { logout } from '../api/auth';
import { usePlatformHealth } from '../hooks/usePlatformHealth';
import { getHealthDisplay } from '../api/platform-health';

interface NavGroup {
  label: string;
  items: Array<{ label: string; path: string }>;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const { status, health } = usePlatformHealth();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;
  const isGroupActive = (items: Array<{ label: string; path: string }>) =>
    items.some(item => location.pathname === item.path);

  const navGroups: Record<string, NavGroup> = {
    operations: {
      label: 'Operations',
      items: [
        { label: 'Contest Ops', path: '/contest-ops' },
        { label: 'Discovery', path: '/discovery' },
        { label: 'Trends', path: '/trends' },
      ],
    },
    finance: {
      label: 'Finance',
      items: [
        { label: 'Funding', path: '/funding' },
        { label: 'Wallet Ledger', path: '/users/wallet-ledger' },
      ],
    },
    platform: {
      label: 'Platform',
      items: [
        { label: 'System Health', path: '/system-invariants' },
        { label: 'Admin', path: '/admin' },
        { label: 'New Type', path: '/create-contest-type' },
      ],
    },
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-40 bg-white shadow-sm border-b border-gray-200 overflow-visible">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 overflow-visible">
          <div className="flex h-16 justify-between items-center overflow-visible">
            <div className="flex min-w-0 flex-1 items-center">
              <div className="flex flex-shrink-0 items-center gap-3">
                {/* Global Status Light - Real-time from /api/admin/platform-health */}
                <div className="relative group cursor-pointer">
                  {health && (() => {
                    const display = getHealthDisplay(status);
                    return (
                      <div
                        className="flex items-center gap-2 px-3 py-1 rounded-full transition-all hover:shadow-sm"
                        style={{ backgroundColor: display.bgColor }}
                      >
                        <div className="relative w-3 h-3">
                          <div
                            className="absolute inset-0 rounded-full animate-pulse"
                            style={{ backgroundColor: display.color }}
                          ></div>
                          <div
                            className="absolute inset-0 rounded-full"
                            style={{ backgroundColor: display.color }}
                          ></div>
                        </div>
                        <span
                          className="text-xs font-medium whitespace-nowrap"
                          style={{ color: display.color }}
                        >
                          {display.label}
                        </span>
                      </div>
                    );
                  })()}
                  {/* Tooltip with service breakdown */}
                  {health && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-3 py-2 whitespace-nowrap z-50 w-max">
                      <div className="font-semibold mb-1">{getHealthDisplay(status).label}</div>
                      <div className="space-y-0.5 text-gray-300">
                        <div>Database: {health.services.database}</div>
                        <div>APIs: {health.services.externalApis}</div>
                        <div>Workers: {health.services.workers}</div>
                        <div>Lifecycle: {health.services.contestLifecycle}</div>
                        <div>Invariants: {health.services.invariants}</div>
                      </div>
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                    </div>
                  )}
                </div>

                <div className="h-6 border-l border-gray-300"></div>

                <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
                  Playoff Challenge Admin
                </h1>
              </div>
              <div className="ml-4 flex space-x-0 sm:ml-6">
                {/* Dashboard */}
                <Link
                  to="/dashboard"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-3 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/dashboard')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Dashboard
                </Link>

                {/* Dropdown Groups */}
                {Object.entries(navGroups).map(([key, group]) => (
                  <div key={key} className="relative group">
                    <button
                      onClick={() => setOpenDropdown(openDropdown === key ? null : key)}
                      className={`inline-flex flex-shrink-0 items-center border-b-2 px-3 pt-1 text-sm font-medium whitespace-nowrap transition-all ${
                        isGroupActive(group.items)
                          ? 'border-indigo-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      {group.label}
                      <svg
                        className={`ml-1 h-4 w-4 transition-transform ${
                          openDropdown === key ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 14l-7 7m0 0l-7-7m7 7V3"
                        />
                      </svg>
                    </button>

                    {/* Dropdown Menu */}
                    {openDropdown === key && (
                      <div className="absolute left-0 mt-0 w-48 bg-white shadow-lg rounded-b-lg border border-gray-200 border-t-0 z-50">
                        {group.items.map(item => (
                          <Link
                            key={item.path}
                            to={item.path}
                            className={`block px-4 py-2 text-sm hover:bg-gray-100 ${
                              isActive(item.path)
                                ? 'bg-indigo-50 text-indigo-700 font-medium'
                                : 'text-gray-700'
                            }`}
                            onClick={() => setOpenDropdown(null)}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Users */}
                <Link
                  to="/users"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-3 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/users')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Users
                </Link>
              </div>
            </div>
            <div className="flex items-center">
              <button
                onClick={handleLogout}
                className="ml-3 inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
