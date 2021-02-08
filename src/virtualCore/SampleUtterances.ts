import * as fs from "fs";

export class SampleUtterances {
  public static fromFile(file: string): SampleUtterances {
    const data = fs.readFileSync(file);
    const lines = data.toString().split("\n");
    const json: {[intent: string]: any[]} = {};
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
      if (!json[intent]) {
        json[intent] = []
      }
      json[intent].push(sample);
    }
    return this.fromJSON(json);
  }

  public static fromJSON(json: {[intent: string]: any[]}) {
    return new SampleUtterances(Object.entries<any[]>(json).reduce(
        (map, [intent, samples]) => map.set(intent, samples.map(s => new SamplePhrase(s))),
        new Map<string, SamplePhrase[]>()
    ));
  }

  private constructor(private samples = new Map<string, SamplePhrase[]>()) {}

  public addSample(intent: string, sample: string) {
    if (!this.samples.has(intent))
      this.samples.set(intent, []);
    this.samples.get(intent).push(new SamplePhrase(sample));
  }

  public samplesForIntent(intent: string): SamplePhrase [] {
    return this.samples.get(intent) || [];
  }
}

/**
 * Helper class for handling phrases - breaks out the slots within a phrase
 */
class SamplePhrase {
  public constructor(public phrase: string) {}
}
