import { type CSSProperties, PointerEvent, WheelEvent, useMemo, useRef, useState } from 'react';
import type { ArmyDoc, GameState, PlayerDoc, TileDoc } from '../../types/gameTypes';
import { armyHasMedic } from '../../utils/combat';
import {
  armyMustStaySolo,
  canCombineArmies,
  canLogisticsBuildBase,
  canLogisticsBuildTrench,
  canLogisticsScavenge,
  canMoveArmy,
  getAttackStagingTile,
  isTileInAttackRange,
  movementAllowance,
} from '../../utils/movement';
import { visibleTileIdsForPlayer } from '../../utils/vision';
import Tile from './Tile';

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

interface GridMapProps {
  gameState: GameState;
  currentPlayer: PlayerDoc;
  selectedArmy: ArmyDoc | null;
  targetedAttackTileId: string | null;
  targetedMergeTileId: string | null;
  combatTexts: FloatingCombatText[];
  moveAnimations: MoveAnimation[];
  bulletTraces: BulletTrace[];
  attackFacings: AttackFacing[];
  unitTileOwnerTintEnabled: boolean;
  unitTileOwnerTintIntensity: number;
  unitOwnerBarEnabled: boolean;
  onTileClick: (tile: GameState['tiles'][number], occupyingArmy: ArmyDoc | null) => void;
  onAttackClick: (tile: TileDoc) => void;
  onCombineClick: (targetArmy: ArmyDoc) => void;
  onBuildBaseClick: (builderArmy: ArmyDoc) => void;
  onBuildTrenchClick: (builderArmy: ArmyDoc) => void;
  onScavengeClick: (builderArmy: ArmyDoc) => void;
  onHealClick: (army: ArmyDoc) => void;
  onPlaceMineClick: (army: ArmyDoc) => void;
  onFortifyClick: (army: ArmyDoc) => void;
  onBaseClick: (tile: TileDoc) => void;
}

