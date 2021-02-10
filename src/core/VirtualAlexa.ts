import { AudioPlayer } from "../audioPlayer/AudioPlayer";
import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { SkillInteractor } from "../interactor";
import { InteractionModel } from "../model/InteractionModel";
import { SkillContext } from "./SkillContext";
import { SessionEndedReason, SkillRequest } from "./SkillRequest";
import { SkillResponse } from "./SkillResponse";
import { UserAPI } from "../external/UserAPI";
import { VirtualAlexaBuilder } from '../builder';

export class VirtualAlexa {
    public static Builder = () => new VirtualAlexaBuilder();

    private requestFilter: (request: any) => void;
    public readonly addressAPI: AddressAPI;
    public readonly userAPI: UserAPI;
    public readonly context: SkillContext;
    public readonly dynamoDB: DynamoDB;
    
    /** @internal */
    public constructor(
        /** @internal */
        private readonly _interactor: SkillInteractor,
        model: InteractionModel,
        locale: string,
        applicationID?: string
    ) {
        const audioPlayer = new AudioPlayer(this);
        this.context = new SkillContext(model, audioPlayer, locale, applicationID);
        this.addressAPI = new AddressAPI(this.context);
        this.userAPI = new UserAPI(this.context);
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
        return new SkillRequest(this.context, this._interactor, this.requestFilter);
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

        const { slots, intent, slotNames } = this.context.interactionModel.utterance(resolvedUtterance);
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
