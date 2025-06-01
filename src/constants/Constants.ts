export interface SpriteCategory {
  name: string;
  folder: string;
  defaultOption: string;
  options: string[];
}
export const AdminSkinChanger = "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI";
// export const TARGET_BATTLE_PID = "W111mH0QHpqVMQ6z3ayHEQWC94xqETy2G8qceQUaFRQ"
export const TARGET_BATTLE_PID = "3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs";
export const Alter = "GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ";
export const DefaultAtlasTxID = "sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g";
export const Gateway = "https://arweave.dev/";

// Battle position constants
export const BATTLE_POSITIONS = {
  HOME_OFFSET: "15%", // Distance from edge in home position
  ATTACK_OFFSET: "55%", // Distance from edge in attack position
} as const;

// Activity point values
export const ACTIVITY_POINTS = {
  OFFERING: 10,
  FEED: 1,
  PLAY: 2,
  MISSION: 3,
} as const;

// Card constants
export const CARD_CONSTANTS = {
  EXPANDED_SECTION: {
    BACKGROUND_OFFSET: 2, // 2px offset for background image
  }
} as const;

export const SPRITE_CATEGORIES: SpriteCategory[] = [
  {
    name: "Hair",
    folder: "Hair",
    defaultOption: "None",
    options: ["None", "Girl", "Boy"],
  },
  {
    name: "Hat",
    folder: "Hat",
    defaultOption: "None",
    options: ["None", "Beanie"],
  },
  {
    name: "Shirt",
    folder: "Shirt",
    defaultOption: "None",
    options: ["None", "Shirt", "Coat"],
  },
  {
    name: "Pants",
    folder: "Pants",
    defaultOption: "None",
    options: ["None", "Pants", "Skirt", "Shorts"],
  },
  {
    name: "Gloves",
    folder: "Gloves",
    defaultOption: "None",
    options: ["None", "Gloves"],
  },
  {
    name: "Shoes",
    folder: "Shoes",
    defaultOption: "None",
    options: ["None", "Shoes"],
  },
];

export const PUBLIC_ASSETS_PATH = "/assets";

export const SUPPORTED_ASSET_IDS = [
  "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA", // Air berries
  "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0", // Water berries
  "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM", // Rock berries
  "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0", // Fire berries
  "4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q", // Rune
  "f1KnnMFYR125aQo0zYKgL0PzgJL__fO8JOtDfuIDdHo", // Scroll
  "C19KuCwx1VRH4WItj9wYUu1DIkdvareU3aMmojVZJf4", // Emerald
  "rNVB_bYcNLk6OgcbyG8MEmxjGo76oj3gFzLBCWOhqXI", // Ruby
  "R5UGOfFboMv-zlaSSDgRqxRILmGgPPe5BlnPf5F4i3A", // Topaz
  "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ", // TRUNK token
  "OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU", // NAB token
  "rPpsRk9Rm8_SJ1JF8m9_zjTalkv9Soaa_5U0tYUloeY", // RNG token
  "s6jcB3ctSbiDNwR-paJgy5iOAhahXahLul8exSLHbGE", // GAME token
] as const;

export type SupportedAssetId = (typeof SUPPORTED_ASSET_IDS)[number];

export interface AssetInfo {
  processId: SupportedAssetId;
  logo: string;
  name: string;
  ticker: string;
  denomination: number;
  section: string;
  spriteMap?: string;
}

