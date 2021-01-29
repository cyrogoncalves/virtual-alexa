import * as fs from "fs";
import { BuiltinSlotTypes, SlotType } from '../virtualCore/SlotTypes';
import { SampleUtterances } from '../virtualCore/SampleUtterances';
import { DialogIntent } from "../dialog/DialogIntent";
import { AudioPlayerIntents, BuiltinUtterances } from "./BuiltinUtterances";
import { IntentSchema } from "./IntentSchema";
import { SampleUtterancesBuilder } from "./SampleUtterancesBuilder";
import { SlotPrompt } from "./SlotPrompt";

/**
 * Parses and interprets an interaction model
 * Takes in intentName schema and sample utterances from files
 * Then can take a phrase and create an intentName request based on it
 */
export class InteractionModel {

    // Parse the all-in-one interaction model as a file
    public static fromFile(interactionModelFile: any): InteractionModel {
        try {
            const data = fs.readFileSync(interactionModelFile);
            const json = JSON.parse(data.toString());
            return InteractionModel.fromJSON(json);
        } catch (error) {
            if (error.message.includes("ENOENT")) {
                throw new Error("The interaction model for your Alexa Skill could not be found under:\n" +
                    interactionModelFile +
                    "\nPlease provide the correct location of the Interaction Model.")
            }
            throw error;
        }
    }

    // Parse the all-in-one interaction model as JSON
    // Using this for reference:
    //  https://github.com/alexa/skill-sample-nodejs-team-lookup/blob/master/speech-assets/interaction-model.json
    public static fromJSON(interactionModel: any): InteractionModel {
        let languageModel = interactionModel;
        let promptsElement = interactionModel.prompts;
        let dialogElement = interactionModel.dialog;
        // For the official interaction model that is part of SMAPI,
        //  we pull the data off of the interactionModel.languageModel element
        if ("interactionModel" in interactionModel) {
            languageModel = interactionModel.interactionModel.languageModel;
            promptsElement = interactionModel.interactionModel.prompts;
            dialogElement = interactionModel.interactionModel.dialog;
        }

        // There is another version of the model from the interaction model builder
        if ("languageModel" in interactionModel) {
            languageModel = interactionModel.languageModel;
        }

        const schemaJSON: any = {
            intents: [],
        };
        const sampleJSON: any = {};
        for (const intent of languageModel.intents) {
            // The name of the intent is on the property "name" instead of "intent" for the unified model
            intent.intent = intent.name;
            schemaJSON.intents.push(intent);
            if (intent.samples) {
                sampleJSON[intent.intent] = intent.samples;
            }
        }

        const schema = new IntentSchema(schemaJSON);
        const samples = SampleUtterancesBuilder.fromJSON(sampleJSON);
        const prompts = promptsElement?.map((prompt: any) => SlotPrompt.fromJSON(prompt)) ?? [];
        const dialogIntents = dialogElement?.intents.map((dialogIntent: any) =>
            DialogIntent.fromJSON(interactionModel, dialogIntent)) ?? [];
        return new InteractionModel(schema, samples, languageModel.types || [], prompts, dialogIntents);
    }

    public static fromLocale(locale: string): InteractionModel {
        const modelPath = "./models/" + locale + ".json";
        if (!fs.existsSync(modelPath)) {
            return undefined;
        }

        return InteractionModel.fromFile(modelPath);
    }

    public readonly slotTypes?: SlotType[];

    public constructor(public intentSchema: IntentSchema,
                       public sampleUtterances: SampleUtterances,
                       slotTypesObj: any[] = [],
                       public prompts?: SlotPrompt[],
                       public dialogIntents?: DialogIntent[]) {
        this.slotTypes = [
            ...slotTypesObj.map(type => new SlotType(type.name, type.values)),
            ...BuiltinSlotTypes.values()
        ];

        // In bootstrapping the interaction model, we pass it to its children
        this.sampleUtterances.interactionModel = this;

        this.dialogIntents?.forEach(dialogIntent => dialogIntent.interactionModel = this);

        const builtinValues = BuiltinUtterances.values();
        const isAudioPlayerSupported = this.audioPlayerSupported(intentSchema);
        // We add each phrase one-by-one
        // It is possible the built-ins have additional samples defined
        for (const key of Object.keys(builtinValues)) {
            if (this.isSupportedIntent(isAudioPlayerSupported, key)) {
                intentSchema.addIntent(key);
                for (const phrase of builtinValues[key]) {
                    this.sampleUtterances.addSample(key, phrase);
                }
            }
        }
    }
    
    public isSupportedIntent(isAudioPlayerSupported: boolean, intent: string): boolean {
        const hasIntent = this.intentSchema.hasIntent(intent);
        const isAudioPlayerIntent = isAudioPlayerSupported && AudioPlayerIntents.indexOf(intent) >= 0;
        return hasIntent || isAudioPlayerIntent;
    }

    public dialogIntent(intentName: string): DialogIntent | undefined {
        return this.dialogIntents?.find(dialogIntent => dialogIntent.name === intentName) || undefined;
    }

    public prompt(id: string): SlotPrompt | undefined {
        return this.prompts?.find(prompt => prompt.id === id) || undefined;
    }

    public audioPlayerSupported(intentSchema: IntentSchema) : boolean {
        // Audio player must have pause and resume intents in the model
        return intentSchema.hasIntent("AMAZON.PauseIntent") && intentSchema.hasIntent("AMAZON.ResumeIntent");
    }
}
