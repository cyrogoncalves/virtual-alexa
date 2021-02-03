import * as path from "path";
import { SkillInteractor } from "./SkillInteractor";

export class LocalSkillInteractor extends SkillInteractor {
    public constructor(private handler: string | ((...args: any[]) => void)) {
        super();
    }

    invoke(requestJSON: any): Promise<any> {
        // If this is a string, means we need to parse it to find the filename and function name
        // Otherwise, we assume it is a function, and just invoke the function directly
        const handlerFunction: (...args: any[]) => any = typeof this.handler === "string"
            ? LocalSkillInteractor.getFunction(this.handler) : this.handler;
        return new Promise<any>((resolve, reject) => {
            const callback = (error: Error, result: any) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };

            const context = new LambdaContext(callback);
            // For Node8, lambdas can return a promise - if they do, we call the context object with results
            handlerFunction(requestJSON, context, callback)
                ?.then((result: any) => resolve(result))
                .catch((error: any) => reject(error));
        });
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
}

class LambdaContext {
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
        this.callback(error, body);
    }
}
