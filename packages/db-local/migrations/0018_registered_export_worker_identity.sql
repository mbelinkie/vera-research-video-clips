CREATE TABLE local_export_worker_identity (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  worker_id text NOT NULL UNIQUE,
  epoch integer NOT NULL CHECK (epoch > 0),
  advertisement_fingerprint text NOT NULL CHECK (length(advertisement_fingerprint) = 64),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
