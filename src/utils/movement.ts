import type { ArmyDoc, PlayerDoc, TileDoc, UnitTypeId } from '../types/gameTypes';
import { ARMY_SPACE_CAPACITY, armySpaceUsed } from './combat';

export const ARTILLERY_ATTACK_RANGE = 6;
export const STANDARD_ATTACK_RANGE = 2;
export const SNIPER_ATTACK_RANGE = 3;
export const RECON_MOVEMENT_BONUS = 3;
export const ENGINEER_MOVEMENT_BONUS = 1;
export const NORMAL_ARTILLERY_RELOAD_ROUNDS = 2;
export const ARTILLERY_UNIT_TYPES = new Set<UnitTypeId>(['artillery', 'lightArtillery', 'smokeArtillery', 'siegeArtillery']);
export const NORMAL_ARTILLERY_UNIT_TYPES = new Set<UnitTypeId>(['artillery', 'lightArtillery']);

export function tileIdFromCoords(x: number, y: number) {
  return `${x}_${y}`;
}

export function manhattanDistance(a: TileDoc, b: TileDoc) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshevDistance(a: TileDoc, b: TileDoc) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function movementAllowance(player?: PlayerDoc, army?: ArmyDoc | null) {
  return 3 + (player?.talents.mobilization ?? 0) + (armyHasRecon(army) ? RECON_MOVEMENT_BONUS : 0) + (isSoloEngineerArmy(army) ? ENGINEER_MOVEMENT_BONUS : 0);
}

export function canMoveArmy(
  army: ArmyDoc,
  from: TileDoc,
  to: TileDoc,
  player: PlayerDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[] = [],
) {
  const remainingMovement = movementAllowance(player, army) - (army.movementUsedThisTurn ?? 0);
  if ((army.fortifyTurnsRemaining ?? 0) > 0) return false;
  if (remainingMovement <= 0) return false;
  if (to.armyId) return false;
  if (isActiveBaseTile(to)) return false;
  if (isImpassableTerrain(to)) return false;
  const cost = movementCost(from, to, tiles, { armies, passThroughOwnerId: army.ownerId });
  return cost !== null && cost <= remainingMovement;
}

export function isImpassableTerrain(tile: TileDoc) {
  return tile.terrainType === 'water' || tile.terrainType === 'mountain';
}

export function isActiveBaseTile(tile: TileDoc) {
  return Boolean(tile.base && !tile.base.ruined);
}

export function canCombineArmies(
  sourceArmy: ArmyDoc,
  targetArmy: ArmyDoc,
  sourceTile: TileDoc,
  targetTile: TileDoc,
  player: PlayerDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[] = [],
  allowMixedUnitCombines = false,
) {
  if (sourceArmy.id === targetArmy.id) return false;
  if (sourceArmy.ownerId !== player.id || targetArmy.ownerId !== player.id) return false;
  if (sourceArmy.hasMovedThisTurn) return false;
  if (armyMustStaySolo(sourceArmy) || armyMustStaySolo(targetArmy)) return false;
  if (!allowMixedUnitCombines && !armiesShareSingleUnitType(sourceArmy, targetArmy)) return false;
  if (armySpaceUsed(sourceArmy.units) + armySpaceUsed(targetArmy.units) > ARMY_SPACE_CAPACITY) return false;
  const cost = movementCost(sourceTile, targetTile, tiles, {
    allowOccupiedTarget: true,
    armies,
    passThroughOwnerId: sourceArmy.ownerId,
  });
  return cost !== null && cost <= movementAllowance(player, sourceArmy) - (sourceArmy.movementUsedThisTurn ?? 0);
}

function armiesShareSingleUnitType(sourceArmy: ArmyDoc, targetArmy: ArmyDoc) {
  const sourceTypeId = sourceArmy.units[0]?.typeId;
  const targetTypeId = targetArmy.units[0]?.typeId;
  if (!sourceTypeId || !targetTypeId || sourceTypeId !== targetTypeId) return false;
  return (
    sourceArmy.units.every((unit) => unit.typeId === sourceTypeId) &&
    targetArmy.units.every((unit) => unit.typeId === targetTypeId)
  );
}

export function armyHasBuilder(army: ArmyDoc) {
  return army.units.some((unit) => unit.typeId === 'builder');
}

export function isSoloLogisticsArmy(army: ArmyDoc) {
  return army.units.length === 1 && army.units[0].typeId === 'builder';
}

export function isSoloEngineerArmy(army?: ArmyDoc | null) {
  return Boolean(army && army.units.length === 1 && army.units[0].typeId === 'builder');
}

export function logisticsTier(army: ArmyDoc) {
  if (!isSoloLogisticsArmy(army)) return 0;
  const logisticsSquad = army.units[0];
  return Math.max(logisticsSquad.level ?? 1, logisticsSquad.qualityLevel ?? 1);
}

export function canLogisticsBuildBase(army: ArmyDoc) {
  return logisticsTier(army) >= 1;
}

export function canLogisticsBuildTrench(army: ArmyDoc) {
  return logisticsTier(army) >= 2;
}

export function canLogisticsScavenge(army: ArmyDoc) {
  return logisticsTier(army) >= 3;
}

export function armyHasArtillery(army: ArmyDoc) {
  return army.units.some((unit) => ARTILLERY_UNIT_TYPES.has(unit.typeId));
}

