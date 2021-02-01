import { AudioPlayer } from "../audioPlayer/AudioPlayer";
import { AddressAPI } from "../external/AddressAPI";
import { DynamoDB } from "../external/DynamoDB";
import { LocalSkillInteractor } from "../impl/LocalSkillInteractor";
import { RemoteSkillInteractor } from "../impl/RemoteSkillInteractor";
import { SkillInteractor } from "../impl/SkillInteractor";
import { IntentSchema } from "../model/IntentSchema";
import { InteractionModel } from "../model/InteractionModel";
import { SampleUtterances } from "../virtualCore/SampleUtterances";
import { SkillContext } from "./SkillContext";
import { SessionEndedReason, SkillRequest } from "./SkillRequest";
import { SkillResponse } from "./SkillResponse";
import { UserAPI } from "../external/UserAPI";
import { Utterance } from '../virtualCore/Utterance';


export class VirtualAlexa {
    public static Builder(): VirtualAlexaBuilder {
        return new VirtualAlexaBuilder();
    }

    /** @internal */
    private readonly _interactor: SkillInteractor;
    private requestFilter: RequestFilter;
    public readonly addressAPI: AddressAPI;
    public readonly userAPI: UserAPI;
    public readonly context: SkillContext;
    public readonly dynamoDB: DynamoDB;
    
    /** @internal */
    public constructor(interactor: SkillInteractor, model: InteractionModel, locale: string, applicationID?: string) {
        const audioPlayer = new AudioPlayer(this);
        this.context = new SkillContext(model, audioPlayer, locale, applicationID);
        this._interactor = interactor;
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
        const launchRequestOrUtter = VirtualAlexa.parseLaunchRequest(utteranceString);
        if (launchRequestOrUtter === true) {
            return this.launch();
        } else if (launchRequestOrUtter) {
            resolvedUtterance = launchRequestOrUtter;
        }

        const utterance = new Utterance(this.context.interactionModel, resolvedUtterance);
        // If we don't match anything, we use the default utterance - simple algorithm for this
        if (!utterance.matched()) {
            throw new Error("Unable to match utterance: " + resolvedUtterance
                + " to an intent. Try a different utterance, or explicitly set the intent");
        }

        return this.request()
            .intent(utterance.intent())
            .slots(utterance.toJSON())
            .send();
    }

