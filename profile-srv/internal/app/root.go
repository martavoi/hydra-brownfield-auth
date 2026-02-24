package app

import (
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

var rootCmd = &cobra.Command{
	Use:   "profile-srv",
	Short: "Profile gRPC server with OTP-based passwordless authentication",
}

func init() {
	viper.SetDefault("grpc_port", ":50051")
	viper.SetDefault("db_path", "/data/profile.db")
	viper.SetDefault("sms_webhook_url", "http://localhost:8888/sms")
	viper.SetDefault("otp_ttl_seconds", 300)
	viper.AutomaticEnv() // maps GRPC_PORT → grpc_port, etc.
}

func Execute() error {
	return rootCmd.Execute()
}
