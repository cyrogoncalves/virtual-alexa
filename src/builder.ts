import * as fs from "fs";
import { InteractionModel } from './model/InteractionModel';
import { LocalSkillInteractor, RemoteSkillInteractor, SkillInteractor } from './interactor';
import { VirtualAlexa } from './core/VirtualAlexa';

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
    // Parse the all-in-one interaction model as JSON
    // Using this for reference:
    //  https://github.com/alexa/skill-sample-nodejs-team-lookup/blob/master/speech-assets/interaction-model.json
    // For the official interaction model that is part of SMAPI,
    //  we pull the data off of the interactionModel.languageModel element
    let languageModel = json.languageModel || json.interactionModel?.languageModel || json;
    // The name of the intent is on the property "name" instead of "intent" for the unified model
    languageModel.intents.forEach((intent: any) => intent.intent = intent.name);
    const sampleJSON: any = {};
    languageModel.intents.forEach((intent: any) => sampleJSON[intent.name] = intent.samples);

    this._model = new InteractionModel(languageModel.intents, sampleJSON, languageModel.types || []);
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
    this._model = new InteractionModel(schema.intents, utterances);
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

    this._model = new InteractionModel(json.intents, utterancesJson);
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
