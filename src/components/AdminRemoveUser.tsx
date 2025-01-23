import React, { useState } from 'react';
import { removeUser } from '../utils/aoHelpers';

interface AdminRemoveUserProps {
  isAdmin?: boolean;
}

const AdminRemoveUser: React.FC<AdminRemoveUserProps> = ({ isAdmin }) => {
  const [userAddress, setUserAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const handleRemoveUser = async () => {
    if (!userAddress) {
      setMessage({ type: 'error', text: 'Please enter a user address' });
      return;
    }

    setLoading(true);
    try {
      const response = await removeUser(userAddress);
      if (response.type === "error") {
        setMessage({ type: 'error', text: response.error });
      } else {
        setMessage({ type: 'success', text: 'User successfully removed' });
        setUserAddress('');
      }
    } catch (error) {
      setMessage({ type: 'error', text: `Failed to remove user: ${(error as Error).message}` });
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="mt-5 p-5 border border-gray-300 rounded-lg">
      <h3 className="text-lg font-semibold mb-4">Admin: Remove User Access</h3>
      <div className="flex gap-4">
        <input
          type="text"
          placeholder="Enter user address"
          value={userAddress}
          onChange={(e) => setUserAddress(e.target.value)}
          className="flex-1 max-w-lg px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          onClick={handleRemoveUser}
          disabled={loading}
          className={`px-4 py-2 rounded-md text-white ${
            loading 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-red-500 hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500'
          }`}
        >
          {loading ? 'Removing...' : 'Remove User'}
        </button>
      </div>
      {message && (
        <div className={`mt-3 p-3 rounded ${
          message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {message.text}
        </div>
      )}
    </div>
  );
};

export default AdminRemoveUser;
