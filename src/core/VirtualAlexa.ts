import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { SkillInteractor } from "../interactor";
import { InteractionModel } from "../model/InteractionModel";
import { SkillResponse } from "./SkillResponse";
import { UserAPI } from "../external/UserAPI";
import { VirtualAlexaBuilder } from '../builder';
import * as uuid from 'uuid';

export class VirtualAlexa {
    public static Builder = () => new VirtualAlexaBuilder();

    private requestFilter: (request: any) => void;
    public readonly addressAPI: AddressAPI;
    public readonly userAPI: UserAPI;
    public readonly dynamoDB: DynamoDB;
    public readonly audioPlayer : AudioPlayer;

    accessToken: string;
    public readonly apiAccessToken = "virtualAlexa.accessToken." + uuid.v4();
    public readonly apiEndpoint = "https://api.amazonalexa.com";
    public readonly device = new Device();
    /** @internal */
    public readonly dialogManager = new DialogManager();
    public readonly userId = "amzn1.ask.account." + uuid.v4();

    session: SkillSession;

    /** @internal */
    public constructor(
        /** @internal */
        private readonly _interactor: SkillInteractor,
        private readonly model: InteractionModel,
        private readonly locale: string,
        private readonly applicationID: string = "amzn1.echo-sdk-ams.app." + uuid.v4()
    ) {
        this.audioPlayer = new AudioPlayer();
        this.addressAPI = new AddressAPI(this.apiEndpoint, this.device);
        this.userAPI = new UserAPI(this.apiEndpoint);
        this.dynamoDB = new DynamoDB();
    }

    /**
     * Set a filter on requests - for manipulating the payload before it is sent
     * @param {(request: any) => void} requestFilter
     * @returns {VirtualAlexa}
     */
    public filter(requestFilter: (request: any) => void): VirtualAlexa {
        this.requestFilter = requestFilter;
        return this;
    }

    public resetFilter(): VirtualAlexa {
        this.requestFilter = undefined;
        return this;
    }

    /**
     * Sends a SessionEndedRequest to the skill
     * Does not wait for a reply, as there should be none
     * @returns {Promise<SkillResponse>}
     */
    public endSession(sessionEndedReason = SessionEndedReason.USER_INITIATED,
            errorData?: any): Promise<SkillResponse> {
        return this.send(this.createEndSessionRequest(sessionEndedReason, errorData));
    }

    /**
     * Sends the specified intent, with the optional map of slot values
     * @param {string} intentName
     * @param {[id: string]: string} slots
     * @param confirmationStatus
     * @returns {Promise<SkillResponse>}
     */
    public intend(intentName: string, slots?: {[id: string]: string},
                  confirmationStatus = ConfirmationStatus.NONE): Promise<SkillResponse> {
        if (!intentName.startsWith("AMAZON") && !this.model.intents.some(o => o.intent === intentName)) {
            throw new Error("Interaction model has no intentName named: " + intentName);
        }

        const json = this.createRequestJson();
        json.request.type = RequestType.INTENT_REQUEST;
        json.request.intent = {
            confirmationStatus: confirmationStatus,
            name: intentName,
            slots: {},
        };
        // Set default slot values - all slots must have a value for an intent
        this.model.intents.find(o => o.intent === intentName)?.slots?.forEach((intentSlot: any) =>
            json.request.intent.slots[intentSlot.name] = {
                name: intentSlot.name,
                confirmationStatus: ConfirmationStatus.NONE
            });

        if (this.model.dialogIntent(intentName)) {
            // Update the request JSON to have the correct dialog state
            json.request.dialogState = this.dialogManager.dialogState || "STARTED";

            // Update the state of the slots in the dialog manager.
            // Our slots can just be taken from the dialog manager now.
            //  It has the complete current state of the slot values for the dialog intent.
            json.request.intent.slots = this.dialogManager.updateSlotStates(json.request.intent.slots);
        }

        slots && Object.entries(slots).forEach(([name, value]) => this.slot(json, name, value));

        return this.send(json);
    }

    /**
     * Sends a Display.ElementSelected request with the specified token
     * @param {string} token The token for the selected element
     * @returns {Promise<SkillResponse>}
     */
    public selectElement(token: any): Promise<SkillResponse> {
        const json = this.createRequestJson();
        json.request.type = RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST;
        json.request.token = token;
        return this.send(json);
    }

