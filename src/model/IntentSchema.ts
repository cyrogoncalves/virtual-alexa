import * as fs from "fs";

export class IntentSchema {
    public static fromFile(file: string): IntentSchema {
        const data = fs.readFileSync(file);
        const json = JSON.parse(data.toString());
        return IntentSchema.fromJSON(json);
    }

    public static fromJSON(schemaJSON: any): IntentSchema {
        return new IntentSchema(schemaJSON);
    }

    public constructor(private schemaJSON: { intents: any[] }) {}

    public intents(): Intent[] {
        return this.schemaJSON.intents.map((intentJSON: any) => ({ name: intentJSON.intent, slots: intentJSON.slots }));
    }

    public intent(intentString: string): Intent {
        return this.intents().find(o => o.name === intentString);
    }

    public hasIntent(intentString: string): boolean {
        return !!this.intent(intentString);
    }

    public addIntent(intent: string): void {
        if (!this.schemaJSON.intents.some((item: any) => item.intent === intent)) {
            this.schemaJSON.intents.push({intent});
        }
    }
}

export interface Intent {
    name: string,
    slots: {
        name: string,
        type: string
    }[]
}
