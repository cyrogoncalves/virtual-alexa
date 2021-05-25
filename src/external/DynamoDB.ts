import * as AWS from "aws-sdk";
import * as nock from "nock";

export class DynamoDB {
    /** @internal */
    private static putScope: any; // We keep the nock scope as a singleton - only one can be active at a time
    /** @internal */
    private static getScope: any; // We keep the nock scope as a singleton - only one can be active at a time
    /** @internal */
    private static createScope: any; // We keep the nock scope as a singleton - only one can be active at a time

    private records: any[] = [];
    private region = "us-east-1";

    public mock() {
        if (process.env.AWS_REGION)
            this.region = process.env.AWS_REGION || "us-east-1";
        process.env["AWS_REGION"] = process.env["AWS_REGION"] || "us-east-1";
        process.env["AWS_ACCESS_KEY_ID"] = process.env["AWS_ACCESS_KEY_ID"] || "123456789";
        process.env["AWS_SECRET_ACCESS_KEY"] = process.env["AWS_SECRET_ACCESS_KEY"] || "123456789";

        if (!nock.isActive()) {
            nock.activate();
        }

        const baseUrl = `https://dynamodb.${this.region}.amazonaws.com:443`;
        this.mockPut(baseUrl);
        this.mockGet(baseUrl);
        this.mockCreate(baseUrl);
    }

    public reset() {
        this.records = [];
        DynamoDB.getScope?.persist(false);
        DynamoDB.putScope?.persist(false);
        DynamoDB.createScope?.persist(false);
    }

    // Go through records in reverse order, as we may have duplicates for a key.
    // We want to get the latest.
    // The key is an object, with potentially multiple fields. They each need to match.
    private fetchImpl(table: string, key: any): any | undefined {
        return this.records.reverse().filter(r => r.TableName === table).find(record => {
            const o = AWS.DynamoDB.Converter.unmarshall(record.Item);
            return Object.keys(key).every(keyPart => o[keyPart] && o[keyPart] === key[keyPart]);
        });
    }

    private mockPut(baseUrl: string) {
        // const baseURL = new RegExp(".*dynamodb.*");
        // Built this based on this info:
        //  https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html#API_PutItem_Examples
        DynamoDB.putScope = nock(baseUrl)
            .matchHeader("x-amz-target", value => value.endsWith("PutItem"))
            .persist()
            .post("/", body => {
                this.records.push(body);
                return true;
            })
            .query(true)
            .reply(200, JSON.stringify({}));
    }

    private mockGet(baseUrl: string) {
        // Built this based on this info:
        //  https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html#API_PutItem_Examples
        DynamoDB.getScope = nock(baseUrl)
            .matchHeader("x-amz-target", value => value.endsWith("GetItem"))
            .persist()
            .post("/", () => true)
            .query(true)
            .reply(200, (uri: string, requestBody: any) => {
                const requestObject = JSON.parse(requestBody);
                // Turn this into a regular javascript object - we use this for searching
                const keySimple = AWS.DynamoDB.Converter.unmarshall(requestObject.Key);
                return this.fetchImpl(requestObject.TableName, keySimple) || {};
            });
    }

    private mockCreate(baseUrl: string) {
        // Built this based on this info:
        //  https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
        // Basically, create table calls return with the table info plus a status of CREATING
        DynamoDB.createScope = nock(baseUrl)
            .matchHeader("x-amz-target", value => value.endsWith("CreateTable"))
            .persist()
            .post("/", () => true)
            .query(true)
            .reply(200, (uri: string, requestBody: any) => {
                const bodyJSON = JSON.parse(requestBody);
                bodyJSON.TableStatus =  "CREATING";
                return { TableDescription: bodyJSON };
            });
    }
}
