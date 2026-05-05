import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { signInAnonymously, type User } from 'firebase/auth';
import { auth, db } from './firebaseConfig';
import { UNIT_TYPES } from '../data/unitTypes';
import { UNIT_COMPOSITIONS } from '../data/unitCompositions';
import { BUILD_BASE_COST, BUILD_TRENCH_COST, UPGRADE_CONFIG } from '../data/upgradeConfig';
import { previousTalentInBranch, talentById } from '../data/talentConfig';
import type {
  ArmyDoc,
  AttackOutcome,
  GameDoc,
  GameMode,
  GameState,
  MoveOrderMode,
  MoveDirection,
  MoveOutcome,
  PlayerDoc,
  PlayerStats,
  TileDoc,
  TalentId,
  UnitInstance,
  UnitTypeId,
  VictoryReason,
} from '../types/gameTypes';
import {
  ARMY_SPACE_CAPACITY,
  applyUnitXp,
  armyCurrentHealth,
  armyHasMedic,
  armyMaxHealth,
  armySpaceUsed,
  damageTankUnits,
  FIELD_HOSPITAL_PASSIVE_HEAL_BONUS,
  hasCombinedArms,
  hasEntrenchedInfantry,
  hasFieldHospital,
  hasSiegeColumn,
  hasTankHunters,
  healUnits,
  removeUnitLosses,
  resolveCombat,
} from '../utils/combat';
import { suppliesFromBases } from '../utils/economy';
import { effectiveBarracksLevel, effectiveUnitQualityLevel } from '../utils/trenchNetwork';
import { visibleTileIdsForPlayer } from '../utils/vision';
import {
  armyMustStaySolo,
  canLogisticsBuildBase,
  canLogisticsBuildTrench,
  canLogisticsScavenge,
  canCombineArmies,
  canMoveArmy,
  canAttackTile,
  isTileInAttackRange,
  ARTILLERY_UNIT_TYPES,
  chebyshevDistance,
  hasLineOfSight,
  isNormalArtilleryArmy,
  isSoloArtilleryArmy,
  isActiveBaseTile,
  isImpassableTerrain,
  manhattanDistance,
  movementAllowance,
  movementCost,
  movementPath,
  NORMAL_ARTILLERY_RELOAD_ROUNDS,
  NORMAL_ARTILLERY_UNIT_TYPES,
  tileIdFromCoords,
} from '../utils/movement';
import { applyXp } from '../utils/xp';

export const PLAYER_COLORS = ['#d94848', '#2f80ed', '#2f9e44', '#a855f7', '#f08c00'];
const STARTING_SUPPLIES = 80;
const MAX_PLAYERS = 5;
type MapTemplateId = 'classic-front' | 'grand-front';

interface MapTemplate {
  id: MapTemplateId;
  name: string;
  width: number;
  height: number;
  startingPositions: Array<{ x: number; y: number }>;
}

const MAP_TEMPLATES: Record<MapTemplateId, MapTemplate> = {
  'classic-front': {
    id: 'classic-front',
    name: 'Classic Front',
    width: 20,
    height: 20,
    startingPositions: [
      { x: 1, y: 1 },
      { x: 18, y: 18 },
      { x: 18, y: 1 },
      { x: 1, y: 18 },
    ],
  },
  'grand-front': {
    id: 'grand-front',
    name: 'Grand Front',
    width: 28,
    height: 28,
    startingPositions: [
      { x: 14, y: 2 },
      { x: 24, y: 9 },
      { x: 20, y: 24 },
      { x: 8, y: 24 },
      { x: 3, y: 9 },
    ],
  },
};

const DEFAULT_MAP_TEMPLATE = MAP_TEMPLATES['classic-front'];
export const MAX_DEPLOYED_UNITS = 50;
export const DISMISS_UNIT_MIN_COST = 3;
export const DISMISS_UNIT_COST_RATE = 0.25;
export const SMOKE_SCREEN_ATTACK_MULTIPLIER = 0.75;
export const SMOKE_SCREEN_DURATION_ROUNDS = 3;
export const SMOKE_SCREEN_RELOAD_ROUNDS = 2;
const XP_END_TURN = 5;
const XP_PER_BASE_AT_TURN_END = 3;
const XP_ATTACK = 5;
const XP_DESTROY_UNIT = 12;
const XP_DESTROY_ARMY = 25;
const XP_DESTROY_BASE = 40;
const XP_RECRUIT_UNIT = 8;
const XP_UPGRADE_BASE = 15;
const XP_BUILD_BASE = 30;
const RECLAIM_BASE_FLAT_COST = 50;
const RECLAIM_BASE_UPGRADE_COST_RATE = 0.5;
const SUPPLIES_DESTROY_UNIT = 8;
const SUPPLIES_DESTROY_ARMY = 20;
const SUPPLIES_DESTROY_BASE = 45;
const UNIT_XP_DESTROY_UNIT = 15;
const UNIT_XP_DESTROY_ARMY = 20;
const UNIT_XP_FULL_HEALTH_END_ROUND = 3;
const MEDIC_PASSIVE_HEAL = 4;
const MEDIC_ACTIVE_HEAL = 16;
const ANTI_VEHICLE_MINE_DAMAGE = 30;
const LOGISTICS_SCAVENGE_SUPPLIES = 20;
const QUALITY_HEALTH_BONUS_PER_LEVEL = 2;
const BASE_AURA_DEFENSE_BONUS = 2;
const TRENCH_ATTACK_BONUS = 2;
const TRENCH_DEFENSE_BONUS = 2;
const FORTIFY_TURNS = 2;
const FORTIFY_ATTACK_MULTIPLIER = 0.75;
const FORTIFY_DEFENSE_MULTIPLIER = 1.35;

export interface GameSetupOptions {
  mode: GameMode;
  roundDurationSeconds?: number | null;
  turnLimitRounds?: number | null;
}

const DEFAULT_GAME_SETUP: GameSetupOptions = {
  mode: 'turn-based',
  roundDurationSeconds: null,
  turnLimitRounds: null,
};

export function dismissUnitCost(unitTypeId: UnitTypeId) {
  return Math.max(DISMISS_UNIT_MIN_COST, Math.ceil(UNIT_TYPES[unitTypeId].cost * DISMISS_UNIT_COST_RATE));
}

export async function ensureAnonymousUser() {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export async function createGame(playerName: string, setup: GameSetupOptions = DEFAULT_GAME_SETUP) {
  const user = await ensureAnonymousUser();
  const code = makeGameCode();
  const normalizedSetup = normalizeGameSetup(setup);
  const gameRef = await addDoc(collection(db, 'games'), {
    code,
    hostPlayerId: user.uid,
    status: 'lobby',
    isPaused: false,
    pausedAtMs: null,
    mapId: DEFAULT_MAP_TEMPLATE.id,
    mapName: DEFAULT_MAP_TEMPLATE.name,
    mode: normalizedSetup.mode,
    turnLimitRounds: normalizedSetup.turnLimitRounds,
    winnerPlayerId: null,
    victoryReason: null,
    roundDurationSeconds: normalizedSetup.roundDurationSeconds,
    roundEndsAtMs: null,
    currentTurnPlayerId: null,
    turnNumber: 0,
    roundNumber: 1,
    mapWidth: DEFAULT_MAP_TEMPLATE.width,
    mapHeight: DEFAULT_MAP_TEMPLATE.height,
    maxPlayers: MAX_PLAYERS,
    createdAt: serverTimestamp(),
  });

  await createPlayer(gameRef.id, user, playerName, 0);
  return gameRef.id;
}

export async function createCpuGame(playerName: string, setup: GameSetupOptions = DEFAULT_GAME_SETUP) {
  const gameId = await createGame(playerName, setup);
  const user = await ensureAnonymousUser();
  await setDoc(doc(db, 'games', gameId, 'players', user.uid), { isReady: true }, { merge: true });
  await setDoc(doc(db, 'games', gameId, 'players', `cpu_${gameId}`), {
    name: 'CPU Commander',
    color: PLAYER_COLORS[1],
    supplies: STARTING_SUPPLIES,
    xp: 0,
    level: 1,
    talentPoints: 0,
    talents: {},
    isEliminated: false,
    isReady: true,
    stats: makeEmptyPlayerStats(),
    isCpu: true,
    exploredTileIds: [],
    joinedAt: serverTimestamp(),
  });
  await startGame(gameId);
  return gameId;
}

export async function createDevSoloGame() {
  const user = await ensureAnonymousUser();
  const gameRef = await addDoc(collection(db, 'games'), {
    code: 'SOLO',
    hostPlayerId: `solo_${user.uid}_one`,
    status: 'active',
    isPaused: false,
    pausedAtMs: null,
    mapId: DEFAULT_MAP_TEMPLATE.id,
    mapName: DEFAULT_MAP_TEMPLATE.name,
    mode: 'turn-based',
    turnLimitRounds: null,
    winnerPlayerId: null,
    victoryReason: null,
    roundDurationSeconds: null,
    roundEndsAtMs: null,
    currentTurnPlayerId: `solo_${user.uid}_one`,
    turnNumber: 1,
    roundNumber: 1,
    mapWidth: DEFAULT_MAP_TEMPLATE.width,
    mapHeight: DEFAULT_MAP_TEMPLATE.height,
    maxPlayers: MAX_PLAYERS,
    createdAt: serverTimestamp(),
  });
  const gameId = gameRef.id;
  const batch = writeBatch(db);
  const terrain = makeTerrain(DEFAULT_MAP_TEMPLATE);
  const devTiles = terrain.map((tile) => ({ ...tile }));
  const devArmies: ArmyDoc[] = [];
  const soloPlayers = [
    { id: `solo_${user.uid}_one`, name: 'Solo Red', color: PLAYER_COLORS[0], startIndex: 0 },
    { id: `solo_${user.uid}_two`, name: 'Solo Blue', color: PLAYER_COLORS[1], startIndex: 1 },
  ];

  terrain.forEach((tile) => {
    batch.set(doc(db, 'games', gameId, 'tiles', tile.id), tile);
  });

  soloPlayers.forEach((player) => {
    batch.set(doc(db, 'games', gameId, 'players', player.id), {
      name: player.name,
      color: player.color,
      supplies: STARTING_SUPPLIES,
      xp: 0,
      level: 1,
      talentPoints: 0,
      talents: {},
      isEliminated: false,
      stats: makeEmptyPlayerStats(),
      joinedAt: serverTimestamp(),
    });
    const start = DEFAULT_MAP_TEMPLATE.startingPositions[player.startIndex];
    const tileId = tileIdFromCoords(start.x, start.y);
    const armyId = `army_${player.id}_start`;
    batch.update(doc(db, 'games', gameId, 'tiles', tileId), {
      ownerId: player.id,
      armyId,
      base: makeOwnedBase(player.id),
    });
    const startTile = devTiles.find((tile) => tile.id === tileId);
    if (startTile) {
      startTile.ownerId = player.id;
      startTile.armyId = armyId;
      startTile.base = makeOwnedBase(player.id);
    }
    const startArmy: ArmyDoc = {
      id: armyId,
      ownerId: player.id,
      tileId,
      units: [makeUnit('gunman'), makeUnit('gunman')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: player.startIndex === 0 ? 'east' : 'west',
      queuedMoveTileId: null,
      queuedMoveMode: null,
    };
    batch.set(doc(db, 'games', gameId, 'armies', armyId), {
      ownerId: startArmy.ownerId,
      tileId: startArmy.tileId,
      units: startArmy.units,
      hasMovedThisTurn: startArmy.hasMovedThisTurn,
      hasActedThisTurn: startArmy.hasActedThisTurn,
      movementUsedThisTurn: startArmy.movementUsedThisTurn,
      lastMoveDirection: startArmy.lastMoveDirection,
      queuedMoveTileId: startArmy.queuedMoveTileId,
      queuedMoveMode: startArmy.queuedMoveMode,
    });
    devArmies.push(startArmy);
    const builderTileId = builderTileIdForStart(start, DEFAULT_MAP_TEMPLATE);
    const builderArmyId = `army_${player.id}_builder`;
    batch.update(doc(db, 'games', gameId, 'tiles', builderTileId), { armyId: builderArmyId });
    const builderTile = devTiles.find((tile) => tile.id === builderTileId);
    if (builderTile) builderTile.armyId = builderArmyId;
    const builderArmy: ArmyDoc = {
      id: builderArmyId,
      ownerId: player.id,
      tileId: builderTileId,
      units: [makeUnit('builder')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: player.startIndex === 0 ? 'east' : 'west',
      queuedMoveTileId: null,
      queuedMoveMode: null,
    };
    batch.set(doc(db, 'games', gameId, 'armies', builderArmyId), {
      ownerId: builderArmy.ownerId,
      tileId: builderArmy.tileId,
      units: builderArmy.units,
      hasMovedThisTurn: builderArmy.hasMovedThisTurn,
      hasActedThisTurn: builderArmy.hasActedThisTurn,
      movementUsedThisTurn: builderArmy.movementUsedThisTurn,
      lastMoveDirection: builderArmy.lastMoveDirection,
      queuedMoveTileId: builderArmy.queuedMoveTileId,
      queuedMoveMode: builderArmy.queuedMoveMode,
    });
    devArmies.push(builderArmy);
  });

  soloPlayers.forEach((player) => {
    batch.update(doc(db, 'games', gameId, 'players', player.id), {
      exploredTileIds: Array.from(visibleTileIdsForPlayer(player.id, devTiles, devArmies)),
    });
  });

  await batch.commit();
  return gameId;
}

export async function devAddSupplies(gameId: string, playerId: string, amount: number) {
  if (!import.meta.env.DEV) throw new Error('Dev tools are only available in local development.');
  return runTransaction(db, async (transaction) => {
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const playerSnap = await transaction.get(playerRef);
    if (!playerSnap.exists()) throw new Error('Player not found.');
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    transaction.update(playerRef, { supplies: player.supplies + amount });
    return `Added ${amount} supplies to ${player.name}.`;
  });
}

export async function devSpawnUnitAtTile(gameId: string, playerId: string, unitTypeId: UnitTypeId, tileId: string) {
  if (!import.meta.env.DEV) throw new Error('Dev tools are only available in local development.');
  return runTransaction(db, async (transaction) => {
    const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [tileSnap, playerSnap] = await Promise.all([transaction.get(tileRef), transaction.get(playerRef)]);
    if (!tileSnap.exists() || !playerSnap.exists()) throw new Error('Game state changed. Try again.');

    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    if (isImpassableTerrain(tile)) throw new Error('Pick a passable tile.');
    if (tile.armyId) throw new Error('That tile already has a unit.');

    const armyRef = doc(collection(db, 'games', gameId, 'armies'));
    transaction.set(armyRef, {
      ownerId: playerId,
      tileId,
      units: [makeUnit(unitTypeId)],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      lastMoveDirection: 'south',
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });
    transaction.update(tileRef, { armyId: armyRef.id });
    transaction.update(playerRef, { stats: mergedPlayerStats(player, { unitsCreated: 1 }) });

    return `Spawned ${UNIT_TYPES[unitTypeId].name} for ${player.name} at ${tile.x}, ${tile.y}.`;
  });
}

export async function joinGameByCode(code: string, playerName: string) {
  const user = await ensureAnonymousUser();
  const gamesQuery = query(collection(db, 'games'), where('code', '==', code.trim().toUpperCase()), limit(1));
  const gameSnapshot = await getDocs(gamesQuery);
  if (gameSnapshot.empty) throw new Error('No game found with that code.');

  const gameDoc = gameSnapshot.docs[0];
  const playersSnapshot = await getDocs(collection(db, 'games', gameDoc.id, 'players'));
  if (playersSnapshot.docs.some((player) => player.id === user.uid)) return gameDoc.id;
  if (playersSnapshot.size >= MAX_PLAYERS) throw new Error(`This game already has ${MAX_PLAYERS} players.`);

  await createPlayer(gameDoc.id, user, playerName, playersSnapshot.size);
  return gameDoc.id;
}

export async function setLobbyPlayerReady(gameId: string, playerId: string, isReady: boolean) {
  await runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [gameSnap, playerSnap] = await Promise.all([transaction.get(gameRef), transaction.get(playerRef)]);
    if (!gameSnap.exists()) throw new Error('Game not found.');
    if (!playerSnap.exists()) throw new Error('You are not in this lobby.');
    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    if (game.status !== 'lobby') throw new Error('Readiness can only change before the game starts.');
    transaction.update(playerRef, { isReady });
  });
}

export async function setLobbyPlayerColor(gameId: string, playerId: string, color: string) {
  const selectedColor = PLAYER_COLORS.find((playerColor) => playerColor.toLowerCase() === color.toLowerCase());
  if (!selectedColor) throw new Error('Pick one of the available team colors.');

  const gameRef = doc(db, 'games', gameId);
  const playerRef = doc(db, 'games', gameId, 'players', playerId);
  const [gameSnap, playerSnap, playersSnapshot] = await Promise.all([
    getDoc(gameRef),
    getDoc(playerRef),
    getDocs(collection(db, 'games', gameId, 'players')),
  ]);
  if (!gameSnap.exists()) throw new Error('Game not found.');
  if (!playerSnap.exists()) throw new Error('You are not in this lobby.');
  const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
  if (game.status !== 'lobby') throw new Error('Team colors can only change before the game starts.');
  const colorTaken = playersSnapshot.docs.some((playerDoc) => {
    const player = { id: playerDoc.id, ...playerDoc.data() } as PlayerDoc;
    return player.id !== playerId && player.color.toLowerCase() === selectedColor.toLowerCase();
  });
  if (colorTaken) throw new Error('That team color is already taken.');

  await setDoc(playerRef, { color: selectedColor, isReady: false }, { merge: true });
}

export async function kickLobbyPlayer(gameId: string, hostPlayerId: string, targetPlayerId: string) {
  await runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const targetRef = doc(db, 'games', gameId, 'players', targetPlayerId);
    const [gameSnap, targetSnap] = await Promise.all([transaction.get(gameRef), transaction.get(targetRef)]);
    if (!gameSnap.exists()) throw new Error('Game not found.');
    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    if (game.status !== 'lobby') throw new Error('Players can only be kicked before the game starts.');
    if (game.hostPlayerId !== hostPlayerId) throw new Error('Only the host can kick players.');
    if (targetPlayerId === game.hostPlayerId) throw new Error('The host cannot be kicked.');
    if (!targetSnap.exists()) throw new Error('That player already left.');
    transaction.delete(targetRef);
  });
}

