import React, { useState } from 'react';
import { bulkImportAddresses } from '../utils/aoHelpers';

export const AdminBulkUnlock: React.FC = () => {
    const [addresses, setAddresses] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<{ successful: number; failed: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleUnlock = async () => {
        try {
            setIsLoading(true);
            setError(null);
            setResult(null);

            // Split by newlines and clean up each address
            const addressList = addresses
                .split(/\r?\n/)
                .map(addr => addr.trim())
                .filter(addr => addr.length > 0);

            if (addressList.length === 0) {
                setError('Please enter at least one address');
                return;
            }

            // Create JSON data
            const jsonData = {
                function: "add_addresses",
                addresses: addressList
            };

            const result = await bulkImportAddresses(jsonData);
            setResult(result);
            setAddresses(''); // Clear the input on success
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to unlock addresses');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="admin-bulk-unlock">
            <h3>Bulk Unlock Addresses</h3>
            <div className="unlock-instructions">
                <p>Paste Arweave addresses (one per line) to grant skin changing ability</p>
                <p className="text-sm text-gray-500">Example format:<br/>
                dUqCbSIdkxxSuIhq8ohcQMwI-oq-CPX1Ey6qUnam0jc<br/>
                V4XAxkILMSopedTbzS9aG7PUBESljte11vebh45Ccyo</p>
            </div>
            <textarea
                value={addresses}
                onChange={(e) => setAddresses(e.target.value)}
                placeholder="Enter addresses here, one per line..."
                rows={10}
                className="unlock-textarea"
                disabled={isLoading}
            />
            {error && (
                <div className="unlock-error">
                    {error}
                </div>
            )}
            {result && (
                <div className="unlock-success">
                    Successfully unlocked {result.successful} addresses
                    {result.failed > 0 && ` (${result.failed} addresses failed)`}
                </div>
            )}
            <button
                onClick={handleUnlock}
                disabled={isLoading || !addresses.trim()}
                className="unlock-button"
            >
                {isLoading ? 'Processing...' : 'Unlock Addresses'}
            </button>
            <style jsx>{`
                .admin-bulk-unlock {
                    padding: 20px;
                    max-width: 600px;
                }
                .unlock-instructions {
                    margin-bottom: 10px;
                }
                .unlock-textarea {
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-family: monospace;
                }
                .unlock-error {
                    color: #dc3545;
                    margin-bottom: 10px;
                    padding: 10px;
                    background-color: #fce8e8;
                    border-radius: 4px;
                }
                .unlock-success {
                    color: #28a745;
                    margin-bottom: 10px;
                    padding: 10px;
                    background-color: #e8f5e9;
                    border-radius: 4px;
                }
                .unlock-button {
                    padding: 8px 16px;
                    background-color: #007bff;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .unlock-button:disabled {
                    background-color: #ccc;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
};
