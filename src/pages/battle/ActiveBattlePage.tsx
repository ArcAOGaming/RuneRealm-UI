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
  ActiveBattle
} from "../../utils/interefaces";
import { currentTheme } from "../../constants/theme";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import Loading from "../../components/Loading";
import { useNavigate } from "react-router-dom";
import BattleScene from "../../components/BattleScene";
import BattleOverlays from "../../components/BattleOverlays";
import BattleStats from "../../components/BattleStats";

// Function to determine move color based on type
const getMoveColor = (moveName: string, move: any) => {
  //console.log('Move:', moveName, move);

  if (moveName === "struggle") return "bg-purple-700";
  // Determine type based on name
  const type = move.type.toLowerCase();
  if (type == "heal") return "bg-green-600"; // Brighter green
  if (type == "boost") return "bg-yellow-400"; // More vibrant yellow
  if (type == "fire") return "bg-red-600"; // Intense red
  if (type == "water") return "bg-blue-600"; // Richer blue
  if (type == "air") return "bg-cyan-400"; // Lighter cyan for contrast
  if (type == "rock") return "bg-orange-700"; // More earthy and striking
  if (type == "normal") return "bg-gray-500"; // More distinct neutral tone

  // Default to a deep, intense red for attack moves
  return "bg-red-700";
};