    /**
     * Creates a connection response object - used by Alexa Connections such as In-Skill Purchases
     * @param requestName
     * @param purchaseResult for the payload object
     * @param productId for the payload object
     * @param token The correlating token
     * @param statusCode The status code
     * @param statusMessage The status message
     */
    public inSkillPurchaseResponse(requestName: string, purchaseResult: string, productId: string,
                                   token: string, statusCode = 200, statusMessage = "OK"): Promise<SkillResponse> {
        const json = this.createRequestJson();
        json.request.type = RequestType.CONNECTIONS_RESPONSE;
        json.request.name = requestName;
        json.request.payload = {productId, purchaseResult};
        json.request.token = token;
        json.request.status = {code: statusCode, message: statusMessage};
        return this.send(json);
    }

    /**
     * Sends a launch request to the skill
     * @returns {Promise<SkillResponse>}
     */
    public launch(): Promise<SkillResponse> {
        const json = this.createRequestJson();
        json.request.type = RequestType.LAUNCH_REQUEST;
        return this.send(json);
    }

    /**
     * Sends the specified utterance as an Intent request to the skill
     * @param {string} utteranceString
     * @returns {Promise<SkillResponse>}
     */
    public utter(utteranceString: string): Promise<SkillResponse> {
        if (utteranceString === "exit") {
            return this.endSession();
        }

        let resolvedUtterance = utteranceString;
        if (/(ask|open|launch|talk to|tell).*/i.test(utteranceString)) {
            const result = /^(?:ask|open|launch|talk to|tell) .* to (.*)/i.exec(utteranceString);
            if (!result?.length) {
                return this.launch();
            }
            resolvedUtterance = result[1];
        }

        const { intent, slots } = this.model.utterance(resolvedUtterance);
        return this.intend(intent, slots);
    }

    // First create the header part of the request
    private createRequestJson = (): any => ({
        context: {
            System: {
                application: {
                    applicationId: this.applicationID,
                },
                device: {
                    supportedInterfaces: this.device.supportedInterfaces,
                    ...(this.device.id && {deviceId: this.device.id}),
                },
                user: {
                    userId: this.userId,
                    ...(this.device.id && {permissions: {consentToken: uuid.v4()}}),
                    ...(this.accessToken && {accessToken: this.accessToken})
                },
                ...(this.device.id && {apiAccessToken: this.apiAccessToken, apiEndpoint: this.apiEndpoint}),
            },
            ...(this.device.supportedInterfaces["Display"] && {Display: {}}),
            ...(this.device.supportedInterfaces["AudioPlayer"] && {
                AudioPlayer: this.audioPlayer._activity !== AudioPlayerActivity.IDLE
                    ? this.audioPlayer.playingItem() : {playerActivity: AudioPlayerActivity.IDLE}
            })
        },
        request: {
            locale: this.locale || "en-US",
            requestId: "amzn1.echo-external.request." + uuid.v4(),
            timestamp: new Date().toISOString().substring(0, 19) + "Z",
        },
        version: "1.0",
    });

    /**
     * Sends the request to the Alexa skill
     */
    public async send(json: any): Promise<SkillResponse> {
        if ([
            RequestType.LAUNCH_REQUEST,
            RequestType.INTENT_REQUEST,
            RequestType.SESSION_ENDED_REQUEST,
            RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST,
            RequestType.CONNECTIONS_RESPONSE
        ].includes(json.request.type)) {
            if (!this.session) {
                this.session = new SkillSession();
            }
            json.session = {
                application: {
                    applicationId: this.applicationID,
                },
                new: this.session.new,
                sessionId: this.session.id,
                user: {
                    userId: this.userId,
                    ...(this.device.id && { permissions: { consentToken: uuid.v4() } }),
                    ...(this.accessToken && { accessToken: this.accessToken })
                },
                ...(json.request.type !== RequestType.LAUNCH_REQUEST && { attributes: this.session.attributes })
            };
        }

        // When the user utters an intent, we suspend for it
        // We do this first to make sure everything is in the right state for what comes next
        if (this.device.supportedInterfaces["AudioPlayer"] && json.request.intent
                && this.audioPlayer._activity === AudioPlayerActivity.PLAYING) {
            this.audioPlayer._suspended = true;
            this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
            await this.send(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED));
        }

