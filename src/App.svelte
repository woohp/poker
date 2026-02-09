<script lang="ts">
import QRCode from "qrcode";
import { onDestroy, onMount } from "svelte";
import {
    addPlayer,
    advancePhase,
    createInitialGameState,
    getValidActions,
    isBettingRoundComplete,
    loadGameState,
    processAction,
    removePlayer,
    saveGameState,
    startNewHand,
} from "./lib/gameLogic";
import { PeerManager } from "./lib/peerManager";
import type { GameConfig, GameState, PeerMessage, Player } from "./lib/types";

let view: "home" | "create" | "join" | "game" | "loading" = $state("home");
let peerManager: PeerManager | null = $state(null);
let gameState: GameState | null = $state(null);
let playerName = $state("");
let joinCode = $state("");
let errorMessage = $state("");
let qrCanvas: HTMLCanvasElement | null = $state(null);

let startingChips = $state(1000);
let smallBlind = $state(5);
let bigBlind = $state(10);
let ante = $state(0);

let isHost = $state(false);
let localPlayerId = $state("");
let raiseAmount = $state(0);

onMount(() => {
    const saved = loadGameState();
    if (saved) {
        gameState = saved;
        view = "game";
    }
});

onDestroy(() => {
    peerManager?.disconnect();
});

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
            if (processAction(gameState, message.playerId, message.action, message.amount)) {
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
            break;
        }
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
                view = "game";
                saveGameState(gameState);
            } else {
                errorMessage = message.message || "Failed to join game";
                peerManager?.disconnect();
                peerManager = null;
            }
            break;
        }
    }
}

function handleConnectionChange(peerId: string, connected: boolean) {
    if (!connected && isHost && gameState) {
        removePlayer(gameState, peerId);
        peerManager?.broadcastState(gameState);
    }
}

async function createGame() {
    if (!playerName.trim()) {
        errorMessage = "Please enter your name";
        return;
    }

    errorMessage = "";
    view = "loading";
    peerManager = new PeerManager(handlePeerMessage, handleConnectionChange);
    isHost = true;

    try {
        const peerId = await peerManager.createHost();
        localPlayerId = peerId;

        const config: GameConfig = { startingChips, smallBlind, bigBlind, ante };
        gameState = createInitialGameState(config, playerName, peerId);
        saveGameState(gameState);
        view = "create";

        setTimeout(() => generateQRCode(peerId), 100);
    } catch (_error) {
        errorMessage = "Failed to create game. Please try again.";
        view = "home";
        isHost = false;
    }
}

