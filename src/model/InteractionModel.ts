import * as fs from "fs";
import { BuiltinSlotTypes, SlotMatch, SlotType } from "../virtualCore/SlotTypes";
import { SamplePhrase, SamplePhraseTest, SampleUtterances } from "../virtualCore/SampleUtterances";
import { AudioBuiltinIntents } from "../audioPlayer/AudioPlayer";
import { ConfirmationStatus } from '../core/SkillContext';

/**
 * Parses and interprets an interaction model
 * Takes in intentName schema and sample utterances from files
 * Then can take a phrase and create an intentName request based on it
 */
export class InteractionModel {

    // Parse the all-in-one interaction model as a file
    public static fromFile(interactionModelFile: any): InteractionModel {
        try {
            const data = fs.readFileSync(interactionModelFile);
            const json = JSON.parse(data.toString());
            return InteractionModel.fromJSON(json);
        } catch (error) {
            if (error.message.includes("ENOENT")) {
                throw new Error("The interaction model for your Alexa Skill could not be found under:\n" +
                    interactionModelFile +
                    "\nPlease provide the correct location of the Interaction Model.")
            }
            throw error;
        }
    }

    // Parse the all-in-one interaction model as JSON
    // Using this for reference:
    //  https://github.com/alexa/skill-sample-nodejs-team-lookup/blob/master/speech-assets/interaction-model.json
    public static fromJSON(interactionModel: any): InteractionModel {
        // For the official interaction model that is part of SMAPI,
        //  we pull the data off of the interactionModel.languageModel element
        const model = interactionModel.interactionModel || interactionModel;

        let languageModel = interactionModel.interactionModel?.languageModel || interactionModel;
        // There is another version of the model from the interaction model builder
        if ("languageModel" in interactionModel) {
            languageModel = interactionModel.languageModel;
        }

        const sampleJSON: any = {};
        for (const intent of languageModel.intents) {
            // The name of the intent is on the property "name" instead of "intent" for the unified model
            intent.intent = intent.name;
            if (intent.samples) {
                sampleJSON[intent.intent] = intent.samples;
            }
        }

        const schema = new IntentSchema(languageModel.intents);
        const samples = SampleUtterances.fromJSON(sampleJSON);
        return new InteractionModel(schema, samples, languageModel.types || [], model.prompts ?? [], model.dialog?.intents);
    }

    public static fromLocale(locale: string): InteractionModel {
        const modelPath = "./models/" + locale + ".json";
        if (!fs.existsSync(modelPath)) {
            return undefined;
        }

        return InteractionModel.fromFile(modelPath);
    }

    public readonly slotTypes?: SlotType[];

    public constructor(public intentSchema: IntentSchema,
                       public sampleUtterances: SampleUtterances,
                       slotTypesObj: any[] = [],
                       public prompts?: SlotPrompt[],
                       public dialogIntents?: DialogIntent[]) {
        this.slotTypes = [
            ...slotTypesObj.map(type => new SlotType(type.name, type.values)),
            ...BuiltinSlotTypes.values()
        ];

        // We add each phrase one-by-one. It is possible the built-ins have additional samples defined
        for (const [key, phrases] of Object.entries(AudioBuiltinIntents)) {
            if (intentSchema.hasIntent(key)) {
                for (const phrase of phrases) {
                    sampleUtterances.addSample(key, phrase);
                }
            }
        }
    }

    public utterance(phrase: string) {
        const matches = this.matchesUtterances(phrase);
        const topMatch = matches.reduce((top, match) => match.score() > top.score()
            || top.score() === match.score() && match.scoreSlots() > top.scoreSlots() ? match : top, matches[0]);
        return { matchedSample: topMatch.samplePhrase, slots: topMatch.slotValues() };
    }

    public dialogIntent(intentName: string): DialogIntent | undefined {
        return this.dialogIntents?.find(dialogIntent => dialogIntent.name === intentName) || undefined;
    }

    public prompt(id: string): SlotPrompt | undefined {
        return this.prompts?.find(prompt => prompt.id === id) || undefined;
    }

    public audioPlayerSupported(intentSchema: IntentSchema) : boolean {
        // Audio player must have pause and resume intents in the model
        return intentSchema.hasIntent("AMAZON.PauseIntent") && intentSchema.hasIntent("AMAZON.ResumeIntent");
    }

