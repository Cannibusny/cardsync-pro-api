FROM n8nio/n8n:2.8.4

USER root

# Set environment for n8n
ENV N8N_BLOCK_ENV_ACCESS_IN_NODE=false
ENV NODE_FUNCTION_ALLOW_BUILTIN=crypto
ENV N8N_RUNNERS_INSECURE_MODE=true
ENV N8N_PROTOCOL=https
ENV N8N_SECURE_COOKIE=true
ENV GENERIC_TIMEZONE=America/New_York

# Copy workflow files for import
COPY workflows/ /home/node/workflows/

USER node

EXPOSE 5678

CMD ["n8n", "start"]
