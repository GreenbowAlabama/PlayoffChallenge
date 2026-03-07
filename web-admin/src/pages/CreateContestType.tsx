import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { createTemplate, type CreateTemplateRequest } from '../api/templates';
import { ConfirmationModal } from '../components/ConfirmationModal';

const SPORTS = ['PGA', 'NFL', 'NBA', 'NHL', 'MLB'];
const TEMPLATE_TYPES = ['STROKE_PLAY', 'TOURNAMENT', 'SEASONAL'];
const SCORING_STRATEGIES = ['pga_standard', 'nfl_playoffs', 'custom'];
const LOCK_STRATEGIES = ['tournament_start', 'custom_time'];
const SETTLEMENT_STRATEGIES = ['payouts_after_complete', 'daily_settlements'];
const PAYOUT_STRUCTURES = ['winner_takes_all', 'tiered_payouts', 'prize_pool'];

export function CreateContestType() {
  const [formData, setFormData] = useState<CreateTemplateRequest>({
    name: '',
    sport: 'PGA',
    template_type: 'STROKE_PLAY',
    scoring_strategy_key: 'pga_standard',
    lock_strategy_key: 'tournament_start',
    settlement_strategy_key: 'payouts_after_complete',
    default_entry_fee_cents: 1000,
    allowed_entry_fee_min_cents: 500,
    allowed_entry_fee_max_cents: 5000,
    allowed_payout_structures: ['winner_takes_all'],
    lineup_size: 6,
    drop_lowest: false,
    scoring_format: 'strokes'
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (data: CreateTemplateRequest) => createTemplate(data),
    onSuccess: (result) => {
      alert(`✓ Contest type created: ${result.templateId}`);
      // Reset form
      setFormData({
        name: '',
        sport: 'PGA',
        template_type: 'STROKE_PLAY',
        scoring_strategy_key: 'pga_standard',
        lock_strategy_key: 'tournament_start',
        settlement_strategy_key: 'payouts_after_complete',
        default_entry_fee_cents: 1000,
        allowed_entry_fee_min_cents: 500,
        allowed_entry_fee_max_cents: 5000,
        allowed_payout_structures: ['winner_takes_all'],
        lineup_size: 6,
        drop_lowest: false,
        scoring_format: 'strokes'
      });
      setConfirmOpen(false);
    },
    onError: (err) => {
      alert(`✗ Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name) newErrors.name = 'Name is required';
    if (!formData.sport) newErrors.sport = 'Sport is required';
    if (formData.default_entry_fee_cents <= 0) newErrors.default_entry_fee_cents = 'Must be > 0';
    if (formData.allowed_entry_fee_min_cents > formData.allowed_entry_fee_max_cents) {
      newErrors.allowed_entry_fee_min_cents = 'Min must be ≤ Max';
    }
    if (formData.allowed_payout_structures.length === 0) {
      newErrors.allowed_payout_structures = 'Select at least one payout structure';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validate()) {
      setConfirmOpen(true);
    }
  };

  const handleConfirm = () => {
    mutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Create Contest Type</h1>
        <p className="mt-1 text-sm text-gray-600">
          Define a new contest template type for your platform
        </p>
      </div>

      {/* Form */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
          <h2 className="text-lg font-medium text-gray-900">Template Details</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Row 1: Name */}
          <div>
            <label className="block text-sm font-medium text-gray-900">Template Name*</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., PGA 2026 Regular Season"
              className={`mt-2 w-full rounded-md border ${
                errors.name ? 'border-red-500' : 'border-gray-300'
              } px-3 py-2 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
            {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
          </div>

          {/* Row 2: Sport, Template Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900">Sport*</label>
              <select
                value={formData.sport}
                onChange={(e) => setFormData({ ...formData, sport: e.target.value })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SPORTS.map(sport => (
                  <option key={sport} value={sport}>{sport}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900">Template Type*</label>
              <select
                value={formData.template_type}
                onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {TEMPLATE_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Strategies */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900">Scoring Strategy*</label>
              <select
                value={formData.scoring_strategy_key}
                onChange={(e) => setFormData({ ...formData, scoring_strategy_key: e.target.value })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SCORING_STRATEGIES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900">Lock Strategy*</label>
              <select
                value={formData.lock_strategy_key}
                onChange={(e) => setFormData({ ...formData, lock_strategy_key: e.target.value })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {LOCK_STRATEGIES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900">Settlement Strategy*</label>
              <select
                value={formData.settlement_strategy_key}
                onChange={(e) => setFormData({ ...formData, settlement_strategy_key: e.target.value })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {SETTLEMENT_STRATEGIES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Entry Fee */}
          <div>
            <label className="block text-sm font-medium text-gray-900">Entry Fee Range (cents)*</label>
            <div className="grid grid-cols-3 gap-4 mt-2">
              <div>
                <label className="text-xs text-gray-600">Min</label>
                <input
                  type="number"
                  value={formData.allowed_entry_fee_min_cents}
                  onChange={(e) => setFormData({ ...formData, allowed_entry_fee_min_cents: parseInt(e.target.value, 10) })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Default</label>
                <input
                  type="number"
                  value={formData.default_entry_fee_cents}
                  onChange={(e) => setFormData({ ...formData, default_entry_fee_cents: parseInt(e.target.value, 10) })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Max</label>
                <input
                  type="number"
                  value={formData.allowed_entry_fee_max_cents}
                  onChange={(e) => setFormData({ ...formData, allowed_entry_fee_max_cents: parseInt(e.target.value, 10) })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
                />
              </div>
            </div>
            {errors.allowed_entry_fee_min_cents && (
              <p className="mt-1 text-sm text-red-600">{errors.allowed_entry_fee_min_cents}</p>
            )}
          </div>

          {/* Row 5: Payout Structures */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">Allowed Payout Structures*</label>
            <div className="space-y-2">
              {PAYOUT_STRUCTURES.map(payout => (
                <label key={payout} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.allowed_payout_structures.includes(payout)}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...formData.allowed_payout_structures, payout]
                        : formData.allowed_payout_structures.filter(p => p !== payout);
                      setFormData({ ...formData, allowed_payout_structures: updated });
                    }}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{payout}</span>
                </label>
              ))}
            </div>
            {errors.allowed_payout_structures && (
              <p className="mt-1 text-sm text-red-600">{errors.allowed_payout_structures}</p>
            )}
          </div>

          {/* Row 6: Optional Fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900">Lineup Size</label>
              <input
                type="number"
                value={formData.lineup_size || ''}
                onChange={(e) => setFormData({ ...formData, lineup_size: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900">Scoring Format</label>
              <input
                type="text"
                value={formData.scoring_format || ''}
                onChange={(e) => setFormData({ ...formData, scoring_format: e.target.value || undefined })}
                placeholder="e.g., strokes, points"
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.drop_lowest || false}
                  onChange={(e) => setFormData({ ...formData, drop_lowest: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">Drop Lowest Score</span>
              </label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex gap-2 justify-end">
          <button
            onClick={() => setFormData({
              name: '',
              sport: 'PGA',
              template_type: 'STROKE_PLAY',
              scoring_strategy_key: 'pga_standard',
              lock_strategy_key: 'tournament_start',
              settlement_strategy_key: 'payouts_after_complete',
              default_entry_fee_cents: 1000,
              allowed_entry_fee_min_cents: 500,
              allowed_entry_fee_max_cents: 5000,
              allowed_payout_structures: ['winner_takes_all'],
              lineup_size: 6,
              drop_lowest: false,
              scoring_format: 'strokes'
            })}
            className="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300"
          >
            Reset
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create Template'}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="Create Contest Type"
        description={`Create template "${formData.name}" for ${formData.sport} contests?`}
        confirmText="Create"
        confirmationPhrase="CREATE TEMPLATE"
        isLoading={mutation.isPending}
      />
    </div>
  );
}
