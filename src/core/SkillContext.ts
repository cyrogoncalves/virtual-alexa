
export enum ConfirmationStatus {
    CONFIRMED = "CONFIRMED",
    DENIED = "DENIED",
    NONE = "NONE",
}

type DialogState = "COMPLETED" | "IN_PROGRESS" | "STARTED";

export class DialogManager {
    private _confirmationStatus: ConfirmationStatus;
    private _dialogState: DialogState;
    private _slots: {[id: string]: {
        value: string,
        resolutions: string,
        confirmationStatus: string,
    }} = {};

    /** @internal */
    public handleDirective(directive: any): void {
        this._dialogState = this._dialogState ? "IN_PROGRESS" : "STARTED";

        if (directive.type === "Dialog.Delegate") {
            this._confirmationStatus = ConfirmationStatus.NONE;
        } else if (["Dialog.ElicitSlot", "Dialog.ConfirmSlot", "Dialog.ConfirmIntent"].includes(directive.type)) {
            // Start the dialog if not started, otherwise mark as in progress
            if (!this._confirmationStatus)
                this._confirmationStatus = ConfirmationStatus.NONE;
            if (directive.updatedIntent)
                this.updateSlotStates(directive.updatedIntent.slots);
            if (directive.type === "Dialog.ConfirmIntent")
                this._dialogState = "COMPLETED";
        }
    }

    /**
     * Set the confirmation status for the dialog
     * @param confirmationStatus
     */
    public confirmationStatus(confirmationStatus: ConfirmationStatus) {
        if (confirmationStatus) {
            this._confirmationStatus = confirmationStatus;
        }
        return this._confirmationStatus;
    }

    /** @internal */
    public handleRequest(): DialogState {
        // Make sure the dialog state is set to started
        if (!this._dialogState)
            this._dialogState = "STARTED";
        return this._dialogState;
    }

    /** @internal */
    public isDialog() {
        return this._dialogState !== undefined;
    }

    public reset() {
        this._confirmationStatus = undefined;
        this._dialogState = undefined;
        this._slots = {};
    }

    /** @internal */
    public slots() {
        return this._slots;
    }

    /**
     * Set the dialog state
     * @param state
     */
    public state(state?: DialogState) {
        if (state)
            this._dialogState = state;
        return this._dialogState;
    }

    /** @internal */
    public updateSlot(slotName: string, newSlot: any) {
        const existingSlot = this._slots[slotName];

        // Update the slot value in the dialog manager if the intent has a new value
        if (!existingSlot) {
            this._slots[slotName] = newSlot;
        } else if (newSlot.value) {
            existingSlot.value = newSlot.value;
            existingSlot.resolutions = newSlot.resolutions;
            existingSlot.confirmationStatus = newSlot.confirmationStatus;
        }
    }

    /** @internal */
    public updateSlotStates(slots: {[id: string]: any}): void {
        if (slots) {
            for (const slotName of Object.keys(slots)) {
                const newSlot = slots[slotName];
                this.updateSlot(slotName, newSlot);
            }
        }
    }
}
