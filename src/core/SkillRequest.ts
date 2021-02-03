import { SkillContext, ConfirmationStatus, DialogState } from './SkillContext';
import { AudioPlayerActivity } from '../audioPlayer/AudioPlayer';
import * as _ from 'lodash';
import { SlotValue } from '../model/InteractionModel';
import { SkillResponse } from './SkillResponse';
import * as uuid from 'uuid';
import { RequestFilter } from './VirtualAlexa';
import { SkillInteractor } from '../impl/SkillInteractor';


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
        private readonly context: SkillContext,
        private readonly _interactor: SkillInteractor,
        private requestFilter: RequestFilter
    ) {
        // First create the header part of the request
        const baseRequest: any = {
            context: {
                System: {
                    application: {
                        applicationId: context.applicationID(),
                    },
                    device: {
                        supportedInterfaces: context.device.supportedInterfaces,
                    },
                    user: {
                        userId: context.userId,
                        ...(context.device.id && { permissions: { consentToken: uuid.v4() } }),
                        ...(context.accessToken && { accessToken: context.accessToken })
                    },
                },
            },
            request: {
                locale: context.locale(),
                requestId: "amzn1.echo-external.request." + uuid.v4(),
                timestamp: new Date().toISOString().substring(0, 19) + "Z",
            },
            version: "1.0",
        };

        // If the device ID is set, we set the API endpoint and deviceId properties
        if (context.device.id) {
            baseRequest.context.System.apiAccessToken = context.apiAccessToken;
            baseRequest.context.System.apiEndpoint = context.apiEndpoint;
            baseRequest.context.System.device.deviceId = context.device.id;
        }

        // If display enabled, we add a display object to context
        if (context.device.displaySupported()) {
            baseRequest.context.Display = {};
        }

        this.json = baseRequest;
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
        this.context.dialogManager.state(state);
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
            if (!this.context.interactionModel.intentSchema.hasIntent(intentName)) {
                throw new Error("Interaction model has no intentName named: " + intentName);
            }
        }

        this.json.request.intent = {
            confirmationStatus: confirmationStatus,
            name: intentName,
            slots: {},
        };

        // Set default slot values - all slots must have a value for an intent
        const intent = this.context.interactionModel.intentSchema.intent(intentName);
        intent.slots?.forEach((intentSlot: any) =>
            this.json.request.intent.slots[intentSlot.name] = {
                name: intentSlot.name,
                confirmationStatus: ConfirmationStatus.NONE
            });

        if (this.context.interactionModel.dialogIntent(intentName)) {
            // Update the request JSON to have the correct dialog state
            this.json.request.dialogState = this.context.dialogManager.handleRequest();

            // Update the state of the slots in the dialog manager
            this.context.dialogManager.updateSlotStates(this.json.request.intent.slots);

            // Our slots can just be taken from the dialog manager now
            //  It has the complete current state of the slot values for the dialog intent
            this.json.request.intent.slots = this.context.dialogManager.slots();
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
            if (!this.context.session) {
                this.context.newSession();
            }
            this.json.session = {
                application: {
                    applicationId: this.context.applicationID(),
                },
                new: this.context.session.new,
                sessionId: this.context.session.id,
                user: {
                    userId: this.context.userId,
                    ...(this.context.device.id && { permissions: {
                        consentToken: uuid.v4()
                    }}),
                    ...(this.context.accessToken && { accessToken: this.context.accessToken })
                },
                ...(this.json.request.type !== RequestType.LAUNCH_REQUEST && { attributes: this.context.session.attributes })
            };

            // For intent, launch and session ended requests, send the audio player state if there is one
            if (this.context.device.audioPlayerSupported()) {
                const activity = AudioPlayerActivity[this.context.audioPlayer.playerActivity()];
                this.json.context.AudioPlayer = {
                    playerActivity: activity,
                };

                // Anything other than IDLE, we send token and offset
                if (this.context.audioPlayer.playerActivity() !== AudioPlayerActivity.IDLE) {
                    const playing = this.context.audioPlayer.playing();
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
        const intent = this.context.interactionModel.intentSchema.intent(this.json.request.intent.name);
        if (!intent.slots) {
            throw new Error("Trying to add slot to intent that does not have any slots defined");
        }

        const slotValueObject = new SlotValue(slotName, slotValue, confirmationStatus);
        const slot = intent.slots?.find(slot => slotName.toLowerCase() === slot.name.toLowerCase()) || undefined;
        if (!slot) {
            throw new Error("Trying to add undefined slot to intent: " + slotName);
        }

        const slotType = this.context.interactionModel.slotTypes
            .find(o => o.name.toLowerCase() === slot.type.toLowerCase());
        // We only include the entity resolution for builtin types if they have been extended
        //  and for all custom slot types
        if (slotType?.isCustom()) {
            // slotValueObject.setEntityResolution(this.context.applicationID(), slotType);
            const authority = `amzn1.er-authority.echo-sdk.${this.context.applicationID()}.${slotType.name}`;
            const matches = slotType.matchAll(slotValueObject.value).filter(m => m.enumeratedValue && !m.enumeratedValue.builtin);
            // If this is not a builtin value, we add the entity resolution
            if (!matches.length) {
                slotValueObject.addEntityResolution(authority);
            } else {
                // Possible to have multiple matches, where we have overlapping synonyms
                matches.forEach(match => slotValueObject.addEntityResolution(authority,
                    [{ value: { id: match.enumeratedValue.id, name: match.enumeratedValue.name.value } }]));
            }
        }
        this.json.request.intent.slots[slotName] = slotValueObject;

        if (this.context.interactionModel.dialogIntent(this.json.request.intent.name)) {
            // Update the internal state of the dialog manager based on this request
            this.context.dialogManager.updateSlot(slotName, slotValueObject);
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
            && this.context.device.audioPlayerSupported()
            && this.context.audioPlayer.isPlaying()) {
            await this.context.audioPlayer.suspend();
        }

        this.requestFilter?.(this.json);

        const result: any = await this._interactor.invoke(this.json);

        // If this was a session ended request, end the session in our internal state
        if (this.json.request.type === "SessionEndedRequest") {
            this.context.endSession();
        }
        if (this.context.session) {
            this.context.session.new = false;
            if (result?.response?.shouldEndSession) {
                this.context.endSession();
            } else if (result.sessionAttributes) {
                this.context.session.attributes = result.sessionAttributes;
            }
        }

        if (result.response?.directives) {
            await this.context.audioPlayer.directivesReceived(result.response.directives);
            // Update the dialog manager based on the results
            this.context.dialogManager.handleDirective(result.response.directives, this.context);
        }

        // Resume the audio player, if suspended
        if (this.json.request.intent
            && this.context.device.audioPlayerSupported()
            && this.context.audioPlayer.suspended()) {
            await this.context.audioPlayer.resume();
        }

        return new SkillResponse(result);
    }

    /**
     * Sets slot values as a dictionary of strings on the request
     */
    public slots(slots: {[id: string]: string}): SkillRequest {
        if (slots) {
            for (const slot of Object.keys(slots)) {
                const slotValue = slots[slot];
                this.slot(slot, slotValue);
            }
        }
        return this;
    }

    /**
     * For dialogs, updates the confirmation status of a slot - does not change the value
     * @param slotName
     * @param confirmationStatus
     */
    public slotStatus(slotName: string, confirmationStatus: ConfirmationStatus): SkillRequest {
        this.context.dialogManager.slots()[slotName].confirmationStatus = confirmationStatus;
        return this;
    }
}
