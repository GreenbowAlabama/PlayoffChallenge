import { FinancialHealthPanel } from '../components/FinancialHealthPanel';

export function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600">
          Overview of contest status and system health
        </p>
      </div>

      <FinancialHealthPanel />
    </div>
  );
}
