import { message as aoMessage, dryrun, result } from "../config/aoConnection";
import { createDataItemSigner } from "@permaweb/aoconnect";
import { TokenClient } from 'ao-js-sdk';
import { useWallet } from "../contexts/WalletContext";
import { 
    AdminSkinChanger, 
    DefaultAtlasTxID, 
    Alter, 
    SUPPORTED_ASSET_IDS, 
    WAITTIMEOUIT, 
    ASSET_INFO, 
    AssetInfo, 
    TARGET_BATTLE_PID,
    MAX_RETRIES,
    RETRY_DELAY,
    type SupportedAssetId
  } from "../constants/Constants";
  import { ProfileInfo, ProfilesService } from 'ao-js-sdk';
  import { AssetBalance, BattleManagerInfo, BattleResponse, BattleTurn, FactionOptions, MonsterStats, ResultType, TokenOption, UserInfo, WalletStatus } from "./interefaces";  
interface CachedData<T> {
  data: T;
  timestamp: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const ONE_HOUR_MS = 60 * 60 * 1000; // 1 hour in milliseconds

const isCacheValid = (timestamp: number, expirationMs: number = ONE_DAY_MS): boolean => {
  return Date.now() - timestamp < expirationMs;
};

const getCachedData = <T>(key: string, expirationMs: number = ONE_DAY_MS): CachedData<T> | null => {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    
    const parsedCache = JSON.parse(cached) as CachedData<T>;
    if (!parsedCache || !parsedCache.data || !parsedCache.timestamp) {
      localStorage.removeItem(key);
      return null;
    }

    if (!isCacheValid(parsedCache.timestamp, expirationMs)) {
      localStorage.removeItem(key);
      return null;
    }

    console.log(`[Cache] Retrieved data for key ${key}:`, parsedCache);
    return parsedCache;
  } catch (error) {
    console.error(`[Cache] Error retrieving data for key ${key}:`, error);
    localStorage.removeItem(key);
    return null;
  }
};

const setCachedData = <T>(key: string, data: T): void => {
  try {
    if (!data) {
      console.warn(`[Cache] Attempted to cache null/undefined data for key ${key}`);
      return;
    }

    const cacheData: CachedData<T> = {
      data,
      timestamp: Date.now()
    };

    const serialized = JSON.stringify(cacheData);
    localStorage.setItem(key, serialized);
    console.log(`[Cache] Stored data for key ${key}:`, cacheData);
  } catch (error) {
    console.error(`[Cache] Error storing data for key ${key}:`, error);
  }
};

// Token client factory function
export const createTokenClient = (assetId: string, wallet: any) => {
  if (!wallet) {
    throw new Error('Wallet is required to create token client');
  }

  // Create the wallet config object
  const walletConfig = {
    getActiveAddress: async () => {
      const walletAddress = wallet.address || await wallet.getActiveAddress();
      return walletAddress;
    },
    address: wallet.address || null,
    dispatch: wallet
  };

  // Create and return the token client
  return TokenClient.defaultBuilder()
    .withProcessId(assetId)
    .withWallet(walletConfig)
    .withAOConfig({
      CU_URL: 'https://ur-cu.randao.net',
      MODE: 'legacy'
    })
    .build();
};

export type { 
  AssetInfo 
} from '../constants/Constants';

export interface BattleParticipant {
  address: string;
  healthPoints: number;
  health: number;
  shield: number;
  defense: number;
  moves: Record<string, any>;
  name?: string;
}

export interface ActiveBattle {
  id: string;
  challenger: MonsterStats;
  accepter: MonsterStats;
  status: 'active' | 'ended';
  turns: BattleTurn[];
  startTime: number;
  moveCounts: {
    challenger: { [key: string]: number };
    accepter: { [key: string]: number };
  };
}

export type {
  TokenOption,
  MonsterStats,
  BattleManagerInfo,
  FactionOptions,
  ProfileInfo,
  WalletStatus,
  BattleResponse,
  BattleTurn
};

