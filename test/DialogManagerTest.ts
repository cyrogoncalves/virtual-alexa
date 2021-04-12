import {assert} from "chai";
import {VirtualAlexa} from "../src";

process.on("unhandledRejection", (e: any) => console.error(e));

describe("DialogManager tests", () => {
    it("Interacts with delegated dialog", async () => {
        const virtualAlexa = VirtualAlexa.Builder()
            .handler("test/resources/dialogModel/dialog-index.handler")
            .interactionModelFile("test/resources/dialogModel/dialog-model.json")
            .create();

        await virtualAlexa.filter(request => {
            assert.equal(request.request.dialogState, "STARTED");
            assert.equal(request.request.intent.slots.size.value, "big");
            assert.equal(request.request.intent.slots.size.resolutionsPerAuthority.length, 1);
        }).intend("PetMatchIntent", {"size": "big"});

        await virtualAlexa.filter(request => {
            assert.equal(request.request.intent.slots.size.value, "big");
            assert.equal(request.request.intent.slots.temperament.value, "watch");
            assert.equal(request.request.intent.slots.temperament.resolutionsPerAuthority.length, 1);
        }).intend("PetMatchIntent", {"temperament": "watch"});
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
        virtualAlexa.filter(request => {
            request.request.intent.slots.size.confirmationStatus = "CONFIRMED";
            assert.equal(request.request.intent.slots.size.confirmationStatus, "CONFIRMED");
            assert.equal(request.request.intent.slots.size.value, "small");
        });

        skillResponse = await virtualAlexa.intend("PetMatchIntent", {"size": "small"});
        assert.equal(skillResponse.directive("Dialog.ElicitSlot").type, "Dialog.ElicitSlot");
        assert.equal(skillResponse.prompt(), "Are you looking for a family dog?");

        skillResponse = await virtualAlexa.intend("PetMatchIntent", { temperament: "family"});
        assert.equal(skillResponse.prompt(), "Do you prefer high energy dogs?");

        await virtualAlexa.intend("PetMatchIntent", { temperament: "family"});
    });
});
