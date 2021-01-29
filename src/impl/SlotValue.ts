import { ConfirmationStatus } from "../dialog/DialogManager";
import { SlotType } from '../virtualCore/SlotTypes';

export class SlotValue {
    public resolutions: {
        resolutionsPerAuthority: {
            values: {
                value: EntityResolutionValue
            }[];
            status: {
                code: EntityResolutionStatus
            };
            authority: string;
        }[]
    };

    public constructor(
        public name: string,
        public value: string,
        public confirmationStatus = ConfirmationStatus.NONE
    ) {}

    public setEntityResolution(applicationId: string, slotType: SlotType) {
        this.resolutions = { resolutionsPerAuthority: [] };
        const authority = `amzn1.er-authority.echo-sdk.${applicationId}.${slotType.name}`;
        const matches = slotType.matchAll(this.value).filter(m => m.enumeratedValue && !m.enumeratedValue.builtin);
        // If this is not a builtin value, we add the entity resolution
        if (!matches.length) {
            this.addEntityResolution(authority, EntityResolutionStatus.ER_SUCCESS_NO_MATCH);
        } else {
            // Possible to have multiple matches, where we have overlapping synonyms
            matches.forEach(match => this.addEntityResolution(authority, EntityResolutionStatus.ER_SUCCESS_MATCH,
                [{ value: { id: match.enumeratedValue.id, name: match.enumeratedValue.name.value } }]));
        }
    }

    private addEntityResolution(
        authority: string,
        code: EntityResolutionStatus,
        values: { value: EntityResolutionValue }[] = []
    ) {
        const existingResolution = this.resolutions.resolutionsPerAuthority
            .find(resolution => resolution.authority === authority);
        if (existingResolution) {
            existingResolution.values.push(values[0]);
        } else {
            this.resolutions.resolutionsPerAuthority.push({ authority, values, status: { code } });
        }
    }
}

interface EntityResolutionValue {
    id: string,
    name: string
}

export enum EntityResolutionStatus {
    ER_SUCCESS_MATCH = "ER_SUCCESS_MATCH",
    ER_SUCCESS_NO_MATCH = "ER_SUCCESS_NO_MATCH",
    ER_ERROR_TIMEOUT = "ER_ERROR_TIMEOUT",
    ER_ERROR_EXCEPTION = "ER_ERROR_EXCEPTION",
}
