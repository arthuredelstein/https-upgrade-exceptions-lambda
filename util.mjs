import { SQSClient, AddPermissionCommand } from "@aws-sdk/client-sqs";

const client = new SQSClient({ region: "us-west-1" });

const callback = (resolve, reject) => (err, data) => err ? reject(err) : resolve(data);

export const sendToSQS = (url, messageObject) => {
  const params = {
    // Remove DelaySeconds parameter and value for FIFO queues
    DelaySeconds: 0,
    MessageBody: JSON.stringify(messageObject),
    QueueUrl: url
  };
  const command = new AddPermissionCommand(params);
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
  const command = new AddPermissionCommand(params);
  return client.send(command);
};
