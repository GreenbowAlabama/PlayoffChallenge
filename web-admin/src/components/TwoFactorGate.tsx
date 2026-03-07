/**
 * Two-Factor Authentication Gate — Sensitive Operations
 *
 * Modal that requires email verification before allowing sensitive admin operations.
 * Operations include: wallet credit, contest settlement, error recovery, etc.
 */

import { useState } from 'react';

interface TwoFactorGateProps {
  action: 'CREDIT' | 'SETTLE' | 'RECOVER' | 'CANCEL' | 'FORCE_LOCK' | 'UNLOCK' | 'FORCE_LIVE';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

export function TwoFactorGate({
  action,
  onConfirm,
  onCancel,
  isLoading
}: TwoFactorGateProps) {
  const [verificationState, setVerificationState] = useState<'request' | 'verify'>('request');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSendingCode, setIsSendingCode] = useState(false);

  const actionLabels: Record<typeof action, string> = {
    CREDIT: 'Credit Wallet',
    SETTLE: 'Settle Contest',
    RECOVER: 'Recover Error',
    CANCEL: 'Cancel Contest',
    FORCE_LOCK: 'Force Lock',
    UNLOCK: 'Unlock Contest',
    FORCE_LIVE: 'Force Live'
  };

  const actionDescriptions: Record<typeof action, string> = {
    CREDIT: 'Issue a wallet credit to a user',
    SETTLE: 'Manually trigger contest settlement',
    RECOVER: 'Recover a contest from ERROR state',
    CANCEL: 'Cancel a contest',
    FORCE_LOCK: 'Manually lock a contest',
    UNLOCK: 'Unlock a previously locked contest',
    FORCE_LIVE: 'Manually transition contest to LIVE'
  };

  const handleRequestCode = async () => {
    setIsSendingCode(true);
    setError(null);

    try {
      // TODO: Call backend to send verification code
      // const response = await apiRequest('/api/admin/auth/send-verification', {
      //   method: 'POST',
      //   body: JSON.stringify({ action })
      // });

      // For MVP: Simulate sending code
      console.log(`[MVP] Verification code would be sent for ${action}`);
      setVerificationState('verify');
    } catch (err) {
      setError(`Failed to send verification code: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    setError(null);

    if (code.length !== 6) {
      setError('Verification code must be 6 digits');
      return;
    }

    try {
      // TODO: Call backend to verify code
      // const response = await apiRequest('/api/admin/auth/verify-code', {
      //   method: 'POST',
      //   body: JSON.stringify({ code, action })
      // });

      // For MVP: Simulate code verification
      console.log(`[MVP] Code verified for ${action}: ${code}`);
      onConfirm();
    } catch (err) {
      setError(`Verification failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Verify {actionLabels[action]}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {actionDescriptions[action]}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {verificationState === 'request' ? (
            <div className="space-y-4">
              <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded">
                <p className="text-sm text-blue-900">
                  A verification code will be sent to your admin email address. Check your inbox and enter the code to confirm this action.
                </p>
              </div>

              <button
                onClick={handleRequestCode}
                disabled={isSendingCode}
                className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isSendingCode ? 'Sending Code...' : 'Send Verification Code'}
              </button>

              <button
                onClick={onCancel}
                className="w-full px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                  Verification Code
                </label>
                <input
                  id="code"
                  type="text"
                  placeholder="000000"
                  value={code}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(val);
                  }}
                  maxLength={6}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-center text-2xl tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-600 mt-1">
                  Check your email for a 6-digit code
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <button
                  onClick={handleVerifyCode}
                  disabled={isLoading || code.length !== 6}
                  className="w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? 'Confirming...' : 'Confirm'}
                </button>

                <button
                  onClick={() => setVerificationState('request')}
                  disabled={isLoading}
                  className="w-full px-4 py-2 text-blue-600 font-medium hover:text-blue-700 disabled:text-gray-400 transition-colors"
                >
                  Resend Code
                </button>

                <button
                  onClick={onCancel}
                  disabled={isLoading}
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
