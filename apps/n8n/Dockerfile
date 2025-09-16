# n8n on Railway with pdfme libs available to Code node
FROM n8nio/n8n:latest

USER root

# Set timezone (optional)
ENV TZ=Europe/Ljubljana

# Allow external modules for the Code node
ENV NODE_FUNCTION_ALLOW_EXTERNAL=@pdfme/generator,@pdfme/common,@pdfme/schemas,pdf-lib

# Install required modules into n8n's app directory so the Code node can resolve them
RUN npm i --prefix /usr/local/lib/node_modules/n8n @pdfme/generator @pdfme/common @pdfme/schemas pdf-lib

# Ensure Node can resolve modules from that prefix
ENV NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules

USER node