export function subscribeToGame(gameId: string, onChange: (state: GameState) => void, onError: (error: Error) => void) {
  const gameRef = doc(db, 'games', gameId);
  let latestGame: GameDoc | null = null;
  let latestPlayers: PlayerDoc[] = [];
  let latestTiles: TileDoc[] = [];
  let latestArmies: ArmyDoc[] = [];

  const emit = () => {
    if (latestGame) {
      onChange({ game: latestGame, players: latestPlayers, tiles: latestTiles, armies: latestArmies });
    }
  };

  const unsubscribers = [
    onSnapshot(
      gameRef,
      (snapshot) => {
        if (!snapshot.exists()) return;
        latestGame = { id: snapshot.id, ...snapshot.data() } as GameDoc;
        emit();
      },
      onError,
    ),
    onSnapshot(
      query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')),
      (snapshot) => {
        latestPlayers = snapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'games', gameId, 'tiles'),
      (snapshot) => {
        latestTiles = snapshot.docs.map((tile) => ({ id: tile.id, ...tile.data() }) as TileDoc);
        emit();
      },
      onError,
    ),
    onSnapshot(
      collection(db, 'games', gameId, 'armies'),
      (snapshot) => {
        latestArmies = snapshot.docs.map((army) => ({ id: army.id, ...army.data() }) as ArmyDoc);
        emit();
      },
      onError,
    ),
  ];

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function startGame(gameId: string, starterPlayerId?: string) {
  const gameRef = doc(db, 'games', gameId);
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) throw new Error('Game not found.');
  const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
  if (starterPlayerId && game.hostPlayerId !== starterPlayerId) throw new Error('Only the host can start the game.');
  const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
  const players = playersSnapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
  if (players.length < 2) throw new Error('Start needs at least 2 players.');
  if (players.length > MAX_PLAYERS) throw new Error(`This map supports up to ${MAX_PLAYERS} players.`);
  if (game.status === 'lobby' && players.some((player) => !player.isReady)) {
    throw new Error('Everyone must be ready before starting.');
  }
  const mapTemplate = chooseMapTemplateForPlayerCount(players.length);

  const batch = writeBatch(db);
  const terrain = makeTerrain(mapTemplate);
  const startTiles = terrain.map((tile) => ({ ...tile }));
  const startArmies: ArmyDoc[] = [];

  terrain.forEach((tile) => {
    batch.set(doc(db, 'games', gameId, 'tiles', tile.id), tile);
  });

  players.forEach((player, index) => {
    const start = mapTemplate.startingPositions[index];
    const tileId = tileIdFromCoords(start.x, start.y);
    const armyId = `army_${player.id}_start`;
    const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
    batch.update(tileRef, {
      ownerId: player.id,
      armyId,
      base: makeOwnedBase(player.id),
    });
    const startTile = startTiles.find((tile) => tile.id === tileId);
    if (startTile) {
      startTile.ownerId = player.id;
      startTile.armyId = armyId;
      startTile.base = makeOwnedBase(player.id);
    }
    const startArmy: ArmyDoc = {
      id: armyId,
      ownerId: player.id,
      tileId,
      units: [makeUnit('gunman'), makeUnit('gunman')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    };
    batch.set(doc(db, 'games', gameId, 'armies', armyId), {
      ownerId: startArmy.ownerId,
      tileId: startArmy.tileId,
      units: startArmy.units,
      hasMovedThisTurn: startArmy.hasMovedThisTurn,
      hasActedThisTurn: startArmy.hasActedThisTurn,
      movementUsedThisTurn: startArmy.movementUsedThisTurn,
      queuedMoveTileId: startArmy.queuedMoveTileId,
      queuedMoveMode: startArmy.queuedMoveMode,
    });
    startArmies.push(startArmy);
    const builderTileId = builderTileIdForStart(start, mapTemplate);
    const builderArmyId = `army_${player.id}_builder`;
    batch.update(doc(db, 'games', gameId, 'tiles', builderTileId), { armyId: builderArmyId });
    const builderTile = startTiles.find((tile) => tile.id === builderTileId);
    if (builderTile) builderTile.armyId = builderArmyId;
    const builderArmy: ArmyDoc = {
      id: builderArmyId,
      ownerId: player.id,
      tileId: builderTileId,
      units: [makeUnit('builder')],
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    };
    batch.set(doc(db, 'games', gameId, 'armies', builderArmyId), {
      ownerId: builderArmy.ownerId,
      tileId: builderArmy.tileId,
      units: builderArmy.units,
      hasMovedThisTurn: builderArmy.hasMovedThisTurn,
      hasActedThisTurn: builderArmy.hasActedThisTurn,
      movementUsedThisTurn: builderArmy.movementUsedThisTurn,
      queuedMoveTileId: builderArmy.queuedMoveTileId,
      queuedMoveMode: builderArmy.queuedMoveMode,
    });
    startArmies.push(builderArmy);
  });

  players.forEach((player) => {
    batch.update(doc(db, 'games', gameId, 'players', player.id), {
      exploredTileIds: Array.from(visibleTileIdsForPlayer(player.id, startTiles, startArmies)),
    });
  });

  batch.update(gameRef, {
    status: 'active',
    mapId: mapTemplate.id,
    mapName: mapTemplate.name,
    winnerPlayerId: null,
    victoryReason: null,
    currentTurnPlayerId: isSimultaneousGame(game) ? null : players[0].id,
    turnNumber: 1,
    roundNumber: 1,
    mapWidth: mapTemplate.width,
    mapHeight: mapTemplate.height,
    maxPlayers: MAX_PLAYERS,
    roundEndsAtMs: isSimultaneousGame(game) ? nextRoundEndsAtMs(game.roundDurationSeconds) : null,
  });

  await batch.commit();
}

export async function resetGameToLobby(gameId: string, playerId: string) {
  const gameRef = doc(db, 'games', gameId);
  const gameSnapshot = await getDoc(gameRef);
  const game = gameSnapshot.exists() ? ({ id: gameSnapshot.id, ...gameSnapshot.data() } as GameDoc) : null;
  if (!game || game.hostPlayerId !== playerId) throw new Error('Only the host can end the game.');

  const [tilesSnapshot, armiesSnapshot, playersSnapshot] = await Promise.all([
    getDocs(collection(db, 'games', gameId, 'tiles')),
    getDocs(collection(db, 'games', gameId, 'armies')),
    getDocs(collection(db, 'games', gameId, 'players')),
  ]);
  const batch = writeBatch(db);

  tilesSnapshot.docs.forEach((tileDoc) => batch.delete(tileDoc.ref));
  armiesSnapshot.docs.forEach((armyDoc) => batch.delete(armyDoc.ref));
  playersSnapshot.docs.forEach((playerDoc) => {
    batch.update(playerDoc.ref, {
      supplies: STARTING_SUPPLIES,
      xp: 0,
      level: 1,
      talentPoints: 0,
      talents: {},
      isEliminated: false,
      isReady: false,
      stats: makeEmptyPlayerStats(),
      exploredTileIds: [],
    });
  });
  batch.update(gameRef, {
    status: 'lobby',
    isPaused: false,
    pausedAtMs: null,
    winnerPlayerId: null,
    victoryReason: null,
    currentTurnPlayerId: null,
    turnNumber: 0,
    roundNumber: 1,
    roundEndsAtMs: null,
  });

  await batch.commit();
}

export async function setGamePaused(gameId: string, playerId: string, isPaused: boolean) {
  const gameRef = doc(db, 'games', gameId);
  const gameSnapshot = await getDoc(gameRef);
  const game = gameSnapshot.exists() ? ({ id: gameSnapshot.id, ...gameSnapshot.data() } as GameDoc) : null;
  if (!game || game.hostPlayerId !== playerId) throw new Error('Only the host can pause gameplay.');
  if (game.status !== 'active') throw new Error('Only active games can be paused.');

  const now = Date.now();
  const pausedAtMs = game.pausedAtMs ?? now;
  const pauseDurationMs = game.isPaused && !isPaused ? now - pausedAtMs : 0;
  await setDoc(
    gameRef,
    {
      isPaused,
      pausedAtMs: isPaused ? now : null,
      roundEndsAtMs:
        !isPaused && game.roundEndsAtMs && pauseDurationMs > 0 ? game.roundEndsAtMs + pauseDurationMs : game.roundEndsAtMs ?? null,
    },
    { merge: true },
  );

  return isPaused ? 'Gameplay paused. Players can inspect the map, but actions are locked.' : 'Gameplay resumed.';
}

export async function backOutOfGame(gameId: string, playerId: string) {
  const gameRef = doc(db, 'games', gameId);
  const [gameSnapshot, playersSnapshot, tilesSnapshot, armiesSnapshot] = await Promise.all([
    getDoc(gameRef),
    getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt'))),
    getDocs(collection(db, 'games', gameId, 'tiles')),
    getDocs(collection(db, 'games', gameId, 'armies')),
  ]);
  if (!gameSnapshot.exists()) throw new Error('Game not found.');

  const game = { id: gameSnapshot.id, ...gameSnapshot.data() } as GameDoc;
  const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
  const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
  const armiesById = new Map(armies.map((army) => [army.id, army]));
  const leavingPlayer = players.find((player) => player.id === playerId);
  if (!leavingPlayer) throw new Error('You are not in this game.');

  const batch = writeBatch(db);
  armiesSnapshot.docs.forEach((armyDoc) => {
    const army = { id: armyDoc.id, ...armyDoc.data() } as ArmyDoc;
    if (army.ownerId === playerId) batch.delete(armyDoc.ref);
  });

  tilesSnapshot.docs.forEach((tileDoc) => {
    const tile = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
    const updates: Partial<TileDoc> = {};
    if (tile.base?.ownerId === playerId) {
      updates.base = null;
      updates.ownerId = null;
    }
    if (tile.armyId) {
      const occupyingArmy = armiesById.get(tile.armyId);
      if (occupyingArmy?.ownerId === playerId) updates.armyId = null;
    }
    if (tile.mine?.ownerId === playerId) updates.mine = null;
    if (tile.trench?.ownerId === playerId) updates.trench = null;
    if (tile.smoke?.ownerId === playerId) updates.smoke = null;
    if (Object.keys(updates).length > 0) batch.update(tileDoc.ref, updates);
  });

  batch.update(doc(db, 'games', gameId, 'players', playerId), { isEliminated: true });

  const activePlayers = players.filter((player) => !player.isEliminated);
  const remainingActivePlayers = activePlayers.filter((player) => player.id !== playerId);
  const eliminationWinner = remainingActivePlayers[0] ?? null;
  if (isSimultaneousGame(game)) {
      batch.update(gameRef, {
        ...(remainingActivePlayers.length <= 1 && game.status === 'active'
          ? finishGameUpdates(game, eliminationWinner?.id ?? null, 'elimination')
          : { status: game.status, roundEndsAtMs: game.roundEndsAtMs ?? null }),
        currentTurnPlayerId: null,
      });
    } else if (game.currentTurnPlayerId === playerId || remainingActivePlayers.length <= 1) {
      const currentIndex = activePlayers.findIndex((player) => player.id === playerId);
      const nextPlayer =
        remainingActivePlayers.find((_, index) => index >= currentIndex) ?? remainingActivePlayers[0] ?? null;
    batch.update(gameRef, {
      ...(remainingActivePlayers.length <= 1 && game.status === 'active'
        ? finishGameUpdates(game, eliminationWinner?.id ?? null, 'elimination')
        : { status: game.status }),
      currentTurnPlayerId: remainingActivePlayers.length <= 1 ? null : nextPlayer?.id ?? null,
      turnNumber: game.currentTurnPlayerId === playerId ? game.turnNumber + 1 : game.turnNumber,
      roundNumber:
        game.currentTurnPlayerId === playerId && currentIndex === activePlayers.length - 1
          ? game.roundNumber + 1
          : game.roundNumber,
    });
  }

  await batch.commit();
  return 'You backed out of the game. Your armies, bases, and mines were removed.';
}

export async function moveArmy(gameId: string, armyId: string, targetTileId: string, playerId: string): Promise<MoveOutcome> {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, targetTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(targetTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !targetTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tiles = tilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if ((army.fortifyTurnsRemaining ?? 0) > 0) throw new Error('This unit is fortified and cannot move.');
    if (!canMoveArmy(army, fromTile, targetTile, player, tiles, armies)) throw new Error('That move is not allowed.');
    const moveCost = movementCost(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId }) ?? 0;
    const path = movementPath(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId }) ?? [];
    const triggeredMineTile = triggeredMineTileForPath(path, playerId, army);
    const mineDamage = triggeredMineTile?.mine?.damage ?? ANTI_VEHICLE_MINE_DAMAGE;
    const mineTriggers = Boolean(triggeredMineTile);
    const movedUnits = mineTriggers ? damageTankUnits(army.units, mineDamage) : army.units;
    const sentryExchange = resolveSentryMoveExchange(game, player, army, path, movedUnits, tiles);
    const sentryAttack = sentryExchange.sentryAttack;
    const sentryDamage = sentryExchange.sentryDamage;
    const finalUnits = sentryExchange.finalUnits;
    const unitsLost = Math.max(0, army.units.length - finalUnits.length);
    const lastMoveDirection = directionFromTiles(fromTile, targetTile);
    const debugLines = movementDebugLines({
      fromTile,
      targetTile,
      path,
      army,
      triggeredMineTile,
      mineTriggers,
      mineDamage,
      sentryAttack,
      sentryDamage,
      sentryTriggerTile: sentryExchange.triggerTile,
      sentryReturnFirePower: sentryExchange.returnFirePower,
      sentryBaseDestroyed: sentryExchange.baseDestroyed,
      unitsLost,
    });
    const nextTiles = tiles.map((tile) => {
      if (tile.id === fromTile.id) return { ...tile, armyId: null };
      if (tile.id === targetTile.id) {
        return {
          ...tile,
          armyId: finalUnits.length > 0 ? armyId : null,
          mine: triggeredMineTile?.id === tile.id ? null : tile.mine,
        };
      }
      if (triggeredMineTile?.id === tile.id) return { ...tile, mine: null };
      if (sentryExchange.baseDestroyed && sentryAttack?.tile.id === tile.id) {
        return { ...tile, base: ruinBase(tile.base), ownerId: null };
      }
      if (sentryAttack?.tile.id === tile.id && tile.base) {
        return { ...tile, base: { ...tile.base, lastSentryTurnNumber: game.turnNumber } };
      }
      return tile;
    });
    const nextArmies =
      finalUnits.length > 0
        ? armies.map((candidate) =>
            candidate.id === armyId
              ? { ...candidate, tileId: targetTileId, units: finalUnits, lastMoveDirection }
              : candidate,
          )
        : armies.filter((candidate) => candidate.id !== armyId);
    const nextExploredTileIds = exploredTileIdsFor(player, nextTiles, nextArmies);

    transaction.update(fromTileRef, { armyId: null });
    const triggeredMineRef =
      triggeredMineTile && triggeredMineTile.id !== targetTile.id
        ? doc(db, 'games', gameId, 'tiles', triggeredMineTile.id)
        : null;
    if (triggeredMineRef) transaction.update(triggeredMineRef, { mine: null });
    if (sentryExchange.baseDestroyed && sentryAttack) {
      transaction.update(doc(db, 'games', gameId, 'tiles', sentryAttack.tile.id), {
        base: ruinBase(sentryAttack.tile.base),
        ownerId: null,
      });
    } else if (sentryAttack?.tile.base) {
      transaction.update(doc(db, 'games', gameId, 'tiles', sentryAttack.tile.id), {
        base: { ...sentryAttack.tile.base, lastSentryTurnNumber: game.turnNumber },
      });
    }
    if (movedUnits.length === 0 || finalUnits.length === 0) {
      transaction.update(targetTileRef, { armyId: null, mine: triggeredMineTile?.id === targetTile.id ? null : targetTile.mine });
      transaction.delete(armyRef);
      transaction.update(playerRef, { exploredTileIds: nextExploredTileIds, stats: mergedPlayerStats(player, { unitsLost }) });
      if (movedUnits.length > 0 && sentryDamage > 0) {
        return {
          message: `Unit moved to ${targetTile.x}, ${targetTile.y} and was destroyed by base sentry fire for ${sentryDamage} damage.`,
          armyDestroyed: true,
          triggeredMineTileId: triggeredMineTile?.id,
          mineDamage: mineTriggers ? mineDamage : undefined,
          sentryBaseTileId: sentryAttack?.tile.id,
          sentryTriggerTileId: sentryExchange.triggerTile?.id,
          sentryDamage,
          sentryReturnFirePower: sentryExchange.returnFirePower,
          sentryBaseDestroyed: sentryExchange.baseDestroyed,
          debugLines,
        };
      }
      return {
        message: `Unit hit an anti-vehicle mine at ${triggeredMineTile?.x ?? targetTile.x}, ${triggeredMineTile?.y ?? targetTile.y} and was destroyed.`,
        armyDestroyed: true,
        triggeredMineTileId: triggeredMineTile?.id,
        mineDamage: mineTriggers ? mineDamage : undefined,
        debugLines,
      };
    }

    transaction.update(targetTileRef, { armyId, mine: triggeredMineTile?.id === targetTile.id ? null : targetTile.mine });
    transaction.update(armyRef, {
      tileId: targetTileId,
      units: finalUnits,
      hasMovedThisTurn: true,
      movementUsedThisTurn: (army.movementUsedThisTurn ?? 0) + moveCost,
      lastMoveDirection,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });
    transaction.update(playerRef, { exploredTileIds: nextExploredTileIds, stats: mergedPlayerStats(player, { unitsLost }) });

    return {
      message:
        `Unit moved to ${targetTile.x}, ${targetTile.y}.` +
        (mineTriggers ? ` Tank crossed a mine at ${triggeredMineTile?.x}, ${triggeredMineTile?.y} for ${mineDamage} damage.` : '') +
        (sentryDamage > 0
          ? ` Base sentry at ${sentryAttack?.tile.x}, ${sentryAttack?.tile.y} dealt ${sentryDamage} damage.`
          : '') +
        (sentryExchange.returnFirePower > 0
          ? ` Unit returned fire with ${sentryExchange.returnFirePower} attack power${sentryExchange.baseDestroyed ? ' and destroyed the base' : ''}.`
          : ''),
      armyDestroyed: false,
      triggeredMineTileId: triggeredMineTile?.id,
      mineDamage: mineTriggers ? mineDamage : undefined,
      sentryBaseTileId: sentryAttack?.tile.id,
      sentryTriggerTileId: sentryExchange.triggerTile?.id,
      sentryDamage: sentryDamage > 0 ? sentryDamage : undefined,
      sentryReturnFirePower: sentryExchange.returnFirePower > 0 ? sentryExchange.returnFirePower : undefined,
      sentryBaseDestroyed: sentryExchange.baseDestroyed || undefined,
      debugLines,
    };
  });
}

