import React, { useState, useEffect } from 'react';
import { getPurchaseOptions, purchaseAccess, TokenOption } from '../utils/aoHelpers';
import { Gateway } from '../constants/Constants';
import { currentTheme } from '../constants/theme';

interface PurchaseAccessProps {
    wallet: any;
    onPurchaseComplete?: () => void;
    darkMode?: boolean;
    isUnlocked?: boolean;
}

const PurchaseAccess: React.FC<PurchaseAccessProps> = ({ wallet, onPurchaseComplete, darkMode = false, isUnlocked = false }) => {
    const [options, setOptions] = useState<TokenOption[]>([]);
    const [selectedToken, setSelectedToken] = useState<TokenOption | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const theme = currentTheme(darkMode);

    useEffect(() => {
        if (!isUnlocked) {
            loadPurchaseOptions();
        }
    }, [isUnlocked]);

    const loadPurchaseOptions = async () => {
        try {
            setLoading(true);
            setError(null);
            const result = await getPurchaseOptions();
            if (result && Array.isArray(result)) {
                setOptions(result);
                if (result.length > 0) {
                    setSelectedToken(result[0]);
                }
            } else {
                setError('Invalid purchase options format');
            }
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Failed to load purchase options');
        } finally {
            setLoading(false);
        }
    };

    const handlePurchase = async () => {
        if (!selectedToken) {
            setError('Please select a token first');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            await purchaseAccess(selectedToken);
            onPurchaseComplete?.();
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Purchase failed');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className={`${theme.text} opacity-90`}>Loading purchase options...</div>;
    }

    if (error) {
        return <div className="text-red-400">{error}</div>;
    }

    if (isUnlocked) {
        return (
            <div className="text-center space-y-4">
                <div className={`text-xl font-medium ${theme.text}`}>
                    Thank you for your purchase!
                </div>
                <div className={`text-lg ${theme.text} opacity-80`}>
                    You now have full access to all features.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Token Selection */}
            <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {options.map((option) => (
                        <button
                            key={option.token}
                            onClick={() => setSelectedToken(option)}
                            className={`p-4 rounded-xl border transition-all duration-300 ${
                                selectedToken?.token === option.token
                                    ? 'border-[#F4860A] bg-[#814E33]/30'
                                    : 'border-[#F4860A]/30 bg-[#814E33]/20 hover:bg-[#814E33]/25'
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                {option.icon && (
                                    <img 
                                        src={`${Gateway}${option.icon}`} 
                                        alt={option.name} 
                                        className="w-8 h-8 rounded-full"
                                    />
                                )}
                                <div className="text-left">
                                    <div className={`font-medium ${theme.text}`}>{option.name}</div>
                                    <div className={`text-sm ${theme.text} opacity-70`}>
                                        {option.amount} tokens
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Purchase Button */}
            <button
                onClick={handlePurchase}
                disabled={loading || !selectedToken}
                className={`w-full py-3 px-6 rounded-xl font-medium transition-all duration-300 
                    ${loading || !selectedToken
                        ? 'bg-[#814E33]/20 text-[#FCF5D8]/50 cursor-not-allowed'
                        : 'bg-[#F4860A] hover:bg-[#F4860A]/90'
                    } ${theme.text}`}
            >
                {loading ? 'Processing...' : 'Purchase Access'}
            </button>
        </div>
    );
};

export default PurchaseAccess;
