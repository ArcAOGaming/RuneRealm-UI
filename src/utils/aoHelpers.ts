import { message as aoMessage, createDataItemSigner, dryrun, result } from "../config/aoConnection";
import { AdminSkinChanger, DefaultAtlasTxID, Alter, SUPPORTED_ASSET_IDS, WAITTIMEOUIT, ASSET_INFO, AssetInfo, TARGET_BATTLE_PID } from "../constants/Constants";

// Wrap the original message function to include refresh callback
export const message = async (params: any, refreshCallback?: () => void) => {
  const response = await aoMessage(params);
  // If a refresh callback is provided, call it immediately after message is sent
  if (refreshCallback) {
    refreshCallback();
  }
  return response;
};

interface ResultType {
    Messages?: Array<{
        Data: string;
        Tags?: Array<{
            name: string;
            value: string;
        }>;
    }>;
}

// Define supported asset type
// Interface for wallet status
export type { AssetInfo } from '../constants/Constants';

export interface AssetBalance {
    info: AssetInfo;
    balance: number;
}

export interface MonsterStatus {
  type: 'Home' | 'Play' | 'Mission' | 'Battle';
  since: number;  // timestamp
  until_time: number;  // timestamp
}

export interface MonsterMove {
    type: string;
    count: number;
    damage: number;
    attack: number;
    speed: number;
    defense: number;
    health: number;
}

export interface BattleManagerInfo {
    battlesRemaining: number;
    wins: number;
    losses: number;
    startTime: number;
}

export interface BattleManagerResponse {
    status: 'success' | 'not_found' | 'error';
    message: string;
    data?: BattleManagerInfo;
}


export interface BattleTurn {
    attacker: 'player' | 'opponent';
    move: string;
    missed: boolean;
    shieldDamage: number;
    healthDamage: number;
    remainingShield: number;
    remainingHealth: number;
    statsChanged: {
        speed?: number;
        defense?: number;
        health?: number;
    };
}

export interface MonsterStats {
    name: string;
    image: string;
    sprite: string;
    attack: number;
    defense: number;
    speed: number;
    health: number;
    healthPoints?: number;
    shield?: number;
    energy: number;
    level: number;
    exp: number;
    berryType: string;
    happiness: number;
    totalTimesFed: number;
    totalTimesPlay: number;
    totalTimesMission: number;
    status: MonsterStatus;
    moves: {
        [key: string]: MonsterMove;
    };
    battleSession?: BattleManagerInfo;
    activities: {
        mission: {
            cost: {
                token: string;
                amount: number;
            };
            duration: number;
            energyCost: number;
            happinessCost: number;
        };
        play: {
            cost: {
                token: string;
                amount: number;
            };
            duration: number;
            energyCost: number;
            happinessGain: number;
        };
        feed: {
            cost: {
                token: string;
                amount: number;
            };
            energyGain: number;
        };
        battle: {
            cost: {
                token: string;
                amount: number;
            };
            energyCost: number;
            happinessCost: number;
        };
    };
}


export interface UserInfo {
    isUnlocked: boolean;
    skin: string | null;
    faction: string | null;
    monster: MonsterStats | null;
    activityStatus: {
        isPlayComplete: boolean;
        isMissionComplete: boolean;
    };
}

export interface WalletStatus {
    isUnlocked: boolean;
    currentSkin: string | null;
    faction: string | null;
    monster: MonsterStats | null;
    error?: string;
    contractName?: string;
    contractIcon?: string;
    payments?: Array<{
      token: string;
      amount: string;
      name: string;
      icon?: string;
    }>;
}

interface WalletInfo {
    address: string;
}

// Interface for purchase options
export interface TokenOption {
    token: string;
    amount: string;
    name: string;
    icon?: string;
    denomination: number;
}

interface FactionMember {
    id: string;
    level: number;
}

export interface FactionOptions {
    name: string;
    description: string;
    mascot: string;
    perks: string[];
    memberCount: number;
    monsterCount: number;
    members: FactionMember[];
    averageLevel: number;
    totalTimesFed: number;
    totalTimesPlay: number;
    totalTimesMission: number;
}

interface ContractResponse {
  result: {
    name: string;
    version: string;
    icon?: string;
    payments: TokenOption[];
  };
}



export interface ActiveBattle {
    id: string;
    player: MonsterStats;
    opponent: MonsterStats;
    startTime: number;
    status: 'active' | 'ended';
    turns: BattleTurn[];
    moveCounts: {
        player: { [key: string]: number };
        opponent: { [key: string]: number };
    };
}

export interface BattleResult {
    result: 'win' | 'loss';
    session: BattleManagerInfo;
}

