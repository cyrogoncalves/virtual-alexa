import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { SkillInteractor } from "../interactor";
import { InteractionModel } from "../model/InteractionModel";
import { ConfirmationStatus, Device, DialogManager, SkillSession } from "./SkillContext";
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
    public newSession(): void {
        this.session = new SkillSession();
    }
    public endSession2(): void {
        this.dialogManager.reset();
        this.session = undefined;
    }
    
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
        const json = this.createRequestJson();
        json.request.type = RequestType.SESSION_ENDED_REQUEST;
        json.request.reason = sessionEndedReason;
        if (errorData) {
            json.request.error = errorData;
        }
        return this.send(json);
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
        const json = this.createRequestJson();

        json.request.type = RequestType.INTENT_REQUEST;
        if (!intentName.startsWith("AMAZON") && !this.model.intents.some(o => o.intent === intentName)) {
            throw new Error("Interaction model has no intentName named: " + intentName);
        }

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
            json.request.dialogState = this.dialogManager.handleRequest();

            // Update the state of the slots in the dialog manager
            this.dialogManager.updateSlotStates(json.request.intent.slots);

            // Our slots can just be taken from the dialog manager now
            //  It has the complete current state of the slot values for the dialog intent
            json.request.intent.slots = this.dialogManager.slots();
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
            return this.endSession(SessionEndedReason.USER_INITIATED);
        }

        let resolvedUtterance = utteranceString;
        if (/(ask|open|launch|talk to|tell).*/i.test(utteranceString)) {
            const result = /^(?:ask|open|launch|talk to|tell) .* to (.*)/i.exec(utteranceString);
            if (!result?.length) {
                return this.launch();
            }
            resolvedUtterance = result[1];
        }

        const { slots, intent, slotNames } = this.model.utterance(resolvedUtterance);
        const json = slots?.reduce((json: any, slot: string, i: number) => {
            json[slotNames[i]] = slot.trim();
            return json;
        }, {}) ?? {};
        return this.intend(intent, json);
    }

    private createRequestJson() {
        // First create the header part of the request
        const json: any =  {
            context: {
                System: {
                    application: {
                        applicationId: this.applicationID,
                    },
                    device: {
                        supportedInterfaces: this.device.supportedInterfaces,
                    },
                    user: {
                        userId: this.userId,
                        ...(this.device.id && { permissions: { consentToken: uuid.v4() } }),
                        ...(this.accessToken && { accessToken: this.accessToken })
                    },
                },
            },
            request: {
                locale: this.locale || "en-US",
                requestId: "amzn1.echo-external.request." + uuid.v4(),
                timestamp: new Date().toISOString().substring(0, 19) + "Z",
            },
            version: "1.0",
        };

        // If the device ID is set, we set the API endpoint and deviceId properties
        if (this.device.id) {
            json.context.System.apiAccessToken = this.apiAccessToken;
            json.context.System.apiEndpoint = this.apiEndpoint;
            json.context.System.device.deviceId = this.device.id;
        }

        // If display enabled, we add a display object to context
        if (this.device.displaySupported()) {
            json.context.Display = {};
        }

        return json;
    }


    /**
     * Sends the request to the Alexa skill
     */
    public async send(json: any): Promise<SkillResponse> {
        // If we have a session, set the info
        if ([RequestType.LAUNCH_REQUEST, RequestType.INTENT_REQUEST, RequestType.SESSION_ENDED_REQUEST,
            RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST, RequestType.CONNECTIONS_RESPONSE].includes(json.request.type)) {
            if (!this.session) {
                this.newSession();
            }
            json.session = {
                application: {
                    applicationId: this.applicationID,
                },
                new: this.session.new,
                sessionId: this.session.id,
                user: {
                    userId: this.userId,
                    ...(this.device.id && { permissions: {
                            consentToken: uuid.v4()
                        }}),
                    ...(this.accessToken && { accessToken: this.accessToken })
                },
                ...(json.request.type !== RequestType.LAUNCH_REQUEST && { attributes: this.session.attributes })
            };
        }

        // For intent, launch and session ended requests, send the audio player state if there is one
        if (this.device.audioPlayerSupported()) {
            json.context.AudioPlayer = {
                playerActivity: AudioPlayerActivity[this.audioPlayer._activity],
            };

            // Anything other than IDLE, we send token and offset
            if (this.audioPlayer._activity !== AudioPlayerActivity.IDLE) {
                const playing = this.audioPlayer.playingItem();
                json.context.AudioPlayer.token = playing.token;
                json.context.AudioPlayer.offsetInMilliseconds = playing.offsetInMilliseconds;
            }
        }

        // When the user utters an intent, we suspend for it
        // We do this first to make sure everything is in the right state for what comes next
        if (json.request.intent && this.device.audioPlayerSupported()) {
            if (this.audioPlayer._activity === AudioPlayerActivity.PLAYING) {
                this.audioPlayer._suspended = true;
                this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
                await this.audioPlayerRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED);
            }
        }

        this.requestFilter?.(json);

        const result: any = await this._interactor.invoke(json);

        // If this was a session ended request, end the session in our internal state
        if (json.request.type === "SessionEndedRequest") {
            this.endSession2();
        }
        if (this.session) {
            this.session.new = false;
            if (result?.response?.shouldEndSession) {
                this.endSession2();
            } else if (result.sessionAttributes) {
                this.session.attributes = result.sessionAttributes;
            }
        }

        if (result.response?.directives) {
            for (const directive of result.response.directives) {
                await this.handleAudioDirective(directive);
            }
            // Update the dialog manager based on the results
            // Look for a dialog directive - trigger dialog mode if so
            for (const directive of result.response.directives) {
                if (directive.type.startsWith("Dialog")) {
                    if (directive.updatedIntent && !this.model.dialogIntent(directive.updatedIntent.name)) {
                        throw new Error("No match for dialog name: " + directive.updatedIntent.name);
                    }
                    this.dialogManager.handleDirective(directive);
                }
            }
        }

        // Resume the audio player, if suspended
        if (json.request.intent && this.device.audioPlayerSupported()) {
            if (this.audioPlayer._suspended) {
                this.audioPlayer._suspended = false;
                if (this.audioPlayer._activity !== AudioPlayerActivity.PLAYING) {
                    this.audioPlayer._activity = AudioPlayerActivity.PLAYING;
                    await this.audioPlayerRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STARTED);
                }
            }
        }

        return new SkillResponse(result);
    }

    private audioPlayerRequest(requestType: string) {
        const json = this.createRequestJson();
        json.request.type = requestType;
        json.request.token = this.audioPlayer.playingItem().token;
        json.request.offsetInMilliseconds = this.audioPlayer.playingItem().offsetInMilliseconds;
        return this.send(json);
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

    private async handleAudioDirective(directive: any): Promise<any> {
        if (directive.type === "AudioPlayer.Play") {
            if (directive.playBehavior === "ENQUEUE") {
                this.audioPlayer._queue.push(directive.audioItem.stream);
            } else if (directive.playBehavior === "REPLACE_ALL") {
                if (this.audioPlayer._activity === AudioPlayerActivity.PLAYING) {
                    this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
                    await this.audioPlayerRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED);
                }
                this.audioPlayer._queue = [directive.audioItem.stream];
            } else if (directive.playBehavior === "REPLACE_ENQUEUED") {
                this.audioPlayer._queue = [directive.audioItem.stream];
            }

            if (this.audioPlayer._activity !== AudioPlayerActivity.PLAYING && this.audioPlayer._queue.length !== 0) {
                // dequeue
                if (!this.audioPlayer._queue[0].url) {
                    return this.endSession(SessionEndedReason.ERROR, {
                        message: "The URL specified in the Play directive must be defined and a valid HTTPS url",
                        type: "INVALID_RESPONSE",
                    });
                } else if (this.audioPlayer._queue[0].url.startsWith("http:")) {
                    return this.endSession(SessionEndedReason.ERROR, {
                        message: "The URL specified in the Play directive must be HTTPS",
                        type: "INVALID_RESPONSE",
                    });
                }
                this.audioPlayer._activity = AudioPlayerActivity.PLAYING;
                return this.audioPlayerRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STARTED);
            }
        } else if (directive.type === "AudioPlayer.Stop") {
            if (this.audioPlayer._suspended) {
                this.audioPlayer._suspended = false;
            } else if (this.audioPlayer.playingItem()) {
                this.audioPlayer._activity = AudioPlayerActivity.STOPPED;
                await this.audioPlayerRequest(RequestType.AUDIO_PLAYER_PLAYBACK_STOPPED);
            }
        }
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
