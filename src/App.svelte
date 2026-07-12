<script lang="ts">
import QRCode from "qrcode";
import { onDestroy, onMount } from "svelte";
import {
    addPlayer,
    advancePhase,
    applyPotWinners,
    calculatePotAllocations,
    clearSession,
    createInitialGameState,
    getValidActions,
    isBettingRoundComplete,
    loadGameState,
    loadSession,
    processAction,
    removePlayer,
    saveGameState,
    saveSession,
    startNewHand,
} from "./lib/gameLogic";
import { getStablePeerId, loadStablePeerId, resetStablePeerId } from "./lib/peerIdentity";
import { PeerManager } from "./lib/peerManager";
import { navigate, parseRoute, type Route } from "./lib/router";
import type { GameConfig, GameState, PeerMessage, Player } from "./lib/types";

let route: Route = $state({ name: "home" });
let isLoading = $state(false);
let peerManager: PeerManager | null = $state(null);
let gameState: GameState | null = $state(null);
let playerName = $state("");
let joinCode = $state("");
let roomCode = $state("");
let errorMessage = $state("");
let qrCanvas: HTMLCanvasElement | null = $state(null);

let startingChips = $state(1000);
let smallBlind = $state(5);
let bigBlind = $state(10);
let ante = $state(0);

let isHost = $state(false);
let localPlayerId = $state("");
let raiseAmount = $state(0);
let copySuccess = $state(false);
let showdownSelections: Record<number, string[]> = $state({});
let autoCheckRequested = $state(false);

onMount(() => {
    function syncRoute() {
        route = parseRoute(window.location.hash);
        if (route.name === "join" && route.roomCode) {
            joinCode = route.roomCode;
        }
    }

    function cleanupListeners() {
        window.removeEventListener("hashchange", syncRoute);
        window.removeEventListener("popstate", syncRoute);
        window.removeEventListener("pagehide", announceDeparture);
    }

    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("pagehide", announceDeparture);

    const saved = loadGameState();
    const session = loadSession();
    const savedPeerId = loadStablePeerId();

    if (route.name === "join" && route.roomCode) {
        clearSession();
        resetStablePeerId();
        joinCode = route.roomCode;
        navigate({ name: "join", roomCode: route.roomCode }, true);
        return cleanupListeners;
    }

    if (route.name === "room") {
        if (saved && session && savedPeerId && route.roomCode === session.roomCode) {
            gameState = saved;
            playerName = session.playerName;
            localPlayerId = savedPeerId;
            roomCode = session.roomCode;
            isHost = session.isHost;
            void restoreSession(session.roomCode, session.playerName, savedPeerId, session.isHost, saved);
        } else {
            joinCode = route.roomCode;
            navigate({ name: "join", roomCode: route.roomCode }, true);
        }
    }

    return cleanupListeners;
});

onDestroy(() => {
    disconnectPeerManager();
});

$effect(() => {
    if (!gameState || gameState.phase !== "showdown" || gameState.pot === 0) {
        if (Object.keys(showdownSelections).length > 0) {
            showdownSelections = {};
        }
        return;
    }

    const pots = calculatePotAllocations(gameState);
    const nextSelections: Record<number, string[]> = {};
    for (let index = 0; index < pots.length; index++) {
        nextSelections[index] = showdownSelections[index] || [];
    }

    const currentKeys = Object.keys(showdownSelections);
    const nextKeys = Object.keys(nextSelections);
    const changed =
        currentKeys.length !== nextKeys.length ||
        nextKeys.some((key) => JSON.stringify(showdownSelections[Number(key)] || []) !== JSON.stringify(nextSelections[Number(key)] || []));

    if (changed) {
        showdownSelections = nextSelections;
    }
});

$effect(() => {
    if (!autoCheckRequested) {
        return;
    }

    const me = getMyPlayer();
    if (!gameState || !me || !me.isActive || me.hasFolded || gameState.phase === "waiting" || gameState.phase === "showdown") {
        autoCheckRequested = false;
        return;
    }

    if (!me.isCurrentTurn && gameState.currentBet !== me.currentBet) {
        autoCheckRequested = false;
        return;
    }

    if (me.isCurrentTurn) {
        if (canPerformAction("check")) {
            autoCheckRequested = false;
            performAction("check");
            return;
        }

        autoCheckRequested = false;
    }
});

function announceDeparture() {
    peerManager?.announceDeparture();
}

