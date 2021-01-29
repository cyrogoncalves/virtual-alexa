import * as uuid from "uuid";
import {AudioPlayer} from "../audioPlayer/AudioPlayer";
import {DialogManager} from "../dialog/DialogManager";
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
