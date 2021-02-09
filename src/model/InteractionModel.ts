import { BuiltinSlotTypes, SlotMatch, SlotType } from "../virtualCore/SlotTypes";
import { AudioBuiltinIntents } from "../audioPlayer/AudioPlayer";
import { ConfirmationStatus } from '../core/SkillContext';

/**
 * Parses and interprets an interaction model
 * Takes in intentName schema and sample utterances from files
 * Then can take a phrase and create an intentName request based on it
 */
export class InteractionModel {
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
        return new InteractionModel(schema, sampleJSON, languageModel.types || [], model.prompts ?? [], model.dialog?.intents);
    }

    public readonly slotTypes?: SlotType[];

    public constructor(public intentSchema: IntentSchema,
                       private sampleUtterances: { [intent: string]: string[] },
                       slotTypesObj: any[] = [],
                       public prompts?: SlotPrompt[],
                       public dialogIntents?: DialogIntent[]) {
        this.slotTypes = [
            ...slotTypesObj.map(type => new SlotType(type.name, type.values)),
            ...BuiltinSlotTypes.values()
        ];

        // We add each phrase one-by-one. It is possible the built-ins have additional samples defined
        for (const [key, phrases] of Object.entries(AudioBuiltinIntents)) {
            if (this.intentSchema.intents.some(o => o.intent === key)) {
                for (const phrase of phrases) {
                    if (!sampleUtterances[key])
                        sampleUtterances[key] = [];
                    sampleUtterances[key].push(phrase);
                }
            }
        }
    }

    public utterance(utterance: string) {
        let topMatch: any;
        let topScore = 0;
        let topScoreSlot = 0;
        for (const intent of this.intentSchema.intents.map(intentJSON => intentJSON.intent)) {
            for (const sample of this.sampleUtterances[intent] || []) {
                // Takes a phrase like "This is a {Slot}" and turns it into a regex like "This is a(.*)".
                // This is so we can compare the sample utterances
                const samplePhrase = sample.replace(/\s*{[^}]*}\s*/gi, "(.*)");
                const cleanUtterance = utterance.replace(/[!"¿?|#$%\/()=+\-_<>*{}·¡\[\].,;:]/g, "");
                // We make the regex lowercase, so that we match a phrase regardless of case
                // We only switch to lowercase here because if we change the slotnames to lowercase,
                //  it throws off the slot matching
                const matchArray = cleanUtterance.match(new RegExp(`^${samplePhrase}$`, "i"));
                if (!matchArray) {
                    continue;
                }

                // If we have a regex match, check all the slots match their types
                const slotValues = matchArray.slice(1);
                if (slotValues.some(v => matchArray[0] !== v && v.trim().length > 0 && !v.startsWith(" ") && !v.endsWith(" "))) {
                    continue;
                }
                const slotNames = sample.match(/(?<={)[^}^|]*(?=})|(?<=\| )[^}]*/g) || [];
                const slotMatches = this.checkSlots(intent, slotNames, slotValues);
                if (!slotMatches) {
                    continue;
                }

                const score = matchArray[0].length - slotMatches.reduce((length, slotMatch) => length + slotMatch.value.length, 0);
                const scoreSlot = slotMatches.filter(slotMatch => !slotMatch.untyped).length;
                if (!topMatch || score > topScore || topScore === score && scoreSlot > topScoreSlot) {
                    topMatch = {
                        matchedSample: sample,
                        slots: slotMatches.map(slotMatch => slotMatch.value),
                        intent,
                        slotNames
                    };
                    topScore = score;
                    topScoreSlot = scoreSlot;
                }
            }
        }
        if (!topMatch) {
            throw new Error("Unable to match utterance: " + utterance
                + " to an intent. Try a different utterance, or explicitly set the intent");
        }
        return topMatch;
    }

    public dialogIntent(intentName: string): DialogIntent | undefined {
        return this.dialogIntents?.find(dialogIntent => dialogIntent.name === intentName) || undefined;
    }

    public prompt(id: string): SlotPrompt | undefined {
        return this.prompts?.find(prompt => prompt.id === id) || undefined;
    }

    private checkSlots(intent: string, slotNames: string[], slotValues: string[]): SlotMatch[] | undefined {
        // Build an array of results - we want to pass back the exact value that matched (not change the case)
        const result: SlotMatch[] = [];
        let index = 0;
        // We check each slot value against valid values
        for (const slotValue of slotValues) {
            const slotName = slotNames[index++];
            // Look up the slot type for the name
            const slot = this.intentSchema.intents.find(o => o.intent === intent)?.slots
                ?.find((slot: any) => slotName.toLowerCase() === slot.name.toLowerCase());
            if (!slot) {
                throw new Error(`Invalid schema - not slot: ${slotName} for intent: ${intent}`);
            }

            // If no slot type definition is provided, we just assume it is a match
            const slotType = this.slotTypes.find(o => o.name.toLowerCase() === slot.type.toLowerCase());
            const slotMatch = this.matchSlot(slotType, slotValue);
            if (!slotMatch) {
                return undefined;
            }
            result.push(slotMatch);
        }

        return result;
    }

    private matchSlot(slotType: SlotType, slotValue: string): SlotMatch {
        if (!slotType) {
            const match = new SlotMatch(slotValue);
            match.untyped = true;
            return match;
        } else if (slotType.regex && slotValue.trim().match(slotType.regex)) {
            // Some slot types use regex - we use that if specified
            return new SlotMatch(slotValue.trim());
        } else {
            const slotValueTrimmed = slotValue.trim();
            const match = slotType.values.find(v => v.name.value.toLowerCase() === slotValueTrimmed.toLowerCase()
                || v.name.synonyms?.some(synonym => synonym.toLowerCase() === slotValueTrimmed.toLowerCase()));
            if (match) {
                return new SlotMatch(slotValueTrimmed, match);
            } else if (slotType.name.startsWith("AMAZON") && slotType.name !== "AMAZON.NUMBER") {
                // If this is a builtin, we still count it as a match, because we treat these as free form
                // Unless we explicilty have enumerated the builtin - we have rarely done this so far
                return new SlotMatch(slotValue);
            }
        }
        return undefined;
    }
}

export class IntentSchema {
    public constructor(public intents: any[]) {}

    public slots(intentName: string): any[] {
        return this.intents.find(o => o.intent === intentName)?.slots;
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
    slots: {
        name: string;
        type: string;
        confirmationRequired: boolean;
        prompts: { [id: string]: string };
    }[];
}
