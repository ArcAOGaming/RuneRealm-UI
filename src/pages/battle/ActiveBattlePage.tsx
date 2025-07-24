import React, { useEffect, useState, useCallback } from "react";
import { useWallet } from "../../hooks/useWallet";
import {
  getBattleManagerInfo,
  getActiveBattle,
  executeAttack,
  endBattle
} from "../../utils/aoHelpers";
import type {
  BattleManagerInfo,
  ActiveBattle,
  BattleTurn,
  BattleResult
} from "../../utils/interefaces";
import { currentTheme } from "../../constants/theme";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import Loading from "../../components/Loading";
import { useNavigate } from "react-router-dom";
import BattleScene from "../../components/BattleScene";
import BattleOverlays from "../../components/BattleOverlays";
import BattleStats from "../../components/BattleStats";

// Import new modular components
import WinnerAnnouncement from "../../components/battle/WinnerAnnouncement";
import BattleMoves from "../../components/battle/BattleMoves";
import UpdateIndicator from "../../components/battle/UpdateIndicator";
import { getMoveColor } from "../../utils/battleUtils";

/**
 * ActiveBattlePage Component
 * 
 * This is the main battle interface where players engage in turn-based combat.
 * The component has been refactored into smaller, modular components for better maintainability.
 * 
 * ARCHITECTURE OVERVIEW:
 * =====================
 * 
 * 1. STATE MANAGEMENT:
 *    - battleManagerInfo: Contains general battle system information
 *    - activeBattle: Current battle state with player/monster stats and moves
 *    - previousBattle: Previous battle state for comparison and animation triggers
 *    - Animation states: Controls character animations during attacks
 *    - UI states: Loading, updating, disabled states for user interactions
 * 
 * 2. BATTLE FLOW:
 *    - Initial load: Fetches battle data and determines if battle is active/ended
 *    - Move selection: Players select moves which trigger attack animations
 *    - Turn processing: Processes battle turns sequentially with animations
 *    - Battle end: Shows winner announcement and provides exit option
 * 
 * 3. ANIMATION SYSTEM:
 *    - Character animations: Walk, attack, heal/boost sequences
 *    - Attack animations: Visual feedback for different move types
 *    - Shield restoration: End-of-round shield regeneration animation
 *    - Winner announcement: Modal overlay when battle concludes
 * 
 * 4. MODULAR COMPONENTS:
 *    - WinnerAnnouncement: Modal for battle completion
 *    - BattleMoves: Container for both players' move interfaces
 *    - PlayerMoves: Individual player's move buttons and struggle option
 *    - MoveButton: Individual move button with stats and styling
 *    - StruggleButton: Last resort move when all others are exhausted
 *    - UpdateIndicator: Loading indicator during battle updates
 * 
 * 5. DATA FLOW:
 *    - Wallet connection triggers battle data fetching
 *    - Battle state changes trigger re-renders and animations
 *    - Move selection triggers API calls and state updates
 *    - Animation completion triggers next phase of battle sequence
 */
