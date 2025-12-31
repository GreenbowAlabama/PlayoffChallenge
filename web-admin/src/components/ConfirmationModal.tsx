import { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText: string;
  confirmationPhrase: string;
  itemCount?: number;
  preserveMessage?: string;
  isLoading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  confirmationPhrase,
  itemCount,
  preserveMessage,
  isLoading = false,
}: ConfirmationModalProps) {
  const [inputValue, setInputValue] = useState('');
  const [countdown, setCountdown] = useState(3);

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line
    setInputValue('');
    setCountdown(3);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen]);

  const isButtonDisabled = countdown > 0;
  const isConfirmEnabled = inputValue === confirmationPhrase && !isButtonDisabled && !isLoading;

  const handleConfirm = () => {
    console.log('handleConfirm called', { isConfirmEnabled, inputValue, confirmationPhrase, countdown, isLoading });
    if (isConfirmEnabled) {
      console.log('Calling onConfirm');
      onConfirm();
    }
  };

  return (
    <Dialog open={isOpen} onClose={() => {}}>
      <div className="fixed inset-0 z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-md rounded-lg bg-white p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
              <svg
                className="h-6 w-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              </svg>
            </div>
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              {title}
            </Dialog.Title>
          </div>

          <Dialog.Description className="text-sm text-gray-600 mb-4">
            {description}
          </Dialog.Description>

          {itemCount !== undefined && itemCount >= 0 && (
            <div className="mb-4 rounded-md bg-amber-50 p-3 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">
                {itemCount} item{itemCount !== 1 ? 's' : ''} will be permanently deleted
              </p>
            </div>
          )}

          {preserveMessage && (
            <div className="mb-4 rounded-md bg-green-50 p-3 border border-green-200">
              <p className="text-sm text-green-800">{preserveMessage}</p>
            </div>
          )}

          <div className="mb-4">
            <label
              htmlFor="confirmation"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Type <span className="font-mono font-bold">{confirmationPhrase}</span> to confirm
            </label>
            <input
              id="confirmation"
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder={confirmationPhrase}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isConfirmEnabled}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                'Processing...'
              ) : countdown > 0 ? (
                `Wait ${countdown}s...`
              ) : (
                confirmText
              )}
            </button>
          </div>
          </Dialog.Panel>
        </div>
      </div>
    </Dialog>
  );
}
