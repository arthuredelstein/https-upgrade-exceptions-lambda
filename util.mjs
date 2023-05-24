import AWS from 'aws-sdk';

const sqs = new AWS.SQS({apiVersion: '2012-11-05'});

const callback = (resolve, reject) => (err, data) => err ? reject(err) : resolve(data);

export const sendToSQS = (url, messageObject) => {
  const params = {
    // Remove DelaySeconds parameter and value for FIFO queues
    DelaySeconds: 0,
    MessageBody: JSON.stringify(messageObject),
    QueueUrl: url
  };
  return new Promise((resolve, reject) => sqs.sendMessage(params, callback(resolve, reject)));
};

export const sendBatchToSQS = (url, messageObjectArray) => {
  const params = {
    Entries: messageObjectArray.map(messageObject => ({
      Id: Math.random().toString().slice(2),
      MessageBody: JSON.stringify(messageObject)
    })),
    QueueUrl: url
  };
  return new Promise((resolve, reject) => sqs.sendMessageBatch(params, callback(resolve, reject)));
};

const dyanmo = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-11-05'});

export const writeToDynamoDB = (url, item) => {
  const params = {
    TableName: 'https-results',
    Item: item
  };
  return new Promise((resolve, reject) => dyanmo.put(params, callback(resolve, reject)));
};