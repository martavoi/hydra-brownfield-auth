package main

import (
	"log"

	"github.com/hydra-auth/profile-srv/internal/app"
)

func main() {
	if err := app.Execute(); err != nil {
		log.Fatal(err)
	}
}
