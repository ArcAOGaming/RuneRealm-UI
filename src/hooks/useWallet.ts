// This hook now just re-exports the context for backward compatibility
import { useWallet as useWalletContext } from '../contexts/WalletContext';

export const useWallet = useWalletContext;
