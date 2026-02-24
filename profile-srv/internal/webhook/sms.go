package webhook

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
)

type payload struct {
	Phone string `json:"phone"`
	Otp   string `json:"otp"`
}

// Sender returns a SmsSender closure bound to the given webhook URL.
func Sender(webhookURL string) func(phone, otp string) {
	return func(phone, otp string) {
		body, err := json.Marshal(payload{Phone: phone, Otp: otp})
		if err != nil {
			log.Printf("sms webhook: marshal error: %v", err)
			return
		}
		resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("sms webhook: post error: %v", err)
			return
		}
		defer resp.Body.Close()
		log.Printf("sms webhook: delivered phone=%s otp=%s status=%d", phone, otp, resp.StatusCode)
	}
}
