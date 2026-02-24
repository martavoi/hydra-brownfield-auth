package repository

import "context"

// Profile is the domain model for a user profile.
type Profile struct {
	ID      string
	Phone   string
	Fname   string
	Lname   string
	Email   string
	Address string
}

// ProfileUpdate carries optional field changes. A nil pointer means "leave unchanged".
type ProfileUpdate struct {
	Fname   *string
	Lname   *string
	Email   *string
	Address *string
}

// ProfileRepository defines data access operations for profiles.
type ProfileRepository interface {
	Create(ctx context.Context, phone, fname, lname, email, address string) (Profile, error)
	GetById(ctx context.Context, id string) (Profile, error)
	GetByPhone(ctx context.Context, phone string) (Profile, error)
	Update(ctx context.Context, id string, u ProfileUpdate) (Profile, error)
	ExistsByPhone(ctx context.Context, phone string) (bool, error)
}
