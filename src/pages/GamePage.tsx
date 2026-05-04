import { useMemo, useState } from 'react';
import ArmyPanel from '../components/ArmyPanel/ArmyPanel';
import BaseModal from '../components/BaseModal/BaseModal';
import CombatLog, { type CombatLogEntry } from '../components/CombatLog/CombatLog';
import GridMap from '../components/GridMap/GridMap';
import PlayerPanel from '../components/PlayerPanel/PlayerPanel';
import PlayerProgress from '../components/PlayerProgress/PlayerProgress';
import TalentTreeModal from '../components/TalentTreeModal/TalentTreeModal';
import TurnPanel from '../components/TurnPanel/TurnPanel';
import type { MovementSoundMode } from '../App';
import {
  attackTile,
  buildBaseWithBuilder,
  buildTrenchWithBuilder,
  combineArmies,
  devSpawnUnitAtTile,
  dismissUnitFromArmy,
  fortifyArmy,
  healArmyWithMedic,
  moveArmy,
  placeMineWithAntiVehicle,
  recruitUnitAtBase,
  recruitUnitCompositionAtBase,
  scavengeSuppliesWithBuilder,
  separateUnitFromArmy,
  spendTalentPoint,
  upgradeBaseBarracks,
  upgradeBaseDefense,
  upgradeBaseOffense,
  upgradeBaseUnitQuality,
  MAX_DEPLOYED_UNITS,
} from '../firebase/gameService';
import type { ArmyDoc, GameState, PlayerDoc, TalentId, TileDoc, UnitTypeId } from '../types/gameTypes';
import { canCombineArmies, canMoveArmy, getAttackStagingTile, movementPath } from '../utils/movement';

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
}

interface AttackFacing {
  id: string;
  armyId: string;
  angleDeg: number;
}

type BaseUpgradeAction = 'barracks' | 'defense' | 'offense' | `quality:${UnitTypeId}`;
const MOVE_ANIMATION_STEP_MS = 560;
const RIFLEMAN_SHOT_SOUND_PATH = '/audio/rifleman-shot.wav';
const UNIT_SELECT_SOUND_PATH = '/audio/default-unit-select.wav';
const UPGRADE_SOUND_PATH = '/audio/upgrade-sound.wav';
const BASE_BUILD_SOUND_PATH = '/audio/base-build-sound.wav';
const MOVEMENT_SOUND_PATH = '/audio/movement-sound.mp3';

