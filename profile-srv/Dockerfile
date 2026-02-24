FROM golang:1.23-alpine AS builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /profile-srv ./cmd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /profile-srv /app/profile-srv
RUN mkdir /data
VOLUME /data
EXPOSE 50051
CMD ["/app/profile-srv", "serve"]
