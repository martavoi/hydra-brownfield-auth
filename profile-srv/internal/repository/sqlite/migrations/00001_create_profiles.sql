-- +goose Up
CREATE TABLE profiles (
    id         TEXT    PRIMARY KEY,
    phone      TEXT    NOT NULL UNIQUE,
    fname      TEXT    NOT NULL DEFAULT '',
    lname      TEXT    NOT NULL DEFAULT '',
    email      TEXT    NOT NULL DEFAULT '',
    address    TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_profiles_phone ON profiles (phone);

-- +goose Down
DROP TABLE profiles;
