/**
 * Admin Control Room Landing Page
 *
 * Central hub for platform operations.
 * Displays global system status + 4 tower navigation tiles.
 */

import { Link } from 'react-router-dom';
import { SystemStatusBanner } from '../../components/admin/SystemStatusBanner';

interface TowerTile {
  title: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  color: string;
}

const towers: TowerTile[] = [
  {
    title: 'Platform Health',
    description: 'Infrastructure & worker health',
    path: '/admin/platform-health',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-green-50 to-green-100 border-green-200 text-green-700 hover:from-green-100 hover:to-green-200',
  },
  {
    title: 'Contest Ops',
    description: 'Contest lifecycle monitoring',
    path: '/admin/contest-ops',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4-4m-4 4l4 4" />
      </svg>
    ),
    color: 'from-blue-50 to-blue-100 border-blue-200 text-blue-700 hover:from-blue-100 hover:to-blue-200',
  },
  {
    title: 'Player Data',
    description: 'Ingestion & scoring pipeline',
    path: '/admin/player-data',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m0 0a2 2 0 002 2h12a2 2 0 002-2m-6-10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    color: 'from-purple-50 to-purple-100 border-purple-200 text-purple-700 hover:from-purple-100 hover:to-purple-200',
  },
  {
    title: 'User Ops',
    description: 'Users, wallets & participation',
    path: '/admin/user-ops',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: 'from-amber-50 to-amber-100 border-amber-200 text-amber-700 hover:from-amber-100 hover:to-amber-200',
  },
];

export function AdminControlRoomPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Control Room</h1>
        <p className="mt-2 text-lg text-gray-600">
          Central platform operations dashboard. Select a tower below to begin.
        </p>
      </div>

      {/* Global System Status Banner */}
      <SystemStatusBanner />

      {/* Tower Navigation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
        {towers.map((tower) => (
          <Link
            key={tower.path}
            to={tower.path}
            className={`group relative overflow-hidden rounded-lg border-2 p-6 transition-all duration-200 hover:shadow-lg active:scale-95 bg-gradient-to-br ${tower.color}`}
          >
            {/* Decorative background pattern */}
            <div className="absolute -right-8 -top-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" />
              </svg>
            </div>

            {/* Content */}
            <div className="relative z-10">
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-shrink-0 opacity-75 group-hover:opacity-100 transition-opacity">
                  {tower.icon}
                </div>
                <h2 className="text-2xl font-bold">{tower.title}</h2>
              </div>

              <p className="text-sm font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                {tower.description}
              </p>

              {/* Arrow indicator */}
              <div className="mt-4 flex items-center text-sm font-semibold opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                <span>Open tower</span>
                <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick info footer */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          <strong>Tip:</strong> Each tower automatically refreshes every 10 seconds. Use these operational dashboards to monitor and diagnose platform health in real time.
        </p>
      </div>
    </div>
  );
}
