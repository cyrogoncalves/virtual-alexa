/**
 * Turns a phrase into an intent
 */
import { SamplePhrase } from "./SampleUtterances";
import { InteractionModel } from '../model/InteractionModel';

export class Utterance {
  public matchedSample: SamplePhrase;
  private slots: string[];

  public constructor(interactionModel: InteractionModel, phrase: string) {
    this.matchIntent(interactionModel, phrase);
  }

  public intent(): string {
    return this.matchedSample?.intent;
  }

  public matched(): boolean {
    return this.matchedSample !== undefined;
  }

  public slot(index: number): string | undefined {
    return this.slots?.[index]?.trim();
  }

  public slotByName(name: string): string | undefined {
    const index = this.matchedSample.slotNames.findIndex(slotName => slotName.toLowerCase() === name.toLowerCase());
    return this.slots[index].trim();
  }

  public toJSON(): any {
    const json: any = {};
    if (this.slots) {
      for (let i = 0; i < this.slots.length; i++) {
        const slotName = this.matchedSample.slotName(i);
        json[slotName] = this.slot(i);
      }
    }
    return json;
  }

  private matchIntent(interactionModel: InteractionModel, phrase: string): void {
    const matches = [];
    for (const intent of interactionModel.intentSchema.intents()) {
      for (const sample of interactionModel.sampleUtterances.samplesForIntent(intent.name)) {
        const sampleTest = sample.matchesUtterance(phrase);
        if (sampleTest.matches()) {
          matches.push(sampleTest);
        }
      }
    }

    if (matches.length > 0) {
      const topMatch = matches.reduce((top, match) => match.score() > top.score() ||
          top.score() === match.score() && match.scoreSlots() > top.scoreSlots() ? match : top, matches[0]);
      this.matchedSample = topMatch.samplePhrase;
      this.slots = topMatch.slotValues();
    }
  }
}