import { message, createDataItemSigner, dryrun, result } from "../config/aoConnection";

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
export type SupportedAssetId = typeof SUPPORTED_ASSETS[number];

// Interface for wallet status
export interface AssetInfo {
    processId: SupportedAssetId;
    logo: string;
    name: string;
    ticker: string;
}

export interface AssetBalance {
    info: AssetInfo;
    balance: number;
}

export interface MonsterStatus {
  type: 'Home' | 'Play' | 'Mission';
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

export interface MonsterStats {
    name: string;
    image: string;
    attack: number;
    defense: number;
    speed: number;
    health: number;
    energy: number;
    level: number;
    exp: number;
    berryType: string;
    happiness: number;
    status: MonsterStatus;
    moves: {
        [key: string]: MonsterMove;
    };
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
    };
}

export const SUPPORTED_ASSETS = [
    "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",  // Air berries
    "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",  // Water berries
    "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",  // Rock berries
    "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0",  // Fire berries
    "4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q",  // Rune
    "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ",  // TRUNK token
    "OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU"   // NAB token
] as const;

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

export interface FactionOptions {
    name: string;
    description: string;
    mascot: string;
    perks: string[];
    memberCount: number;
    monsterCount: number;
}

interface ContractResponse {
  result: {
    name: string;
    version: string;
    icon?: string;
    payments: TokenOption[];
  };
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
export const updateUserSkin = async (wallet: any, spriteTxId: string) => {
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
        });

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

export const setFaction = async (wallet: any, faction: string) => {
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
        });

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

        return options.map((option: any) => ({
            name: option.name,
            description: option.description,
            mascot: option.mascot,
            perks: option.perks,
            memberCount: option.memberCount,
            monsterCount: option.monsterCount
        }));
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
export const purchaseAccess = async (selectedToken: TokenOption): Promise<boolean> => {
    try {
        console.log("Initiating purchase with token:", selectedToken);

        if (!window.arweaveWallet) {
            throw new Error("Arweave wallet not found");
        }

        const signer = createDataItemSigner(window.arweaveWallet);
        console.log("Created signer for wallet");

        // Send the transfer message
        const messageResult = await message({
            process: selectedToken.token, // Token contract
            tags: [
                { name: "Action", value: "Transfer" },
                { name: "Quantity", value: selectedToken.amount },
                { name: "Recipient", value: AdminSkinChanger }
            ],
            signer,
            data: "" // Empty data for transfer
        });

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

export const bulkImportAddresses = async (data: BulkImportRequest): Promise<BulkImportResult> => {
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
        });
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
export const adoptMonster = async (wallet: any) => {
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
        });

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

// Get asset info and balances
export const getAssetBalances = async (wallet: any): Promise<AssetBalance[]> => {
    if (!wallet?.address) {
        throw new Error("No wallet connected");
    }

    try {
        console.log("Getting berry balances for wallet:", wallet.address);
        
        const assetBalances: AssetBalance[] = [];

        // Get info and balances for all assets in parallel
        const assetPromises = SUPPORTED_ASSETS.map(async (processId) => {
            try {
                // Run info and balance queries in parallel for each asset
                const [infoResult, balanceResult] = await Promise.all([
                    dryrun({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Info" }
                        ],
                        data: ""
                    }),
                    dryrun({
                        process: processId,
                        tags: [
                            { name: "Action", value: "Balances" }
                        ],
                        data: ""
                    })
                ]) as [ResultType, ResultType];

                if (!infoResult.Messages || infoResult.Messages.length === 0) {
                    // Handle known tokens with hardcoded info
                    if (processId === "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ") {
                        return {
                            info: {
                                processId,
                                logo: "hqg-Em9DdYHYmMysyVi8LuTGF8IF_F7ZacgjYiSpj0k",
                                name: "TRUNK Token",
                                ticker: "TRUNK"
                            },
                            balance: 0
                        };
                    } else if (processId === "OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU") {
                        return {
                            info: {
                                processId,
                                logo: "LQ4crOHN9qO6JsLNs253AaTch6MgAMbM8PKqBxs4hgI",
                                name: "NAB Token",
                                ticker: "NAB"
                            },
                            balance: 0
                        };
                    }
                    return null;
                }

                const infoTags = infoResult.Messages[0].Tags;
                const logo = infoTags.find(t => t.name === "Logo")?.value;
                const name = infoTags.find(t => t.name === "Name")?.value;
                const ticker = infoTags.find(t => t.name === "Ticker")?.value;

                if (!logo || !name || !ticker) {
                    return null;
                }

                let balance = 0;
                if (balanceResult.Messages && balanceResult.Messages.length > 0) {
                    const balanceData = JSON.parse(balanceResult.Messages[0].Data);
                    balance = parseInt(balanceData[wallet.address] || "0");
                }

                return {
                    info: {
                        processId,
                        logo,
                        name,
                        ticker
                    },
                    balance
                };
            } catch (error) {
                console.log(`Error loading asset ${processId}:`, error);
                return null;
            }
        });

        // Wait for all asset queries to complete
        const results = await Promise.all(assetPromises);
        const validResults = results.filter((result): result is AssetBalance => {
            if (!result) return false;
            return true; // All non-null results are valid AssetBalance objects
        });
        assetBalances.push(...validResults);

        console.log("Final asset balances:", assetBalances);
        return assetBalances;
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

export const setUserStats = async (targetWallet: string, stats: MonsterStatsUpdate): Promise<boolean> => {
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
    });

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

export const removeUser = async (userId: string) => {
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
        });

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

import { AdminSkinChanger, DefaultAtlasTxID, Alter } from "../constants/Constants";

export interface OfferingStats {
    ["Sky Nomads"]: number;
    ["Aqua Guardians"]: number;
    ["Stone Titans"]: number;
    ["Inferno Blades"]: number;
}

export const defaultInteraction = async (wallet: any) => {
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
        });

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

export const adjustAllMonsters = async (): Promise<boolean> => {
    try {
        const signer = createDataItemSigner(window.arweaveWallet);
        const messageResult = await message({
            process: AdminSkinChanger,
            tags: [
                { name: "Action", value: "AdjustAllMonsters" }
            ],
            signer,
            data: ""
        });

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
