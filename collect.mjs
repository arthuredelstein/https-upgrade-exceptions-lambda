import { writeToDynamoDB } from "./util.mjs";

const resultsDB = "arn:aws:dynamodb:us-west-1:275005321946:table/https-results";

export const handler = async (event, context) => {
  console.log(event);
  for (const record of event.Records) {
    const data = record.body;
    const result = await writeToDynamoDB(resultsDB, data);
    console.log(result);
  }
};