        this.requestFilter?.(json);

        const result: any = await this._interactor.invoke(json);

        // If this was a session ended request, end the session in our internal state
        if (json.request.type === "SessionEndedRequest" || this.session && result?.response?.shouldEndSession) {
            this.dialogManager.reset();
            this.session = undefined;
        }
        if (this.session) {
            this.session.new = false;
            if (result.sessionAttributes) this.session.attributes = result.sessionAttributes;
        }

        if (result.response?.directives) {
            // Update the dialog manager based on the results
            // Look for a dialog directive - trigger dialog mode if so
            for (const directive of result.response.directives) {
                const requests = this.handleAudioDirective(directive);
                for (let request of requests) await this.send(request);

                if (directive.type.startsWith("Dialog")) {
                    if (directive.updatedIntent && !this.model.dialogIntent(directive.updatedIntent.name))
                        throw new Error("No match for dialog name: " + directive.updatedIntent.name);
                    this.dialogManager.handleDirective(directive);
                }
            }
        }
        // Resume the audio player, if suspended
        if (json.request.intent && this.device.supportedInterfaces["AudioPlayer"] && this.audioPlayer._suspended) {
            this.audioPlayer._suspended = false;
            if (this.audioPlayer._activity !== AudioPlayerActivity.PLAYING) {
                this.audioPlayer._activity = AudioPlayerActivity.PLAYING;
                await this.send(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STARTED));
            }
        }

        return new SkillResponse(result);
    }

    private createAudioRequest(requestType: string) {
        const json = this.createRequestJson();
        json.request.type = requestType;
        json.request.token = this.audioPlayer.playingItem().token;
        json.request.offsetInMilliseconds = this.audioPlayer.playingItem().offsetInMilliseconds;
        return json;
    }


    /**
     * Sets a slot value on the request
     * @param json
     * @param slotName
     * @param slotValue
     * @param confirmationStatus
     */
    private slot(json: any, slotName: string, slotValue: string, confirmationStatus = ConfirmationStatus.NONE): VirtualAlexa {
        const comp = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

        const slots: any[] = this.model.intents.find(o => o.intent === json.request.intent.name)?.slots;
        if (!slots) throw new Error("Trying to add slot to intent that does not have any slots defined");
        const slot = slots?.find(s => comp(slotName, s.name));
        if (!slot) throw new Error("Trying to add undefined slot to intent: " + slotName);

        const resolutionsPerAuthority: {
            values: EntityResolutionValue[];
            status: {
                code: "ER_SUCCESS_MATCH" | "ER_SUCCESS_NO_MATCH"
            };
            authority: string;
        }[] = [];
        const slotType = this.model.slotTypes.find(o => comp(o.name, slot.type))
        const enumeratedValues = slotType?.values?.filter(sv => !sv.builtin);
        // Only includes the entity resolution for builtin types if they have been extended.
        if (enumeratedValues?.length) {
            const authority = `amzn1.er-authority.echo-sdk.${this.applicationID}.${slotType.name}`;

            enumeratedValues.forEach(enumeratedValue => {
                // First check the name value. It's possible to have multiple matches, where we have overlapping synonyms.
                // Refer here for definitive rules: https://developer.amazon.com/docs/custom-skills/define-synonyms-and-ids-for-slot-type-values-entity-resolution.html
                const count = comp(enumeratedValue.name.value, slotValue) ? 1
                    : (enumeratedValue.name.synonyms?.filter(synonym => comp(synonym, slotValue)).length ?? 0);
                if (count) {
                    const values = new Array(count).fill({value: {id: enumeratedValue.id, name: enumeratedValue.name.value}});
                    const existingResolution = resolutionsPerAuthority.find(resolution => resolution.authority === authority);
                    if (existingResolution) {
                        existingResolution.values.push(...values);
                    } else {
                        resolutionsPerAuthority.push({authority, values: values, status: {code: "ER_SUCCESS_MATCH"}});
                    }
                }
            });

            if (!resolutionsPerAuthority.length) {
                resolutionsPerAuthority.push({authority, values: [], status: {code: "ER_SUCCESS_NO_MATCH"}});
            }
        }

        const slotValueObject = {
            name: slotName,
            value: slotValue,
            confirmationStatus,
            ...(resolutionsPerAuthority.length && { resolutionsPerAuthority })
        };
        json.request.intent.slots[slotName] = slotValueObject;

        // Update the internal state of the dialog manager based on this request
        this.dialogManager.updateSlot(slotName, slotValueObject);

        return this;
    }

    private handleAudioDirective(directive: any) {
        const requests = [];
        if (directive.type === "AudioPlayer.Play") {
            if (directive.playBehavior === "ENQUEUE") {
                this.audioPlayer._queue.push(directive.audioItem.stream);
            } else if (directive.playBehavior === "REPLACE_ALL") {
                if (this.audioPlayer._activity === AudioPlayerActivity.PLAYING) {
                    this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
                    // requests.push(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED));
                    requests.push(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED));
                }
                this.audioPlayer._queue = [directive.audioItem.stream];
            } else if (directive.playBehavior === "REPLACE_ENQUEUED") {
                this.audioPlayer._queue = [directive.audioItem.stream];
            }

            if (this.audioPlayer._activity !== AudioPlayerActivity.PLAYING && this.audioPlayer._queue.length !== 0) {
                // dequeue
                if (!this.audioPlayer._queue[0].url) {
                    requests.push(this.createEndSessionRequest(SessionEndedReason.ERROR, {
                        message: "The URL specified in the Play directive must be defined and a valid HTTPS url",
                        type: "INVALID_RESPONSE",
                    }));
                } else if (this.audioPlayer._queue[0].url.startsWith("http:")) {
                    requests.push(this.createEndSessionRequest(SessionEndedReason.ERROR, {
                        message: "The URL specified in the Play directive must be HTTPS",
                        type: "INVALID_RESPONSE",
                    }));
                } else {
                    this.audioPlayer._activity = AudioPlayerActivity.PLAYING;
                    requests.push(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STARTED));
                }
            }
        } else if (directive.type === "AudioPlayer.Stop") {
            if (this.audioPlayer._suspended) {
                this.audioPlayer._suspended = false;
            } else if (this.audioPlayer.playingItem()) {
                this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
                requests.push(this.createAudioRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED));
            }
        }
        return requests;
    }

    private createEndSessionRequest(
        sessionEndedReason = SessionEndedReason.USER_INITIATED,
        errorData?: { message: string, type: string }
    ) {
        const json = this.createRequestJson();
        json.request.type = RequestType.SESSION_ENDED_REQUEST;
        json.request.reason = sessionEndedReason;
        if (errorData) json.request.error = errorData;
        return json;
    }
}

