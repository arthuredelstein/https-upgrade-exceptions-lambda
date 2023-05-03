FROM amazon/aws-lambda-nodejs:18
COPY index.js package.json ./
RUN npm install
CMD [ "index.handler" ]