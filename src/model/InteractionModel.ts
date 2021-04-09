import { AudioBuiltinIntents } from "../audioPlayer/AudioPlayer";

const LONG_FORM_VALUES: {[id: string]: string []} = {
    1: ["one"],
    2: ["two"],
    3: ["three"],
    4: ["four"],
    5: ["five"],
    6: ["six"],
    7: ["seven"],
    8: ["eight"],
    9: ["nine"],
    10: ["ten"],
    11: ["eleven"],
    12: ["twelve"],
    13: ["thirteen"],
    14: ["fourteen"],
    15: ["fifteen"],
    16: ["sixteen"],
    17: ["seventeen"],
    18: ["eighteen"],
    19: ["nineteen"],
    20: ["twenty"],
};

const LONG_FORM_SLOT_VALUES: ISlotValue[] = Object.entries(LONG_FORM_VALUES).map(([value, synonyms]) => ({
    id: value,
    builtin: true,
    name: {
        value,
        synonyms
    }
}));

/**
 * Parses and interprets an interaction model
 * Takes in intentName schema and sample utterances from files
 * Then can take a phrase and create an intentName request based on it
 */
export class InteractionModel {
    public constructor(
        public intents: any[],
        private sampleUtterances: { [intent: string]: string[] },
        public readonly slotTypes: SlotType[] = []
    ) {
        // We add each phrase one-by-one. It is possible the built-ins have additional samples defined
        Object.entries(AudioBuiltinIntents)
            .filter(([k]) => this.intents.some(o => o.intent === k))
            .forEach(([key, phrases]) => {
                if (!sampleUtterances[key])
                    sampleUtterances[key] = [];
                sampleUtterances[key].push(...phrases);
            });
    }

    public utterance(utterance: string) {
        let topMatch: any;
        for (const intent of this.intents.map(intentJSON => intentJSON.intent)) {
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
                if (!topMatch || score > topMatch.score || topMatch.score === score && scoreSlot > topMatch.scoreSlot) {
                    topMatch = {
                        matchedSample: sample,
                        slots: slotMatches.map(slotMatch => slotMatch.value),
                        intent,
                        slotNames,
                        score,
                        scoreSlot
                    };
                }
            }
        }
        if (!topMatch) {
            throw new Error("Unable to match utterance: " + utterance
                + " to an intent. Try a different utterance, or explicitly set the intent");
        }
        return topMatch;
    }

    public dialogIntent(intentName: string): DialogIntent {
        return this.intents?.find(dialogIntent => dialogIntent.name === intentName);
    }

    private checkSlots(intent: string, slotNames: string[], slotValues: string[]): SlotMatch[] | undefined {
        // Build an array of results - we want to pass back the exact value that matched (not change the case)
        const result: SlotMatch[] = [];
        let index = 0;
        // We check each slot value against valid values
        for (const slotValue of slotValues) {
            const slotName = slotNames[index++];
            // Look up the slot type for the name
            const slot = this.intents.find(o => o.intent === intent)?.slots
                ?.find((slot: any) => slotName.toLowerCase() === slot.name.toLowerCase());
            if (!slot) {
                throw new Error(`Invalid schema - not slot: ${slotName} for intent: ${intent}`);
            }

            // If no slot type definition is provided, we just assume it is a match
            const slotType = [
                ...this.slotTypes,
                { name: "AMAZON.NUMBER", values: LONG_FORM_SLOT_VALUES, regex: "^[0-9]*$" }
            ].find(o => o.name.toLowerCase() === slot.type.toLowerCase());
            const slotMatch = this.matchSlot(slotType, slotValue);
            if (!slotMatch) {
                return undefined;
            }
            result.push(slotMatch);
        }

        return result;
    }

    private matchSlot(slotType: SlotType, slotValue: string): SlotMatch {
        const slotValueTrimmed = slotValue.trim();
        if (!slotType) {
            const match = new SlotMatch(slotValue);
            match.untyped = true;
            return match;
        } else if (slotType.regex && slotValueTrimmed.match(slotType.regex)) {
            // Some slot types use regex - we use that if specified
            return new SlotMatch(slotValueTrimmed);
        } else {
            const match = slotType.values?.find(v => v.name.value.toLowerCase() === slotValueTrimmed.toLowerCase()
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

class SlotMatch {
    public untyped: boolean;
    public constructor(public value?: string,
                       public enumeratedValue?: ISlotValue) {
        this.untyped = false;
    }
}

export interface SlotType {
    name: string,
    values: ISlotValue[],
    regex?: string
}

interface ISlotValue {
    id?: string;
    builtin?: boolean;
    name: {
        value: string;
        synonyms: string[];
    };
}