interface GamePageProps {
  gameState: GameState;
  currentPlayer: PlayerDoc;
  devPlayerId: string;
  devSpawnUnitType: UnitTypeId | '';
  movementSoundMode: MovementSoundMode;
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitOwnerBarEnabled: boolean;
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
  unitOwnerBarEnabled,
  onDevSpawnUnitTypeChange,
}: GamePageProps) {
  const [selectedArmyId, setSelectedArmyId] = useState<string | null>(null);
  const [targetedAttackTileId, setTargetedAttackTileId] = useState<string | null>(null);
  const [targetedMergeTileId, setTargetedMergeTileId] = useState<string | null>(null);
  const [selectedBaseTileId, setSelectedBaseTileId] = useState<string | null>(null);
  const [message, setMessage] = useState('Select one of your units to move.');
  const [combatTexts, setCombatTexts] = useState<FloatingCombatText[]>([]);
  const [moveAnimations, setMoveAnimations] = useState<MoveAnimation[]>([]);
  const [bulletTraces, setBulletTraces] = useState<BulletTrace[]>([]);
  const [attackFacings, setAttackFacings] = useState<AttackFacing[]>([]);
  const [combatLogEntries, setCombatLogEntries] = useState<CombatLogEntry[]>([]);
  const [isTalentTreeOpen, setIsTalentTreeOpen] = useState(false);
  const [busyTalentId, setBusyTalentId] = useState<TalentId | null>(null);

  const selectedArmy = gameState.armies.find((army) => army.id === selectedArmyId) ?? null;
  const currentTurnPlayer = gameState.players.find((player) => player.id === gameState.game.currentTurnPlayerId) ?? null;
  const isMyTurn = gameState.game.currentTurnPlayerId === currentPlayer.id;

  const tileById = useMemo(() => new Map(gameState.tiles.map((tile) => [tile.id, tile])), [gameState.tiles]);
  const selectedTile = selectedArmy ? tileById.get(selectedArmy.tileId) ?? null : null;
  const selectedArmyHasBaseDefenseBuff = Boolean(
    selectedArmy &&
      selectedTile &&
      gameState.tiles.some(
        (tile) =>
          tile.base?.ownerId === selectedArmy.ownerId &&
          Math.max(Math.abs(tile.x - selectedTile.x), Math.abs(tile.y - selectedTile.y)) <= 1,
      ),
  );
  const selectedBaseTile = selectedBaseTileId ? tileById.get(selectedBaseTileId) ?? null : null;
  const deployedUnits = gameState.armies
    .filter((army) => army.ownerId === currentPlayer.id)
    .reduce((total, army) => total + army.units.length, 0);
  const selectedDevPlayerId = devPlayerId || currentPlayer.id;

  async function handleTileClick(tile: TileDoc, occupyingArmy: ArmyDoc | null) {
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

    const selectedArmyCanMerge =
      selectedArmy &&
      selectedTile &&
      occupyingArmy &&
      selectedArmy.ownerId === currentPlayer.id &&
      occupyingArmy.ownerId === currentPlayer.id &&
      isMyTurn &&
      canCombineArmies(selectedArmy, occupyingArmy, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies);

    if (selectedArmyCanMerge) {
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
        (tile.base && tile.base.ownerId !== currentPlayer.id)) &&
      getAttackStagingTile(gameState.tiles, selectedArmy, selectedTile, tile, currentPlayer, gameState.armies);

    if (selectedArmyCanTarget) {
      setTargetedMergeTileId(null);
      setTargetedAttackTileId(targetedAttackTileId === tile.id ? null : tile.id);
      setMessage('Target selected. Click Attack to start combat.');
      return;
    }

    setTargetedAttackTileId(null);
    setTargetedMergeTileId(null);

    if (occupyingArmy) {
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

    if (!canMoveArmy(selectedArmy, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies)) {
      setMessage('That tile is out of range or occupied.');
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

      let latestMessage = '';
      const movementWaypoints = path.filter((stepTile) => !stepTile.armyId);
      if (movementWaypoints.length > 0) {
        const finalTile = movementWaypoints[movementWaypoints.length - 1];
        const result = await moveArmy(gameState.game.id, selectedArmy.id, finalTile.id, currentPlayer.id);
        latestMessage = result.message;
        const durationMs = moveAnimationDuration(movementWaypoints.length);
        playMovementSound(movementWaypoints.length, movementSoundMode, durationMs);
        if (result.triggeredMineTileId && result.mineDamage) {
          showCombatText(result.triggeredMineTileId, `-${result.mineDamage}`);
        }
        if (result.sentryDamage) {
          showCombatText(finalTile.id, `-${result.sentryDamage}`);
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
      setTargetedAttackTileId(null);
      setTargetedMergeTileId(null);
      setMessage(latestMessage || `Unit moved to ${tile.x}, ${tile.y}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Move failed.');
    }
  }

  async function handleAttackClick(tile: TileDoc) {
    if (!selectedArmy || !isMyTurn) return;

    try {
      const defenderArmy = tile.armyId ? gameState.armies.find((army) => army.id === tile.armyId) ?? null : null;
      if (selectedTile) {
        showAttackFacing(selectedArmy.id, selectedTile, tile);
        showBulletTraces(selectedTile.id, tile.id);
        playRiflemanShotBurst(selectedArmy);
        if (defenderArmy) {
          showAttackFacing(defenderArmy.id, tile, selectedTile);
          showBulletTraces(tile.id, selectedTile.id, 120);
          playRiflemanShotBurst(defenderArmy, 180);
        }
      }

      const result = await attackTile(gameState.game.id, selectedArmy.id, tile.id, currentPlayer.id);
      setTargetedAttackTileId(null);
      setMessage(result.message);
      showCombatText(result.attackerTileId, result.attackerLosses > 0 ? `-${result.attackerLosses * 10}` : 'Blocked');
      showCombatText(result.defenderTileId, result.defenderLosses > 0 ? `-${result.defenderLosses * 10}` : 'Blocked');
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
            ? 'Base destroyed'
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
    try {
      const result = await buildBaseWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      playUiSound(BASE_BUILD_SOUND_PATH, 0.5);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Build failed.');
    }
  }

  async function handleBuildTrenchClick(army: ArmyDoc) {
    try {
      const result = await buildTrenchWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Trench');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Trench failed.');
    }
  }

  async function handleScavengeClick(army: ArmyDoc) {
    try {
      const result = await scavengeSuppliesWithBuilder(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Supplies');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Scavenge failed.');
    }
  }

  async function handleHealClick(army: ArmyDoc) {
    try {
      const result = await healArmyWithMedic(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Heal');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Heal failed.');
    }
  }

  async function handlePlaceMineClick(army: ArmyDoc) {
    try {
      const result = await placeMineWithAntiVehicle(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Mine');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Mine placement failed.');
    }
  }

  async function handleFortifyClick(army: ArmyDoc) {
    try {
      const result = await fortifyArmy(gameState.game.id, army.id, currentPlayer.id);
      setMessage(result);
      showCombatText(army.tileId, '+Fortify');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Fortify failed.');
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
    if (!selectedBaseTile) return;
    try {
      const result = await recruitUnitAtBase(gameState.game.id, selectedBaseTile.id, unitTypeId, currentPlayer.id);
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Recruitment failed.');
    }
  }

  async function handleRecruitComposition(compositionId: string) {
    if (!selectedBaseTile) return;
    try {
      const result = await recruitUnitCompositionAtBase(gameState.game.id, selectedBaseTile.id, compositionId, currentPlayer.id);
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unit recruitment failed.');
    }
  }

  async function handleBaseUpgrade(action: BaseUpgradeAction) {
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

  function showCombatText(tileId: string, text: string) {
    const id = `${tileId}_${Date.now()}_${Math.random()}`;
    setCombatTexts((current) => [...current, { id, tileId, text, tone: text.startsWith('-') ? 'damage' : 'status' }]);
    window.setTimeout(() => {
      setCombatTexts((current) => current.filter((entry) => entry.id !== id));
    }, 1300);
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
    }));
    setBulletTraces((current) => [...current, ...traces]);
    window.setTimeout(() => {
      setBulletTraces((current) => current.filter((entry) => !entry.id.startsWith(idPrefix)));
    }, 1650);
  }

  function showAttackFacing(armyId: string, fromTile: TileDoc, toTile: TileDoc) {
    const id = `${armyId}_${Date.now()}_${Math.random()}`;
    const angleDeg = Math.atan2(toTile.y - fromTile.y, toTile.x - fromTile.x) * (180 / Math.PI) + 90;
    setAttackFacings((current) => [...current.filter((entry) => entry.armyId !== armyId), { id, armyId, angleDeg }]);
    window.setTimeout(() => {
      setAttackFacings((current) => current.filter((entry) => entry.id !== id));
    }, 1700);
  }

  return (
    <section className="game-page">
      <aside className="left-rail">
        <TurnPanel game={gameState.game} currentPlayer={currentPlayer} turnPlayer={currentTurnPlayer} />
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
        <GridMap
          gameState={gameState}
          currentPlayer={currentPlayer}
          selectedArmy={selectedArmy}
          targetedAttackTileId={targetedAttackTileId}
          targetedMergeTileId={targetedMergeTileId}
          combatTexts={combatTexts}
          moveAnimations={moveAnimations}
          bulletTraces={bulletTraces}
          attackFacings={attackFacings}
          unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
          unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
          unitOwnerBarEnabled={unitOwnerBarEnabled}
          onTileClick={handleTileClick}
          onAttackClick={handleAttackClick}
          onCombineClick={handleCombineClick}
          onBuildBaseClick={handleBuildBaseClick}
          onBuildTrenchClick={handleBuildTrenchClick}
          onScavengeClick={handleScavengeClick}
          onHealClick={handleHealClick}
          onPlaceMineClick={handlePlaceMineClick}
          onFortifyClick={handleFortifyClick}
          onBaseClick={handleBaseClick}
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
            selectedArmy && selectedTile
              ? `Selected unit at ${selectedTile.x}, ${selectedTile.y}. Yellow tiles move, red attacks, blue combines.`
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
    </section>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function moveAnimationDuration(stepCount: number) {
  return Math.max(MOVE_ANIMATION_STEP_MS, stepCount * MOVE_ANIMATION_STEP_MS);
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

function playUiSound(path: string, volume: number) {
  const sound = new Audio(path);
  sound.volume = volume;
  sound.play().catch(() => {
    // The file may not be present yet, or the browser may block audio.
  });
}