    /**
     * Tests to see if the utterances matches the sample phrase
     * If it does, returns an array of matching slot values
     * If it does not, returns undefined
     * @param {string} utterance
     * @returns {SamplePhraseTest}
     */
    private matchesUtterances(utterance: string): SamplePhraseTest[] {
        const matches: SamplePhraseTest[] = [];
        for (const intentName of this.intentSchema.intentNames()) {
            for (const sample of this.sampleUtterances.samplesForIntent(intentName)) {
                // return new SamplePhraseTest(this, interactionModel, utterance);
                const cleanUtterance = utterance.replace(/[!"¿?|#$%\/()=+\-_<>*{}·¡\[\].,;:]/g, "");
                const matchArray = cleanUtterance.match(new RegExp(`^${this.phraseToRegex(sample)}$`, "i"));

                // If we have a regex match, check all the slots match their types
                if (matchArray) {
                    const slotMatches = this.checkSlots(sample, matchArray[0], matchArray.slice(1));
                    if (slotMatches) {
                        matches.push(new SamplePhraseTest(sample, slotMatches, matchArray[0]));
                    }
                }
            }
        }
        // If we don't match anything, we use the default utterance - simple algorithm for this
        if (!matches.length) {
            throw new Error("Unable to match utterance: " + utterance
                + " to an intent. Try a different utterance, or explicitly set the intent");
        }

        return matches;
    }

    /**
     * Takes a phrase like "This is a {Slot}" and turns it into a regex like "This is a(.*)"
     * This is so we can compare the sample utterances (which have names that tie off to the slot names defined in the
     *  intent schema) with the actual utterance, which have values in the slot positions (as opposed to the names)
     * @param samplePhrase
     */
    private phraseToRegex(samplePhrase: SamplePhrase): string {
        const startIndex = samplePhrase.phrase.indexOf("{");
        if (startIndex !== -1) {
            const slotName = samplePhrase.phrase.substring(startIndex + 1, samplePhrase.phrase.indexOf("}", startIndex));

            // Literal are in the format "sample { <literal sample> | <slotname>}"
            // e.g.: "I'm an {aquarius | literal}"
            samplePhrase.slotNames.push(slotName.indexOf("|") === -1 ? slotName
                : slotName.substring(slotName.indexOf("|") + 2, slotName.length));

            samplePhrase.phrase = samplePhrase.phrase.substring(0, startIndex).trim() + "(.*)"
                + samplePhrase.phrase.substring(samplePhrase.phrase.indexOf("}", startIndex) + 1).trim();
            samplePhrase.phrase = this.phraseToRegex(samplePhrase);
        }

        // We make the regex lowercase, so that we match a phrase regardless of case
        // We only switch to lowercase here because if we change the slotnames to lowercase,
        //  it throws off the slot matching
        return samplePhrase.phrase;
    }

    private checkSlots(samplePhrase: SamplePhrase, input: string, slotValues: string []): SlotMatch[] | undefined {
        // Build an array of results - we want to pass back the exact value that matched (not change the case)
        const result = [];
        let index = 0;

        // We check each slot value against valid values
        for (const slotValue of slotValues) {
            // If the whole of the match is not a slot, make sure there is a leading or trailing space on the slot
            // This is to avoid matching a sample like "sample {slot}" with "sampleslot"
            // Ideally, this would be done as a regex - seemingly possible, but the regex is very confusing
            if (input !== slotValue && slotValue.trim().length > 0 && !slotValue.startsWith(" ") && !slotValue.endsWith(" ")) {
                return undefined;
            }

            const slotName = samplePhrase.slotNames[index];
            // Look up the slot type for the name
            const slotType = this.intentSchema.slots(samplePhrase.intent)
                ?.find(slot => slotName.toLowerCase() === slot.name.toLowerCase());
            if (!slotType) {
                throw new Error(`Invalid schema - not slot: ${slotName} for intent: ${samplePhrase.intent}`);
            }

            const slotType2 = this.slotTypes.find(o => o.name.toLowerCase() === slotType.type.toLowerCase());

            // If no slot type definition is provided, we just assume it is a match
            let slotMatch = SlotMatch.fromType(slotValue, slotType2);

            if (!slotMatch.matches) {
                return undefined;

            } else {
                result.push(slotMatch);
            }
            index++;
        }

        return result;
    }
}

export class IntentSchema {
    public constructor(private _intents: any[]) {}

    public intentNames(): string[] {
        return this._intents.map(intentJSON => intentJSON.intent);
    }

    public slots(intentString: string): any[] {
        return this._intents.find(o => o.intent === intentString)?.slots;
    }

    public hasIntent(intentString: string): boolean {
        return this._intents.some(o => o.intent === intentString);
    }
}

interface SlotPrompt {
    id: string;
    variations: {
        type: string;
        value: string;
    }[];
}

export class SlotValue {
    public resolutionsPerAuthority: {
        values: EntityResolutionValue[];
        status: {
            code: EntityResolutionStatus
        };
        authority: string;
    }[];

    public constructor(
        public name: string,
        public value: string,
        public confirmationStatus = ConfirmationStatus.NONE
    ) {}

    public addEntityResolution(authority: string, values: EntityResolutionValue[] = []) {
        if (!this.resolutionsPerAuthority)
            this.resolutionsPerAuthority = [];

        const existingResolution = this.resolutionsPerAuthority.find(resolution => resolution.authority === authority);
        if (existingResolution) {
            existingResolution.values.push(values[0]);
        } else {
            const code = values?.length ? EntityResolutionStatus.ER_SUCCESS_MATCH : EntityResolutionStatus.ER_SUCCESS_NO_MATCH
            this.resolutionsPerAuthority.push({ authority, values, status: { code } });
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

interface DialogIntent {
    name: string;
    confirmationRequired: boolean;
    prompts: any;
    slots: DialogSlot[];
}

type DialogSlot = {
    name: string;
    type: string;
    confirmationRequired: boolean;
    prompts: { [id: string]: string };
}
