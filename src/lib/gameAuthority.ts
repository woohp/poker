import { reducePokerAction, type PokerRejectionReason } from "./pokerReducer";
import { AuthoritativeStateEngine, type CommandEnvelope, type VersionedState } from "./stateEngine";
import type {
    ActionMessage,
    CommandRejectionReason,
    CommandResultMessage,
    GameSnapshot,
    GameState,
    PlayerAction,
} from "./types";

export interface AuthorityCommandResult {
    result: CommandResultMessage;
    snapshot: GameSnapshot;
    duplicate: boolean;
}

export class GameAuthority {
    private engine = new AuthoritativeStateEngine<
        GameState,
        ActionMessage,
        { fromPeerId: string },
        PokerRejectionReason
    >(reducePokerAction, cloneState);

    processRemote(
        snapshot: GameSnapshot,
        command: ActionMessage,
        fromPeerId: string,
    ): AuthorityCommandResult {
        return this.process(snapshot, command, fromPeerId);
    }

    processLocal(
        snapshot: GameSnapshot,
        playerId: string,
        action: PlayerAction,
        amount?: number,
    ): AuthorityCommandResult {
        return this.process(
            snapshot,
            {
                type: "action",
                commandId: crypto.randomUUID(),
                authorityEpoch: snapshot.authorityEpoch,
                playerId,
                round: snapshot.state.round,
                expectedRevision: snapshot.revision,
                action,
                amount,
            },
            playerId,
        );
    }

    commit(snapshot: GameSnapshot, state: GameState): GameSnapshot {
        return fromVersionedState(this.engine.commit(toVersionedState(snapshot), state));
    }

    clear(): void {
        this.engine.clear();
    }

    private process(
        snapshot: GameSnapshot,
        command: ActionMessage,
        fromPeerId: string,
    ): AuthorityCommandResult {
        const result = this.engine.process(toVersionedState(snapshot), toCommandEnvelope(command), {
            fromPeerId,
        });
        const acceptedState = this.engine.getAcceptedState(command.commandId);
        const nextSnapshot = acceptedState
            ? fromVersionedState(acceptedState)
            : result.state
              ? fromVersionedState(result.state)
              : snapshot;

        return {
            result: {
                type: "commandResult",
                commandId: result.commandId,
                accepted: result.accepted,
                revision: result.revision,
                reason: result.reason as CommandRejectionReason | undefined,
                snapshot: result.accepted ? undefined : nextSnapshot,
            },
            snapshot: nextSnapshot,
            duplicate: result.duplicate,
        };
    }
}

function toVersionedState(snapshot: GameSnapshot): VersionedState<GameState> {
    return {
        epoch: snapshot.authorityEpoch,
        revision: snapshot.revision,
        value: snapshot.state,
    };
}

function fromVersionedState(state: VersionedState<GameState>): GameSnapshot {
    return {
        authorityEpoch: state.epoch,
        revision: state.revision,
        state: state.value,
    };
}

function toCommandEnvelope(command: ActionMessage): CommandEnvelope<ActionMessage> {
    return {
        id: command.commandId,
        actorId: command.playerId,
        epoch: command.authorityEpoch,
        expectedRevision: command.expectedRevision,
        payload: command,
    };
}

function cloneState(state: GameState): GameState {
    return JSON.parse(JSON.stringify(state)) as GameState;
}
