-- Migration: test_query
-- Created: 2025-10-05T18:26:04.621Z

-- Write your migration SQL here

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL
);