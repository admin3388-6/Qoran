FROM node:18-bullseye

RUN apt-get update && \
    apt-get install -y ffmpeg libsodium-dev build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["node", "index.js"]
