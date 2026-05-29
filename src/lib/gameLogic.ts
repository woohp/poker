import type { GameConfig, GamePhase, GameState, Player, PlayerAction } from "./types";

const STORAGE_KEY = "poker_game_state";
const SESSION_KEY = "poker_session";

export interface SessionData {
    localPlayerId: string;
    isHost: boolean;
    roomCode: string;
    playerName: string;
}

export function saveSession(data: SessionData): void {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (error) {
        console.error("Failed to save session:", error);
    }
}

export function loadSession(): SessionData | null {
    try {
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved) {
            return JSON.parse(saved) as SessionData;
        }
    } catch (error) {
        console.error("Failed to load session:", error);
    }
    return null;
}

export function clearSession(): void {
    localStorage.removeItem(SESSION_KEY);
}

export function createInitialGameState(config: GameConfig, hostPlayerName: string, hostPeerId: string): GameState {
    const host: Player = {
        id: hostPeerId,
        name: hostPlayerName,
        chips: config.startingChips,
        isActive: true,
        hasFolded: false,
        currentBet: 0,
        isDealer: true,
        isSmallBlind: false,
        isBigBlind: false,
        isHost: true,
        isCurrentTurn: false,
    };

    return {
        players: [host],
        phase: "waiting",
        pot: 0,
        currentBet: 0,
        minRaise: config.bigBlind,
        round: 0,
        deck: [],
        communityCards: [],
        config,
    };
}

export function saveGameState(state: GameState): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error("Failed to save game state:", error);
    }
}

export function loadGameState(): GameState | null {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved) as GameState;
        }
    } catch (error) {
        console.error("Failed to load game state:", error);
    }
    return null;
}

export function clearGameState(): void {
    localStorage.removeItem(STORAGE_KEY);
}

// Game logic helpers
export function getNextPlayerIndex(players: Player[], currentIndex: number): number {
    const count = players.length;
    for (let i = 1; i <= count; i++) {
        const idx = (currentIndex + i) % count;
        const player = players[idx];
        if (player.isActive && !player.hasFolded) {
            return idx;
        }
    }
    return -1;
}

export function getActivePlayerCount(players: Player[]): number {
    return players.filter((p) => p.isActive && !p.hasFolded).length;
}

export function getCurrentPlayerIndex(players: Player[]): number {
    return players.findIndex((p) => p.isCurrentTurn);
}

export function setCurrentPlayer(players: Player[], playerId: string): void {
    for (const player of players) {
        player.isCurrentTurn = player.id === playerId;
    }
}

export function resetBets(players: Player[]): void {
    for (const player of players) {
        player.currentBet = 0;
    }
}

export function moveBlinds(players: Player[]): void {
    if (players.length < 2) return;

    // Find current dealer
    const dealerIndex = players.findIndex((p) => p.isDealer);
    const nextDealerIndex = (dealerIndex + 1) % players.length;

    // Reset all
    for (const player of players) {
        player.isDealer = false;
        player.isSmallBlind = false;
        player.isBigBlind = false;
    }

    // Set new positions
    players[nextDealerIndex].isDealer = true;

    if (players.length === 2) {
        // Heads-up: dealer is small blind
        players[nextDealerIndex].isSmallBlind = true;
        players[nextDealerIndex].isBigBlind = true;
    } else {
        const sbIndex = (nextDealerIndex + 1) % players.length;
        const bbIndex = (nextDealerIndex + 2) % players.length;
        players[sbIndex].isSmallBlind = true;
        players[bbIndex].isBigBlind = true;
    }
}

export function postBlinds(state: GameState): void {
    const sbPlayer = state.players.find((p) => p.isSmallBlind);
    const bbPlayer = state.players.find((p) => p.isBigBlind);

    if (sbPlayer) {
        const sbAmount = Math.min(state.config.smallBlind, sbPlayer.chips);
        sbPlayer.chips -= sbAmount;
        sbPlayer.currentBet = sbAmount;
        state.pot += sbAmount;
    }

    if (bbPlayer) {
        const bbAmount = Math.min(state.config.bigBlind, bbPlayer.chips);
        bbPlayer.chips -= bbAmount;
        bbPlayer.currentBet = bbAmount;
        state.pot += bbAmount;
    }

    state.currentBet = state.config.bigBlind;
    state.minRaise = state.config.bigBlind;
}