function disconnectPeerManager() {
    peerManager?.disconnect();
    peerManager = null;
}

async function restoreSession(
    savedRoomCode: string,
    savedPlayerName: string,
    savedPeerId: string,
    savedIsHost: boolean,
    savedState: GameState,
) {
    disconnectPeerManager();
    peerManager = new PeerManager(handlePeerMessage, handleConnectionChange);

    try {
        if (savedIsHost) {
            await peerManager.createHost(savedPeerId, savedRoomCode);
            peerManager.broadcastState(savedState);
            setTimeout(() => generateQRCode(savedRoomCode), 100);
        } else {
            await peerManager.joinGame(savedRoomCode, savedPlayerName, savedPeerId);
        }
    } catch (_error) {
        errorMessage = "Failed to restore connection.";
    }
}

function handlePeerMessage(message: PeerMessage, fromPeerId: string) {
    if (isHost) {
        handleHostMessage(message, fromPeerId);
    } else {
        handleClientMessage(message, fromPeerId);
    }
}

function handleHostMessage(message: PeerMessage, fromPeerId: string) {
    if (!gameState) return;

    switch (message.type) {
        case "join": {
            const existing = gameState.players.find((p) => p.id === message.peerId);
            if (existing) {
                peerManager?.sendToPeer(fromPeerId, {
                    type: "joinResponse",
                    accepted: true,
                    playerId: existing.id,
                    state: gameState,
                });
                return;
            }

            if (gameState.players.length >= 10) {
                peerManager?.sendToPeer(fromPeerId, {
                    type: "joinResponse",
                    accepted: false,
                    message: "Game is full (max 10 players)",
                });
                return;
            }

            if (gameState.phase !== "waiting") {
                peerManager?.sendToPeer(fromPeerId, {
                    type: "joinResponse",
                    accepted: false,
                    message: "Game already in progress",
                });
                return;
            }

            const player = addPlayer(gameState, message.playerName, message.peerId);
            if (player) {
                peerManager?.sendToPeer(fromPeerId, {
                    type: "joinResponse",
                    accepted: true,
                    playerId: player.id,
                    state: gameState,
                });
                peerManager?.broadcastState(gameState);
                saveGameState(gameState);
            } else {
                peerManager?.sendToPeer(fromPeerId, {
                    type: "joinResponse",
                    accepted: false,
                    message: "Failed to add player",
                });
            }
            break;
        }

        case "action": {
            applyHostAction(message.playerId, message.action, message.amount);
            break;
        }
    }
}

function applyHostAction(playerId: string, action: "fold" | "check" | "call" | "raise" | "allin", amount?: number) {
    if (!gameState) {
        return;
    }

    if (!processAction(gameState, playerId, action, amount)) {
        return;
    }

    peerManager?.broadcastState(gameState);
    saveGameState(gameState);

    if (isBettingRoundComplete(gameState)) {
        setTimeout(() => {
            const gs = gameState;
            if (gs && gs.phase !== "showdown") {
                advancePhase(gs);
                peerManager?.broadcastState(gs);
                saveGameState(gs);
            }
        }, 1000);
    }
}

function handleClientMessage(message: PeerMessage, _fromPeerId: string) {
    switch (message.type) {
        case "state": {
            gameState = message.state;
            saveGameState(gameState);
            break;
        }
        case "joinResponse": {
            if (message.accepted && message.state && message.playerId) {
                gameState = message.state;
                localPlayerId = message.playerId;
                roomCode = joinCode.trim() || roomCode;
                isLoading = false;
                navigate({ name: "room", roomCode });
                saveGameState(gameState);
                saveSession({
                    isHost: false,
                    roomCode,
                    playerName,
                });
            } else {
                errorMessage = message.message || "Failed to join game";
                isLoading = false;
                disconnectPeerManager();
                navigate({ name: "join", roomCode: joinCode.trim() || undefined });
            }
            break;
        }
    }
}

function handleConnectionChange(peerId: string, connected: boolean) {
    if (connected || !isHost || !gameState) {
        return;
    }

    if (gameState.phase !== "waiting") {
        return;
    }

    removePlayer(gameState, peerId);
    peerManager?.broadcastState(gameState);
    saveGameState(gameState);
}

