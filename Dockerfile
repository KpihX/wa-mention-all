FROM node:20-alpine

WORKDIR /app

# We install git since some libs of npm need it to install themselves
RUN apk add --no-cache git

# We firstly copy package.json to benefit from docker cache
COPY package.json .

# Dependancies installation
RUN npm install --production

COPY . .

RUN mkdir -p auth_info

CMD ["npm", "start"]

