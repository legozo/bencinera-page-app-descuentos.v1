FROM node:20-alpine

# Este Dockerfile se construye con el contexto en la raíz del proyecto (ver docker-compose.yml),
# para poder copiar también la carpeta sql/ que está fuera de app/.

WORKDIR /app

COPY app/package.json ./
RUN npm install --omit=dev

COPY app/src ./src
COPY app/public ./public
COPY sql /sql

EXPOSE 3000
CMD ["node", "src/index.js"]
