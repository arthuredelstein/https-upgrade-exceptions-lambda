import { get as getTrancoDomains } from './brave/tranco';
import { sendToSQS } from './util.mjs';

export const handler = async (event, context) => {
  const domains = await getTrancoDomains();
};