export const getProfileInfo = async (
  address: string | string[],
  useCache: boolean = false
): Promise<ProfileInfo | ProfileInfo[] | null> => {
  try {
    if (Array.isArray(address)) {
      // For arrays, create a cache key using all addresses
      const cacheKey = `getProfileInfo-${address.join('-')}`;
      
      if (useCache) {
        const cached = getCachedData<ProfileInfo[]>(cacheKey);
        if (cached) {
          console.log(`[getProfileInfo] Using cached profiles for:`, address);
          return cached.data;
        }
      }

      console.log(`[getProfileInfo] Fetching profiles for:`, address);
      const profileService = ProfilesService.getInstance();
      try {
        const profileInfos = await profileService.getProfileInfosByWalletAddress(address);
        console.log(`[getProfileInfo] Raw profile infos received:`, profileInfos);
        
        // Validate and sanitize profile infos
        if (!profileInfos || !Array.isArray(profileInfos)) {
          console.warn(`[getProfileInfo] Invalid profile data structure for addresses:`, address);
          return [];
        }

        // Filter out invalid profiles and ensure Profile object exists
        const validProfiles = profileInfos.filter(p => {
          try {
            return p && typeof p === 'object' && p.Profile && 
                   typeof p.Profile === 'object' && 
                   typeof p.Profile.UserName === 'string';
          } catch (e) {
            console.warn(`[getProfileInfo] Invalid profile structure:`, p, e);
            return false;
          }
        });

        if (validProfiles.length > 0) {
          console.log(`[getProfileInfo] Valid profiles found:`, validProfiles);
          setCachedData(cacheKey, validProfiles);
          return validProfiles;
        } else {
          console.warn(`[getProfileInfo] No valid profiles found for addresses:`, address);
          return [];
        }
      } catch (error) {
        console.error(`[getProfileInfo] Error fetching profiles:`, error);
        if (error instanceof SyntaxError) {
          console.error(`[getProfileInfo] JSON parsing error:`, error.message);
        }
        return [];
      }
    } else {
      // For single address
      const cacheKey = `getProfileInfo-${address}`;
      
      if (useCache) {
        const cached = getCachedData<ProfileInfo>(cacheKey);
        if (cached) {
          console.log(`[getProfileInfo] Using cached profile for:`, address);
          return cached.data;
        }
      }

      console.log(`[getProfileInfo] Fetching profile for:`, address);
      const profileService = ProfilesService.getInstance();
      try {
        const profileInfos = await profileService.getProfileInfosByWalletAddress([address]);
        console.log(`[getProfileInfo] Raw profile info received:`, profileInfos);
        
        // Validate array structure
        if (!profileInfos || !Array.isArray(profileInfos)) {
          console.warn(`[getProfileInfo] Invalid profile data structure for address:`, address);
          return null;
        }

        const result = profileInfos[0];
        
        // Validate profile structure
        if (result && typeof result === 'object' && result.Profile && 
            typeof result.Profile === 'object' && 
            typeof result.Profile.UserName === 'string') {
          console.log(`[getProfileInfo] Valid profile found:`, result);
          setCachedData(cacheKey, result);
          return result;
        } else {
          console.warn(`[getProfileInfo] Invalid profile structure for address:`, address, result);
          return null;
        }
      } catch (error) {
        console.error(`[getProfileInfo] Error fetching profile:`, error);
        if (error instanceof SyntaxError) {
          console.error(`[getProfileInfo] JSON parsing error:`, error.message);
        }
        return null;
      }
    }
  } catch (error) {
    console.error(`[getProfileInfo] Error getting profile info:`, error);
    return null;
  }
};

// Wrap the original message function to include refresh callback
export const message = async (params: any, refreshCallback?: () => void) => {
  const response = await aoMessage(params);
  // If a refresh callback is provided, call it immediately after message is sent
  if (refreshCallback) {
    refreshCallback();
  }
  return response;
};


// Update user's skin
export const updateUserSkin = async (wallet: any, spriteTxId: string, walletStatus: { isUnlocked: boolean }, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Updating skin for wallet:", wallet.address);
        
        // Check if user is authorized
        if (!walletStatus?.isUnlocked) {
            throw new Error("You do not have skin changing ability unlocked.");
        }

        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "UpdateSkin" },
                { name: "SpriteTxId", value: spriteTxId },
                { name: "SpriteAtlasTxId", value: DefaultAtlasTxID }
            ],
            signer: createDataItemSigner(wallet),
            data: ""
        }, refreshCallback);

        console.log("UpdateSkin response:", messageResult);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from UpdateSkin");
        }

        return transferResult.Messages[0].Data;
    } catch (error) {
        console.error("Error in updateUserSkin:", error);
        throw error;
    }
};

export const setFaction = async (wallet: any, faction: string, walletStatus: { isUnlocked: boolean }, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Setting faction for wallet:", wallet.address);
        
        // Check if user is authorized
        if (!walletStatus?.isUnlocked) {
            throw new Error("You do not have Eternal Pass.");
        }
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "SetFaction" },
                { name: "Faction", value: faction },
            ],
            signer,
            data: ""
        }, refreshCallback);

        console.log("SetFaction response:", messageResult);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from SetFaction");
        }

        return transferResult.Messages[0].Data;
    } catch (error) {
        console.error("Error in setFaction:", error);
        throw error;
    }
};

// Get purchase schema
export const getPurchaseSchema = async (wallet: any) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Getting purchase schema for wallet:", wallet.address);
        
        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "SchemaExternal" }
            ],
            data: ""
        }) as ResultType;

        console.log("SchemaExternal response:", dryRunResult);

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            throw new Error("No response from SchemaExternal");
        }

        return JSON.parse(dryRunResult.Messages[0].Data);
    } catch (error) {
        console.error("Error in getPurchaseSchema:", error);
        throw error;
    }
};

// Get available purchase options
export const getPurchaseOptions = async (): Promise<TokenOption[]> => {
    try {
        console.log("Getting purchase options");
        
        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "GetPurchaseOptions" }
            ],
            data: ""
        }) as ResultType;

        console.log("GetPurchaseOptions response:", dryRunResult);

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            throw new Error("No response from GetPurchaseOptions");
        }

        const response = JSON.parse(dryRunResult.Messages[0].Data);
        console.log("Parsed response:", response);

        // The contract returns { result: [...tokens] }
        const options = response.result;
        
        if (!Array.isArray(options)) {
            console.error("Invalid options format:", options);
            throw new Error("Invalid purchase options format");
        }

        return options.map((option: any) => ({
            token: option.token,
            amount: option.amount,
            name: option.name,
            icon: option.icon,
            denomination: option.denomination || 0 // fallback to 0 if not specified
        }));
    } catch (error) {
        console.error('Error getting purchase options:', error);
        throw error;
    }
};

