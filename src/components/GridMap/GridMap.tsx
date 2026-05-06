import { type CSSProperties, PointerEvent, WheelEvent, useMemo, useRef, useState } from 'react';
import { UPGRADE_CONFIG } from '../../data/upgradeConfig';
import type { OwnerTileColorMode, UnitHealthBarPosition, UnitStatDisplayMode, UnitStatLabelMode } from '../../App';
import type { ArmyDoc, GameState, MoveOrderMode, PlayerDoc, TileDoc } from '../../types/gameTypes';
import { armyHasMedic } from '../../utils/combat';
import {
  armyMustStaySolo,
  canCombineArmies,
  canLogisticsBuildBase,
  canLogisticsBuildTrench,
  canLogisticsScavenge,
  canMoveArmy,
  chebyshevDistance,
  getAttackStagingTile,
  hasLineOfSight,
  isTileInAttackRange,
  movementAllowance,
  normalArtilleryCanFire,
  tileIdFromCoords,
} from '../../utils/movement';
import { visibleTileIdsForPlayer } from '../../utils/vision';
import { connectedBaseTiles } from '../../utils/trenchNetwork';
import Tile from './Tile';

const BUTTON_HOVER_SOUND_PATH = '/audio/default-button-click.wav';
const TILE_SIZE = 156;
const TILE_GAP = 6;
const GRID_PADDING = 8;
const TILE_PITCH = TILE_SIZE + TILE_GAP;
const TILE_CENTER = TILE_SIZE / 2;
const DEFAULT_ZOOM = 0.5;

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

interface GridMapProps {
  gameState: GameState;
  currentPlayer: PlayerDoc;
  selectedArmy: ArmyDoc | null;
  targetedAttackTileId: string | null;
  targetedMergeTileId: string | null;
  smokeTargetingArmyId: string | null;
  combatTexts: FloatingCombatText[];
  moveAnimations: MoveAnimation[];
  bulletTraces: BulletTrace[];
  attackFacings: AttackFacing[];
  artilleryImpacts: ArtilleryImpact[];
  queuedMovePreview: QueuedMovePreview | null;
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
  onTileClick: (tile: GameState['tiles'][number], occupyingArmy: ArmyDoc | null) => void;
  onAttackClick: (tile: TileDoc) => void;
  onCombineClick: (targetArmy: ArmyDoc) => void;
  onBuildBaseClick: (builderArmy: ArmyDoc) => void;
  onReclaimBaseClick: (builderArmy: ArmyDoc) => void;
  onBuildTrenchClick: (builderArmy: ArmyDoc) => void;
  onScavengeClick: (builderArmy: ArmyDoc) => void;
  onHealClick: (army: ArmyDoc) => void;
  onPlaceMineClick: (army: ArmyDoc) => void;
  onSmokeScreenClick: (army: ArmyDoc) => void;
  onFortifyClick: (army: ArmyDoc) => void;
  onSetMoveOrderMode: (army: ArmyDoc, mode: MoveOrderMode) => void;
  onClearMoveOrder: (army: ArmyDoc) => void;
  onBaseClick: (tile: TileDoc) => void;
  onCancelSmokeTargeting: () => void;
}

