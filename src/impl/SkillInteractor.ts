import { SkillRequest } from "../core/SkillRequest";
import { SkillResponse } from "../core/SkillResponse";
import { RequestFilter, VirtualAlexa } from "../core/VirtualAlexa";

/**
 * SkillInteractor comes in two flavors:
 *  {@link LocalSkillInteractor} - works with a local Lambda file
 *  {@link RemoteSkillInteractor} - works with a skill via HTTP calls to a URL
 *
 *  The core behavior is the same, sub-classes just implement the {@link SkillInteractor.invoke} routine
 */
export abstract class SkillInteractor {
    protected requestFilter: RequestFilter = null;
    protected _alexa: VirtualAlexa = null;

    public filter(requestFilter: RequestFilter): void {
        this.requestFilter = requestFilter;
    }

    public async callSkill(serviceRequest: SkillRequest): Promise<SkillResponse> {
        // When the user utters an intent, we suspend for it
        // We do this first to make sure everything is in the right state for what comes next
        if (serviceRequest.json.request.intent
            && this._alexa.context.device.audioPlayerSupported()
            && this._alexa.context.audioPlayer.isPlaying()) {
            await this._alexa.context.audioPlayer.suspend();
        }

        if (this.requestFilter) {
            this.requestFilter(serviceRequest.json);
        }

        const result: any = await this.invoke(serviceRequest.json);

        // If this was a session ended request, end the session in our internal state
        if (serviceRequest.json.request.type === "SessionEndedRequest") {
            this._alexa.context.endSession();
        }

        if (this._alexa.context.activeSession()) {
            this._alexa.context.session().used();
            if (result && result.response && result.response.shouldEndSession) {
                this._alexa.context.endSession();
            } else if (result.sessionAttributes !== undefined && result.sessionAttributes !== null) {
                this._alexa.context.session().attributes = result.sessionAttributes;
            }
        }

        if (result.response !== undefined && result.response.directives !== undefined) {
            await this._alexa.context.audioPlayer.directivesReceived(result.response.directives);
            // Update the dialog manager based on the results
            this._alexa.context.dialogManager.handleDirective(result);
        }

        // Resume the audio player, if suspended
        if (serviceRequest.json.request.intent
            && this._alexa.context.device.audioPlayerSupported()
            && this._alexa.context.audioPlayer.suspended()) {
            await this._alexa.context.audioPlayer.resume();
        }

        return new SkillResponse(result);
    }

    protected abstract invoke(requestJSON: any): Promise<any>;

}
