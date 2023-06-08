import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({ region: 'us-west-1' });

export const sendToSQS = (url, messageObject) => {
  const params = {
    DelaySeconds: 0,
    MessageBody: JSON.stringify(messageObject),
    QueueUrl: url
  };
  const command = new SendMessageCommand(params);
  return client.send(command);
};

export const sendBatchToSQS = (url, messageObjectArray) => {
  const params = {
    Entries: messageObjectArray.map(messageObject => ({
      Id: Math.random().toString().slice(2),
      MessageBody: JSON.stringify(messageObject)
    })),
    QueueUrl: url
  };
  const command = new SendMessageBatchCommand(params);
  return client.send(command);
};
