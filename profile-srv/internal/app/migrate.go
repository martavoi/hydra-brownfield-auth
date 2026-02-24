package app

import (
	"fmt"
	"log"

	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/hydra-auth/profile-srv/internal/repository/sqlite"
)

var migrateCmd = &cobra.Command{
	Use:   "migrate",
	Short: "Apply database schema migrations",
	RunE:  runMigrate,
}

func init() {
	rootCmd.AddCommand(migrateCmd)
}

func runMigrate(_ *cobra.Command, _ []string) error {
	dbPath := viper.GetString("db_path")
	store, err := sqlite.Open(dbPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	store.Close()
	log.Printf("migrations applied to %s", dbPath)
	return nil
}
