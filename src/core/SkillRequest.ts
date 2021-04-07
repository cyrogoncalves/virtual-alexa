import { ConfirmationStatus, Device, DialogManager, DialogState } from './SkillContext';
import { AudioPlayer, AudioPlayerActivity } from '../audioPlayer/AudioPlayer';
import * as _ from 'lodash';
import { InteractionModel, SlotMatch } from '../model/InteractionModel';
import { SkillResponse } from './SkillResponse';
import * as uuid from 'uuid';
import { SkillInteractor } from '../interactor';
import { VirtualAlexa } from './VirtualAlexa';


export enum RequestType {
    CONNECTIONS_RESPONSE = "Connections.Response",
    DISPLAY_ELEMENT_SELECTED_REQUEST = "Display.ElementSelected",
    INTENT_REQUEST = "IntentRequest",
    LAUNCH_REQUEST = "LaunchRequest",
    SESSION_ENDED_REQUEST = "SessionEndedRequest",
    AUDIO_PLAYER_PLAYBACK_FINISHED = "AudioPlayer.PlaybackFinished",
    AUDIO_PLAYER_PLAYBACK_NEARLY_FINISHED = "AudioPlayer.PlaybackNearlyFinished",
    AUDIO_PLAYER_PLAYBACK_STARTED = "AudioPlayer.PlaybackStarted",
    AUDIO_PLAYER_PLAYBACK_STOPPED = "AudioPlayer.PlaybackStopped",
}

export enum SessionEndedReason {
    ERROR,
    EXCEEDED_MAX_REPROMPTS,
    USER_INITIATED,
}

/**
 * Creates a the JSON for a Service Request programmatically
 *
 * This class assists with setting all the values on the request.
 *
 * Additionally, the raw JSON can be accessed with the .json() property.
 */
export class SkillRequest {
    /**
     * The raw JSON of the request. This can be directly manipulated to modify what is sent to the skill.
     */
    public readonly json: any;

    public constructor(
        private readonly interactionModel: InteractionModel,
        private readonly _interactor: SkillInteractor,
        private requestFilter: (request: any) => void,
        locale: string,
        private readonly applicationId: string,
        public readonly audioPlayer0: AudioPlayer,
        private device: Device,
        private userId: string,
        private accessToken: string,
        apiAccessToken: string,
        apiEndpoint: string,
        private readonly dialogManager: DialogManager,
        private sessionManager: VirtualAlexa
    ) {
        // First create the header part of the request
        this.json = {
            context: {
                System: {
                    application: {
                        applicationId: this.applicationId,
                    },
                    device: {
                        supportedInterfaces: device.supportedInterfaces,
                    },
                    user: {
                        userId: userId,
                        ...(device.id && { permissions: { consentToken: uuid.v4() } }),
                        ...(accessToken && { accessToken: accessToken })
                    },
                },
            },
            request: {
                locale: locale || "en-US",
                requestId: "amzn1.echo-external.request." + uuid.v4(),
                timestamp: new Date().toISOString().substring(0, 19) + "Z",
            },
            version: "1.0",
        };

        // If the device ID is set, we set the API endpoint and deviceId properties
        if (device.id) {
            this.json.context.System.apiAccessToken = apiAccessToken;
            this.json.context.System.apiEndpoint = apiEndpoint;
            this.json.context.System.device.deviceId = device.id;
        }

        // If display enabled, we add a display object to context
        if (device.displaySupported()) {
            this.json.context.Display = {};
        }
    }

    /**
     * Creates an AudioPlayer request type
     * @param requestType One the of the AudioPlayer RequestTypes
     * @param token
     * @param offsetInMilliseconds
     */
    public audioPlayer(requestType: string, token: string, offsetInMilliseconds: number): SkillRequest {
        this.requestType(requestType);
        this.json.request.token = token;
        this.json.request.offsetInMilliseconds = offsetInMilliseconds;
        return this;
    }

