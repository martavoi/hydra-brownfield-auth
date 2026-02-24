package repository

import "context"

// OtpRepository defines data access operations for one-time passwords.
type OtpRepository interface {
	// Store invalidates any pending OTPs for the phone and inserts a new one.
	Store(ctx context.Context, phone, code string, ttlSeconds int) error

	// Consume verifies the code and, if valid, marks it as used.
	// Returns false (no error) when the code is invalid or expired.
	Consume(ctx context.Context, phone, code string) (bool, error)
}
