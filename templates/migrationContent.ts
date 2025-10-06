export const upTemplate = (filename: string) => `-- Migration: ${filename}
-- Created: ${new Date().toISOString()}

-- Write your migration SQL here
`;

export const downTemplate = (filename: string) => `-- Rollback: ${filename}
-- Created: ${new Date().toISOString()}

-- Write your rollback SQL here
`;
