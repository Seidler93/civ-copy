import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { UPGRADE_CONFIG, BUILD_BASE_COST, MAX_ARTILLERY_UNITS, MAX_LOGISTICS_UNITS } from '../data/upgradeConfig';
import { unitCostForLevel, UNIT_TYPES } from '../data/unitTypes';
import ArmyPanel from '../components/ArmyPanel/ArmyPanel';
import BaseModal from '../components/BaseModal/BaseModal';
import CombatLog, { type CombatLogEntry } from '../components/CombatLog/CombatLog';
import GridMap from '../components/GridMap/GridMap';
import PlayerPanel from '../components/PlayerPanel/PlayerPanel';
import PlayerProgress from '../components/PlayerProgress/PlayerProgress';
import TalentTreeModal from '../components/TalentTreeModal/TalentTreeModal';
import TurnPanel from '../components/TurnPanel/TurnPanel';
import type { MovementSoundMode, OwnerTileColorMode, UnitHealthBarPosition, UnitStatDisplayMode, UnitStatLabelMode } from '../App';
import { effectiveUnitQualityLevel } from '../utils/trenchNetwork';
import {
  attackTile,
  advanceSimultaneousRound,
  buildBaseWithBuilder,
  buildTrenchWithBuilder,
  claimSupplyPlaneReward,
  combineArmies,
  devSpawnUnitAtTile,
  deploySmokeScreen,
  dismissUnitFromArmy,
  endTurn,
  fortifyArmy,
  healArmyWithMedic,
  moveArmy,
  placeMineWithAntiVehicle,
  queueArmyMove,
  recruitUnitAtBase,
  recruitUnitCompositionAtBase,
  reclaimBaseWithBuilder,
  scavengeSuppliesWithBuilder,
  separateUnitFromArmy,
  spendTalentPoint,
  setArmyMoveOrderMode,
  upgradeBaseBarracks,
  upgradeBaseDefense,
  upgradeBaseOffense,
  upgradeBaseUnitQuality,
  MAX_DEPLOYED_UNITS,
  clearArmyMoveOrder,
} from '../firebase/gameService';
import type { ArmyDoc, GameState, MoveOrderMode, MoveOutcome, PlayerDoc, TalentId, TileDoc, UnitTypeId } from '../types/gameTypes';
import {
  canAttackTile,
  ARTILLERY_UNIT_TYPES,
  canLogisticsBuildBase,
  canCombineArmies,
  canMoveArmy,
  getAttackStagingTile,
  isActiveBaseTile,
  isTileInAttackRange,
  isImpassableTerrain,
  manhattanDistance,
  movementAllowance,
  movementPath,
} from '../utils/movement';
import { effectiveBarracksLevel } from '../utils/trenchNetwork';

interface FloatingCombatText {
  id: string;
  tileId: string;
  text: string;
  tone: 'damage' | 'status';
}

interface MoveAnimation {
  id: string;
  tileId: string;
  fromX: number;
  fromY: number;
  durationMs: number;
}

interface BulletTrace {
  id: string;
  fromTileId: string;
  toTileId: string;
  delayMs: number;
  laneOffset: number;
  kind?: 'direct' | 'arc';
}

interface AttackFacing {
  id: string;
  armyId: string;
  angleDeg: number;
}

interface ArtilleryImpact {
  id: string;
  tileId: string;
}

interface QueuedMovePreview {
  tileId: string;
  turnsRemaining: number;
  mode: MoveOrderMode;
}

interface GameToast {
  id: string;
  title: string;
  message: string;
  tone: 'base' | 'danger' | 'score';
}

interface SupplyPlaneState {
  id: string;
  hits: number;
  top: string;
  durationMs: number;
  heading: 'east' | 'west';
  claiming: boolean;
}

type UnitInstanceEntry = [string, UnitTypeId];

interface CpuEconomicAction {
  kind: 'reclaimBase' | 'buildBase' | 'upgradeBarracks' | 'upgradeOffense' | 'upgradeDefense' | 'recruit';
  tile?: TileDoc;
  army?: ArmyDoc;
  unitTypeId?: UnitTypeId;
}

type BaseUpgradeAction = 'barracks' | 'defense' | 'offense' | `quality:${UnitTypeId}`;
const MOVE_ANIMATION_STEP_MS = 560;
const RIFLEMAN_SHOT_SOUND_PATH = '/audio/rifleman-shot.wav';
const UNIT_SELECT_SOUND_PATH = '/audio/default-unit-select.wav';
const UPGRADE_SOUND_PATH = '/audio/upgrade-sound.wav';
const BASE_BUILD_SOUND_PATH = '/audio/base-build-sound.wav';
const MOVEMENT_SOUND_PATH = '/audio/movement-sound.mp3';
const DEATH_SOUND_PATH = '/audio/death1.wav';
const SUPPLY_PLANE_SOUND_PATH = '/audio/default-button-click.wav';

interface GamePageProps {
  gameState: GameState;
  currentPlayer: PlayerDoc;
  devPlayerId: string;
  devSpawnUnitType: UnitTypeId | '';
  movementSoundMode: MovementSoundMode;
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitTileOwnerColorMode: OwnerTileColorMode;
  unitTileOwnerSolidIntensity: number;
  unitOwnerBarEnabled: boolean;
  unitStatDisplayMode: UnitStatDisplayMode;
  unitHealthBarPosition: UnitHealthBarPosition;
  unitDefenseValueVisible: boolean;
  unitStatLabelMode: UnitStatLabelMode;
  attackRadiusVisible: boolean;
  qualityTabHidden: boolean;
  onDevSpawnUnitTypeChange: (unitTypeId: UnitTypeId | '') => void;
}

