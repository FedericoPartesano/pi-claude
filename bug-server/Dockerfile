FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY app.mjs storage.mjs server.mjs ./
USER node
EXPOSE 8099
CMD ["node", "server.mjs"]
