import type { ArmyDoc, TileDoc } from '../types/gameTypes';
import { tileIdFromCoords } from './movement';

export const CONNECTED_BASE_SUPPLY_BONUS = 8;

export function connectedBaseTiles(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  if (!baseTile.base || !baseTile.base.ownerId || baseTile.base.ruined) return [];

  const ownerId = baseTile.base.ownerId;
  const tileById = new Map(tiles.map((tile) => [tile.id, tile]));
  const visited = new Set([baseTile.id]);
  const queue = [baseTile];
  const connectedBases: TileDoc[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.base?.ownerId === ownerId) connectedBases.push(current);

    for (const neighborId of neighborIds(current)) {
      const neighbor = tileById.get(neighborId);
      if (!neighbor || visited.has(neighbor.id)) continue;
      if (!isNetworkTile(neighbor, ownerId, armies)) continue;

      visited.add(neighbor.id);
      queue.push(neighbor);
    }
  }

  return connectedBases;
}

export function effectiveBarracksLevel(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  const connectedBases = connectedBaseTiles(baseTile, tiles, armies);
  return Math.max(baseTile.base?.barracksLevel ?? 1, ...connectedBases.map((tile) => tile.base?.barracksLevel ?? 1));
}

export function connectedBaseSupplyBonus(baseTile: TileDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  return connectedBaseTiles(baseTile, tiles, armies).length > 1 ? CONNECTED_BASE_SUPPLY_BONUS : 0;
}

function isNetworkTile(tile: TileDoc, ownerId: string, armies: ArmyDoc[]) {
  const occupyingArmy = tile.armyId ? armies.find((army) => army.id === tile.armyId) : null;
  if (occupyingArmy && occupyingArmy.ownerId !== ownerId) return false;
  return tile.trench?.ownerId === ownerId || (tile.base?.ownerId === ownerId && !tile.base?.ruined);
}

function neighborIds(tile: TileDoc) {
  return [
    tileIdFromCoords(tile.x + 1, tile.y),
    tileIdFromCoords(tile.x - 1, tile.y),
    tileIdFromCoords(tile.x, tile.y + 1),
    tileIdFromCoords(tile.x, tile.y - 1),
  ];
}