    /**
     * Creates a connection response object - used by Alexa Connections such as In-Skill Purchases
     * @param requestName
     * @param payload The payload object
     * @param token The correlating token
     * @param statusCode The status code
     * @param statusMessage The status message
     */
    public connectionsResponse(requestName: string, payload: any, token: string, statusCode = 200, statusMessage = "OK"): SkillRequest {
        this.requestType(RequestType.CONNECTIONS_RESPONSE);
        this.json.request.name = requestName
        this.json.request.payload = payload
        this.json.request.token = token
        this.json.request.status = {
            code: statusCode,
            message: statusMessage
        }
        return this;
    }

    /**
     * Sets the dialog state for the request, as well as the internal dialog manager
     * @param state The dialog state
     */
    public dialogState(state: DialogState): SkillRequest {
        this.dialogManager.state(state);
        this.json.request.dialogState = state;
        return this;
    }

    /**
     * Creates a Display.ElementSelected request
     * @param token The token for the selected element
     */
    public elementSelected(token: any): SkillRequest {
        this.requestType(RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST);
        this.json.request.token = token;
        return this;
    }

    public inSkillPurchaseResponse(requestName: string,
                                   purchaseResult: string,
                                   productId: string,
                                   token: string,
                                   statusCode = 200,
                                   statusMessage = "OK"): SkillRequest {
        return this.connectionsResponse(requestName,
            {
                productId,
                purchaseResult,
            },
            token,
            statusCode,
            statusMessage
        )
    }

    /**
     * Sets the intent for the request
     * @param intentName
     * @param confirmationStatus
     * @returns {SkillRequest}
     */
    public intent(intentName: string, confirmationStatus: ConfirmationStatus = ConfirmationStatus.NONE): SkillRequest {
        this.requestType(RequestType.INTENT_REQUEST);
        if (!intentName.startsWith("AMAZON")) { // no built-in
            if (!this.interactionModel.intents.some(o => o.intent === intentName)) {
                throw new Error("Interaction model has no intentName named: " + intentName);
            }
        }

        this.json.request.intent = {
            confirmationStatus: confirmationStatus,
            name: intentName,
            slots: {},
        };

        // Set default slot values - all slots must have a value for an intent
        const slots = this.interactionModel.intents.find(o => o.intent === intentName)?.slots;
        slots?.forEach((intentSlot: any) =>
            this.json.request.intent.slots[intentSlot.name] = {
                name: intentSlot.name,
                confirmationStatus: ConfirmationStatus.NONE
            });

        if (this.interactionModel.dialogIntent(intentName)) {
            // Update the request JSON to have the correct dialog state
            this.json.request.dialogState = this.dialogManager.handleRequest();

            // Update the state of the slots in the dialog manager
            this.dialogManager.updateSlotStates(this.json.request.intent.slots);

            // Our slots can just be taken from the dialog manager now
            //  It has the complete current state of the slot values for the dialog intent
            this.json.request.intent.slots = this.dialogManager.slots();
        }

        return this;
    }

    /**
     * Sets the confirmation status of the intent
     * @param confirmationStatus The confirmation status of the intent
     */
    public intentStatus(confirmationStatus: ConfirmationStatus): SkillRequest {
        this.json.request.intent.confirmationStatus = confirmationStatus;
        return this;
    }

    /**
     * Creates a LaunchRequest request
     */
    public launch(): SkillRequest {
        this.requestType(RequestType.LAUNCH_REQUEST);
        return this;
    }