export default function GridMap({
  gameState,
  currentPlayer,
  selectedArmy,
  targetedAttackTileId,
  targetedMergeTileId,
  smokeTargetingArmyId,
  combatTexts,
  moveAnimations,
  bulletTraces,
  attackFacings,
  artilleryImpacts,
  queuedMovePreview,
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
  onTileClick,
  onAttackClick,
  onCombineClick,
  onBuildBaseClick,
  onReclaimBaseClick,
  onBuildTrenchClick,
  onScavengeClick,
  onHealClick,
  onPlaceMineClick,
  onSmokeScreenClick,
  onFortifyClick,
  onSetMoveOrderMode,
  onClearMoveOrder,
  onBaseClick,
  onCancelSmokeTargeting,
}: GridMapProps) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [actionMenuTileId, setActionMenuTileId] = useState<string | null>(null);
  const [hoveredTileId, setHoveredTileId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(
    null,
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pendingPanRef = useRef(pan);
  const animationFrameRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const armiesByTile = useMemo(() => new Map(gameState.armies.map((army) => [army.tileId, army])), [gameState.armies]);
  const playersById = useMemo(() => new Map(gameState.players.map((player) => [player.id, player])), [gameState.players]);
  const selectedTile = useMemo(
    () => (selectedArmy ? gameState.tiles.find((tile) => tile.id === selectedArmy.tileId) ?? null : null),
    [gameState.tiles, selectedArmy],
  );
  const statScale = Math.max(0.72, Math.min(1, 1 / zoom));
  const combatStatScale = 1 / zoom;
  const visibleTileIds = useMemo(
    () => visibleTileIdsForPlayer(currentPlayer.id, gameState.tiles, gameState.armies),
    [currentPlayer.id, gameState.armies, gameState.tiles],
  );
  const exploredTileIds = useMemo(
    () => new Set([...(currentPlayer.exploredTileIds ?? []), ...visibleTileIds]),
    [currentPlayer.exploredTileIds, visibleTileIds],
  );
  const combatTextsByTileId = useMemo(() => {
    const entriesByTile = new Map<string, FloatingCombatText[]>();
    combatTexts.forEach((entry) => {
      const entries = entriesByTile.get(entry.tileId) ?? [];
      entries.push(entry);
      entriesByTile.set(entry.tileId, entries);
    });
    return entriesByTile;
  }, [combatTexts]);
  const moveAnimationsByTileId = useMemo(
    () => new Map(moveAnimations.map((entry) => [entry.tileId, entry])),
    [moveAnimations],
  );
  const attackFacingsByArmyId = useMemo(
    () => new Map(attackFacings.map((entry) => [entry.armyId, entry])),
    [attackFacings],
  );
  const artilleryImpactTileIds = useMemo(
    () => new Set(artilleryImpacts.map((entry) => entry.tileId)),
    [artilleryImpacts],
  );
  const baseAuraOwnerIdsByTileId = useMemo(() => {
    const aura = new Map<string, Set<string>>();
    gameState.tiles.forEach((baseTile) => {
      if (!baseTile.base?.ownerId || baseTile.base.ruined) return;
      for (let y = baseTile.y - 1; y <= baseTile.y + 1; y += 1) {
        for (let x = baseTile.x - 1; x <= baseTile.x + 1; x += 1) {
          const tileId = tileIdFromCoords(x, y);
          const ownerIds = aura.get(tileId) ?? new Set<string>();
          ownerIds.add(baseTile.base.ownerId);
          aura.set(tileId, ownerIds);
        }
      }
    });
    return aura;
  }, [gameState.tiles]);
  const sentryCoverageByTileId = useMemo(() => {
    const coverage = new Map<string, string>();
    const visibleIds = new Set(visibleTileIds);
    const tileByCoord = new Map(gameState.tiles.map((tile) => [tileIdFromCoords(tile.x, tile.y), tile]));
    const sentryBases = gameState.tiles
      .filter((tile) => tile.base && !tile.base.ruined && tile.base.ownerId)
      .map((tile) => ({
        tile,
        owner: playersById.get(tile.base!.ownerId!),
        offense: UPGRADE_CONFIG.baseOffense.find((level) => level.level === (tile.base!.offenseLevel ?? 1)),
      }))
      .filter((entry) => entry.owner && entry.offense && entry.offense.damage > 0);

    sentryBases.forEach((sentryBase) => {
      const range = sentryRangeForPlayer(sentryBase.offense!.range, sentryBase.owner);
      for (let y = sentryBase.tile.y - range; y <= sentryBase.tile.y + range; y += 1) {
        for (let x = sentryBase.tile.x - range; x <= sentryBase.tile.x + range; x += 1) {
          const tile = tileByCoord.get(tileIdFromCoords(x, y));
          if (!tile || coverage.has(tile.id) || !visibleIds.has(tile.id)) continue;
          if (chebyshevDistance(sentryBase.tile, tile) > range) continue;
          if (!hasLineOfSight(sentryBase.tile, tile, gameState.tiles)) continue;
          coverage.set(tile.id, sentryBase.owner!.color);
        }
      }
    });

    return coverage;
  }, [gameState.tiles, playersById, visibleTileIds]);

  const sortedTiles = useMemo(() => [...gameState.tiles].sort((a, b) => a.y - b.y || a.x - b.x), [gameState.tiles]);
  const tileById = useMemo(() => new Map(gameState.tiles.map((tile) => [tile.id, tile])), [gameState.tiles]);
  const hoveredTile = hoveredTileId ? tileById.get(hoveredTileId) ?? null : null;
  const smokePreviewIds = useMemo(
    () =>
      hoveredTile && smokeTargetingArmyId && selectedArmy && selectedTile && isTileInAttackRange(selectedArmy, selectedTile, hoveredTile, gameState.tiles)
        ? smokeAreaIdsForOrigin(hoveredTile)
        : new Set<string>(),
    [gameState.tiles, hoveredTile, selectedArmy, selectedTile, smokeTargetingArmyId],
  );
  const canCurrentPlayerAct =
    gameState.game.status === 'active' &&
    !currentPlayer.isEliminated &&
    (gameState.game.mode === 'timed-simultaneous' || gameState.game.currentTurnPlayerId === currentPlayer.id);

  function clampZoom(value: number) {
    return Math.min(2.35, Math.max(0.25, Number(value.toFixed(2))));
  }

  function changeZoom(delta: number) {
    setZoom((current) => clampZoom(current + delta));
  }

  function playZoomButtonHoverSound() {
    const savedVfxVolume = Number(localStorage.getItem('vfxVolume'));
    const vfxVolume = Number.isFinite(savedVfxVolume) ? Math.min(1, Math.max(0, savedVfxVolume)) : 0.75;
    const sound = new Audio(BUTTON_HOVER_SOUND_PATH);
    sound.volume = 0.44 * vfxVolume;
    sound.play().catch(() => {
      // Browsers may reject audio before the first interaction.
    });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const viewportBounds = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - viewportBounds.left;
    const mouseY = event.clientY - viewportBounds.top;
    const nextZoom = clampZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08));
    if (nextZoom === zoom) return;

    const worldX = (mouseX - pan.x) / zoom;
    const worldY = (mouseY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: mouseX - worldX * nextZoom,
      y: mouseY - worldY * nextZoom,
    });
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button === 2 && smokeTargetingArmyId) {
      event.preventDefault();
      onCancelSmokeTargeting();
      return;
    }
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    const isShiftPan = event.button === 0 && event.shiftKey;
    if (target.closest('button')) return;
    if (event.button === 0 && target.closest('.tile') && !isShiftPan) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pendingPanRef.current = pan;
    setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart) return;
    const dragDistance = Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y);
    if (dragDistance <= 6) return;
    if (dragDistance > 6) {
      suppressNextClickRef.current = true;
    }
    const nextPan = {
      x: dragStart.panX + event.clientX - dragStart.x,
      y: dragStart.panY + event.clientY - dragStart.y,
    };
    pendingPanRef.current = nextPan;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      if (gridRef.current) {
        gridRef.current.style.transform = `translate3d(${pendingPanRef.current.x}px, ${pendingPanRef.current.y}px, 0) scale(${zoom})`;
      }
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setPan(pendingPanRef.current);
      setDragStart(null);
    }
  }

  function handleTileClick(tile: TileDoc, army: ArmyDoc | null) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onTileClick(tile, army);
  }

  function runAction(action: () => void) {
    setActionMenuTileId(null);
    action();
  }

  return (
    <div className="map-viewport-shell">
      <div className="map-controls">
        <button className="secondary" onMouseEnter={playZoomButtonHoverSound} onFocus={playZoomButtonHoverSound} onClick={() => changeZoom(-0.1)} aria-label="Zoom out">
          -
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="secondary" onMouseEnter={playZoomButtonHoverSound} onFocus={playZoomButtonHoverSound} onClick={() => changeZoom(0.1)} aria-label="Zoom in">
          +
        </button>
        <button
          className="secondary"
          onMouseEnter={playZoomButtonHoverSound}
          onFocus={playZoomButtonHoverSound}
          onClick={() => {
            setZoom(DEFAULT_ZOOM);
            setPan({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
      </div>
      <div
        className="map-viewport"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        style={{ cursor: dragStart ? 'grabbing' : 'grab' }}
        title="Middle-click drag to pan, or hold Shift and drag with left click."
      >
        <div
          ref={gridRef}
          className={`grid-map ${dragStart ? 'panning' : ''}`}
          style={{
            '--stat-scale': statScale,
            '--combat-stat-scale': combatStatScale,
            '--tile-size': `${TILE_SIZE}px`,
            '--tile-gap': `${TILE_GAP}px`,
            '--grid-padding': `${GRID_PADDING}px`,
            gridTemplateColumns: `repeat(${gameState.game.mapWidth}, ${TILE_SIZE}px)`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          } as CSSProperties}
        >
          <div className="bullet-layer" aria-hidden="true">
            {bulletTraces.map((trace) => {
              const fromTile = tileById.get(trace.fromTileId);
              const toTile = tileById.get(trace.toTileId);
              if (!fromTile || !toTile) return null;
              const fromCenterX = fromTile.x * TILE_PITCH + TILE_CENTER;
              const fromCenterY = fromTile.y * TILE_PITCH + TILE_CENTER;
              const toCenterX = toTile.x * TILE_PITCH + TILE_CENTER;
              const toCenterY = toTile.y * TILE_PITCH + TILE_CENTER;
              const aimDeltaX = toCenterX - fromCenterX;
              const aimDeltaY = toCenterY - fromCenterY;
              const aimLength = Math.hypot(aimDeltaX, aimDeltaY);
              const unitX = aimLength > 0 ? aimDeltaX / aimLength : 0;
              const unitY = aimLength > 0 ? aimDeltaY / aimLength : 0;
              const fromX = fromCenterX + unitX * 28;
              const fromY = fromCenterY + unitY * 28;
              const toX = toCenterX - unitX * 34;
              const toY = toCenterY - unitY * 34;
              const deltaX = toX - fromX;
              const deltaY = toY - fromY;
              const length = Math.hypot(deltaX, deltaY);
              const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
              const perpendicularX = length > 0 ? (-deltaY / length) * trace.laneOffset : 0;
              const perpendicularY = length > 0 ? (deltaX / length) * trace.laneOffset : 0;
              if (trace.kind === 'arc') {
                const shellArc = Math.max(58, Math.min(170, length * 0.28));
                return (
                  <span
                    className="artillery-shell-trace"
                    key={trace.id}
                    style={
                      {
                        left: fromX + perpendicularX,
                        top: fromY + perpendicularY,
                        animationDelay: `${trace.delayMs}ms`,
                        '--shell-dx': `${deltaX - perpendicularX * 0.35}px`,
                        '--shell-dy': `${deltaY - perpendicularY * 0.35}px`,
                        '--shell-arc': `${shellArc}px`,
                      } as CSSProperties
                    }
                  />
                );
              }
              return (
                <span
                  className="bullet-trace"
                  key={trace.id}
                  style={
                    {
                      left: fromX + perpendicularX,
                      top: fromY + perpendicularY,
                      width: length,
                      transform: `rotate(${angle}deg)`,
                      animationDelay: `${trace.delayMs}ms`,
                      '--trace-distance': `${Math.max(0, length - 28)}px`,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
          {sortedTiles.map((tile) => {
            const isVisible = visibleTileIds.has(tile.id);
            const isDiscovered = exploredTileIds.has(tile.id);
            const realArmy = armiesByTile.get(tile.id) ?? null;
            const army = isVisible || realArmy?.ownerId === currentPlayer.id ? realArmy : null;
            const visibleBase = isDiscovered || tile.base?.ownerId === currentPlayer.id ? tile.base : null;
            const owner = visibleBase?.ownerId ? playersById.get(visibleBase.ownerId) ?? null : null;
            const armyOwner = army ? playersById.get(army.ownerId) ?? null : null;
            const mineOwner = tile.mine?.ownerId ? playersById.get(tile.mine.ownerId) ?? null : null;
            const hasConnectedBaseNetwork = Boolean(
              visibleBase &&
                !visibleBase.ruined &&
                connectedBaseTiles({ ...tile, base: visibleBase }, gameState.tiles, gameState.armies).length > 1,
            );
            const hasBaseDefenseBuff = Boolean(
              army &&
                baseAuraOwnerIdsByTileId.get(tile.id)?.has(army.ownerId),
            );
            const hasEnemyArmy = Boolean(army && army.ownerId !== currentPlayer.id);
            const hasEnemyBase = Boolean(visibleBase && !visibleBase.ruined && visibleBase.ownerId !== currentPlayer.id);
            const selectedIsMine = selectedArmy?.ownerId === currentPlayer.id;
            const isMergeable = Boolean(
                selectedArmy &&
                army &&
                selectedIsMine &&
                selectedTile &&
                canCurrentPlayerAct &&
                canCombineArmies(
                  selectedArmy,
                  army,
                  selectedTile,
                  tile,
                  currentPlayer,
                  gameState.tiles,
                  gameState.armies,
                  gameState.game.allowMixedUnitCombines ?? false,
                ),
            );
            const canBuildBase = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsBuildBase(army) &&
                !army.hasActedThisTurn &&
                !tile.base,
            );
            const canBuildTrench = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsBuildTrench(army) &&
                !army.hasActedThisTurn &&
                !tile.trench,
            );
            const canReclaimBase = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsBuildBase(army) &&
                !army.hasActedThisTurn &&
                tile.base?.ruined,
            );
            const canScavenge = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsScavenge(army) &&
                !army.hasActedThisTurn,
            );
            const canHealArmy = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                armyHasMedic(army.units) &&
                !army.hasMovedThisTurn &&
                !army.hasActedThisTurn,
            );
            const canPlaceMine = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.some((unit) => unit.typeId === 'antiVehicle') &&
                !armyMustStaySolo(army) &&
                !army.hasActedThisTurn &&
                !tile.mine,
            );
            const canSmokeScreen = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                army.units.length === 1 &&
                army.units[0].typeId === 'smokeArtillery' &&
                (army.units[0].smokeReloadUntilRound ?? 0) <= gameState.game.roundNumber &&
                !army.hasActedThisTurn,
            );
            const canFortify = Boolean(
                army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                canCurrentPlayerAct &&
                !army.hasActedThisTurn &&
                (army.fortifyTurnsRemaining ?? 0) === 0,
            );
            const isReachable = Boolean(
                selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                canCurrentPlayerAct &&
                canMoveArmy(selectedArmy, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies),
            );
            const selectedArmyCanStillMove = Boolean(
                selectedArmy &&
                movementAllowance(currentPlayer, selectedArmy) - (selectedArmy.movementUsedThisTurn ?? 0) > 0 &&
                (selectedArmy.fortifyTurnsRemaining ?? 0) === 0,
            );
            const isAttackRadius = Boolean(
                attackRadiusVisible &&
                selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                canCurrentPlayerAct &&
                !selectedArmy.hasActedThisTurn &&
                normalArtilleryCanFire(selectedArmy, gameState.game.roundNumber) &&
                isVisible &&
                !(selectedArmyCanStillMove && isReachable) &&
                isTileInAttackRange(selectedArmy, selectedTile, tile, gameState.tiles),
            );
            const isAttackable = Boolean(
                selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                canCurrentPlayerAct &&
                (hasEnemyArmy || hasEnemyBase) &&
                getAttackStagingTile(
                  gameState.tiles,
                  selectedArmy,
                  selectedTile,
                  tile,
                  currentPlayer,
                  gameState.armies,
                  gameState.game.roundNumber,
                ),
            );
            const tileCombatTexts = combatTextsByTileId.get(tile.id) ?? [];
            const moveAnimation = moveAnimationsByTileId.get(tile.id) ?? null;
            const attackFacing = army ? attackFacingsByArmyId.get(army.id) ?? null : null;
            const hasArtilleryImpact = artilleryImpactTileIds.has(tile.id);
            const isQueuedDestination = queuedMovePreview?.tileId === tile.id;
            const isSmokeTarget = Boolean(
                selectedArmy &&
                smokeTargetingArmyId === selectedArmy.id &&
                selectedIsMine &&
                selectedTile &&
                canCurrentPlayerAct &&
                isVisible &&
                isTileInAttackRange(selectedArmy, selectedTile, tile, gameState.tiles),
            );
            const isSmokePreview = smokePreviewIds.has(tile.id);
            const trenchConnections = tile.trench
              ? {
                  north: Boolean(tileById.get(tileIdFromCoords(tile.x, tile.y - 1))?.trench),
                  east: Boolean(tileById.get(tileIdFromCoords(tile.x + 1, tile.y))?.trench),
                  south: Boolean(tileById.get(tileIdFromCoords(tile.x, tile.y + 1))?.trench),
                  west: Boolean(tileById.get(tileIdFromCoords(tile.x - 1, tile.y))?.trench),
                }
              : { north: false, east: false, south: false, west: false };
            return (
              <Tile
                key={tile.id}
                tile={tile}
                army={army}
                owner={owner}
                armyOwner={armyOwner}
                mineOwner={mineOwner}
                unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
                unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
                unitTileOwnerColorMode={unitTileOwnerColorMode}
                unitTileOwnerSolidIntensity={unitTileOwnerSolidIntensity}
                unitOwnerBarEnabled={unitOwnerBarEnabled}
                unitStatDisplayMode={unitStatDisplayMode}
                unitHealthBarPosition={unitHealthBarPosition}
                unitDefenseValueVisible={unitDefenseValueVisible}
                unitStatLabelMode={unitStatLabelMode}
                isCompactZoom={zoom < 0.8}
                sentryCoverageColor={sentryCoverageByTileId.get(tile.id) ?? null}
                isFogged={!isDiscovered}
                isExploredButNotVisible={isDiscovered && !isVisible}
                actionRemaining={
                  army
                    ? (gameState.game.status === 'active' &&
                      ((gameState.game.mode === 'timed-simultaneous' && army.ownerId === currentPlayer.id) ||
                        army.ownerId === gameState.game.currentTurnPlayerId) &&
                      movementAllowance(armyOwner ?? undefined, army) - (army.movementUsedThisTurn ?? 0) > 0 &&
                      (army.fortifyTurnsRemaining ?? 0) === 0)
                    : null
                }
                hasBaseDefenseBuff={hasBaseDefenseBuff}
                hasConnectedBaseNetwork={hasConnectedBaseNetwork}
                trenchConnections={trenchConnections}
                isSelected={selectedArmy?.tileId === tile.id}
                isReachable={isReachable}
                isAttackRadius={isAttackRadius}
                isAttackable={isAttackable}
                isSmokeTarget={isSmokeTarget}
                isSmokePreview={isSmokePreview}
                isAttackTarget={targetedAttackTileId === tile.id}
                isMergeable={isMergeable}
                isMergeTarget={targetedMergeTileId === tile.id}
                showActionTray={
                  actionMenuTileId === tile.id || targetedAttackTileId === tile.id || targetedMergeTileId === tile.id
                }
                combatTexts={tileCombatTexts}
                moveAnimation={moveAnimation}
                attackFacingAngle={attackFacing?.angleDeg ?? null}
                hasArtilleryImpact={hasArtilleryImpact}
                queuedMoveTurns={isQueuedDestination ? queuedMovePreview?.turnsRemaining ?? null : null}
                queuedMoveMode={isQueuedDestination ? queuedMovePreview?.mode ?? null : null}
                onClick={() => handleTileClick(tile, army)}
                onHover={() => setHoveredTileId(tile.id)}
                onCancelSmokeTargeting={smokeTargetingArmyId ? onCancelSmokeTargeting : undefined}
                onOpenActions={army ? () => setActionMenuTileId((current) => (current === tile.id ? null : tile.id)) : undefined}
                onAttackClick={isAttackable && targetedAttackTileId === tile.id ? () => runAction(() => onAttackClick(tile)) : undefined}
                onCombineClick={
                  isMergeable && targetedMergeTileId === tile.id && army ? () => runAction(() => onCombineClick(army)) : undefined
                }
                onBuildBaseClick={canBuildBase && army ? () => runAction(() => onBuildBaseClick(army)) : undefined}
                onReclaimBaseClick={canReclaimBase && army ? () => runAction(() => onReclaimBaseClick(army)) : undefined}
                onBuildTrenchClick={canBuildTrench && army ? () => runAction(() => onBuildTrenchClick(army)) : undefined}
                onScavengeClick={canScavenge && army ? () => runAction(() => onScavengeClick(army)) : undefined}
                onHealClick={canHealArmy && army ? () => runAction(() => onHealClick(army)) : undefined}
                onPlaceMineClick={canPlaceMine && army ? () => runAction(() => onPlaceMineClick(army)) : undefined}
                onSmokeScreenClick={canSmokeScreen && army ? () => runAction(() => onSmokeScreenClick(army)) : undefined}
                onFortifyClick={canFortify && army ? () => runAction(() => onFortifyClick(army)) : undefined}
                onSetAggressiveClick={
                  army && selectedArmy?.id === army.id && army.queuedMoveTileId
                    ? () => runAction(() => onSetMoveOrderMode(army, 'aggressive'))
                    : undefined
                }
                onSetPassiveClick={
                  army && selectedArmy?.id === army.id && army.queuedMoveTileId
                    ? () => runAction(() => onSetMoveOrderMode(army, 'passive'))
                    : undefined
                }
                onClearMoveOrderClick={
                  army && selectedArmy?.id === army.id && army.queuedMoveTileId
                    ? () => runAction(() => onClearMoveOrder(army))
                    : undefined
                }
                onBaseClick={visibleBase?.ownerId === currentPlayer.id && !visibleBase.ruined ? () => onBaseClick(tile) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function smokeAreaIdsForOrigin(tile: TileDoc) {
  return new Set([
    tile.id,
    tileIdFromCoords(tile.x + 1, tile.y),
    tileIdFromCoords(tile.x, tile.y + 1),
    tileIdFromCoords(tile.x + 1, tile.y + 1),
  ]);
}

function sentryRangeForPlayer(baseRange: number, player?: PlayerDoc) {
  if (baseRange <= 0) return 0;
  return baseRange + (player?.talents.sentryNetwork ?? 0);
}
