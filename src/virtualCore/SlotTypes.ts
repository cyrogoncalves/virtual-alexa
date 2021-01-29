export class SlotTypes {
  public types: SlotType[] = [];
}

export class SlotMatch {
  public untyped: boolean;
  public constructor(public matches: boolean,
                     public value?: string,
                     public enumeratedValue?: ISlotValue,
                     public slotValueSynonym?: string) {
    this.untyped = false;
  }
}

export class SlotType {
  public constructor(public name: string, public values: ISlotValue[] = []) {
    for (const value of this.values) {
      // We default builtin to false
      if (value.builtin === undefined) {
        value.builtin = false;
      }
    }
  }

  public isEnumerated() {
    return this.name === "AMAZON.NUMBER" || !this.name.startsWith("AMAZON");
  }

  public isCustom() {
    return !this.name.startsWith("AMAZON") || this.values.some(value => !value.builtin) || undefined;
  }

  public match(value: string): SlotMatch {
    const matches = this.matchAll(value);
    if (matches.length > 0) {
      return matches[0];
    } else if (this.name.startsWith("AMAZON") && !this.isEnumerated()) {
      // If this is a builtin, we still count it as a match, because we treat these as free form
      // Unless we explicilty have enumerated the builtin - we have rarely done this so far
      return new SlotMatch(true, value);
    }
    return new SlotMatch(false);
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
        for (const synonym of slotValue.name.synonyms) {
          if (synonym.toLowerCase() === value.toLowerCase()) {
            matches.push(new SlotMatch(true, value, slotValue, synonym));
          }
        }
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

  public static values(): BuiltinSlotType[] {
    return [
      new BuiltinSlotType("AMAZON.NUMBER", BuiltinSlotTypes.LONG_FORM_SLOT_VALUES(), "^[0-9]*$"),
    ];
  }
}

class BuiltinSlotType extends SlotType {
  public constructor(public name: string, public values: ISlotValue[], private regex?: string) {
    super(name, values);
  }

  public match(value: string): SlotMatch {
    value = value.trim();
    // Some slot types use regex - we use that if specified
    return this.regex && value.match(this.regex) ? new SlotMatch(true, value) : super.match(value);
  }
}
