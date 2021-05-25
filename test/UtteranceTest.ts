import { assert } from "chai";
import { InteractionModel, SlotType } from "../src/model/InteractionModel";
import { VirtualAlexa } from '../src';

describe("UtteranceTest", function() {
    this.timeout(10000);

    const intents = [
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
    ];

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

    const model = new InteractionModel(intents, sampleUtterances, slotTypes);

    const slotIndex = (slotNames: string[], name: string): number => {
      return slotNames.findIndex(slotName => slotName.toLowerCase() === name.toLowerCase());
    }

    describe("#matchIntent", () => {
        it("Sends correct error message on missing interaction ", () => {
            try {
                VirtualAlexa.Builder().interactionModelFile("./test/resources/wrong-file.json");
            } catch (error) {
                assert.isTrue(error.message.includes("The interaction model for your Alexa Skill could not be"));
            }
        });

        it("Matches a simple phrase", () => {
            const { intent } = model.utterance("play");
            assert.equal(intent, "Play");
        });

        it("Matches a simple phrase, ignores case", () => {
            const { intent } = model.utterance("Play");
            assert.equal(intent, "Play");
        });

        it("Matches a simple phrase, ignores special characters", () => {
            const { intent } = model.utterance("play?");
            assert.equal(intent, "Play");
        });

        it("Matches help", () => {
            const { intent } = model.utterance("help");
            assert.equal(intent, "AMAZON.HelpIntent");
        });

        it("Matches a slotted phrase", () => {
            const { slots, intent } = model.utterance("slot value");
            assert.equal(intent, "SlottedIntent");
            assert.equal(slots?.["SlotName"], "value");
        });

        it("Matches a slotted phrase, no slot value", () => {
            const { intent } = model.utterance("slot");
            assert.equal(intent, "SlottedIntent");
        });

        it("Matches a phrase with multiple slots", () => {
            const { slots, intent } = model.utterance("multiple a and b");
            assert.equal(intent, "MultipleSlots");
            assert.equal(slots?.["SlotA"], "a");
            assert.equal(slots?.["SlotB"], "b");
        });

        it("Matches a phrase with multiple slots reversed", () => {
            const { slots, intent } = model.utterance("reversed a then b");
            assert.equal(intent, "MultipleSlots");
            assert.equal(slots?.["SlotA"], "b");
            assert.equal(slots?.["SlotB"], "a");
        });

        it("Matches a phrase with slot with enumerated values", () => {
            const { slots, intent } = model.utterance("US");
            assert.equal(intent, "CustomSlot");
            assert.equal(slots?.["country"], "US");
        });

        it("Does not match a phrase with slot with enumerated values", () => {
            const { intent } = model.utterance("hi");
            assert.equal(intent, "Hello");
        });

        it("Matches a phrase with slot with number value", () => {
            const { slots, intent } = model.utterance("19801");
            assert.equal(intent, "NumberSlot");
            assert.equal(slots?.["number"], "19801");
        });

        it("Matches a phrase with slot with long-form number value", () => {
            const { slots, intent } = model.utterance("one");
            assert.equal(intent, "NumberSlot");
            assert.equal(slots?.["number"], "one");

            const utterance2 = model.utterance("Thirteen");
            assert.equal(utterance2.slots?.["number"], "Thirteen");

            const utterance3 = model.utterance(" ten ");
            assert.equal(utterance3.slots?.["number"], "ten");
        });

        it("Does not match a phrase with numbers and letters to slot of number type", () => {
            const { intent } = model.utterance("19801a test");
            assert.equal(intent, "MultipleSlots");
        });

        it("Matches a more specific phrase", () => {
            const { intent } = model.utterance("1900 test");
            assert.equal(intent, "NumberSlot");
        });

        it("Matches with symbols in the phrase", () => {
            const { intent } = model.utterance("good? #%.morning");
            assert.equal(intent, "Hello");
        });

        it("Matches with punctuation in the phrase", () => {
            const { intent } = model.utterance("good, -morning:");
            assert.equal(intent, "Hello");
        });

        describe("Matches for International Languages", function() {
            const virtualAlexa = VirtualAlexa.Builder()
                    .handler("test/resources/index.handler")
                    .interactionModelFile("./test/resources/japanese_skill/models/ja-JP.json")
                    .create();

            it("Matches a slotted phrase", async () => {
                await virtualAlexa.filter(request => {
                    assert.equal(request.request.intent.name, "GetIntentWithSlot");
                    assert.equal(request.request.intent.slots["number"].value, "5");
                }).utter("5 人のプレーヤー");
            });

            it("Matches a slotted phrase, no slot value", async () => {
                await virtualAlexa.filter(request => {
                    assert.equal(request.request.intent.name, "GetIntent");
                }).utter("おはよう");
            });
        });
    });
});
