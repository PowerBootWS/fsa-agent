FROM node:20-alpine

# git is required to npm-install the private github: dependency (fsa-common).
RUN apk add --no-cache git

WORKDIR /app

COPY server/package*.json ./

# fsa-common is a private github: URL, so git needs auth at build time. The
# token comes in as a BuildKit secret and the temporary gitconfig carrying it is
# removed inside the SAME layer, so the token never persists in an image layer.
# Same pattern as fsa-crm / fsa-nurture / fsa-webhook-listener.
RUN --mount=type=secret,id=github_token \
    git config --global url."https://$(cat /run/secrets/github_token)@github.com/".insteadOf "https://github.com/" \
    && npm ci --omit=dev \
    && rm -f /root/.gitconfig

COPY server/src/ ./src/
COPY client/build/ ./client/build/
COPY client-v2/build/ ./client-v2/build/

EXPOSE 3000

CMD ["node", "src/index.js"]
