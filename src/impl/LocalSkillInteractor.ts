import * as path from "path";
import { SkillInteractor } from "./SkillInteractor";

export class LocalSkillInteractor extends SkillInteractor {
    public constructor(private handler: string | ((...args: any[]) => void)) {
        super();
    }

    invoke(requestJSON: any): Promise<any> {
        // If this is a string, means we need to parse it to find the filename and function name
        // Otherwise, we assume it is a function, and just invoke the function directly
        const handlerFunction = typeof this.handler === "string" ? LocalSkillInteractor.getFunction(this.handler) : this.handler;
        return LocalSkillInteractor.invokeFunction(handlerFunction, requestJSON);
    }

    private static getFunction(handler: string): (...args: any[]) => void {
        let functionName = "handler";
        let fileName = handler;
        // By default, we use handler as the name of the function in the lamba
        // If the filename does not end with .js, we assume the last part is the function name (e.g., index.handler)
        if (!handler.endsWith(".js")) {
            const functionSeparatorIndex = handler.lastIndexOf(".");
            functionName = handler.substr(functionSeparatorIndex + 1);
            fileName = handler.substr(0, functionSeparatorIndex);
            // Replace dots with slashes
            fileName += ".js";
        }
        const fullPath = path.isAbsolute(fileName) ? fileName : path.join(process.cwd(), fileName);
        const handlerModule = require(fullPath);
        return handlerModule[functionName];
    }

    private static invokeFunction(lambdaFunction: (...args: any[]) => any, event: any): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            const callback = (error: Error, result: any) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };

            const context = new LambdaContext(callback);
            const promise = lambdaFunction(event, context, callback);
            // For Node8, lambdas can return a promise - if they do, we call the context object with results
            if (promise) {
                promise.then((result: any) => {
                    context.done(null, result);
                }).catch((error: any) => {
                    context.done(error, null);
                });
            }
        });
    }
}

class LambdaContext {
    public awsRequestId = "N/A";
    public callbackWaitsForEmptyEventLoop = true;
    public functionName = "BST.LambdaServer";
    public functionVersion = "N/A";
    public memoryLimitInMB = -1;
    public invokedFunctionArn = "N/A";
    public logGroupName = "N/A";
    public logStreamName: string = null;
    public identity: any = null;
    public clientContext: any = null;

    public constructor(private callback: (error: Error, result: any) => void) {}

    public fail(error: Error) {
        this.done(error, null);
    }

    public succeed(body: any) {
        this.done(null, body);
    }

    public getRemainingTimeMillis() {
        return -1;
    }

    public done(error: Error, body: any) {
        let statusCode: number = 200;
        let contentType: string = "application/json";
        let bodyString: string;

        if (error === null) {
            bodyString = JSON.stringify(body);
        } else {
            statusCode = 500;
            contentType = "text/plain";
            bodyString = "Unhandled Exception from Lambda: " + error.toString();
        }

        this.callback(error, body);
    }
}
