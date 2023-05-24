import { get as getTrancoData } from './brave/tranco.js';
import { sendBatchToSQS } from './util.mjs';

const domainQueue = "https://sqs.us-west-1.amazonaws.com/275005321946/domain-queue";

const chunk = (array, n) => {
  const chunks = [];
  let chunk = [];
  for (let i = 0; i < array.length; ++i) {
    chunk.push(array[i]);
    if ((i + 1) % n === 0) {
      chunks.push(chunk);
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    chunks.push(chunk);
  }
  return chunks;
}

const getChunkedDomains = async (total, chunkSize) => {
  const { domains } = await getTrancoData(total);
  return chunk(domains, chunkSize);
}

export const handler = async (event, context) => {
  const domains = await getChunkedDomains(1000000, 10);
  const resultPromises = [];
  for (const batch of domains) {
    const resultPromise = sendBatchToSQS(domainQueue, batch.map(domain => ({ domain })));
    resultPromises.push(resultPromise);
  }
  await Promise.all(resultPromises);
};