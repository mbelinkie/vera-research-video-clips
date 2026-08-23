FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

ADD --chmod=0444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /opt/research-video/certs/global-bundle.pem

ENV NODE_ENV=production \
  CLOUD_API_HOST=0.0.0.0 \
  CLOUD_API_PORT=43111 \
  CLOUD_DATABASE_MODE=postgres \
  DATABASE_SSL_MODE=verify-full \
  DATABASE_CA_CERT_PATH=/opt/research-video/certs/global-bundle.pem \
  CLOUD_AUTH_MODE=cognito \
  OBJECT_STORE_MODE=s3 \
  QUEUE_MODE=sqs \
  TRANSLATION_PROVIDER=aws-translate

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./
RUN npm ci --include=dev \
  && npm run typecheck

USER node
EXPOSE 43111
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "dev:cloud-api"]