export interface BattleResponse {
    status: 'success' | 'error';
    message: string;
    data?: ActiveBattle | BattleResult | BattleManagerInfo;
}
// Check wallet status and current skin
export const checkWalletStatus = async (walletInfo?: { address: string }): Promise<WalletStatus> => {
    try {
        // If no wallet info provided, get the active address
        const address = walletInfo?.address || await window.arweaveWallet.getActiveAddress();
        console.log("Checking wallet status for address:", address);
        
        // Run all checks in parallel
        const [unlockResult, skinResult, factionResult, monsterResult] = await Promise.all([
            // Check if user is unlocked
            dryrun({
                process: AdminSkinChanger,
                tags: [
                    { name: "Action", value: "CheckUnlocked" },
                    { name: "Address", value: address }
                ],
                data: ""
            }),
            // Check skin
            dryrun({
                process: AdminSkinChanger,
                tags: [
                    { name: "Action", value: "CheckSkin" },
                    { name: "Address", value: address }
                ],
                data: ""
            }),
            // Check faction
            dryrun({
                process: AdminSkinChanger,
                tags: [
                    { name: "Action", value: "CheckFaction" },
                    { name: "Address", value: address }
                ],
                data: ""
            }),
            // Get monster status
            dryrun({
                process: AdminSkinChanger,
                tags: [
                    { name: "Action", value: "GetUserMonster" },
                    { name: "Wallet", value: address }
                ],
                data: ""
            })
        ]) as [ResultType, ResultType, ResultType, ResultType];

        if (!unlockResult.Messages || unlockResult.Messages.length === 0) {
            throw new Error("No response from CheckUnlocked");
        }

        const response = JSON.parse(unlockResult.Messages[0].Data);
        const isUnlocked = response.type === "ok" ? 
            JSON.parse(response.data).result : 
            response.result === true;

        // Process skin
        const skinTxId = skinResult.Messages && skinResult.Messages.length > 0 ?
            (skinResult.Messages[0].Data === "None" ? null : skinResult.Messages[0].Data) :
            null;

        // Process faction
        const faction = factionResult.Messages && factionResult.Messages.length > 0 ?
            (factionResult.Messages[0].Data === "None" ? null : factionResult.Messages[0].Data) :
            null;

        // Process monster
        let monster = null;
        if (monsterResult.Messages && monsterResult.Messages.length > 0) {
            const monsterResponse = JSON.parse(monsterResult.Messages[0].Data);
            if (monsterResponse.status === "success") {
                monster = monsterResponse.monster;
            }
        }

        return {
            isUnlocked,
            currentSkin: skinTxId,
            faction: faction,
            monster: monster,
            contractIcon: "hqg-Em9DdYHYmMysyVi8LuTGF8IF_F7ZacgjYiSpj0k",
            contractName: "Sprite Customizer"
        };
    } catch (error) {
        console.error("Error checking wallet status:", error);
        return {
            isUnlocked: false,
            currentSkin: null,
            faction: null,
            monster: null,
            error: "Failed to check wallet status"
        };
    }
};