export function armyHasRecon(army?: ArmyDoc | null) {
  return Boolean(army?.units.some((unit) => unit.typeId === 'recon'));
}

export function isSoloSniperArmy(army?: ArmyDoc | null) {
  return Boolean(army && army.units.length === 1 && army.units[0].typeId === 'sniper');
}

export function armyMustStaySolo(army: ArmyDoc) {
  return armyHasBuilder(army) || armyHasArtillery(army) || armyHasRecon(army);
}

export function isSoloArtilleryArmy(army: ArmyDoc) {
  return army.units.length === 1 && ARTILLERY_UNIT_TYPES.has(army.units[0].typeId);
}

export function isNormalArtilleryArmy(army: ArmyDoc) {
  return army.units.length === 1 && NORMAL_ARTILLERY_UNIT_TYPES.has(army.units[0].typeId);
}

export function normalArtilleryCanFire(army: ArmyDoc, roundNumber: number) {
  if (!isNormalArtilleryArmy(army)) return true;
  return (army.units[0].artilleryReloadUntilRound ?? 0) <= roundNumber;
}

export function canAttackTile(army: ArmyDoc, from: TileDoc, to: TileDoc, playerId: string, tiles: TileDoc[] = [], roundNumber?: number) {
  if (army.hasActedThisTurn) return false;
  if (army.ownerId !== playerId) return false;
  if (roundNumber !== undefined && !normalArtilleryCanFire(army, roundNumber)) return false;
  if (!isTileInAttackRange(army, from, to, tiles)) return false;

  const hasEnemyArmy = Boolean(to.armyId);
  const hasEnemyBase = Boolean(to.base && to.base.ownerId !== playerId);
  return hasEnemyArmy || hasEnemyBase;
}

export function isTileInAttackRange(army: ArmyDoc, from: TileDoc, to: TileDoc, tiles: TileDoc[] = []) {
  if (from.id === to.id) return false;
  if (isImpassableTerrain(to)) return false;
  return chebyshevDistance(from, to) <= attackRangeForArmy(army) && hasLineOfSight(from, to, tiles);
}

export function hasLineOfSight(from: TileDoc, to: TileDoc, tiles: TileDoc[]) {
  if (tiles.length === 0) return true;

  const tileByCoord = new Map(tiles.map((tile) => [tileIdFromCoords(tile.x, tile.y), tile]));
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  if (steps <= 1) return true;

  for (let step = 1; step < steps; step += 1) {
    const x = from.x + Math.round((deltaX * step) / steps);
    const y = from.y + Math.round((deltaY * step) / steps);
    const blockingTile = tileByCoord.get(tileIdFromCoords(x, y));
    if (blockingTile?.terrainType === 'mountain') return false;
  }

  return true;
}

export function attackRangeForArmy(army: ArmyDoc) {
  if (isSoloArtilleryArmy(army)) return ARTILLERY_ATTACK_RANGE;
  if (isSoloSniperArmy(army)) return SNIPER_ATTACK_RANGE;
  return STANDARD_ATTACK_RANGE;
}

export function getAttackStagingTile(
  tiles: TileDoc[],
  army: ArmyDoc,
  from: TileDoc,
  target: TileDoc,
  player: PlayerDoc,
  _armies: ArmyDoc[] = [],
  roundNumber?: number,
) {
  return canAttackTile(army, from, target, player.id, tiles, roundNumber) ? from : null;
}

interface MovementPathOptions {
  allowOccupiedTarget?: boolean;
  armies?: ArmyDoc[];
  passThroughOwnerId?: string;
}

export function movementCost(
  from: TileDoc,
  to: TileDoc,
  tiles: TileDoc[],
  options: MovementPathOptions = {},
) {
  return movementPath(from, to, tiles, options)?.length ?? null;
}

export function movementPath(
  from: TileDoc,
  to: TileDoc,
  tiles: TileDoc[],
  options: MovementPathOptions = {},
) {
  if (from.id === to.id) return [];

  const tileById = new Map(tiles.map((tile) => [tile.id, tile]));
  const visited = new Set([from.id]);
  const queue: Array<{ tile: TileDoc; path: TileDoc[] }> = [{ tile: from, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighborId of neighborIds(current.tile)) {
      const neighbor = tileById.get(neighborId);
      if (!neighbor || visited.has(neighbor.id) || isImpassableTerrain(neighbor)) continue;

      const isTarget = neighbor.id === to.id;
      if (neighbor.armyId && !(options.allowOccupiedTarget && isTarget) && !canPassThroughArmy(neighbor, options)) continue;
      const nextPath = [...current.path, neighbor];
      if (isTarget) return nextPath;

      visited.add(neighbor.id);
      queue.push({ tile: neighbor, path: nextPath });
    }
  }

  return null;
}

function canPassThroughArmy(tile: TileDoc, options: MovementPathOptions) {
  if (!tile.armyId || !options.passThroughOwnerId) return false;
  const occupyingArmy = options.armies?.find((army) => army.id === tile.armyId);
  return occupyingArmy?.ownerId === options.passThroughOwnerId;
}

function neighborIds(tile: TileDoc) {
  return [
    tileIdFromCoords(tile.x + 1, tile.y),
    tileIdFromCoords(tile.x - 1, tile.y),
    tileIdFromCoords(tile.x, tile.y + 1),
    tileIdFromCoords(tile.x, tile.y - 1),
  ];
}
