export class SlotMatch {
  public untyped: boolean;
  public constructor(public matches: boolean,
                     public value?: string,
                     public enumeratedValue?: ISlotValue,
                     public slotValueSynonym?: string) {
    this.untyped = false;
  }

  static fromType(slotValue: string, slotType: SlotType) {
    // If no slot type definition is provided, we just assume it is a match
    if (!slotType) {
      const match = new SlotMatch(true, slotValue);
      match.untyped = true;
      return match;
    } else {
      // return slotType.match(slotValue);
      // Some slot types use regex - we use that if specified
      if (slotType.regex && slotValue.trim().match(slotType.regex))
        return new SlotMatch(true, slotValue.trim());

      const matches = slotType.matchAll(slotValue);
      if (matches.length > 0) {
        return matches[0];
      } else if (slotType.name.startsWith("AMAZON") && !slotType.isEnumerated()) {
        // If this is a builtin, we still count it as a match, because we treat these as free form
        // Unless we explicilty have enumerated the builtin - we have rarely done this so far
        return new SlotMatch(true, slotValue);
      }
      return new SlotMatch(false);
    }
  }
}

export class SlotType {
  public constructor(public name: string, public values: ISlotValue[] = [], public regex?: string) {}

  public isEnumerated() {
    return this.name === "AMAZON.NUMBER" || !this.name.startsWith("AMAZON");
  }

  public isCustom() {
    return !this.name.startsWith("AMAZON") || this.values.some(value => !value.builtin) || undefined;
  }

  public matchAll(value: string): SlotMatch[] {
    value = value.trim();
    const matches: SlotMatch[] = [];

    for (const slotValue of this.values) {
      // First check the name value - the value and the synonyms are both valid matches
      // Refer here for definitive rules:
      //  https://developer.amazon.com/docs/custom-skills/
      //      define-synonyms-and-ids-for-slot-type-values-entity-resolution.html
      if (slotValue.name.value.toLowerCase() === value.toLowerCase()) {
        matches.push(new SlotMatch(true, value, slotValue));
      } else if (slotValue.name.synonyms) {
        matches.push(...slotValue.name.synonyms
            .filter(synonym => synonym.toLowerCase() === value.toLowerCase())
            .map(synonym => new SlotMatch(true, value, slotValue, synonym)));
      }
    }
    return matches;
  }
}

interface ISlotValue {
  id?: string;
  builtin?: boolean;
  name: {
    value: string;
    synonyms: string[];
  };
}

export class BuiltinSlotTypes {
  private static LONG_FORM_VALUES: {[id: string]: string []} = {
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

  private static LONG_FORM_SLOT_VALUES(): ISlotValue[] {
    return Object.keys(BuiltinSlotTypes.LONG_FORM_VALUES).map(key => ({
      id: key,
      builtin: true,
      name: {
        value: key,
        synonyms: BuiltinSlotTypes.LONG_FORM_VALUES[key]
      }
    }));
  }

  public static values(): SlotType[] {
    return [
      new SlotType("AMAZON.NUMBER", BuiltinSlotTypes.LONG_FORM_SLOT_VALUES(), "^[0-9]*$"),
    ];
  }
}
