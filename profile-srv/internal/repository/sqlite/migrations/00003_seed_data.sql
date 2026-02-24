-- +goose Up
INSERT INTO profiles (id, phone, fname, lname, email, address) VALUES
    ('alice001', '+15550001001', 'Alice', 'Smith',    'alice@example.com', '1 Main St'),
    ('bob00002', '+15550001002', 'Bob',   'Jones',    'bob@example.com',   '2 Oak Ave'),
    ('carol003', '+15550001003', 'Carol', 'Williams', 'carol@example.com', '3 Pine Rd');

-- +goose Down
DELETE FROM profiles WHERE id IN ('alice001', 'bob00002', 'carol003');