export async function combineArmies(gameId: string, sourceArmyId: string, targetArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const sourceArmyRef = doc(db, 'games', gameId, 'armies', sourceArmyId);
    const targetArmyRef = doc(db, 'games', gameId, 'armies', targetArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, sourceArmySnap, targetArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(sourceArmyRef),
      transaction.get(targetArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !sourceArmySnap.exists() || !targetArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const sourceArmy = { id: sourceArmySnap.id, ...sourceArmySnap.data() } as ArmyDoc;
    const targetArmy = { id: targetArmySnap.id, ...targetArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const sourceTileRef = doc(db, 'games', gameId, 'tiles', sourceArmy.tileId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetArmy.tileId);
    const [sourceTileSnap, targetTileSnap] = await Promise.all([
      transaction.get(sourceTileRef),
      transaction.get(targetTileRef),
    ]);
    if (!sourceTileSnap.exists() || !targetTileSnap.exists()) throw new Error('Unit tile is missing.');

    const sourceTile = { id: sourceTileSnap.id, ...sourceTileSnap.data() } as TileDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tiles = tilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));
    if (!canCombineArmies(sourceArmy, targetArmy, sourceTile, targetTile, player, tiles, armies)) {
      throw new Error('Those units cannot combine.');
    }

    const combinedUnits = [...targetArmy.units, ...sourceArmy.units];
    transaction.delete(sourceArmyRef);
    transaction.update(sourceTileRef, { armyId: null });
    transaction.update(targetArmyRef, {
      units: combinedUnits,
      hasMovedThisTurn: true,
      hasActedThisTurn: targetArmy.hasActedThisTurn,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });

    return {
      targetArmyId,
      message: `Combined units into one unit using ${armySpaceUsed(combinedUnits)}/${ARMY_SPACE_CAPACITY} space.`,
    };
  });
}

