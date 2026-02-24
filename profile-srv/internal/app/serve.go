package app

import (
	"fmt"
	"log"
	"net"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"

	"github.com/hydra-auth/profile-srv/internal/repository/sqlite"
	"github.com/hydra-auth/profile-srv/internal/service"
	"github.com/hydra-auth/profile-srv/internal/webhook"
	pb "github.com/hydra-auth/profile-srv/proto/profile"
)

var serveCmd = &cobra.Command{
	Use:   "serve",
	Short: "Start the gRPC server",
	RunE:  runServe,
}

func init() {
	rootCmd.AddCommand(serveCmd)
}

func runServe(_ *cobra.Command, _ []string) error {
	store, err := sqlite.Open(viper.GetString("db_path"))
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer store.Close()

	svc := service.NewProfileService(
		store.Profiles(),
		store.Otps(),
		webhook.Sender(viper.GetString("sms_webhook_url")),
		viper.GetInt("otp_ttl_seconds"),
	)

	lis, err := net.Listen("tcp", viper.GetString("grpc_port"))
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterProfileServiceServer(grpcServer, svc)
	reflection.Register(grpcServer)

	log.Printf("profile-srv listening on %s", viper.GetString("grpc_port"))
	return grpcServer.Serve(lis)
}
