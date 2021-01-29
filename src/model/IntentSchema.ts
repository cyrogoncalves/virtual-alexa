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

    public constructor(public schemaJSON: any) {}

    public intents(): Intent[] {
        return this.schemaJSON.intents.map((intentJSON: any) => {
            const intent = new Intent(intentJSON.intent);
            intentJSON.slots?.forEach((slotJSON: any) => intent.addSlot(new IntentSlot(slotJSON.name, slotJSON.type)));
            return intent;
        });
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

export class Intent {
    public builtin: boolean = false;
    public slots: IntentSlot[] = null;
    public constructor(public name: string, builtin?: boolean) {
        this.builtin = builtin;
    }

    public addSlot(slot: IntentSlot): void {
        if (this.slots === null) {
            this.slots = [];
        }

        this.slots.push(slot);
    }

    public slotForName(name: string): IntentSlot {
        for (const slot of this.slots) {
            if (name.toLowerCase() === slot.name.toLowerCase()) {
                return slot;
            }
        }
        return undefined;
    }
}

export class IntentSlot {
    public constructor(public name: string, public type: string) {}
}