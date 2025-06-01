import { AssetInfo } from "../constants/Constants";

// Interface definitions
export interface ResultType {
  Messages?: Array<{
    Data: string;
    Tags?: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

// Cache interfaces
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface UserCache {
  [key: string]: CacheEntry<any>;
}

// Profile interfaces
export interface ProfileInfo {
  Profile: {
    UserName: string;
    DisplayName: string;
    Description: string;
    ProfileImage: string;
    CoverImage?: string;
    DateCreated?: string;
    DateUpdated?: string;
  };
  Assets: any[];
  Collections: any[];
  Owner: string;
}

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
  memberCount: string | number;
  monsterCount: string | number;
  members: FactionMember[];
  averageLevel: number;
  totalTimesFed: string | number;
  totalTimesPlay: string | number;
  totalTimesMission: string | number;
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
  elementType: string;
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

export interface ActiveBattle {
  id: string;
  challenger: MonsterStats;
  accepter: MonsterStats;
  startTime: number;
  status: 'active' | 'ended';
  turns: BattleTurn[];
  moveCounts: {
    challenger: { [key: string]: number };
    accepter: { [key: string]: number };
  };
}

export interface BattleTurn {
  attacker: 'challenger' | 'accepter';
  move: string;
  moveName: string;
  moveRarity: number;
  missed: boolean;
  shieldDamage: number;
  healthDamage: number;
  statsChanged: {
    attack?: number;
    speed?: number;
    defense?: number;
    health?: number;
  };
  superEffective: boolean;
  notEffective: boolean;
  attackerState: MonsterState;
  defenderState: MonsterState;
}

export interface MonsterState {
  health: number;
  shield: number;
  attack: number;
  defense: number;
  speed: number;
  healthPoints: number;
}

export interface MonsterStatus {
  type: 'Home' | 'Play' | 'Mission' | 'Battle';
  since: number;
  until_time: number;
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

export interface AssetBalance {
  info: AssetInfo;
  balance: number;
  state: string;
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

export interface OfferingStats {
  ["Sky Nomads"]: number;
  ["Aqua Guardians"]: number;
  ["Stone Titans"]: number;
  ["Inferno Blades"]: number;
}

export interface FactionMember {
  id: string;
  level: number;
}

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

export interface BulkImportResult {
  successful: number;
  failed: number;
}
