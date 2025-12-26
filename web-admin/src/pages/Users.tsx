import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsers, updateUserEligibility } from '../api/users';
import { Switch } from '@headlessui/react';
import type { User } from '../types';

export function Users() {
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, isPaid }: { userId: string; isPaid: boolean }) =>
      updateUserEligibility(userId, isPaid),
    onMutate: async ({ userId, isPaid }) => {
      await queryClient.cancelQueries({ queryKey: ['users'] });

      const previousUsers = queryClient.getQueryData<User[]>(['users']);

      queryClient.setQueryData<User[]>(['users'], (old) =>
        old?.map((user) =>
          user.id === userId ? { ...user, is_paid: isPaid } : user
        )
      );

      return { previousUsers };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
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
            Manage user eligibility for the Playoff Challenge
          </p>
        </div>
      </div>

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                    User ID
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Email
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Phone
                  </th>
                  <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Eligibility
                  </th>
                  <th className="relative py-3.5 pl-3 pr-4 sm:pr-0">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users?.map((user) => (
                  <tr key={user.id}>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                      {user.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {user.email || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {user.phone || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                          user.is_paid
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {user.is_paid ? 'Eligible' : 'Ineligible'}
                      </span>
                    </td>
                    <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-0">
                      <Switch
                        checked={user.is_paid}
                        onChange={() => handleToggleEligibility(user.id, user.is_paid)}
                        className={`${
                          user.is_paid ? 'bg-green-600' : 'bg-gray-200'
                        } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2`}
                      >
                        <span className="sr-only">Toggle eligibility</span>
                        <span
                          className={`${
                            user.is_paid ? 'translate-x-6' : 'translate-x-1'
                          } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                        />
                      </Switch>
                    </td>
                  </tr>
                ))}
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
  );
}