export const ActiveBattlePage: React.FC = (): JSX.Element => {
  const {
    wallet,
    walletStatus,
    darkMode,
    setDarkMode,
  } = useWallet();
  const [battleManagerInfo, setBattleManagerInfo] =
    useState<BattleManagerInfo | null>(null);
  const [activeBattle, setActiveBattle] = useState<ActiveBattle | null>(null);
  const [previousBattle, setPreviousBattle] = useState<ActiveBattle | null>(
    null
  );
  const [attackAnimation, setAttackAnimation] = useState<{
    attacker: "challenger" | "accepter";
    moveName: string;
  } | null>(null);
  const [shieldRestoring, setShieldRestoring] = useState(false);
  const [showEndOfRound, setShowEndOfRound] = useState(false);
  const [showWinnerAnnouncement, setShowWinnerAnnouncement] = useState<{
    winner: string;
  } | null>(null);
  const [movesDisabled, setMovesDisabled] = useState(false);
  const [playerAnimation, setPlayerAnimation] = useState<
    | "walkRight"
    | "walkLeft"
    | "walkUp"
    | "walkDown"
    | "attack1"
    | "attack2"
    | undefined
  >();
  const [opponentAnimation, setOpponentAnimation] = useState<
    | "walkRight"
    | "walkLeft"
    | "walkUp"
    | "walkDown"
    | "attack1"
    | "attack2"
    | undefined
  >();
  const [initialLoading, setInitialLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showBattleLog, setShowBattleLog] = useState(true);
  const theme = currentTheme(darkMode);
  const navigate = useNavigate();

  /**
   * Battle Change Detection Function
   * 
   * Memoized comparison function that determines if a battle state has meaningfully changed.
   * This prevents unnecessary re-renders and animations when only status fields change.
   * 
   * Key Features:
   * - Excludes 'status' field from comparison to avoid animation loops
   * - Compares player stats, turns, and move counts
   * - Uses JSON.stringify for deep comparison (acceptable for battle data size)
   * - Returns true if battles are different or if either is null
   * 
   * @param oldBattle - Previous battle state
   * @param newBattle - New battle state from API
   * @returns boolean indicating if battle has meaningfully changed
   */
  const hasBattleChanged = useCallback(
    (oldBattle: ActiveBattle | null, newBattle: ActiveBattle | null) => {
      if (!oldBattle || !newBattle) return true;

      // Compare relevant battle data excluding status to prevent animation loops
      const oldData = {
        challenger: { ...oldBattle.challenger, status: undefined },
        accepter: { ...oldBattle.accepter, status: undefined },
        turns: oldBattle.turns,
        moveCounts: oldBattle.moveCounts,
      };

      const newData = {
        challenger: { ...newBattle.challenger, status: undefined },
        accepter: { ...newBattle.accepter, status: undefined },
        turns: newBattle.turns,
        moveCounts: newBattle.moveCounts,
      };

      return JSON.stringify(oldData) !== JSON.stringify(newData);
    },
    []
  );

  // Effect to handle initial load
  useEffect(() => {
    let mounted = true;

    const checkBattleStatus = async () => {
      if (!wallet?.address || !mounted || isUpdating || movesDisabled) return;

      try {
        const info = await getBattleManagerInfo(wallet.address);
        if (!mounted) return;
        setBattleManagerInfo(info);

        const allbattle = await getActiveBattle(wallet.address);
        const battle = allbattle[0] as unknown as ActiveBattle;
        if (!mounted) return;
        if (battle) {
          if (!activeBattle) {
            // Initial battle load
            console.log("Initial battle load");
            console.log(battle);
            // Check if battle is over by checking health points
            const isEnded =
              battle.challenger.healthPoints <= 0 ||
              battle.accepter.healthPoints <= 0;
            const status = isEnded ? "ended" : "active";
            setActiveBattle({
              ...battle,
              status,
            });
            setPreviousBattle({
              ...battle,
              status,
            });
          } else if (!movesDisabled && hasBattleChanged(activeBattle, battle)) {
            // Only update if there are meaningful changes and not during animations
            setPreviousBattle(activeBattle);
            console.log("Initial battle load 2");
            // Preserve ended status if battle was already ended
            const status = activeBattle.status === "ended" ? "ended" : "active";
            setActiveBattle({
              ...battle,
              status,
            });
          }
        } else {
          // No battle at all
          navigate("/battle");
        }
      } catch (error) {
        console.error("Error checking battle status:", error);
      } finally {
        setInitialLoading(false);
      }
    };

    checkBattleStatus();

    return () => {
      mounted = false;
    };
  }, [
    wallet?.address,
    navigate,
    activeBattle,
    hasBattleChanged,
    initialLoading,
    isUpdating,
  ]);

  /**
   * Handle Attack Function
   * 
   * Core battle logic that processes a player's move selection and manages the entire
   * battle sequence including animations, state updates, and battle conclusion.
   * 
   * BATTLE PROCESSING FLOW:
   * 1. Validation: Ensure wallet, battle state, and no ongoing updates
   * 2. State Lock: Disable moves and show updating indicator
   * 3. API Call: Execute attack through blockchain/backend
   * 4. Response Processing: Handle battle data and determine if battle ended
   * 5. Turn Processing: Animate and apply each turn's effects sequentially
   * 6. Battle Conclusion: Show winner or continue for next round
   * 
   * @param moveName - Name of the selected move (e.g., "fireball", "heal", "struggle")
   */
  const handleAttack = async (moveName: string) => {
    // Validation: Prevent multiple simultaneous attacks or invalid states
    if (!wallet?.address || !activeBattle || isUpdating || movesDisabled)
      return;

    try {
      // Lock UI to prevent additional move selections during processing
      setMovesDisabled(true);
      setIsUpdating(true);

      // Save current battle state for comparison and rollback if needed
      const previousState = {
        challenger: { ...activeBattle.challenger },
        accepter: { ...activeBattle.accepter },
      };
      setPreviousBattle({ ...activeBattle });

      // Execute the attack through the blockchain/backend API
      const response = await executeAttack(wallet, activeBattle.id, moveName);

      if (response.status === "success" && response.data) {
        // Determine whether the battle is over
        const isBattleOver = "result" in response.data;

        // Extract the proper battle data
        //  - If the battle is over, `response.data` is the entire battle
        //  - Otherwise, `response.data` has a `battle` object
        const battleData = isBattleOver
          ? (response.data as ActiveBattle)
          : (response.data as any).battle as ActiveBattle;

        // If the battle has new turns, figure them out
        const previousTurns = activeBattle?.turns.length || 0;
        const newTurns = battleData.turns.length;
        const turnsToProcess = battleData.turns.slice(previousTurns);

        // Helper to update challenger/accepter from a single turn
        const applyTurnChanges = (turn: BattleTurn, localBattle: ActiveBattle) => {
          if (turn.attacker === "challenger") {
            localBattle.challenger.attack = turn.attackerState.attack;
            localBattle.challenger.defense = turn.attackerState.defense;
            localBattle.challenger.speed = turn.attackerState.speed;
            localBattle.challenger.shield = turn.attackerState.shield;
            localBattle.challenger.healthPoints =
              turn.attackerState.healthPoints;

            localBattle.accepter.attack = turn.defenderState.attack;
            localBattle.accepter.defense = turn.defenderState.defense;
            localBattle.accepter.speed = turn.defenderState.speed;
            localBattle.accepter.shield = turn.defenderState.shield;
            localBattle.accepter.healthPoints = turn.defenderState.healthPoints;
          } else {
            localBattle.accepter.attack = turn.attackerState.attack;
            localBattle.accepter.defense = turn.attackerState.defense;
            localBattle.accepter.speed = turn.attackerState.speed;
            localBattle.accepter.shield = turn.attackerState.shield;
            localBattle.accepter.healthPoints = turn.attackerState.healthPoints;

            localBattle.challenger.attack = turn.defenderState.attack;
            localBattle.challenger.defense = turn.defenderState.defense;
            localBattle.challenger.speed = turn.defenderState.speed;
            localBattle.challenger.shield = turn.defenderState.shield;
            localBattle.challenger.healthPoints =
              turn.defenderState.healthPoints;
          }
        };

        // Helper to run the walking/attack animation for a single turn
        const runAttackAnimation = async (turn: Turn) => {
          console.log(turn)
          setAttackAnimation({ attacker: turn.attacker, moveName: turn.move });

          // Decide if it's an attacking move or heal/boost
          const isAttackMove = turn.healthDamage > 0 || turn.shieldDamage > 0;
          if (isAttackMove) {
            if (turn.attacker === "challenger") {
              setPlayerAnimation("walkRight");
              await new Promise((res) => setTimeout(res, 1000));

              setPlayerAnimation("attack1");
              await new Promise((res) => setTimeout(res, 1000));

              setPlayerAnimation("walkLeft");
              await new Promise((res) => setTimeout(res, 1000));
            } else {
              setOpponentAnimation("walkRight");
              await new Promise((res) => setTimeout(res, 1000));

              setOpponentAnimation("attack1");
              await new Promise((res) => setTimeout(res, 1000));

              setOpponentAnimation("walkLeft");
              await new Promise((res) => setTimeout(res, 1000));
            }
          } else {
            // Heal/Boost sequence
            if (turn.attacker === "challenger") {
              setPlayerAnimation("walkUp");
              await new Promise((res) => setTimeout(res, 1000));

              setPlayerAnimation("walkLeft");
              await new Promise((res) => setTimeout(res, 1000));

              setPlayerAnimation("walkDown");
              await new Promise((res) => setTimeout(res, 1000));
            } else {
              setOpponentAnimation("walkUp");
              await new Promise((res) => setTimeout(res, 1000));

              setOpponentAnimation("walkLeft");
              await new Promise((res) => setTimeout(res, 1000));

              setOpponentAnimation("walkDown");
              await new Promise((res) => setTimeout(res, 1000));
            }
          }

          // Clear animations
          setAttackAnimation(null);
          setPlayerAnimation(undefined);
          setOpponentAnimation(undefined);
        };

// Process exactly the last 2 turns (or just the last turn if only one), considering battle ending edge case
const processTurnsSequentially = async () => {
  const totalTurns = turnsToProcess.length;
  const turnsToRun = totalTurns >= 2 ? [turnsToProcess[totalTurns - 2], turnsToProcess[totalTurns - 1]] : [turnsToProcess[totalTurns - 1]];

  const runTurn = async (i) => {
    const turn = turnsToRun[i];
    await runAttackAnimation(turn);

    // Apply changes to the "activeBattle"
    const updatedBattle = {
      ...activeBattle,
      challenger: { ...activeBattle.challenger },
      accepter: { ...activeBattle.accepter },
      status: isBattleOver ? "ended" : activeBattle.status,
    };

    applyTurnChanges(turn, updatedBattle);
    setActiveBattle(updatedBattle);

    await new Promise((res) => setTimeout(res, 500));

    // Check if this is the last turn to process
    const isLastTurn = i === turnsToRun.length - 1;
    
    if (isBattleOver && isLastTurn) {
      // Battle is over and this was the final turn - show winner announcement
      const playerWon = updatedBattle.challenger.healthPoints > 0;
      const winnerName = playerWon
        ? "Player 1's " + updatedBattle.challenger.name
        : "Player 2's " + updatedBattle.accepter.name;

      setShowWinnerAnnouncement({ winner: winnerName });
      await new Promise((res) => setTimeout(res, 3000));
      setShowWinnerAnnouncement(null);
      return;
    }
    
    if (!isBattleOver && isLastTurn) {
      // Battle continues - show end of round and shield restoration
      setShowEndOfRound(true);
      await new Promise((res) => setTimeout(res, 3000));
      setShowEndOfRound(false);

      // Shield restoration
      setShieldRestoring(true);
      await new Promise((res) => setTimeout(res, 2000));
      setShieldRestoring(false);

      const finalBattle: ActiveBattle = {
        ...updatedBattle,
        challenger: { ...updatedBattle.challenger },
        accepter: { ...updatedBattle.accepter },
        status: "active" as const,
      };
      setActiveBattle(finalBattle);
      setPreviousBattle(finalBattle);

      setMovesDisabled(false);
      return;
    }

    // Continue to next turn if not the last turn
    if (!isLastTurn) {
      await runTurn(i + 1);
    }
  };

  // Start processing turns from the beginning
  runTurn(0);
};
        // If the battle is over, we only have to process the *final* turn.
        // Otherwise, we process new turns the same way. But in both cases,
        // we just let the "processTurnsSequentially" handle it.
        await processTurnsSequentially();
      }
    } catch (error) {
      console.error("Error executing attack:", error);
      setMovesDisabled(false);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEndBattle = async () => {
    if (!wallet?.address || !activeBattle || isUpdating) return;
    try {
      setIsUpdating(true);
      const response = await endBattle(wallet, activeBattle.id);
      if (response.status === "success") {
        navigate("/battle");
      }
    } catch (error) {
      console.error("Error ending battle:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className={`min-h-screen flex flex-col ${theme.bg}`}>
        <Header
          theme={theme}
          darkMode={darkMode}
          onDarkModeToggle={() => setDarkMode(!darkMode)}
        />

        {/* Battle Overlays */}
        {walletStatus?.isUnlocked && activeBattle && (
          <BattleOverlays
            turns={activeBattle.turns}
            showBattleLog={showBattleLog}
            onToggleBattleLog={() => setShowBattleLog(!showBattleLog)}
            theme={theme}
            playerName={"Player 1's  " + activeBattle.challenger.name}
            opponentName={"Player 2's  " + activeBattle.accepter.name}
          />
        )}

        {/* Winner Announcement Overlay */}
        {showWinnerAnnouncement && (
          <WinnerAnnouncement
            winner={showWinnerAnnouncement.winner}
            theme={theme}
          />
        )}

        <div className={`container mx-auto px-4 flex-1 ${theme.text}`}>
          <div
            className="w-full mx-auto flex flex-col items-center"
            style={{ maxWidth: "95vw", height: "calc(100vh - 180px)" }}
          >
            {!wallet?.address ? (
              <div
                className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}
              >
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>
                  Connect Wallet
                </h2>
                <p className={`mb-4 ${theme.text}`}>
                  Please connect your wallet to view battle status.
                </p>
              </div>
            ) : initialLoading ? (
              <div className="flex justify-center items-center py-12">
                <Loading darkMode={darkMode} />
              </div>
            ) : !battleManagerInfo || !activeBattle ? (
              <div
                className={`p-6 rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md text-center`}
              >
                <h2 className={`text-xl font-bold mb-4 ${theme.text}`}>
                  No Active Battle
                </h2>
                <p className={`mb-4 ${theme.text}`}>
                  Returning to battle manager...
                </p>
              </div>
            ) : (
              <div
                className={`rounded-xl ${theme.container} border ${theme.border} backdrop-blur-md`}
              >
                {isUpdating && <UpdateIndicator />}
                {activeBattle.status === "ended" && (
                  <button
                    onClick={handleEndBattle}
                    className="absolute top-4 right-4 z-20 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold transition-all duration-300"
                  >
                    Exit Battle
                  </button>
                )}
                <div
                  className={`rounded-lg ${theme.container} bg-opacity-20 transition-all duration-300 overflow-hidden`}
                >
                  {/* Battle Scene */}
                  <div
                    className="relative mx-auto"
                    style={{
                      height: "min(65vh, calc(100vh - 280px))",
                      width: "min(calc((100vh - 280px) * 1.7777), calc(95vw))",
                      maxHeight: "800px",
                    }}
                  >
                    <BattleScene
                      challenger={activeBattle.challenger}
                      accepter={activeBattle.accepter}
                      playerAnimation={playerAnimation}
                      opponentAnimation={opponentAnimation}
                      onPlayerAnimationComplete={() => {}}
                      onOpponentAnimationComplete={() => {}}
                      attackAnimation={attackAnimation}
                      shieldRestoring={shieldRestoring}
                      showEndOfRound={showEndOfRound}
                      onAttackComplete={() => setAttackAnimation(null)}
                      onShieldComplete={() => setShieldRestoring(false)}
                      onRoundComplete={() => setShowEndOfRound(false)}
                    />
                    <BattleStats battle={activeBattle} theme={theme} />
                  </div>
                </div>

                {/* Battle Moves Section */}
                <BattleMoves
                  challengerMoves={activeBattle.challenger.moves}
                  accepterMoves={activeBattle.accepter.moves}
                  onAttack={handleAttack}
                  isDisabled={isUpdating || movesDisabled}
                  battleStatus={activeBattle.status}
                  theme={theme}
                  getMoveColor={getMoveColor}
                />
              </div>
            )}
          </div>
        </div>
        <Footer darkMode={darkMode} />
      </div>
    </div>
  );
};

export default ActiveBattlePage;