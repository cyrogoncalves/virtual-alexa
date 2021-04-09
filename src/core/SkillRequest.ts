import { ConfirmationStatus, Device, DialogManager } from './SkillContext';
import { AudioPlayer, AudioPlayerActivity } from '../audioPlayer/AudioPlayer';
import * as _ from 'lodash';
import { InteractionModel } from '../model/InteractionModel';
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
 * Creates a the JSON for a Service Request programmatically.
 * This class assists with setting all the values on the request.
 * Additionally, the raw JSON can be accessed with the .json() property.
 */
export class SkillRequest {
    public constructor(
        public readonly json: any,
        private readonly interactionModel: InteractionModel,
        private readonly _interactor: SkillInteractor,
        private requestFilter: (request: any) => void,
        private readonly applicationId: string,
        public readonly audioPlayer0: AudioPlayer,
        private device: Device,
        private userId: string,
        private accessToken: string,
        private readonly dialogManager: DialogManager,
        private sessionManager: VirtualAlexa
    ) {
    }

    /**
     * Creates an AudioPlayer request type
     * @param requestType One the of the AudioPlayer RequestTypes
     * @param token
     * @param offsetInMilliseconds
     */
    public audioPlayer(requestType: string, token: string, offsetInMilliseconds: number): SkillRequest {
        this.json.request.type = requestType;
        this.json.request.token = token;
        this.json.request.offsetInMilliseconds = offsetInMilliseconds;
        return this;
    }

    /**
     * Sets the intent for the request
     * @param intentName
     * @param confirmationStatus
     * @returns {SkillRequest}
     */
    public intent(intentName: string, confirmationStatus: ConfirmationStatus = ConfirmationStatus.NONE): SkillRequest {
        this.json.request.type = RequestType.INTENT_REQUEST;
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
        this.json.request.type = RequestType.LAUNCH_REQUEST;
        return this;
    }

    /**
     * Creates a SessionEndedRequest request
     * @param reason The reason the session ended
     * @param errorData Error data, if any
     */
    public sessionEnded(reason: SessionEndedReason, errorData?: any): SkillRequest {
        this.json.request.type = RequestType.SESSION_ENDED_REQUEST;
        this.json.request.reason = reason;
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
        if (!slots) throw new Error("Trying to add slot to intent that does not have any slots defined");
        const comp = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
        const slot = slots?.find(s => comp(slotName, s.name));
        if (!slot) throw new Error("Trying to add undefined slot to intent: " + slotName);

        const resolutionsPerAuthority: {
            values: EntityResolutionValue[];
            status: {
                code: EntityResolutionStatus
            };
            authority: string;
        }[] = [];
        const slotType = this.interactionModel.slotTypes.find(o => comp(o.name, slot.type));
        // We only include the entity resolution for builtin types if they have been extended
        //  and for all custom slot types.
        // If this is not a builtin value, we add the entity resolution.
        if (slotType && (!slotType.name.startsWith("AMAZON") || slotType.values.some(value => !value.builtin))) {
            const authority = `amzn1.er-authority.echo-sdk.${this.applicationId}.${slotType.name}`;

            slotType.values?.filter(sv => !sv.builtin).forEach(enumeratedValue => {
                // First check the name value - the value and the synonyms are both valid matches
                // Refer here for definitive rules:
                //  https://developer.amazon.com/docs/custom-skills/
                //      define-synonyms-and-ids-for-slot-type-values-entity-resolution.html
                const count = comp(enumeratedValue.name.value, slotValue) ? 1
                    // Possible to have multiple matches, where we have overlapping synonyms
                    : (enumeratedValue.name.synonyms?.filter(synonym => comp(synonym, slotValue)).length ?? 0);
                const values = new Array(count).fill({value: {
                    id: enumeratedValue.id, name: enumeratedValue.name.value}
                });
                if (count) {
                    const existingResolution = resolutionsPerAuthority.find(resolution => resolution.authority === authority);
                    if (existingResolution) {
                        existingResolution.values.push(...values);
                    } else {
                        resolutionsPerAuthority.push({
                            authority,
                            values: values,
                            status: {code: EntityResolutionStatus.ER_SUCCESS_MATCH}
                        });
                    }
                }
            });

            if (!resolutionsPerAuthority.length) {
                resolutionsPerAuthority.push({
                    authority,
                    values: [],
                    status: {code: EntityResolutionStatus.ER_SUCCESS_NO_MATCH}
                });
            }
        }

        const slotValueObject = {
            name: slotName,
            value: slotValue,
            confirmationStatus,
            ...(resolutionsPerAuthority.length && { resolutionsPerAuthority })
        };
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
        // If we have a session, set the info
        if ([RequestType.LAUNCH_REQUEST, RequestType.INTENT_REQUEST, RequestType.SESSION_ENDED_REQUEST,
            RequestType.DISPLAY_ELEMENT_SELECTED_REQUEST].includes(this.json.request.type)) {
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