import { SlotMatch } from "./SlotTypes";
import * as fs from "fs";

export class SampleUtterances {
  public static fromFile(file: string): SampleUtterances {
    const data = fs.readFileSync(file);
    const lines = data.toString().split("\n");
    const utterances = new SampleUtterances();
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
      utterances.addSample(intent, sample);
    }
    return utterances;
  }

  public static fromJSON(json: any) {
    return new SampleUtterances(Object.entries<any[]>(json).reduce(
        (map, [intent, samples]) => map.set(intent, samples.map(s => new SamplePhrase(intent, s))),
        new Map<string, SamplePhrase[]>()
    ));
  }

  constructor(private samples = new Map<string, SamplePhrase[]>()) {}

  public addSample(intent: string, sample: string) {
    if (!this.samples.has(intent))
      this.samples.set(intent, []);
    this.samples.get(intent).push(new SamplePhrase(intent, sample));
  }

  public addSamples(intent: string, samples: string[]) {
    this.samples.set(intent, samples.map(s => new SamplePhrase(intent, s)));
  }

  public samplesForIntent(intent: string): SamplePhrase [] {
    return this.samples.get(intent) || [];
  }
}

/**
 * Helper class for handling phrases - breaks out the slots within a phrase
 */
export class SamplePhrase {
  public readonly slotNames: string[] = [];

  public constructor(public intent: string, public phrase: string) {}
}

export class SamplePhraseTest {
  public constructor(
      public samplePhrase: SamplePhrase,
      private readonly slotMatches: SlotMatch[],
      private matchString: string
  ) {}

  // We assign a score based on the number of non-slot value letters that match
  public score(): number {
    const slotValueLength = this.slotMatches.reduce((length, slotMatch) => length + slotMatch.value.length, 0);
    return this.matchString.length - slotValueLength;
  }

  public scoreSlots(): number {
    return this.slotMatches.filter(slotMatch => !slotMatch.untyped).length;
  }

  public slotValues(): string [] {
    return this.slotMatches.map(slotMatch => slotMatch.value);
  }

}