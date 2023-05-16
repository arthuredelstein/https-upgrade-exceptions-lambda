import { get as getTrancoData } from './brave/tranco.js';
import { sendToSQS } from './util.mjs';

const domainQueue = "https://sqs.us-west-1.amazonaws.com/275005321946/domain-queue";

export const handler = async (event, context) => {
  const { domains } = await getTrancoData(10);
  console.log(domains);
  for (const domain of domains) {
    const result = await sendToSQS(domainQueue, JSON.stringify({domain}));
    console.log(domain, ":", result);
  }
};