    public requestType(requestType: string): SkillRequest {
        this.json.request.type = requestType;

        // If we have a session, set the info
        if ([RequestType.LAUNCH_REQUEST, RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST,
            RequestType.INTENT_REQUEST, RequestType.SESSION_ENDED_REQUEST].includes(this.json.request.type)) {
            if (!this.sessionManager.session) {
                this.sessionManager.newSession();
            }
            this.json.session = {
                application: {
                    applicationId: this.applicationId,
                },
                new: this.sessionManager.session.new,
                sessionId: this.sessionManager.session.id,
                user: {
                    userId: this.userId,
                    ...(this.device.id && { permissions: {
                        consentToken: uuid.v4()
                    }}),
                    ...(this.accessToken && { accessToken: this.accessToken })
                },
                ...(this.json.request.type !== RequestType.LAUNCH_REQUEST && { attributes: this.sessionManager.session.attributes })
            };

            // For intent, launch and session ended requests, send the audio player state if there is one
            if (this.device.audioPlayerSupported()) {
                const activity = AudioPlayerActivity[this.audioPlayer0.playerActivity()];
                this.json.context.AudioPlayer = {
                    playerActivity: activity,
                };

                // Anything other than IDLE, we send token and offset
                if (this.audioPlayer0.playerActivity() !== AudioPlayerActivity.IDLE) {
                    const playing = this.audioPlayer0.playing();
                    this.json.context.AudioPlayer.token = playing.stream.token;
                    this.json.context.AudioPlayer.offsetInMilliseconds = playing.stream.offsetInMilliseconds;
                }
            }
        }

        return this;
    }

    /**
     * Creates a SessionEndedRequest request
     * @param reason The reason the session ended
     * @param errorData Error data, if any
     */
    public sessionEnded(reason: SessionEndedReason, errorData?: any): SkillRequest {
        this.requestType(RequestType.SESSION_ENDED_REQUEST);
        this.json.request.reason = SessionEndedReason[reason];
        if (errorData) {
            this.json.request.error = errorData;
        }
        return this;
    }

    /**
     * Convenience method to set properties on the request object - uses [lodash set]{@link https://lodash.com/docs/#set} under the covers.
     * Returns this for chaining
     * @param path The dot-notation path for the property to set
     * @param value The value to set it to
     */
    set(path: string|string[], value: any): SkillRequest {
        _.set(this.json, path, value);
        return this;
    }

    /**
     * Sets a slot value on the request
     * @param slotName
     * @param slotValue
     * @param confirmationStatus
     */
    public slot(slotName: string, slotValue: string, confirmationStatus = ConfirmationStatus.NONE): SkillRequest {
        const slots: any[] = this.interactionModel.intents
            .find(o => o.intent === this.json.request.intent.name)?.slots;
        if (!slots) {
            throw new Error("Trying to add slot to intent that does not have any slots defined");
        }

        const slotValueObject: any = {
            name: slotName,
            value: slotValue,
            confirmationStatus
        };
        const slot = slots?.find(s => slotName.toLowerCase() === s.name.toLowerCase());
        if (!slot) {
            throw new Error("Trying to add undefined slot to intent: " + slotName);
        }

        const slotType = this.interactionModel.slotTypes
            .find(o => o.name.toLowerCase() === slot.type.toLowerCase());
        // We only include the entity resolution for builtin types if they have been extended
        //  and for all custom slot types
        if (slotType && (!slotType.name.startsWith("AMAZON") || slotType.values.some(value => !value.builtin))) {
            const authority = `amzn1.er-authority.echo-sdk.${this.applicationId}.${slotType.name}`;

            const value = slotValue.trim();
            const matches: SlotMatch[] = [];
            for (const slotValue of slotType.values || []) {
                if (!slotValue.builtin) {
                    // First check the name value - the value and the synonyms are both valid matches
                    // Refer here for definitive rules:
                    //  https://developer.amazon.com/docs/custom-skills/
                    //      define-synonyms-and-ids-for-slot-type-values-entity-resolution.html
                    if (slotValue.name.value.toLowerCase() === value.toLowerCase()) {
                        matches.push(new SlotMatch(value, slotValue));
                    } else if (slotValue.name.synonyms) {
                        matches.push(...slotValue.name.synonyms
                            .filter(synonym => synonym.toLowerCase() === value.toLowerCase())
                            .map(() => new SlotMatch(value, slotValue)));
                    }
                }
            }

            const resolutionsPerAuthority: {
                values: EntityResolutionValue[];
                status: {
                    code: EntityResolutionStatus
                };
                authority: string;
            }[] = [];
            // If this is not a builtin value, we add the entity resolution
            if (!matches.length) {
                this.addEntityResolution(resolutionsPerAuthority, authority);
            } else {
                // Possible to have multiple matches, where we have overlapping synonyms
                matches.forEach(match => this.addEntityResolution(resolutionsPerAuthority, authority,
                    [{ value: { id: match.enumeratedValue.id, name: match.enumeratedValue.name.value } }]));
            }
            slotValueObject.resolutionsPerAuthority = resolutionsPerAuthority;
        }
        this.json.request.intent.slots[slotName] = slotValueObject;

        if (this.interactionModel.dialogIntent(this.json.request.intent.name)) {
            // Update the internal state of the dialog manager based on this request
            this.dialogManager.updateSlot(slotName, slotValueObject);
        }

        return this;
    }

