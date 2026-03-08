import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { logout } from '../api/auth';

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;
  const isActivePrefix = (prefix: string) => location.pathname.startsWith(prefix);

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex min-w-0 flex-1">
              <div className="flex flex-shrink-0 items-center">
                <h1 className="text-lg font-bold text-gray-900 sm:text-xl">
                  Playoff Challenge Admin
                </h1>
              </div>
              <div className="ml-4 flex space-x-4 overflow-x-auto sm:ml-6 sm:space-x-8">
                {/* OBSERVATIONAL & ANALYTICS */}
                <Link
                  to="/dashboard"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/dashboard')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Dashboard
                </Link>
                <Link
                  to="/funding"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/funding')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Funding
                </Link>
                <Link
                  to="/lineups"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/lineups')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Lineups
                </Link>
                <Link
                  to="/trends"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/trends')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Trends
                </Link>

                {/* Divider */}
                <div className="border-l border-gray-300"></div>

                {/* USER & FINANCIAL MANAGEMENT */}
                <Link
                  to="/users"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/users')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Users
                </Link>
                <Link
                  to="/users/wallet-ledger"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/users/wallet-ledger')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Wallet Ledger
                </Link>

                {/* Divider */}
                <div className="border-l border-gray-300"></div>

                {/* SYSTEM OPERATIONS */}
                <Link
                  to="/discovery"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/discovery')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  Discovery
                </Link>
                <Link
                  to="/system-invariants"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/system-invariants')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  System Health
                </Link>
                <Link
                  to="/create-contest-type"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/create-contest-type')
                      ? 'border-indigo-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  New Type
                </Link>
                <Link
                  to="/admin"
                  className={`inline-flex flex-shrink-0 items-center border-b-2 px-1 pt-1 text-sm font-medium whitespace-nowrap ${
                    isActive('/admin')
                      ? 'border-amber-500 text-amber-900'
                      : 'border-transparent text-amber-600 hover:border-amber-300 hover:text-amber-700'
                  }`}
                >
                  Admin
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

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
