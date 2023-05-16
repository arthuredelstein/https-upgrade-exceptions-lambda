FROM amazon/aws-lambda-nodejs:18
COPY index.js package.json ${LAMBDA_TASK_ROOT}/
RUN npm install
CMD [ "index.handler" ]