export function getValidActions(state: GameState, player: Player): PlayerAction[] {
    if (!player.isActive || player.hasFolded || !player.isCurrentTurn) {
        return [];
    }

    const actions: PlayerAction[] = ["fold"];

    // Can check if no bet to call
    if (player.currentBet >= state.currentBet) {
        actions.push("check");
    } else {
        actions.push("call");
    }

    // Can raise if has chips left
    const toCall = state.currentBet - player.currentBet;
    const minRaiseAmount = state.currentBet + state.minRaise;
    if (player.chips > toCall) {
        actions.push("raise");
    }

    // Can all-in
    actions.push("allin");

    return actions;
}

export function processAction(state: GameState, playerId: string, action: PlayerAction, amount?: number): boolean {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.isCurrentTurn) {
        return false;
    }

    const validActions = getValidActions(state, player);
    if (!validActions.includes(action)) {
        return false;
    }

    switch (action) {
        case "fold":
            player.hasFolded = true;
            break;

        case "check":
            // No action needed
            break;

        case "call": {
            const toCall = state.currentBet - player.currentBet;
            const callAmount = Math.min(toCall, player.chips);
            player.chips -= callAmount;
            player.currentBet += callAmount;
            state.pot += callAmount;
            break;
        }

        case "raise": {
            if (!amount || amount < state.currentBet + state.minRaise) {
                return false;
            }
            const raiseAmount = Math.min(amount - player.currentBet, player.chips);
            player.chips -= raiseAmount;
            player.currentBet += raiseAmount;
            state.pot += raiseAmount;
            state.minRaise = raiseAmount;
            state.currentBet = player.currentBet;
            break;
        }

        case "allin": {
            const allInAmount = player.chips;
            player.chips = 0;
            player.currentBet += allInAmount;
            state.pot += allInAmount;

            if (player.currentBet > state.currentBet) {
                state.minRaise = player.currentBet - state.currentBet;
                state.currentBet = player.currentBet;
            }
            break;
        }
    }

    // Move to next player
    const currentIndex = state.players.findIndex((p) => p.id === playerId);
    const nextIndex = getNextPlayerIndex(state.players, currentIndex);

    if (nextIndex >= 0) {
        setCurrentPlayer(state.players, state.players[nextIndex].id);
    }

    saveGameState(state);
    return true;
}

export function startNewHand(state: GameState): void {
    // Reset for new hand
    for (const player of state.players) {
        player.hasFolded = false;
        player.currentBet = 0;
        player.isCurrentTurn = false;
    }

    state.pot = 0;
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    state.phase = "preflop";
    state.round += 1;

    // Move blinds
    moveBlinds(state.players);

    // Post blinds
    postBlinds(state);

    // Set first player (after big blind)
    const bbIndex = state.players.findIndex((p) => p.isBigBlind);
    const firstToAct = getNextPlayerIndex(state.players, bbIndex);
    if (firstToAct >= 0) {
        setCurrentPlayer(state.players, state.players[firstToAct].id);
    }

    saveGameState(state);
}

export function advancePhase(state: GameState): void {
    // Reset bets for new phase
    resetBets(state.players);
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;

    // Clear current turn
    for (const player of state.players) {
        player.isCurrentTurn = false;
    }

    switch (state.phase) {
        case "preflop":
            state.phase = "flop";
            break;
        case "flop":
            state.phase = "turn";
            break;
        case "turn":
            state.phase = "river";
            break;
        case "river":
            state.phase = "showdown";
            break;
        default:
            return;
    }

    // Find first active player after dealer
    const dealerIndex = state.players.findIndex((p) => p.isDealer);
    const firstToAct = getNextPlayerIndex(state.players, dealerIndex);
    if (firstToAct >= 0) {
        setCurrentPlayer(state.players, state.players[firstToAct].id);
    }

    saveGameState(state);
}

export function isBettingRoundComplete(state: GameState): boolean {
    const activePlayers = state.players.filter((p) => p.isActive && !p.hasFolded);

    // Check if all active players have matched the current bet or are all-in
    return activePlayers.every((p) => p.currentBet === state.currentBet || p.chips === 0);
}

export function addPlayer(state: GameState, name: string, peerId: string): Player | null {
    if (state.players.length >= 10) {
        return null;
    }

    const player: Player = {
        id: peerId,
        name,
        chips: state.config.startingChips,
        isActive: true,
        hasFolded: false,
        currentBet: 0,
        isDealer: false,
        isSmallBlind: false,
        isBigBlind: false,
        isHost: false,
        isCurrentTurn: false,
    };

    state.players.push(player);
    saveGameState(state);
    return player;
}

export function removePlayer(state: GameState, playerId: string): void {
    const index = state.players.findIndex((p) => p.id === playerId);
    if (index >= 0) {
        state.players.splice(index, 1);
        saveGameState(state);
    }
}
