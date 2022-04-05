FROM alpine:latest

RUN apk add build-base
WORKDIR /src
CMD ["npm run build"]
COPY . .
EXPOSE 63342