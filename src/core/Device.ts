import * as uuid from "uuid";

export class Device {
    readonly supportedInterfaces: any = {};

    /** @internal */
    public constructor(public id?: string) {
        // By default, we support the AudioPlayer
        this.audioPlayerSupported(true);
    }

    public generatedID(): void {
        if (!this.id) {
            this.id = "virtualAlexa.deviceID." + uuid.v4();
        }
    }

    public audioPlayerSupported(value?: boolean): boolean {
        return this.supportedInterface("AudioPlayer", value);
    }

    public displaySupported(value?: boolean): boolean {
        return this.supportedInterface("Display", value);
    }

    public videoAppSupported(value?: boolean) {
        return this.supportedInterface("VideoApp", value);
    }

    private supportedInterface(name: string, value?: boolean): boolean {
        if (value !== undefined) {
            if (value === true) {
                this.supportedInterfaces[name] = {};
            } else {
                delete this.supportedInterfaces[name];
            }
        }
        return this.supportedInterfaces[name] !== undefined;
    }
}