// Default read-only address to use when wallet is not connected
const DEFAULT_READ_ONLY_ADDRESS = 'readonly-address-for-fetching-factions';

export const getFactionOptions = async (wallet: any = null, useCache: boolean = false): Promise<FactionOptions[]> => {
    try {
        console.log("Getting faction options");
        
        const cacheKey = 'getFactionOptions';
        
        if (useCache) {
            const cached = getCachedData<FactionOptions[]>(cacheKey, ONE_HOUR_MS);
            if (cached) {
                console.log(`[getFactionOptions] Using cached factions`);
                return cached.data;
            }
        }
        
        // Use a default address if wallet is not connected
        const signerAddress = wallet?.address || DEFAULT_READ_ONLY_ADDRESS;
        console.log(`[getFactionOptions] Using address: ${signerAddress}`);
        
        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "GetFactions" },
                { name: "Signer", value: signerAddress }
            ],
            data: ""
        }) as ResultType;

        console.log("GetFactions response:", dryRunResult);

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            throw new Error("No response from GetFactions");
        }

        const response = JSON.parse(dryRunResult.Messages[0].Data);
        console.log("Parsed response:", response);

        // The contract returns { result: [...tokens] }
        const options = response.result;
        
        if (!Array.isArray(options)) {
            console.error("Invalid options format:", options);
            throw new Error("Invalid purchase options format");
        }

        const mappedOptions = options.map((option: any) => {
            console.log(`Faction ${option.name} members:`, option.members);
            console.log(`Faction ${option.name} average monster level:`, option.averageLevel);
            return {
                name: option.name,
                description: option.description,
                mascot: option.mascot,
                perks: option.perks,
                memberCount: Number(option.memberCount) || 0,
                monsterCount: Number(option.monsterCount) || 0,
                members: option.members,
                averageLevel: Number(option.averageLevel) || 0,
                totalTimesFed: Number(option.totalTimesFed) || 0,
                totalTimesPlay: Number(option.totalTimesPlay) || 0,
                totalTimesMission: Number(option.totalTimesMission) || 0
            };
        });
        
        // Cache the mapped options
        if (mappedOptions.length > 0) {
            setCachedData(cacheKey, mappedOptions);
        }
        
        return mappedOptions;
    } catch (error) {
        console.error('Error getting purchase options:', error);
        throw error;
    }
};

export const formatTokenAmount = (amount: string, denomination: number): string => {
    // Convert amount to number
    const numAmount = parseFloat(amount);
    // Divide by 10^denomination
    const formattedAmount = (numAmount / Math.pow(10, denomination)).toFixed(denomination);
    // Remove trailing zeros after decimal point, but ensure 0 is displayed instead of empty string
    const result = formattedAmount.replace(/\.?0+$/, '');
    return result === '' ? '0' : result;
};

// Purchase access
export const purchaseAccess = async (wallet: any, selectedToken: TokenOption, refreshCallback?: () => void): Promise<boolean> => {
    try {
        console.log("Initiating purchase with token:", selectedToken);
        if (!wallet) {
            throw new Error("Arweave wallet not found");
        }

        const signer = createDataItemSigner(wallet);
        console.log("Created signer for wallet");

        // Check for referrer cookie
        const referrer = document.cookie
            .split('; ')
            .find(row => row.startsWith('X-Referer='))
            ?.split('=')[1];

        // Prepare tags for the message
        const tags = [
            { name: "Action", value: "Transfer" },
            { name: "Quantity", value: selectedToken.amount },
            { name: "Recipient", value: AdminSkinChanger }
        ];

        // Add referrer tag if exists
        if (referrer) {
            tags.push({ name: "X-Referer", value: referrer });
        }

        // Send the transfer message
        const messageResult = await message({
            process: selectedToken.token, // Token contract
            tags,
            signer,
            data: "" // Empty data for transfer
        }, refreshCallback);

        console.log("Transfer message sent:", messageResult);

        // Wait for the result
        const transferResult = await result({
            message: messageResult,
            process: selectedToken.token
        }) as ResultType;

        console.log("Transfer result:", transferResult);

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from transfer");
        }

        // Check for error in the response
        for (const msg of transferResult.Messages) {
            const errorTag = msg.Tags?.find(tag => tag.name === "Error");
            if (errorTag) {
                throw new Error(errorTag.value);
            }

            // Check for successful transfer (Debit-Notice or Credit-Notice)
            const actionTag = msg.Tags?.find(tag => tag.name === "Action");
            if (actionTag && (actionTag.value === "Debit-Notice" || actionTag.value === "Credit-Notice")) {
                return true;
            }
        }

        // If we get here without finding success or error, something went wrong
        throw new Error("Transfer failed - no success confirmation received");

    } catch (error) {
        console.error("Error during purchase:", error);
        throw error;
    }
};

export interface BulkImportResult {
    successful: number;
    failed: number;
}

interface BulkImportRequest {
    function: string;
    addresses: string[];
}

