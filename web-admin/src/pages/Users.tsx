import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsers, updateUserEligibility } from '../api/users';
import { Switch } from '@headlessui/react';
import type { User } from '../types';

export function Users() {
  const queryClient = useQueryClient();
  const [mutatingUserId, setMutatingUserId] = useState<string | null>(null);
  const [successUserId, setSuccessUserId] = useState<string | null>(null);
  const [copiedEmailId, setCopiedEmailId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const clearSuccess = useCallback(() => {
    setSuccessUserId(null);
  }, []);

  useEffect(() => {
    if (successUserId) {
      const timer = setTimeout(clearSuccess, 1500);
      return () => clearTimeout(timer);
    }
  }, [successUserId, clearSuccess]);

  const copyEmailToClipboard = useCallback(async (email: string, userId: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmailId(userId);
      setTimeout(() => setCopiedEmailId(null), 1500);
    } catch (err) {
      console.error('Failed to copy email:', err);
    }
  }, []);

  const copyAllEmails = useCallback(async (userList: User[]) => {
    const emails = userList
      .map((user) => user.email)
      .filter((email): email is string => Boolean(email));

    if (emails.length === 0) return;

    try {
      await navigator.clipboard.writeText(emails.join(', '));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch (err) {
      console.error('Failed to copy emails:', err);
    }
  }, []);

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, isPaid }: { userId: string; isPaid: boolean }) =>
      updateUserEligibility(userId, isPaid),
    onMutate: async ({ userId, isPaid }) => {
      setMutatingUserId(userId);
      await queryClient.cancelQueries({ queryKey: ['users'] });

      const previousUsers = queryClient.getQueryData<User[]>(['users']);

      queryClient.setQueryData<User[]>(['users'], (old) =>
        old?.map((user) =>
          user.id === userId ? { ...user, paid: isPaid } : user
        )
      );

      return { previousUsers };
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData<User[]>(['users'], (old) =>
        old?.map((user) =>
          user.id === updatedUser.id
            ? { ...user, ...updatedUser }
            : user
        )
      );
      setSuccessUserId(updatedUser.id);
      setMutatingUserId(null);
    },
    onError: (_err, _variables, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
      setMutatingUserId(null);
    },
  });

  const handleToggleEligibility = (userId: string, currentStatus: boolean) => {
    updateMutation.mutate({ userId, isPaid: !currentStatus });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-600">Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4">
        <p className="text-sm text-red-800">
          Failed to load users: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Users</h1>
          <p className="mt-2 text-sm text-gray-700">
            View registered users and manage payment eligibility
          </p>
        </div>
      </div>

      <div className="mt-8 flow-root">
        <div className="relative">
          {/* Scroll hint gradient - mobile only */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none z-10 sm:hidden" aria-hidden="true" />
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                    Username
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    <div className="flex items-center gap-2">
                      Email
                      <button
                        type="button"
                        onClick={() => users && copyAllEmails(users)}
                        className="inline-flex items-center gap-1 text-xs font-normal text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 rounded px-1.5 py-0.5 transition-colors"
                        title="Copy all emails"
                      >
                        {copiedAll ? (
                          <>
                            <svg className="h-3.5 w-3.5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span className="text-green-600">Copied</span>
                          </>
                        ) : (
                          <>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <span>Copy all</span>
                          </>
                        )}
                      </button>
                    </div>
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Name
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Phone
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Role
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Created
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Payment Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users?.map((user) => {
                  const isMutating = mutatingUserId === user.id;
                  const showSuccess = successUserId === user.id;

                  return (
                    <tr key={user.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                        {user.username || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1.5 group">
                          <span>{user.email || 'N/A'}</span>
                          {user.email && (
                            <button
                              type="button"
                              onClick={() => copyEmailToClipboard(user.email!, user.id)}
                              className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-indigo-500 transition-opacity"
                              title="Copy email"
                              aria-label={`Copy ${user.email}`}
                            >
                              {copiedEmailId === user.id ? (
                                <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              ) : (
                                <svg className="h-4 w-4 text-gray-400 hover:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {user.name || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {user.phone || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                            user.is_admin
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {user.is_admin ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {user.created_at
                          ? new Date(user.created_at).toLocaleDateString()
                          : 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs transition-all ${
                              user.paid
                                ? 'text-gray-300 font-normal'
                                : 'text-red-600 font-semibold'
                            }`}
                          >
                            Unpaid
                          </span>
                          <Switch
                            checked={user.paid}
                            onChange={() => handleToggleEligibility(user.id, user.paid)}
                            disabled={isMutating}
                            className={`${
                              user.paid ? 'bg-green-600' : 'bg-gray-400'
                            } ${
                              isMutating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                            } relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                              user.paid ? 'focus:ring-green-500' : 'focus:ring-gray-400'
                            }`}
                          >
                            <span className="sr-only">Toggle payment status</span>
                            <span
                              className={`${
                                user.paid ? 'translate-x-5' : 'translate-x-0.5'
                              } inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform`}
                            />
                          </Switch>
                          <span
                            className={`text-xs transition-all ${
                              user.paid
                                ? 'text-green-600 font-semibold'
                                : 'text-gray-300 font-normal'
                            }`}
                          >
                            Paid
                          </span>
                          {showSuccess && (
                            <span className="text-green-600 text-sm">
                              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                          {isMutating && (
                            <span className="text-gray-400 text-sm">
                              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {users?.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-gray-500">No users found</p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