export default function GamePage({
  gameState,
  currentPlayer,
  devPlayerId,
  devSpawnUnitType,
  movementSoundMode,
  unitTileOwnerTintEnabled,
  unitTileOwnerTintIntensity,
  unitTileOwnerColorMode,
  unitTileOwnerSolidIntensity,
  unitOwnerBarEnabled,
  unitStatDisplayMode,
  unitHealthBarPosition,
  unitDefenseValueVisible,
  unitStatLabelMode,
  attackRadiusVisible,
  qualityTabHidden,
  onDevSpawnUnitTypeChange,
}: GamePageProps) {
  const [selectedArmyId, setSelectedArmyId] = useState<string | null>(null);
  const [targetedAttackTileId, setTargetedAttackTileId] = useState<string | null>(null);
  const [targetedMergeTileId, setTargetedMergeTileId] = useState<string | null>(null);
  const [smokeTargetingArmyId, setSmokeTargetingArmyId] = useState<string | null>(null);
  const [selectedBaseTileId, setSelectedBaseTileId] = useState<string | null>(null);
  const [message, setMessage] = useState('Select one of your units to move.');
  const [combatTexts, setCombatTexts] = useState<FloatingCombatText[]>([]);
  const [moveAnimations, setMoveAnimations] = useState<MoveAnimation[]>([]);
  const [bulletTraces, setBulletTraces] = useState<BulletTrace[]>([]);
  const [attackFacings, setAttackFacings] = useState<AttackFacing[]>([]);
  const [artilleryImpacts, setArtilleryImpacts] = useState<ArtilleryImpact[]>([]);
  const [combatLogEntries, setCombatLogEntries] = useState<CombatLogEntry[]>([]);
  const [movementDebugEntries, setMovementDebugEntries] = useState<string[]>([]);
  const [queuedMovePreview, setQueuedMovePreview] = useState<QueuedMovePreview | null>(null);
  const [toasts, setToasts] = useState<GameToast[]>([]);
  const [supplyPlane, setSupplyPlane] = useState<SupplyPlaneState | null>(null);
  const [supplyPlaneStatus, setSupplyPlaneStatus] = useState<string | null>(null);
  const [isTalentTreeOpen, setIsTalentTreeOpen] = useState(false);
  const [busyTalentId, setBusyTalentId] = useState<TalentId | null>(null);
  const cpuTurnKeyRef = useRef('');
  const roundAdvanceKeyRef = useRef('');
  const previousActiveBaseIdsRef = useRef<Set<string> | null>(null);
  const previousPlayerUnitIdsRef = useRef<Map<string, UnitTypeId> | null>(null);
  const previousScoreLeaderIdRef = useRef<string | null>(null);
  const toastSnapshotKeyRef = useRef('');

  const selectedArmy = gameState.armies.find((army) => army.id === selectedArmyId) ?? null;
  const currentTurnPlayer = gameState.players.find((player) => player.id === gameState.game.currentTurnPlayerId) ?? null;
  const isTimedMode = gameState.game.mode === 'timed-simultaneous';
  const isDevSoloGame = import.meta.env.DEV && gameState.game.code === 'SOLO';
  const isMyTurn =
    gameState.game.status === 'active' &&
    !gameState.game.isPaused &&
    !currentPlayer.isEliminated &&
    (isTimedMode || gameState.game.currentTurnPlayerId === currentPlayer.id);
  const canLaunchSupplyPlane =
    gameState.game.status === 'active' &&
    !gameState.game.isPaused &&
    !isTimedMode &&
    !currentPlayer.isEliminated &&
    (!isMyTurn || isDevSoloGame) &&
    currentPlayer.lastSupplyPlaneRewardTurnNumber !== gameState.game.turnNumber;

  const tileById = useMemo(() => new Map(gameState.tiles.map((tile) => [tile.id, tile])), [gameState.tiles]);
  const selectedTile = selectedArmy ? tileById.get(selectedArmy.tileId) ?? null : null;
  const selectedArmyHasBaseDefenseBuff = Boolean(
    selectedArmy &&
      selectedTile &&
      gameState.tiles.some(
        (tile) =>
          tile.base?.ownerId === selectedArmy.ownerId &&
          !tile.base?.ruined &&
          Math.max(Math.abs(tile.x - selectedTile.x), Math.abs(tile.y - selectedTile.y)) <= 1,
      ),
  );
  const selectedBaseTile = selectedBaseTileId ? tileById.get(selectedBaseTileId) ?? null : null;
  const selectedQueuedDestinationTile = selectedArmy?.queuedMoveTileId ? tileById.get(selectedArmy.queuedMoveTileId) ?? null : null;
  const selectedQueuedMovePreview = useMemo(() => {
    if (!selectedArmy || !selectedTile || !selectedQueuedDestinationTile || selectedArmy.ownerId !== currentPlayer.id) return null;
    const path = movementPath(selectedTile, selectedQueuedDestinationTile, gameState.tiles, {
      armies: gameState.armies,
      passThroughOwnerId: selectedArmy.ownerId,
    });
    if (!path) return null;
    return {
      tileId: selectedQueuedDestinationTile.id,
      turnsRemaining: estimateQueuedMoveTurns(
        path.length,
        movementAllowance(currentPlayer, selectedArmy) - (selectedArmy.movementUsedThisTurn ?? 0),
        movementAllowance(currentPlayer, selectedArmy),
      ),
      mode: selectedArmy.queuedMoveMode ?? 'aggressive',
    } satisfies QueuedMovePreview;
  }, [currentPlayer, gameState.armies, gameState.tiles, selectedArmy, selectedQueuedDestinationTile, selectedTile]);

  function pushToast(toast: Omit<GameToast, 'id'>) {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((current) => [...current, { ...toast, id }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, 4200);
  }

  useEffect(() => {
    if (gameState.game.status !== 'active' || isTimedMode || currentPlayer.isEliminated) {
      setSupplyPlane(null);
      setSupplyPlaneStatus(null);
      return;
    }
    if (isMyTurn) {
      setSupplyPlane(null);
      setSupplyPlaneStatus('Supply planes return while it is your turn.');
      return;
    }
    if (gameState.game.isPaused) {
      setSupplyPlane(null);
      setSupplyPlaneStatus('Supply planes are grounded while the game is paused.');
      return;
    }
    if (currentPlayer.lastSupplyPlaneRewardTurnNumber === gameState.game.turnNumber) {
      setSupplyPlane(null);
      setSupplyPlaneStatus('Supply plane reward claimed for this turn.');
      return;
    }
    if (supplyPlane) {
      setSupplyPlaneStatus(`Hit the plane ${Math.max(0, 3 - supplyPlane.hits)} more time${3 - supplyPlane.hits === 1 ? '' : 's'} for bonus supplies.`);
      return;
    }
    setSupplyPlaneStatus('Spawn a supply plane and click it 3 times for bonus supplies.');
  }, [
    currentPlayer.isEliminated,
    currentPlayer.lastSupplyPlaneRewardTurnNumber,
    gameState.game.isPaused,
    gameState.game.status,
    gameState.game.turnNumber,
    isMyTurn,
    isTimedMode,
    supplyPlane,
  ]);

  useEffect(() => {
    const snapshotKey = `${gameState.game.id}:${currentPlayer.id}`;
    if (toastSnapshotKeyRef.current !== snapshotKey) {
      previousActiveBaseIdsRef.current = null;
      previousPlayerUnitIdsRef.current = null;
      previousScoreLeaderIdRef.current = null;
      toastSnapshotKeyRef.current = snapshotKey;
    }

    const activeBaseIds = new Set(
      gameState.tiles.filter((tile) => tile.base?.ownerId && !tile.base.ruined).map((tile) => tile.id),
    );
    const playerUnitIds = new Map<string, UnitTypeId>(
      gameState.armies
        .filter((army) => army.ownerId === currentPlayer.id)
        .flatMap((army) => army.units.map((unit) => [unit.id, unit.typeId] as UnitInstanceEntry)),
    );

    const previousActiveBaseIds = previousActiveBaseIdsRef.current;
    const previousPlayerUnitIds = previousPlayerUnitIdsRef.current;

    if (previousActiveBaseIds) {
      gameState.tiles.forEach((tile) => {
        if (!tile.base?.ownerId || tile.base.ruined || previousActiveBaseIds.has(tile.id)) return;
        const ownerName = gameState.players.find((player) => player.id === tile.base?.ownerId)?.name ?? 'A player';
        pushToast({
          title: 'Base Built',
          message: `${ownerName} built a base at ${tile.x}, ${tile.y}.`,
          tone: 'base',
        });
      });
    }

    if (previousPlayerUnitIds) {
      previousPlayerUnitIds.forEach((typeId, unitId) => {
        if (playerUnitIds.has(unitId)) return;
        pushToast({
          title: 'Squad Lost',
          message: `Your ${UNIT_TYPES[typeId]?.name ?? 'squad'} was killed.`,
          tone: 'danger',
        });
        playUiSound(DEATH_SOUND_PATH, 0.52);
      });
    }

    const scoreLeader = gameState.game.turnLimitRounds ? scoreLeaderForPlayers(gameState.players) : null;
    const previousScoreLeaderId = previousScoreLeaderIdRef.current;
    if (scoreLeader && previousScoreLeaderId && scoreLeader.id !== previousScoreLeaderId) {
      pushToast({
        title: 'Lead Change',
        message: `${scoreLeader.name} took the score lead with ${scoreLeader.score} XP.`,
        tone: 'score',
      });
    }

    previousActiveBaseIdsRef.current = activeBaseIds;
    previousPlayerUnitIdsRef.current = playerUnitIds;
    previousScoreLeaderIdRef.current = scoreLeader?.id ?? null;
  }, [currentPlayer.id, gameState.armies, gameState.game.id, gameState.game.turnLimitRounds, gameState.players, gameState.tiles]);
  const deployedUnits = gameState.armies
    .filter((army) => army.ownerId === currentPlayer.id)
    .reduce((total, army) => total + army.units.length, 0);
  const selectedDevPlayerId = devPlayerId || currentPlayer.id;

  useEffect(() => {
    if (!isTimedMode || gameState.game.status !== 'active' || gameState.game.isPaused || !gameState.game.roundEndsAtMs) return undefined;

    const timeoutMs = Math.max(0, gameState.game.roundEndsAtMs - Date.now());
    const roundKey = `${gameState.game.id}:${gameState.game.roundNumber}`;
    roundAdvanceKeyRef.current = roundKey;
    const timer = window.setTimeout(() => {
      if (roundAdvanceKeyRef.current !== roundKey) return;
      void advanceSimultaneousRound(gameState.game.id).catch(() => undefined);
    }, timeoutMs + 50);

    return () => window.clearTimeout(timer);
  }, [
    gameState.game.id,
    gameState.game.isPaused,
    gameState.game.mode,
    gameState.game.roundEndsAtMs,
    gameState.game.roundNumber,
    gameState.game.status,
    isTimedMode,
  ]);

  useEffect(() => {
    if (!queuedMovePreview) return;
    const timer = window.setTimeout(() => setQueuedMovePreview(null), 2600);
    return () => window.clearTimeout(timer);
  }, [queuedMovePreview]);

  useEffect(() => {
    if (isTimedMode) return undefined;
    const cpuPlayer = currentTurnPlayer?.isCpu ? currentTurnPlayer : null;
    if (!cpuPlayer || gameState.game.status !== 'active' || gameState.game.isPaused) return;

    const turnKey = `${gameState.game.id}:${gameState.game.roundNumber}:${gameState.game.turnNumber}:${cpuPlayer.id}`;
    if (cpuTurnKeyRef.current === turnKey) return;
    cpuTurnKeyRef.current = turnKey;

    setSelectedArmyId(null);
    setTargetedAttackTileId(null);
    setTargetedMergeTileId(null);
    setMessage(`${cpuPlayer.name} is thinking...`);

    const timer = window.setTimeout(() => {
      void runCpuTurn(cpuPlayer);
    }, 750);

    return () => window.clearTimeout(timer);
  }, [currentTurnPlayer, gameState, isTimedMode]);

  useEffect(() => {
    const cpuPlayer = gameState.players.find((player) => player.isCpu) ?? null;
    if (!isTimedMode || !cpuPlayer || gameState.game.status !== 'active' || gameState.game.isPaused || cpuPlayer.isEliminated) return;

    const cpuArmies = gameState.armies.filter((army) => army.ownerId === cpuPlayer.id);
    if (cpuArmies.every((army) => army.hasActedThisTurn && (army.movementUsedThisTurn ?? 0) > 0)) return;

    const roundKey = `${gameState.game.id}:${gameState.game.roundNumber}:${cpuPlayer.id}`;
    if (cpuTurnKeyRef.current === roundKey) return;
    cpuTurnKeyRef.current = roundKey;

    const timer = window.setTimeout(() => {
      void runCpuTurn(cpuPlayer);
    }, 750);

    return () => window.clearTimeout(timer);
  }, [gameState, isTimedMode]);

  async function runCpuTurn(cpuPlayer: PlayerDoc) {
    if (gameState.game.isPaused) return;

    try {
      const economyAction = chooseCpuEconomicAction(cpuPlayer, gameState.tiles, gameState.armies);
      let plannedTiles = gameState.tiles;
      let plannedArmies = gameState.armies;

      if (economyAction) {
        if (economyAction.kind === 'reclaimBase' && economyAction.army) {
          setMessage(`${cpuPlayer.name} reclaims a ruined base.`);
          await reclaimBaseWithBuilder(gameState.game.id, economyAction.army.id, cpuPlayer.id);
          showCombatText(economyAction.army.tileId, '+Base');
          ({ tiles: plannedTiles, armies: plannedArmies } = projectCpuEconomyAction(plannedTiles, plannedArmies, economyAction, cpuPlayer.id));
          await delay(250);
        } else if (economyAction.kind === 'buildBase' && economyAction.army) {
          setMessage(`${cpuPlayer.name} establishes a forward base.`);
          await buildBaseWithBuilder(gameState.game.id, economyAction.army.id, cpuPlayer.id);
          showCombatText(economyAction.army.tileId, '+Base');
          ({ tiles: plannedTiles, armies: plannedArmies } = projectCpuEconomyAction(plannedTiles, plannedArmies, economyAction, cpuPlayer.id));
          await delay(250);
        } else if (economyAction.kind === 'upgradeBarracks' && economyAction.tile) {
          setMessage(`${cpuPlayer.name} expands military production.`);
          await upgradeBaseBarracks(gameState.game.id, economyAction.tile.id, cpuPlayer.id);
        } else if (economyAction.kind === 'upgradeOffense' && economyAction.tile) {
          setMessage(`${cpuPlayer.name} arms a base for overwatch fire.`);
          await upgradeBaseOffense(gameState.game.id, economyAction.tile.id, cpuPlayer.id);
        } else if (economyAction.kind === 'upgradeDefense' && economyAction.tile) {
          setMessage(`${cpuPlayer.name} hardens a frontline base.`);
          await upgradeBaseDefense(gameState.game.id, economyAction.tile.id, cpuPlayer.id);
        } else if (economyAction.kind === 'recruit' && economyAction.tile && economyAction.unitTypeId) {
          setMessage(`${cpuPlayer.name} recruits ${UNIT_TYPES[economyAction.unitTypeId].name}.`);
          await recruitUnitAtBase(gameState.game.id, economyAction.tile.id, economyAction.unitTypeId, cpuPlayer.id);
        }
      }

      const cpuArmies = plannedArmies.filter((army) => army.ownerId === cpuPlayer.id && army.units.length > 0);
      const attack = findCpuAttack(cpuPlayer, cpuArmies, plannedTiles, plannedArmies, gameState.game.roundNumber);
      if (attack) {
        setMessage(`${cpuPlayer.name} attacks.`);
        playAttackAnimation(attack.army, attack.fromTile, attack.targetTile, attack.defenderArmy);
        await attackTile(gameState.game.id, attack.army.id, attack.targetTile.id, cpuPlayer.id);
        await delay(900);
        if (!isTimedMode) await endTurn(gameState.game.id, cpuPlayer.id);
        return;
      }

      const move = findCpuMove(cpuPlayer, cpuArmies, plannedTiles, plannedArmies);
      if (move) {
        setMessage(`${cpuPlayer.name} advances.`);
        const path = movementPath(move.fromTile, move.targetTile, plannedTiles, {
          armies: plannedArmies,
          passThroughOwnerId: move.army.ownerId,
        });
        const stepCount = Math.max(1, path?.length ?? 1);
        const durationMs = moveAnimationDuration(stepCount);
        playMovementSound(stepCount, movementSoundMode, durationMs);
        const result = await moveArmy(gameState.game.id, move.army.id, move.targetTile.id, cpuPlayer.id);
        addMovementDebug(result, `${cpuPlayer.name} move`);
        showMoveAnimation(move.targetTile, move.fromTile, durationMs);
        if (result.triggeredMineTileId && result.mineDamage) showCombatText(result.triggeredMineTileId, `-${result.mineDamage}`);
        if (result.sentryDamage) {
          const sentryTargetTileId = result.sentryTriggerTileId ?? move.targetTile.id;
          if (result.sentryBaseTileId) showBulletTraces(result.sentryBaseTileId, sentryTargetTileId, Math.max(120, durationMs - 260));
          showCombatText(sentryTargetTileId, `-${result.sentryDamage}`);
        }
        if (result.sentryReturnFirePower && result.sentryBaseTileId) {
          showBulletTraces(result.sentryTriggerTileId ?? move.targetTile.id, result.sentryBaseTileId, Math.max(220, durationMs - 140));
          showCombatText(result.sentryBaseTileId, result.sentryBaseDestroyed ? 'Base down' : `A${result.sentryReturnFirePower}`);
        }
        await delay(durationMs + 250);
      }

      if (!isTimedMode) await endTurn(gameState.game.id, cpuPlayer.id);
    } catch (err) {
      setMessage(err instanceof Error ? `CPU turn stopped: ${err.message}` : 'CPU turn stopped.');
      if (!isTimedMode) {
        window.setTimeout(() => {
          void endTurn(gameState.game.id, cpuPlayer.id).catch(() => undefined);
        }, 900);
      }
    }
  }

  async function handleTileClick(tile: TileDoc, occupyingArmy: ArmyDoc | null) {
    if (gameState.game.isPaused) {
      setTargetedAttackTileId(null);
      setTargetedMergeTileId(null);
      if (occupyingArmy) {
        setSelectedArmyId(selectedArmyId === occupyingArmy.id ? null : occupyingArmy.id);
        setMessage('Gameplay is paused. You can inspect the map, but actions are locked.');
      } else if (tile.base?.ownerId === currentPlayer.id) {
        setSelectedBaseTileId(tile.id);
        setMessage('Gameplay is paused. Base management is view-only until the host resumes.');
      } else {
        setMessage('Gameplay is paused by the host.');
      }
      return;
    }

    if (import.meta.env.DEV && devSpawnUnitType) {
      try {
        const result = await devSpawnUnitAtTile(gameState.game.id, selectedDevPlayerId, devSpawnUnitType, tile.id);
        setMessage(result);
        showCombatText(tile.id, '+Spawn');
        onDevSpawnUnitTypeChange('');
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Dev spawn failed.');
      }
      return;
    }

    if (smokeTargetingArmyId) {
      const smokeArmy = gameState.armies.find((army) => army.id === smokeTargetingArmyId) ?? null;
      const smokeFromTile = smokeArmy ? tileById.get(smokeArmy.tileId) ?? null : null;
      if (!smokeArmy || !smokeFromTile || smokeArmy.ownerId !== currentPlayer.id) {
        setSmokeTargetingArmyId(null);
        setMessage('Smoke Screen targeting cancelled.');
        return;
      }
      if (occupyingArmy?.id === smokeTargetingArmyId) {
        cancelSmokeTargeting();
        return;
      }
      if (!isMyTurn || !isTileInAttackRange(smokeArmy, smokeFromTile, tile, gameState.tiles)) {
        setMessage('Choose a highlighted tile within Smoke Screen range and line of sight.');
        return;
      }
      try {
        playAttackAnimation(smokeArmy, smokeFromTile, tile, null);
        const result = await deploySmokeScreen(gameState.game.id, smokeArmy.id, tile.id, currentPlayer.id);
        smokeAreaTiles(tile, gameState.tiles).forEach((smokeTile) => showCombatText(smokeTile.id, 'Smoke'));
        setSmokeTargetingArmyId(null);
        setTargetedAttackTileId(null);
        setTargetedMergeTileId(null);
        setMessage(result);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Smoke Screen failed.');
      }
      return;
    }

    const selectedArmyCanMerge =
      selectedArmy &&
      selectedTile &&
      occupyingArmy &&
      selectedArmy.ownerId === currentPlayer.id &&
      occupyingArmy.ownerId === currentPlayer.id &&
      isMyTurn &&
      canCombineArmies(
        selectedArmy,
        occupyingArmy,
        selectedTile,
        tile,
        currentPlayer,
        gameState.tiles,
        gameState.armies,
        gameState.game.allowMixedUnitCombines ?? false,
      );

    if (selectedArmyCanMerge) {
      setQueuedMovePreview(null);
      setSmokeTargetingArmyId(null);
      setTargetedAttackTileId(null);
      setTargetedMergeTileId(targetedMergeTileId === tile.id ? null : tile.id);
      setMessage('Friendly unit selected. Click Combine to merge these squads.');
      return;
    }

    const selectedArmyCanTarget =
      selectedArmy &&
      selectedTile &&
      selectedArmy.ownerId === currentPlayer.id &&
      isMyTurn &&
      ((occupyingArmy && occupyingArmy.ownerId !== currentPlayer.id) ||
        (tile.base && !tile.base.ruined && tile.base.ownerId !== currentPlayer.id)) &&
      getAttackStagingTile(gameState.tiles, selectedArmy, selectedTile, tile, currentPlayer, gameState.armies, gameState.game.roundNumber);

    if (selectedArmyCanTarget) {
      setQueuedMovePreview(null);
      setSmokeTargetingArmyId(null);
      setTargetedMergeTileId(null);
      setTargetedAttackTileId(targetedAttackTileId === tile.id ? null : tile.id);
      setMessage('Target selected. Click Attack to start combat.');
      return;
    }

    setTargetedAttackTileId(null);
    setTargetedMergeTileId(null);
    setSmokeTargetingArmyId(null);

    if (occupyingArmy) {
      setQueuedMovePreview(null);
      const nextSelectedId = selectedArmyId === occupyingArmy.id ? null : occupyingArmy.id;
      setSelectedArmyId(nextSelectedId);
      if (!nextSelectedId) {
        setMessage('Unit unselected.');
      } else if (occupyingArmy.ownerId === currentPlayer.id && isMyTurn) {
        playUiSound(UNIT_SELECT_SOUND_PATH, 0.42);
        setMessage('Choose a highlighted destination, or use Attack on an enemy in range.');
      } else {
        playUiSound(UNIT_SELECT_SOUND_PATH, 0.32);
        setMessage('Inspecting unit details.');
      }
      return;
    }

    if (!selectedArmy || !selectedTile) return;
    if (!isMyTurn) {
      setMessage('You can only move during your turn.');
      return;
    }
    if (selectedArmy.ownerId !== currentPlayer.id) {
      setMessage('You can inspect enemy units, but only move your own.');
      return;
    }

    try {
      const path = movementPath(selectedTile, tile, gameState.tiles, {
        armies: gameState.armies,
        passThroughOwnerId: selectedArmy.ownerId,
      });
      if (!path || path.length === 0) {
        setMessage('That tile is out of range or occupied.');
        return;
      }

      const canMoveDirectly = canMoveArmy(selectedArmy, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies);
      if (!canMoveDirectly) {
        if (
          isTimedMode &&
          !tile.armyId &&
          !isActiveBaseTile(tile) &&
          !isImpassableTerrain(tile) &&
          selectedArmy.queuedMoveTileId !== tile.id
        ) {
          const turnsRemaining = estimateQueuedMoveTurns(
            path.length,
            movementAllowance(currentPlayer, selectedArmy) - (selectedArmy.movementUsedThisTurn ?? 0),
            movementAllowance(currentPlayer, selectedArmy),
          );
          const result = await queueArmyMove(gameState.game.id, selectedArmy.id, tile.id, currentPlayer.id, 'aggressive');
          setQueuedMovePreview({ tileId: tile.id, turnsRemaining, mode: 'aggressive' });
          setMessage(result);
          return;
        }

        setMessage('That tile is out of range or occupied.');
        return;
      }

      let latestMessage = '';
      const movementWaypoints = path.filter((stepTile) => !stepTile.armyId && !isActiveBaseTile(stepTile));
      if (movementWaypoints.length > 0) {
        const finalTile = movementWaypoints[movementWaypoints.length - 1];
        const result = await moveArmy(gameState.game.id, selectedArmy.id, finalTile.id, currentPlayer.id);
        latestMessage = result.message;
        addMovementDebug(result, 'Your move');
        const durationMs = moveAnimationDuration(movementWaypoints.length);
        playMovementSound(movementWaypoints.length, movementSoundMode, durationMs);
        if (result.triggeredMineTileId && result.mineDamage) {
          showCombatText(result.triggeredMineTileId, `-${result.mineDamage}`);
        }
        if (result.sentryDamage) {
          const sentryTargetTileId = result.sentryTriggerTileId ?? finalTile.id;
          if (result.sentryBaseTileId) showBulletTraces(result.sentryBaseTileId, sentryTargetTileId, Math.max(120, durationMs - 260));
          showCombatText(sentryTargetTileId, `-${result.sentryDamage}`);
        }
        if (result.sentryReturnFirePower && result.sentryBaseTileId) {
          showBulletTraces(result.sentryTriggerTileId ?? finalTile.id, result.sentryBaseTileId, Math.max(220, durationMs - 140));
          showCombatText(result.sentryBaseTileId, result.sentryBaseDestroyed ? 'Base down' : `A${result.sentryReturnFirePower}`);
        }
        if (result.armyDestroyed) {
          setSelectedArmyId(null);
          setTargetedAttackTileId(null);
          setTargetedMergeTileId(null);
          setMessage(result.message);
          return;
        }
        showMoveAnimation(finalTile, selectedTile, durationMs);
        await delay(durationMs);
      }
      setQueuedMovePreview(null);
      setTargetedAttackTileId(null);
      setTargetedMergeTileId(null);
      setMessage(latestMessage || `Unit moved to ${tile.x}, ${tile.y}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Move failed.');
    }
  }

  async function handleAttackClick(tile: TileDoc) {
    if (isGameplayPaused()) return;
    if (!selectedArmy || !isMyTurn) return;

    try {
      const defenderArmy = tile.armyId ? gameState.armies.find((army) => army.id === tile.armyId) ?? null : null;
      if (selectedTile) {
        playAttackAnimation(selectedArmy, selectedTile, tile, defenderArmy);
      }

      const result = await attackTile(gameState.game.id, selectedArmy.id, tile.id, currentPlayer.id);
      setTargetedAttackTileId(null);
      setMessage(result.message);
      showCombatText(result.attackerTileId, result.attackerLosses > 0 ? `-${result.attackerLosses * 10}` : 'Blocked');
      showCombatText(result.defenderTileId, result.defenderLosses > 0 ? `-${result.defenderLosses * 10}` : 'Blocked');
      if (result.defenderDestroyed || result.attackerLosses > 0) {
        playUiSound(DEATH_SOUND_PATH, result.defenderDestroyed ? 0.5 : 0.36);
      }
      setCombatLogEntries((current) => [
        {
          id: `${Date.now()}_${Math.random()}`,
          title: `Attack on ${tile.x}, ${tile.y}`,
          attackerTileId: result.attackerTileId,
          defenderTileId: result.defenderTileId,
          attackRoll: result.attackRoll,
          defenseRoll: result.defenseRoll,
          attackPower: result.attackPower,
          defensePower: result.defensePower,
          attackSupportBonus: result.attackSupportBonus,
          margin: result.attackPower - result.defensePower,
          attackerDamage: result.attackerLosses * 10,
          defenderDamage: result.defenderLosses * 10,
          xpGained: result.xpGained,
          suppliesGained: result.suppliesGained,
          defenderSuppliesGained: result.defenderSuppliesGained,
          unitXpGained: result.unitXpGained,
          result: result.baseDestroyed
            ? 'Base ruined'
            : result.defenderDestroyed
              ? 'Unit destroyed'
              : result.attackPower > result.defensePower
                ? 'Hit landed'
                : 'Attack repelled',
        },
        ...current,
      ].slice(0, 8));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Attack failed.');
    }
  }

  async function handleCombineClick(targetArmy: ArmyDoc) {
    if (isGameplayPaused()) return;
    if (!selectedArmy || !isMyTurn) return;

    try {
      const result = await combineArmies(gameState.game.id, selectedArmy.id, targetArmy.id, currentPlayer.id);
      setSelectedArmyId(result.targetArmyId);
      setTargetedMergeTileId(null);
      setTargetedAttackTileId(null);
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Combine failed.');
    }
  }

  async function handleDismissUnit(unitId: string) {
    if (isGameplayPaused()) return;
    if (!selectedArmy) return;

    try {
      const result = await dismissUnitFromArmy(gameState.game.id, selectedArmy.id, unitId, currentPlayer.id);
      if (result.armyRemoved) {
        setSelectedArmyId(null);
      }
      setTargetedMergeTileId(null);
      setTargetedAttackTileId(null);
      setMessage(result.message);
      showCombatText(selectedArmy.tileId, '-Squad');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not dismiss squad.');
    }
  }

  async function handleSeparateUnit(unitId: string) {
    if (isGameplayPaused()) return;
    if (!selectedArmy) return;

    try {
      const result = await separateUnitFromArmy(gameState.game.id, selectedArmy.id, unitId, currentPlayer.id);
      setSelectedArmyId(result.newArmyId);
      setTargetedMergeTileId(null);
      setTargetedAttackTileId(null);
      setMessage(result.message);
      showCombatText(selectedArmy.tileId, 'Split');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not separate squad.');
    }
  }

  async function handleBuildBaseClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await buildBaseWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      playUiSound(BASE_BUILD_SOUND_PATH, 0.5);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Build failed.');
    }
  }

  async function handleBuildTrenchClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await buildTrenchWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Trench');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Trench failed.');
    }
  }

  async function handleReclaimBaseClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await reclaimBaseWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Base');
      playUiSound(BASE_BUILD_SOUND_PATH, 0.42);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Base reclaim failed.');
    }
  }

  async function handleScavengeClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await scavengeSuppliesWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Supplies');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Scavenge failed.');
    }
  }

  async function handleHealClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await healArmyWithMedic(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Heal');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Heal failed.');
    }
  }

  async function handlePlaceMineClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await placeMineWithAntiVehicle(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Mine');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Mine placement failed.');
    }
  }

  function handleSmokeScreenClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    if (!isMyTurn || army.ownerId !== currentPlayer.id || army.hasActedThisTurn) return;
    setSelectedArmyId(army.id);
    setSmokeTargetingArmyId(army.id);
    setTargetedAttackTileId(null);
    setTargetedMergeTileId(null);
    setQueuedMovePreview(null);
    setMessage('Smoke Screen ready. Hover to preview the 2x2 smoke area, then click a highlighted tile to fire.');
  }

  function cancelSmokeTargeting() {
    setSmokeTargetingArmyId(null);
    setMessage('Smoke Screen targeting cancelled.');
  }

  async function handleFortifyClick(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await fortifyArmy(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Fortify');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Fortify failed.');
    }
  }

  async function handleSetMoveOrderMode(army: ArmyDoc, mode: MoveOrderMode) {
    if (isGameplayPaused()) return;
    try {
      const result = await setArmyMoveOrderMode(gameState.game.id, army.id, currentPlayer.id, mode);
      if (selectedQueuedMovePreview) {
        setQueuedMovePreview({ ...selectedQueuedMovePreview, mode });
      }
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not change move order.');
    }
  }

  async function handleClearMoveOrder(army: ArmyDoc) {
    if (isGameplayPaused()) return;
    try {
      const result = await clearArmyMoveOrder(gameState.game.id, army.id, currentPlayer.id);
      setQueuedMovePreview(null);
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not clear move order.');
    }
  }

  async function handleBaseClick(tile: TileDoc) {
    if (tile.base?.ownerId !== currentPlayer.id) {
      setMessage('You can only manage your own bases.');
      return;
    }
    setSelectedBaseTileId(tile.id);
  }

  async function handleRecruit(unitTypeId: UnitTypeId) {
    if (isGameplayPaused()) return;
    if (!selectedBaseTile) return;
    try {
      const result = await recruitUnitAtBase(gameState.game.id, selectedBaseTile.id, unitTypeId, currentPlayer.id);
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Recruitment failed.');
    }
  }

  async function handleRecruitComposition(compositionId: string) {
    if (isGameplayPaused()) return;
    if (!selectedBaseTile) return;
    try {
      const result = await recruitUnitCompositionAtBase(gameState.game.id, selectedBaseTile.id, compositionId, currentPlayer.id);
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unit recruitment failed.');
    }
  }

  async function handleBaseUpgrade(action: BaseUpgradeAction) {
    if (isGameplayPaused()) return;
    if (!selectedBaseTile) return;
    try {
      const result =
        action === 'barracks'
          ? await upgradeBaseBarracks(gameState.game.id, selectedBaseTile.id, currentPlayer.id)
          : action === 'defense'
            ? await upgradeBaseDefense(gameState.game.id, selectedBaseTile.id, currentPlayer.id)
            : action === 'offense'
              ? await upgradeBaseOffense(gameState.game.id, selectedBaseTile.id, currentPlayer.id)
              : await upgradeBaseUnitQuality(
                  gameState.game.id,
                  selectedBaseTile.id,
                  action.replace('quality:', '') as UnitTypeId,
                  currentPlayer.id,
                );
      setMessage(result);
      playUiSound(UPGRADE_SOUND_PATH, 0.46);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upgrade failed.');
    }
  }

  async function handleSpendTalent(talentId: TalentId) {
    if (isGameplayPaused()) return;
    setBusyTalentId(talentId);
    try {
      const result = await spendTalentPoint(gameState.game.id, currentPlayer.id, talentId);
      setMessage(result);
      playUiSound(UPGRADE_SOUND_PATH, 0.46);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not spend skill point.');
    } finally {
      setBusyTalentId(null);
    }
  }

  function isGameplayPaused() {
    if (!gameState.game.isPaused) return false;
    setMessage('Gameplay is paused. You can inspect the map, but actions are locked until the host resumes.');
    return true;
  }

  function showCombatText(tileId: string, text: string) {
    const id = `${tileId}_${Date.now()}_${Math.random()}`;
    setCombatTexts((current) => [...current, { id, tileId, text, tone: text.startsWith('-') ? 'damage' : 'status' }]);
    window.setTimeout(() => {
      setCombatTexts((current) => current.filter((entry) => entry.id !== id));
    }, 1300);
  }

  function addMovementDebug(result: MoveOutcome, label: string) {
    const debugLines = result.debugLines ?? [];
    if (debugLines.length === 0) return;
    const timestamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    setMovementDebugEntries((current) =>
      [`[${timestamp}] ${label}: ${result.message}`, ...debugLines.map((line) => `  ${line}`), ...current].slice(0, 18),
    );
  }

  function handleLaunchSupplyPlane() {
    if (!canLaunchSupplyPlane || supplyPlane) return;
    setSupplyPlane({
      id: crypto.randomUUID(),
      hits: 0,
      top: `${16 + Math.random() * 38}%`,
      durationMs: 6400 + Math.floor(Math.random() * 1200),
      heading: Math.random() > 0.5 ? 'east' : 'west',
      claiming: false,
    });
    setSupplyPlaneStatus('Plane in the air. Hit it 3 times before it escapes.');
    playUiSound(SUPPLY_PLANE_SOUND_PATH, 0.32);
  }

  async function handleSupplyPlaneHit() {
    if (!supplyPlane || supplyPlane.claiming) return;
    const nextHits = supplyPlane.hits + 1;
    playUiSound(RIFLEMAN_SHOT_SOUND_PATH, 0.22);
    if (nextHits < 3) {
      setSupplyPlane((current) => (current ? { ...current, hits: nextHits } : current));
      setSupplyPlaneStatus(`Direct hit. ${3 - nextHits} more to claim the supplies.`);
      return;
    }

    setSupplyPlane((current) => (current ? { ...current, hits: nextHits, claiming: true } : current));
    try {
      const result = await claimSupplyPlaneReward(gameState.game.id, currentPlayer.id);
      setSupplyPlane(null);
      setSupplyPlaneStatus('Supply plane intercepted. Reward secured.');
      setMessage(result);
      pushToast({
        title: 'Supply Drop',
        message: result,
        tone: 'score',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Supply plane reward failed.';
      setSupplyPlane(null);
      setSupplyPlaneStatus(errorMessage);
      setMessage(errorMessage);
    }
  }

  function handleSupplyPlaneEscape() {
    if (!supplyPlane || supplyPlane.claiming) return;
    setSupplyPlane(null);
    setSupplyPlaneStatus('The supply plane escaped. Launch another one while you wait.');
  }

  function showMoveAnimation(tile: TileDoc, fromTile: TileDoc, durationMs = MOVE_ANIMATION_STEP_MS) {
    const id = `${tile.id}_${Date.now()}_${Math.random()}`;
    setMoveAnimations((current) => [
      ...current,
      { id, tileId: tile.id, fromX: fromTile.x - tile.x, fromY: fromTile.y - tile.y, durationMs },
    ]);
    window.setTimeout(() => {
      setMoveAnimations((current) => current.filter((entry) => entry.id !== id));
    }, durationMs + 160);
  }

  function showBulletTraces(fromTileId: string, toTileId: string, startOffsetMs = 0) {
    const idPrefix = `${fromTileId}_${toTileId}_${Date.now()}`;
    const laneOffsets = [-3, -1, 1, 3, 0, -2, 2, 0, -3, 3, -1, 1];
    const traces = Array.from({ length: 12 }, (_, index) => ({
      id: `${idPrefix}_${index}`,
      fromTileId,
      toTileId,
      delayMs: Math.max(0, startOffsetMs + index * 70),
      laneOffset: laneOffsets[index % laneOffsets.length],
      kind: 'direct' as const,
    }));
    setBulletTraces((current) => [...current, ...traces]);
    window.setTimeout(() => {
      setBulletTraces((current) => current.filter((entry) => !entry.id.startsWith(idPrefix)));
    }, 1650);
  }

  function showArtilleryShells(fromTileId: string, toTileId: string, startOffsetMs = 0) {
    const idPrefix = `shell_${fromTileId}_${toTileId}_${Date.now()}`;
    const laneOffsets = [-10, 0, 10, -4, 6];
    const traces = Array.from({ length: 5 }, (_, index) => ({
      id: `${idPrefix}_${index}`,
      fromTileId,
      toTileId,
      delayMs: Math.max(0, startOffsetMs + index * 115),
      laneOffset: laneOffsets[index % laneOffsets.length],
      kind: 'arc' as const,
    }));
    setBulletTraces((current) => [...current, ...traces]);
    window.setTimeout(() => {
      setBulletTraces((current) => current.filter((entry) => !entry.id.startsWith(idPrefix)));
    }, 1900);
  }

  function showAttackFacing(armyId: string, fromTile: TileDoc, toTile: TileDoc) {
    const id = `${armyId}_${Date.now()}_${Math.random()}`;
    const angleDeg = Math.atan2(toTile.y - fromTile.y, toTile.x - fromTile.x) * (180 / Math.PI) + 90;
    setAttackFacings((current) => [...current.filter((entry) => entry.armyId !== armyId), { id, armyId, angleDeg }]);
    window.setTimeout(() => {
      setAttackFacings((current) => current.filter((entry) => entry.id !== id));
    }, 1700);
  }

  function showArtilleryImpact(tileId: string, delayMs = 0) {
    const id = `${tileId}_${Date.now()}_${Math.random()}`;
    window.setTimeout(() => {
      setArtilleryImpacts((current) => [...current, { id, tileId }]);
    }, delayMs);
    window.setTimeout(() => {
      setArtilleryImpacts((current) => current.filter((entry) => entry.id !== id));
    }, delayMs + 1200);
  }

  function playAttackAnimation(attacker: ArmyDoc, fromTile: TileDoc, targetTile: TileDoc, defender: ArmyDoc | null) {
    const attackerUsesArtillery = attacker.units.length === 1 && ARTILLERY_UNIT_TYPES.has(attacker.units[0].typeId);
    showAttackFacing(attacker.id, fromTile, targetTile);
    if (attackerUsesArtillery) {
      showArtilleryShells(fromTile.id, targetTile.id);
      showArtilleryImpact(targetTile.id, 620);
    } else {
      showBulletTraces(fromTile.id, targetTile.id);
      playRiflemanShotBurst(attacker);
    }

    if (!defender) return;
    if (!isTileInAttackRange(defender, targetTile, fromTile, gameState.tiles)) return;
    const defenderUsesArtillery = defender.units.length === 1 && ARTILLERY_UNIT_TYPES.has(defender.units[0].typeId);
    showAttackFacing(defender.id, targetTile, fromTile);
    if (defenderUsesArtillery) {
      showArtilleryShells(targetTile.id, fromTile.id, 180);
      showArtilleryImpact(fromTile.id, 800);
    } else {
      showBulletTraces(targetTile.id, fromTile.id, 90);
      playRiflemanShotBurst(defender, 120);
    }
  }

  return (
    <section className="game-page">
      <aside className="left-rail">
        <TurnPanel
          game={gameState.game}
          currentPlayer={currentPlayer}
          turnPlayer={currentTurnPlayer}
          canLaunchSupplyPlane={canLaunchSupplyPlane && !supplyPlane}
          supplyPlaneStatus={supplyPlaneStatus}
          onLaunchSupplyPlane={handleLaunchSupplyPlane}
        />
        <PlayerPanel players={gameState.players} currentPlayerId={currentPlayer.id} />
        <ArmyPanel
          army={selectedArmy}
          owner={selectedArmy ? gameState.players.find((p) => p.id === selectedArmy.ownerId) ?? null : null}
          hasBaseDefenseBuff={selectedArmyHasBaseDefenseBuff}
          hasTrenchBuff={Boolean(selectedTile?.trench)}
          currentPlayer={currentPlayer}
          isMyTurn={isMyTurn}
          onDismissUnit={handleDismissUnit}
          onSeparateUnit={handleSeparateUnit}
        />
      </aside>
      <div className="map-stage">
        {supplyPlane && (
          <button
            className={`supply-plane-overlay ${supplyPlane.heading === 'west' ? 'heading-west' : ''}`}
            type="button"
            style={
              {
                top: supplyPlane.top,
                '--plane-duration': `${supplyPlane.durationMs}ms`,
              } as CSSProperties
            }
            onClick={handleSupplyPlaneHit}
            onAnimationEnd={handleSupplyPlaneEscape}
            aria-label={`Supply plane with ${Math.max(0, 3 - supplyPlane.hits)} hits remaining`}
          >
            <span className="supply-plane-body" aria-hidden="true" />
            <span className="supply-plane-hit-counter">{Math.max(0, 3 - supplyPlane.hits)}</span>
          </button>
        )}
        <GridMap
          gameState={gameState}
          currentPlayer={currentPlayer}
          selectedArmy={selectedArmy}
          targetedAttackTileId={targetedAttackTileId}
          targetedMergeTileId={targetedMergeTileId}
          smokeTargetingArmyId={smokeTargetingArmyId}
          combatTexts={combatTexts}
          moveAnimations={moveAnimations}
          bulletTraces={bulletTraces}
          attackFacings={attackFacings}
          artilleryImpacts={artilleryImpacts}
          queuedMovePreview={queuedMovePreview ?? selectedQueuedMovePreview}
          unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
          unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
          unitTileOwnerColorMode={unitTileOwnerColorMode}
          unitTileOwnerSolidIntensity={unitTileOwnerSolidIntensity}
          unitOwnerBarEnabled={unitOwnerBarEnabled}
          unitStatDisplayMode={unitStatDisplayMode}
          unitHealthBarPosition={unitHealthBarPosition}
          unitDefenseValueVisible={unitDefenseValueVisible}
          unitStatLabelMode={unitStatLabelMode}
          attackRadiusVisible={attackRadiusVisible}
          onTileClick={handleTileClick}
          onAttackClick={handleAttackClick}
          onCombineClick={handleCombineClick}
          onBuildBaseClick={handleBuildBaseClick}
          onReclaimBaseClick={handleReclaimBaseClick}
          onBuildTrenchClick={handleBuildTrenchClick}
          onScavengeClick={handleScavengeClick}
          onHealClick={handleHealClick}
          onPlaceMineClick={handlePlaceMineClick}
          onSmokeScreenClick={handleSmokeScreenClick}
          onFortifyClick={handleFortifyClick}
          onSetMoveOrderMode={handleSetMoveOrderMode}
          onClearMoveOrder={handleClearMoveOrder}
          onBaseClick={handleBaseClick}
          onCancelSmokeTargeting={cancelSmokeTargeting}
        />
      </div>
      <aside className="right-rail">
        <PlayerProgress
          player={currentPlayer}
          deployedUnits={deployedUnits}
          maxDeployedUnits={MAX_DEPLOYED_UNITS}
          onOpenTalents={() => setIsTalentTreeOpen(true)}
        />
        <CombatLog
          combatEntries={combatLogEntries}
          entries={[
            message,
            ...movementDebugEntries,
            selectedArmy && selectedTile
              ? selectedArmy.queuedMoveTileId
                ? `Selected unit at ${selectedTile.x}, ${selectedTile.y}. Ordered to ${selectedQueuedDestinationTile?.x ?? '?'}, ${selectedQueuedDestinationTile?.y ?? '?'} in ${selectedQueuedMovePreview?.turnsRemaining ?? '?'} rounds (${selectedArmy.queuedMoveMode ?? 'aggressive'}).`
                : 'Selected unit. Yellow tiles move, red attacks, blue combines. In timed mode, click farther empty tiles to queue long-range movement.'
              : 'Select one of your units to see movement and attack options.',
          ]}
        />
      </aside>
      <BaseModal
        tile={selectedBaseTile}
        tiles={gameState.tiles}
        armies={gameState.armies}
        player={currentPlayer}
        isCurrentTurn={isMyTurn}
        hideQualityTab={qualityTabHidden}
        onRecruit={handleRecruit}
        onRecruitComposition={handleRecruitComposition}
        onUpgrade={handleBaseUpgrade}
        onClose={() => setSelectedBaseTileId(null)}
      />
      <TalentTreeModal
        player={currentPlayer}
        isOpen={isTalentTreeOpen}
        busyTalentId={busyTalentId}
        onSpendTalent={handleSpendTalent}
        onClose={() => setIsTalentTreeOpen(false)}
      />
      <div className="game-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div className={`game-toast ${toast.tone}`} key={toast.id}>
            <strong>{toast.title}</strong>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function findCpuAttack(cpuPlayer: PlayerDoc, cpuArmies: ArmyDoc[], tiles: TileDoc[], armies: ArmyDoc[], roundNumber: number) {
  const targetTiles = enemyTargetTiles(cpuPlayer.id, tiles, armies);
  for (const army of cpuArmies.filter((candidate) => !candidate.hasActedThisTurn)) {
    const fromTile = tiles.find((tile) => tile.id === army.tileId);
    if (!fromTile) continue;
    const targetTile = [...targetTiles]
      .filter((tile) => canAttackTile(army, fromTile, tile, cpuPlayer.id, tiles, roundNumber))
      .sort((a, b) => cpuAttackTargetScore(a, fromTile) - cpuAttackTargetScore(b, fromTile))[0];
    if (targetTile) {
      const defenderArmy = targetTile.armyId ? armies.find((candidate) => candidate.id === targetTile.armyId) ?? null : null;
      return { army, fromTile, targetTile, defenderArmy };
    }
  }
  return null;
}

function findCpuMove(cpuPlayer: PlayerDoc, cpuArmies: ArmyDoc[], tiles: TileDoc[], armies: ArmyDoc[]) {
  let bestMove: { army: ArmyDoc; fromTile: TileDoc; targetTile: TileDoc; score: number } | null = null;
  for (const army of cpuArmies) {
    const fromTile = tiles.find((tile) => tile.id === army.tileId);
    if (!fromTile) continue;
    const primaryTarget = cpuMoveObjectiveForArmy(cpuPlayer, army, fromTile, tiles, armies);
    if (!primaryTarget) continue;

    for (const tile of tiles) {
      if (!canMoveArmy(army, fromTile, tile, cpuPlayer, tiles, armies)) continue;
      const score = cpuMoveScore(army, tile, primaryTarget, cpuPlayer.id, tiles, armies);
      if (!bestMove || score < bestMove.score) {
        bestMove = { army, fromTile, targetTile: tile, score };
      }
    }
  }

  return bestMove;
}

function enemyTargetTiles(playerId: string, tiles: TileDoc[], armies: ArmyDoc[]) {
  const armiesById = new Map(armies.map((army) => [army.id, army]));
  return tiles.filter((tile) => {
    const occupyingArmy = tile.armyId ? armiesById.get(tile.armyId) : null;
    return Boolean(
      (occupyingArmy && occupyingArmy.ownerId !== playerId) || (tile.base && !tile.base.ruined && tile.base.ownerId !== playerId),
    );
  });
}

function chooseCpuEconomicAction(cpuPlayer: PlayerDoc, tiles: TileDoc[], armies: ArmyDoc[]): CpuEconomicAction | null {
  const friendlyBases = tiles.filter((tile) => tile.base?.ownerId === cpuPlayer.id && !tile.base.ruined);
  const builders = armies.filter(
    (army) =>
      army.ownerId === cpuPlayer.id &&
      army.units.length === 1 &&
      army.units[0].typeId === 'builder' &&
      !army.hasActedThisTurn &&
      canLogisticsBuildBase(army),
  );

  const reclaimBuilder = builders.find((army) => {
    const tile = tiles.find((candidate) => candidate.id === army.tileId);
    return Boolean(tile?.base?.ruined) && cpuPlayer.supplies >= reclaimBaseCost(tile!.base!);
  });
  if (reclaimBuilder) return { kind: 'reclaimBase', army: reclaimBuilder };

  if (cpuPlayer.supplies >= BUILD_BASE_COST) {
    const baseBuilder = builders.find((army) => {
      const tile = tiles.find((candidate) => candidate.id === army.tileId);
      return tile ? isAggressiveExpansionSite(tile, cpuPlayer.id, tiles) : false;
    });
    if (baseBuilder) return { kind: 'buildBase', army: baseBuilder };
  }

  const basesNeedingBarracks = friendlyBases
    .filter((tile) => tile.base && tile.base.barracksLevel < 4)
    .sort((a, b) => cpuBasePressureScore(a, cpuPlayer.id, tiles) - cpuBasePressureScore(b, cpuPlayer.id, tiles));
  const barracksBase = basesNeedingBarracks.find((tile) => {
    const nextLevel = (tile.base?.barracksLevel ?? 1) + 1;
    const nextCost = UPGRADE_CONFIG.barracks.find((entry) => entry.level === nextLevel)?.cost ?? Infinity;
    return cpuPlayer.supplies >= nextCost;
  });
  if (barracksBase && (barracksBase.base?.barracksLevel ?? 1) < 3) return { kind: 'upgradeBarracks', tile: barracksBase };

  const recruitAction = chooseCpuRecruitAction(cpuPlayer, friendlyBases, tiles, armies);
  if (recruitAction) return recruitAction;

  const maxBaseOffenseLevel = Math.max(...UPGRADE_CONFIG.baseOffense.map((entry) => entry.level));
  const offenseBase = friendlyBases
    .filter((tile) => tile.base && (tile.base.offenseLevel ?? 1) < maxBaseOffenseLevel)
    .sort((a, b) => cpuBasePressureScore(a, cpuPlayer.id, tiles) - cpuBasePressureScore(b, cpuPlayer.id, tiles))
    .find((tile) => {
      const nextLevel = (tile.base?.offenseLevel ?? 1) + 1;
      const nextCost = UPGRADE_CONFIG.baseOffense.find((entry) => entry.level === nextLevel)?.cost ?? Infinity;
      return (tile.base?.barracksLevel ?? 1) >= nextLevel && cpuPlayer.supplies >= nextCost;
    });
  if (offenseBase) return { kind: 'upgradeOffense', tile: offenseBase };

  if (barracksBase) return { kind: 'upgradeBarracks', tile: barracksBase };

  const maxBaseDefenseLevel = Math.max(...UPGRADE_CONFIG.baseDefense.map((entry) => entry.level));
  const defenseBase = friendlyBases
    .filter((tile) => tile.base && tile.base.defenseLevel < maxBaseDefenseLevel)
    .sort((a, b) => cpuBasePressureScore(a, cpuPlayer.id, tiles) - cpuBasePressureScore(b, cpuPlayer.id, tiles))
    .find((tile) => {
      const nextLevel = (tile.base?.defenseLevel ?? 1) + 1;
      const nextCost = UPGRADE_CONFIG.baseDefense.find((entry) => entry.level === nextLevel)?.cost ?? Infinity;
      return (tile.base?.barracksLevel ?? 1) >= nextLevel && cpuPlayer.supplies >= nextCost;
    });
  if (defenseBase) return { kind: 'upgradeDefense', tile: defenseBase };

  return null;
}

function chooseCpuRecruitAction(
  cpuPlayer: PlayerDoc,
  friendlyBases: TileDoc[],
  tiles: TileDoc[],
  armies: ArmyDoc[],
): CpuEconomicAction | null {
  const builderCount = armies
    .filter((army) => army.ownerId === cpuPlayer.id)
    .reduce((total, army) => total + army.units.filter((unit) => unit.typeId === 'builder').length, 0);
  const artilleryCount = armies
    .filter((army) => army.ownerId === cpuPlayer.id)
    .reduce((total, army) => total + army.units.filter((unit) => ARTILLERY_UNIT_TYPES.has(unit.typeId)).length, 0);
  const wantsMoreBuilders = builderCount < MAX_LOGISTICS_UNITS;
  const recruitPriority: UnitTypeId[] = wantsMoreBuilders
    ? ['builder', 'tank', 'lightArtillery', 'smokeArtillery', 'siegeArtillery', 'antiVehicle', 'sniper', 'gunman']
    : ['tank', 'lightArtillery', 'smokeArtillery', 'siegeArtillery', 'antiVehicle', 'sniper', 'gunman', 'builder'];

  for (const baseTile of [...friendlyBases].sort(
    (a, b) => cpuBasePressureScore(a, cpuPlayer.id, tiles) - cpuBasePressureScore(b, cpuPlayer.id, tiles),
  )) {
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, tiles, armies);
    const spawnSpace = adjacentPassableSpawnCount(baseTile, tiles, armies);
    if (spawnSpace === 0) continue;

    for (const unitTypeId of recruitPriority) {
      const requiredLevel = UPGRADE_CONFIG.barracks.find((entry) => entry.unlocks.includes(unitTypeId))?.level ?? 1;
      if (sharedBarracksLevel < requiredLevel) continue;
      if ((ARTILLERY_UNIT_TYPES.has(unitTypeId) || unitTypeId === 'recon' || unitTypeId === 'builder') && spawnSpace < 1) continue;
      if (ARTILLERY_UNIT_TYPES.has(unitTypeId) && artilleryCount >= MAX_ARTILLERY_UNITS) continue;
      const unitCost = unitCostForLevel(unitTypeId, effectiveUnitQualityLevel(baseTile, unitTypeId, tiles, armies));
      if (cpuPlayer.supplies < unitCost) continue;
      if (unitTypeId === 'builder' && !wantsMoreBuilders) continue;
      return { kind: 'recruit', tile: baseTile, unitTypeId };
    }
  }

  return null;
}

function projectCpuEconomyAction(tiles: TileDoc[], armies: ArmyDoc[], action: CpuEconomicAction, playerId: string) {
  const nextTiles = tiles.map((tile) => ({ ...tile, base: tile.base ? { ...tile.base } : null }));
  const nextArmies = armies.map((army) => ({ ...army }));

  if (action.kind === 'reclaimBase' && action.army) {
    const tile = nextTiles.find((candidate) => candidate.id === action.army!.tileId);
    const army = nextArmies.find((candidate) => candidate.id === action.army!.id);
    if (tile?.base) {
      tile.ownerId = playerId;
      tile.base = { ...tile.base, ownerId: playerId, ruined: false };
    }
    if (army) army.hasActedThisTurn = true;
  }

  if (action.kind === 'buildBase' && action.army) {
    const tile = nextTiles.find((candidate) => candidate.id === action.army!.tileId);
    if (tile) {
      tile.ownerId = playerId;
      tile.armyId = null;
      tile.base = {
        ownerId: playerId,
        barracksLevel: 1,
        unitQualityLevel: 1,
        defenseLevel: 1,
        ruined: false,
        previousOwnerId: playerId,
      };
    }
    return {
      tiles: nextTiles,
      armies: nextArmies.filter((candidate) => candidate.id !== action.army!.id),
    };
  }

  return { tiles: nextTiles, armies: nextArmies };
}

function cpuAttackTargetScore(tile: TileDoc, fromTile: TileDoc) {
  return (tile.base && !tile.base.ruined ? 0 : 10) + manhattanDistance(fromTile, tile);
}

function cpuMoveObjectiveForArmy(
  cpuPlayer: PlayerDoc,
  army: ArmyDoc,
  fromTile: TileDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[],
) {
  if (army.units.length === 1 && army.units[0].typeId === 'builder' && canLogisticsBuildBase(army)) {
    const ruinedBases = tiles
      .filter((tile) => tile.base?.ruined)
      .sort((a, b) => manhattanDistance(fromTile, a) - manhattanDistance(fromTile, b));
    if (ruinedBases.length > 0) return ruinedBases[0];

    const expansionTargets = tiles
      .filter((tile) => isAggressiveExpansionSite(tile, cpuPlayer.id, tiles))
      .sort((a, b) => manhattanDistance(fromTile, a) - manhattanDistance(fromTile, b));
    if (expansionTargets.length > 0) return expansionTargets[0];
  }

  const enemyBases = tiles
    .filter((tile) => tile.base && !tile.base.ruined && tile.base.ownerId !== cpuPlayer.id)
    .sort((a, b) => manhattanDistance(fromTile, a) - manhattanDistance(fromTile, b));
  if (enemyBases.length > 0) return enemyBases[0];

  const targetTiles = enemyTargetTiles(cpuPlayer.id, tiles, armies).sort(
    (a, b) => manhattanDistance(fromTile, a) - manhattanDistance(fromTile, b),
  );
  return targetTiles[0] ?? null;
}

function cpuMoveScore(
  army: ArmyDoc,
  tile: TileDoc,
  target: TileDoc,
  playerId: string,
  tiles: TileDoc[],
  armies: ArmyDoc[],
) {
  let score = manhattanDistance(tile, target) * 10;
  if (target.base && !target.base.ruined && target.base.ownerId !== playerId) score -= 6;
  if (army.units.length === 1 && army.units[0].typeId === 'builder' && target.base?.ruined && tile.id === target.id) score -= 18;
  if (army.units.length === 1 && army.units[0].typeId === 'builder' && isAggressiveExpansionSite(tile, playerId, tiles)) score -= 10;
  if (enemyTargetTiles(playerId, tiles, armies).some((enemyTile) => manhattanDistance(tile, enemyTile) <= 2)) score -= 4;
  return score;
}

function cpuBasePressureScore(baseTile: TileDoc, playerId: string, tiles: TileDoc[]) {
  const enemyBases = tiles.filter((tile) => tile.base && !tile.base.ruined && tile.base.ownerId !== playerId);
  if (enemyBases.length === 0) return 999;
  return Math.min(...enemyBases.map((tile) => manhattanDistance(baseTile, tile)));
}

function isAggressiveExpansionSite(tile: TileDoc, playerId: string, tiles: TileDoc[]) {
  if (tile.base || isImpassableTerrain(tile)) return false;
  const existingBases = tiles.filter((candidate) => candidate.base);
  if (existingBases.some((candidate) => manhattanDistance(candidate, tile) < 5)) return false;
  const enemyBases = tiles.filter((candidate) => candidate.base && !candidate.base.ruined && candidate.base.ownerId !== playerId);
  if (enemyBases.length === 0) return false;
  const nearestEnemyBase = Math.min(...enemyBases.map((candidate) => manhattanDistance(candidate, tile)));
  return nearestEnemyBase <= 8;
}

function adjacentPassableSpawnCount(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[]) {
  const armiesByTile = new Map(armies.map((army) => [army.tileId, army]));
  return tiles.filter((tile) => manhattanDistance(baseTile, tile) === 1 && !isImpassableTerrain(tile) && !armiesByTile.has(tile.id)).length;
}

function smokeAreaTiles(originTile: TileDoc, tiles: TileDoc[]) {
  return tiles.filter(
    (tile) =>
      (tile.x === originTile.x || tile.x === originTile.x + 1) &&
      (tile.y === originTile.y || tile.y === originTile.y + 1),
  );
}

function reclaimBaseCost(base: NonNullable<TileDoc['base']>) {
  return 50 + Math.ceil(totalBaseUpgradeInvestment(base) * 0.5);
}

function totalBaseUpgradeInvestment(base: NonNullable<TileDoc['base']>) {
  let total = 0;
  for (let level = 2; level <= base.barracksLevel; level += 1) {
    total += UPGRADE_CONFIG.barracks.find((entry) => entry.level === level)?.cost ?? 0;
  }
  for (let level = 2; level <= base.defenseLevel; level += 1) {
    total += UPGRADE_CONFIG.baseDefense.find((entry) => entry.level === level)?.cost ?? 0;
  }
  for (let level = 2; level <= (base.offenseLevel ?? 1); level += 1) {
    total += UPGRADE_CONFIG.baseOffense.find((entry) => entry.level === level)?.cost ?? 0;
  }
  if (base.unitQualityByType && Object.keys(base.unitQualityByType).length > 0) {
    Object.values(base.unitQualityByType).forEach((qualityLevel) => {
      for (let level = 2; level <= (qualityLevel ?? 1); level += 1) {
        total += UPGRADE_CONFIG.unitQuality.find((entry) => entry.level === level)?.cost ?? 0;
      }
    });
  } else {
    for (let level = 2; level <= base.unitQualityLevel; level += 1) {
      total += UPGRADE_CONFIG.unitQuality.find((entry) => entry.level === level)?.cost ?? 0;
    }
  }
  return total;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function moveAnimationDuration(stepCount: number) {
  return Math.max(MOVE_ANIMATION_STEP_MS, stepCount * MOVE_ANIMATION_STEP_MS);
}

function estimateQueuedMoveTurns(pathLength: number, initialMovement: number, perRoundMovement: number) {
  if (pathLength <= 0) return 0;
  if (initialMovement >= pathLength) return 1;
  const remainingDistance = Math.max(0, pathLength - Math.max(0, initialMovement));
  return 1 + Math.ceil(remainingDistance / Math.max(1, perRoundMovement));
}

function playRiflemanShotBurst(army: ArmyDoc, delayMs = 0) {
  if (!army.units.some((unit) => unit.typeId === 'gunman')) return;

  [0, 95, 190].forEach((shotDelay) => {
    window.setTimeout(() => {
      playUiSound(RIFLEMAN_SHOT_SOUND_PATH, 0.42);
    }, delayMs + shotDelay);
  });
}

function playMovementSound(tileCount: number, mode: MovementSoundMode, durationMs = MOVE_ANIMATION_STEP_MS) {
  if (mode === 'move') {
    playUiSound(MOVEMENT_SOUND_PATH, 0.36);
    return;
  }

  const stepInterval = Math.max(95, (durationMs / Math.max(1, tileCount)) * 0.62);
  Array.from({ length: tileCount }, (_, index) => index).forEach((index) => {
    window.setTimeout(() => {
      playUiSound(MOVEMENT_SOUND_PATH, 0.3);
    }, index * stepInterval);
  });
}

function scoreLeaderForPlayers(players: PlayerDoc[]) {
  const activePlayers = players.filter((player) => !player.isEliminated);
  if (activePlayers.length === 0) return null;
  const scoredPlayers = activePlayers
    .map((player) => ({ ...player, score: totalCommanderXp(player.level, player.xp) }))
    .sort((a, b) => b.score - a.score);
  if (scoredPlayers.length > 1 && scoredPlayers[0].score === scoredPlayers[1].score) return null;
  return scoredPlayers[0];
}

function totalCommanderXp(level: number, currentLevelXp: number) {
  let total = currentLevelXp;
  for (let previousLevel = 1; previousLevel < level; previousLevel += 1) {
    total += 100 + (previousLevel - 1) * 50;
  }
  return total;
}

function playUiSound(path: string, volume: number) {
  const sound = new Audio(path);
  const savedVfxVolume = Number(localStorage.getItem('vfxVolume'));
  const vfxVolume = Number.isFinite(savedVfxVolume) ? Math.min(1, Math.max(0, savedVfxVolume)) : 0.75;
  sound.volume = volume * vfxVolume;
  sound.play().catch(() => {
    // The file may not be present yet, or the browser may block audio.
  });
}
