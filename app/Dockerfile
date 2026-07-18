FROM node:20-alpine

# Este Dockerfile se construye con el contexto en la raíz del proyecto (ver docker-compose.yml),
# para poder copiar también la carpeta sql/ que está fuera de app/.

# Alpine no trae tzdata instalado: sin esto, la variable TZ (definida en el compose) no tiene
# ningún efecto y el contenedor corre en UTC pase lo que pase — necesario para que la
# detección de turnos (mañana/tarde) use la hora real de Chile, no UTC.
RUN apk add --no-cache tzdata
ENV TZ=America/Santiago

WORKDIR /app

COPY app/package.json ./
RUN npm install --omit=dev

COPY app/src ./src
COPY app/public ./public
COPY sql /sql

EXPOSE 3000
CMD ["node", "src/index.js"]
