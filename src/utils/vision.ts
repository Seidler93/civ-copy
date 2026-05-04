import type { ArmyDoc, TileDoc } from '../types/gameTypes';

export const UNIT_VISION_RANGE = 4;
export const BASE_VISION_RANGE = 5;
export const RECON_VISION_RANGE = 8;

export function visibleTileIdsForPlayer(playerId: string, tiles: TileDoc[], armies: ArmyDoc[]) {
  const visibleTileIds = new Set<string>();
  const visionSources = [
    ...tiles
      .filter((tile) => tile.base?.ownerId === playerId)
      .map((tile) => ({ tile, range: BASE_VISION_RANGE })),
    ...armies
      .filter((army) => army.ownerId === playerId)
      .map((army) => {
        const tile = tiles.find((candidate) => candidate.id === army.tileId);
        return tile ? { tile, range: armyHasRecon(army) ? RECON_VISION_RANGE : UNIT_VISION_RANGE } : null;
      })
      .filter((entry): entry is { tile: TileDoc; range: number } => entry !== null),
  ];

  tiles.forEach((tile) => {
    if (visionSources.some((source) => chebyshevDistance(source.tile, tile) <= source.range)) {
      visibleTileIds.add(tile.id);
    }
  });

  return visibleTileIds;
}

function chebyshevDistance(a: TileDoc, b: TileDoc) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function armyHasRecon(army: ArmyDoc) {
  return army.units.some((unit) => unit.typeId === 'recon');
}