    /**
     * Sends the request to the Alexa skill
     */
    public async send(): Promise<SkillResponse> {
        // When the user utters an intent, we suspend for it
        // We do this first to make sure everything is in the right state for what comes next
        if (this.json.request.intent
            && this.device.audioPlayerSupported()
            && this.audioPlayer0.isPlaying()) {
            await this.audioPlayer0.suspend();
        }

        this.requestFilter?.(this.json);

        const result: any = await this._interactor.invoke(this.json);

        // If this was a session ended request, end the session in our internal state
        if (this.json.request.type === "SessionEndedRequest") {
            this.sessionManager.endSession2();
        }
        if (this.sessionManager.session) {
            this.sessionManager.session.new = false;
            if (result?.response?.shouldEndSession) {
                this.sessionManager.endSession2();
            } else if (result.sessionAttributes) {
                this.sessionManager.session.attributes = result.sessionAttributes;
            }
        }

        if (result.response?.directives) {
            await this.audioPlayer0.directivesReceived(result.response.directives);
            // Update the dialog manager based on the results
            // Look for a dialog directive - trigger dialog mode if so
            for (const directive of result.response.directives) {
                if (directive.type.startsWith("Dialog")) {
                    if (directive.updatedIntent && !this.interactionModel.dialogIntent(directive.updatedIntent.name)) {
                        throw new Error("No match for dialog name: " + directive.updatedIntent.name);
                    }
                    this.dialogManager.handleDirective(directive);
                }
            }
        }

        // Resume the audio player, if suspended
        if (this.json.request.intent
            && this.device.audioPlayerSupported()
            && this.audioPlayer0.suspended()) {
            await this.audioPlayer0.resume();
        }

        return new SkillResponse(result);
    }

    /**
     * Sets slot values as a dictionary of strings on the request
     */
    public slots(slots: {[id: string]: string}): SkillRequest {
        slots && Object.entries(slots).forEach(([name, value]) => this.slot(name, value));
        return this;
    }

    /**
     * For dialogs, updates the confirmation status of a slot - does not change the value
     * @param slotName
     * @param confirmationStatus
     */
    public slotStatus(slotName: string, confirmationStatus: ConfirmationStatus): SkillRequest {
        this.dialogManager.slots()[slotName].confirmationStatus = confirmationStatus;
        return this;
    }

    private addEntityResolution(resolutionsPerAuthority: any[], authority: string, values: EntityResolutionValue[] = []) {
        const existingResolution = resolutionsPerAuthority.find(resolution => resolution.authority === authority);
        if (existingResolution) {
            existingResolution.values.push(values[0]);
        } else {
            const code = values?.length ? EntityResolutionStatus.ER_SUCCESS_MATCH : EntityResolutionStatus.ER_SUCCESS_NO_MATCH
            resolutionsPerAuthority.push({ authority, values, status: { code } });
        }
    }
}

interface EntityResolutionValue {
    value: {
        id: string,
        name: string
    }
}

enum EntityResolutionStatus {
    ER_SUCCESS_MATCH = "ER_SUCCESS_MATCH",
    ER_SUCCESS_NO_MATCH = "ER_SUCCESS_NO_MATCH",
    // ER_ERROR_TIMEOUT = "ER_ERROR_TIMEOUT",
    // ER_ERROR_EXCEPTION = "ER_ERROR_EXCEPTION",
}