import * as path from "path";
import * as http from "http";
import * as https from "https";
import * as URL from "url";

/**
 * SkillInteractor comes in two flavors:
 *  {@link LocalSkillInteractor} - works with a local Lambda file
 *  {@link RemoteSkillInteractor} - works with a skill via HTTP calls to a URL
 *
 *  The core behavior is the same, sub-classes just implement the {@link SkillInteractor.invoke} routine
 */
export abstract class SkillInteractor {
  abstract invoke(requestJSON: any): Promise<any>;
}

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

export class RemoteSkillInteractor extends SkillInteractor {
  public constructor(private urlString: string) {
    super();
  }

  invoke(requestJSON: any): Promise<any> {
    const httpModule: any = this.urlString.startsWith("https") ? https : http;
    const url = URL.parse(this.urlString);
    const requestString = JSON.stringify(requestJSON);

    const requestOptions = {
      headers: {
        "Content-Length": Buffer.byteLength(requestString),
        "Content-Type": "application/json",
      },
      hostname: url.hostname,
      method: "POST",
      path: url.path,
      port: url.port ? parseInt(url.port, 10) : undefined,
    };

    return new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (response: any) => {
        if (response.statusCode !== 200) {
          reject("Invalid response: " + response.statusCode + " Message: " + response.statusMessage);
          return;
        }

        let responseString = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          responseString = responseString + chunk;
        });

        response.on("end", () => {
          try {
            const responseJSON = JSON.parse(responseString);
            resolve(responseJSON);
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on("error", (e: Error) => {
        console.error(`problem with request: ${e.message}`);
        reject(e);
      });

      req.write(requestString);
      req.end();
    });
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