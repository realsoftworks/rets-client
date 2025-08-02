FROM node:20-bookworm as devcontainer

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

RUN npm install -g coffeescript@^1.8.0 @anthropic-ai/claude-code

CMD ["npm", "run", "build"]