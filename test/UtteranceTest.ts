import { SlotType } from '../src/virtualCore/SlotTypes';
import { assert } from "chai";
import { IntentSchema, InteractionModel } from "../src/model/InteractionModel";
import { SamplePhrase, SampleUtterances } from '../src/virtualCore/SampleUtterances';

describe("UtteranceTest", function() {
    this.timeout(10000);

    const intentSchema = {
        intents: [
            {
                intent: "Play",
            },
            {
                intent: "Hello",
            },
            {
                intent: "NoSampleUtterances",
            },
            {
                intent: "SlottedIntent",
                slots: [
                    {name: "SlotName", type: "SLOT_TYPE"},
                ],
            },
            {
                intent: "MultipleSlots",
                slots: [
                    {name: "SlotA", type: "SLOT_TYPE"},
                    {name: "SlotB", type: "SLOT_TYPE"},
                ],
            },
            {
                intent: "CustomSlot",
                slots: [
                    {name: "country", type: "COUNTRY_CODE"},
                ],
            },
            {
                intent: "NumberSlot",
                slots: [
                    {name: "number", type: "AMAZON.NUMBER"},
                ],
            },
            {
                intent: "StringSlot",
                slots: [
                    {name: "stringSlot", type: "StringSlotType"},
                ],
            },
            {
                intent: "AMAZON.HelpIntent",
            },
        ],
    };

    const sampleUtterances = {
        CustomSlot: ["{country}"],
        Hello: ["hi", "hello", "hi there", "good morning"],
        MultipleSlots: ["multiple {SlotA} and {SlotB}", "reversed {SlotB} then {SlotA}", "{SlotA}"],
        NumberSlot: ["{number}", "{number} test"],
        Play: ["play", "play next", "play now"],
        SlottedIntent: ["slot {SlotName}"],
        StringSlot: ["{stringSlot}"],
    };

    const slotTypes = [{
        name: "COUNTRY_CODE",
        values: [
            {
                id: "US",
                name: {
                    synonyms: ["USA", "America", "US"],
                    value: "US",
                },
            },
            {
                id: "DE",
                name: {
                    synonyms: ["Germany", "DE"],
                    value: "DE",
                },
            },
            {
                id: "UK",
                name: {
                    synonyms: ["England", "Britain", "UK", "United Kingdom", "Great Britain"],
                    value: "UK",
                },
            },
        ],
    }] as SlotType[];

    const model = new InteractionModel(IntentSchema.fromJSON(intentSchema),
        SampleUtterances.fromJSON(sampleUtterances),
        slotTypes);

    const japaneseModel = InteractionModel.fromFile("./test/resources/japanese_skill/models/ja-JP.json");

    const slotIndex = (matchedSample: SamplePhrase, name: string): number => {
      return matchedSample.slotNames.findIndex(slotName => slotName.toLowerCase() === name.toLowerCase());
    }

    describe("#matchIntent", () => {
        it("Sends correct error message on missing interaction ", () => {
            try {
                InteractionModel.fromFile("./test/resources/wrong-file.json");
            } catch (error) {
                assert.isTrue(error.message.includes("The interaction model for your Alexa Skill could not be"));
            }
        });

        it("Matches a simple phrase", () => {
            const { matchedSample } = model.utterance("play");
            assert.equal(matchedSample?.intent, "Play");
        });

        it("Matches a simple phrase, ignores case", () => {
            const { matchedSample } = model.utterance("Play");
            assert.equal(matchedSample?.intent, "Play");
        });

        it("Matches a simple phrase, ignores special characters", () => {
            const { matchedSample } = model.utterance("play?");
            assert.equal(matchedSample?.intent, "Play");
        });

        it("Matches help", () => {
            const { matchedSample } = model.utterance("help");
            assert.equal(matchedSample?.intent, "AMAZON.HelpIntent");
        });

        it("Matches a slotted phrase", () => {
            const { matchedSample, slots } = model.utterance("slot value");
            assert.equal(matchedSample?.intent, "SlottedIntent");
            assert.equal(slots?.[0]?.trim(), "value");
            const index = slotIndex(matchedSample, "SlotName");
            assert.equal(slots?.[index]?.trim(), "value");
        });

        it("Matches a slotted phrase, no slot value", () => {
            const { matchedSample } = model.utterance("slot");
            assert.equal(matchedSample?.intent, "SlottedIntent");
        });

        it("Matches a phrase with multiple slots", () => {
            const { matchedSample, slots } = model.utterance("multiple a and b");
            assert.equal(matchedSample?.intent, "MultipleSlots");
            assert.equal(slots?.[0]?.trim(), "a");
            assert.equal(slots?.[1]?.trim(), "b");
            const indexA = slotIndex(matchedSample, "SlotA");
            assert.equal(slots?.[indexA]?.trim(), "a");
            const indexB = slotIndex(matchedSample, "SlotB");
            assert.equal(slots?.[indexB]?.trim(), "b");
        });

        it("Matches a phrase with multiple slots reversed", () => {
            const { matchedSample, slots } = model.utterance("reversed a then b");
            assert.equal(matchedSample?.intent, "MultipleSlots");
            assert.equal(slots?.[0]?.trim(), "a");
            assert.equal(slots?.[1]?.trim(), "b");
            const indexA = slotIndex(matchedSample, "SlotA");
            assert.equal(slots?.[indexA]?.trim(), "b");
            const indexB = slotIndex(matchedSample, "SlotB");
            assert.equal(slots?.[indexB]?.trim(), "a");
        });

        it("Matches a phrase with slot with enumerated values", () => {
            const { matchedSample, slots } = model.utterance("US");
            assert.equal(matchedSample?.intent, "CustomSlot");
            assert.equal(slots?.[0]?.trim(), "US");
            assert.equal(slots?.[slotIndex(matchedSample, "country")]?.trim(), "US");
        });

        it("Does not match a phrase with slot with enumerated values", () => {
            const { matchedSample } = model.utterance("hi");
            assert.equal(matchedSample?.intent, "Hello");
        });

        it("Matches a phrase with slot with number value", () => {
            const { matchedSample, slots } = model.utterance("19801");
            assert.equal(matchedSample?.intent, "NumberSlot");
            assert.equal(slots?.[0]?.trim(), "19801");
            assert.equal(slots?.[slotIndex(matchedSample, "number")]?.trim(), "19801");
        });

        it("Matches a phrase with slot with long-form number value", () => {
            const { matchedSample, slots } = model.utterance("one");
            assert.equal(matchedSample?.intent, "NumberSlot");
            assert.equal(slots?.[0]?.trim(), "one");
            assert.equal(slots?.[slotIndex(matchedSample, "number")]?.trim(), "one");

            const utterance2 = model.utterance("Thirteen");
            const utterance2index = slotIndex(utterance2.matchedSample, "number");
            assert.equal(utterance2.slots?.[utterance2index]?.trim(), "Thirteen");

            const utterance3 = model.utterance(" ten ");
            const utterance3index = slotIndex(utterance3.matchedSample, "number");
            assert.equal(utterance3.slots?.[utterance3index]?.trim(), "ten");
        });

        it("Does not match a phrase with numbers and letters to slot of number type", () => {
            const { matchedSample } = model.utterance("19801a test");
            assert.equal(matchedSample?.intent, "MultipleSlots");
        });

        it("Matches a more specific phrase", () => {
            const { matchedSample } = model.utterance("1900 test");
            assert.equal(matchedSample?.intent, "NumberSlot");
        });

        it("Matches with symbols in the phrase", () => {
            const { matchedSample } = model.utterance("good? #%.morning");
            assert.equal(matchedSample?.intent, "Hello");
        });

        it("Matches with punctuation in the phrase", () => {
            const { matchedSample } = model.utterance("good, -morning:");
            assert.equal(matchedSample?.intent, "Hello");
        });

        describe("Matches for International Languages", function() {
            it("Matches a slotted phrase", () => {
                const { matchedSample, slots } = japaneseModel.utterance("5 人のプレーヤー");
                assert.equal(matchedSample?.intent, "GetIntentWithSlot");
                assert.equal(slots?.[0]?.trim(), "5");
                assert.equal(slots?.[slotIndex(matchedSample, "number")]?.trim(), "5");
            });

            it("Matches a slotted phrase, no slot value", () => {
                const { matchedSample } = japaneseModel.utterance("おはよう");
                assert.equal(matchedSample?.intent, "GetIntent");
            });
        });
    });
});
