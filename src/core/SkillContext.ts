import * as uuid from "uuid";
import {AudioPlayer} from "../audioPlayer/AudioPlayer";
import {InteractionModel} from "../model/InteractionModel";

/**
 * Manages state of the Alexa device interaction across sessions.
 *
 * Holds information about the user, the current session, as well as the AudioPlayer, if in use.
 *
 * To emulate a user with a linked account, set the access token property.
 */
export class SkillContext {
    accessToken: string;
    public readonly apiAccessToken: string;
    public readonly apiEndpoint: string;
    public readonly device: Device;
    /** @internal */
    public readonly dialogManager: DialogManager;
    public readonly userId: string;
    private _session: SkillSession;

    /** @internal */
    public constructor(
        public readonly interactionModel: InteractionModel,
        public readonly audioPlayer: AudioPlayer,
        private _locale: string,
        private _applicationID?: string,
    ) {
        this.apiAccessToken = "virtualAlexa.accessToken." + uuid.v4();
        this.apiEndpoint = "https://api.amazonalexa.com";
        this.dialogManager = new DialogManager();
        this.device = new Device();
        this.userId = "amzn1.ask.account." + uuid.v4();
        this._session = new SkillSession();
    }

    public applicationID(): string {
        if (!this._applicationID) // Generate an application ID if it is not set
            this._applicationID = "amzn1.echo-sdk-ams.app." + uuid.v4();
        return this._applicationID;
    }

    public locale(): string {
        return this._locale || "en-US";
    }

    public newSession(): void {
        this._session = new SkillSession();
    }

    get session(): SkillSession {
        return this._session;
    }

    public endSession(): void {
        this.dialogManager.reset();
        this._session = undefined;
    }
}

/**
 * Information about the current open session on the Alexa emulator
 */
export class SkillSession {
    attributes: {[id: string]: any} = {};
    new = true;
    id: string = "SessionID." + uuid.v4();
}

export class Device {
    readonly supportedInterfaces: any = {};

    /** @internal */
    public constructor(public id?: string) {
        // By default, we support the AudioPlayer
        this.audioPlayerSupported(true);
    }

    public generatedID(): void {
        if (!this.id) {
            this.id = "virtualAlexa.deviceID." + uuid.v4();
        }
    }

    public audioPlayerSupported(value?: boolean): boolean {
        return this.supportedInterface("AudioPlayer", value);
    }

    public displaySupported(value?: boolean): boolean {
        return this.supportedInterface("Display", value);
    }

    public videoAppSupported(value?: boolean) {
        return this.supportedInterface("VideoApp", value);
    }

    private supportedInterface(name: string, value?: boolean): boolean {
        if (value !== undefined) {
            if (value === true) {
                this.supportedInterfaces[name] = {};
            } else {
                delete this.supportedInterfaces[name];
            }
        }
        return this.supportedInterfaces[name] !== undefined;
    }
}


export enum ConfirmationStatus {
    CONFIRMED = "CONFIRMED",
    DENIED = "DENIED",
    NONE = "NONE",
}

export enum DialogState {
    COMPLETED = "COMPLETED",
    IN_PROGRESS = "IN_PROGRESS",
    STARTED = "STARTED",
}

export class DialogManager {
    private _confirmationStatus: ConfirmationStatus;
    private _dialogState: DialogState;
    private _slots: {[id: string]: any} = {};

    /** @internal */
    public handleDirective(directives: any, context: SkillContext): void {
        // Look for a dialog directive - trigger dialog mode if so
        for (const directive of directives) {
            if (directive.type.startsWith("Dialog")) {
                if (directive.updatedIntent && !context.interactionModel.dialogIntent(directive.updatedIntent.name)) {
                    throw new Error("No match for dialog name: " + directive.updatedIntent.name);
                }

                this._dialogState = this._dialogState ? DialogState.IN_PROGRESS : DialogState.STARTED;

                if (directive.type === "Dialog.Delegate") {
                    this._confirmationStatus = ConfirmationStatus.NONE;
                } else if (["Dialog.ElicitSlot", "Dialog.ConfirmSlot", "Dialog.ConfirmIntent"].includes(directive.type)) {
                    // Start the dialog if not started, otherwise mark as in progress
                    if (!this._confirmationStatus) {
                        this._confirmationStatus = ConfirmationStatus.NONE;
                    }

                    if (directive.updatedIntent) {
                        this.updateSlotStates(directive.updatedIntent.slots);
                    }

                    if (directive.type === "Dialog.ConfirmIntent") {
                        this._dialogState = DialogState.COMPLETED;
                    }
                }
            }
        }
    }

    /**
     * Set the confirmation status for the dialog
     * @param confirmationStatus
     */
    public confirmationStatus(confirmationStatus: ConfirmationStatus) {
        if (confirmationStatus) {
            this._confirmationStatus = confirmationStatus;
        }
        return this._confirmationStatus;
    }

    /** @internal */
    public handleRequest(): DialogState {
        // Make sure the dialog state is set to started
        if (!this._dialogState) {
            this._dialogState = DialogState.STARTED;
        }
        return this._dialogState;
    }

    /** @internal */
    public isDialog() {
        return this._dialogState !== undefined;
    }

    public reset() {
        this._confirmationStatus = undefined;
        this._dialogState = undefined;
        this._slots = {};
    }

    /** @internal */
    public slots() {
        return this._slots;
    }

    /**
     * Set the dialog state
     * @param state
     */
    public state(state?: DialogState) {
        if (state) {
            this._dialogState = state;
        }
        return this._dialogState;
    }

    /** @internal */
    public updateSlot(slotName: string, newSlot: any) {
        const existingSlot = this._slots[slotName];

        // Update the slot value in the dialog manager if the intent has a new value
        if (!existingSlot) {
            this._slots[slotName] = newSlot;
        } else if (existingSlot && newSlot.value) {
            existingSlot.value = newSlot.value;
            existingSlot.resolutions = newSlot.resolutions;
            existingSlot.confirmationStatus = newSlot.confirmationStatus;
        }
    }

    /** @internal */
    public updateSlotStates(slots: {[id: string]: any}): void {
        if (!slots) {
            return;
        }

        //console.log("DIALOG SLOT PRE: " + JSON.stringify(slots, null, 2));
        for (const slotName of Object.keys(slots)) {
            const newSlot = slots[slotName];
            this.updateSlot(slotName, newSlot);
        }
    }
}
