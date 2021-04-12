import {assert} from "chai";
import {SkillResponse} from "../src/core/SkillResponse";
import {VirtualAlexa} from "../src/core/VirtualAlexa";
import { ConfirmationStatus } from '../src/core/SkillContext';

process.on("unhandledRejection", (e: any) => console.error(e));

describe("DialogManager tests", () => {
    it("Interacts with delegated dialog", async () => {
        const virtualAlexa = VirtualAlexa.Builder()
            .handler("test/resources/dialogModel/dialog-index.handler")
            .interactionModelFile("test/resources/dialogModel/dialog-model.json")
            .create();

        let request = virtualAlexa.request().intent("PetMatchIntent").slot("size", "big");
        assert.equal(request.json.request.dialogState, "STARTED");
        assert.equal(request.json.request.intent.slots.size.value, "big");
        assert.equal(request.json.request.intent.slots.size.resolutionsPerAuthority.length, 1);
        await request.send();

        let request2 = virtualAlexa.request().intent("PetMatchIntent").slot("temperament", "watch");
        assert.equal(request2.json.request.intent.slots.size.value, "big");
        assert.equal(request2.json.request.intent.slots.temperament.value, "watch");
        assert.equal(request2.json.request.intent.slots.temperament.resolutionsPerAuthority.length, 1);
        await request2.send();
    });

    it("Interacts with delegated dialog, version 2", async () => {
        const virtualAlexa = VirtualAlexa.Builder()
            .handler("test/resources/dialogModel/dialog-index.handler")
            .interactionModelFile("test/resources/dialogModel/dialog-model.json")
            .create();

        const response = await virtualAlexa.intend("PetMatchIntent", { size: "big"});
        assert.equal(response.directive("Dialog.Delegate").type, "Dialog.Delegate");

        const response2 = await  virtualAlexa.intend("PetMatchIntent", { temperament: "watch"});
        assert.equal(response2.directive("Dialog.Delegate").type, "Dialog.Delegate");

        const response3 = await virtualAlexa.intend("PetMatchIntent", { energy: "high"});
        assert.equal(response3.directive("Dialog.Delegate").type, "Dialog.Delegate");
    });

    it("Interacts with dialog with explicit slot handling", async () => {
        const virtualAlexa = VirtualAlexa.Builder()
            .handler("test/resources/dialogModel/dialog-manual-index.handler")
            .interactionModelFile("test/resources/dialogModel/dialog-model.json")
            .create();

        let skillResponse = await virtualAlexa.intend("PetMatchIntent", { size: "big"});
        assert.equal(skillResponse.directive("Dialog.ElicitSlot").type, "Dialog.ElicitSlot");
        assert.include(skillResponse.prompt(), "Are you looking for a family dog?");

        skillResponse = await virtualAlexa.intend("PetMatchIntent", { temperament: "watch"});
        assert.equal(skillResponse.prompt(), "Do you prefer high energy dogs?");

        skillResponse = await virtualAlexa.intend("PetMatchIntent", { energy: "high"});
        assert.equal(skillResponse.prompt(), "Done with dialog");
    });

    it("Interacts with dialog with explicit slot handling and confirmations", async () => {
        const virtualAlexa = VirtualAlexa.Builder()
            .handler("test/resources/dialogModel/dialog-manual-index.handler")
            .interactionModelFile("test/resources/dialogModel/dialog-model.json")
            .create();

        let skillResponse = await virtualAlexa.intend("PetMatchIntent", { size: "small"});
        assert.equal(skillResponse.directive("Dialog.ConfirmSlot").type, "Dialog.ConfirmSlot");
        assert.include(skillResponse.prompt(), "small?");
        virtualAlexa.filter((request) => {
            assert.equal(request.request.intent.slots.size.confirmationStatus, "CONFIRMED");
            assert.equal(request.request.intent.slots.size.value, "small");
        });

        skillResponse = await virtualAlexa.request().intent("PetMatchIntent")
            .slot("size", "small", ConfirmationStatus.CONFIRMED).send();
        virtualAlexa.resetFilter();
        assert.equal(skillResponse.directive("Dialog.ElicitSlot").type, "Dialog.ElicitSlot");
        assert.equal(skillResponse.prompt(), "Are you looking for a family dog?");

        skillResponse = await virtualAlexa.intend("PetMatchIntent", { temperament: "family"});
        assert.equal(skillResponse.prompt(), "Do you prefer high energy dogs?");

        await virtualAlexa.intend("PetMatchIntent", { temperament: "family"});
    });
});
