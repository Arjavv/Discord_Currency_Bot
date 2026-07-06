FROM node:22

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and assets
COPY . .

# Expose health check server port (default 8000 for Koyeb/Render/Hugging Face)
EXPOSE 8000

CMD [ "npm", "start" ]
