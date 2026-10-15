import type { GameConfig, GamePhase, GameState, Payout, Player, PlayerAction } from "./types";

export const MAX_PLAYERS = 10;

export interface PotAllocation {
    amount: number;
    eligiblePlayerIds: string[];
}

export function createInitialGameState(
    config: GameConfig,
    hostPlayerName: string,
    hostPeerId: string,
): GameState {
    return {
        players: [createPlayer(hostPeerId, hostPlayerName, config.startingChips)],
        hostId: hostPeerId,
        dealerId: hostPeerId,
        smallBlindId: null,
        bigBlindId: null,
        currentPlayerId: null,
        phase: "waiting",
        pot: 0,
        currentBet: 0,
        minRaise: config.bigBlind,
        round: 0,
        communityCards: [],
        revealedHands: [],
        config,
        statusMessage: "Waiting for players",
        lastPayouts: [],
    };
}

/** Community cards dealt when betting on `phase` completes. */
export function communityCardsAfter(phase: GamePhase): number {
    if (phase === "preflop") return 3;
    return phase === "flop" || phase === "turn" ? 1 : 0;
}

export function getValidActions(state: GameState, player: Player): PlayerAction[] {
    if (
        !player.isActive ||
        player.hasFolded ||
        player.chips <= 0 ||
        player.id !== state.currentPlayerId ||
        state.phase === "waiting" ||
        state.phase === "showdown"
    ) {
        return [];
    }

    const actions: PlayerAction[] = ["fold"];
    const toCall = Math.max(0, state.currentBet - player.currentBet);

    if (toCall === 0) {
        actions.push("check");
    } else {
        actions.push("call");
    }

    if (!player.hasActed && player.chips >= toCall + state.minRaise) {
        actions.push("raise");
    }

    if (player.chips <= toCall || !player.hasActed) {
        actions.push("allin");
    }

    return actions;
}

export function processAction(
    state: GameState,
    playerId: string,
    action: PlayerAction,
    amount?: number,
): boolean {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player) {
        return false;
    }

    const validActions = getValidActions(state, player);
    if (!validActions.includes(action)) {
        return false;
    }

    let increasedBet = false;
    let reopensBetting = false;

    switch (action) {
        case "fold":
            player.hasFolded = true;
            player.hasActed = true;
            break;
        case "check":
            player.hasActed = true;
            break;
        case "call": {
            const toCall = Math.max(0, state.currentBet - player.currentBet);
            contributeChips(state, player, Math.min(toCall, player.chips));
            player.hasActed = true;
            break;
        }
        case "raise": {
            const targetBet = amount ?? 0;
            const raiseContribution = targetBet - player.currentBet;
            if (
                !Number.isSafeInteger(targetBet) ||
                targetBet < state.currentBet + state.minRaise ||
                raiseContribution > player.chips
            ) {
                return false;
            }
            const previousBet = state.currentBet;
            contributeChips(state, player, raiseContribution);
            player.hasActed = true;
            state.minRaise = player.currentBet - previousBet;
            state.currentBet = player.currentBet;
            increasedBet = true;
            reopensBetting = true;
            break;
        }
        case "allin": {
            const previousBet = state.currentBet;
            contributeChips(state, player, player.chips);
            player.hasActed = true;
            if (player.currentBet > previousBet) {
                const raiseSize = player.currentBet - previousBet;
                state.currentBet = player.currentBet;
                increasedBet = true;
                if (raiseSize >= state.minRaise) {
                    state.minRaise = raiseSize;
                    reopensBetting = true;
                }
            }
            break;
        }
    }

    if (increasedBet) {
        for (const otherPlayer of state.players) {
            if (
                otherPlayer.id === player.id ||
                !otherPlayer.isActive ||
                otherPlayer.hasFolded ||
                otherPlayer.chips <= 0
            ) {
                continue;
            }
            if (
                reopensBetting ||
                (otherPlayer.hasActed &&
                    state.currentBet - otherPlayer.actedAtBet >= state.minRaise)
            ) {
                otherPlayer.hasActed = false;
            }
        }
    }
    player.actedAtBet = state.currentBet;

    if (getActivePlayerCount(state.players) <= 1) {
        const winner = state.players.find((entry) => entry.isActive && !entry.hasFolded);
        if (winner) {
            applyPayouts(state, [{ playerId: winner.id, amount: state.pot }]);
        }
        return true;
    }

    state.currentPlayerId = getNextPlayerId(state.players, playerId) ?? state.currentPlayerId;
    state.statusMessage = `${player.name} ${describeAction(action, amount)}`;
    return true;
}