// Small loading indicator for updates
const UpdateIndicator: React.FC = () => (
  <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-3 py-1 rounded-full text-sm animate-pulse">
    Updating...
  </div>
);

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

  // Memoized comparison function to prevent unnecessary updates
  const hasBattleChanged = useCallback(
    (oldBattle: ActiveBattle | null, newBattle: ActiveBattle | null) => {
      if (!oldBattle || !newBattle) return true;

      // Compare relevant battle data excluding status
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

  const handleAttack = async (moveName: string) => {
    if (!wallet?.address || !activeBattle || isUpdating || movesDisabled)
      return;

    try {
      setMovesDisabled(true);
      setIsUpdating(true);

      // Save current state before update
      const previousState = {
        challenger: { ...activeBattle.challenger },
        accepter: { ...activeBattle.accepter },
      };
      setPreviousBattle({ ...activeBattle });

      const response = await executeAttack(wallet, activeBattle.id, moveName);

      if (response.status === "success" && response.data) {
        // Determine whether the battle is over
        const isBattleOver = "result" in response.data;

        // Extract the proper battle data
        //  - If the battle is over, `response.data` is the entire battle
        //  - Otherwise, `response.data` has a `battle` object
        const battleData = isBattleOver
          ? (response.data as ActiveBattle)
          : (response.data as { battle: ActiveBattle }).battle;

        // If the battle has new turns, figure them out
        const previousTurns = activeBattle?.turns.length || 0;
        const newTurns = battleData.turns.length;
        const turnsToProcess = battleData.turns.slice(previousTurns);

        // Helper to update challenger/accepter from a single turn
        const applyTurnChanges = (turn: Turn, localBattle: ActiveBattle) => {
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

    if (isBattleOver && i === 0 && turnsToRun.length === 2) {
      // If the second turn ended the battle, ensure the first turn also plays
      await runTurn(i + 1);
      return;
    }

    if (isBattleOver) {
      const playerWon = updatedBattle.challenger.healthPoints > 0;
      const winnerName = playerWon
        ? "Player 1's " + updatedBattle.challenger.name
        : "Player 2's " + updatedBattle.accepter.name;

      setShowWinnerAnnouncement({ winner: winnerName });
      await new Promise((res) => setTimeout(res, 3000));
      setShowWinnerAnnouncement(null);
      return;
    }

    if (i === turnsToRun.length - 1) {
      // End of round steps
      setShowEndOfRound(true);
      await new Promise((res) => setTimeout(res, 3000));
      setShowEndOfRound(false);

      // Shield restoration
      setShieldRestoring(true);
      await new Promise((res) => setTimeout(res, 2000));
      setShieldRestoring(false);

      const finalBattle = {
        ...updatedBattle,
        challenger: { ...updatedBattle.challenger },
        accepter: { ...updatedBattle.accepter },
        status: isBattleOver ? "ended" : updatedBattle.status,
      };
      setActiveBattle(finalBattle);
      setPreviousBattle(finalBattle);

      setMovesDisabled(false);
      return;
    }

    runTurn(i + 1);
  };

  // Adjust to show both attacks if the battle ended on the second turn
  if (isBattleOver && totalTurns >= 2 && turnsToProcess[totalTurns - 1].causedEnd) {
    turnsToRun.unshift(turnsToProcess[totalTurns - 2]);
  }

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
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50">
            <div
              className={`${theme.container} border ${theme.border} backdrop-blur-md p-8 rounded-xl animate-fade-in text-center`}
            >
              <h2 className="text-3xl font-bold mb-4 text-yellow-400">
                Battle Complete!
              </h2>
              <p className="text-xl text-white">
                {showWinnerAnnouncement.winner} has won the battle!
              </p>
            </div>
          </div>
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

                <div className="mt-2">
                  {/* Moves */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4">
                    {/* Player Moves */}
                    <div
                      className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}
                    >
                      <h4 className="text-md font-semibold mb-3">
                        Challenger's Moves
                      </h4>
                      <div className="relative">
                        {/* Regular moves */}
                        <div className="grid grid-cols-2 gap-2 relative">
                          {Object.entries(activeBattle.challenger.moves).map(
                            ([moveName, move]) => (
                              <button
                                key={moveName}
                                onClick={() => handleAttack(moveName)}
                                disabled={
                                  isUpdating ||
                                  movesDisabled ||
                                  activeBattle.status === "ended" ||
                                  move.count === 0
                                }
                                className={`w-full p-2 rounded-lg font-medium text-left transition-all duration-300 min-h-[80px]
                                ${getMoveColor(
                                  moveName,
                                  move
                                )} hover:brightness-110
                                ${
                                  activeBattle.status === "ended" ||
                                  movesDisabled ||
                                  move.count === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }
                                text-white relative overflow-hidden group flex flex-col justify-between`}
                              >
                                <div className="flex justify-between items-center relative">
                                  <span className="capitalize">{moveName}</span>
                                  <span className="text-sm opacity-75">
                                    {move.count}
                                  </span>
                                </div>
                                {move.count === 0 && (
                                  <div className="absolute inset-0 bg-black/50 pointer-events-none">
                                    <div className="absolute inset-0 flex items-center">
                                      <div className="w-full h-0.5 bg-red-500 transform rotate-12"></div>
                                    </div>
                                  </div>
                                )}
                                <div className="text-sm mt-1">
                                  <div className="grid grid-cols-3 grid-rows-2 gap-1 max-w-[200px] min-h-[32px]">
                                    {move.damage !== 0 && (
                                      <span>
                                        ⚔️ {move.damage > 0 ? "+" : ""}
                                        {move.damage}
                                      </span>
                                    )}
                                    {move.attack !== 0 && (
                                      <span>
                                        💪 {move.attack > 0 ? "+" : ""}
                                        {move.attack}
                                      </span>
                                    )}
                                    {move.defense !== 0 && (
                                      <span>
                                        🛡️ {move.defense > 0 ? "+" : ""}
                                        {move.defense}
                                      </span>
                                    )}
                                    {move.speed !== 0 && (
                                      <span>
                                        ⚡ {move.speed > 0 ? "+" : ""}
                                        {move.speed}
                                      </span>
                                    )}
                                    {move.health !== 0 && (
                                      <span>
                                        ❤️ {move.health > 0 ? "+" : ""}
                                        {move.health}
                                      </span>
                                    )}
                                    {/* Add empty spans to maintain 3x2 grid layout */}
                                    {[
                                      ...Array(
                                        6 -
                                          [
                                            move.damage,
                                            move.attack,
                                            move.defense,
                                            move.speed,
                                            move.health,
                                          ].filter((v) => v !== 0).length
                                      ),
                                    ].map((_, i) => (
                                      <span key={i} className="invisible">
                                        placeholder
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
                              </button>
                            )
                          )}

                          {/* Struggle button - show when all moves have 0 uses */}
                          {Object.values(activeBattle.challenger.moves).every(
                            (move) => move.count === 0
                          ) && (
                            <button
                              onClick={() => handleAttack("struggle")}
                              disabled={
                                isUpdating ||
                                movesDisabled ||
                                activeBattle.status === "ended"
                              }
                              className={`absolute inset-0 m-auto w-32 h-32 p-2 rounded-lg font-medium transition-all duration-300 
                                bg-purple-500 hover:brightness-110 z-10
                                ${
                                  activeBattle.status === "ended" ||
                                  movesDisabled
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }
                                text-white overflow-hidden group flex flex-col justify-center items-center`}
                            >
                              <span className="capitalize text-lg mb-1">
                                Struggle
                              </span>
                              <span className="text-sm opacity-75 mb-2">
                                Last Resort
                              </span>
                              <span className="text-sm">⚔️ +1</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Opponent Moves */}
                    <div
                      className={`p-4 rounded-lg ${theme.container} bg-opacity-20`}
                    >
                      <h4 className="text-md font-semibold mb-3">
                        Accepter's Moves
                      </h4>
                      <div className="relative">
                        <div className="grid grid-cols-2 gap-2 relative">
                          {Object.entries(activeBattle.accepter.moves).map(
                            ([moveName, move]) => (
                              <button
                                key={moveName}
                                onClick={() => handleAttack(moveName)}
                                disabled={
                                  isUpdating ||
                                  movesDisabled ||
                                  activeBattle.status === "ended" ||
                                  move.count === 0
                                }
                                className={`w-full p-2 rounded-lg font-medium text-left transition-all duration-300 min-h-[80px]
                                ${getMoveColor(
                                  moveName,
                                  move
                                )} hover:brightness-110
                                ${
                                  activeBattle.status === "ended" ||
                                  movesDisabled ||
                                  move.count === 0
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }
                                text-white relative overflow-hidden group flex flex-col justify-between`}
                              >
                                <div className="flex justify-between items-center relative">
                                  <span className="capitalize">{moveName}</span>
                                  <span className="text-sm opacity-75">
                                    {move.count}
                                  </span>
                                </div>
                                {move.count === 0 && (
                                  <div className="absolute inset-0 bg-black/50 pointer-events-none">
                                    <div className="absolute inset-0 flex items-center">
                                      <div className="w-full h-0.5 bg-red-500 transform rotate-12"></div>
                                    </div>
                                  </div>
                                )}
                                <div className="text-sm mt-1">
                                  <div className="grid grid-cols-3 grid-rows-2 gap-1 max-w-[200px] min-h-[32px]">
                                    {move.damage !== 0 && (
                                      <span>
                                        ⚔️ {move.damage > 0 ? "+" : ""}
                                        {move.damage}
                                      </span>
                                    )}
                                    {move.attack !== 0 && (
                                      <span>
                                        💪 {move.attack > 0 ? "+" : ""}
                                        {move.attack}
                                      </span>
                                    )}
                                    {move.defense !== 0 && (
                                      <span>
                                        🛡️ {move.defense > 0 ? "+" : ""}
                                        {move.defense}
                                      </span>
                                    )}
                                    {move.speed !== 0 && (
                                      <span>
                                        ⚡ {move.speed > 0 ? "+" : ""}
                                        {move.speed}
                                      </span>
                                    )}
                                    {move.health !== 0 && (
                                      <span>
                                        ❤️ {move.health > 0 ? "+" : ""}
                                        {move.health}
                                      </span>
                                    )}
                                    {/* Add empty spans to maintain 3x2 grid layout */}
                                    {[
                                      ...Array(
                                        6 -
                                          [
                                            move.damage,
                                            move.attack,
                                            move.defense,
                                            move.speed,
                                            move.health,
                                          ].filter((v) => v !== 0).length
                                      ),
                                    ].map((_, i) => (
                                      <span key={i} className="invisible">
                                        placeholder
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-opacity duration-300"></div>
                              </button>
                            )
                          )}

                          {Object.values(activeBattle.accepter.moves).every(
                            (move) => move.count === 0
                          ) && (
                            <button
                              onClick={() => handleAttack("struggle")}
                              disabled={
                                isUpdating ||
                                movesDisabled ||
                                activeBattle.status === "ended"
                              }
                              className={`absolute inset-0 m-auto w-32 h-32 p-2 rounded-lg font-medium transition-all duration-300 
                                bg-purple-500 hover:brightness-110 z-10
                                ${
                                  activeBattle.status === "ended" ||
                                  movesDisabled
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }
                                text-white overflow-hidden group flex flex-col justify-center items-center`}
                            >
                              <span className="capitalize text-lg mb-1">
                                Struggle
                              </span>
                              <span className="text-sm opacity-75 mb-2">
                                Last Resort
                              </span>
                              <span className="text-sm">⚔️ +1</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
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