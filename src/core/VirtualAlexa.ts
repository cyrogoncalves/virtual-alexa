import { AudioPlayer } from "../audioPlayer/AudioPlayer";
import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { LocalSkillInteractor } from "../impl/LocalSkillInteractor";
import { RemoteSkillInteractor } from "../impl/RemoteSkillInteractor";
import { SkillInteractor } from "../impl/SkillInteractor";
import { IntentSchema, InteractionModel } from "../model/InteractionModel";
import { SkillContext } from "./SkillContext";
import { SessionEndedReason, SkillRequest } from "./SkillRequest";
import { SkillResponse } from "./SkillResponse";
import { UserAPI } from "../external/UserAPI";
import * as fs from "fs";


export class VirtualAlexa {
    public static Builder(): VirtualAlexaBuilder {
        return new VirtualAlexaBuilder();
    }

    private requestFilter: RequestFilter;
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
     * Sends a SessionEndedRequest to the skill
     * Does not wait for a reply, as there should be none
     * @returns {Promise<SkillResponse>}
     */
    public endSession(sessionEndedReason: SessionEndedReason = SessionEndedReason.USER_INITIATED,
            errorData?: any): Promise<SkillResponse> {
        return this.request().sessionEnded(sessionEndedReason, errorData).send();
    }

    /**
     * Set a filter on requests - for manipulating the payload before it is sent
     * @param {RequestFilter} requestFilter
     * @returns {VirtualAlexa}
     */
    public filter(requestFilter: RequestFilter): VirtualAlexa {
        this.requestFilter = requestFilter;
        return this;
    }

    public resetFilter(): VirtualAlexa {
        this.requestFilter = undefined;
        return this;
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

export type RequestFilter = (request: any) => void;

/**
 * Configuration object for VirtualAlexa.<br>
 * <br>
 * Callers must provide:<br>
 * 1) An interaction model or combination of intent schema and sample utterances<br>
 * These can be provided either as files or JSON<br>
 * 2) A handler name or skill URL<br>
 * The VirtualAlexa will either run a Lambda locally, or interact with a skill via HTTP<br>
 * <br>
 * Once the object is configured properly, create it by calling {@link VirtualAlexaBuilder.create}
 *
 */
export class VirtualAlexaBuilder {
    /** @internal */
    private _applicationID: string;
    /** @internal */
    private _locale: string = "en-US";
    /** @internal */
    private _model: InteractionModel;
    /** @internal */
    private _interactor: SkillInteractor;

    /**
     * The application ID of the skill [Optional]
     * @param {string} id
     * @returns {VirtualAlexaBuilder}
     */
    public applicationID(id: string): VirtualAlexaBuilder {
        this._applicationID = id;
        return this;
    }

    /**
     * JSON that corresponds to the new, unified interaction model
     * @param json
     * @returns {VirtualAlexaBuilder}
     */
    public interactionModel(json: any): VirtualAlexaBuilder {
        this._model = InteractionModel.fromJSON(json);
        return this;
    }

    /**
     * File path that contains to the new, unified interaction model
     * @param filePath The path to the interaction model file
     * @returns {VirtualAlexaBuilder}
     */
    public interactionModelFile(filePath: string): VirtualAlexaBuilder {
        // Parse the all-in-one interaction model as a file
        try {
            const data = fs.readFileSync(filePath);
            const json = JSON.parse(data.toString());
            return this.interactionModel(json);
        } catch (error) {
            throw !error.message.includes("ENOENT") ? error : new Error(
                "The interaction model for your Alexa Skill could not be found under:\n" +
                    filePath + "\nPlease provide the correct location of the Interaction Model.");
        }
    }

    /**
     * A schema JSON with it's samples.
     * The sample utterances should be in the form:
     * ```javascript
     * {
     *      "Intent": ["Sample1", "Sample2"],
     *      "IntentTwo": ["AnotherSample"]
     * }
     * ```
     * @param schema JSON that corresponds to the intent schema
     * @param utterances The sample utterances in JSON format
     * @returns {VirtualAlexaBuilder}
     */
    public intentSchema(schema: any, utterances: { [intent: string]: string[] }): VirtualAlexaBuilder {
        this._model = new InteractionModel(new IntentSchema(schema.intents), utterances);
        return this;
    }

    /**
     * Format is the same as in the Alexa Developer Console - a simple text file of intents and utterances<br>
     * @param {string} intentSchemaFilePath Path to intent schema file
     * @param {string} sampleUtterancesFilePath File path to sample utterances file
     * @returns {VirtualAlexaBuilder}
     */
    public intentSchemaFile(intentSchemaFilePath: string, sampleUtterancesFilePath: string): VirtualAlexaBuilder {
        const data = fs.readFileSync(intentSchemaFilePath);
        const json = JSON.parse(data.toString());
        const schema = new IntentSchema(json.intents);

        // const utterances = SampleUtterances.fromFile(sampleUtterancesFilePath);
        const utterancesData = fs.readFileSync(sampleUtterancesFilePath);
        const lines = utterancesData.toString().split("\n");
        const utterancesJson: {[intent: string]: string[]} = {};
        for (const line of lines) {
            if (line.trim().length === 0) {
                // We skip blank lines - which is what Alexa does
                continue;
            }

            const index = line.indexOf(" ");
            if (index === -1) {
                throw Error("Invalid sample utterance: " + line);
            }

            const intent = line.substr(0, index);
            const sample = line.substr(index).trim();
            if (!utterancesJson[intent]) {
                utterancesJson[intent] = []
            }
            utterancesJson[intent].push(sample);
        }

        this._model = new InteractionModel(schema, utterancesJson);
        return this;
    }

    /**
     * The name of the handler, or the handler function itself, for a Lambda to be called<br>
     * The name should be in the format "index.handler" where:<br>
     * `index` is the name of the file - such as index.js<br>
     * `handler` is the name of the exported function to call on the file<br>
     * @param {string | Function} handlerName
     * @returns {VirtualAlexaBuilder}
     */
    public handler(handlerName: string | ((...args: any[]) => void)): VirtualAlexaBuilder {
        this._interactor = new LocalSkillInteractor(handlerName);
        return this;
    }

    /**
     * The URL of the skill to be tested
     * @param {string} url
     * @returns {VirtualAlexaBuilder}
     */
    public skillURL(url: string): VirtualAlexaBuilder {
        this._interactor = new RemoteSkillInteractor(url);
        return this;
    }

    /**
     * The Locale that is going to be tested
     * @param {string} locale
     * @returns {VirtualAlexaBuilder}
     */
    public locale(locale: string): VirtualAlexaBuilder {
        this._locale = locale;
        return this;
    }

    public create(): VirtualAlexa {
        if (!this._model) {
            const modelPath = `./models/${this._locale}.json`;
            if (!fs.existsSync(modelPath)) {
                throw new Error(
                    "Either an interaction model or intent schema and sample utterances must be provided.\n" +
                    "Alternatively, if you specify a locale, Virtual Alexa will automatically check for the " +
                    "interaction model under the directory \"./models\" - e.g., \"./models/en-US.json\"");
            }
            this.interactionModelFile(modelPath);
        }

        if (!this._interactor) {
            throw new Error("Either a handler or skillURL must be provided.");
        }

        return new VirtualAlexa(this._interactor, this._model, this._locale, this._applicationID);
    }
}