export function startNewHand(state: GameState): void {
    state.phase = "waiting";
    state.pot = 0;
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;
    state.round += 1;
    state.communityCards = [];
    state.revealedHands = [];
    state.lastPayouts = [];
    state.currentPlayerId = null;

    for (const player of state.players) {
        player.isActive = player.chips > 0;
        player.hasFolded = false;
        player.hasActed = false;
        player.actedAtBet = 0;
        player.handContribution = 0;
        player.currentBet = 0;
    }

    const activePlayers = state.players.filter((player) => player.isActive);
    if (activePlayers.length < 2) {
        state.statusMessage = "Need at least 2 players with chips to start a hand";
        return;
    }

    if (state.config.ante > 0) {
        for (const player of activePlayers) {
            contributeChips(state, player, Math.min(state.config.ante, player.chips));
        }
    }

    moveBlinds(state);
    postBlinds(state);

    state.phase = "preflop";
    state.currentPlayerId = getNextPlayerId(state.players, state.bigBlindId);
    state.statusMessage = `Hand ${state.round}`;
}

export function advancePhase(state: GameState): void {
    if (state.phase === "waiting" || state.phase === "showdown") {
        return;
    }

    for (const player of state.players) {
        player.currentBet = 0;
        player.hasActed = false;
        player.actedAtBet = 0;
    }
    state.currentPlayerId = null;
    state.currentBet = 0;
    state.minRaise = state.config.bigBlind;

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
            state.statusMessage = "Showdown";
            return;
    }

    state.currentPlayerId = getNextPlayerId(state.players, state.dealerId);
    state.statusMessage = `${capitalize(state.phase)} betting`;
}

export function isBettingRoundComplete(state: GameState): boolean {
    if (state.phase === "waiting" || state.phase === "showdown") {
        return false;
    }

    const activePlayers = state.players.filter((player) => player.isActive && !player.hasFolded);
    const playersWhoCanAct = activePlayers.filter((player) => player.chips > 0);
    if (playersWhoCanAct.length === 0) return true;
    if (playersWhoCanAct.length === 1) {
        return playersWhoCanAct[0]!.currentBet === state.currentBet;
    }
    return activePlayers.every((player) => {
        if (player.chips === 0) {
            return true;
        }
        return player.hasActed && player.currentBet === state.currentBet;
    });
}

export function addPlayer(state: GameState, name: string, peerId: string): Player | null {
    if (state.players.length >= MAX_PLAYERS) {
        return null;
    }

    const player = createPlayer(peerId, name, state.config.startingChips);
    state.players.push(player);
    return player;
}

export function removePlayer(state: GameState, playerId: string): void {
    const index = state.players.findIndex((player) => player.id === playerId);
    if (index >= 0) {
        state.players.splice(index, 1);
    }
}

export function applyPayouts(
    state: GameState,
    payouts: Array<{ playerId: string; amount: number }>,
): boolean {
    if (payouts.length === 0) {
        return false;
    }

    const total = payouts.reduce((sum, payout) => sum + payout.amount, 0);
    const playersById = new Map(state.players.map((player) => [player.id, player]));
    if (
        total !== state.pot ||
        payouts.some(
            (payout) =>
                !Number.isSafeInteger(payout.amount) ||
                payout.amount < 0 ||
                !playersById.has(payout.playerId),
        )
    ) {
        return false;
    }

    const recordedPayouts: Payout[] = [];
    for (const payout of payouts) {
        const player = playersById.get(payout.playerId)!;
        player.chips += payout.amount;
        recordedPayouts.push({
            playerId: player.id,
            playerName: player.name,
            amount: payout.amount,
        });
    }

    state.currentPlayerId = null;
    state.phase = "showdown";
    state.currentBet = 0;
    state.lastPayouts = recordedPayouts;
    state.statusMessage = recordedPayouts
        .map((payout) => `${payout.playerName} wins ${payout.amount}`)
        .join(" • ");
    state.pot = 0;
    return true;
}