export const bulkImportAddresses = async (wallet: any, data: BulkImportRequest, refreshCallback?: () => void): Promise<BulkImportResult> => {
    try {
        if (!wallet) {
            throw new Error("No wallet provided");
        }
        const signer = createDataItemSigner(wallet);
        console.log("Created signer for wallet");

        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "BulkImportAddresses" }
            ],
            data: JSON.stringify(data),
            signer
        }, refreshCallback);
        console.log(messageResult);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from BulkImportAddresses");
        }

        const resultData = JSON.parse(transferResult.Messages[0].Data);
        return resultData;
    } catch (error) {
        console.error("Error importing addresses:", error);
        throw error;
    }
};

// Remove user access
// Adopt a monster
export const adoptMonster = async (wallet: any, walletStatus: { isUnlocked: boolean; faction: string | null }, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Adopting monster for wallet:", wallet.address);
        
        // Check if user is authorized with Eternal Pass by making a direct dry run
        if (!walletStatus?.isUnlocked) {
            try {
                // Make a direct dry run to check the unlock status
                const unlockCheck = await dryrun({
                    process: AdminSkinChanger,
                    tags: [
                        { name: "Action", value: "CheckUnlocked" },
                        { name: "Address", value: wallet.address }
                    ],
                    data: ""
                }) as { Messages?: Array<{ Data: string }> };  // Type assertion for dryrun response

                if (unlockCheck?.Messages?.length) {
                    const response = JSON.parse(unlockCheck.Messages[0].Data) as 
                        { type: string, data?: string, result?: boolean };
                    
                    const isUnlocked = response.type === "ok" ? 
                        (response.data ? JSON.parse(response.data).result : false) : 
                        (response.result === true);
                    
                    if (!isUnlocked) {
                        throw new Error("You do not have Eternal Pass.");
                    }
                    // Update the local wallet status if we got new info
                    if (walletStatus) {
                        walletStatus.isUnlocked = true;
                    }
                } else {
                    throw new Error("Failed to verify Eternal Pass status.");
                }
            } catch (error) {
                console.error("Error checking Eternal Pass status:", error);
                throw new Error("You do not have Eternal Pass or there was an error verifying your status.");
            }
        }
        
        // Verify faction status if not available locally
        if (!walletStatus?.faction) {
            try {
                // Make a direct dry run to check the faction status
                const factionCheck = await dryrun({
                    process: AdminSkinChanger,
                    tags: [
                        { name: "Action", value: "CheckFaction" },
                        { name: "Address", value: wallet.address }
                    ],
                    data: ""
                }) as { Messages?: Array<{ Data: string }> };

                if (factionCheck?.Messages?.length) {
                    const faction = factionCheck.Messages[0].Data === "None" ? 
                        null : factionCheck.Messages[0].Data;
                    
                    if (!faction) {
                        throw new Error("You must join a faction first.");
                    }
                    
                    // Update the local wallet status if we got new info
                    if (walletStatus) {
                        walletStatus.faction = faction;
                    }
                } else {
                    throw new Error("Failed to verify faction status.");
                }
            } catch (error) {
                console.error("Error checking faction status:", error);
                throw new Error("You must join a faction first or there was an error verifying your faction status.");
            }
        }

        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "AdoptMonster" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        console.log("AdoptMonster response:", messageResult);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from AdoptMonster");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error in adoptMonster:", error);
        throw error;
    }
};

// Get user's monster
export const getUserMonster = async (wallet: any, useCache: boolean = false): Promise<MonsterStats | null> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Getting monster for wallet:", wallet.address);
        const cacheKey = `getUserMonster-${wallet.address}`;

        if (useCache) {
            const cached = getCachedData<MonsterStats>(cacheKey);
            if (cached) {
                console.log(`[getUserMonster] Using cached monster for:`, wallet.address);
                return cached.data;
            }
        }

        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "GetUserMonster" },
                { name: "Wallet", value: wallet.address }
            ],
            data: ""
        }) as ResultType;

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            return null;
        }

        const response = JSON.parse(dryRunResult.Messages[0].Data);
        const monster = response.status === "success" ? response.monster : null;

        if (monster) {
            setCachedData(cacheKey, monster);
        }

        return monster;
    } catch (error) {
        console.error("Error in getUserMonster:", error);
        return null;
    }
};

// Helper to create a timeout for promises
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> => {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
    ]);
};

/**
 * Retry a function with timeout and exponential backoff
 * @param fn Function to retry
 * @param maxRetries Maximum number of retries
 * @param timeout Timeout for each attempt in ms
 * @param delayMs Delay between retries in ms
 */
