package sqlite

import (
	"database/sql"
	"embed"
	"fmt"
	"time"

	"github.com/pressly/goose/v3"

	"github.com/hydra-auth/profile-srv/internal/repository"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed migrations/*.sql
var migrations embed.FS

// dsn bakes all recommended pragmas into the connection string so they apply
// to every connection in the pool, not just the first one.
const dsn = "file:%s" +
	"?_journal_mode=WAL" +   // readers never block writers
	"&_busy_timeout=5000" +  // retry for 5 s before returning SQLITE_BUSY
	"&_synchronous=NORMAL" + // safe durability with WAL, faster than FULL
	"&_foreign_keys=ON" +    // enforce FK constraints (off by default in SQLite)
	"&_cache_size=-20000"    // 20 MB page cache per connection

// Store holds the single shared database connection and exposes repository
// factories. All repositories created from the same Store share the connection
// and its pool settings.
type Store struct {
	db *sql.DB
}

// Open opens the SQLite database at path, applies any pending migrations, and
// returns a ready-to-use Store. The caller must call Close when done.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", fmt.Sprintf(dsn, path))
	if err != nil {
		return nil, fmt.Errorf("sqlite open: %w", err)
	}

	// SQLite allows only one concurrent writer; serialise at the pool level to
	// avoid SQLITE_BUSY contention between goroutines.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(time.Minute)

	if err := runMigrations(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("sqlite migrate: %w", err)
	}

	return &Store{db: db}, nil
}

// Close releases the database connection.
func (s *Store) Close() error { return s.db.Close() }

// Profiles returns a ProfileRepository backed by this store.
func (s *Store) Profiles() repository.ProfileRepository {
	return &profileRepo{db: s.db}
}

// Otps returns an OtpRepository backed by this store.
func (s *Store) Otps() repository.OtpRepository {
	return &otpRepo{db: s.db}
}

func runMigrations(db *sql.DB) error {
	goose.SetBaseFS(migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
