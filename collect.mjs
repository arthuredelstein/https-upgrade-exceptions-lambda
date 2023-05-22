import { writeToDynamoDB } from "./util.mjs";

const resultsDB = "arn:aws:dynamodb:us-west-1:275005321946:table/https-results";

export const handler = async (event, context) => {
  console.log(event);
  if (event.Records) {
    for (const record of event.Records) {
      const data = JSON.parse(record.body);
      const result = await writeToDynamoDB(resultsDB, data);
      console.log({result});
    }
  } else {
    const result = await writeToDynamoDB(resultsDB, event);
    console.log({result});
  }
};