const retryWithTimeout = async <T>(
    fn: () => Promise<T>, 
    maxRetries: number = MAX_RETRIES, 
    timeout: number = WAITTIMEOUIT, 
    delayMs: number = RETRY_DELAY
): Promise<T | null> => {
    let retries = 0;
    
    while (retries <= maxRetries) {
        try {
            // If not the first attempt, log that we're retrying
            if (retries > 0) {
                console.log(`Retry attempt ${retries}/${maxRetries}`);
            }
            
            // Attempt with timeout
            const result = await withTimeout(fn(), timeout);
            
            // If successful, return the result
            if (result !== null) {
                if (retries > 0) {
                    console.log(`Succeeded after ${retries} retry attempts`);
                }
                return result;
            }
            
            // If we get here, it's because of a timeout
            console.warn(`Attempt ${retries + 1} timed out after ${timeout}ms`);
            
            // If we've reached max retries, return null
            if (retries >= maxRetries) {
                console.warn(`Max retries (${maxRetries}) reached, giving up`);
                return null;
            }
            
            // Wait before next retry
            console.log(`Waiting ${delayMs}ms before next attempt...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            // Increment retry counter
            retries++;
        } catch (error) {
            console.error(`Error during retry attempt ${retries}:`, error);
            
            // If we've reached max retries, throw the error
            if (retries >= maxRetries) {
                console.warn(`Max retries (${maxRetries}) reached, giving up`);
                return null;
            }
            
            // Wait before next retry
            await new Promise(resolve => setTimeout(resolve, delayMs));
            
            // Increment retry counter
            retries++;
        }
    }
    
    return null;
};

// Cache info for 1 week (in milliseconds)
const INFO_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000;

// Get cached asset info from localStorage
const getCachedAssetInfo = (processId: string): AssetInfo | null => {
    try {
        const cached = localStorage.getItem(`asset_info_${processId}`);
        if (!cached) return null;

        const parsedCache = JSON.parse(cached);
        if (!parsedCache || !parsedCache.data || !parsedCache.timestamp) {
            localStorage.removeItem(`asset_info_${processId}`);
            return null;
        }

        // Check if cache is still valid (1 week)
        if (Date.now() - parsedCache.timestamp > INFO_CACHE_DURATION) {
            localStorage.removeItem(`asset_info_${processId}`);
            return null;
        }

        console.log(`[Cache] Using cached asset info for ${processId}`);
        return parsedCache.data;
    } catch (error) {
        console.error(`Error retrieving cached asset info for ${processId}:`, error);
        localStorage.removeItem(`asset_info_${processId}`);
        return null;
    }
};

// Store asset info in localStorage
const cacheAssetInfo = (processId: string, info: AssetInfo): void => {
    try {
        if (!info) return;

        const cacheData = {
            data: info,
            timestamp: Date.now()
        };

        localStorage.setItem(`asset_info_${processId}`, JSON.stringify(cacheData));
        console.log(`[Cache] Stored asset info for ${processId}`);
    } catch (error) {
        console.error(`Error caching asset info for ${processId}:`, error);
    }
};

export interface MonsterStatsUpdate {
  level?: number;
  exp?: number;
  attack?: number;
  defense?: number;
  speed?: number;
  health?: number;
  energy?: number;
  happiness?: number;
  faction?: string;
  image?: string;
  name?: string;
  status?: {
    type: 'Home' | 'Play' | 'Mission' | "Battle";
    since: number;
    until_time: number;
  };
  activities?: {
    mission?: {
      cost?: {
        token?: string;
        amount?: number;
      };
      duration?: number;
      energyCost?: number;
      happinessCost?: number;
    };
    play?: {
      cost?: {
        token?: string;
        amount?: number;
      };
      duration?: number;
      energyCost?: number;
      happinessGain?: number;
    };
    feed?: {
      cost?: {
        token?: string;
        amount?: number;
      };
      energyGain?: number;
    };
  };
}

export const setUserStats = async (wallet: any, targetWallet: string, stats: MonsterStatsUpdate, refreshCallback?: () => void): Promise<boolean> => {
  try {
    console.log('Setting user stats with data:', JSON.stringify(stats, null, 2));
    // Use wallet passed as parameter
    const signer = createDataItemSigner(wallet);
    const messageResult = await message({
      process: AdminSkinChanger,
      tags: [
        { name: "Action", value: "SetUserStats" },
        { name: "Wallet", value: targetWallet }
      ],
      data: JSON.stringify(stats),
      signer
    }, refreshCallback);

    const transferResult = await result({
      message: messageResult,
      process: AdminSkinChanger
    }) as ResultType;

    if (!transferResult.Messages || transferResult.Messages.length === 0) {
      throw new Error("No response from SetUserStats");
    }

    const response = JSON.parse(transferResult.Messages[0].Data);
    return response.status === "success";
  } catch (error) {
    console.error("Error setting user stats:", error);
    throw error;
  }
};


// Execute a battle in the current session
export const executeBattle = async (wallet: any, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Executing battle for wallet:", wallet.address);
        
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "Battle" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from battle execution");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error executing battle:", error);
        throw error;
    }
};

// Execute a battle in the current session
export const executeActivity = async (wallet: any, activity:string, canReturn:boolean, token: string, cost: string, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Executing battle for wallet:", wallet.address);
        const signer = createDataItemSigner(wallet);
        const messageResult =  await message({
            process: canReturn ? AdminSkinChanger : token,
            tags: canReturn ? [
              { name: "Action", value: `ReturnFrom-${activity}` }
            ] : [
              { name: "Action", value: "Transfer" },
              { name: "Quantity", value: cost },
              { name: "Recipient", value: AdminSkinChanger },
              { name: "X-Action", value: activity }
            ],
            signer,
            data: ""
          }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;


        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error executing activity:", error);
        throw error;
    }
};

export const getUserInfo = async (walletAddress: string): Promise<UserInfo | null> => {
    try {
        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "GetUserInfo" },
                { name: "Wallet", value: walletAddress }
            ],
            data: ""
        }) as ResultType;

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            return null;
        }

        return JSON.parse(dryRunResult.Messages[0].Data);
    } catch (error) {
        console.error("Error getting user info:", error);
        return null;
    }
};

export const removeUser = async (userId: string, refreshCallback?: () => void) => {
    try {
        // Get wallet from context
        const { wallet } = useWallet();
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "RemoveUser" },
                { name: "UserId", value: userId }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from RemoveUser");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error removing user:", error);
        throw error;
    }
};

export interface OfferingStats {
    ["Sky Nomads"]: number;
    ["Aqua Guardians"]: number;
    ["Stone Titans"]: number;
    ["Inferno Blades"]: number;
}

export const defaultInteraction = async (wallet: any, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: Alter,
            tags: [
                { name: "Action", value: "DefaultInteraction" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: Alter
        }) as ResultType;

        // DefaultInteraction doesn't return a response, it just triggers the interaction
        return { status: "success" };
    } catch (error) {
        console.error("Error in defaultInteraction:", error);
        throw error;
    }
};

export const getTotalOfferings = async (): Promise<OfferingStats> => {
    try {
        const dryRunResult = await dryrun({
            process: Alter,
            tags: [
                { name: "Action", value: "GetTotalOfferings" }
            ],
            data: ""
        }) as ResultType;

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            throw new Error("No response from GetTotalOfferings");
        }

        return JSON.parse(dryRunResult.Messages[0].Data);
    } catch (error) {
        console.error("Error getting total offerings:", error);
        throw error;
    }
};

export interface OfferingData {
    LastOffering: number;
    IndividualOfferings: number;
    Streak: number;
}

export const getUserOfferings = async (userId: string): Promise<OfferingData | null> => {
    try {
        const dryRunResult = await dryrun({
            process: Alter,
            tags: [
                { name: "Action", value: "GetUserOfferings" },
                { name: "UserId", value: userId }
            ],
            data: ""
        }) as ResultType;

        if (!dryRunResult.Messages || dryRunResult.Messages.length === 0) {
            return null;
        }

        const result = JSON.parse(dryRunResult.Messages[0].Data);
        if (result && typeof result === 'object' && 'LastOffering' in result) {
            return result as OfferingData;
        }
        return null;
    } catch (error) {
        console.error("Error getting user offerings:", error);
        return null;
    }
};

export const adjustAllMonsters = async (refreshCallback?: () => void): Promise<boolean> => {
    try {
        // Get wallet from context
        const { wallet } = useWallet();
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "AdjustAllMonsters" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: AdminSkinChanger
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from AdjustAllMonsters");
        }

        const response = JSON.parse(transferResult.Messages[0].Data);
        return response.status === "success";
    } catch (error) {
        console.error("Error adjusting all monsters:", error);
        throw error;
    }
};

// Generate a referral link for the current user
export const generateReferralLink = async (): Promise<string> => {
    // Get wallet from context
    const { wallet } = useWallet();
    if (!wallet) {
        throw new Error("Arweave wallet not found");
    }
    
    const address = await wallet.getActiveAddress();
    const baseUrl = window.location.origin;
    return `${baseUrl}?ref=${address}`;
};

// Handle referral link parameters and set cookie
export const handleReferralLink = (): void => {
    const urlParams = new URLSearchParams(window.location.search);
    const referrer = urlParams.get('ref');
    
    if (referrer) {
        // Set cookie to expire in 24 hours
        const expirationDate = new Date();
        expirationDate.setTime(expirationDate.getTime() + (24 * 60 * 60 * 1000));
        
        document.cookie = `X-Referer=${referrer}; expires=${expirationDate.toUTCString()}; path=/`;
    }
};

// Copy referral link to clipboard
export const copyReferralLink = async (): Promise<void> => {
    const link = await generateReferralLink();
    await navigator.clipboard.writeText(link);
};

// Admin force return from battle
export const adminReturnFromBattle = async (wallet: any, targetWallet: string, refreshCallback?: () => void): Promise<boolean> => {
    try {
        console.log('[adminReturnFromBattle] Forcing return for wallet:', targetWallet);
        // Use the wallet that was passed in as parameter
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "AdminReturnFromBattle" },
                { name: "UserId", value: targetWallet }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        console.log('[adminReturnFromBattle] Result:', transferResult);

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from AdminReturnFromBattle");
        }

        const response = JSON.parse(transferResult.Messages[0].Data);
        return response.status === "success";
    } catch (error) {
        console.error("Error forcing return from battle:", error);
        throw error;
    }
};


// Get user's battle status
export const getBattleManagerInfo = async (walletAddress: string): Promise<BattleManagerInfo | null> => {
    try {
        console.log('[getBattleManagerInfo] Checking battle manager info for wallet:', walletAddress);
        const result = await dryrun({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "GetBattleManagerInfo" },
                { name: "UserId", value: walletAddress }
            ],
            data: ""
        }) as ResultType; // Cast to ResultType to fix TypeScript errors
        console.log(result);

        if (!result.Messages || result.Messages.length === 0) {
            console.log('[getBattleManagerInfo] No messages in response');
            return null;
        }

        console.log('[getBattleManagerInfo] Message data:', result.Messages[0].Data);
        const response = JSON.parse(result.Messages[0].Data);
        console.log('[getBattleManagerInfo] Parsed response:', response);

        if (response.status === 'success' && response.data) {
            return response.data;
        }

        return null;
    } catch (error) {
        console.error('Error getting battle manager info:', error);
        return null;
    }
};

// Get active battle
export const getActiveBattle = async (walletAddress: string): Promise<ActiveBattle | null> => {
    try {
        const result = await dryrun({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "GetOpenBattle" },
                { name: "UserId", value: walletAddress }
            ],
            data: ""
        }) as ResultType; // Cast to ResultType to fix TypeScript errors
        console.log(result);

        if (!result.Messages || result.Messages.length === 0) {
            return null;
        }

        const response = JSON.parse(result.Messages[0].Data);
        console.log(response);
        if (response.status === 'success' && response.data) {
            return response.data;
        }

        return null;
    } catch (error) {
        console.error('Error getting active battle:', error);
        return null;
    }
};

// Get active battle
export const getUserActiveBattles = async (walletAddress: string): Promise<ActiveBattle | null> => {
    try {
        const result = await dryrun({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "GetUserOpenBattles" },
                { name: "UserId", value: walletAddress }
            ],
            data: ""
        }) as ResultType; // Cast to ResultType to fix TypeScript errors
        console.log(result);

        if (!result.Messages || result.Messages.length === 0) {
            return null;
        }

        const response = JSON.parse(result.Messages[0].Data);
        console.log(response);
        if (response.status === 'success' && response.data) {
            return response.data;
        }

        return null;
    } catch (error) {
        console.error('Error getting active battle:', error);
        return null;
    }
};

// Start a battle session
export const startBattle = async (wallet: any, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Starting battle for wallet:", wallet.address);
        
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "BeginBattles" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from battle start");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error starting battle:", error);
        throw error;
    }
};

// Enter a battle
export const enterBattle = async (
    wallet: any, 
    options?: { 
        challenge?: string, // "OPEN" for open challenge, wallet address for targeted challenge
        accept?: string    // wallet address of challenger to accept their battle
    }, 
    refreshCallback?: () => void
): Promise<BattleResponse> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(wallet);
        const tags = [{ name: "Action", value: "Battle" }];

        // Add challenge tag if specified
        if (options?.challenge) {
            tags.push({ name: "challenge", value: options.challenge });
        }

        // Add accept tag if specified
        if (options?.accept) {
            tags.push({ name: "accept", value: options.accept });
        }

        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags,
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from battle");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error entering battle:", error);
        throw error;
    }
};

// Return from battle session
export const returnFromBattle = async (wallet: any, refreshCallback?: () => void): Promise<BattleResponse> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "ReturnFromBattle" }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from return from battle");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error returning from battle:", error);
        throw error;
    }
};

// Execute an attack in battle
export const executeAttack = async (wallet: any, battleId: string, moveName: string, refreshCallback?: () => void): Promise<BattleResponse> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "Attack" },
                { name: "BattleId", value: battleId },
                { name: "Move", value: moveName }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from attack");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error executing attack:", error);
        throw error;
    }
};


// End a battle
export const endBattle = async (wallet: any, battleId: string, refreshCallback?: () => void): Promise<BattleResponse> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(wallet);
        const messageResult = await message({
            process: TARGET_BATTLE_PID,
            tags: [
                { name: "Action", value: "EndBattle" },
                { name: "BattleId", value: battleId }
            ],
            signer,
            data: ""
        }, refreshCallback);

        const transferResult = await result({
            message: messageResult,
            process: TARGET_BATTLE_PID
        }) as ResultType;

        if (!transferResult.Messages || transferResult.Messages.length === 0) {
            throw new Error("No response from end battle");
        }

        return JSON.parse(transferResult.Messages[0].Data);
    } catch (error) {
        console.error("Error ending battle:", error);
        throw error;
    }
};

export interface LootBoxResponse {
  result: any;
}

/**
 * Get user's loot boxes
 * @param userId User's ID (wallet address)
 * @returns Promise with loot box information
 */
export const getLootBoxes = async (userId: string): Promise<LootBoxResponse | null> => {
  if (!userId) {
    console.error('[getLootBoxes] No user ID provided');
    return null;
  }

  try {
    console.log('[getLootBoxes] Getting loot boxes for user:', userId);
    
    const result = await dryrun({
        process: AdminSkinChanger,
        tags: [
            { name: 'Action', value: 'GetLootBox' },
            { name: 'UserId', value: userId }
        ]
    }) as ResultType; // Cast to ResultType to fix TypeScript errors
    console.log(result);

    // Check if we have a valid Messages array
    if (result?.Messages && result.Messages.length > 0) {
      try {
        // Get the data from the first message
        const messageData = result.Messages[0].Data;
        console.log(messageData);
        
        // Handle different response formats
        let parsed;
        
        if (typeof messageData === 'string') {
          try {
            // Try to parse as JSON
            parsed = JSON.parse(messageData);
          } catch (e) {
            // If it's not valid JSON, it might be a string representation of an array
            // Check if it looks like an array (starts with [ and ends with ])
            if (messageData.trim().startsWith('[') && messageData.trim().endsWith(']')) {
              // Try to evaluate it as an array (safely)
              try {
                parsed = JSON.parse(messageData);
              } catch (e2) {
                console.error('[getLootBoxes] Could not parse array-like string:', e2);
                // Return empty array as fallback
                return { result: [[]] };
              }
            } else {
              // Not JSON or array-like, return as is
              parsed = messageData;
            }
          }
        } else {
          // If it's already an object (not a string), use it directly
          parsed = messageData;
        }
        
        console.log('[getLootBoxes] Parsed loot boxes:', parsed);
        
        // If parsed is null, undefined, or not an array, return an empty array
        if (!parsed) {
          return { result: [[]] };
        }
        
        // Format the response properly
        return {
          result: Array.isArray(parsed) ? parsed : [parsed]
        };
      } catch (error) {
        console.error('[getLootBoxes] Error processing response:', error);
        // Return empty array as fallback
        return { result: [[]] };
      }
    }
    
    console.warn('[getLootBoxes] No valid response data');
    // Return empty array as fallback
    return { result: [[]] };
  } catch (error) {
    console.error('[getLootBoxes] Error getting loot boxes:', error);
    // Return empty array as fallback
    return { result: [[]] };
  }
};

/**
 * Open a loot box
 * @param wallet User's wallet
 * @param refreshCallback Optional callback to refresh UI after opening
 * @returns Promise with loot box results
 */
export const openLootBox = async (wallet: any, refreshCallback?: () => void): Promise<LootBoxResponse | null> => {
    if (!wallet?.address) {
      console.error('[openLootBox] No wallet address provided');
      return null;
    }
  
    try {
      console.log('[openLootBox] Opening loot box for user:', wallet.address);
      const signer = createDataItemSigner(wallet);
  
      // Send your message
      const messageresult: any = await message({
        process: AdminSkinChanger,
        tags: [
          { name: 'Action', value: 'OpenLootBox' },
          { name: 'From', value: wallet.address }
        ],
        signer
      });
      console.log(messageresult);
      
      // Get the result object
      const boxResult = await result({
        message: messageresult,
        process: AdminSkinChanger
      }) as ResultType;
  
      console.log(boxResult);
  
      // Grab the last message in the array (if any)
      if (boxResult?.Messages && boxResult.Messages.length > 0) {
        const lastMessage = boxResult.Messages[boxResult.Messages.length - 1];
        
        if (lastMessage?.Data) {
          try {
            // Parse the last message's Data
            const parsedData = JSON.parse(lastMessage.Data);
  
            console.log('[openLootBox] Loot box opened successfully:', parsedData);
  
            // Return it in a shape that allows usage like result[0].token
            // If your parsedData has a top-level "result" array, you can pass that through:
            return {
              result: parsedData.result
            };
          } catch (error) {
            console.error('[openLootBox] Error parsing the last message data:', error);
            return null;
          }
        }
      }
  
      console.warn('[openLootBox] No valid response data found in the last message');
      return null;
      
    } catch (error) {
      console.error('[openLootBox] Error opening loot box:', error);
      return null;
    }
  };

/**
 * Open a loot box with specific rarity
 * @param wallet User's wallet
 * @param rarity Rarity level of the loot box to open
 * @param refreshCallback Optional callback to refresh UI after opening
 * @returns Promise with loot box results
 */
export const openLootBoxWithRarity = async (wallet: any, rarity: number, refreshCallback?: () => void): Promise<LootBoxResponse | null> => {
  if (!wallet?.address) {
    console.error('[openLootBoxWithRarity] No wallet address provided');
    return null;
  }

  try {
    console.log(`[openLootBoxWithRarity] Opening loot box with rarity ${rarity} for user:`, wallet.address);
    const signer = createDataItemSigner(wallet);

    // Send message with rarity tag
    const messageresult: any = await message({
      process: AdminSkinChanger,
      tags: [
        { name: 'Action', value: 'OpenLootBox' },
        { name: 'From', value: wallet.address },
        { name: 'rarity', value: rarity.toString() } // Add the rarity tag as a string
      ],
      signer
    }, refreshCallback);
    
    // Get the result
    const boxResult = await result({
      message: messageresult,
      process: AdminSkinChanger
    }) as { Messages: Array<{ Data: string, Tags?: Array<{ name: string, value: string }> }> };

    // Process the result similar to the original function
    if (boxResult?.Messages && boxResult.Messages.length > 0) {
      const lastMessage = boxResult.Messages[boxResult.Messages.length - 1];
      
      if (lastMessage?.Data) {
        try {
          const parsedData = JSON.parse(lastMessage.Data);
          
          // Validate each loot item to ensure it has a valid token property
          if (Array.isArray(parsedData.result)) {
            // Log the raw result for debugging
            console.log('[openLootBoxWithRarity] Raw result:', JSON.stringify(parsedData.result));
            
            // Check for and log any items without a token
            const problematicItems = parsedData.result.filter(item => !item.token);
            if (problematicItems.length > 0) {
              console.warn('[openLootBoxWithRarity] Found loot items without token:', problematicItems);
            }
            
            // Ensure each item has a token (use a placeholder if missing)
            const validatedResult = parsedData.result.map(item => {
              if (!item.token) {
                console.warn(`[openLootBoxWithRarity] Item missing token property: ${JSON.stringify(item)}`);
                return { ...item, token: 'unknown-token' };
              }
              return item;
            });
            
            return {
              result: validatedResult
            };
          }
          
          return {
            result: parsedData.result
          };
        } catch (error) {
          console.error('[openLootBoxWithRarity] Error parsing response:', error);
          return null;
        }
      }
    }
    return null;
  } catch (error) {
    console.error('[openLootBoxWithRarity] Error opening loot box:', error);
    return null;
  }
};