interface EntityResolutionValue {
    value: {
        id: string,
        name: string
    }
}

export enum RequestType {
    CONNECTIONS_RESPONSE = "Connections.Response",
    DISPLAY_ELEMENT_SELECTED_REQUEST = "Display.ElementSelected",
    INTENT_REQUEST = "IntentRequest",
    LAUNCH_REQUEST = "LaunchRequest",
    SESSION_ENDED_REQUEST = "SessionEndedRequest",
    AUDIO_PLAYER_PLAYBACK_STARTED = "AudioPlayer.PlaybackStarted",
    AUDIO_PLAYER_PLAYBACK_STOPPED = "AudioPlayer.PlaybackStopped",
}

export enum SessionEndedReason {
    ERROR,
    EXCEEDED_MAX_REPROMPTS,
    USER_INITIATED,
}

export enum AudioPlayerActivity {
    // BUFFER_UNDERRUN,
    // FINISHED,
    IDLE,
    PLAYING,
    // PAUSED,
    STOPPED,
}

export const AudioBuiltinIntents = {
    "AMAZON.CancelIntent": ["cancel", "never mind"],
    "AMAZON.HelpIntent": ["help", "help me"],
    "AMAZON.LoopOffIntent": ["loop off"],
    "AMAZON.LoopOnIntent": ["loop", "loop on", "keep repeating this song"],
    "AMAZON.MoreIntent": ["more"],
    "AMAZON.NavigateHomeIntent": ["home", "go home"],
    "AMAZON.NavigateSettingsIntent": ["settings"],
    "AMAZON.NextIntent": ["next", "skip", "skip forward"],
    "AMAZON.NoIntent": ["no", "no thanks"],
    "AMAZON.PageDownIntent": ["page down"],
    "AMAZON.PageUpIntent": ["page up"],
    "AMAZON.PauseIntent": ["pause", "pause that"],
    "AMAZON.PreviousIntent": ["go back", "previous", "skip back", "back up"],
    "AMAZON.RepeatIntent": ["repeat", "say that again", "repeat that"],
    "AMAZON.ResumeIntent": ["resume", "continue", "keep going"],
    "AMAZON.ScrollDownIntent": ["scroll down"],
    "AMAZON.ScrollLeftIntent": ["scroll left"],
    "AMAZON.ScrollRightIntent": ["scroll right"],
    "AMAZON.ScrollUpIntent": ["scroll up"],
    "AMAZON.ShuffleOffIntent": ["shuffle off", "stop shuffling", "turn off shuffle"],
    "AMAZON.ShuffleOnIntent": ["shuffle", "shuffle on", "shuffle the music", "shuffle mode"],
    "AMAZON.StartOverIntent": ["start over", "restart", "start again"],
    "AMAZON.StopIntent": ["stop", "off", "shut up"],
    "AMAZON.YesIntent": ["yes", "yes please", "sure"],
};

