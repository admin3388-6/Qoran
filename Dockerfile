FROM node:18-slim

# تثبيت المترجمات الأساسية وأدوات الصوت
RUN apt-get update && \
    apt-get install -y ffmpeg build-essential python3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

CMD ["node", "index.js"]
