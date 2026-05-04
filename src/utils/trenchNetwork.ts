import type { ArmyDoc, TileDoc, UnitTypeId } from '../types/gameTypes';
import { tileIdFromCoords } from './movement';

export const CONNECTED_BASE_SUPPLY_BONUS = 8;

export function connectedBaseTiles(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  if (!baseTile.base || !baseTile.base.ownerId || baseTile.base.ruined) return [];

  const ownerId = baseTile.base.ownerId;
  const tileById = new Map(tiles.map((tile) => [tile.id, tile]));
  const connectedBaseIds = new Set([baseTile.id]);
  const visitedTrenches = new Set<string>();
  const queue: TileDoc[] = [];

  enqueueAdjacentTrenches(baseTile, ownerId, tileById, armies, visitedTrenches, queue);

  while (queue.length > 0) {
    const currentTrench = queue.shift()!;
    for (const neighborId of neighborIds(currentTrench)) {
      const neighbor = tileById.get(neighborId);
      if (!neighbor) continue;

      if (isFriendlyActiveBase(neighbor, ownerId)) {
        connectedBaseIds.add(neighbor.id);
        enqueueAdjacentTrenches(neighbor, ownerId, tileById, armies, visitedTrenches, queue);
        continue;
      }

      if (!isOwnedOpenTrench(neighbor, ownerId, armies) || visitedTrenches.has(neighbor.id)) continue;
      visitedTrenches.add(neighbor.id);
      queue.push(neighbor);
    }
  }

  return [...connectedBaseIds].map((baseId) => tileById.get(baseId)).filter((tile): tile is TileDoc => Boolean(tile));
}

export function effectiveBarracksLevel(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  const connectedBases = connectedBaseTiles(baseTile, tiles, armies);
  return Math.max(baseTile.base?.barracksLevel ?? 1, ...connectedBases.map((tile) => tile.base?.barracksLevel ?? 1));
}

export function effectiveUnitQualityLevel(baseTile: TileDoc, unitTypeId: UnitTypeId, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  const connectedBases = connectedBaseTiles(baseTile, tiles, armies);
  return Math.max(
    baseTile.base?.unitQualityByType?.[unitTypeId] ?? baseTile.base?.unitQualityLevel ?? 1,
    ...connectedBases.map((tile) => tile.base?.unitQualityByType?.[unitTypeId] ?? tile.base?.unitQualityLevel ?? 1),
  );
}

export function connectedBaseSupplyBonus(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  return connectedBaseTiles(baseTile, tiles, armies).length > 1 ? CONNECTED_BASE_SUPPLY_BONUS : 0;
}

function enqueueAdjacentTrenches(
  baseTile: TileDoc,
  ownerId: string,
  tileById: Map<string, TileDoc>,
  armies: ArmyDoc[],
  visitedTrenches: Set<string>,
  queue: TileDoc[],
) {
  for (const neighborId of neighborIds(baseTile)) {
    const neighbor = tileById.get(neighborId);
    if (!neighbor || visitedTrenches.has(neighbor.id) || !isOwnedOpenTrench(neighbor, ownerId, armies)) continue;
    visitedTrenches.add(neighbor.id);
    queue.push(neighbor);
  }
}

function isFriendlyActiveBase(tile: TileDoc, ownerId: string) {
  return tile.base?.ownerId === ownerId && !tile.base?.ruined;
}

function isOwnedOpenTrench(tile: TileDoc, ownerId: string, armies: ArmyDoc[]) {
  const occupyingArmy = tile.armyId ? armies.find((army) => army.id === tile.armyId) : null;
  if (occupyingArmy && occupyingArmy.ownerId !== ownerId) return false;
  return tile.trench?.ownerId === ownerId;
}

function neighborIds(tile: TileDoc) {
  return [
    tileIdFromCoords(tile.x + 1, tile.y),
    tileIdFromCoords(tile.x - 1, tile.y),
    tileIdFromCoords(tile.x, tile.y + 1),
    tileIdFromCoords(tile.x, tile.y - 1),
  ];
}
