/**
 * Reusable Admin Panel Component
 *
 * Standardizes panel styling across all towers.
 * Includes title, tooltip, and children rendering.
 */

import type { ReactNode } from 'react';
import { InfoTooltip } from '../InfoTooltip';

interface AdminPanelProps {
  title: string;
  tooltip?: string;
  children: ReactNode;
  className?: string;
  alert?: {
    type: 'warning' | 'error' | 'info';
    message: string;
  };
}

export function AdminPanel({ title, tooltip, children, className = '', alert }: AdminPanelProps) {
  const alertColors = {
    warning: 'border-amber-200 bg-amber-50',
    error: 'border-red-200 bg-red-50',
    info: 'border-blue-200 bg-blue-50',
  };

  const alertTextColors = {
    warning: 'text-amber-700',
    error: 'text-red-700',
    info: 'text-blue-700',
  };

  const alertIconColor = {
    warning: 'text-amber-600',
    error: 'text-red-600',
    info: 'text-blue-600',
  };

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}>
      {/* Panel Header */}
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>

      {/* Alert Banner (if present) */}
      {alert && (
        <div className={`rounded-md border p-3 mb-4 ${alertColors[alert.type]}`}>
          <div className="flex items-start gap-2">
            {alert.type === 'warning' && (
              <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${alertIconColor.warning}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            )}
            {alert.type === 'error' && (
              <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${alertIconColor.error}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            )}
            {alert.type === 'info' && (
              <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${alertIconColor.info}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            )}
            <p className={`text-sm font-medium ${alertTextColors[alert.type]}`}>{alert.message}</p>
          </div>
        </div>
      )}

      {/* Panel Content */}
      {children}
    </div>
  );
}
