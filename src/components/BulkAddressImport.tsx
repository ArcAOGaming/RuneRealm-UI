import React, { useState } from 'react';
import { parseAddressCSV, validateAddresses } from '../utils/addressImportHelper';

interface BulkAddressImportProps {
    onImport: (addresses: string[]) => Promise<void>;
}

export const BulkAddressImport: React.FC<BulkAddressImportProps> = ({ onImport }) => {
    const [csvContent, setCsvContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [importStats, setImportStats] = useState<{
        valid: number;
        invalid: number;
    } | null>(null);

    const handleImport = async () => {
        try {
            setIsLoading(true);
            setError(null);
            setImportStats(null);

            const parsedAddresses = parseAddressCSV(csvContent);
            const { valid, invalid } = validateAddresses(parsedAddresses);

            if (valid.length === 0) {
                setError('No valid addresses found in the input');
                return;
            }

            await onImport(valid.map(v => v.address));
            setImportStats({
                valid: valid.length,
                invalid: invalid.length
            });
            setCsvContent('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to import addresses');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bulk-address-import">
            <h3>Bulk Import Addresses</h3>
            <div className="import-instructions">
                <p>Paste one Ethereum address per line (CSV format)</p>
            </div>
            <textarea
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder="0x123...&#10;0x456...&#10;0x789..."
                rows={10}
                className="import-textarea"
                disabled={isLoading}
            />
            {error && (
                <div className="import-error">
                    {error}
                </div>
            )}
            {importStats && (
                <div className="import-stats">
                    Successfully imported {importStats.valid} addresses
                    {importStats.invalid > 0 && ` (${importStats.invalid} invalid addresses skipped)`}
                </div>
            )}
            <button
                onClick={handleImport}
                disabled={isLoading || !csvContent.trim()}
                className="import-button"
            >
                {isLoading ? 'Importing...' : 'Import Addresses'}
            </button>
            <style jsx>{`
                .bulk-address-import {
                    padding: 20px;
                    max-width: 600px;
                }
                .import-instructions {
                    margin-bottom: 10px;
                }
                .import-textarea {
                    width: 100%;
                    padding: 10px;
                    margin-bottom: 10px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                }
                .import-error {
                    color: #dc3545;
                    margin-bottom: 10px;
                }
                .import-stats {
                    color: #28a745;
                    margin-bottom: 10px;
                }
                .import-button {
                    padding: 8px 16px;
                    background-color: #007bff;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .import-button:disabled {
                    background-color: #ccc;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
};