export function calculatePotAllocations(state: GameState): PotAllocation[] {
    const thresholds = [
        ...new Set(
            state.players.map((player) => player.handContribution).filter((amount) => amount > 0),
        ),
    ].sort((a, b) => a - b);
    const pots: PotAllocation[] = [];
    let previous = 0;

    for (const threshold of thresholds) {
        const contributors = state.players.filter((player) => player.handContribution >= threshold);
        const amount = (threshold - previous) * contributors.length;
        if (amount > 0) {
            pots.push({
                amount,
                eligiblePlayerIds: contributors
                    .filter((player) => !player.hasFolded)
                    .map((player) => player.id),
            });
        }
        previous = threshold;
    }

    return pots;
}

export function applyPotWinners(state: GameState, winnersByPot: string[][]): boolean {
    const pots = calculatePotAllocations(state);
    if (pots.length === 0 || pots.length !== winnersByPot.length) {
        return false;
    }

    const payoutTotals = new Map<string, number>();

    for (let index = 0; index < pots.length; index++) {
        const pot = pots[index]!;
        const winners = [...new Set(winnersByPot[index] || [])];
        if (winners.length === 0) {
            return false;
        }
        if (winners.some((playerId) => !pot.eligiblePlayerIds.includes(playerId))) {
            return false;
        }

        const share = Math.floor(pot.amount / winners.length);
        let remainder = pot.amount % winners.length;
        for (const playerId of winners) {
            payoutTotals.set(
                playerId,
                (payoutTotals.get(playerId) || 0) + share + (remainder > 0 ? 1 : 0),
            );
            if (remainder > 0) {
                remainder -= 1;
            }
        }
    }

    return applyPayouts(
        state,
        Array.from(payoutTotals.entries()).map(([playerId, amount]) => ({ playerId, amount })),
    );
}

function getNextPlayerId(players: Player[], fromPlayerId: string | null): string | null {
    const fromIndex = players.findIndex((player) => player.id === fromPlayerId);
    for (let offset = 1; offset <= players.length; offset++) {
        const player = players[(fromIndex + offset) % players.length]!;
        if (player.isActive && !player.hasFolded && player.chips > 0) {
            return player.id;
        }
    }
    return null;
}

function getActivePlayerCount(players: Player[]): number {
    return players.filter((player) => player.isActive && !player.hasFolded).length;
}

/** Moves the button to the next active seat after the previous dealer, then assigns blinds. */
function moveBlinds(state: GameState): void {
    const dealerIndex = state.players.findIndex((player) => player.id === state.dealerId);
    const seats = [
        ...state.players.slice(dealerIndex + 1),
        ...state.players.slice(0, dealerIndex + 1),
    ]
        .filter((player) => player.isActive)
        .map((player) => player.id);
    const headsUp = seats.length === 2;

    state.dealerId = seats[0]!;
    state.smallBlindId = headsUp ? seats[0]! : seats[1]!;
    state.bigBlindId = headsUp ? seats[1]! : seats[2]!;
}

function postBlinds(state: GameState): void {
    const smallBlind = state.players.find((player) => player.id === state.smallBlindId)!;
    const bigBlind = state.players.find((player) => player.id === state.bigBlindId)!;
    contributeChips(state, smallBlind, Math.min(state.config.smallBlind, smallBlind.chips));
    contributeChips(state, bigBlind, Math.min(state.config.bigBlind, bigBlind.chips));
    state.currentBet = Math.max(smallBlind.currentBet, bigBlind.currentBet, state.config.bigBlind);
}

function createPlayer(id: string, name: string, chips: number): Player {
    return {
        id,
        name,
        chips,
        isActive: true,
        hasFolded: false,
        hasActed: false,
        actedAtBet: 0,
        handContribution: 0,
        currentBet: 0,
    };
}

function contributeChips(state: GameState, player: Player, amount: number): void {
    if (amount <= 0) {
        return;
    }
    player.chips -= amount;
    player.currentBet += amount;
    player.handContribution += amount;
    state.pot += amount;
}

function describeAction(action: PlayerAction, amount?: number): string {
    if (action === "raise" && amount) {
        return `raises to ${amount}`;
    }
    return action;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
