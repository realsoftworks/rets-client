FROM node:20-bullseye as devcontainer

ENV APP_HOME /var/lib/rets-client

WORKDIR $APP_HOME

RUN apt-get update \
  &&  \
  apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  git \
  gpg \
  make \
  openssl \
  python3

RUN npm install -g coffeescript@^1.8.0

CMD ["npm", "run", "build"]