async function generateQRCode(peerId: string) {
    if (!qrCanvas) return;
    const url = `${window.location.origin}?join=${peerId}`;
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
    view = "loading";
    peerManager = new PeerManager(handlePeerMessage, handleConnectionChange);
    isHost = false;

    try {
        await peerManager.joinGame(joinCode.trim(), playerName);
        setTimeout(() => {
            if (view === "loading") {
                errorMessage = "Connection timed out. Please check the code and try again.";
                view = "join";
                peerManager?.disconnect();
                peerManager = null;
            }
        }, 10000);
    } catch (_error) {
        errorMessage = "Failed to join game. Please check the code and try again.";
        view = "join";
        peerManager = null;
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
    view = "game";
}

function performAction(action: "fold" | "check" | "call" | "raise" | "allin") {
    if (!gameState || isHost) return;
    const amount = action === "raise" ? raiseAmount : undefined;
    const hostId = gameState.players[0]?.id;
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

function calculateMinRaise(): number {
    if (!gameState) return 0;
    return gameState.currentBet + gameState.minRaise;
}

function copyJoinCode() {
    if (!peerManager) return;
    navigator.clipboard.writeText(peerManager.getLocalPeerId());
}

function leaveGame() {
    peerManager?.disconnect();
    peerManager = null;
    gameState = null;
    isHost = false;
    localPlayerId = "";
    view = "home";
}

function nextPhase() {
    if (!gameState || !isHost) return;
    if (gameState.phase === "showdown") {
        startNewHand(gameState);
    } else {
        advancePhase(gameState);
    }
    peerManager?.broadcastState(gameState);
}
</script>

<main class="w-full max-w-4xl mx-auto p-4 min-h-screen">
    {#if view === "home"}
        <div class="text-center py-12">
            <h1 class="text-4xl font-bold mb-2">Poker Night</h1>
            <p class="text-gray-500 mb-8">Track your game locally</p>
            
            <div class="mb-6">
                <label for="playerName" class="block text-left mb-2 font-medium">Your Name</label>
                <input 
                    type="text" 
                    id="playerName"
                    bind:value={playerName}
                    placeholder="Enter your name"
                    maxlength="20"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            </div>

            {#if errorMessage}
                <p class="text-red-500 mb-4">{errorMessage}</p>
            {/if}

            <div class="space-y-3">
                <button class="w-full py-3 px-6 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition" onclick={() => view = "create"}>
                    Create Game
                </button>
                <button class="w-full py-3 px-6 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition" onclick={() => view = "join"}>
                    Join Game
                </button>
            </div>
        </div>

    {:else if view === "create"}
        <div class="py-8">
            <h2 class="text-2xl font-bold mb-6">Create Game</h2>
            
            <div class="bg-gray-50 p-6 rounded-xl mb-6">
                <h3 class="font-semibold mb-4">Game Settings</h3>
                
                <div class="grid grid-cols-2 gap-4 mb-4">
                    <div>
                        <label for="startingChips" class="block mb-1 text-sm">Starting Chips</label>
                        <input 
                            type="number" 
                            id="startingChips"
                            bind:value={startingChips}
                            min="100"
                            step="100"
                            class="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                    <div>
                        <label for="ante" class="block mb-1 text-sm">Ante</label>
                        <input 
                            type="number" 
                            id="ante"
                            bind:value={ante}
                            min="0"
                            class="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="smallBlind" class="block mb-1 text-sm">Small Blind</label>
                        <input 
                            type="number" 
                            id="smallBlind"
                            bind:value={smallBlind}
                            min="1"
                            class="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                    <div>
                        <label for="bigBlind" class="block mb-1 text-sm">Big Blind</label>
                        <input 
                            type="number" 
                            id="bigBlind"
                            bind:value={bigBlind}
                            min="1"
                            class="w-full px-3 py-2 border rounded-lg"
                        />
                    </div>
                </div>
            </div>

            {#if errorMessage}
                <p class="text-red-500 mb-4">{errorMessage}</p>
            {/if}

            <div class="space-y-3">
                <button class="w-full py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600" onclick={createGame}>
                    Create Room
                </button>
                <button class="w-full py-3 text-gray-500 hover:text-gray-700" onclick={() => view = "home"}>
                    Back
                </button>
            </div>
        </div>

    {:else if view === "join"}
        <div class="py-8">
            <h2 class="text-2xl font-bold mb-6">Join Game</h2>
            
            <div class="mb-6">
                <label for="joinCode" class="block mb-2 font-medium">Room Code</label>
                <input 
                    type="text" 
                    id="joinCode"
                    bind:value={joinCode}
                    placeholder="Enter room code"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg"
                />
            </div>

            {#if errorMessage}
                <p class="text-red-500 mb-4">{errorMessage}</p>
            {/if}

            <div class="space-y-3">
                <button class="w-full py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600" onclick={joinGame}>
                    Join
                </button>
                <button class="w-full py-3 text-gray-500 hover:text-gray-700" onclick={() => view = "home"}>
                    Back
                </button>
            </div>
        </div>

    {:else if view === "loading"}
        <div class="flex flex-col items-center justify-center min-h-[50vh]">
            <div class="w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <p>{isHost ? "Creating room..." : "Joining game..."}</p>
        </div>

    {:else if view === "game"}
        <div class="py-4">
            {#if gameState}
                {#if gameState.phase === "waiting"}
                    <div class="text-center">
                        <h2 class="text-2xl font-bold mb-6">Waiting Room</h2>
                        
                        <div class="bg-gray-50 p-6 rounded-xl mb-6">
                            <p class="mb-4">Share this code with other players:</p>
                            <div class="flex items-center justify-center gap-3 mb-6">
                                <code class="text-2xl font-bold bg-gray-800 text-white px-5 py-3 rounded-lg tracking-wider">{localPlayerId}</code>
                                <button class="px-4 py-2 bg-gray-200 rounded-lg text-sm" onclick={copyJoinCode}>
                                    Copy
                                </button>
                            </div>
                            
                            <div class="mt-6">
                                <canvas bind:this={qrCanvas} class="mx-auto"></canvas>
                                <p class="text-gray-500 text-sm mt-2">Scan to join</p>
                            </div>
                        </div>

                        <div class="bg-gray-50 p-6 rounded-xl mb-6 text-left">
                            <h3 class="font-semibold mb-3">Players ({gameState.players.length}/10)</h3>
                            {#each gameState.players as player}
                                <div class="flex justify-between items-center py-3 border-b last:border-0">
                                    <span class="font-medium">{player.name}</span>
                                    <span class="text-gray-500 text-sm">{#if player.isHost}(Host){/if}</span>
                                </div>
                            {/each}
                        </div>

                        {#if isHost}
                            <div class="space-y-3">
                                {#if errorMessage}
                                    <p class="text-red-500">{errorMessage}</p>
                                {/if}
                                <button class="w-full py-3 bg-green-500 text-white rounded-lg hover:bg-green-600" onclick={startGame}>
                                    Start Game
                                </button>
                            </div>
                        {/if}
                    </div>

                {:else}
                    <div class="bg-green-500 rounded-2xl p-6 min-h-[60vh]">
                        <div class="flex justify-between items-center mb-6">
                            <div>
                                <span class="text-xs text-black/60">Pot</span>
                                <span class="text-3xl font-bold block">{gameState.pot}</span>
                            </div>
                            <div>
                                <span class="uppercase font-bold text-black/60">{gameState.phase}</span>
                            </div>
                        </div>

                        <div class="flex gap-2 justify-center mb-6">
                            {#each gameState.communityCards as _card}
                                <div class="w-12 h-16 bg-white rounded flex items-center justify-center text-2xl">?</div>
                            {/each}
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
                            {#each gameState.players as player}
                                <div class="bg-white rounded-xl p-3 text-center relative"
                                     class:ring-4={player.isCurrentTurn}
                                     class:ring-yellow-400={player.isCurrentTurn}
                                     class:opacity-50={player.hasFolded}>
                                    <div class="flex items-center justify-center gap-1 mb-1">
                                        <span class="font-medium text-sm truncate">{player.name}</span>
                                        {#if player.isDealer}<span class="text-xs bg-blue-500 text-white px-1.5 rounded">D</span>{/if}
                                        {#if player.isSmallBlind}<span class="text-xs bg-orange-500 text-white px-1.5 rounded">SB</span>{/if}
                                        {#if player.isBigBlind}<span class="text-xs bg-red-600 text-white px-1.5 rounded">BB</span>{/if}
                                    </div>
                                    <div class="text-xl font-bold">{player.chips}</div>
                                    {#if player.currentBet > 0}
                                        <div class="text-xs text-gray-500">Bet: {player.currentBet}</div>
                                    {/if}
                                    {#if player.hasFolded}
                                        <div class="text-xs text-red-500 font-bold">Folded</div>
                                    {/if}
                                </div>
                            {/each}
                        </div>

                        <div class="bg-black/10 rounded-xl p-4">
                            {#if isHost}
                                <div class="text-center">
                                    {#if gameState.phase === "showdown"}
                                        <button class="py-3 px-6 bg-blue-500 text-white rounded-lg" onclick={nextPhase}>
                                            New Hand
                                        </button>
                                    {:else if isBettingRoundComplete(gameState)}
                                        <button class="py-3 px-6 bg-blue-500 text-white rounded-lg" onclick={nextPhase}>
                                            Next Phase
                                        </button>
                                    {:else}
                                        <p class="italic text-black/60">Waiting for players...</p>
                                    {/if}
                                </div>
                            {:else}
                                {@const me = getMyPlayer()}
                                {#if me && me.isCurrentTurn}
                                    <div>
                                        <div class="text-center mb-4">
                                            <span>To call: {calculateToCall()}</span>
                                            {#if canPerformAction("raise")}
                                                <div class="mt-2">
                                                    <input 
                                                        type="number" 
                                                        bind:value={raiseAmount}
                                                        min={calculateMinRaise()}
                                                        max={me.chips + me.currentBet}
                                                        placeholder="Raise amount"
                                                        class="px-3 py-2 border rounded w-32"
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
                                {:else}
                                    <p class="text-center italic text-black/60">Waiting for your turn...</p>
                                {/if}
                            {/if}
                        </div>
                    </div>
                {/if}

                <button class="w-full mt-6 py-3 text-gray-500 hover:text-gray-700" onclick={leaveGame}>
                    Leave Game
                </button>
            {/if}
        </div>
    {/if}
</main>
