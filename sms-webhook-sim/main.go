package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
)

type smsPayload struct {
	Phone string `json:"phone"`
	Otp   string `json:"otp"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8888"
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/sms", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var p smsPayload
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		fmt.Printf("\n╔══════════════════════════════════╗\n")
		fmt.Printf("║  📱 SMS RECEIVED  %-14s  ║\n", time.Now().Format("15:04:05"))
		fmt.Printf("║  Phone : %-24s║\n", p.Phone)
		fmt.Printf("║  OTP   : %-24s║\n", p.Otp)
		fmt.Printf("╚══════════════════════════════════╝\n\n")
		w.WriteHeader(http.StatusOK)
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	addr := ":" + port
	log.Printf("sms-webhook-sim listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
