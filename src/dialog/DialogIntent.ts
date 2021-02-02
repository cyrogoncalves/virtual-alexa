import { InteractionModel } from "../model/InteractionModel";
import { SlotPrompt } from "../model/SlotPrompt";

export class DialogIntent {
    public name: string;
    public confirmationRequired: boolean;
    public interactionModel: InteractionModel;
    public prompts: any;
    public slots: DialogSlot[];

    public constructor(json: any) {
        Object.assign(this, json);
        this.slots = json.slots.map((slot: any) => new DialogSlot(this, slot));
    }
}

export class DialogSlot {
    public name: string;
    public type: string;
    public confirmationRequired: boolean;
    public prompts: { [id: string]: string };

    public constructor(public dialogIntent: DialogIntent, json: any) {
        Object.assign(this, json);
    }

    public elicitationPrompt(): SlotPrompt {
        return this.dialogIntent.interactionModel.prompt(this.prompts.elicitation);
    }

    public confirmationPrompt(): SlotPrompt {
        return this.dialogIntent.interactionModel.prompt(this.prompts.confirmation);
    }
}
