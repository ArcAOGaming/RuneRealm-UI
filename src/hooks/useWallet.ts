// This hook now just re-exports the context for backward compatibility
import { useWallet as useWalletContext } from '../context/WalletContext';

export const useWallet = useWalletContext;