export async function dismissUnitFromArmy(gameId: string, armyId: string, unitId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unit = army.units.find((candidate) => candidate.id === unitId);
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only dismiss squads during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!unit) throw new Error('That squad is no longer in this unit.');

    const cost = dismissUnitCost(unit.typeId);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to dismiss ${UNIT_TYPES[unit.typeId].name}.`);

    const remainingUnits = army.units.filter((candidate) => candidate.id !== unitId);
    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
    const tiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
    const updatedArmies =
      remainingUnits.length === 0
        ? armies.filter((candidate) => candidate.id !== armyId)
        : armies.map((candidate) => (candidate.id === armyId ? { ...candidate, units: remainingUnits } : candidate));

    if (remainingUnits.length === 0) {
      transaction.delete(armyRef);
      transaction.update(tileRef, { armyId: null });
    } else {
      transaction.update(armyRef, { units: remainingUnits });
    }

    const isNowEliminated = shouldEliminatePlayer(playerId, tiles, updatedArmies);
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      isEliminated: isNowEliminated ? true : player.isEliminated,
    });

    if (isNowEliminated && isSimultaneousGame(game)) {
      const remainingPlayers = players.filter((candidate) => !candidate.isEliminated && candidate.id !== playerId);
      transaction.update(gameRef, {
        ...(remainingUnits.length === 0 && remainingPlayers.length <= 1
          ? finishGameUpdates(game, remainingPlayers[0]?.id ?? null, 'elimination')
          : { status: game.status, roundEndsAtMs: game.roundEndsAtMs ?? null }),
        currentTurnPlayerId: null,
      });
    } else if (isNowEliminated) {
      const activePlayers = players.filter((candidate) => !candidate.isEliminated);
      const remainingActivePlayers = activePlayers.filter((candidate) => candidate.id !== playerId);
      const currentIndex = activePlayers.findIndex((candidate) => candidate.id === playerId);
      const nextPlayer =
        remainingActivePlayers.find((_, index) => index >= currentIndex) ?? remainingActivePlayers[0] ?? null;
      transaction.update(gameRef, {
        ...(remainingActivePlayers.length <= 1 && game.status === 'active'
          ? finishGameUpdates(game, remainingActivePlayers[0]?.id ?? null, 'elimination')
          : { status: game.status }),
        currentTurnPlayerId:
          remainingActivePlayers.length <= 1
            ? null
            : game.currentTurnPlayerId === playerId
              ? nextPlayer?.id ?? null
              : game.currentTurnPlayerId,
        turnNumber: game.currentTurnPlayerId === playerId ? game.turnNumber + 1 : game.turnNumber,
        roundNumber:
          game.currentTurnPlayerId === playerId && currentIndex === activePlayers.length - 1
            ? game.roundNumber + 1
            : game.roundNumber,
      });
    }

    return {
      armyRemoved: remainingUnits.length === 0,
      message: `Dismissed ${UNIT_TYPES[unit.typeId].name} for ${cost} supplies.`,
    };
  });
}

export async function separateUnitFromArmy(gameId: string, armyId: string, unitId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unit = army.units.find((candidate) => candidate.id === unitId);
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only separate squads during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!unit) throw new Error('That squad is no longer in this unit.');
    if (army.units.length <= 1) throw new Error('That squad is already operating alone.');

    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Unit tile is missing.');
    const sourceTile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;
    const neighborTiles = await Promise.all(
      getNeighborTileIds(sourceTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const neighborRef = doc(db, 'games', gameId, 'tiles', tileId);
        const neighborSnap = await transaction.get(neighborRef);
        return neighborSnap.exists() ? { ref: neighborRef, tile: { id: neighborSnap.id, ...neighborSnap.data() } as TileDoc } : null;
      }),
    );
    const spawnTarget = neighborTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId && !isImpassableTerrain(tile));
    if (!spawnTarget) throw new Error('No adjacent open tile to separate into.');

    const remainingUnits = army.units.filter((candidate) => candidate.id !== unitId);
    const newArmyRef = doc(collection(db, 'games', gameId, 'armies'));
    const newArmy: ArmyDoc = {
      id: newArmyRef.id,
      ownerId: playerId,
      tileId: spawnTarget.tile.id,
      units: [unit],
      hasMovedThisTurn: army.hasMovedThisTurn,
      hasActedThisTurn: army.hasActedThisTurn,
      movementUsedThisTurn: army.movementUsedThisTurn ?? 0,
      lastMoveDirection: army.lastMoveDirection ?? 'south',
      queuedMoveTileId: null,
      queuedMoveMode: null,
    };
    transaction.update(armyRef, { units: remainingUnits, queuedMoveTileId: null, queuedMoveMode: null });
    transaction.set(newArmyRef, {
      ownerId: newArmy.ownerId,
      tileId: newArmy.tileId,
      units: newArmy.units,
      hasMovedThisTurn: newArmy.hasMovedThisTurn,
      hasActedThisTurn: newArmy.hasActedThisTurn,
      movementUsedThisTurn: newArmy.movementUsedThisTurn,
      lastMoveDirection: newArmy.lastMoveDirection,
      queuedMoveTileId: newArmy.queuedMoveTileId,
      queuedMoveMode: newArmy.queuedMoveMode,
    });
    transaction.update(spawnTarget.ref, { armyId: newArmyRef.id });

    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const tiles = allTilesSnapshot.docs
      .map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc)
      .map((tile) => (tile.id === spawnTarget.tile.id ? { ...tile, armyId: newArmyRef.id } : tile));
    const armies = [
      ...allArmiesSnapshot.docs
        .map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc)
        .map((candidate) => (candidate.id === armyId ? { ...candidate, units: remainingUnits } : candidate)),
      newArmy,
    ];
    transaction.update(playerRef, { exploredTileIds: exploredTileIdsFor(player, tiles, armies) });

    return {
      newArmyId: newArmyRef.id,
      message: `${UNIT_TYPES[unit.typeId].name} separated into ${spawnTarget.tile.x}, ${spawnTarget.tile.y}.`,
    };
  });
}

export async function attackTile(gameId: string, attackerArmyId: string, targetTileId: string, playerId: string): Promise<AttackOutcome> {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const attackerRef = doc(db, 'games', gameId, 'armies', attackerArmyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, attackerSnap, targetTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(attackerRef),
      transaction.get(targetTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !attackerSnap.exists() || !targetTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const attacker = { id: attackerSnap.id, ...attackerSnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', attacker.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Attacking unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));

    let defender: ArmyDoc | null = null;
    let defenderRef: ReturnType<typeof doc> | null = null;
    if (targetTile.armyId) {
      defenderRef = doc(db, 'games', gameId, 'armies', targetTile.armyId);
      const defenderSnap = await transaction.get(defenderRef);
      if (!defenderSnap.exists()) throw new Error('Defending unit is missing.');
      defender = { id: defenderSnap.id, ...defenderSnap.data() } as ArmyDoc;
      if (defender.ownerId === playerId) throw new Error('You cannot attack your own unit.');
    }

    if (!defender && (!targetTile.base || targetTile.base.ruined || targetTile.base.ownerId === playerId)) {
      throw new Error('There is no enemy target on that tile.');
    }
    const defendingOwnerId =
      defender?.ownerId ??
      (targetTile.base && !targetTile.base.ruined && targetTile.base.ownerId !== playerId ? targetTile.base.ownerId : null);
    let defendingPlayer: PlayerDoc | null = null;
    if (defendingOwnerId) {
      const defendingPlayerSnap = await transaction.get(doc(db, 'games', gameId, 'players', defendingOwnerId));
      defendingPlayer = defendingPlayerSnap.exists()
        ? ({ id: defendingPlayerSnap.id, ...defendingPlayerSnap.data() } as PlayerDoc)
        : null;
    }

    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const supportArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const supportArmies = supportArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const normalArtilleryReloadUntilRound = isNormalArtilleryArmy(attacker) ? attacker.units[0].artilleryReloadUntilRound ?? 0 : 0;
    if (normalArtilleryReloadUntilRound > game.roundNumber) {
      throw new Error(`Artillery is reloading until round ${normalArtilleryReloadUntilRound}.`);
    }
    if (!canAttackTile(attacker, fromTile, targetTile, playerId, allTiles, game.roundNumber)) {
      throw new Error(
        isSoloArtilleryArmy(attacker)
          ? 'Target is out of artillery range or line of sight.'
          : 'Target is out of attack range or line of sight.',
      );
    }

    const defenderCanReturnFire = Boolean(defender && isTileInAttackRange(defender, targetTile, fromTile, allTiles));
    const isRangedAttackWithoutReturnFire = chebyshevDistance(fromTile, targetTile) > 1 && !defenderCanReturnFire;
    const supportedByAdjacentArmy = supportArmies.some((supportArmy) => {
      if (supportArmy.id === attacker.id || supportArmy.ownerId !== playerId) return false;
      const supportTile = allTiles.find((tile) => tile.id === supportArmy.tileId);
      return Boolean(supportTile && manhattanDistance(fromTile, supportTile) === 1);
    });
    const defendingBase = targetTile.base && !targetTile.base.ruined && targetTile.base.ownerId !== playerId ? targetTile.base : null;
    const attackTalentBonus = (player.talents.attackTraining ?? 0) * 0.05;
    const supportTalentBonus = supportedByAdjacentArmy ? 0.1 + (player.talents.coordinatedAssault ?? 0) * 0.02 : 0;
    const defenseTalentBonus = (defendingPlayer?.talents.defensiveDrills ?? 0) * 0.05;
    const baseTalentDefenseBonus = defendingBase ? defendingPlayer?.talents.baseFortification ?? 0 : 0;
    const baseAuraDefenseBonus =
      defendingOwnerId && isInFriendlyBaseAura(targetTile, defendingOwnerId, allTiles) ? BASE_AURA_DEFENSE_BONUS : 0;
    const trenchAttackBonus = fromTile.trench ? TRENCH_ATTACK_BONUS : 0;
    const trenchDefenseBonus = targetTile.trench ? TRENCH_DEFENSE_BONUS : 0;
    const attackerCombinedArmsBonus = hasCombinedArms(attacker.units) ? 0.1 : 0;
    const defenderCombinedArmsBonus = defender && hasCombinedArms(defender.units) ? 0.1 : 0;
    const tankHunterBonus = defender?.units.some((unit) => unit.typeId === 'tank') && hasTankHunters(attacker.units) ? 0.25 : 0;
    const entrenchedInfantryBonus =
      defender &&
      hasEntrenchedInfantry(defender.units) &&
      (Boolean(targetTile.trench) || baseAuraDefenseBonus > 0)
        ? 0.15
        : 0;
    const siegeColumnBonus = defendingBase && hasSiegeColumn(attacker.units) ? 0.2 : 0;
    const fortifyAttackPenalty = (attacker.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_ATTACK_MULTIPLIER : 1;
    const fortifyDefenseBonus = defender && (defender.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_DEFENSE_MULTIPLIER : 1;
    const artilleryFlatBonus = artilleryAttackFlatBonus(attacker, defender, defendingBase, targetTile);
    const smokeAttackMultiplier = activeSmokeOnTile(fromTile, game.roundNumber) ? SMOKE_SCREEN_ATTACK_MULTIPLIER : 1;
    const resolvedCombat = resolveCombat(
      attacker.units,
      defender?.units ?? [],
      targetTile.terrainType,
      defendingBase,
      (1 + attackTalentBonus + supportTalentBonus + attackerCombinedArmsBonus + tankHunterBonus + siegeColumnBonus) *
        fortifyAttackPenalty *
        smokeAttackMultiplier,
      (1 + defenseTalentBonus + defenderCombinedArmsBonus + entrenchedInfantryBonus) * fortifyDefenseBonus,
      baseTalentDefenseBonus + baseAuraDefenseBonus + trenchDefenseBonus,
      trenchAttackBonus + artilleryFlatBonus,
    );
    const combat = isRangedAttackWithoutReturnFire ? { ...resolvedCombat, attackerLosses: 0 } : resolvedCombat;
    const remainingAttackers = removeUnitLosses(attacker.units, combat.attackerLosses, 'attacker');
    const remainingDefenders = defender ? removeUnitLosses(defender.units, combat.defenderLosses, 'defender') : [];
    const attackerUnitsDestroyed = attacker.units.length - remainingAttackers.length;
    const defenderUnitsDestroyed = defender ? defender.units.length - remainingDefenders.length : 0;
    const xpGained =
      XP_ATTACK +
      defenderUnitsDestroyed * XP_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? XP_DESTROY_ARMY : 0) +
      (combat.baseDestroyed ? XP_DESTROY_BASE : 0);
    const suppliesGained =
      defenderUnitsDestroyed * SUPPLIES_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? SUPPLIES_DESTROY_ARMY : 0) +
      (combat.baseDestroyed ? SUPPLIES_DESTROY_BASE : 0);
    const defenderSuppliesGained =
      defender && remainingAttackers.length === 0
        ? attackerUnitsDestroyed * SUPPLIES_DESTROY_UNIT + SUPPLIES_DESTROY_ARMY
        : 0;
    const unitXpGained =
      defenderUnitsDestroyed * UNIT_XP_DESTROY_UNIT +
      (defender && remainingDefenders.length === 0 ? UNIT_XP_DESTROY_ARMY : 0);
    const leveledAttackers = applyNormalArtilleryReload(applyUnitXp(remainingAttackers, unitXpGained), attacker, game.roundNumber);

    if (remainingAttackers.length === 0) {
      transaction.delete(attackerRef);
      transaction.update(fromTileRef, { armyId: null });
    } else {
      transaction.update(attackerRef, {
        units: leveledAttackers,
        hasActedThisTurn: true,
        queuedMoveTileId: null,
        queuedMoveMode: null,
      });
    }

    if (defender && remainingDefenders.length === 0 && defenderRef) {
      transaction.delete(defenderRef);
      transaction.update(targetTileRef, {
        armyId: null,
        base: combat.baseDestroyed ? ruinBase(targetTile.base) : targetTile.base,
        ownerId: combat.baseDestroyed ? null : targetTile.ownerId,
      });
    } else if (defender && defenderRef) {
      transaction.update(defenderRef, { units: remainingDefenders });
    } else if (combat.baseDestroyed) {
      transaction.update(targetTileRef, { base: ruinBase(targetTile.base), ownerId: null });
    }

    const [playersSnapshot, tilesSnapshot, armiesSnapshot] = await Promise.all([
      getDocs(collection(db, 'games', gameId, 'players')),
      getDocs(collection(db, 'games', gameId, 'tiles')),
      getDocs(collection(db, 'games', gameId, 'armies')),
    ]);
    const players = playersSnapshot.docs.map((playerDoc) => ({ id: playerDoc.id, ...playerDoc.data() }) as PlayerDoc);
    const updatedTiles = tilesSnapshot.docs.map((tileDoc) => {
      const tileData = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
      if (tileData.id === targetTile.id) {
        return {
          ...tileData,
          armyId: defender && remainingDefenders.length === 0 ? null : tileData.armyId,
          base: combat.baseDestroyed ? ruinBase(tileData.base) : tileData.base,
          ownerId: combat.baseDestroyed ? null : tileData.ownerId,
        };
      }
      if (tileData.id === fromTile.id && remainingAttackers.length === 0) return { ...tileData, armyId: null };
      return tileData;
    });
    const updatedArmies = armiesSnapshot.docs
      .map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc)
      .filter((armyDoc) => armyDoc.id !== (remainingAttackers.length === 0 ? attacker.id : ''))
      .filter((armyDoc) => armyDoc.id !== (defender && remainingDefenders.length === 0 ? defender.id : ''));
    const eliminatedPlayerIds = players
      .filter((candidate) => !candidate.isEliminated && candidate.id !== playerId)
      .filter((candidate) => shouldEliminatePlayer(candidate.id, updatedTiles, updatedArmies))
      .map((candidate) => candidate.id);
    eliminatedPlayerIds.forEach((eliminatedPlayerId) => {
      transaction.update(doc(db, 'games', gameId, 'players', eliminatedPlayerId), { isEliminated: true });
    });
    const remainingActivePlayers = players.filter(
      (candidate) => !candidate.isEliminated && !eliminatedPlayerIds.includes(candidate.id),
    );
    if (remainingActivePlayers.length <= 1 && game.status === 'active') {
      transaction.update(gameRef, {
        ...finishGameUpdates(game, remainingActivePlayers[0]?.id ?? null, 'elimination'),
        currentTurnPlayerId: null,
      });
    }

    transaction.update(playerRef, {
      supplies: player.supplies + suppliesGained,
      stats: mergedPlayerStats(player, {
        enemiesKilled: defenderUnitsDestroyed,
        basesDestroyed: combat.baseDestroyed ? 1 : 0,
        unitsLost: attackerUnitsDestroyed,
      }),
      ...applyXp(player, xpGained),
    });
    if (defender && defenderSuppliesGained > 0) {
      const defenderPlayer = players.find((candidate) => candidate.id === defender.ownerId);
      if (defenderPlayer) {
        transaction.update(doc(db, 'games', gameId, 'players', defender.ownerId), {
          supplies: defenderPlayer.supplies + defenderSuppliesGained,
          stats: mergedPlayerStats(defenderPlayer, {
            enemiesKilled: attackerUnitsDestroyed,
            unitsLost: defenderUnitsDestroyed,
          }),
        });
      }
    } else if (defendingPlayer && defenderUnitsDestroyed > 0) {
      transaction.update(doc(db, 'games', gameId, 'players', defendingOwnerId!), {
        stats: mergedPlayerStats(defendingPlayer, {
          unitsLost: defenderUnitsDestroyed,
        }),
      });
    }

    const resultLine =
      `Attack ${combat.attackPower} vs defense ${combat.defensePower} ` +
      `(rolls ${combat.attackRoll}/${combat.defenseRoll}). ` +
      `Damage: you ${combat.attackerLosses * 10}, enemy ${combat.defenderLosses * 10}. ` +
      `+${xpGained} XP, +${suppliesGained} supplies.`;
    const defenderRewardMessage =
      defenderSuppliesGained > 0 ? ` Defender earned +${defenderSuppliesGained} supplies for destroying the attacker.` : '';
    const supportMessage = combat.attackSupportBonus > 0 ? ` Attack bonuses added +${combat.attackSupportBonus} attack.` : '';
    const unitXpMessage = unitXpGained > 0 ? ` Surviving attackers gained ${unitXpGained} squad XP.` : '';
    const message = remainingAttackers.length === 0
      ? `${resultLine}${supportMessage}${defenderRewardMessage} Your attacking unit was destroyed.`
      : combat.baseDestroyed
        ? `${resultLine}${supportMessage} Enemy base ruined.`
        : defender && remainingDefenders.length === 0
          ? `${resultLine}${supportMessage} Enemy unit destroyed.`
          : `${resultLine}${supportMessage}`;
    const eliminationMessage =
      eliminatedPlayerIds.length > 0
        ? ` Eliminated ${eliminatedPlayerIds
            .map((id) => players.find((candidate) => candidate.id === id)?.name ?? 'a player')
            .join(', ')}.`
        : '';

    return {
      ...combat,
      message: `${message}${unitXpMessage}${eliminationMessage}`,
      attackerTileId: fromTile.id,
      defenderTileId: targetTile.id,
      xpGained,
      suppliesGained,
      defenderSuppliesGained,
      unitXpGained,
    };
  });
}

export async function recruitUnitAtBase(gameId: string, baseTileId: string, unitTypeId: UnitTypeId, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const unitType = UNIT_TYPES[unitTypeId];
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only recruit during your turn.'));
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');
    if (!isUnitUnlocked(unitTypeId, sharedBarracksLevel)) throw new Error(`${unitType.name} is not unlocked here.`);

    const cost = unitCostForPlayer(unitType.cost, player);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to recruit ${unitType.name}.`);

    const playerArmiesSnapshot = await getDocs(query(collection(db, 'games', gameId, 'armies'), where('ownerId', '==', playerId)));
    const deployedUnitCount = playerArmiesSnapshot.docs.reduce((total, armyDoc) => {
      const army = armyDoc.data() as ArmyDoc;
      return total + army.units.length;
    }, 0);
    if (deployedUnitCount >= MAX_DEPLOYED_UNITS) {
      throw new Error(`You already have the maximum ${MAX_DEPLOYED_UNITS} squads deployed.`);
    }

    const neighborTiles = await Promise.all(
      getNeighborTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
        const tileSnap = await transaction.get(tileRef);
        return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
      }),
    );
    const deployTiles = neighborTiles.filter(
      (entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null && !isImpassableTerrain(entry.tile),
    );
    const spawnTarget = deployTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId);
    const cornerTiles = spawnTarget
      ? []
      : await Promise.all(
          getCornerTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
            const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
            const tileSnap = await transaction.get(tileRef);
            return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
          }),
        );
    const cornerSpawnTarget = cornerTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null && !isImpassableTerrain(entry.tile))
      .find(({ tile }) => !tile.armyId);

    const qualityLevel = effectiveUnitQualityLevel(baseTile, unitTypeId, effectiveBaseTiles, allArmies);
    const qualityBonus = Math.max(0, qualityLevel - 1);
    const newUnit = makeUnit(unitTypeId, qualityBonus);

    const finalSpawnTarget = spawnTarget ?? cornerSpawnTarget;

    if (finalSpawnTarget) {
      const armyRef = doc(collection(db, 'games', gameId, 'armies'));
      transaction.set(armyRef, {
        ownerId: playerId,
        tileId: finalSpawnTarget.tile.id,
        units: [newUnit],
        hasMovedThisTurn: false,
        hasActedThisTurn: false,
        movementUsedThisTurn: 0,
        queuedMoveTileId: null,
        queuedMoveMode: null,
      });
      transaction.update(finalSpawnTarget.ref, { armyId: armyRef.id });
    } else if (unitTypeId === 'builder' || unitTypeId === 'recon' || ARTILLERY_UNIT_TYPES.has(unitTypeId)) {
      throw new Error('No space to deploy.');
    } else {
      const adjacentArmyEntries = await Promise.all(
        deployTiles
          .filter(({ tile }) => tile.armyId)
          .map(async ({ tile }) => {
            const armyRef = doc(db, 'games', gameId, 'armies', tile.armyId!);
            const armySnap = await transaction.get(armyRef);
            return armySnap.exists() ? { ref: armyRef, army: { id: armySnap.id, ...armySnap.data() } as ArmyDoc } : null;
          }),
      );
      const mergeTarget = adjacentArmyEntries
        .filter((entry): entry is { ref: ReturnType<typeof doc>; army: ArmyDoc } => entry !== null)
        .find(
          ({ army }) =>
            army.ownerId === playerId &&
            armySpaceUsed(army.units) + UNIT_TYPES[unitTypeId].space <= ARMY_SPACE_CAPACITY &&
            !armyMustStaySolo(army),
        );
      if (!mergeTarget) throw new Error('No space to deploy.');

      transaction.update(mergeTarget.ref, {
        units: [...mergeTarget.army.units, newUnit],
      });
    }

    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      stats: mergedPlayerStats(player, { unitsCreated: 1 }),
      ...applyXp(player, XP_RECRUIT_UNIT),
    });

    return `Recruited ${unitType.name} for ${cost} supplies. +${XP_RECRUIT_UNIT} XP.`;
  });
}

