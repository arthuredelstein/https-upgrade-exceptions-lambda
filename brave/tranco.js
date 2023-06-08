'use strict';

const fetchText = async (url) => {
  const response = await fetch(url);
  return response.text();
};

const get = async (count = 1000) => {
  // First figure out what the ID of the current Tranco list is.
  const trancoId = await fetchText('https://tranco-list.eu/top-1m-id');
  const trancoUrl = `https://tranco-list.eu/download/${trancoId}/${count}`;
  const trancoRs = (await fetchText(trancoUrl)).trim();
  return {
    source: trancoUrl,
    domains: trancoRs.split('\r\n').map(line => line.split(',')[1])
  };
};

module.exports = {
  get
};
