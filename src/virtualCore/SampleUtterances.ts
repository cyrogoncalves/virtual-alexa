import { SlotMatch } from "./SlotTypes";
import { InteractionModel } from '../model/InteractionModel';

export class SampleUtterances {
  public interactionModel: InteractionModel;

  private samples: {[id: string]: SamplePhrase[]} = {};

  public addSample(intent: string, sample: string) {
    if (!(intent in this.samples)) {
      this.samples[intent] = [];
    }
    this.samples[intent].push(new SamplePhrase(this, intent, sample));
  }

  public samplesForIntent(intent: string): SamplePhrase [] {
    return this.samples[intent] || [];
  }
}

/**
 * Helper class for handling phrases - breaks out the slots within a phrase
 */
export class SamplePhrase {
  private readonly _slotNames: string[] = [];
  private readonly _regex: string;

  public constructor(public sampleUtterances: SampleUtterances,
                     public intent: string,
                     public phrase: string) {
    this._regex = this.phraseToRegex(this.phrase);
  }

  get slotNames() {
    return this._slotNames;
  }

  public slotName(index: number): string | undefined {
    return this._slotNames[index];
  }

  public slotCount(): number {
    return this._slotNames.length;
  }

  public regex(): RegExp {
    return new RegExp("^" + this._regex + "$", "i");
  }

  /**
   * Tests to see if the utterances matches the sample phrase
   * If it does, returns an array of matching slot values
   * If it does not, returns undefined
   * @param {string} utterance
   * @returns {[]}
   */
  public matchesUtterance(utterance: string): SamplePhraseTest {
    return new SamplePhraseTest(this, utterance);
  }

  /**
   * Takes a phrase like "This is a {Slot}" and turns it into a regex like "This is a(.*)"
   * This is so we can compare the sample utterances (which have names that tie off to the slot names defined in the
   *  intent schema) with the actual utterance, which have values in the slot positions (as opposed to the names)
   * @param phrase
   */
  private phraseToRegex(phrase: string): string {
    const startIndex = phrase.indexOf("{");
    if (startIndex !== -1) {
      const slotName = phrase.substring(startIndex + 1, phrase.indexOf("}", startIndex));

      // Literal are in the format "sample { <literal sample> | <slotname>}"
      // e.g.: "I'm an {aquarius | literal}"
      this._slotNames.push(slotName.indexOf("|") === -1 ? slotName
          : slotName.substring(slotName.indexOf("|") + 2, slotName.length));

      phrase = phrase.substring(0, startIndex).trim() + "(.*)" + phrase.substring(phrase.indexOf("}", startIndex) + 1).trim();
      phrase = this.phraseToRegex(phrase);
    }

    // We make the regex lowercase, so that we match a phrase regardless of case
    // We only switch to lowercase here because if we change the slotnames to lowercase,
    //  it throws off the slot matching
    return phrase;
  }
}

export class SamplePhraseTest {
  private readonly slotMatches: SlotMatch[];
  private matchString: string;

  public constructor(public samplePhrase: SamplePhrase, private utterance: string) {
    const cleanUtterance = utterance.replace(/[!"¿?|#$%\/()=+\-_<>*{}·¡\[\].,;:]/g, "");
    const matchArray = cleanUtterance.match(samplePhrase.regex());

    // If we have a regex match, check all the slots match their types
    if (matchArray) {
      const slotMatches = this.checkSlots(matchArray[0], matchArray.slice(1));
      if (slotMatches) {
        this.slotMatches = slotMatches;
        this.matchString = matchArray[0];
      }
    }
  }

  public matches(): boolean {
    return !!this.slotMatches;
  }

  // We assign a score based on the number of non-slot value letters that match
  public score(): number {
    const slotValueLength = this.slotValues().reduce((length, slotValue) => length + slotValue.length, 0);
    return this.matchString.length - slotValueLength;
  }

  public scoreSlots(): number {
    return this.slotMatches.filter(slotMatch => !slotMatch.untyped).length;
  }

  public slotValues(): string [] {
    return this.slotMatches.map(slotMatch => slotMatch.value);
  }

  private checkSlots(input: string, slotValues: string []): SlotMatch[] | undefined {
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

      const slotName = this.samplePhrase.slotName(index);
      // Look up the slot type for the name
      const interactionModel = this.samplePhrase.sampleUtterances.interactionModel;
      const slotType = interactionModel.intentSchema.intent(this.samplePhrase.intent)
          .slots?.find(slot => slotName.toLowerCase() === slot.name.toLowerCase());
      if (!slotType) {
        throw new Error(`Invalid schema - not slot: ${slotName} for intent: ${this.samplePhrase.intent}`);
      }

      const slotType2 = interactionModel.slotTypes.find(o => o.name.toLowerCase() === slotType.type.toLowerCase());

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