// Update user's skin
export const updateUserSkin = async (wallet: any, spriteTxId: string, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Updating skin for wallet:", wallet.address);
        
        // First check if user is authorized
        const status = await checkWalletStatus(wallet);
        if (!status.isUnlocked) {
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

export const setFaction = async (wallet: any, faction: string, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Setting faction for wallet:", wallet.address);
        
        // First check if user is authorized
        const status = await checkWalletStatus(wallet);
        if (!status.isUnlocked) {
            throw new Error("You do not have Eternal Pass.");
        }
        const signer = createDataItemSigner(window.arweaveWallet);
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

export const getFactionOptions = async (): Promise<FactionOptions[]> => {
    try {
        console.log("Getting purchase options");
        
        const dryRunResult = await dryrun({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "GetFactions" }
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

        return options.map((option: any) => {
            console.log(`Faction ${option.name} members:`, option.members);
            console.log(`Faction ${option.name} average monster level:`, option.averageLevel);
            return {
                name: option.name,
                description: option.description,
                mascot: option.mascot,
                perks: option.perks,
                memberCount: option.memberCount,
                monsterCount: option.monsterCount,
                members: option.members,
                averageLevel: option.averageLevel,
                totalTimesFed: option.totalTimesFed || 0,
                totalTimesPlay: option.totalTimesPlay || 0,
                totalTimesMission: option.totalTimesMission || 0
            };
        });
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
    // Remove trailing zeros after decimal point
    return formattedAmount.replace(/\.?0+$/, '');
};

// Purchase access
export const purchaseAccess = async (selectedToken: TokenOption, refreshCallback?: () => void): Promise<boolean> => {
    try {
        console.log("Initiating purchase with token:", selectedToken);

        if (!window.arweaveWallet) {
            throw new Error("Arweave wallet not found");
        }

        const signer = createDataItemSigner(window.arweaveWallet);
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

export const bulkImportAddresses = async (data: BulkImportRequest, refreshCallback?: () => void): Promise<BulkImportResult> => {
    try {
        const signer = createDataItemSigner(window.arweaveWallet);
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
export const adoptMonster = async (wallet: any, refreshCallback?: () => void) => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Adopting monster for wallet:", wallet.address);
        
        // First check if user is authorized
        const status = await checkWalletStatus(wallet);
        if (!status.isUnlocked) {
            throw new Error("You do not have Eternal Pass.");
        }
        if (!status.faction) {
            throw new Error("You must join a faction first.");
        }

        const signer = createDataItemSigner(window.arweaveWallet);
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
export const getUserMonster = async (wallet: any): Promise<MonsterStats | null> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Getting monster for wallet:", wallet.address);
        
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
        return response.status === "success" ? response.monster : null;
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

export const getAssetBalances = async (wallet: any): Promise<AssetBalance[]> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Getting berry balances for wallet:", wallet.address);

        const assetPromises = SUPPORTED_ASSET_IDS.map(async (processId) => {
            try {
                const result = await withTimeout(
                    Promise.all([
                        dryrun({
                            process: processId,
                            tags: [{ name: "Action", value: "Info" }],
                            data: ""
                        }),
                        dryrun({
                            process: processId,
                            tags: [{ name: "Action", value: "Balances" }],
                            data: ""
                        })
                    ]),
                    WAITTIMEOUIT
                );

                if (!result) {
                    console.warn(`Timeout for asset ${processId}`);
                    return null;
                }

                const [infoResult, balanceResult] = result as [ResultType, ResultType];

                // Check if we have predefined info for this asset
                const predefinedInfo = ASSET_INFO[processId];
                let assetInfo: AssetInfo;

                if (predefinedInfo) {
                    assetInfo = predefinedInfo;
                } else if (infoResult.Messages && infoResult.Messages.length > 0) {
                    // If no predefined info, try to get from contract
                    const infoTags = infoResult.Messages[0].Tags;
                    const logo = infoTags.find(t => t.name === "Logo")?.value;
                    const name = infoTags.find(t => t.name === "Name")?.value;
                    const ticker = infoTags.find(t => t.name === "Ticker")?.value;

                    if (!logo || !name || !ticker) {
                        return null;
                    }

                    assetInfo = { processId, logo, name, ticker };
                } else {
                    return null;
                }

                let balance = 0;
                if (balanceResult.Messages && balanceResult.Messages.length > 0) {
                    const balanceData = JSON.parse(balanceResult.Messages[0].Data);
                    balance = parseInt(balanceData[wallet.address] || "0");
                }

                return {
                    info: assetInfo,
                    balance
                };
            } catch (error) {
                console.error(`Error loading asset ${processId}:`, error);
                return null;
            }
        });

        const results = await Promise.all(assetPromises);
        const validResults = results.filter((result): result is AssetBalance => result !== null);

        console.log("Final asset balances:", validResults);
        return validResults;
    } catch (error) {
        console.error("Error getting berry balances:", error);
        return [];
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
    type: 'Home' | 'Play' | 'Mission';
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

export const setUserStats = async (targetWallet: string, stats: MonsterStatsUpdate, refreshCallback?: () => void): Promise<boolean> => {
  try {
    console.log('Setting user stats with data:', JSON.stringify(stats, null, 2));
    const signer = createDataItemSigner(window.arweaveWallet);
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
        
        const signer = createDataItemSigner(window.arweaveWallet);
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
        const signer = createDataItemSigner(window.arweaveWallet);
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
        const signer = createDataItemSigner(window.arweaveWallet);
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

export const getUserOfferings = async (userId: string): Promise<number> => {
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
            return 0;
        }

        const result = JSON.parse(dryRunResult.Messages[0].Data);
        return typeof result === 'number' ? result : 0;
    } catch (error) {
        console.error("Error getting user offerings:", error);
        return 0;
    }
};

export const adjustAllMonsters = async (refreshCallback?: () => void): Promise<boolean> => {
    try {
        const signer = createDataItemSigner(window.arweaveWallet);
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
    if (!window.arweaveWallet) {
        throw new Error("Arweave wallet not found");
    }
    
    const address = await window.arweaveWallet.getActiveAddress();
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
export const adminReturnFromBattle = async (targetWallet: string, refreshCallback?: () => void): Promise<boolean> => {
    try {
        console.log('[adminReturnFromBattle] Forcing return for wallet:', targetWallet);
        
        const signer = createDataItemSigner(window.arweaveWallet);
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
        });
        console.log(result)

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
        });
        console.log(result)

        if (!result.Messages || result.Messages.length === 0) {
            return null;
        }

        const response = JSON.parse(result.Messages[0].Data);
        console.log(response)
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
        
        const signer = createDataItemSigner(window.arweaveWallet);
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
export const enterBattle = async (wallet: any, refreshCallback?: () => void): Promise<BattleResponse> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        const signer = createDataItemSigner(window.arweaveWallet);
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
        const signer = createDataItemSigner(window.arweaveWallet);
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
        const signer = createDataItemSigner(window.arweaveWallet);
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
        const signer = createDataItemSigner(window.arweaveWallet);
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