export default function GridMap({
  gameState,
  currentPlayer,
  selectedArmy,
  targetedAttackTileId,
  targetedMergeTileId,
  combatTexts,
  moveAnimations,
  bulletTraces,
  attackFacings,
  unitTileOwnerTintEnabled,
  unitTileOwnerTintIntensity,
  unitOwnerBarEnabled,
  onTileClick,
  onAttackClick,
  onCombineClick,
  onBuildBaseClick,
  onBuildTrenchClick,
  onScavengeClick,
  onHealClick,
  onPlaceMineClick,
  onFortifyClick,
  onBaseClick,
}: GridMapProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [actionMenuTileId, setActionMenuTileId] = useState<string | null>(null);
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
  const visibleTileIds = useMemo(
    () => visibleTileIdsForPlayer(currentPlayer.id, gameState.tiles, gameState.armies),
    [currentPlayer.id, gameState.armies, gameState.tiles],
  );
  const exploredTileIds = useMemo(
    () => new Set([...(currentPlayer.exploredTileIds ?? []), ...visibleTileIds]),
    [currentPlayer.exploredTileIds, visibleTileIds],
  );

  const sortedTiles = useMemo(() => [...gameState.tiles].sort((a, b) => a.y - b.y || a.x - b.x), [gameState.tiles]);
  const tileById = useMemo(() => new Map(gameState.tiles.map((tile) => [tile.id, tile])), [gameState.tiles]);

  function clampZoom(value: number) {
    return Math.min(2.35, Math.max(0.78, Number(value.toFixed(2))));
  }

  function changeZoom(delta: number) {
    setZoom((current) => clampZoom(current + delta));
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
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('button')) return;
    if (event.button === 0 && target.closest('.tile')) return;
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
        <button className="secondary" onClick={() => changeZoom(-0.1)} aria-label="Zoom out">
          -
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="secondary" onClick={() => changeZoom(0.1)} aria-label="Zoom in">
          +
        </button>
        <button
          className="secondary"
          onClick={() => {
            setZoom(1);
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
      >
        <div
          ref={gridRef}
          className={`grid-map ${dragStart ? 'panning' : ''}`}
          style={{
            '--stat-scale': statScale,
            gridTemplateColumns: `repeat(${gameState.game.mapWidth}, 78px)`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          } as CSSProperties}
        >
          <div className="bullet-layer" aria-hidden="true">
            {bulletTraces.map((trace) => {
              const fromTile = tileById.get(trace.fromTileId);
              const toTile = tileById.get(trace.toTileId);
              if (!fromTile || !toTile) return null;
              const fromCenterX = fromTile.x * 82 + 39;
              const fromCenterY = fromTile.y * 82 + 39;
              const toCenterX = toTile.x * 82 + 39;
              const toCenterY = toTile.y * 82 + 39;
              const aimDeltaX = toCenterX - fromCenterX;
              const aimDeltaY = toCenterY - fromCenterY;
              const aimLength = Math.hypot(aimDeltaX, aimDeltaY);
              const unitX = aimLength > 0 ? aimDeltaX / aimLength : 0;
              const unitY = aimLength > 0 ? aimDeltaY / aimLength : 0;
              const fromX = fromCenterX + unitX * 15;
              const fromY = fromCenterY + unitY * 15;
              const toX = toCenterX - unitX * 20;
              const toY = toCenterY - unitY * 20;
              const deltaX = toX - fromX;
              const deltaY = toY - fromY;
              const length = Math.hypot(deltaX, deltaY);
              const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
              const perpendicularX = length > 0 ? (-deltaY / length) * trace.laneOffset : 0;
              const perpendicularY = length > 0 ? (deltaX / length) * trace.laneOffset : 0;
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
            const hasBaseDefenseBuff = Boolean(
              army &&
                gameState.tiles.some(
                  (baseTile) =>
                    baseTile.base?.ownerId === army.ownerId &&
                    Math.max(Math.abs(baseTile.x - tile.x), Math.abs(baseTile.y - tile.y)) <= 1,
                ),
            );
            const hasEnemyArmy = Boolean(army && army.ownerId !== currentPlayer.id);
            const hasEnemyBase = Boolean(visibleBase && visibleBase.ownerId !== currentPlayer.id);
            const selectedIsMine = selectedArmy?.ownerId === currentPlayer.id;
            const isMergeable = Boolean(
              selectedArmy &&
                army &&
                selectedIsMine &&
                selectedTile &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                canCombineArmies(selectedArmy, army, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies),
            );
            const canBuildBase = Boolean(
              army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
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
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsBuildTrench(army) &&
                !army.hasActedThisTurn &&
                !tile.trench,
            );
            const canScavenge = Boolean(
              army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                army.units.length === 1 &&
                army.units[0].typeId === 'builder' &&
                canLogisticsScavenge(army) &&
                !army.hasActedThisTurn,
            );
            const canHealArmy = Boolean(
              army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                armyHasMedic(army.units) &&
                !army.hasMovedThisTurn &&
                !army.hasActedThisTurn,
            );
            const canPlaceMine = Boolean(
              army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                army.units.some((unit) => unit.typeId === 'antiVehicle') &&
                !armyMustStaySolo(army) &&
                !army.hasActedThisTurn &&
                !tile.mine,
            );
            const canFortify = Boolean(
              army &&
                selectedArmy?.id === army.id &&
                army.ownerId === currentPlayer.id &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                !army.hasActedThisTurn &&
                (army.fortifyTurnsRemaining ?? 0) === 0,
            );
            const isReachable = Boolean(
              selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                canMoveArmy(selectedArmy, selectedTile, tile, currentPlayer, gameState.tiles, gameState.armies),
            );
            const isAttackRadius = Boolean(
              selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                !selectedArmy.hasActedThisTurn &&
                isVisible &&
                isTileInAttackRange(selectedArmy, selectedTile, tile, gameState.tiles),
            );
            const isAttackable = Boolean(
              selectedArmy &&
                selectedIsMine &&
                selectedTile &&
                gameState.game.currentTurnPlayerId === currentPlayer.id &&
                (hasEnemyArmy || hasEnemyBase) &&
                getAttackStagingTile(gameState.tiles, selectedArmy, selectedTile, tile, currentPlayer, gameState.armies),
            );
            const tileCombatTexts = combatTexts.filter((entry) => entry.tileId === tile.id);
            const moveAnimation = moveAnimations.find((entry) => entry.tileId === tile.id) ?? null;
            const attackFacing = army ? attackFacings.find((entry) => entry.armyId === army.id) ?? null : null;
            return (
              <Tile
                key={tile.id}
                tile={tile}
                army={army}
                owner={owner}
                armyOwner={armyOwner}
                unitTileOwnerTintEnabled={unitTileOwnerTintEnabled}
                unitTileOwnerTintIntensity={unitTileOwnerTintIntensity}
                unitOwnerBarEnabled={unitOwnerBarEnabled}
                isFogged={!isDiscovered}
                isExploredButNotVisible={isDiscovered && !isVisible}
                actionRemaining={
                  army
                    ? army.ownerId === gameState.game.currentTurnPlayerId &&
                      movementAllowance(armyOwner ?? undefined, army) - (army.movementUsedThisTurn ?? 0) > 0 &&
                      (army.fortifyTurnsRemaining ?? 0) === 0
                    : null
                }
                hasBaseDefenseBuff={hasBaseDefenseBuff}
                isSelected={selectedArmy?.tileId === tile.id}
                isReachable={isReachable}
                isAttackRadius={isAttackRadius}
                isAttackable={isAttackable}
                isAttackTarget={targetedAttackTileId === tile.id}
                isMergeable={isMergeable}
                isMergeTarget={targetedMergeTileId === tile.id}
                showActionTray={
                  actionMenuTileId === tile.id || targetedAttackTileId === tile.id || targetedMergeTileId === tile.id
                }
                combatTexts={tileCombatTexts}
                moveAnimation={moveAnimation}
                attackFacingAngle={attackFacing?.angleDeg ?? null}
                onClick={() => handleTileClick(tile, army)}
                onOpenActions={army ? () => setActionMenuTileId((current) => (current === tile.id ? null : tile.id)) : undefined}
                onAttackClick={isAttackable && targetedAttackTileId === tile.id ? () => runAction(() => onAttackClick(tile)) : undefined}
                onCombineClick={
                  isMergeable && targetedMergeTileId === tile.id && army ? () => runAction(() => onCombineClick(army)) : undefined
                }
                onBuildBaseClick={canBuildBase && army ? () => runAction(() => onBuildBaseClick(army)) : undefined}
                onBuildTrenchClick={canBuildTrench && army ? () => runAction(() => onBuildTrenchClick(army)) : undefined}
                onScavengeClick={canScavenge && army ? () => runAction(() => onScavengeClick(army)) : undefined}
                onHealClick={canHealArmy && army ? () => runAction(() => onHealClick(army)) : undefined}
                onPlaceMineClick={canPlaceMine && army ? () => runAction(() => onPlaceMineClick(army)) : undefined}
                onFortifyClick={canFortify && army ? () => runAction(() => onFortifyClick(army)) : undefined}
                onBaseClick={visibleBase?.ownerId === currentPlayer.id ? () => onBaseClick(tile) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