async function createGame() {
    if (!playerName.trim()) {
        errorMessage = "Please enter your name";
        return;
    }

    errorMessage = "";
    isLoading = true;
    peerManager = new PeerManager(handlePeerMessage, handleConnectionChange);
    isHost = true;

    try {
        const peerId = getStablePeerId();
        await peerManager.createHost(peerId);
        localPlayerId = peerId;
        roomCode = peerManager.getRoomCode();

        const config: GameConfig = { startingChips, smallBlind, bigBlind, ante };
        gameState = createInitialGameState(config, playerName, peerId);
        peerManager.broadcastState(gameState);
        saveGameState(gameState);
        saveSession({ isHost: true, roomCode, playerName });
        isLoading = false;
        navigate({ name: "room", roomCode });

        setTimeout(() => generateQRCode(roomCode), 100);
    } catch (_error) {
        errorMessage = "Failed to create game. Please try again.";
        isLoading = false;
        navigate({ name: "home" });
        isHost = false;
    }
}

async function generateQRCode(currentRoomCode: string) {
    if (!qrCanvas) return;
    const url = `${window.location.origin}${window.location.pathname}#/join/${encodeURIComponent(currentRoomCode)}`;
    try {
        await QRCode.toCanvas(qrCanvas, url, { width: 200, margin: 2 });
    } catch (_error) {
        console.error("Failed to generate QR code");
    }
}

async function joinGame() {
    if (!playerName.trim()) {
        errorMessage = "Please enter your name";
        return;
    }
    if (!joinCode.trim()) {
        errorMessage = "Please enter a join code";
        return;
    }

    errorMessage = "";
    isLoading = true;
    peerManager = new PeerManager(handlePeerMessage, handleConnectionChange);
    isHost = false;
    roomCode = joinCode.trim();

    try {
        const peerId = getStablePeerId();
        localPlayerId = peerId;
        await peerManager.joinGame(roomCode, playerName, peerId);
        setTimeout(() => {
            if (isLoading) {
                errorMessage = "Connection timed out. Please check the code and try again.";
                isLoading = false;
                navigate({ name: "join", roomCode });
                disconnectPeerManager();
            }
        }, 10000);
    } catch (_error) {
        errorMessage = "Failed to join game. Please check the code and try again.";
        isLoading = false;
        navigate({ name: "join", roomCode });
        disconnectPeerManager();
    }
}

function startGame() {
    if (!gameState || !isHost) return;
    if (gameState.players.length < 2) {
        errorMessage = "Need at least 2 players to start";
        return;
    }
    startNewHand(gameState);
    peerManager?.broadcastState(gameState);
    saveGameState(gameState);
}

function performAction(action: "fold" | "check" | "call" | "raise" | "allin") {
    if (!gameState) return;

    autoCheckRequested = false;
    const amount = action === "raise" ? raiseAmount : undefined;

    if (isHost) {
        applyHostAction(localPlayerId, action, amount);
        return;
    }

    const hostId = gameState.players.find((player) => player.isHost)?.id;
    if (hostId) {
        peerManager?.sendToPeer(hostId, {
            type: "action",
            playerId: localPlayerId,
            action,
            amount,
        });
    }
}

function getMyPlayer(): Player | null {
    if (!gameState) return null;
    return gameState.players.find((p) => p.id === localPlayerId) || null;
}

function canPerformAction(action: "fold" | "check" | "call" | "raise" | "allin"): boolean {
    const me = getMyPlayer();
    if (!me || !gameState) return false;
    return getValidActions(gameState, me).includes(action);
}

function calculateToCall(): number {
    const me = getMyPlayer();
    if (!me || !gameState) return 0;
    return gameState.currentBet - me.currentBet;
}

function canQueueCheck(): boolean {
    const me = getMyPlayer();
    if (!me || !gameState) {
        return false;
    }

    if (!me.isActive || me.hasFolded || me.isCurrentTurn || gameState.phase === "waiting" || gameState.phase === "showdown") {
        return false;
    }

    return gameState.currentBet === me.currentBet;
}

function toggleAutoCheck() {
    if (!canQueueCheck()) {
        autoCheckRequested = false;
        return;
    }

    autoCheckRequested = !autoCheckRequested;
}

function shouldShowWaitingCheck(): boolean {
    const me = getMyPlayer();
    if (!me || !gameState) {
        return false;
    }

    return me.isActive && !me.hasFolded && !me.isCurrentTurn && gameState.phase !== "waiting" && gameState.phase !== "showdown";
}

function calculateMinRaise(): number {
    if (!gameState) return 0;
    return gameState.currentBet + gameState.minRaise;
}

