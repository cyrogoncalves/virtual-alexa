// This is only initialized when the Lambda is, so it is preserved across calls
// It is NOT a real database, but can be used for testing, as JavaScript Lambdas tend to live for a few hours
// Stay tuned for a more sophisticated example that uses DynamoDB
const lastPlayedByUser = {};

const podcastFeed = [
    "https://feeds.soundcloud.com/stream/323049941-user-652822799-episode-013-creating-alexa-skills-using-bespoken-tools-with-john-kelvie.mp3",
    "https://feeds.soundcloud.com/stream/318108640-user-652822799-episode-012-alexa-skill-certification-with-sameer-lalwanilexa-dev-chat-final-mix.mp3",
    "https://feeds.soundcloud.com/stream/314247951-user-652822799-episode-011-alexa-smart-home-partner-network-with-zach-parker.mp3",
    "https://feeds.soundcloud.com/stream/309340878-user-652822799-episode-010-building-an-alexa-skill-with-flask-ask-with-john-wheeler.mp3"
];

let started = false;
let stopped = false;
// Entry-point for the Lambda
exports.handler = function(event, context) {
    new SimplePlayer(event, context).handle();
};

// The SimplePlayer has helpful routines for interacting with Alexa, within minimal overhead
const SimplePlayer = function (event, context) {
    this.event = event;
    this.context = context;
};

// Handles an incoming Alexa request
SimplePlayer.prototype.handle = function () {
    const requestType = this.event.request.type;
    const userId = this.event.context ? this.event.context.System.user.userId : this.event.session.user.userId;
    let podcastIndex;

    // On launch, we tell the user what they can do (Play audio :-))
    switch (requestType) {
        case "LaunchRequest":
            return this.say("Welcome to the Simple Audio Player. Say Play to play some audio!", "You can say Play");

        case "IntentRequest":
            const lastPlayed = this.loadLastPlayed(userId);

            // We assume we start with the first podcast, but check the lastPlayed
            podcastIndex = lastPlayed ? parseInt(lastPlayed.request.token) : 0;

            switch (this.event.request.intent.name) {
                case "Play":
                    return this.play(podcastFeed[podcastIndex], 0, "REPLACE_ALL", podcastIndex);
                case "PlayUndefined":
                    return this.play(null, 0, "REPLACE_ALL", 0);
                case "Ignore":
                    return this.say("Ignoring", "You can say Play");
                case "AMAZON.NextIntent":
                    if (!started) throw new Error("This should not happen - started flag not set");
                    started = false;
                    if (!stopped) throw new Error("This should not happen - stopped flag not set");
                    // If we have reached the end of the feed, start back at the beginning
                    podcastIndex >= podcastFeed.length - 1 ? podcastIndex = 0 : podcastIndex++;

                    return this.play(podcastFeed[podcastIndex], 0, "REPLACE_ALL", podcastIndex);
                case "AMAZON.PreviousIntent":
                    if (!started) throw new Error("This should not happen - started flag not set");

                    // If we have reached the start of the feed, go back to the end
                    podcastIndex === 0 ? podcastIndex = podcastFeed.length - 1 : podcastIndex--;

                    return this.play(podcastFeed[podcastIndex], 0, "REPLACE_ALL", podcastIndex);
                case "AMAZON.PauseIntent": // When we receive a Pause Intent, we need to issue a stop directive
                    //  Otherwise, it will resume playing - essentially, we are confirming the user's action
                    return this.stop();
                case "AMAZON.ResumeIntent":
                    const offsetInMilliseconds = lastPlayed ? lastPlayed.request.offsetInMilliseconds : 0;
                    return this.play(podcastFeed[podcastIndex], offsetInMilliseconds, "REPLACE_ALL", podcastIndex);
            }
            break;
        case "AudioPlayer.PlaybackNearlyFinished":
            const lastIndex = this.event ? parseInt(this.event.request.token) : 0;
            podcastIndex = lastIndex;

            // If we have reach the end of the feed, start back at the beginning
            podcastIndex >= podcastFeed.length - 1 ? podcastIndex = 0 : podcastIndex++;

            // Enqueue the next podcast
            return this.play(podcastFeed[podcastIndex], 0, "ENQUEUE", podcastIndex, lastIndex);
        case "AudioPlayer.PlaybackStarted": // Dom something async to that we have waited for it to finish
            setTimeout(() => {
                started = true;
                // We simply respond with true to acknowledge the request
                this.context.succeed(true);
            }, 10);
            break;
        case "AudioPlayer.PlaybackStopped": // We save off the PlaybackStopped Intent, so we know what was last playing
            this.saveLastPlayed(userId, this.event);

            setTimeout(() => {
                stopped = true;
                // We simply respond with true to acknowledge the request
                this.context.succeed(true);
            }, 10);
            break;
        case "SessionEndedRequest": // We respond with just true to acknowledge the request
            return this.context.succeed({
                version: "1.0",
                response: {
                    shouldEndSession: true
                }
            });
    }
};

/**
 * Creates a proper Alexa response using Text-To-Speech
 * @param message
 * @param repromptMessage
 */
SimplePlayer.prototype.say = function (message, repromptMessage) {
    this.context.succeed({
        version: "1.0",
        response: {
            shouldEndSession: false,
            outputSpeech: {
                type: "SSML",
                ssml: "<speak> " + message + " </speak>"
            },
            reprompt: {
                outputSpeech: {
                    type: "SSML",
                    ssml: "<speak> " + repromptMessage + " </speak>"
                }
            }
        }
    });
};

/**
 * Plays a particular track for playback, either now or after the current track finishes
 * @param url The URL to play
 * @param offsetInMilliseconds The point from which to play - we set this to something other than zero when resuming
 * @param playBehavior Either REPLACE_ALL, ENQUEUE or REPLACE_ENQUEUED
 * @param token An identifier for the track we are going to play next
 * @param expectedPreviousToken This should only be set if we are doing an ENQUEUE or REPLACE_ENQUEUED
 */
SimplePlayer.prototype.play = function (url, offsetInMilliseconds, playBehavior, token, expectedPreviousToken) {
    this.context.succeed({
        version: "1.0",
        response: {
            shouldEndSession: true,
            directives: [
                {
                    type: "AudioPlayer.Play",
                    playBehavior: playBehavior,
                    audioItem: {
                        stream: {
                            url,
                            token, // Unique token for the track - needed when queueing multiple tracks
                            expectedPreviousToken, // The expected previous token - when using queues, ensures safety
                            offsetInMilliseconds
                        }
                    }
                }
            ]
        }
    });
};

// Stops the playback of Audio
SimplePlayer.prototype.stop = function () {
    this.context.succeed({
        version: "1.0",
        response: {
            shouldEndSession: true,
            directives: [
                {
                    type: "AudioPlayer.Stop"
                }
            ]
        }
    });
};

// Saves information into our super simple, not-production-grade cache
SimplePlayer.prototype.saveLastPlayed = function (userId, lastPlayed) {
    lastPlayedByUser[userId] = lastPlayed;
};

// Load information from our super simple, not-production-grade cache
SimplePlayer.prototype.loadLastPlayed = function (userId) {
    return lastPlayedByUser[userId] || null;
};