export const ASSET_INFO: Partial<Record<string, AssetInfo>> = {
  "rPpsRk9Rm8_SJ1JF8m9_zjTalkv9Soaa_5U0tYUloeY": {
    processId: "rPpsRk9Rm8_SJ1JF8m9_zjTalkv9Soaa_5U0tYUloeY",
    logo: "AY7kSgZXnun5glz7AT3rhG8kRvtvy6q3MCogYF6JO80",
    name: "RandAOTest",
    ticker: "TestRNG",
    denomination: 18,
    section: "Value",
  },
  wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ: {
    processId: "wOrb8b_V8QixWyXZub48Ki5B6OIDyf_p1ngoonsaRpQ",
    logo: "hqg-Em9DdYHYmMysyVi8LuTGF8IF_F7ZacgjYiSpj0k",
    name: "TRUNK Token",
    ticker: "TRUNK",
    denomination: 3,
    section: "Value",
  },
  OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU: {
    processId: "OsK9Vgjxo0ypX_HLz2iJJuh4hp3I80yA9KArsJjIloU",
    logo: "LQ4crOHN9qO6JsLNs253AaTch6MgAMbM8PKqBxs4hgI",
    name: "NAB Token",
    ticker: "NAB",
    denomination: 8,
    section: "Value",
  },
  "s6jcB3ctSbiDNwR-paJgy5iOAhahXahLul8exSLHbGE": {
    processId: "s6jcB3ctSbiDNwR-paJgy5iOAhahXahLul8exSLHbGE",
    logo: "-c4VdpgmfuS4YadtLuxVZzTd2DQ3ipodA6cz8pwjn20",
    name: "ArcAO",
    ticker: "GAME",
    denomination: 18,
    section: "Value",
  },
  "4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q": {
    processId: "4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q",
    logo: "tsd98L0c7DH0rH6BmUD6-IkaIZ2ll90xzA3IvFPVmHg",
    name: "RUNE",
    ticker: "RUNE",
    denomination: 0,
    section: "Utility",
  },
  f1KnnMFYR125aQo0zYKgL0PzgJL__fO8JOtDfuIDdHo: {
    processId: "f1KnnMFYR125aQo0zYKgL0PzgJL__fO8JOtDfuIDdHo",
    logo: "W6uzmeX2Fg12f0s6tdFe9YXGeOqUVbwLpUo18pJ3pdc",
    name: "Scroll",
    ticker: "Scroll",
    spriteMap: "BuXEu4Ml9LRjqYnTtNX8kth4yjx8VkN_4r_NkfABIec",
    denomination: 0,
    section: "Utility",
  },
  C19KuCwx1VRH4WItj9wYUu1DIkdvareU3aMmojVZJf4: {
    processId: "C19KuCwx1VRH4WItj9wYUu1DIkdvareU3aMmojVZJf4",
    logo: "lCRSEsSOrDhYUqJtsYN7CJoEm553a9cRLySW2lCxDWs",
    name: "Emerald",
    ticker: "Emerald",
    spriteMap: "agk0Smr--B_d8QaKl0znL7ok0vH5JMqmUy-pWe8emTg",
    denomination: 0,
    section: "Gems",
  },
  "R5UGOfFboMv-zlaSSDgRqxRILmGgPPe5BlnPf5F4i3A": {
    processId: "R5UGOfFboMv-zlaSSDgRqxRILmGgPPe5BlnPf5F4i3A",
    logo: "tu3Mpqk29s5f1w9A635C1YAZrfMDg9XOl0sB9icZFDM",
    name: "Topaz",
    ticker: "Topaz",
    spriteMap: "ibvf6xYrRHTPiqrbTPizh1wT7uu8Sp3LKC3b_dLWoHY",
    denomination: 0,
    section: "Gems",
  },
  rNVB_bYcNLk6OgcbyG8MEmxjGo76oj3gFzLBCWOhqXI: {
    processId: "rNVB_bYcNLk6OgcbyG8MEmxjGo76oj3gFzLBCWOhqXI",
    logo: "L8YdLYNIcLBVYPBndpz460MV2p01vQ9zTNx2gbpLtio",
    name: "Ruby",
    ticker: "Ruby",
    spriteMap: "HPqCmJ9QevXtCCzZt3gSgqJ6khjDJY4GkUdqAyPQfEM",
    denomination: 0,
    section: "Gems",
  },
  twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0: {
    processId: "twFZ4HTvL_0XAIOMPizxs_S3YH5J5yGvJ8zKiMReWF0",
    logo: "SVJe_WftpSstb2H3xaaFt8iEP_RnBMP6oMl_gYe7GAM",
    name: "Water Berries",
    ticker: "Water Berries",
    denomination: 0,
    section: "Berry",
  },
  XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA: {
    processId: "XJjSdWaorbQ2q0YkaQSmylmuADWH1fh2PvgfdLmXlzA",
    logo: "iR8sQUhOeN9ZU9nrH8QpEfV47UCjAMgo6c9boAUFFD0",
    name: "Air Berries",
    ticker: "Air Berries",
    denomination: 0,
    section: "Berry",
  },
  "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM": {
    processId: "2NoNsZNyHMWOzTqeQUJW9Xvcga3iTonocFIsgkWIiPM",
    logo: "diik2n9jIYAKXBTRvZZgCx96CxOuC_TbYQX7wQDUIEE",
    name: "Rock Berries",
    ticker: "Rock Berries",
    denomination: 0,
    section: "Berry",
  },
  "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0": {
    processId: "30cPTQXrHN76YZ3bLfNAePIEYDb5Xo1XnbQ-xmLMOM0",
    logo: "F4UBK2yG5ltyPQtAKffIRCjc-J2iZ8FXMlbgX1hsYrQ",
    name: "Fire Berries",
    ticker: "Fire Berries",
    denomination: 0,
    section: "Berry",
  },
};



// Triple the timeout value for asset loading as requested
export const WAITTIMEOUIT = 22500;
export const MAX_RETRIES = 3; // Number of retries for failed asset loads
export const RETRY_DELAY = 10000; // Delay between retries in milliseconds
