package sqlite

import (
	"context"
	"database/sql"
	"time"
)

type otpRepo struct {
	db *sql.DB
}

func (r *otpRepo) Store(ctx context.Context, phone, code string, ttlSeconds int) error {
	expiresAt := time.Now().Unix() + int64(ttlSeconds)
	if _, err := r.db.ExecContext(ctx,
		`UPDATE otps SET used = 1 WHERE phone = ? AND used = 0`, phone,
	); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO otps (phone, code, expires_at) VALUES (?, ?, ?)`,
		phone, code, expiresAt,
	)
	return err
}

func (r *otpRepo) Consume(ctx context.Context, phone, code string) (bool, error) {
	var otpId int64
	err := r.db.QueryRowContext(ctx,
		`SELECT id FROM otps
		 WHERE phone = ? AND code = ? AND used = 0 AND expires_at > ?
		 ORDER BY created_at DESC LIMIT 1`,
		phone, code, time.Now().Unix(),
	).Scan(&otpId)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	_, err = r.db.ExecContext(ctx, `UPDATE otps SET used = 1 WHERE id = ?`, otpId)
	return err == nil, err
}
