package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jaevor/go-nanoid"

	"github.com/hydra-auth/profile-srv/internal/repository"
)

type profileRepo struct {
	db *sql.DB
}

func (r *profileRepo) Create(ctx context.Context, phone, fname, lname, email, address string) (repository.Profile, error) {
	gen, err := nanoid.Standard(8)
	if err != nil {
		return repository.Profile{}, err
	}
	id := gen()
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO profiles (id, phone, fname, lname, email, address) VALUES (?, ?, ?, ?, ?, ?)`,
		id, phone, fname, lname, email, address,
	)
	if err != nil {
		return repository.Profile{}, repository.ErrConflict
	}
	return repository.Profile{
		ID: id, Phone: phone,
		Fname: fname, Lname: lname, Email: email, Address: address,
	}, nil
}

func (r *profileRepo) GetById(ctx context.Context, id string) (repository.Profile, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, phone, fname, lname, email, address FROM profiles WHERE id = ?`, id,
	))
}

func (r *profileRepo) GetByPhone(ctx context.Context, phone string) (repository.Profile, error) {
	return r.scan(r.db.QueryRowContext(ctx,
		`SELECT id, phone, fname, lname, email, address FROM profiles WHERE phone = ?`, phone,
	))
}

func (r *profileRepo) Update(ctx context.Context, id string, u repository.ProfileUpdate) (repository.Profile, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE profiles
		 SET fname      = CASE WHEN ?1 IS NOT NULL THEN ?1 ELSE fname    END,
		     lname      = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE lname    END,
		     email      = CASE WHEN ?3 IS NOT NULL THEN ?3 ELSE email    END,
		     address    = CASE WHEN ?4 IS NOT NULL THEN ?4 ELSE address  END,
		     updated_at = strftime('%s', 'now')
		 WHERE id = ?5`,
		u.Fname, u.Lname, u.Email, u.Address, id,
	)
	if err != nil {
		return repository.Profile{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return repository.Profile{}, repository.ErrNotFound
	}
	return r.GetById(ctx, id)
}

func (r *profileRepo) ExistsByPhone(ctx context.Context, phone string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM profiles WHERE phone = ?)`, phone,
	).Scan(&exists)
	return exists, err
}

func (r *profileRepo) scan(row *sql.Row) (repository.Profile, error) {
	var p repository.Profile
	if err := row.Scan(&p.ID, &p.Phone, &p.Fname, &p.Lname, &p.Email, &p.Address); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return repository.Profile{}, repository.ErrNotFound
		}
		return repository.Profile{}, err
	}
	return p, nil
}
