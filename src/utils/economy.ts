import { BASE_SUPPLIES_PER_TURN } from '../data/upgradeConfig';
import type { ArmyDoc, PlayerDoc, TileDoc } from '../types/gameTypes';
import { connectedBaseSupplyBonus } from './trenchNetwork';

export function suppliesFromBases(player: PlayerDoc, tiles: TileDoc[], armies: ArmyDoc[] = []) {
  const economyBonus = (player.talents.logistics ?? 0) * 5;
  return tiles
    .filter((tile) => tile.base?.ownerId === player.id)
    .reduce(
      (total, tile) => total + BASE_SUPPLIES_PER_TURN + economyBonus + connectedBaseSupplyBonus(tile, tiles, armies),
      0,
    );
}