export async function recruitUnitCompositionAtBase(
  gameId: string,
  baseTileId: string,
  compositionId: string,
  playerId: string,
) {
  return runTransaction(db, async (transaction) => {
    const composition = UNIT_COMPOSITIONS.find((candidate) => candidate.id === compositionId);
    if (!composition) throw new Error('That unit composition is not available.');

    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only recruit during your turn.'));
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');

    const lockedUnit = composition.units.find((unitTypeId) => !isUnitUnlocked(unitTypeId, sharedBarracksLevel));
    if (lockedUnit) throw new Error(`${UNIT_TYPES[lockedUnit].name} is not unlocked here.`);

    const soloOnlyUnit = composition.units.find((unitTypeId) => unitTypeId === 'builder' || unitTypeId === 'recon' || ARTILLERY_UNIT_TYPES.has(unitTypeId));
    if (soloOnlyUnit) throw new Error(`${UNIT_TYPES[soloOnlyUnit].name} must operate solo.`);

    const totalSpace = composition.units.reduce((total, unitTypeId) => total + UNIT_TYPES[unitTypeId].space, 0);
    if (totalSpace > ARMY_SPACE_CAPACITY) throw new Error('That unit composition is too large.');

    const cost = composition.units.reduce((total, unitTypeId) => total + unitCostForPlayer(UNIT_TYPES[unitTypeId].cost, player), 0);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to recruit ${composition.name}.`);

    const deployedUnitCount = allArmies
      .filter((army) => army.ownerId === playerId)
      .reduce((total, army) => total + army.units.length, 0);
    if (deployedUnitCount + composition.units.length > MAX_DEPLOYED_UNITS) {
      throw new Error(`You can only have ${MAX_DEPLOYED_UNITS} squads deployed.`);
    }

    const neighborTiles = await Promise.all(
      getNeighborTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
        const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
        const tileSnap = await transaction.get(tileRef);
        return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
      }),
    );
    const spawnTarget = neighborTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId && !isImpassableTerrain(tile));
    const cornerTiles = spawnTarget
      ? []
      : await Promise.all(
          getCornerTileIds(baseTile, game.mapWidth, game.mapHeight).map(async (tileId) => {
            const tileRef = doc(db, 'games', gameId, 'tiles', tileId);
            const tileSnap = await transaction.get(tileRef);
            return tileSnap.exists() ? ({ ref: tileRef, tile: { id: tileSnap.id, ...tileSnap.data() } as TileDoc }) : null;
          }),
        );
    const cornerSpawnTarget = cornerTiles
      .filter((entry): entry is { ref: ReturnType<typeof doc>; tile: TileDoc } => entry !== null)
      .find(({ tile }) => !tile.armyId && !isImpassableTerrain(tile));
    const finalSpawnTarget = spawnTarget ?? cornerSpawnTarget;
    if (!finalSpawnTarget) throw new Error('No space to deploy.');

    const newUnits = composition.units.map((unitTypeId) => {
      const qualityLevel = effectiveUnitQualityLevel(baseTile, unitTypeId, effectiveBaseTiles, allArmies);
      return makeUnit(unitTypeId, Math.max(0, qualityLevel - 1));
    });
    const armyRef = doc(collection(db, 'games', gameId, 'armies'));
    transaction.set(armyRef, {
      ownerId: playerId,
      tileId: finalSpawnTarget.tile.id,
      units: newUnits,
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
      movementUsedThisTurn: 0,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });
    transaction.update(finalSpawnTarget.ref, { armyId: armyRef.id });
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      stats: mergedPlayerStats(player, { unitsCreated: composition.units.length }),
      ...applyXp(player, XP_RECRUIT_UNIT * composition.units.length),
    });

    return `Recruited ${composition.name} for ${cost} supplies. +${XP_RECRUIT_UNIT * composition.units.length} XP.`;
  });
}

export async function buildBaseWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', builderArmy.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Logistics tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only build during your turn.'));
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can build a base.');
    }
    if (!canLogisticsBuildBase(builderArmy)) throw new Error('This Logistics squad cannot build bases yet.');
    if (tile.base) throw new Error('There is already a base on this tile.');
    if (player.supplies < BUILD_BASE_COST) throw new Error(`You need ${BUILD_BASE_COST} supplies to build a base.`);

    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tooCloseBase = tilesSnapshot.docs
      .map((baseTileDoc) => ({ id: baseTileDoc.id, ...baseTileDoc.data() }) as TileDoc)
      .some((otherTile) => otherTile.base && manhattanDistance(tile, otherTile) < 5);
    if (tooCloseBase) throw new Error('Bases must be at least 5 spaces from another base.');

    transaction.update(tileRef, {
      ownerId: playerId,
      base: makeOwnedBase(playerId),
      armyId: null,
    });
    transaction.delete(builderArmyRef);
    transaction.update(playerRef, {
      supplies: player.supplies - BUILD_BASE_COST,
      stats: mergedPlayerStats(player, { basesBuilt: 1 }),
      ...applyXp(player, XP_BUILD_BASE),
    });

    return `Built a new base for ${BUILD_BASE_COST} supplies. +${XP_BUILD_BASE} XP.`;
  });
}

export async function reclaimBaseWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', builderArmy.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Logistics tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only reclaim during your turn.'));
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can reclaim a ruined base.');
    }
    if (!canLogisticsBuildBase(builderArmy)) throw new Error('This Logistics squad cannot reclaim bases yet.');
    if (!tile.base?.ruined) throw new Error('There is no ruined base on this tile.');

    const cost = reclaimBaseCost(tile.base);
    if (player.supplies < cost) throw new Error(`You need ${cost} supplies to reclaim this base.`);

    transaction.update(tileRef, {
      ownerId: playerId,
      base: {
        ...tile.base,
        ownerId: playerId,
        ruined: false,
        previousOwnerId: tile.base.previousOwnerId ?? tile.base.ownerId ?? null,
      },
    });
    transaction.update(builderArmyRef, { hasActedThisTurn: true });
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      stats: mergedPlayerStats(player, { basesCaptured: 1 }),
      ...applyXp(player, XP_BUILD_BASE),
    });

    return `Reclaimed the ruined base for ${cost} supplies. Previous upgrades restored. +${XP_BUILD_BASE} XP.`;
  });
}

export async function buildTrenchWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', builderArmy.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Logistics tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only build during your turn.'));
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can build a trench.');
    }
    if (!canLogisticsBuildTrench(builderArmy)) throw new Error('Logistics needs to be L2 to build trenches.');
    if (tile.trench) throw new Error('There is already a trench on this tile.');
    if (isImpassableTerrain(tile)) throw new Error('You cannot build a trench on this terrain.');
    if (player.supplies < BUILD_TRENCH_COST) throw new Error(`You need ${BUILD_TRENCH_COST} supplies to build a trench.`);

    transaction.update(tileRef, {
      trench: { ownerId: playerId },
    });
    transaction.update(playerRef, { supplies: player.supplies - BUILD_TRENCH_COST });
    transaction.update(builderArmyRef, { hasActedThisTurn: true });

    return `Logistics squad dug a trench for ${BUILD_TRENCH_COST} supplies. Units on this tile gain +${TRENCH_ATTACK_BONUS} attack and +${TRENCH_DEFENSE_BONUS} defense.`;
  });
}

export async function scavengeSuppliesWithBuilder(gameId: string, builderArmyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const builderArmyRef = doc(db, 'games', gameId, 'armies', builderArmyId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [gameSnap, builderArmySnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(builderArmyRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !builderArmySnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const builderArmy = { id: builderArmySnap.id, ...builderArmySnap.data() } as ArmyDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only scavenge during your turn.'));
    if (builderArmy.ownerId !== playerId) throw new Error('You do not control that logistics squad.');
    if (builderArmy.hasActedThisTurn) throw new Error('That logistics squad has already acted this turn.');
    if (builderArmy.units.length !== 1 || builderArmy.units[0].typeId !== 'builder') {
      throw new Error('Only a solo Logistics squad can scavenge supplies.');
    }
    if (!canLogisticsScavenge(builderArmy)) throw new Error('Logistics needs to be L3 to scavenge supplies.');

    transaction.update(playerRef, { supplies: player.supplies + LOGISTICS_SCAVENGE_SUPPLIES });
    transaction.update(builderArmyRef, { hasActedThisTurn: true });

    return `Logistics squad scavenged +${LOGISTICS_SCAVENGE_SUPPLIES} supplies.`;
  });
}

export async function healArmyWithMedic(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only heal during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!armyHasMedic(army.units)) throw new Error('This unit needs a Medic to heal.');
    if (army.hasMovedThisTurn || army.hasActedThisTurn) {
      throw new Error('Healing uses the unit turn, so it must be ready to move and act.');
    }

    const healedUnits = healUnits(army.units, MEDIC_ACTIVE_HEAL);
    transaction.update(armyRef, {
      units: healedUnits,
      hasMovedThisTurn: true,
      hasActedThisTurn: true,
      passiveHealSkippedRound: game.roundNumber,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });

    return `Medic healed this unit for up to ${MEDIC_ACTIVE_HEAL} HP. Passive healing will skip this round.`;
  });
}

export async function placeMineWithAntiVehicle(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const tileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const tileSnap = await transaction.get(tileRef);
    if (!tileSnap.exists()) throw new Error('Unit tile is missing.');
    const tile = { id: tileSnap.id, ...tileSnap.data() } as TileDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only place mines during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (army.hasActedThisTurn) throw new Error('That unit has already acted this turn.');
    if (!army.units.some((unit) => unit.typeId === 'antiVehicle')) {
      throw new Error('This unit needs an Anti-Vehicle squad to place a mine.');
    }
    if (tile.mine) throw new Error('There is already a mine on this tile.');

    transaction.update(tileRef, {
      mine: { ownerId: playerId, damage: ANTI_VEHICLE_MINE_DAMAGE },
    });
    transaction.update(armyRef, { hasActedThisTurn: true });

    return `Anti-Vehicle squad placed a mine for ${ANTI_VEHICLE_MINE_DAMAGE} tank damage.`;
  });
}

export async function deploySmokeScreen(gameId: string, armyId: string, targetTileId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const [gameSnap, armySnap, targetTileSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(targetTileRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !targetTileSnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Smoke Screen unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only deploy smoke during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that Smoke Screen squad.');
    if (army.hasActedThisTurn) throw new Error('That unit has already acted this turn.');
    if (army.units.length !== 1 || army.units[0].typeId !== 'smokeArtillery') {
      throw new Error('Only a solo Smoke Screen squad can deploy smoke.');
    }
    const smokeUnit = army.units[0];
    const smokeReloadUntilRound = smokeUnit.smokeReloadUntilRound ?? 0;
    if (smokeReloadUntilRound > game.roundNumber) {
      throw new Error(`Smoke Screen is reloading until round ${smokeReloadUntilRound}.`);
    }
    if (!isTileInAttackRange(army, fromTile, targetTile, allTiles)) {
      throw new Error('Smoke target is out of range or line of sight.');
    }

    const smokeTiles = smokeAreaTiles(targetTile, allTiles);
    if (smokeTiles.length === 0) throw new Error('No valid smoke tiles found.');
    const expiresRound = game.roundNumber + SMOKE_SCREEN_DURATION_ROUNDS - 1;
    const reloadUntilRound = game.roundNumber + SMOKE_SCREEN_RELOAD_ROUNDS;
    smokeTiles.forEach((tile) => {
      transaction.update(doc(db, 'games', gameId, 'tiles', tile.id), {
        smoke: { ownerId: playerId, expiresRound },
      });
    });
    transaction.update(armyRef, {
      units: [{ ...smokeUnit, smokeReloadUntilRound: reloadUntilRound }],
      hasActedThisTurn: true,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });

    return `Smoke Screen deployed over ${smokeTiles.length} tiles. Units in smoke have -25% attack until round ${expiresRound}. Reload ready round ${reloadUntilRound}.`;
  });
}

export async function fortifyArmy(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only fortify during your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (army.hasActedThisTurn) throw new Error('That unit has already acted this turn.');

    transaction.update(armyRef, {
      hasMovedThisTurn: true,
      hasActedThisTurn: true,
      movementUsedThisTurn: 999,
      fortifyTurnsRemaining: FORTIFY_TURNS,
      queuedMoveTileId: null,
      queuedMoveMode: null,
    });

    return `Unit fortified. Defense increased, attack reduced, and movement locked for ${FORTIFY_TURNS} turns.`;
  });
}

export async function queueArmyMove(
  gameId: string,
  armyId: string,
  targetTileId: string,
  playerId: string,
  mode: MoveOrderMode = 'aggressive',
) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const targetTileRef = doc(db, 'games', gameId, 'tiles', targetTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, armySnap, targetTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(armyRef),
      transaction.get(targetTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !armySnap.exists() || !targetTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    const targetTile = { id: targetTileSnap.id, ...targetTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const fromTileRef = doc(db, 'games', gameId, 'tiles', army.tileId);
    const fromTileSnap = await transaction.get(fromTileRef);
    if (!fromTileSnap.exists()) throw new Error('Unit tile is missing.');
    const fromTile = { id: fromTileSnap.id, ...fromTileSnap.data() } as TileDoc;
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const tiles = tilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);

    if (!isSimultaneousGame(game)) throw new Error('Queued movement is only available in timed simultaneous games.');
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (army.hasMovedThisTurn) throw new Error('This unit already used its movement this round.');
    if ((army.fortifyTurnsRemaining ?? 0) > 0) throw new Error('This unit is fortified and cannot move.');
    if (targetTile.id === fromTile.id) throw new Error('This unit is already on that tile.');
    if (targetTile.armyId) throw new Error('Choose an empty destination tile.');
    if (isImpassableTerrain(targetTile)) throw new Error('Choose a passable destination tile.');

    const path = movementPath(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId });
    if (!path || path.length === 0) throw new Error('No path to that destination.');

    const remainingMovement = movementAllowance(player, army) - (army.movementUsedThisTurn ?? 0);
    const turnsRemaining = estimateQueuedMoveTurns(path.length, remainingMovement, movementAllowance(player, army));
    transaction.update(armyRef, {
      queuedMoveTileId: targetTileId,
      queuedMoveMode: mode,
    });

    return `Move order queued to ${targetTile.x}, ${targetTile.y}. ETA ${turnsRemaining} round${turnsRemaining === 1 ? '' : 's'} (${mode}).`;
  });
}

export async function setArmyMoveOrderMode(gameId: string, armyId: string, playerId: string, mode: MoveOrderMode) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (!isSimultaneousGame(game)) throw new Error('Queued movement is only available in timed simultaneous games.');
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');
    if (!army.queuedMoveTileId) throw new Error('This unit does not have a queued move order.');

    transaction.update(armyRef, { queuedMoveMode: mode });
    return `Move order changed to ${mode}.`;
  });
}

export async function clearArmyMoveOrder(gameId: string, armyId: string, playerId: string) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const armyRef = doc(db, 'games', gameId, 'armies', armyId);
    const [gameSnap, armySnap] = await Promise.all([transaction.get(gameRef), transaction.get(armyRef)]);
    if (!gameSnap.exists() || !armySnap.exists()) throw new Error('Game state changed. Try again.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const army = { id: armySnap.id, ...armySnap.data() } as ArmyDoc;
    if (!isSimultaneousGame(game)) throw new Error('Queued movement is only available in timed simultaneous games.');
    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'It is not your turn.'));
    if (army.ownerId !== playerId) throw new Error('You do not control that unit.');

    transaction.update(armyRef, { queuedMoveTileId: null, queuedMoveMode: null });
    return 'Move order cleared.';
  });
}

export async function upgradeBaseBarracks(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'barracks');
}

export async function upgradeBaseDefense(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'defense');
}

export async function upgradeBaseOffense(gameId: string, baseTileId: string, playerId: string) {
  return upgradeBase(gameId, baseTileId, playerId, 'offense');
}

export async function upgradeBaseUnitQuality(
  gameId: string,
  baseTileId: string,
  unitTypeId: UnitTypeId,
  playerId: string,
) {
  return upgradeBase(gameId, baseTileId, playerId, 'quality', unitTypeId);
}

export async function spendTalentPoint(gameId: string, playerId: string, talentId: TalentId) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);
    const [gameSnap, playerSnap] = await Promise.all([transaction.get(gameRef), transaction.get(playerRef)]);
    if (!gameSnap.exists() || !playerSnap.exists()) throw new Error('Player not found.');

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;
    const talent = talentById(talentId);
    if (game.isPaused) throw new Error('Gameplay is paused. Skill points can be spent after the host resumes.');
    if (!talent) throw new Error('That talent does not exist.');
    if (player.talentPoints <= 0) throw new Error('You do not have any skill points.');

    const currentRank = player.talents[talentId] ?? 0;
    if (currentRank >= talent.maxRanks) throw new Error(`${talent.name} is already maxed.`);
    const prerequisite = previousTalentInBranch(talentId);
    if (prerequisite && (player.talents[prerequisite.id] ?? 0) <= 0) {
      throw new Error(`${prerequisite.name} needs at least 1 rank first.`);
    }

    const nextTalents = { ...player.talents, [talentId]: currentRank + 1 };
    transaction.update(playerRef, {
      talentPoints: player.talentPoints - 1,
      talents: nextTalents,
    });

    return `${talent.name} increased to rank ${currentRank + 1}.`;
  });
}

export async function endTurn(gameId: string, playerId: string) {
  await runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await transaction.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found.');
    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    if (game.isPaused) throw new Error('Gameplay is paused. Turns can continue after the host resumes.');
    if (isSimultaneousGame(game)) throw new Error('Timed simultaneous games advance automatically each round.');
    if (game.currentTurnPlayerId !== playerId) throw new Error('It is not your turn.');

    const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const players = playersSnapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
    const tiles = tilesSnapshot.docs.map((tile) => ({ id: tile.id, ...tile.data() }) as TileDoc);
    const currentPlayerState = players.find((player) => player.id === playerId);
    if (currentPlayerState?.isEliminated) throw new Error('You have been eliminated.');
    const activePlayers = players.filter((player) => !player.isEliminated);
    if (activePlayers.length === 0) throw new Error('No active players remain.');
    const currentIndex = activePlayers.findIndex((player) => player.id === playerId);
    if (currentIndex < 0) throw new Error('You are no longer in this game.');
    const nextPlayer = activePlayers[(currentIndex + 1) % activePlayers.length];
    const nextRound = currentIndex === activePlayers.length - 1 ? game.roundNumber + 1 : game.roundNumber;
    const nextTurn = game.turnNumber + 1;
    const isRoundEnding = nextRound > game.roundNumber;
    const hasReachedTurnLimit = isRoundEnding && game.turnLimitRounds !== null && game.turnLimitRounds !== undefined
      ? game.roundNumber >= game.turnLimitRounds
      : false;

    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const nextIncome = suppliesFromBases(nextPlayer, tiles, armies);
    transaction.update(doc(db, 'games', gameId, 'players', nextPlayer.id), {
      supplies: nextPlayer.supplies + nextIncome,
    });
    const currentPlayer = players.find((player) => player.id === playerId);
    if (currentPlayer) {
      const ownedBaseCount = tiles.filter((tile) => tile.base?.ownerId === playerId).length;
      const endTurnXp = XP_END_TURN + ownedBaseCount * XP_PER_BASE_AT_TURN_END;
      transaction.update(doc(db, 'games', gameId, 'players', playerId), applyXp(currentPlayer, endTurnXp));
    }
    const projectedPlayers = players.map((player) =>
      player.id === playerId
        ? { ...player, ...applyXp(player, XP_END_TURN + tiles.filter((tile) => tile.base?.ownerId === playerId).length * XP_PER_BASE_AT_TURN_END) }
        : player,
    );
    armiesSnapshot.docs.forEach((armyDoc) => {
      const army = armyDoc.data() as ArmyDoc;
      const armyUpdates: Partial<ArmyDoc> = {};
      if (isRoundEnding && army.units.length > 0) {
        const passivelyHealedUnits =
          armyHasMedic(army.units) && army.passiveHealSkippedRound !== game.roundNumber
            ? healUnits(
                army.units,
                MEDIC_PASSIVE_HEAL + (hasFieldHospital(army.units) ? FIELD_HOSPITAL_PASSIVE_HEAL_BONUS : 0),
              )
            : army.units;
        const fullHealthXp =
          armyCurrentHealth(passivelyHealedUnits) >= armyMaxHealth(passivelyHealedUnits)
            ? army.units.length * UNIT_XP_FULL_HEALTH_END_ROUND
            : 0;
        armyUpdates.units = applyUnitXp(passivelyHealedUnits, fullHealthXp);
      }
      if (army.ownerId === nextPlayer.id) {
        const fortifyTurnsRemaining = army.fortifyTurnsRemaining ?? 0;
        const isMovementLocked = fortifyTurnsRemaining > 0;
        armyUpdates.hasMovedThisTurn = isMovementLocked;
        armyUpdates.hasActedThisTurn = false;
        armyUpdates.movementUsedThisTurn = isMovementLocked ? 999 : 0;
        armyUpdates.fortifyTurnsRemaining = Math.max(0, fortifyTurnsRemaining - 1);
      }
      if (Object.keys(armyUpdates).length > 0) transaction.update(armyDoc.ref, armyUpdates);
    });
    if (isRoundEnding) {
      tilesSnapshot.docs.forEach((tileDoc) => {
        const tile = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
        if (tile.smoke && tile.smoke.expiresRound < nextRound) {
          transaction.update(tileDoc.ref, { smoke: null });
        }
      });
    }
    if (hasReachedTurnLimit) {
      const winner = determineWinnerByXp(projectedPlayers);
      transaction.update(gameRef, {
        ...finishGameUpdates(game, winner?.id ?? null, 'turn-limit'),
        currentTurnPlayerId: null,
      });
      return;
    }
    transaction.update(gameRef, {
      currentTurnPlayerId: nextPlayer.id,
      turnNumber: nextTurn,
      roundNumber: nextRound,
    });
  });
}

export async function advanceSimultaneousRound(gameId: string) {
  await runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const gameSnap = await transaction.get(gameRef);
    if (!gameSnap.exists()) throw new Error('Game not found.');
    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    if (!isSimultaneousGame(game)) throw new Error('This game is not using timed simultaneous rounds.');
    if (game.status !== 'active') throw new Error('This game is not active.');
    if (game.isPaused) throw new Error('Gameplay is paused. Rounds can advance after the host resumes.');
    if ((game.roundEndsAtMs ?? 0) > Date.now()) throw new Error('The current round is still in progress.');

    const playersSnapshot = await getDocs(query(collection(db, 'games', gameId, 'players'), orderBy('joinedAt')));
    const tilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const armiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const players = playersSnapshot.docs.map((player) => ({ id: player.id, ...player.data() }) as PlayerDoc);
    const tiles = tilesSnapshot.docs.map((tile) => ({ id: tile.id, ...tile.data() }) as TileDoc);
    const armies = armiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const autoResolution = processQueuedMoveOrders(game, players, tiles, armies);
    const activePlayers = players.filter(
      (player) => !player.isEliminated && !autoResolution.eliminatedPlayerIds.includes(player.id),
    );

    autoResolution.eliminatedPlayerIds.forEach((playerId) => {
      transaction.update(doc(db, 'games', gameId, 'players', playerId), { isEliminated: true });
    });

    if (activePlayers.length <= 1) {
      const winner = activePlayers[0] ?? determineWinnerByXp(players);
      transaction.update(gameRef, {
        ...finishGameUpdates(game, winner?.id ?? null, 'elimination'),
      });
      return;
    }

    const projectedPlayers = players.map((player) => {
      if (!activePlayers.some((activePlayer) => activePlayer.id === player.id)) return player;
      const reward = autoResolution.playerRewards.get(player.id) ?? { supplies: 0, xp: 0 };
      const statDelta = autoResolution.playerStatDeltas.get(player.id) ?? {};
      const ownedBaseCount = autoResolution.tiles.filter((tile) => tile.base?.ownerId === player.id).length;
      const roundXp = XP_END_TURN + ownedBaseCount * XP_PER_BASE_AT_TURN_END;
      return {
        ...player,
        supplies: player.supplies + suppliesFromBases(player, autoResolution.tiles, autoResolution.armies) + reward.supplies,
        stats: mergedPlayerStats(player, statDelta),
        ...applyXp(player, roundXp + reward.xp),
      };
    });

    const hasReachedTurnLimit =
      game.turnLimitRounds !== null && game.turnLimitRounds !== undefined ? game.roundNumber >= game.turnLimitRounds : false;

    activePlayers.forEach((player) => {
      const reward = autoResolution.playerRewards.get(player.id) ?? { supplies: 0, xp: 0 };
      const statDelta = autoResolution.playerStatDeltas.get(player.id) ?? {};
      const nextIncome = suppliesFromBases(player, autoResolution.tiles, autoResolution.armies);
      const ownedBaseCount = autoResolution.tiles.filter((tile) => tile.base?.ownerId === player.id).length;
      const roundXp = XP_END_TURN + ownedBaseCount * XP_PER_BASE_AT_TURN_END;
      transaction.update(doc(db, 'games', gameId, 'players', player.id), {
        supplies: player.supplies + nextIncome + reward.supplies,
        exploredTileIds: exploredTileIdsFor(player, autoResolution.tiles, autoResolution.armies),
        stats: mergedPlayerStats(player, statDelta),
        ...applyXp(player, roundXp + reward.xp),
      });
    });

    players
      .filter((player) => !activePlayers.some((activePlayer) => activePlayer.id === player.id))
      .forEach((player) => {
        const statDelta = autoResolution.playerStatDeltas.get(player.id);
        if (!statDelta) return;
        transaction.update(doc(db, 'games', gameId, 'players', player.id), {
          stats: mergedPlayerStats(player, statDelta),
        });
      });

    const originalArmiesById = new Map(armiesSnapshot.docs.map((armyDoc) => [armyDoc.id, armyDoc.ref]));
    const originalTilesById = new Map(tilesSnapshot.docs.map((tileDoc) => [tileDoc.id, tileDoc.ref]));
    const nextArmiesById = new Map(autoResolution.armies.map((army) => [army.id, army]));
    const nextTilesById = new Map(autoResolution.tiles.map((tile) => [tile.id, tile]));

    armiesSnapshot.docs.forEach((armyDoc) => {
      const army = nextArmiesById.get(armyDoc.id);
      if (!army) {
        transaction.delete(armyDoc.ref);
        return;
      }
      const fortifyTurnsRemaining = army.fortifyTurnsRemaining ?? 0;
      const isMovementLocked = fortifyTurnsRemaining > 0;
      const passivelyHealedUnits =
        army.units.length > 0 && armyHasMedic(army.units) && army.passiveHealSkippedRound !== game.roundNumber
          ? healUnits(
              army.units,
              MEDIC_PASSIVE_HEAL + (hasFieldHospital(army.units) ? FIELD_HOSPITAL_PASSIVE_HEAL_BONUS : 0),
            )
          : army.units;
      const fullHealthXp =
        army.units.length > 0 && armyCurrentHealth(passivelyHealedUnits) >= armyMaxHealth(passivelyHealedUnits)
          ? army.units.length * UNIT_XP_FULL_HEALTH_END_ROUND
          : 0;
      transaction.update(armyDoc.ref, {
        units: applyUnitXp(passivelyHealedUnits, fullHealthXp),
        hasMovedThisTurn: isMovementLocked,
        hasActedThisTurn: false,
        movementUsedThisTurn: isMovementLocked ? 999 : 0,
        fortifyTurnsRemaining: Math.max(0, fortifyTurnsRemaining - 1),
        tileId: army.tileId,
        lastMoveDirection: army.lastMoveDirection ?? null,
        queuedMoveTileId: army.queuedMoveTileId ?? null,
        queuedMoveMode: army.queuedMoveMode ?? null,
        passiveHealSkippedRound: army.passiveHealSkippedRound ?? null,
      });
    });

    autoResolution.armies
      .filter((army) => !originalArmiesById.has(army.id))
      .forEach((army) => {
        transaction.set(doc(db, 'games', gameId, 'armies', army.id), {
          ownerId: army.ownerId,
          tileId: army.tileId,
          units: army.units,
          hasMovedThisTurn: false,
          hasActedThisTurn: false,
          movementUsedThisTurn: 0,
          lastMoveDirection: army.lastMoveDirection ?? null,
          fortifyTurnsRemaining: army.fortifyTurnsRemaining ?? null,
          passiveHealSkippedRound: army.passiveHealSkippedRound ?? null,
          queuedMoveTileId: army.queuedMoveTileId ?? null,
          queuedMoveMode: army.queuedMoveMode ?? null,
        });
      });

    tilesSnapshot.docs.forEach((tileDoc) => {
      const nextTile = nextTilesById.get(tileDoc.id);
      if (!nextTile) return;
      const currentTile = { id: tileDoc.id, ...tileDoc.data() } as TileDoc;
      if (JSON.stringify(currentTile) === JSON.stringify(nextTile)) return;
      transaction.update(tileDoc.ref, {
        ownerId: nextTile.ownerId,
        armyId: nextTile.armyId,
        base: nextTile.base,
        mine: nextTile.mine ?? null,
        trench: nextTile.trench ?? null,
        smoke: nextTile.smoke && nextTile.smoke.expiresRound >= game.roundNumber + 1 ? nextTile.smoke : null,
      });
    });

    if (hasReachedTurnLimit) {
      const winner = determineWinnerByXp(projectedPlayers);
      transaction.update(gameRef, {
        ...finishGameUpdates(game, winner?.id ?? null, 'turn-limit'),
        currentTurnPlayerId: null,
      });
      return;
    }

    transaction.update(gameRef, {
      currentTurnPlayerId: null,
      turnNumber: game.turnNumber + 1,
      roundNumber: game.roundNumber + 1,
      roundEndsAtMs: nextRoundEndsAtMs(game.roundDurationSeconds),
    });
  });
}

function processQueuedMoveOrders(game: GameDoc, players: PlayerDoc[], tiles: TileDoc[], armies: ArmyDoc[]) {
  const nextTiles = tiles.map((tile) => ({
    ...tile,
    base: tile.base ? { ...tile.base, unitQualityByType: { ...(tile.base.unitQualityByType ?? {}) } } : null,
    mine: tile.mine ? { ...tile.mine } : null,
    trench: tile.trench ? { ...tile.trench } : null,
    smoke: tile.smoke ? { ...tile.smoke } : null,
  }));
  const nextArmies = armies.map((army) => ({
    ...army,
    units: army.units.map((unit) => ({ ...unit })),
  }));
  const playerRewards = new Map<string, { supplies: number; xp: number }>();
  const playerStatDeltas = new Map<string, Partial<PlayerStats>>();
  const orderedArmies = nextArmies.filter(
    (army) => army.queuedMoveTileId && !army.hasMovedThisTurn && army.units.length > 0,
  );

  orderedArmies.forEach((army) => {
    const player = players.find((candidate) => candidate.id === army.ownerId);
    if (!player) return;

    const startTile = nextTiles.find((tile) => tile.id === army.tileId);
    if (!startTile) return;

    if (army.queuedMoveMode !== 'passive') {
      const attackedBeforeMove = tryResolveQueuedAttack(
        game,
        players,
        player,
        army,
        startTile,
        nextTiles,
        nextArmies,
        playerRewards,
        playerStatDeltas,
      );
      if (attackedBeforeMove) return;
    }

    const destinationTile = nextTiles.find((tile) => tile.id === army.queuedMoveTileId);
    if (!destinationTile || destinationTile.id === startTile.id) {
      army.queuedMoveTileId = null;
      army.queuedMoveMode = null;
      return;
    }

    const path = movementPath(startTile, destinationTile, nextTiles, {
      armies: nextArmies,
      passThroughOwnerId: army.ownerId,
    });
    if (!path || path.length === 0) {
      army.queuedMoveTileId = null;
      army.queuedMoveMode = null;
      return;
    }

    const finalTile = resolveQueuedMoveDestination(path, player, army);
    if (finalTile) {
      applyQueuedMove(game, player, army, startTile, finalTile, nextTiles, nextArmies, playerStatDeltas);
    }

    const currentTile = nextTiles.find((tile) => tile.id === army.tileId);
    if (army.queuedMoveTileId && army.queuedMoveMode !== 'passive' && currentTile) {
      tryResolveQueuedAttack(
        game,
        players,
        player,
        army,
        currentTile,
        nextTiles,
        nextArmies,
        playerRewards,
        playerStatDeltas,
      );
    }

    if (army.queuedMoveTileId === army.tileId) {
      army.queuedMoveTileId = null;
      army.queuedMoveMode = null;
    }
  });

  const eliminatedPlayerIds = players
    .filter((player) => !player.isEliminated)
    .filter((player) => shouldEliminatePlayer(player.id, nextTiles, nextArmies))
    .map((player) => player.id);

  return { tiles: nextTiles, armies: nextArmies, playerRewards, playerStatDeltas, eliminatedPlayerIds };
}

function tryResolveQueuedAttack(
  game: GameDoc,
  players: PlayerDoc[],
  player: PlayerDoc,
  army: ArmyDoc,
  fromTile: TileDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[],
  playerRewards: Map<string, { supplies: number; xp: number }>,
  playerStatDeltas: Map<string, Partial<PlayerStats>>,
) {
  if (army.hasActedThisTurn || army.units.length === 0) return false;

  const targetTile = chooseQueuedAttackTarget(army, fromTile, player.id, tiles, armies, game.roundNumber);
  if (!targetTile) return false;

  applyQueuedAttack(game, players, player, army, fromTile, targetTile, tiles, armies, playerRewards, playerStatDeltas);
  return true;
}

function chooseQueuedAttackTarget(
  army: ArmyDoc,
  fromTile: TileDoc,
  playerId: string,
  tiles: TileDoc[],
  armies: ArmyDoc[],
  roundNumber: number,
) {
  const armiesById = new Map(armies.map((candidate) => [candidate.id, candidate]));
  return tiles
    .filter((tile) => canAttackTile(army, fromTile, tile, playerId, tiles, roundNumber))
    .sort((a, b) => {
      const aArmy = a.armyId ? armiesById.get(a.armyId) : null;
      const bArmy = b.armyId ? armiesById.get(b.armyId) : null;
      const aScore = (a.base && !a.base.ruined ? 0 : 10) + (aArmy ? 0 : 4) + chebyshevDistance(fromTile, a);
      const bScore = (b.base && !b.base.ruined ? 0 : 10) + (bArmy ? 0 : 4) + chebyshevDistance(fromTile, b);
      return aScore - bScore;
    })[0] ?? null;
}

function resolveQueuedMoveDestination(path: TileDoc[], player: PlayerDoc, army: ArmyDoc) {
  const moveBudget = Math.max(0, movementAllowance(player, army) - (army.movementUsedThisTurn ?? 0));
  if (moveBudget <= 0) return null;
  const moveSlice = path.slice(0, moveBudget);
  const movementWaypoints = moveSlice.filter((tile) => !tile.armyId && !isActiveBaseTile(tile));
  return movementWaypoints[movementWaypoints.length - 1] ?? null;
}

function applyQueuedMove(
  game: GameDoc,
  player: PlayerDoc,
  army: ArmyDoc,
  fromTile: TileDoc,
  targetTile: TileDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[],
  playerStatDeltas: Map<string, Partial<PlayerStats>>,
) {
  const moveCost = movementCost(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId }) ?? 0;
  const path = movementPath(fromTile, targetTile, tiles, { armies, passThroughOwnerId: army.ownerId }) ?? [targetTile];
  const triggeredMineTile = triggeredMineTileForPath(path, army.ownerId, army);
  const mineDamage = triggeredMineTile?.mine?.damage ?? ANTI_VEHICLE_MINE_DAMAGE;
  const mineTriggers = Boolean(triggeredMineTile);
  const movedUnits = mineTriggers ? damageTankUnits(army.units, mineDamage) : army.units;
  const sentryExchange = resolveSentryMoveExchange(game, player, army, path, movedUnits, tiles);
  const finalUnits = sentryExchange.finalUnits;
  const unitsLost = Math.max(0, army.units.length - finalUnits.length);
  if (unitsLost > 0) addPlayerStatDelta(playerStatDeltas, army.ownerId, { unitsLost });

  fromTile.armyId = null;
  if (triggeredMineTile) triggeredMineTile.mine = null;
  if (sentryExchange.baseDestroyed && sentryExchange.sentryAttack) {
    sentryExchange.sentryAttack.tile.base = ruinBase(sentryExchange.sentryAttack.tile.base);
    sentryExchange.sentryAttack.tile.ownerId = null;
  } else if (sentryExchange.sentryAttack?.tile.base) {
    sentryExchange.sentryAttack.tile.base = {
      ...sentryExchange.sentryAttack.tile.base,
      lastSentryTurnNumber: game.turnNumber,
    };
  }

  if (finalUnits.length === 0) {
    targetTile.armyId = null;
    const armyIndex = armies.findIndex((candidate) => candidate.id === army.id);
    if (armyIndex >= 0) armies.splice(armyIndex, 1);
    return;
  }

  army.tileId = targetTile.id;
  army.units = finalUnits;
  army.hasMovedThisTurn = true;
  army.movementUsedThisTurn = (army.movementUsedThisTurn ?? 0) + moveCost;
  army.lastMoveDirection = directionFromTiles(fromTile, targetTile);
  targetTile.armyId = army.id;
}

function applyQueuedAttack(
  game: GameDoc,
  players: PlayerDoc[],
  player: PlayerDoc,
  attacker: ArmyDoc,
  fromTile: TileDoc,
  targetTile: TileDoc,
  tiles: TileDoc[],
  armies: ArmyDoc[],
  playerRewards: Map<string, { supplies: number; xp: number }>,
  playerStatDeltas: Map<string, Partial<PlayerStats>>,
) {
  const defender = targetTile.armyId ? armies.find((army) => army.id === targetTile.armyId) ?? null : null;
  const defendingOwnerId =
    defender?.ownerId ??
    (targetTile.base && !targetTile.base.ruined && targetTile.base.ownerId !== player.id ? targetTile.base.ownerId : null);
  const defendingPlayer = defendingOwnerId ? players.find((candidate) => candidate.id === defendingOwnerId) ?? null : null;
  if (!defendingOwnerId) return;

  const defenderCanReturnFire = Boolean(defender && isTileInAttackRange(defender, targetTile, fromTile, tiles));
  const isRangedAttackWithoutReturnFire = chebyshevDistance(fromTile, targetTile) > 1 && !defenderCanReturnFire;
  const supportedByAdjacentArmy = armies.some((supportArmy) => {
    if (supportArmy.id === attacker.id || supportArmy.ownerId !== player.id) return false;
    const supportTile = tiles.find((tile) => tile.id === supportArmy.tileId);
    return Boolean(supportTile && manhattanDistance(fromTile, supportTile) === 1);
  });
  const defendingBase = targetTile.base && !targetTile.base.ruined && targetTile.base.ownerId !== player.id ? targetTile.base : null;
  const attackTalentBonus = (player.talents.attackTraining ?? 0) * 0.05;
  const supportTalentBonus = supportedByAdjacentArmy ? 0.1 + (player.talents.coordinatedAssault ?? 0) * 0.02 : 0;
  const defenseTalentBonus = (defendingPlayer?.talents.defensiveDrills ?? 0) * 0.05;
  const baseTalentDefenseBonus = defendingBase ? defendingPlayer?.talents.baseFortification ?? 0 : 0;
  const baseAuraDefenseBonus =
    defendingOwnerId && isInFriendlyBaseAura(targetTile, defendingOwnerId, tiles) ? BASE_AURA_DEFENSE_BONUS : 0;
  const trenchAttackBonus = fromTile.trench ? TRENCH_ATTACK_BONUS : 0;
  const trenchDefenseBonus = targetTile.trench ? TRENCH_DEFENSE_BONUS : 0;
  const attackerCombinedArmsBonus = hasCombinedArms(attacker.units) ? 0.1 : 0;
  const defenderCombinedArmsBonus = defender && hasCombinedArms(defender.units) ? 0.1 : 0;
  const tankHunterBonus = defender?.units.some((unit) => unit.typeId === 'tank') && hasTankHunters(attacker.units) ? 0.25 : 0;
  const entrenchedInfantryBonus =
    defender && hasEntrenchedInfantry(defender.units) && (Boolean(targetTile.trench) || baseAuraDefenseBonus > 0) ? 0.15 : 0;
  const siegeColumnBonus = defendingBase && hasSiegeColumn(attacker.units) ? 0.2 : 0;
  const fortifyAttackPenalty = (attacker.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_ATTACK_MULTIPLIER : 1;
  const fortifyDefenseBonus = defender && (defender.fortifyTurnsRemaining ?? 0) > 0 ? FORTIFY_DEFENSE_MULTIPLIER : 1;
  const artilleryFlatBonus = artilleryAttackFlatBonus(attacker, defender, defendingBase, targetTile);
  const smokeAttackMultiplier = activeSmokeOnTile(fromTile, game.roundNumber) ? SMOKE_SCREEN_ATTACK_MULTIPLIER : 1;
  const resolvedCombat = resolveCombat(
    attacker.units,
    defender?.units ?? [],
    targetTile.terrainType,
    defendingBase,
    (1 + attackTalentBonus + supportTalentBonus + attackerCombinedArmsBonus + tankHunterBonus + siegeColumnBonus) *
      fortifyAttackPenalty *
      smokeAttackMultiplier,
    (1 + defenseTalentBonus + defenderCombinedArmsBonus + entrenchedInfantryBonus) * fortifyDefenseBonus,
    baseTalentDefenseBonus + baseAuraDefenseBonus + trenchDefenseBonus,
    trenchAttackBonus + artilleryFlatBonus,
  );
  const combat = isRangedAttackWithoutReturnFire ? { ...resolvedCombat, attackerLosses: 0 } : resolvedCombat;
  const remainingAttackers = removeUnitLosses(attacker.units, combat.attackerLosses, 'attacker');
  const remainingDefenders = defender ? removeUnitLosses(defender.units, combat.defenderLosses, 'defender') : [];
  const attackerUnitsDestroyed = attacker.units.length - remainingAttackers.length;
  const defenderUnitsDestroyed = defender ? defender.units.length - remainingDefenders.length : 0;
  const xpGained =
    XP_ATTACK +
    defenderUnitsDestroyed * XP_DESTROY_UNIT +
    (defender && remainingDefenders.length === 0 ? XP_DESTROY_ARMY : 0) +
    (combat.baseDestroyed ? XP_DESTROY_BASE : 0);
  const suppliesGained =
    defenderUnitsDestroyed * SUPPLIES_DESTROY_UNIT +
    (defender && remainingDefenders.length === 0 ? SUPPLIES_DESTROY_ARMY : 0) +
    (combat.baseDestroyed ? SUPPLIES_DESTROY_BASE : 0);
  const defenderSuppliesGained =
    defender && remainingAttackers.length === 0 ? attackerUnitsDestroyed * SUPPLIES_DESTROY_UNIT + SUPPLIES_DESTROY_ARMY : 0;
  const unitXpGained =
    defenderUnitsDestroyed * UNIT_XP_DESTROY_UNIT + (defender && remainingDefenders.length === 0 ? UNIT_XP_DESTROY_ARMY : 0);

  addPlayerReward(playerRewards, player.id, suppliesGained, xpGained);
  addPlayerStatDelta(playerStatDeltas, player.id, {
    enemiesKilled: defenderUnitsDestroyed,
    basesDestroyed: combat.baseDestroyed ? 1 : 0,
    unitsLost: attackerUnitsDestroyed,
  });
  if (defender && defenderSuppliesGained > 0) {
    addPlayerReward(playerRewards, defender.ownerId, defenderSuppliesGained, 0);
    addPlayerStatDelta(playerStatDeltas, defender.ownerId, {
      enemiesKilled: attackerUnitsDestroyed,
      unitsLost: defenderUnitsDestroyed,
    });
  } else if (defendingOwnerId && defenderUnitsDestroyed > 0) {
    addPlayerStatDelta(playerStatDeltas, defendingOwnerId, {
      unitsLost: defenderUnitsDestroyed,
    });
  }

  if (remainingAttackers.length === 0) {
    fromTile.armyId = null;
    const attackerIndex = armies.findIndex((candidate) => candidate.id === attacker.id);
    if (attackerIndex >= 0) armies.splice(attackerIndex, 1);
  } else {
    attacker.units = applyNormalArtilleryReload(applyUnitXp(remainingAttackers, unitXpGained), attacker, game.roundNumber);
    attacker.hasActedThisTurn = true;
  }

  if (defender && remainingDefenders.length === 0) {
    targetTile.armyId = null;
    const defenderIndex = armies.findIndex((candidate) => candidate.id === defender.id);
    if (defenderIndex >= 0) armies.splice(defenderIndex, 1);
    if (combat.baseDestroyed) {
      targetTile.base = ruinBase(targetTile.base);
      targetTile.ownerId = null;
    }
  } else if (defender) {
    defender.units = remainingDefenders;
  } else if (combat.baseDestroyed) {
    targetTile.base = ruinBase(targetTile.base);
    targetTile.ownerId = null;
  }
}

function addPlayerReward(rewards: Map<string, { supplies: number; xp: number }>, playerId: string, supplies: number, xp: number) {
  const current = rewards.get(playerId) ?? { supplies: 0, xp: 0 };
  rewards.set(playerId, {
    supplies: current.supplies + supplies,
    xp: current.xp + xp,
  });
}

function applyNormalArtilleryReload(units: UnitInstance[], sourceArmy: ArmyDoc, roundNumber: number) {
  if (!isNormalArtilleryArmy(sourceArmy)) return units;
  const reloadUntilRound = roundNumber + NORMAL_ARTILLERY_RELOAD_ROUNDS;
  return units.map((unit) =>
    NORMAL_ARTILLERY_UNIT_TYPES.has(unit.typeId) ? { ...unit, artilleryReloadUntilRound: reloadUntilRound } : unit,
  );
}

function addPlayerStatDelta(deltas: Map<string, Partial<PlayerStats>>, playerId: string, delta: Partial<PlayerStats>) {
  const current = deltas.get(playerId) ?? {};
  deltas.set(playerId, {
    enemiesKilled: (current.enemiesKilled ?? 0) + (delta.enemiesKilled ?? 0),
    basesBuilt: (current.basesBuilt ?? 0) + (delta.basesBuilt ?? 0),
    basesCaptured: (current.basesCaptured ?? 0) + (delta.basesCaptured ?? 0),
    basesDestroyed: (current.basesDestroyed ?? 0) + (delta.basesDestroyed ?? 0),
    unitsLost: (current.unitsLost ?? 0) + (delta.unitsLost ?? 0),
    unitsCreated: (current.unitsCreated ?? 0) + (delta.unitsCreated ?? 0),
  });
}

function makeEmptyPlayerStats(): PlayerStats {
  return {
    enemiesKilled: 0,
    basesBuilt: 0,
    basesCaptured: 0,
    basesDestroyed: 0,
    unitsLost: 0,
    unitsCreated: 0,
  };
}

function mergedPlayerStats(player: PlayerDoc, delta: Partial<PlayerStats>): PlayerStats {
  const current = player.stats ?? makeEmptyPlayerStats();
  return {
    enemiesKilled: current.enemiesKilled + (delta.enemiesKilled ?? 0),
    basesBuilt: current.basesBuilt + (delta.basesBuilt ?? 0),
    basesCaptured: current.basesCaptured + (delta.basesCaptured ?? 0),
    basesDestroyed: current.basesDestroyed + (delta.basesDestroyed ?? 0),
    unitsLost: current.unitsLost + (delta.unitsLost ?? 0),
    unitsCreated: current.unitsCreated + (delta.unitsCreated ?? 0),
  };
}

function normalizeTurnLimit(turnLimitRounds: number | null | undefined) {
  const limit = Number(turnLimitRounds ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return [5, 10, 15, 20, 25, 30, 40, 50].includes(limit) ? limit : 20;
}

function determineWinnerByXp(players: PlayerDoc[]) {
  return [...players]
    .sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp;
      const aStats = a.stats ?? makeEmptyPlayerStats();
      const bStats = b.stats ?? makeEmptyPlayerStats();
      if (bStats.enemiesKilled !== aStats.enemiesKilled) return bStats.enemiesKilled - aStats.enemiesKilled;
      if (aStats.unitsLost !== bStats.unitsLost) return aStats.unitsLost - bStats.unitsLost;
      return a.joinedAt && b.joinedAt ? 0 : 0;
    })[0] ?? null;
}

function finishGameUpdates(game: GameDoc, winnerPlayerId: string | null, victoryReason: VictoryReason) {
  return {
    status: 'finished' as const,
    winnerPlayerId,
    victoryReason,
    roundEndsAtMs: null,
  };
}

function estimateQueuedMoveTurns(pathLength: number, initialMovement: number, perRoundMovement: number) {
  if (pathLength <= 0) return 0;
  if (initialMovement >= pathLength) return 1;
  const remainingDistance = Math.max(0, pathLength - Math.max(0, initialMovement));
  return 1 + Math.ceil(remainingDistance / Math.max(1, perRoundMovement));
}

async function createPlayer(gameId: string, user: User, playerName: string, colorIndex: number) {
  await setDoc(doc(db, 'games', gameId, 'players', user.uid), {
    name: playerName.trim() || 'Anonymous Commander',
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    supplies: STARTING_SUPPLIES,
    xp: 0,
    level: 1,
    talentPoints: 0,
    talents: {},
    isEliminated: false,
    isReady: false,
    stats: makeEmptyPlayerStats(),
    exploredTileIds: [],
    joinedAt: serverTimestamp(),
  });
}

function makeGameCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function chooseMapTemplateForPlayerCount(playerCount: number) {
  return playerCount >= 5 ? MAP_TEMPLATES['grand-front'] : MAP_TEMPLATES['classic-front'];
}

function makeTerrain(mapTemplate: MapTemplate): TileDoc[] {
  const tiles: TileDoc[] = [];
  for (let y = 0; y < mapTemplate.height; y += 1) {
    for (let x = 0; x < mapTemplate.width; x += 1) {
      const terrainType = terrainForCoords(mapTemplate, x, y);
      tiles.push({
        id: tileIdFromCoords(x, y),
        x,
        y,
        terrainType,
        ownerId: null,
        armyId: null,
        base: null,
        mine: null,
        trench: null,
        smoke: null,
      });
    }
  }
  return tiles;
}

function terrainForCoords(mapTemplate: MapTemplate, x: number, y: number): TileDoc['terrainType'] {
  if (isProtectedStartArea(mapTemplate, x, y)) return 'plains';

  if (mapTemplate.id === 'grand-front') {
    const waterBand =
      (x >= 11 && x <= 15 && y >= 4 && y <= 21) ||
      (y >= 14 && y <= 17 && x >= 5 && x <= 12) ||
      (y >= 8 && y <= 11 && x >= 17 && x <= 23);
    const waterScatter = (x * 13 + y * 9) % 53 === 0;
    if (waterBand || waterScatter) return 'water';

    const mountainRidge =
      (x >= 19 && x <= 22 && y >= 12 && y <= 24) ||
      (x >= 6 && x <= 9 && y >= 10 && y <= 22) ||
      (x >= 12 && x <= 16 && y >= 3 && y <= 8);
    const mountainScatter = (x * 7 + y * 15) % 61 === 0;
    if (mountainRidge || mountainScatter) return 'mountain';

    if ((x + y) % 8 === 0) return 'forest';
    if ((x * y + x + y) % 19 === 0) return 'hill';
    return 'plains';
  }

  const waterBand = (x >= 7 && x <= 10 && y >= 3 && y <= 14) || (y >= 12 && y <= 14 && x >= 3 && x <= 8);
  const waterScatter = (x * 11 + y * 7) % 37 === 0;
  if (waterBand || waterScatter) return 'water';

  const mountainRidge = (x >= 13 && x <= 15 && y >= 4 && y <= 16) || (x >= 4 && x <= 6 && y >= 9 && y <= 17);
  const mountainScatter = (x * 5 + y * 13) % 41 === 0;
  if (mountainRidge || mountainScatter) return 'mountain';

  if ((x + y) % 9 === 0) return 'forest';
  if ((x * y) % 17 === 0) return 'hill';
  return 'plains';
}

function isProtectedStartArea(mapTemplate: MapTemplate, x: number, y: number) {
  return mapTemplate.startingPositions.some((start) => Math.abs(start.x - x) + Math.abs(start.y - y) <= 2);
}

function builderTileIdForStart(start: { x: number; y: number }, mapTemplate: MapTemplate) {
  const centerX = (mapTemplate.width - 1) / 2;
  const centerY = (mapTemplate.height - 1) / 2;
  const deltaX = centerX - start.x;
  const deltaY = centerY - start.y;

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    const builderX = Math.max(0, Math.min(mapTemplate.width - 1, start.x + (deltaX >= 0 ? 1 : -1)));
    return tileIdFromCoords(builderX, start.y);
  }

  const builderY = Math.max(0, Math.min(mapTemplate.height - 1, start.y + (deltaY >= 0 ? 1 : -1)));
  return tileIdFromCoords(start.x, builderY);
}

function shouldEliminatePlayer(playerId: string, tiles: TileDoc[], armies: ArmyDoc[]) {
  const hasBase = tiles.some((tile) => tile.base?.ownerId === playerId);
  const hasArmy = armies.some((army) => army.ownerId === playerId && army.units.length > 0);
  return !hasBase && !hasArmy;
}

function isInFriendlyBaseAura(tile: TileDoc, ownerId: string, tiles: TileDoc[]) {
  return tiles.some(
    (baseTile) =>
      baseTile.base?.ownerId === ownerId &&
      Math.max(Math.abs(baseTile.x - tile.x), Math.abs(baseTile.y - tile.y)) <= 1,
  );
}

function directionFromTiles(from: TileDoc, to: TileDoc): MoveDirection {
  if (to.x > from.x) return 'east';
  if (to.x < from.x) return 'west';
  if (to.y < from.y) return 'north';
  return 'south';
}

function exploredTileIdsFor(player: PlayerDoc, tiles: TileDoc[], armies: ArmyDoc[]) {
  return Array.from(new Set([...(player.exploredTileIds ?? []), ...visibleTileIdsForPlayer(player.id, tiles, armies)]));
}

function getNeighborTileIds(tile: TileDoc, mapWidth: number, mapHeight: number) {
  return [
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x, y: tile.y - 1 },
  ]
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < mapWidth && y < mapHeight)
    .map(({ x, y }) => tileIdFromCoords(x, y));
}

function getCornerTileIds(tile: TileDoc, mapWidth: number, mapHeight: number) {
  return [
    { x: tile.x + 1, y: tile.y + 1 },
    { x: tile.x + 1, y: tile.y - 1 },
    { x: tile.x - 1, y: tile.y + 1 },
    { x: tile.x - 1, y: tile.y - 1 },
  ]
    .filter(({ x, y }) => x >= 0 && y >= 0 && x < mapWidth && y < mapHeight)
    .map(({ x, y }) => tileIdFromCoords(x, y));
}

function triggeredMineTileForPath(path: TileDoc[], ownerId: string, army: ArmyDoc) {
  if (!army.units.some((unit) => unit.typeId === 'tank')) return null;
  return path.find((tile) => tile.mine && tile.mine.ownerId !== ownerId) ?? null;
}

function isUnitUnlocked(unitTypeId: UnitTypeId, barracksLevel: number) {
  return UPGRADE_CONFIG.barracks
    .filter((level) => level.level <= barracksLevel)
    .flatMap((level) => level.unlocks)
    .includes(unitTypeId);
}

async function upgradeBase(
  gameId: string,
  baseTileId: string,
  playerId: string,
  upgradeType: 'barracks' | 'quality' | 'defense' | 'offense',
  unitTypeId?: UnitTypeId,
) {
  return runTransaction(db, async (transaction) => {
    const gameRef = doc(db, 'games', gameId);
    const baseTileRef = doc(db, 'games', gameId, 'tiles', baseTileId);
    const playerRef = doc(db, 'games', gameId, 'players', playerId);

    const [gameSnap, baseTileSnap, playerSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(baseTileRef),
      transaction.get(playerRef),
    ]);
    if (!gameSnap.exists() || !baseTileSnap.exists() || !playerSnap.exists()) {
      throw new Error('Game state changed. Try again.');
    }

    const game = { id: gameSnap.id, ...gameSnap.data() } as GameDoc;
    const baseTile = { id: baseTileSnap.id, ...baseTileSnap.data() } as TileDoc;
    const player = { id: playerSnap.id, ...playerSnap.data() } as PlayerDoc;

    if (!canPlayerActInGame(game, playerId)) throw new Error(actionUnavailableMessage(game, 'You can only upgrade during your turn.'));
    if (!baseTile.base || baseTile.base.ownerId !== playerId) throw new Error('You do not control that base.');

    const currentBase = baseTile.base;
    const allTilesSnapshot = await getDocs(collection(db, 'games', gameId, 'tiles'));
    const allTiles = allTilesSnapshot.docs.map((tileDoc) => ({ id: tileDoc.id, ...tileDoc.data() }) as TileDoc);
    const allArmiesSnapshot = await getDocs(collection(db, 'games', gameId, 'armies'));
    const allArmies = allArmiesSnapshot.docs.map((armyDoc) => ({ id: armyDoc.id, ...armyDoc.data() }) as ArmyDoc);
    const effectiveBaseTiles = allTiles.map((tile) => (tile.id === baseTile.id ? baseTile : tile));
    const sharedBarracksLevel = effectiveBarracksLevel(baseTile, effectiveBaseTiles, allArmies);
    const nextBase = { ...currentBase, unitQualityByType: { ...(currentBase.unitQualityByType ?? {}) } };
    let cost = 0;
    let message = '';

    if (upgradeType === 'barracks') {
      const nextConfig = UPGRADE_CONFIG.barracks.find((level) => level.level === currentBase.barracksLevel + 1);
      if (!nextConfig?.cost) throw new Error('Barracks are already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.barracksLevel = nextConfig.level;
      message = `Barracks upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'defense') {
      const nextConfig = UPGRADE_CONFIG.baseDefense.find((level) => level.level === currentBase.defenseLevel + 1);
      if (!nextConfig?.cost) throw new Error('Base defense is already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.defenseLevel = nextConfig.level;
      message = `Base defense upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'offense') {
      const currentOffenseLevel = currentBase.offenseLevel ?? 1;
      const nextConfig = UPGRADE_CONFIG.baseOffense.find((level) => level.level === currentOffenseLevel + 1);
      if (!nextConfig?.cost) throw new Error('Base sentry is already at max level.');
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.offenseLevel = nextConfig.level;
      message = `Base sentry upgraded to L${nextConfig.level}.`;
    }

    if (upgradeType === 'quality') {
      if (!unitTypeId) throw new Error('Choose a squad quality to upgrade.');
      if (!isUnitUnlocked(unitTypeId, sharedBarracksLevel)) {
        throw new Error(`${UNIT_TYPES[unitTypeId].name} is not unlocked here.`);
      }
      const currentQuality = currentBase.unitQualityByType?.[unitTypeId] ?? currentBase.unitQualityLevel ?? 1;
      const nextConfig = UPGRADE_CONFIG.unitQuality.find((level) => level.level === currentQuality + 1);
      if (!nextConfig?.cost) throw new Error(`${UNIT_TYPES[unitTypeId].name} quality is already maxed.`);
      cost = upgradeCostForPlayer(nextConfig.cost, player);
      nextBase.unitQualityByType![unitTypeId] = nextConfig.level;
      message = `${UNIT_TYPES[unitTypeId].name} quality upgraded to L${nextConfig.level}.`;
    }

    if (player.supplies < cost) throw new Error(`You need ${cost} supplies for that upgrade.`);

    transaction.update(baseTileRef, { base: nextBase });
    transaction.update(playerRef, {
      supplies: player.supplies - cost,
      ...applyXp(player, XP_UPGRADE_BASE),
    });

    return `${message} Spent ${cost} supplies. +${XP_UPGRADE_BASE} XP.`;
  });
}

function makeOwnedBase(ownerId: string) {
  return {
    ownerId,
    barracksLevel: 1,
    unitQualityLevel: 1,
    defenseLevel: 1,
    ruined: false,
    previousOwnerId: ownerId,
  };
}

function ruinBase(base: TileDoc['base']) {
  if (!base) return null;
  return {
    ...base,
    ownerId: null,
    ruined: true,
    previousOwnerId: base.previousOwnerId ?? base.ownerId ?? null,
  };
}

function reclaimBaseCost(base: NonNullable<TileDoc['base']>) {
  return RECLAIM_BASE_FLAT_COST + Math.ceil(totalBaseUpgradeInvestment(base) * RECLAIM_BASE_UPGRADE_COST_RATE);
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

function unitCostForPlayer(baseCost: number, player: PlayerDoc) {
  const productionDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - productionDiscount)));
}

function upgradeCostForPlayer(baseCost: number, player: PlayerDoc) {
  const engineeringDiscount = (player.talents.quartermaster ?? 0) * 0.05;
  return Math.max(1, Math.ceil(baseCost * (1 - engineeringDiscount)));
}

function makeUnit(typeId: keyof typeof UNIT_TYPES, qualityBonus = 0): UnitInstance {
  const type = UNIT_TYPES[typeId];
  const qualityHealthBonus = ARTILLERY_UNIT_TYPES.has(typeId) ? 0 : qualityBonus * QUALITY_HEALTH_BONUS_PER_LEVEL;
  return {
    id: `${typeId}_${crypto.randomUUID()}`,
    typeId,
    attack: type.attack + qualityBonus,
    defense: type.defense + qualityBonus,
    qualityLevel: 1 + qualityBonus,
    level: 1,
    xp: 0,
    maxHealth: type.space + qualityHealthBonus,
    currentHealth: type.space + qualityHealthBonus,
  };
}

function normalizeGameSetup(setup: GameSetupOptions) {
  const normalizedTurnLimit = normalizeTurnLimit(setup.turnLimitRounds);
  if (setup.mode === 'timed-simultaneous') {
    const duration = Number(setup.roundDurationSeconds ?? 60);
    return {
      mode: 'timed-simultaneous' as const,
      roundDurationSeconds: [30, 45, 60, 90, 120].includes(duration) ? duration : 60,
      turnLimitRounds: normalizedTurnLimit,
    };
  }

  return {
    mode: 'turn-based' as const,
    roundDurationSeconds: null,
    turnLimitRounds: normalizedTurnLimit,
  };
}

function isSimultaneousGame(game: Pick<GameDoc, 'mode'>) {
  return game.mode === 'timed-simultaneous';
}

function artilleryAttackFlatBonus(
  attacker: ArmyDoc,
  defender: ArmyDoc | null,
  defendingBase: TileDoc['base'],
  targetTile: TileDoc,
) {
  if (!isSoloArtilleryArmy(attacker)) return 0;
  const artilleryType = attacker.units[0]?.typeId;
  if (artilleryType === 'lightArtillery' && defender) return 2;
  if (
    artilleryType === 'siegeArtillery' &&
    (defendingBase || targetTile.trench || (defender?.fortifyTurnsRemaining ?? 0) > 0)
  ) {
    return 4;
  }
  return 0;
}

function activeSmokeOnTile(tile: TileDoc, roundNumber: number) {
  return Boolean(tile.smoke && tile.smoke.expiresRound >= roundNumber);
}

function smokeAreaTiles(originTile: TileDoc, tiles: TileDoc[]) {
  const areaIds = new Set([
    originTile.id,
    tileIdFromCoords(originTile.x + 1, originTile.y),
    tileIdFromCoords(originTile.x, originTile.y + 1),
    tileIdFromCoords(originTile.x + 1, originTile.y + 1),
  ]);
  return tiles.filter((tile) => areaIds.has(tile.id));
}

function resolveSentryMoveExchange(
  game: GameDoc,
  player: PlayerDoc,
  army: ArmyDoc,
  path: TileDoc[],
  movedUnits: UnitInstance[],
  tiles: TileDoc[],
) {
  const trigger =
    movedUnits.length > 0
      ? path
          .map((tile) => ({ tile, sentryAttack: strongestSentryAttackAgainst(tile, army.ownerId, tiles, game.turnNumber) }))
          .find((entry) => entry.sentryAttack)
      : null;
  const sentryAttack = trigger?.sentryAttack ?? null;
  const sentryDamage = (sentryAttack?.offenseConfig.damage ?? 0) * 10;
  const afterSentry =
    sentryAttack && sentryAttack.offenseConfig.damage > 0
      ? removeUnitLosses(movedUnits, sentryAttack.offenseConfig.damage, 'defender')
      : movedUnits;
  const returnFireArmy = { ...army, units: afterSentry, hasActedThisTurn: false };
  const canReturnFire = Boolean(
    sentryAttack &&
      afterSentry.length > 0 &&
      trigger &&
      isTileInAttackRange(returnFireArmy, trigger.tile, sentryAttack.tile, tiles),
  );
  const returnFireCombat =
    canReturnFire && sentryAttack?.tile.base
      ? resolveCombat(
          afterSentry,
          [],
          sentryAttack.tile.terrainType,
          sentryAttack.tile.base,
          1 + (player.talents.attackTraining ?? 0) * 0.05,
          1,
          0,
          trigger?.tile.trench ? TRENCH_ATTACK_BONUS : 0,
        )
      : null;

  return {
    sentryAttack,
    triggerTile: trigger?.tile ?? null,
    sentryDamage,
    finalUnits: afterSentry,
    returnFirePower: returnFireCombat?.attackPower ?? 0,
    baseDestroyed: Boolean(returnFireCombat?.baseDestroyed),
  };
}

function movementDebugLines({
  fromTile,
  targetTile,
  path,
  army,
  triggeredMineTile,
  mineTriggers,
  mineDamage,
  sentryAttack,
  sentryDamage,
  sentryTriggerTile,
  sentryReturnFirePower,
  sentryBaseDestroyed,
  unitsLost,
}: {
  fromTile: TileDoc;
  targetTile: TileDoc;
  path: TileDoc[];
  army: ArmyDoc;
  triggeredMineTile: TileDoc | null;
  mineTriggers: boolean;
  mineDamage: number;
  sentryAttack: ReturnType<typeof strongestSentryAttackAgainst> | null;
  sentryDamage: number;
  sentryTriggerTile: TileDoc | null;
  sentryReturnFirePower: number;
  sentryBaseDestroyed: boolean;
  unitsLost: number;
}) {
  const hasTank = army.units.some((unit) => unit.typeId === 'tank');
  const pathText = path.length > 0 ? path.map((tile) => `${tile.x},${tile.y}`).join(' -> ') : `${targetTile.x},${targetTile.y}`;
  const mineText = triggeredMineTile
    ? `mine=${triggeredMineTile.x},${triggeredMineTile.y} enemy, tank=${hasTank ? 'yes' : 'no'}, triggered=${mineTriggers ? 'yes' : 'no'}, damage=${mineTriggers ? mineDamage : 0}`
    : `mine=none on crossed path, tank=${hasTank ? 'yes' : 'no'}`;
  const sentryText = sentryAttack
    ? `sentry=${sentryAttack.tile.x},${sentryAttack.tile.y} L${sentryAttack.offenseConfig.level}, trigger=${sentryTriggerTile?.x},${sentryTriggerTile?.y}, damage=${sentryDamage}, returnFire=${sentryReturnFirePower}, baseDestroyed=${sentryBaseDestroyed ? 'yes' : 'no'}`
    : 'sentry=none';

  return [
    `Move debug: ${fromTile.x},${fromTile.y} -> ${targetTile.x},${targetTile.y}; path ${pathText}.`,
    `Move damage check: ${mineText}; ${sentryText}; squads lost=${unitsLost}.`,
  ];
}

function strongestSentryAttackAgainst(targetTile: TileDoc, movingPlayerId: string, tiles: TileDoc[], turnNumber: number) {
  return tiles
    .filter((tile) => tile.base && !tile.base.ruined && tile.base.ownerId && tile.base.ownerId !== movingPlayerId)
    .map((tile) => {
      const offenseConfig = UPGRADE_CONFIG.baseOffense.find((level) => level.level === (tile.base!.offenseLevel ?? 1));
      return { tile, offenseConfig };
    })
    .filter(
      (entry): entry is { tile: TileDoc; offenseConfig: (typeof UPGRADE_CONFIG.baseOffense)[number] } =>
        Boolean(
          entry.offenseConfig &&
            entry.offenseConfig.damage > 0 &&
            (entry.tile.base!.lastSentryTurnNumber ?? -1) !== turnNumber &&
            chebyshevDistance(entry.tile, targetTile) <= entry.offenseConfig.range &&
            hasLineOfSight(entry.tile, targetTile, tiles),
        ),
    )
    .sort((a, b) => b.offenseConfig.damage - a.offenseConfig.damage || chebyshevDistance(a.tile, targetTile) - chebyshevDistance(b.tile, targetTile))[0] ?? null;
}

function canPlayerActInGame(game: GameDoc, playerId: string) {
  return game.status === 'active' && !game.isPaused && (isSimultaneousGame(game) ? true : game.currentTurnPlayerId === playerId);
}

function actionUnavailableMessage(game: GameDoc, turnBasedMessage: string) {
  if (game.isPaused) return 'Gameplay is paused by the host.';
  return isSimultaneousGame(game) ? 'This round is not accepting actions right now.' : turnBasedMessage;
}

function nextRoundEndsAtMs(roundDurationSeconds: number | null | undefined) {
  return Date.now() + Math.max(15, roundDurationSeconds ?? 60) * 1000;
}
