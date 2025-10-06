export const getCorrespondingFilename = (filename: string, direction: 'up' | 'down') => {
  return filename.replace(/\.(up|down)\.sql$/, `.${direction}.sql`);
};