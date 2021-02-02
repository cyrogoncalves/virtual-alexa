export interface DialogIntent {
    name: string;
    confirmationRequired: boolean;
    prompts: any;
    slots: DialogSlot[];
}

export type DialogSlot = {
    name: string;
    type: string;
    confirmationRequired: boolean;
    prompts: { [id: string]: string };
}
