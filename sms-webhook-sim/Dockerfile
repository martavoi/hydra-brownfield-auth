FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -o /sms-webhook-sim .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /sms-webhook-sim /sms-webhook-sim
EXPOSE 8888
CMD ["/sms-webhook-sim"]
