import * as nock from "nock";
import { SkillContext } from "../core/SkillContext";

export class UserAPI {
    /** @internal */
    private static scope: nock.Scope; // We keep the nock scope as a singleton - only one can be active at a time

    public constructor(private context: SkillContext) {
        this.reset();
    }

    public reset() {
        nock.cleanAll();
    }

    /**
     * Sets the different properties in user profile as payload for the paths used in Alexa Profile Service
     * Paths mocked end with /v2/accounts/~current/settings/Profile.{key}
     * If the property is not present, returns a 403 error
     * @param {IUserProfile} userProfile
     */
    public returnsUserProfile(userProfile: IUserProfile) {
        if (!nock.isActive()) {
            nock.activate();
        }

        let scope = nock(this.context.apiEndpoint).persist();

        // Alexa User Profile possible paths
        // Full Name	/v2/accounts/~current/settings/Profile.name
        // Given Name	/v2/accounts/~current/settings/Profile.givenName
        // Email Address	/v2/accounts/~current/settings/Profile.email
        // Phone Number	/v2/accounts/~current/settings/Profile.mobileNumber
        ["name", "givenName", "email", "mobileNumber"].forEach((key) => {
            const userProfileElement = (userProfile as any)[key];
            const nockResponse = !userProfileElement ? {responseCode: 403} : {
                responseCode: 200,
                payload: JSON.stringify(userProfileElement, null, 2)
            };
            scope = scope.get(path => path === "/v2/accounts/~current/settings/Profile." + key)
                .query(true)
                .reply(nockResponse.responseCode, nockResponse.payload);
        });

        UserAPI.scope = scope;
    }
}

export interface IUserProfile {
    name?: string,
    givenName?: string
    email?: string,
    mobileNumber?: {
        countryCode: string,
        phoneNumber: string,
    }
}
