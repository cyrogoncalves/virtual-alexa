import * as fs from "fs";
import {IIntentSchema, Intent, IntentSlot} from "virtual-core";

export class IntentSchema implements IIntentSchema {
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
        let intent: Intent = null;
        for (const o of this.intents()) {
            if (o.name === intentString) {
                intent = o;
                break;
            }
        }
        return intent;
    }

    public hasIntent(intentString: string): boolean {
        return this.intent(intentString) !== null;
    }

    public addIntent(intent: string): void {
        const matchIntentByName = function (item: any) {
            return item.intent === intent;
        };
        if (!this.schemaJSON.intents.some(matchIntentByName)){
            this.schemaJSON.intents.push({intent});
        }
    }
}
