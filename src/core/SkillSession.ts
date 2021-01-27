import * as uuid from "uuid";

/**
 * Information about the current open session on the Alexa emulator
 */
export class SkillSession {
    attributes: {[id: string]: any} = {};
    private new = true;
    id: string = "SessionID." + uuid.v4();

    public isNew(): boolean {
        return this.new;
    }

    public used(): void {
        this.new = false;
    }
}
