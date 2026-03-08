/**
 * Financial Reconciliation Component Tests
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinancialReconciliation from '../FinancialReconciliation';
import * as api from '../../api/financial-reconciliation';

// Mock the API module
jest.mock('../../api/financial-reconciliation');

describe('FinancialReconciliation Component', () => {
  const mockReconciliationData = {
    reconciliation: {
      wallet_liability_cents: 50000,
      contest_pools_cents: 25000,
      deposits_cents: 100000,
      withdrawals_cents: 30000,
      difference_cents: 55000 - 70000 // incoherent
    },
    invariants: {
      negative_wallets: 2,
      illegal_entry_fee_direction: 4,
      illegal_refund_direction: 1,
      orphaned_ledger_entries: 0,
      orphaned_withdrawals: 1,
      negative_contest_pools: 0,
      health_status: 'WARN' as const
    },
    status: {
      is_coherent: false,
      health_status: 'WARN' as const,
      timestamp: new Date().toISOString()
    }
  };

  const mockAuditLog = {
    entries: [
      {
        id: '1',
        admin_id: '12345678-1234-1234-1234-123456789012',
        action_type: 'repair_orphan_withdrawal',
        amount_cents: 0,
        reason: 'User deleted, withdrawal orphaned',
        status: 'completed',
        reference_id: null,
        details: {},
        created_at: new Date().toISOString()
      }
    ],
    count: 1,
    filters: { action_type: null, from_date: null, to_date: null }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (api.getPlatformReconciliation as jest.Mock).mockResolvedValue(mockReconciliationData);
    (api.getFinancialAuditLog as jest.Mock).mockResolvedValue(mockAuditLog);
  });

  describe('Display on Load', () => {
    it('displays reconciliation on load', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText('Financial Control Tower')).toBeInTheDocument();
        expect(screen.getByText(/Wallet Liability/)).toBeInTheDocument();
        expect(screen.getByText(/\$500\.00/)).toBeInTheDocument();
      });
    });

    it('shows invariant check status', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText('Negative Wallets: 2')).toBeInTheDocument();
        expect(screen.getByText('Illegal ENTRY_FEE CREDIT: 4')).toBeInTheDocument();
        expect(screen.getByText('Orphaned Withdrawals: 1')).toBeInTheDocument();
      });
    });

    it('lists repair actions with buttons', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/Repair Orphan Withdrawal/)).toBeInTheDocument();
        expect(screen.getByText(/Convert ENTRY_FEE CREDIT/)).toBeInTheDocument();
        expect(screen.getByText(/Rollback Non-Atomic Join/)).toBeInTheDocument();
        expect(screen.getByText(/Freeze Wallet/)).toBeInTheDocument();
        expect(screen.getByText(/Repair Illegal Refund/)).toBeInTheDocument();
      });
    });

    it('repair button requires confirmation', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        const freezeButton = screen.getByText(/Freeze Wallet/);
        expect(freezeButton).toBeInTheDocument();
      });

      const freezeButton = screen.getByText(/Freeze Wallet/);
      fireEvent.click(freezeButton);

      await waitFor(() => {
        expect(screen.getByText('Freeze Negative Wallet')).toBeInTheDocument();
      });
    });

    it('confirmation dialog requires reason input', async () => {
      const user = userEvent.setup();
      render(<FinancialReconciliation />);

      await waitFor(() => {
        const freezeButton = screen.getByText(/Freeze Wallet/);
        fireEvent.click(freezeButton);
      });

      await waitFor(() => {
        const confirmButton = screen.getByText('Confirm Repair');
        expect(confirmButton).toBeDisabled();
      });

      const reasonInput = screen.getByPlaceholderText(/Explain why/);
      await user.type(reasonInput, 'Test reason');

      await waitFor(() => {
        const confirmButton = screen.getByText('Confirm Repair');
        expect(confirmButton).not.toBeDisabled();
      });
    });

    it('success shows notification', async () => {
      (api.freezeWallet as jest.Mock).mockResolvedValue({
        success: true,
        freeze_id: 'test-freeze-id',
        audit_log_id: 'test-audit-id',
        message: 'User wallet frozen'
      });

      const user = userEvent.setup();
      render(<FinancialReconciliation />);

      await waitFor(() => {
        const freezeButton = screen.getByText(/Freeze Wallet/);
        fireEvent.click(freezeButton);
      });

      const reasonInput = screen.getByPlaceholderText(/Explain why/);
      await user.type(reasonInput, 'Test reason');

      const confirmButton = screen.getByText('Confirm Repair');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/Repair completed successfully/)).toBeInTheDocument();
      });
    });

    it('auto-refreshes every 60 seconds', async () => {
      jest.useFakeTimers();

      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(api.getPlatformReconciliation).toHaveBeenCalledTimes(1);
      });

      jest.advanceTimersByTime(60000);

      await waitFor(() => {
        expect(api.getPlatformReconciliation).toHaveBeenCalledTimes(2);
      });

      jest.useRealTimers();
    });

    it('audit log shows recent actions', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/repair_orphan_withdrawal/)).toBeInTheDocument();
        expect(screen.getByText(/User deleted, withdrawal orphaned/)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('displays error message on failure', async () => {
      (api.getPlatformReconciliation as jest.Mock).mockRejectedValue(new Error('API Error'));

      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/API Error/)).toBeInTheDocument();
      });
    });

    it('handles repair failure gracefully', async () => {
      (api.freezeWallet as jest.Mock).mockRejectedValue(new Error('Repair failed'));

      const user = userEvent.setup();
      render(<FinancialReconciliation />);

      await waitFor(() => {
        const freezeButton = screen.getByText(/Freeze Wallet/);
        fireEvent.click(freezeButton);
      });

      const reasonInput = screen.getByPlaceholderText(/Explain why/);
      await user.type(reasonInput, 'Test reason');

      const confirmButton = screen.getByText('Confirm Repair');
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/Repair failed/)).toBeInTheDocument();
      });
    });
  });

  describe('Coherence Display', () => {
    it('shows incoherent badge when difference > 0', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/⚠️ Incoherent/)).toBeInTheDocument();
      });
    });

    it('shows coherent badge when difference = 0', async () => {
      const coherentData = {
        ...mockReconciliationData,
        reconciliation: {
          ...mockReconciliationData.reconciliation,
          difference_cents: 0
        },
        status: {
          ...mockReconciliationData.status,
          is_coherent: true
        }
      };

      (api.getPlatformReconciliation as jest.Mock).mockResolvedValue(coherentData);

      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/✅ Coherent/)).toBeInTheDocument();
      });
    });
  });

  describe('Repair Action Buttons', () => {
    it('disables repair buttons when no issues found', async () => {
      const noIssuesData = {
        ...mockReconciliationData,
        invariants: {
          ...mockReconciliationData.invariants,
          negative_wallets: 0,
          illegal_entry_fee_direction: 0,
          orphaned_withdrawals: 0,
          illegal_refund_direction: 0
        }
      };

      (api.getPlatformReconciliation as jest.Mock).mockResolvedValue(noIssuesData);

      render(<FinancialReconciliation />);

      await waitFor(() => {
        const freezeButton = screen.getByText(/Freeze Wallet/);
        const convertButton = screen.getByText(/Convert ENTRY_FEE CREDIT/);
        expect(freezeButton).toBeDisabled();
        expect(convertButton).toBeDisabled();
      });
    });

    it('shows count of issues on buttons', async () => {
      render(<FinancialReconciliation />);

      await waitFor(() => {
        expect(screen.getByText(/\(2 found\)/)).toBeInTheDocument(); // negative wallets
        expect(screen.getByText(/\(4 found\)/)).toBeInTheDocument(); // illegal ENTRY_FEE
      });
    });
  });
});