/**
 * Emulates the behavior of the audio player
 */
export class AudioPlayer {
    /** @internal */
    public _queue: AudioItem[] = [];
    /** @internal */
    public _activity: AudioPlayerActivity = AudioPlayerActivity.IDLE;
    /** @internal */
    public _suspended: boolean = false;

    /**
     * The currently playing track
     * @returns {AudioItem}
     */
    public playingItem(): AudioItem {
        return this._queue[0];
    }
}

export interface AudioItem {
    readonly url: string;
    readonly token: string;
    readonly expectedPreviousToken: string;
    readonly offsetInMilliseconds: number;
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
    public readonly supportedInterfaces: {
        [k in "AudioPlayer" | "Display" | "VideoApp"]?: null| {}
    } = {
        "AudioPlayer": {} // By default, we support the AudioPlayer
    };

    /** @internal */
    public constructor(public id?: string) {}

    public generatedID(): void {
        if (!this.id) this.id = "virtualAlexa.deviceID." + uuid.v4();
    }

    public audioPlayerSupported = (value: boolean) => this.supportedInterface("AudioPlayer", value);

    public displaySupported = (value: boolean) => this.supportedInterface("Display", value);

    public videoAppSupported = (value: boolean) => this.supportedInterface("VideoApp", value);

    private supportedInterface(name: "AudioPlayer" | "Display" | "VideoApp", value: boolean): void {
        value ? this.supportedInterfaces[name] = {} : delete this.supportedInterfaces[name];
    }
}

enum ConfirmationStatus {
    CONFIRMED = "CONFIRMED",
    DENIED = "DENIED",
    NONE = "NONE",
}

type DialogState = "COMPLETED" | "IN_PROGRESS" | "STARTED";

export class DialogManager {
    private _confirmationStatus: ConfirmationStatus;
    public dialogState: DialogState;
    public slots: {[id: string]: {
            value: string,
            resolutions: string,
            confirmationStatus: string,
        }} = {};

    /** @internal */
    public handleDirective(directive: any): void {
        this.dialogState = this.dialogState ? "IN_PROGRESS" : "STARTED";

        if (directive.type === "Dialog.Delegate") {
            this._confirmationStatus = ConfirmationStatus.NONE;
        } else if (["Dialog.ElicitSlot", "Dialog.ConfirmSlot", "Dialog.ConfirmIntent"].includes(directive.type)) {
            // Start the dialog if not started, otherwise mark as in progress
            if (!this._confirmationStatus)
                this._confirmationStatus = ConfirmationStatus.NONE;
            if (directive.updatedIntent)
                this.updateSlotStates(directive.updatedIntent.slots);
            if (directive.type === "Dialog.ConfirmIntent")
                this.dialogState = "COMPLETED";
        }
    }

    public reset() {
        this._confirmationStatus = undefined;
        this.dialogState = undefined;
        this.slots = {};
    }

    /** @internal */
    public updateSlot(slotName: string, newSlot: any) {
        // Update the slot value in the dialog manager if the intent has a new value
        this.slots[slotName] = {...this.slots[slotName], ...newSlot};
    }

    /** @internal */
    public updateSlotStates(slots: {[id: string]: any}) {
        slots && Object.keys(slots).forEach(name => this.updateSlot(name, slots[name]));
        return this.slots;
    }
}
