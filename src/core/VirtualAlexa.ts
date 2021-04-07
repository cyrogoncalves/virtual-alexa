import { AudioPlayer } from "../audioPlayer/AudioPlayer";
import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { SkillInteractor } from "../interactor";
import { InteractionModel } from "../model/InteractionModel";
import { Device, DialogManager, SkillSession } from "./SkillContext";
import { SessionEndedReason, SkillRequest } from "./SkillRequest";
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
    private readonly audioPlayer : AudioPlayer;

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
        this.audioPlayer = new AudioPlayer(this);
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
    public endSession(sessionEndedReason: SessionEndedReason = SessionEndedReason.USER_INITIATED,
            errorData?: any): Promise<SkillResponse> {
        return this.request().sessionEnded(sessionEndedReason, errorData).send();
    }

    /**
     * Sends the specified intent, with the optional map of slot values
     * @param {string} intentName
     * @param {[id: string]: string} slots
     * @returns {Promise<SkillResponse>}
     */
    public intend(intentName: string, slots?: {[id: string]: string}): Promise<SkillResponse> {
        return this.request().intent(intentName).slots(slots).send();
    }

    /**
     * Get skill request instance to build a request from scratch.
     * 
     * Useful for highly customized JSON requests
     */
    public request(): SkillRequest {
        return new SkillRequest(this.model, this._interactor, this.requestFilter,
            this.locale, this.applicationID, this.audioPlayer, this.device, this.userId, this.accessToken,
            this.apiAccessToken, this.apiEndpoint, this.dialogManager,
            this);
    }
    
    /**
     * Sends a Display.ElementSelected request with the specified token
     * @param {string} token
     * @returns {Promise<SkillResponse>}
     */
    public selectElement(token: any): Promise<SkillResponse> {
        return this.request().elementSelected(token).send();
    }

    /**
     * Sends a launch request to the skill
     * @returns {Promise<SkillResponse>}
     */
    public launch(): Promise<SkillResponse> {
        return this.request().launch().send();
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
        return this.request()
            .intent(intent)
            .slots(json)
            .send();
    }
}