    private static parseLaunchRequest(utter: string): string | boolean {
        const launchRequestRegex = /(ask|open|launch|talk to|tell).*/i;
        if (launchRequestRegex.test(utter)) {
            const launchAndUtterRegex = /^(?:ask|open|launch|talk to|tell) .* to (.*)/i;
            const result = launchAndUtterRegex.exec(utter);
            return result?.length ? result[1] : true;
        }
        return undefined;
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
    private _handler: string | ((...args: any[]) => void);
    /** @internal */
    private _intentSchema: any;
    /** @internal */
    private _intentSchemaFile: string;
    /** @internal */
    private _interactionModel: string;
    /** @internal */
    private _interactionModelFile: string;
    /** @internal */
    private _sampleUtterances: any;
    /** @internal */
    private _sampleUtterancesFile: string;
    /** @internal */
    private _skillURL: string;
    /** @internal */
    private _locale: string = "en-US";

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
     * The name of the handler, or the handler function itself, for a Lambda to be called<br>
     * The name should be in the format "index.handler" where:<br>
     * `index` is the name of the file - such as index.js<br>
     * `handler` is the name of the exported function to call on the file<br>
     * @param {string | Function} handlerName
     * @returns {VirtualAlexaBuilder}
     */
    public handler(handlerName: string | ((...args: any[]) => void)): VirtualAlexaBuilder {
        this._handler = handlerName;
        return this;
    }

    /**
     * JSON that corresponds to the intent schema<br>
     * If the intent schema is provided, a {@link VirtualAlexaBuilder.sampleUtterances} JSON must also be supplied
     * @param json
     * @returns {VirtualAlexaBuilder}
     */
    public intentSchema(json: any): VirtualAlexaBuilder {
        this._intentSchema = json;
        return this;
    }

    /**
     * Path to intent schema file<br>
     * To be provided along with {@link VirtualAlexaBuilder.sampleUtterancesFile}<br>
     * @param {string} filePath
     * @returns {VirtualAlexaBuilder}
     */
    public intentSchemaFile(filePath: any): VirtualAlexaBuilder {
        this._intentSchemaFile = filePath;
        return this;
    }

    /**
     * JSON that corresponds to the new, unified interaction model
     * @param json
     * @returns {VirtualAlexaBuilder}
     */
    public interactionModel(json: any): VirtualAlexaBuilder {
        this._interactionModel = json;
        return this;
    }

    /**
     * File path that contains to the new, unified interaction model
     * @param filePath The path to the interaction model file
     * @returns {VirtualAlexaBuilder}
     */
    public interactionModelFile(filePath: string): VirtualAlexaBuilder {
        this._interactionModelFile = filePath;
        return this;
    }

    /**
     * JSON that corresponds to the sample utterances<br>
     * Provided along with {@link VirtualAlexaBuilder.intentSchema}<br>
     * The sample utterances should be in the form:
     * ```javascript
     * {
     *      "Intent": ["Sample1", "Sample2"],
     *      "IntentTwo": ["AnotherSample"]
     * }
     * ```
     * @param utterances The sample utterances in JSON format
     * @returns {VirtualAlexaBuilder}
     */
    public sampleUtterances(utterances: any): VirtualAlexaBuilder {
        this._sampleUtterances = utterances;
        return this;
    }

    /**
     * File path to sample utterances file<br>
     * To be provided along with {@link VirtualAlexaBuilder.intentSchemaFile}<br>
     * Format is the same as in the Alexa Developer Console - a simple text file of intents and utterances
     * @param {string} filePath
     * @returns {VirtualAlexaBuilder}
     */
    public sampleUtterancesFile(filePath: string): VirtualAlexaBuilder {
        this._sampleUtterancesFile = filePath;
        return this;
    }

    /**
     * The URL of the skill to be tested
     * @param {string} url
     * @returns {VirtualAlexaBuilder}
     */
    public skillURL(url: string): VirtualAlexaBuilder {
        this._skillURL = url;
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
        let model;
        if (this._interactionModel) {
            model = InteractionModel.fromJSON(this._interactionModel);

        } else if (this._interactionModelFile) {
            model = InteractionModel.fromFile(this._interactionModelFile);

        } else if (this._intentSchema && this._sampleUtterances) {
            const schema = IntentSchema.fromJSON(this._intentSchema);
            const utterances = SampleUtterances.fromJSON(this._sampleUtterances);
            model = new InteractionModel(schema, utterances);

        } else if (this._intentSchemaFile && this._sampleUtterancesFile) {
            const schema = IntentSchema.fromFile(this._intentSchemaFile);
            const utterances = SampleUtterances.fromFile(this._sampleUtterancesFile);
            model = new InteractionModel(schema, utterances);
        } else {
            model = InteractionModel.fromLocale(this._locale);
            if (!model) {
                throw new Error(
                    "Either an interaction model or intent schema and sample utterances must be provided.\n" +
                    "Alternatively, if you specify a locale, Virtual Alexa will automatically check for the " +
                    "interaction model under the directory \"./models\" - e.g., \"./models/en-US.json\"");
            }
        }

        let interactor;
        if (this._handler) {
            interactor = new LocalSkillInteractor(this._handler);
        } else if (this._skillURL) {
            interactor = new RemoteSkillInteractor(this._skillURL);
        } else {
            throw new Error("Either a handler or skillURL must be provided.");
        }

        return new VirtualAlexa(interactor, model, this._locale, this._applicationID);
    }
}