function showHostAdvanceButton(): boolean {
    if (!gameState || !isHost) {
        return false;
    }

    return gameState.phase === "showdown" && gameState.pot === 0;
}

function getOutcomePlayers(): Player[] {
    if (!gameState) {
        return [];
    }

    return gameState.players.filter((player) => player.isActive && !player.hasFolded);
}

function getPotAllocations() {
    if (!gameState) {
        return [];
    }
    return calculatePotAllocations(gameState);
}

function togglePotWinner(potIndex: number, playerId: string) {
    const current = showdownSelections[potIndex] || [];
    const next = current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId];
    showdownSelections = {
        ...showdownSelections,
        [potIndex]: next,
    };
}

function canRecordOutcome(): boolean {
    const pots = getPotAllocations();
    return pots.length > 0 && pots.every((_, index) => (showdownSelections[index] || []).length > 0);
}

function recordOutcome() {
    if (!gameState || !isHost) {
        return;
    }

    const winnersByPot = getPotAllocations().map((_, index) => showdownSelections[index] || []);
    if (!applyPotWinners(gameState, winnersByPot)) {
        errorMessage = "Select at least one eligible winner for each pot.";
        return;
    }

    errorMessage = "";
    peerManager?.broadcastState(gameState);
    saveGameState(gameState);
}

async function copyJoinCode() {
    if (!roomCode) return;

    try {
        await navigator.clipboard.writeText(roomCode);
        copySuccess = true;
    } catch (_error) {
        copySuccess = false;
    }
}

async function leaveGame() {
    announceDeparture();
    await new Promise((resolve) => setTimeout(resolve, 100));
    disconnectPeerManager();
    gameState = null;
    isHost = false;
    localPlayerId = "";
    roomCode = "";
    joinCode = "";
    isLoading = false;
    navigate({ name: "home" });
    clearSession();
}

function nextPhase() {
    if (!gameState || !isHost) return;
    if (gameState.phase === "showdown") {
        startNewHand(gameState);
    } else {
        advancePhase(gameState);
    }
    peerManager?.broadcastState(gameState);
    saveGameState(gameState);
}
</script>

