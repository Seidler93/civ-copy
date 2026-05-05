export type GameStatus = 'lobby' | 'active' | 'finished';
export type GameMode = 'turn-based' | 'timed-simultaneous';
export type TerrainType = 'plains' | 'forest' | 'hill' | 'water' | 'mountain';
export type UnitTypeId =
  | 'gunman'
  | 'recon'
  | 'sniper'
  | 'tank'
  | 'antiVehicle'
  | 'builder'
  | 'medic'
  | 'artillery'
  | 'lightArtillery'
  | 'smokeArtillery'
  | 'siegeArtillery';
export type MoveDirection = 'north' | 'east' | 'south' | 'west';
export type MoveOrderMode = 'aggressive' | 'passive';
export type VictoryReason = 'elimination' | 'turn-limit' | 'host-ended';
export type TalentId =
  | 'attackTraining'
  | 'coordinatedAssault'
  | 'defensiveDrills'
  | 'baseFortification'
  | 'logistics'
  | 'quartermaster'
  | 'mobilization';

export interface GameDoc {
  id: string;
  code: string;
  hostPlayerId: string;
  status: GameStatus;
  isPaused?: boolean;
  pausedAtMs?: number | null;
  mapId?: string;
  mapName?: string;
  mode: GameMode;
  turnLimitRounds?: number | null;
  winnerPlayerId?: string | null;
  victoryReason?: VictoryReason | null;
  roundDurationSeconds: number | null;
  roundEndsAtMs?: number | null;
  currentTurnPlayerId: string | null;
  turnNumber: number;
  roundNumber: number;
  mapWidth: number;
  mapHeight: number;
  maxPlayers?: number;
  createdAt: unknown;
}

export interface PlayerStats {
  enemiesKilled: number;
  basesBuilt: number;
  basesCaptured: number;
  basesDestroyed: number;
  unitsLost: number;
  unitsCreated: number;
}

export interface PlayerDoc {
  id: string;
  name: string;
  color: string;
  supplies: number;
  xp: number;
  level: number;
  talentPoints: number;
  talents: Partial<Record<TalentId, number>>;
  isEliminated: boolean;
  stats?: PlayerStats;
  isCpu?: boolean;
  exploredTileIds?: string[];
  joinedAt: unknown;
}

export interface BaseState {
  ownerId: string | null;
  barracksLevel: number;
  unitQualityLevel: number;
  unitQualityByType?: Partial<Record<UnitTypeId, number>>;
  defenseLevel: number;
  offenseLevel?: number;
  lastSentryTurnNumber?: number | null;
  ruined?: boolean;
  previousOwnerId?: string | null;
}

export interface MineState {
  ownerId: string;
  damage: number;
}

export interface TrenchState {
  ownerId: string;
}

export interface SmokeState {
  ownerId: string;
  expiresRound: number;
}

export interface TileDoc {
  id: string;
  x: number;
  y: number;
  terrainType: TerrainType;
  ownerId: string | null;
  armyId: string | null;
  base: BaseState | null;
  mine: MineState | null;
  trench?: TrenchState | null;
  smoke?: SmokeState | null;
}

export interface UnitInstance {
  id: string;
  typeId: UnitTypeId;
  attack: number;
  defense: number;
  qualityLevel: number;
  level: number;
  xp: number;
  maxHealth: number;
  currentHealth: number;
  artilleryReloadUntilRound?: number;
  smokeReloadUntilRound?: number;
}

export interface ArmyDoc {
  id: string;
  ownerId: string;
  tileId: string;
  units: UnitInstance[];
  hasMovedThisTurn: boolean;
  hasActedThisTurn: boolean;
  movementUsedThisTurn?: number;
  lastMoveDirection?: MoveDirection;
  fortifyTurnsRemaining?: number;
  passiveHealSkippedRound?: number;
  queuedMoveTileId?: string | null;
  queuedMoveMode?: MoveOrderMode | null;
}

export interface GameState {
  game: GameDoc;
  players: PlayerDoc[];
  tiles: TileDoc[];
  armies: ArmyDoc[];
}

export interface UnitTypeConfig {
  id: UnitTypeId;
  name: string;
  cost: number;
  space: number;
  attack: number;
  defense: number;
  description: string;
}

export interface CombatResult {
  attackRoll: number;
  defenseRoll: number;
  attackPower: number;
  defensePower: number;
  attackSupportBonus: number;
  attackerLosses: number;
  defenderLosses: number;
  defenderDestroyed: boolean;
  baseDestroyed: boolean;
}

export interface AttackOutcome extends CombatResult {
  message: string;
  attackerTileId: string;
  defenderTileId: string;
  xpGained: number;
  suppliesGained: number;
  defenderSuppliesGained: number;
  unitXpGained: number;
}

export interface MoveOutcome {
  message: string;
  armyDestroyed: boolean;
  triggeredMineTileId?: string;
  mineDamage?: number;
  sentryBaseTileId?: string;
  sentryTriggerTileId?: string;
  sentryDamage?: number;
  sentryReturnFirePower?: number;
  sentryBaseDestroyed?: boolean;
  debugLines?: string[];
}