<main class="w-full max-w-5xl mx-auto p-4 min-h-screen text-white">
    {#if route.name === "home" && !isLoading}
        <div class="py-10 md:py-14">
            <div class="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl p-8 md:p-10 text-center">
                <div class="mb-8">
                    <div class="inline-flex items-center gap-2 rounded-full bg-emerald-400/15 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-emerald-200 ring-1 ring-emerald-300/20">Poker Night</div>
                    <h1 class="text-5xl font-black tracking-tight mt-4 mb-3 text-white">Track the table, not the cards.</h1>
                    <p class="text-slate-300 text-lg">Manage blinds, bets, pots, and payouts with one shared table state.</p>
                </div>

                <div class="mb-6 text-left">
                    <label for="playerName" class="block text-sm uppercase tracking-[0.18em] text-slate-300 mb-2 font-semibold">Your Name</label>
                    <input
                        type="text"
                        id="playerName"
                        bind:value={playerName}
                        placeholder="Enter your name"
                        maxlength="20"
                        class="w-full px-4 py-3 rounded-2xl border border-white/15 bg-slate-950/60 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/70"
                    />
                </div>

                {#if errorMessage}
                    <p class="mb-4 rounded-2xl bg-red-500/10 border border-red-400/20 px-4 py-3 text-red-200">{errorMessage}</p>
                {/if}

                <div class="space-y-3">
                    <button class="w-full py-3.5 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-extrabold shadow-lg shadow-emerald-950/25 transition" onclick={() => navigate({ name: "create" })}>
                        Create Game
                    </button>
                    <button class="w-full py-3.5 px-6 rounded-2xl bg-white/10 hover:bg-white/14 text-white font-bold ring-1 ring-white/10 transition" onclick={() => navigate({ name: "join" })}>
                        Join Game
                    </button>
                </div>
            </div>
        </div>

    {:else if route.name === "create" && !isLoading}
        <div class="py-8">
            <div class="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl p-8">
                <h2 class="text-3xl font-black mb-6 text-white">Create Game</h2>

                <div class="bg-slate-950/45 border border-white/10 p-5 rounded-2xl mb-5">
                    <h3 class="font-bold mb-4 text-slate-100">Game Settings</h3>

                    <div class="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label for="startingChips" class="block mb-1 text-sm font-medium text-slate-300">Starting Chips</label>
                            <input
                                type="number"
                                id="startingChips"
                                bind:value={startingChips}
                                min="100"
                                step="100"
                                class="w-full px-3 py-2.5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/70 text-white bg-slate-900/80"
                            />
                        </div>
                        <div>
                            <label for="ante" class="block mb-1 text-sm font-medium text-slate-300">Ante</label>
                            <input
                                type="number"
                                id="ante"
                                bind:value={ante}
                                min="0"
                                class="w-full px-3 py-2.5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/70 text-white bg-slate-900/80"
                            />
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label for="smallBlind" class="block mb-1 text-sm font-medium text-slate-300">Small Blind</label>
                            <input
                                type="number"
                                id="smallBlind"
                                bind:value={smallBlind}
                                min="1"
                                class="w-full px-3 py-2.5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/70 text-white bg-slate-900/80"
                            />
                        </div>
                        <div>
                            <label for="bigBlind" class="block mb-1 text-sm font-medium text-slate-300">Big Blind</label>
                            <input
                                type="number"
                                id="bigBlind"
                                bind:value={bigBlind}
                                min="1"
                                class="w-full px-3 py-2.5 border border-white/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/70 text-white bg-slate-900/80"
                            />
                        </div>
                    </div>
                </div>

                {#if errorMessage}
                    <p class="text-red-200 mb-4 text-sm rounded-2xl bg-red-500/10 border border-red-400/20 px-4 py-3">{errorMessage}</p>
                {/if}

                <div class="space-y-3">
                    <button class="w-full py-3.5 bg-emerald-500 text-emerald-950 rounded-2xl hover:bg-emerald-400 transition font-extrabold shadow-lg shadow-emerald-950/25" onclick={createGame}>
                        Create Room
                    </button>
                    <button class="w-full py-3 text-slate-300 hover:text-white transition rounded-2xl bg-white/5 hover:bg-white/10" onclick={() => navigate({ name: "home" })}>
                        Back
                    </button>
                </div>
            </div>
        </div>

    {:else if route.name === "join" && !isLoading}
        <div class="py-8">
            <div class="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl p-8">
                <h2 class="text-3xl font-black mb-6 text-white">Join Game</h2>

                <div class="mb-4">
                    <label for="joinPlayerName" class="block mb-2 text-sm uppercase tracking-[0.18em] font-semibold text-slate-300">Your Name</label>
                    <input
                        type="text"
                        id="joinPlayerName"
                        bind:value={playerName}
                        placeholder="Enter your name"
                        maxlength="20"
                        class="w-full px-4 py-3 rounded-2xl border border-white/15 bg-slate-950/60 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/70"
                    />
                </div>

                <div class="mb-4">
                    <label for="joinCode" class="block mb-2 text-sm uppercase tracking-[0.18em] font-semibold text-slate-300">Room Code</label>
                    <input
                        type="text"
                        id="joinCode"
                        bind:value={joinCode}
                        placeholder="Enter room code"
                        class="w-full px-4 py-3 rounded-2xl border border-white/15 bg-slate-950/60 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/70"
                    />
                </div>

                {#if errorMessage}
                    <p class="text-red-200 mb-4 text-sm rounded-2xl bg-red-500/10 border border-red-400/20 px-4 py-3">{errorMessage}</p>
                {/if}

                <div class="space-y-3">
                    <button class="w-full py-3.5 bg-emerald-500 text-emerald-950 rounded-2xl hover:bg-emerald-400 transition font-extrabold shadow-lg shadow-emerald-950/25" onclick={joinGame}>
                        Join
                    </button>
                    <button class="w-full py-3 text-slate-300 hover:text-white transition rounded-2xl bg-white/5 hover:bg-white/10" onclick={() => navigate({ name: "home" })}>
                        Back
                    </button>
                </div>
            </div>
        </div>

    {:else if isLoading}
        <div class="flex flex-col items-center justify-center min-h-[50vh] rounded-[2rem] border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl">
            <div class="w-10 h-10 border-4 border-white/15 border-t-emerald-400 rounded-full animate-spin mb-4"></div>
            <p class="text-slate-200 font-medium">{isHost ? "Creating room..." : "Joining game..."}</p>
        </div>

    {:else if route.name === "room"}
        <div class="py-4">
            {#if gameState}
                {#if gameState.phase === "waiting"}
                    <div class="rounded-[2rem] border border-white/10 bg-white/8 backdrop-blur-xl shadow-2xl p-6 md:p-8 text-center">
                        <h2 class="text-3xl font-black mb-6 text-white">Waiting Room</h2>

                        <div class="bg-slate-950/45 border border-white/10 p-6 rounded-3xl mb-6">
                            <p class="mb-4 text-slate-300 font-medium">Share this code with other players</p>
                            <div class="flex flex-col sm:flex-row items-center justify-center gap-3 mb-2">
                                <code class="text-3xl font-black bg-slate-900 text-white px-6 py-4 rounded-2xl tracking-[0.18em] shadow-lg">{roomCode}</code>
                                <button
                                    class="px-5 py-3 rounded-2xl text-sm font-extrabold transition-colors shadow-lg shadow-emerald-950/20 text-emerald-950"
                                    class:bg-emerald-500={!copySuccess}
                                    class:hover:bg-emerald-400={!copySuccess}
                                    class:bg-emerald-300={copySuccess}
                                    onclick={copyJoinCode}
                                >
                                    {copySuccess ? "Copied!" : "Copy Code"}
                                </button>
                            </div>
                            <p class="text-sm h-5 text-emerald-300 font-medium">{copySuccess ? "Room code copied to clipboard." : ""}</p>

                            {#if isHost}
                                <div class="mt-6">
                                    <div class="inline-block rounded-3xl bg-white p-4 shadow-lg">
                                        <canvas bind:this={qrCanvas} class="mx-auto"></canvas>
                                    </div>
                                    <p class="text-slate-400 text-sm mt-3">Scan to join</p>
                                </div>
                            {/if}
                        </div>

                        <div class="bg-slate-950/45 border border-white/10 p-6 rounded-3xl mb-6 text-left">
                            <h3 class="font-bold mb-3 text-white">Players ({gameState.players.length}/10)</h3>
                            {#each gameState.players as player}
                                <div class="flex justify-between items-center py-3 border-b last:border-0 border-white/10">
                                    <span class="font-medium text-slate-100">{player.name}</span>
                                    <span class="text-slate-400 text-sm">{#if player.isHost}(Host){/if}</span>
                                </div>
                            {/each}
                        </div>

                        {#if isHost}
                            <div class="space-y-3">
                                {#if errorMessage}
                                    <p class="text-red-200 rounded-2xl bg-red-500/10 border border-red-400/20 px-4 py-3">{errorMessage}</p>
                                {/if}
                                <button class="w-full py-3.5 bg-emerald-500 text-emerald-950 rounded-2xl hover:bg-emerald-400 font-extrabold shadow-lg shadow-emerald-950/25 transition" onclick={startGame}>
                                    Start Game
                                </button>
                            </div>
                        {/if}
                    </div>

                {:else}
                    <div class="bg-gradient-to-b from-emerald-500 to-green-600 rounded-3xl p-6 min-h-[60vh] shadow-2xl ring-1 ring-white/15">
                        {#if !(isHost && gameState.phase === "showdown" && gameState.pot > 0)}
                            <div class="flex justify-between items-center mb-6">
                                <div class="bg-black/15 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-lg">
                                    <span class="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Pot</span>
                                    <span class="text-4xl font-extrabold block text-white leading-none mt-1">{gameState.pot}</span>
                                </div>
                                <div class="bg-white/85 text-emerald-950 px-4 py-2 rounded-full shadow-md ring-1 ring-black/5">
                                    <span class="uppercase font-extrabold tracking-[0.18em] text-sm">{gameState.phase}</span>
                                </div>
                            </div>
                        {/if}

                        {#if !(isHost && gameState.phase === "showdown" && gameState.pot > 0)}
                            <div class="flex gap-2 justify-center mb-6 min-h-16">
                                {#each gameState.communityCards as _card}
                                    <div class="w-12 h-16 bg-white rounded flex items-center justify-center text-2xl text-slate-400 shadow-md ring-1 ring-black/5">?</div>
                                {/each}
                            </div>
                        {/if}

                        {#if gameState.statusMessage && !(isHost && gameState.phase === "showdown" && gameState.pot > 0)}
                            <div class="text-center mb-4 text-sm text-white/95 font-semibold bg-black/10 rounded-full px-4 py-2 max-w-fit mx-auto shadow-sm">
                                {gameState.statusMessage}
                            </div>
                        {/if}

                        {#if isHost && gameState.phase === "showdown" && gameState.pot > 0}
                            <div class="bg-black/12 backdrop-blur-sm rounded-2xl p-5 shadow-lg ring-1 ring-white/10 mb-6">
                                <div class="space-y-4">
                                    <div class="text-center">
                                        <div class="text-white text-2xl font-extrabold tracking-tight">Record outcome</div>
                                        <p class="mt-1 text-sm text-white/70">Select the winner for each pot. Choose multiple players to split a pot.</p>
                                    </div>
                                    {#each getPotAllocations() as pot, index}
                                        <div class="rounded-3xl bg-black/12 p-5 shadow-lg ring-1 ring-white/10 space-y-4">
                                            <div class="flex items-start justify-between gap-3 flex-wrap">
                                                <div>
                                                    <div class="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Pot {index + 1}</div>
                                                    <div class="mt-1 text-3xl font-black text-white leading-none">{pot.amount}</div>
                                                </div>
                                                <div class="rounded-2xl bg-white/10 px-3 py-2 text-right ring-1 ring-white/10">
                                                    <div class="text-[11px] uppercase tracking-[0.18em] text-white/55 font-bold">Eligible</div>
                                                    <div class="text-sm text-white/85 font-medium mt-1">{pot.eligiblePlayerIds.map((id) => gameState?.players.find((player) => player.id === id)?.name || id).join(", ")}</div>
                                                </div>
                                            </div>

                                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {#each pot.eligiblePlayerIds as playerId}
                                                    {@const player = gameState?.players.find((entry) => entry.id === playerId)}
                                                    {@const selected = (showdownSelections[index] || []).includes(playerId)}
                                                    <label
                                                        class={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-all ring-1 cursor-pointer ${selected ? "bg-white text-slate-900 shadow-md ring-emerald-300/60" : "bg-white/8 text-white ring-white/10 hover:bg-white/14"}`}
                                                    >
                                                        <div>
                                                            <div class="font-bold text-base">{player?.name || playerId}</div>
                                                            <div class={`text-xs font-medium mt-0.5 ${selected ? "text-slate-500" : "text-white/60"}`}>
                                                                {(player?.hasFolded ? "Folded" : "Eligible")}
                                                            </div>
                                                        </div>
                                                        <div
                                                            class={`h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all ${selected ? "border-emerald-500 bg-emerald-500" : "border-white/30"}`}
                                                        >
                                                            {#if selected}
                                                                <span class="text-white text-sm font-black">✓</span>
                                                            {/if}
                                                        </div>
                                                        <input
                                                            type="checkbox"
                                                            class="sr-only"
                                                            checked={selected}
                                                            onchange={() => togglePotWinner(index, playerId)}
                                                        />
                                                    </label>
                                                {/each}
                                            </div>
                                        </div>
                                    {/each}
                                    <div class="flex flex-col items-center pt-1 gap-2">
                                        <button
                                            class={`min-w-56 py-3.5 px-6 rounded-2xl font-extrabold transition-colors ${canRecordOutcome() ? "bg-blue-600 hover:bg-blue-700 text-white shadow-lg" : "bg-white/10 text-white/45 shadow-none"}`}
                                            disabled={!canRecordOutcome()}
                                            onclick={recordOutcome}
                                        >
                                            Record Outcome
                                        </button>
                                        <p class={`text-sm text-white/65 ${canRecordOutcome() ? "invisible" : "visible"}`}>
                                            Select at least one winner for each pot to continue.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        {/if}

                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
                            {#each gameState.players as player}
                                <div class="bg-white rounded-2xl p-4 text-center relative shadow-lg ring-1 ring-black/5 transition-all"
                                     class:ring-4={player.isCurrentTurn}
                                     class:ring-yellow-300={player.isCurrentTurn}
                                     class:opacity-55={player.hasFolded}>
                                    <div class="flex items-center justify-center gap-1.5 mb-2 flex-wrap">
                                        <span class="font-semibold text-sm truncate text-slate-900">{player.name}</span>
                                        {#if player.isDealer}<span class="text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-bold shadow-sm">D</span>{/if}
                                        {#if player.isSmallBlind}<span class="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-bold shadow-sm">SB</span>{/if}
                                        {#if player.isBigBlind}<span class="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full font-bold shadow-sm">BB</span>{/if}
                                    </div>
                                    <div class="text-2xl font-extrabold text-slate-900 tracking-tight">{player.chips}</div>
                                    <div class="text-[11px] uppercase tracking-[0.18em] text-slate-500 mt-1">chips</div>
                                    {#if player.currentBet > 0}
                                        <div class="text-sm text-slate-600 font-medium mt-3 bg-slate-100 rounded-full px-3 py-1 inline-block">Bet: {player.currentBet}</div>
                                    {/if}
                                    {#if player.hasFolded}
                                        <div class="text-xs text-red-600 font-bold mt-2 uppercase tracking-wider">Folded</div>
                                    {/if}
                                </div>
                            {/each}
                        </div>

                        {#if gameState.phase === "showdown" && gameState.lastPayouts.length > 0}
                            <div class="bg-white/12 backdrop-blur-sm rounded-2xl p-4 mb-4 shadow-lg ring-1 ring-white/10">
                                <div class="text-center text-white font-bold mb-2">Recorded Outcome</div>
                                {#each gameState.lastPayouts as payout}
                                    <div class="text-center text-sm text-white/95 font-medium">{payout.playerName} wins {payout.amount}</div>
                                {/each}
                            </div>
                        {/if}

                        <div class="bg-black/12 backdrop-blur-sm rounded-2xl p-5 shadow-lg ring-1 ring-white/10">
                            {#if getMyPlayer()?.isCurrentTurn}
                                <div>
                                    <div class="text-center mb-4">
                                        <span class="text-white text-2xl font-semibold">To call: {calculateToCall()}</span>
                                        {#if canPerformAction("raise")}
                                            <div class="mt-2">
                                                <input 
                                                    type="number" 
                                                    bind:value={raiseAmount}
                                                    min={calculateMinRaise()}
                                                    max={(getMyPlayer()?.chips || 0) + (getMyPlayer()?.currentBet || 0)}
                                                    placeholder="Raise amount"
                                                    class="px-4 py-2.5 border-2 border-white/70 rounded-xl w-36 bg-white/95 text-slate-900 placeholder:text-slate-400 font-semibold shadow-sm"
                                                />
                                            </div>
                                        {/if}
                                    </div>
                                    
                                    <div class="flex flex-wrap gap-2 justify-center">
                                        {#if canPerformAction("fold")}
                                            <button class="py-2 px-4 bg-red-500 text-white rounded-lg font-bold" onclick={() => performAction("fold")}>
                                                Fold
                                            </button>
                                        {/if}
                                        {#if canPerformAction("check")}
                                            <button class="py-2 px-4 bg-gray-400 text-white rounded-lg font-bold" onclick={() => performAction("check")}>
                                                Check
                                            </button>
                                        {/if}
                                        {#if canPerformAction("call")}
                                            <button class="py-2 px-4 bg-blue-500 text-white rounded-lg font-bold" onclick={() => performAction("call")}>
                                                Call {calculateToCall()}
                                            </button>
                                        {/if}
                                        {#if canPerformAction("raise")}
                                            <button class="py-2 px-4 bg-purple-500 text-white rounded-lg font-bold" onclick={() => performAction("raise")}>
                                                Raise
                                            </button>
                                        {/if}
                                        {#if canPerformAction("allin")}
                                            <button class="py-2 px-4 bg-yellow-500 text-white rounded-lg font-bold" onclick={() => performAction("allin")}>
                                                All In
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                            {:else if isHost && gameState.phase === "showdown" && gameState.pot > 0}
                                <p class="text-center italic text-white/80 font-medium">Choose the showdown winner above.</p>
                            {:else if isHost && showHostAdvanceButton()}
                                <div class="text-center">
                                    <button class="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md transition-colors" onclick={nextPhase}>
                                        New Hand
                                    </button>
                                </div>
                            {:else}
                                <div class="flex flex-col items-center gap-3">
                                    {#if shouldShowWaitingCheck()}
                                        <button
                                            class={`min-w-44 py-3 px-5 rounded-xl font-bold transition-colors ${canQueueCheck() ? (autoCheckRequested ? "bg-emerald-500 hover:bg-emerald-400 text-white shadow-md" : "bg-white/90 hover:bg-white text-emerald-950 shadow-md") : "bg-white/10 text-white/45 shadow-none"}`}
                                            disabled={!canQueueCheck()}
                                            onclick={toggleAutoCheck}
                                        >
                                            Check
                                        </button>
                                    {/if}
                                    <p class="text-center italic text-white/80 font-medium">Waiting for your turn...</p>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}

                <button class="w-full mt-6 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition" onclick={leaveGame}>
                    Leave Game
                </button>
            {/if}
        </div>
    {/if}
</main>
